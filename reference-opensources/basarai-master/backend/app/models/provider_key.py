from datetime import datetime

from pydantic import BaseModel, field_validator


class AddKeyRequest(BaseModel):
    provider: str
    key: str
    label: str | None = None
    make_active: bool = True

    @field_validator("provider")
    @classmethod
    def validate_provider(cls, v: str) -> str:
        if v not in ("openai", "gemini"):
            raise ValueError("Provider must be 'openai' or 'gemini'")
        return v

    @field_validator("key")
    @classmethod
    def validate_key(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("Key cannot be empty")
        return v

    @field_validator("label")
    @classmethod
    def validate_label(cls, v: str | None) -> str | None:
        if v is None:
            return None
        v = v.strip()
        if not v:
            return None
        if len(v) > 100:
            raise ValueError("Label must be 100 characters or less")
        return v


class ProviderKeyResponse(BaseModel):
    id: str
    provider: str
    label: str | None = None
    key_hint: str | None = None
    is_active: bool
    is_valid: bool | None = None
    last_validated_at: datetime | None = None
    last_validation_error: str | None = None
    created_at: datetime


class ValidateKeyResponse(BaseModel):
    valid: bool | None = None
    validated_at: datetime
    error: str | None = None
    key_id: str
