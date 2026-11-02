import logging
from datetime import datetime, timezone
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, status

from app.core.auth import User, get_current_user
from app.core.supabase import get_service_client
from app.core.vault import store_secret, read_secret, delete_secret
from app.models.provider_key import (
    AddKeyRequest,
    ProviderKeyResponse,
    ValidateKeyResponse,
)
from app.services.provider_validation import validate_provider_key

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/brands/{brand_id}/keys", tags=["provider-keys"])


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


def _get_key_or_404(brand_id: UUID, key_id: UUID) -> dict:
    client = get_service_client()
    result = (
        client.table("provider_keys")
        .select("*")
        .eq("id", str(key_id))
        .eq("brand_id", str(brand_id))
        .maybe_single()
        .execute()
    )
    if result is None or result.data is None:
        raise _error_response(404, "KEY_NOT_FOUND", "Key not found")
    return result.data


def _key_response(row: dict) -> ProviderKeyResponse:
    return ProviderKeyResponse(
        id=row["id"],
        provider=row["provider"],
        label=row.get("label"),
        key_hint=row.get("key_hint"),
        is_active=row["is_active"],
        is_valid=row.get("is_valid"),
        last_validated_at=row.get("last_validated_at"),
        last_validation_error=row.get("last_validation_error"),
        created_at=row["created_at"],
    )


@router.get("", response_model=list[ProviderKeyResponse])
async def list_keys(
    brand_id: UUID,
    current_user: User = Depends(get_current_user),
):
    _get_brand_or_404(brand_id, current_user.id)
    client = get_service_client()
    result = (
        client.table("provider_keys")
        .select("*")
        .eq("brand_id", str(brand_id))
        .order("provider")
        .order("created_at", desc=True)
        .execute()
    )
    return [_key_response(row) for row in result.data or []]


@router.post("", response_model=ProviderKeyResponse, status_code=status.HTTP_201_CREATED)
async def add_key(
    brand_id: UUID,
    body: AddKeyRequest,
    current_user: User = Depends(get_current_user),
):
    _get_brand_or_404(brand_id, current_user.id)
    client = get_service_client()

    key_hint = body.key[-4:] if len(body.key) >= 4 else ("*" * len(body.key))

    try:
        vault_secret_id = store_secret(
            name=f"provider_key_{uuid4()}",
            value=body.key,
        )
    except Exception as e:
        logger.error("Vault store failed: %s", e)
        raise _error_response(502, "VAULT_ERROR", "Failed to store key securely") from e

    # Validate BEFORE touching active status so failures don't orphan the old key
    is_valid, validation_error = await validate_provider_key(body.provider, body.key)
    now = datetime.now(timezone.utc).isoformat()

    deactivated_key_id = None
    try:
        if body.make_active:
            existing = (
                client.table("provider_keys")
                .select("id")
                .eq("brand_id", str(brand_id))
                .eq("provider", body.provider)
                .eq("is_active", True)
                .maybe_single()
                .execute()
            )
            if existing and existing.data:
                deactivated_key_id = existing.data["id"]
                client.table("provider_keys").update(
                    {"is_active": False}
                ).eq("id", deactivated_key_id).execute()

        row_data = {
            "brand_id": str(brand_id),
            "provider": body.provider,
            "vault_secret_id": vault_secret_id,
            "label": body.label,
            "key_hint": key_hint,
            "is_active": body.make_active,
            "is_valid": is_valid,
            "last_validated_at": now,
            "last_validation_error": None if is_valid is True else validation_error,
        }
        result = client.table("provider_keys").insert(row_data).execute()
    except Exception as e:
        if deactivated_key_id:
            try:
                client.table("provider_keys").update(
                    {"is_active": True}
                ).eq("id", deactivated_key_id).execute()
            except Exception:
                logger.error("Failed to re-activate key %s during rollback", deactivated_key_id)
        # Best-effort cleanup of orphaned vault secret
        try:
            delete_secret(vault_secret_id)
        except Exception:
            logger.warning("Failed to clean up vault secret %s after add_key failure", vault_secret_id)
        if "uq_provider_keys_one_active" in str(e):
            raise _error_response(409, "ACTIVE_KEY_CONFLICT", "Another key is already active for this provider") from e
        raise
    return _key_response(result.data[0])


@router.post("/{key_id}/validate", response_model=ValidateKeyResponse)
async def validate_key(
    brand_id: UUID,
    key_id: UUID,
    current_user: User = Depends(get_current_user),
):
    _get_brand_or_404(brand_id, current_user.id)
    key = _get_key_or_404(brand_id, key_id)

    try:
        api_key = read_secret(key["vault_secret_id"])
    except Exception as e:
        logger.error("Vault read failed: %s", e)
        raise _error_response(502, "VAULT_ERROR", "Failed to retrieve key from vault") from e

    if not api_key:
        raise _error_response(502, "VAULT_ERROR", "Key not found in vault") from None

    is_valid, error_message = await validate_provider_key(key["provider"], api_key)

    now = datetime.now(timezone.utc)

    update_data: dict = {
        "last_validated_at": now.isoformat(),
        "last_validation_error": None if is_valid is True else error_message,
    }
    if is_valid is not None:
        update_data["is_valid"] = is_valid
    client = get_service_client()
    client.table("provider_keys").update(update_data).eq("id", str(key_id)).execute()

    return ValidateKeyResponse(
        valid=is_valid,
        validated_at=now,
        error=error_message,
        key_id=str(key_id),
    )


@router.patch("/{key_id}/activate", response_model=ProviderKeyResponse)
async def activate_key(
    brand_id: UUID,
    key_id: UUID,
    current_user: User = Depends(get_current_user),
):
    _get_brand_or_404(brand_id, current_user.id)
    key = _get_key_or_404(brand_id, key_id)

    if key["is_active"]:
        return _key_response(key)

    client = get_service_client()

    existing = (
        client.table("provider_keys")
        .select("id")
        .eq("brand_id", str(brand_id))
        .eq("provider", key["provider"])
        .eq("is_active", True)
        .maybe_single()
        .execute()
    )
    deactivated_key_id = existing.data["id"] if existing and existing.data else None

    if deactivated_key_id:
        client.table("provider_keys").update(
            {"is_active": False}
        ).eq("id", deactivated_key_id).execute()

    try:
        result = (
            client.table("provider_keys")
            .update({"is_active": True})
            .eq("id", str(key_id))
            .execute()
        )
    except Exception as e:
        if deactivated_key_id:
            try:
                client.table("provider_keys").update(
                    {"is_active": True}
                ).eq("id", deactivated_key_id).execute()
            except Exception:
                logger.error("Failed to re-activate key %s during rollback", deactivated_key_id)
        if "uq_provider_keys_one_active" in str(e):
            raise _error_response(409, "ACTIVE_KEY_CONFLICT", "Another key is already active for this provider") from e
        raise
    return _key_response(result.data[0])


@router.delete("/{key_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_key(
    brand_id: UUID,
    key_id: UUID,
    current_user: User = Depends(get_current_user),
):
    _get_brand_or_404(brand_id, current_user.id)
    key = _get_key_or_404(brand_id, key_id)

    try:
        delete_secret(key["vault_secret_id"])
    except Exception as e:
        logger.error("Failed to delete vault secret %s: %s", key["vault_secret_id"], e)
        raise _error_response(502, "VAULT_ERROR", "Failed to delete key from vault — please retry") from e

    client = get_service_client()
    client.table("provider_keys").delete().eq("id", str(key_id)).execute()
