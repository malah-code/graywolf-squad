from datetime import datetime
from enum import Enum
from typing import Literal

from pydantic import BaseModel, Field, field_validator


class ProviderEnum(str, Enum):
    openai = "openai"
    gemini = "gemini"


class LogoModeEnum(str, Enum):
    none = "none"
    prompt = "prompt"
    watermark = "watermark"
    both = "both"


class GenerationStatusEnum(str, Enum):
    pending = "pending"
    processing = "processing"
    succeeded = "succeeded"
    failed = "failed"


class PlatformPresetEnum(str, Enum):
    instagram_post = "instagram_post"
    instagram_story = "instagram_story"
    instagram_reel_cover = "instagram_reel_cover"
    facebook_post = "facebook_post"
    facebook_cover = "facebook_cover"
    facebook_story = "facebook_story"
    twitter_post = "twitter_post"
    twitter_header = "twitter_header"
    linkedin_post = "linkedin_post"
    linkedin_banner = "linkedin_banner"
    tiktok_video_cover = "tiktok_video_cover"
    youtube_thumbnail = "youtube_thumbnail"
    youtube_banner = "youtube_banner"


class GenerateRequest(BaseModel):
    prompt: str = Field(..., min_length=3, max_length=4000)
    provider: ProviderEnum
    platform_preset: PlatformPresetEnum
    logo_mode: LogoModeEnum = LogoModeEnum.none

    @field_validator("prompt")
    @classmethod
    def strip_prompt(cls, v: str) -> str:
        v = v.strip()
        if len(v) < 3:
            raise ValueError("Prompt must be at least 3 characters after trimming")
        if len(v) > 4000:
            raise ValueError("Prompt must be at most 4000 characters after trimming")
        return v


class GenerationResponse(BaseModel):
    id: str
    prompt: str
    provider: ProviderEnum
    model: str
    platform_preset: PlatformPresetEnum
    width: int
    height: int
    logo_mode: LogoModeEnum
    status: GenerationStatusEnum
    image_url: str | None
    download_filename: str | None
    error_code: str | None
    error_message: str | None
    created_at: datetime
    completed_at: datetime | None


class GenerationHistoryStatusEnum(str, Enum):
    succeeded = "succeeded"
    failed = "failed"


class GenerationHistoryItem(BaseModel):
    id: str
    prompt_excerpt: str
    provider: ProviderEnum
    model: str
    platform_preset: PlatformPresetEnum
    width: int
    height: int
    logo_mode: LogoModeEnum
    status: GenerationHistoryStatusEnum
    image_url: str | None
    error_message: str | None
    created_at: datetime
    completed_at: datetime | None


class GenerationHistoryPage(BaseModel):
    items: list[GenerationHistoryItem]
    next_cursor: str | None
    page_size: Literal[24]


class GenerationDetailResponse(BaseModel):
    id: str
    prompt: str
    provider: ProviderEnum
    model: str
    platform_preset: PlatformPresetEnum
    width: int
    height: int
    logo_mode: LogoModeEnum
    status: GenerationHistoryStatusEnum
    provider_request_id: str | None
    image_url: str | None
    download_filename: str | None
    error_code: str | None
    error_message: str | None
    created_at: datetime
    completed_at: datetime | None
