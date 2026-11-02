import re
from datetime import datetime, timezone

PLATFORM_PRESETS: dict[str, tuple[int, int, str]] = {
    "instagram_post":       (1080, 1080, "Instagram Post"),
    "instagram_story":      (1080, 1920, "Instagram Story"),
    "instagram_reel_cover": (1080, 1920, "Instagram Reel Cover"),
    "facebook_post":        (1200,  630, "Facebook Post"),
    "facebook_cover":       ( 820,  312, "Facebook Cover"),
    "facebook_story":       (1080, 1920, "Facebook Story"),
    "twitter_post":         (1200,  675, "Twitter Post"),
    "twitter_header":       (1500,  500, "Twitter Header"),
    "linkedin_post":        (1200,  627, "LinkedIn Post"),
    "linkedin_banner":      (1584,  396, "LinkedIn Banner"),
    "tiktok_video_cover":   (1080, 1920, "TikTok Video Cover"),
    "youtube_thumbnail":    (1280,  720, "YouTube Thumbnail"),
    "youtube_banner":       (2560, 1440, "YouTube Banner"),
}

PRESET_TO_ASPECT_RATIO: dict[str, str] = {
    "instagram_post":       "1:1",
    "instagram_story":      "9:16",
    "instagram_reel_cover": "9:16",
    "facebook_story":       "9:16",
    "tiktok_video_cover":   "9:16",
    "facebook_post":        "16:9",
    "twitter_post":         "16:9",
    "linkedin_post":        "16:9",
    "youtube_thumbnail":    "16:9",
    "twitter_header":       "16:9",
    "facebook_cover":       "16:9",
    "linkedin_banner":      "16:9",
    "youtube_banner":       "16:9",
}

MODEL_FOR_PROVIDER: dict[str, str] = {
    "openai": "gpt-image-2",
    "gemini": "gemini-3-pro-image-preview",
}

_BRAND_NAME_NON_ALNUM = re.compile(r"[^a-z0-9]+")


def sanitize_brand_name(raw: str) -> str:
    cleaned = _BRAND_NAME_NON_ALNUM.sub("-", raw.lower()).strip("-")
    if not cleaned:
        return "brand"
    truncated = cleaned[:40].rstrip("-")
    return truncated or "brand"


def build_download_filename(
    brand_name: str, preset_identifier: str, completed_at: datetime
) -> str:
    ts = completed_at.astimezone(timezone.utc).strftime("%Y%m%d-%H%M%S")
    return f"{sanitize_brand_name(brand_name)}-{preset_identifier}-{ts}.png"
