import asyncio
import base64
from binascii import Error as BinasciiError
import json
import logging
from datetime import datetime, timezone
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, Query
from storage3.exceptions import StorageException

from app.config import settings
from app.core.auth import User, get_current_user
from app.core.supabase import get_service_client
from app.core.vault import read_secret
from app.models.generation import (
    GenerateRequest,
    GenerationDetailResponse,
    GenerationHistoryItem,
    GenerationHistoryPage,
    GenerationHistoryStatusEnum,
    GenerationResponse,
    LogoModeEnum,
    ProviderEnum,
)
from app.services.error_mapping import classify_provider_error
from app.services.postprocess import resize_to_preset
from app.services.presets import (
    MODEL_FOR_PROVIDER,
    PLATFORM_PRESETS,
    PRESET_TO_ASPECT_RATIO,
    build_download_filename,
)
from app.services.prompt_composer import BrandContext, build_platform_context, compose_full_prompt
from app.services.providers.base import ProviderError, ProviderResult
from app.services.providers.gemini_image import gemini_generate
from app.services.providers.openai_image import openai_generate
from app.services.watermark import apply_watermark

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/brands/{brand_id}", tags=["generations"])


def _error_response(status_code: int, code: str, message: str) -> HTTPException:
    return HTTPException(
        status_code=status_code,
        detail={
            "error": {
                "code": code,
                "message": message,
                "request_id": str(uuid4()),
            }
        },
    )


def _get_brand_or_404(brand_id: UUID, user_id: str) -> dict:
    client = get_service_client()
    result = (
        client.table("brands")
        .select("*")
        .eq("id", str(brand_id))
        .eq("owner_user_id", user_id)
        .maybe_single()
        .execute()
    )
    if result is None or result.data is None:
        raise _error_response(404, "BRAND_NOT_FOUND", "Brand not found")
    return result.data


def _get_active_key_or_400(brand_id: UUID, provider: str) -> dict:
    client = get_service_client()
    result = (
        client.table("provider_keys")
        .select("*")
        .eq("brand_id", str(brand_id))
        .eq("provider", provider)
        .eq("is_active", True)
        .maybe_single()
        .execute()
    )
    if result is None or result.data is None:
        raise _error_response(
            400,
            "NO_ACTIVE_KEY",
            f"No active {provider} key for this brand. Add or activate a key on the Keys page.",
        )
    return result.data


def _get_brand_kit_context(brand_id: UUID, brand_name: str) -> BrandContext | None:
    """Fetch raw brand kit fields for a complete kit, or None."""
    client = get_service_client()
    result = (
        client.table("brand_kits")
        .select("tagline, tone, audience, colors, avoid_words, status")
        .eq("brand_id", str(brand_id))
        .maybe_single()
        .execute()
    )
    if result is None or result.data is None:
        return None
    row = result.data
    if row.get("status") != "complete":
        return None
    return BrandContext(
        name=brand_name,
        tagline=row.get("tagline"),
        tone=row.get("tone"),
        audience=row.get("audience"),
        colors=row.get("colors") or [],
        avoid_words=row.get("avoid_words"),
    )


def _mark_failed(generation_id: UUID, code: str, message: str) -> None:
    client = get_service_client()
    now = datetime.now(timezone.utc).isoformat()
    client.table("generations").update(
        {
            "status": "failed",
            "error_code": code,
            "error_message": (message or "")[:1000],
            "completed_at": now,
        }
    ).eq("id", str(generation_id)).execute()


def _derive_download_filename(image_url: str | None, row: dict, brand_name: str) -> str | None:
    if not image_url or not row.get("completed_at"):
        return None
    completed_at = row["completed_at"]
    if isinstance(completed_at, str):
        completed_at = datetime.fromisoformat(completed_at.replace("Z", "+00:00"))
    return build_download_filename(
        brand_name=brand_name,
        preset_identifier=row["platform_preset"],
        completed_at=completed_at,
    )


