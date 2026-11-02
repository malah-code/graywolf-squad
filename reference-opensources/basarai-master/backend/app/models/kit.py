import re
from datetime import datetime
from enum import Enum

from pydantic import BaseModel, field_validator

from app.services.kit_summary import KitStatusEnum


class ToneEnum(str, Enum):
    formal = "formal"
    casual = "casual"
    playful = "playful"
    professional = "professional"
    friendly = "friendly"


class KitAnswers(BaseModel):
    tagline: str | None = None
    tone: ToneEnum | None = None
    audience: str | None = None
    colors: list[str] = []
    avoid_words: str | None = None

    @field_validator("tagline")
    @classmethod
    def validate_tagline(cls, v: str | None) -> str | None:
        if v is None:
            return None
        v = v.strip()
        if not v:
            return None
        if len(v) > 160:
            raise ValueError("Tagline must be 160 characters or less")
        return v

    @field_validator("audience")
    @classmethod
    def validate_audience(cls, v: str | None) -> str | None:
        if v is None:
            return None
        v = v.strip()
        if not v:
            return None
        if len(v) < 2:
            raise ValueError("Audience must be at least 2 characters")
        if len(v) > 500:
            raise ValueError("Audience must be 500 characters or less")
        return v

    @field_validator("colors")
    @classmethod
    def validate_colors(cls, v: list[str]) -> list[str]:
        if len(v) > 3:
            raise ValueError("At most 3 colors are allowed")
        result = []
        for item in v:
            if not re.match(r"^#[0-9A-Fa-f]{6}$", item):
                raise ValueError(f"Invalid hex color: {item}")
            result.append(item.upper())
        return result

    @field_validator("avoid_words")
    @classmethod
    def validate_avoid_words(cls, v: str | None) -> str | None:
        if v is None:
            return None
        v = v.strip()
        if not v:
            return None
        if len(v) > 500:
            raise ValueError("Avoid words must be 500 characters or less")
        return v


class UpsertKitRequest(BaseModel):
    answers: KitAnswers


class KitResponse(BaseModel):
    brand_id: str
    brand_name: str
    answers: KitAnswers
    summary: str | None = None
    status: KitStatusEnum
    completed_at: datetime | None = None
    updated_at: datetime | None = None
