import io
import logging
from urllib.parse import urlencode
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from PIL import Image
from postgrest.exceptions import APIError

from app.config import settings
from app.core.auth import User, get_current_user
from app.core.supabase import get_service_client
from app.core.vault import delete_secret
from app.models.brand import (
    BrandListItem,
    BrandResponse,
    CreateBrandRequest,
    DeleteBrandRequest,
    LogoUploadResponse,
    UpdateBrandRequest,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/brands", tags=["brands"])


def _error_response(status_code: int, code: str, message: str) -> HTTPException:
    return HTTPException(
        status_code=status_code,
        detail={"error": {"code": code, "message": message, "request_id": str(uuid4())}},
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


def _build_logo_url(logo_path: str | None, updated_at: str | None = None) -> str | None:
    if logo_path is None:
        return None
    logo_url = f"{settings.SUPABASE_URL}/storage/v1/object/public/{settings.STORAGE_BUCKET}/{logo_path}"
    if updated_at:
        return f"{logo_url}?{urlencode({'v': updated_at})}"
    return logo_url


def _get_kit_status(brand_id: str) -> str:
    client = get_service_client()
    result = (
        client.table("brand_kits")
        .select("status")
        .eq("brand_id", brand_id)
        .maybe_single()
        .execute()
    )
    if result is None or result.data is None:
        return "not_started"
    return result.data["status"]


def _brand_response(row: dict, kit_status: str) -> BrandResponse:
    return BrandResponse(
        id=row["id"],
        name=row["name"],
        logo_url=_build_logo_url(row.get("logo_path"), row.get("updated_at")),
        kit_status=kit_status,
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


@router.post("", response_model=BrandResponse, status_code=status.HTTP_201_CREATED)
async def create_brand(
    body: CreateBrandRequest, current_user: User = Depends(get_current_user)
):
    client = get_service_client()
    name = body.name.strip()
    try:
        result = (
            client.table("brands")
            .insert({"owner_user_id": current_user.id, "name": name})
            .execute()
        )
    except APIError as e:
        if "uq_brands_owner_name_ci" in str(e) or "duplicate key" in str(e):
            raise _error_response(
                409, "DUPLICATE_BRAND_NAME", "A brand with this name already exists"
            ) from e
        raise
    row = result.data[0]
    kit_status = _get_kit_status(row["id"])
    return _brand_response(row, kit_status)


@router.get("", response_model=list[BrandListItem])
async def list_brands(current_user: User = Depends(get_current_user)):
    client = get_service_client()
    result = (
        client.table("brands")
        .select("*")
        .eq("owner_user_id", current_user.id)
        .order("created_at", desc=True)
        .execute()
    )
    brand_ids = [row["id"] for row in result.data or []]
    kit_statuses: dict[str, str] = {}
    if brand_ids:
        kit_result = (
            client.table("brand_kits")
            .select("brand_id, status")
            .in_("brand_id", brand_ids)
            .execute()
        )
        kit_statuses = {k["brand_id"]: k["status"] for k in kit_result.data or []}

    items = []
    for row in result.data or []:
        kit_status = kit_statuses.get(row["id"], "not_started")
        items.append(
            BrandListItem(
                id=row["id"],
                name=row["name"],
                logo_url=_build_logo_url(row.get("logo_path"), row.get("updated_at")),
                kit_status=kit_status,
                created_at=row["created_at"],
            )
        )
    return items


@router.get("/{brand_id}", response_model=BrandResponse)
async def get_brand(brand_id: UUID, current_user: User = Depends(get_current_user)):
    brand = _get_brand_or_404(brand_id, current_user.id)
    kit_status = _get_kit_status(brand["id"])
    return _brand_response(brand, kit_status)


@router.patch("/{brand_id}", response_model=BrandResponse)
async def update_brand(
    brand_id: UUID,
    body: UpdateBrandRequest,
    current_user: User = Depends(get_current_user),
):
    brand = _get_brand_or_404(brand_id, current_user.id)
    name = body.name.strip()
    if name == brand["name"]:
        kit_status = _get_kit_status(brand["id"])
        return _brand_response(brand, kit_status)
    client = get_service_client()
    try:
        result = (
            client.table("brands")
            .update({"name": name})
            .eq("id", str(brand_id))
            .execute()
        )
    except APIError as e:
        if "uq_brands_owner_name_ci" in str(e) or "duplicate key" in str(e):
            raise _error_response(
                409, "DUPLICATE_BRAND_NAME", "A brand with this name already exists"
            ) from e
        raise
    row = result.data[0]
    kit_status = _get_kit_status(row["id"])
    return _brand_response(row, kit_status)


@router.delete("/{brand_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_brand(
    brand_id: UUID,
    body: DeleteBrandRequest,
    current_user: User = Depends(get_current_user),
):
    brand = _get_brand_or_404(brand_id, current_user.id)
    if body.confirm_name != brand["name"]:
        raise _error_response(
            400, "NAME_MISMATCH", "Confirmation name does not match brand name"
        )
    client = get_service_client()

    # Step 1: Delete generation images from storage
    gen_result = (
        client.table("generations")
        .select("image_path")
        .eq("brand_id", str(brand_id))
        .not_.is_("image_path", "null")
        .execute()
    )
    for gen in gen_result.data or []:
        try:
            client.storage.from_(settings.STORAGE_BUCKET).remove([gen["image_path"]])
        except Exception as e:
            logger.warning(f"Failed to delete generation image {gen['image_path']}: {e}")

    # Step 2: Delete brand logo from storage
    if brand.get("logo_path"):
        try:
            client.storage.from_(settings.STORAGE_BUCKET).remove([brand["logo_path"]])
        except Exception as e:
            logger.warning(f"Failed to delete logo {brand['logo_path']}: {e}")

    # Step 3: Delete Vault secrets for provider keys
    keys_result = (
        client.table("provider_keys")
        .select("vault_secret_id")
        .eq("brand_id", str(brand_id))
        .execute()
    )
    for key in keys_result.data or []:
        try:
            delete_secret(key["vault_secret_id"])
        except Exception as e:
            logger.warning(f"Failed to delete vault secret: {e}")

    # Step 4: Delete the brand row (DB cascade handles related tables)
    client.table("brands").delete().eq("id", str(brand_id)).execute()


@router.post("/{brand_id}/logo", response_model=LogoUploadResponse)
async def upload_logo(
    brand_id: UUID,
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
):
    brand = _get_brand_or_404(brand_id, current_user.id)

    file_bytes = await file.read()
    if len(file_bytes) > 5 * 1024 * 1024:
        raise _error_response(400, "VALIDATION_ERROR", "File size exceeds 5 MB limit")

    try:
        img = Image.open(io.BytesIO(file_bytes))
        img.thumbnail((512, 512))
    except Exception as e:
        logger.warning(f"Image processing failed: {e}")
        raise _error_response(400, "VALIDATION_ERROR", "Invalid or corrupted image file") from e

    # Validate actual image format (don't trust client content_type)
    allowed_formats = {"PNG": ("png", "image/png"), "JPEG": ("jpg", "image/jpeg"), "WEBP": ("webp", "image/webp")}
    if img.format not in allowed_formats:
        raise _error_response(
            400, "INVALID_FILE_TYPE", "Only PNG, JPG, and WebP images are accepted"
        )
    ext, mime_type = allowed_formats[img.format]

    output = io.BytesIO()
    img.save(output, format=img.format)
    resized_bytes = output.getvalue()

    storage_path = f"brands/{brand_id}/logo.{ext}"

    client = get_service_client()
    old_logo_path = brand.get("logo_path")

    client.storage.from_(settings.STORAGE_BUCKET).upload(
        storage_path, resized_bytes, {"content-type": mime_type, "upsert": "true"}
    )

    try:
        update_result = client.table("brands").update({"logo_path": storage_path}).eq(
            "id", str(brand_id)
        ).execute()
    except Exception:
        if old_logo_path != storage_path:
            try:
                client.storage.from_(settings.STORAGE_BUCKET).remove([storage_path])
            except Exception as cleanup_err:
                logger.warning(f"Failed to clean up uploaded logo after DB error: {cleanup_err}")
        raise

    if old_logo_path and old_logo_path != storage_path:
        try:
            client.storage.from_(settings.STORAGE_BUCKET).remove([old_logo_path])
        except Exception as e:
            logger.warning(f"Failed to delete old logo {old_logo_path}: {e}")

    if not update_result.data:
        try:
            client.storage.from_(settings.STORAGE_BUCKET).remove([storage_path])
        except Exception as cleanup_err:
            logger.warning(
                f"Failed to clean up uploaded logo after missing brand update: {cleanup_err}"
            )
        raise _error_response(404, "BRAND_NOT_FOUND", "Brand not found")

    updated_row = update_result.data[0]
    return LogoUploadResponse(
        logo_url=_build_logo_url(storage_path, updated_row.get("updated_at"))
    )


@router.delete("/{brand_id}/logo", status_code=status.HTTP_204_NO_CONTENT)
async def delete_logo(brand_id: UUID, current_user: User = Depends(get_current_user)):
    brand = _get_brand_or_404(brand_id, current_user.id)
    if not brand.get("logo_path"):
        raise _error_response(404, "LOGO_NOT_FOUND", "Brand has no logo to delete")

    client = get_service_client()
    try:
        client.storage.from_(settings.STORAGE_BUCKET).remove([brand["logo_path"]])
    except Exception as e:
        logger.warning(f"Failed to delete logo from storage: {e}")
    client.table("brands").update({"logo_path": None}).eq(
        "id", str(brand_id)
    ).execute()