def _build_response(row: dict, brand_name: str) -> GenerationResponse:
    image_url = _build_public_image_url(row.get("image_path"))
    return GenerationResponse(
        id=row["id"],
        prompt=row["prompt"],
        provider=row["provider"],
        model=row["model"],
        platform_preset=row["platform_preset"],
        width=row["width"],
        height=row["height"],
        logo_mode=row["logo_mode"],
        status=row["status"],
        image_url=image_url,
        download_filename=_derive_download_filename(image_url, row, brand_name),
        error_code=row.get("error_code"),
        error_message=row.get("error_message"),
        created_at=row["created_at"],
        completed_at=row.get("completed_at"),
    )


HISTORY_PAGE_SIZE = 24

PROMPT_EXCERPT_LENGTH = 120


def _build_public_image_url(image_path: str | None) -> str | None:
    if not image_path:
        return None
    return (
        f"{settings.SUPABASE_URL}/storage/v1/object/public/"
        f"{settings.STORAGE_BUCKET}/{image_path}"
    )


def _build_prompt_excerpt(prompt: str) -> str:
    if len(prompt) <= PROMPT_EXCERPT_LENGTH:
        return prompt
    return prompt[: PROMPT_EXCERPT_LENGTH - 1].rstrip() + "…"


def _encode_cursor(created_at: str, row_id: str) -> str:
    payload = json.dumps({"c": created_at, "i": row_id}, separators=(",", ":"))
    return base64.urlsafe_b64encode(payload.encode()).decode()


def _decode_cursor(cursor: str) -> tuple[str, str]:
    try:
        raw = base64.urlsafe_b64decode(cursor.encode()).decode()
    except (BinasciiError, UnicodeDecodeError):
        raise _error_response(400, "VALIDATION_ERROR", "Invalid cursor")
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError:
        raise _error_response(400, "VALIDATION_ERROR", "Invalid cursor")
    if not isinstance(payload, dict) or "c" not in payload or "i" not in payload:
        raise _error_response(400, "VALIDATION_ERROR", "Invalid cursor")
    created_at = payload["c"]
    row_id = payload["i"]
    if not isinstance(created_at, str) or not isinstance(row_id, str):
        raise _error_response(400, "VALIDATION_ERROR", "Invalid cursor")
    try:
        parsed_created_at = datetime.fromisoformat(created_at.replace("Z", "+00:00"))
        parsed_id = UUID(row_id)
    except ValueError:
        raise _error_response(400, "VALIDATION_ERROR", "Invalid cursor")
    return parsed_created_at.isoformat(), str(parsed_id)


def _is_already_missing_storage_error(exc: Exception) -> bool:
    status_code = str(getattr(exc, "status", ""))
    error_code = str(getattr(exc, "code", "")).lower()
    message = str(getattr(exc, "message", str(exc))).lower()
    return (
        status_code == "404"
        or error_code in {"not_found", "notfound", "object_not_found", "objectnotfound"}
        or "not found" in message
        or "does not exist" in message
    )


def _build_history_item(row: dict) -> GenerationHistoryItem:
    image_url = _build_public_image_url(row.get("image_path"))
    error_message = row.get("error_message") if row.get("status") == "failed" else None
    return GenerationHistoryItem(
        id=row["id"],
        prompt_excerpt=_build_prompt_excerpt(row["prompt"]),
        provider=row["provider"],
        model=row["model"],
        platform_preset=row["platform_preset"],
        width=row["width"],
        height=row["height"],
        logo_mode=row["logo_mode"],
        status=row["status"],
        image_url=image_url,
        error_message=error_message,
        created_at=row["created_at"],
        completed_at=row.get("completed_at"),
    )


def _build_detail_response(row: dict, brand_name: str) -> GenerationDetailResponse:
    image_url = _build_public_image_url(row.get("image_path"))
    return GenerationDetailResponse(
        id=row["id"],
        prompt=row["prompt"],
        provider=row["provider"],
        model=row["model"],
        platform_preset=row["platform_preset"],
        width=row["width"],
        height=row["height"],
        logo_mode=row["logo_mode"],
        status=row["status"],
        provider_request_id=row.get("provider_request_id"),
        image_url=image_url,
        download_filename=_derive_download_filename(image_url, row, brand_name),
        error_code=row.get("error_code"),
        error_message=row.get("error_message"),
        created_at=row["created_at"],
        completed_at=row.get("completed_at"),
    )


@router.post("/generate", response_model=GenerationResponse)
async def generate_image(
    brand_id: UUID,
    body: GenerateRequest,
    current_user: User = Depends(get_current_user),
) -> GenerationResponse:
    brand = _get_brand_or_404(brand_id, current_user.id)
    brand_name = brand["name"]
    brand_has_logo = bool(brand.get("logo_path"))

    if body.logo_mode in (LogoModeEnum.watermark, LogoModeEnum.both) and not brand_has_logo:
        raise _error_response(
            400,
            "LOGO_REQUIRED",
            "This logo mode requires an uploaded brand logo. Please upload a logo on the Settings page.",
        )

    preset_w, preset_h, _label = PLATFORM_PRESETS[body.platform_preset.value]

    active_key = _get_active_key_or_400(brand_id, body.provider.value)

    aspect_ratio = PRESET_TO_ASPECT_RATIO[body.platform_preset.value]
    platform = build_platform_context(
        preset_id=body.platform_preset.value,
        width=preset_w,
        height=preset_h,
        aspect_ratio=aspect_ratio,
    )
    brand_context = _get_brand_kit_context(brand_id, brand_name)

    generation_id = uuid4()
    resolved_model = MODEL_FOR_PROVIDER[body.provider.value]

    client = get_service_client()
    client.table("generations").insert(
        {
            "id": str(generation_id),
            "brand_id": str(brand_id),
            "prompt": body.prompt,
            "provider": body.provider.value,
            "model": resolved_model,
            "platform_preset": body.platform_preset.value,
            "width": preset_w,
            "height": preset_h,
            "logo_mode": body.logo_mode.value,
            "status": "pending",
        }
    ).execute()

    logger.info(
        "generate start generation_id=%s brand_id=%s provider=%s preset=%s logo_mode=%s",
        generation_id, brand_id, body.provider.value,
        body.platform_preset.value, body.logo_mode.value,
    )

    try:
        client.table("generations").update({"status": "processing"}).eq(
            "id", str(generation_id)
        ).execute()

        full_prompt = compose_full_prompt(
            user_prompt=body.prompt,
            brand_context=brand_context,
            platform=platform,
            logo_mode=body.logo_mode.value,
            brand_has_logo=brand_has_logo,
        )

        api_key = read_secret(active_key["vault_secret_id"])

        try:
            if body.provider is ProviderEnum.openai:
                result: ProviderResult = await asyncio.wait_for(
                    openai_generate(
                        api_key=api_key,
                        prompt=full_prompt,
                        width=preset_w,
                        height=preset_h,
                        model=resolved_model,
                    ),
                    timeout=120.0,
                )
            else:
                result = await asyncio.wait_for(
                    asyncio.to_thread(
                        gemini_generate,
                        api_key=api_key,
                        prompt=full_prompt,
                        aspect_ratio=aspect_ratio,
                        model=resolved_model,
                    ),
                    timeout=120.0,
                )
        except asyncio.TimeoutError as exc:
            raise ProviderError(
                "TIMEOUT",
                "The request took too long to complete. Please try again.",
            ) from exc
        except ProviderError:
            raise
        except Exception as exc:
            code, user_msg = classify_provider_error(exc)
            raise ProviderError(code, user_msg) from exc

        image_bytes = resize_to_preset(result.image_bytes, preset_w, preset_h)

        if (
            body.logo_mode in (LogoModeEnum.watermark, LogoModeEnum.both)
            and brand_has_logo
        ):
            logo_bytes = client.storage.from_(settings.STORAGE_BUCKET).download(
                brand["logo_path"]
            )
            image_bytes = apply_watermark(image_bytes, logo_bytes)

        image_path = f"brands/{brand_id}/generations/{generation_id}.png"
        client.storage.from_(settings.STORAGE_BUCKET).upload(
            image_path,
            image_bytes,
            {"content-type": "image/png", "upsert": "false"},
        )

        now_iso = datetime.now(timezone.utc).isoformat()
        updated = (
            client.table("generations")
            .update(
                {
                    "status": "succeeded",
                    "image_path": image_path,
                    "provider_request_id": result.request_id,
                    "completed_at": now_iso,
                }
            )
            .eq("id", str(generation_id))
            .execute()
        )

        try:
            client.table("provider_keys").update({"last_used_at": now_iso}).eq(
                "id", active_key["id"]
            ).execute()
        except Exception:
            logger.warning(
                "Failed to update last_used_at for key %s (non-critical)",
                active_key["id"],
            )

        row = updated.data[0] if updated.data else None
        if row is None:
            try:
                row = (
                    client.table("generations")
                    .select("*")
                    .eq("id", str(generation_id))
                    .single()
                    .execute()
                    .data
                )
            except Exception:
                logger.warning(
                    "Failed to re-fetch generation %s after success update",
                    generation_id,
                )
        if row is None:
            logger.error(
                "No row data for succeeded generation %s brand_id=%s; constructing minimal row",
                generation_id, brand_id,
            )
            row = {
                "id": str(generation_id),
                "prompt": body.prompt,
                "provider": body.provider.value,
                "model": resolved_model,
                "platform_preset": body.platform_preset.value,
                "width": preset_w,
                "height": preset_h,
                "logo_mode": body.logo_mode.value,
                "status": "succeeded",
                "image_path": image_path,
                "error_code": None,
                "error_message": None,
                "created_at": now_iso,
                "completed_at": now_iso,
            }
        logger.info(
            "generate success generation_id=%s brand_id=%s",
            generation_id, brand_id,
        )
        return _build_response(row, brand_name)

    except ProviderError as e:
        _mark_failed(generation_id, e.code, e.user_message)
        logger.info(
            "generate failed code=%s generation_id=%s brand_id=%s",
            e.code, generation_id, brand_id,
        )
        raise _error_response(502, e.code, e.user_message)
    except Exception:
        logger.exception(
            "generate pipeline unexpected error generation_id=%s brand_id=%s",
            generation_id, brand_id,
        )
        _mark_failed(
            generation_id, "INTERNAL_ERROR", "Internal error"
        )
        raise _error_response(
            500,
            "INTERNAL_ERROR",
            "Something went wrong. Please try again.",
        )


_VALID_HISTORY_STATUSES = {s.value for s in GenerationHistoryStatusEnum}
_VALID_HISTORY_PROVIDERS = {p.value for p in ProviderEnum}


@router.get("/generations", response_model=GenerationHistoryPage)
async def list_generation_history(
    brand_id: UUID,
    current_user: User = Depends(get_current_user),
    provider: str | None = Query(None),
    status: str | None = Query(None),
    cursor: str | None = Query(None),
) -> GenerationHistoryPage:
    _get_brand_or_404(brand_id, current_user.id)

    if provider is not None and provider not in _VALID_HISTORY_PROVIDERS:
        raise _error_response(400, "VALIDATION_ERROR", f"Invalid provider filter: {provider}")
    if status is not None and status not in _VALID_HISTORY_STATUSES:
        raise _error_response(400, "VALIDATION_ERROR", f"Invalid status filter: {status}")

    client = get_service_client()
    query = (
        client.table("generations")
        .select("*")
        .eq("brand_id", str(brand_id))
        .in_("status", ["succeeded", "failed"])
    )

    if provider:
        query = query.eq("provider", provider)
    if status:
        query = query.eq("status", status)

    if cursor:
        cursor_created_at, cursor_id = _decode_cursor(cursor)
        query = query.or_(
            f"created_at.lt.{cursor_created_at},"
            f"and(created_at.eq.{cursor_created_at},id.lt.{cursor_id})"
        )

    query = query.order("created_at", desc=True).order("id", desc=True).limit(HISTORY_PAGE_SIZE + 1)

    result = query.execute()
    rows = result.data or []

    has_next = len(rows) > HISTORY_PAGE_SIZE
    if has_next:
        rows = rows[:HISTORY_PAGE_SIZE]

    items = [_build_history_item(row) for row in rows]

    next_cursor = None
    if has_next and rows:
        last = rows[-1]
        next_cursor = _encode_cursor(last["created_at"], last["id"])

    logger.info(
        "history list brand_id=%s provider=%s status=%s cursor=%s returned=%d has_next=%s",
        brand_id, provider, status, bool(cursor), len(items), has_next,
    )

    return GenerationHistoryPage(
        items=items,
        next_cursor=next_cursor,
        page_size=HISTORY_PAGE_SIZE,
    )


@router.get("/generations/{generation_id}", response_model=GenerationDetailResponse)
async def get_generation_detail(
    brand_id: UUID,
    generation_id: UUID,
    current_user: User = Depends(get_current_user),
) -> GenerationDetailResponse:
    brand = _get_brand_or_404(brand_id, current_user.id)

    client = get_service_client()
    row = _find_generation_or_404(client, brand_id, generation_id)

    # History exposes only terminal generations. A non-terminal row (pending/
    # processing — e.g. an in-flight run or one left stuck by a crash) would fail
    # GenerationDetailResponse's status enum, so treat it as not-found here.
    if row["status"] not in ("succeeded", "failed"):
        raise _error_response(404, "GENERATION_NOT_FOUND", "Generation not found")

    logger.info(
        "history detail brand_id=%s generation_id=%s status=%s",
        brand_id, generation_id, row.get("status"),
    )
    return _build_detail_response(row, brand["name"])


def _find_generation_or_404(client, brand_id: UUID, generation_id: UUID) -> dict:
    result = (
        client.table("generations")
        .select("*")
        .eq("id", str(generation_id))
        .eq("brand_id", str(brand_id))
        .maybe_single()
        .execute()
    )
    if result is None or result.data is None:
        raise _error_response(404, "GENERATION_NOT_FOUND", "Generation not found")
    return result.data


@router.delete("/generations/{generation_id}", status_code=204)
async def delete_generation(
    brand_id: UUID,
    generation_id: UUID,
    current_user: User = Depends(get_current_user),
) -> None:
    _get_brand_or_404(brand_id, current_user.id)

    client = get_service_client()
    row = _find_generation_or_404(client, brand_id, generation_id)

    image_path = row.get("image_path")
    if image_path:
        try:
            client.storage.from_(settings.STORAGE_BUCKET).remove([image_path])
        except StorageException as exc:
            if _is_already_missing_storage_error(exc):
                pass
            else:
                logger.warning(
                    "storage delete failed brand_id=%s generation_id=%s path=%s error=%s",
                    brand_id, generation_id, image_path, exc,
                )
                raise _error_response(
                    502, "STORAGE_DELETE_FAILED",
                    "Failed to delete stored image. Please try again.",
                )

    # Storage is removed first (above) so a "deleted" image is never left publicly
    # reachable. If the DB delete fails after that, surface a clean retryable error:
    # the row briefly points at a now-missing object, and a retry heals it (the
    # storage remove tolerates an already-missing object via _is_already_missing_storage_error).
    try:
        client.table("generations").delete().eq("id", str(generation_id)).eq(
            "brand_id", str(brand_id)
        ).execute()
    except Exception as exc:
        logger.error(
            "db delete failed after storage removal brand_id=%s generation_id=%s path=%s error=%s",
            brand_id, generation_id, image_path, exc,
        )
        raise _error_response(
            502, "DELETE_FAILED",
            "Failed to delete the generation. Please try again.",
        )

    logger.info(
        "generation deleted brand_id=%s generation_id=%s",
        brand_id, generation_id,
    )
