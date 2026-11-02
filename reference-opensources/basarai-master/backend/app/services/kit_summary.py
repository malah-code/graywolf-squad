from enum import Enum


class KitStatusEnum(str, Enum):
    not_started = "not_started"
    in_progress = "in_progress"
    complete = "complete"


def derive_status(
    tagline: str | None,
    tone: str | None,
    audience: str | None,
    colors: list[str],
    avoid_words: str | None,
) -> KitStatusEnum:
    if tone is not None and audience is not None and len(colors) >= 1:
        return KitStatusEnum.complete
    if (
        tagline is None
        and tone is None
        and audience is None
        and len(colors) == 0
        and avoid_words is None
    ):
        return KitStatusEnum.not_started
    return KitStatusEnum.in_progress


def derive_summary(
    brand_name: str,
    tagline: str | None,
    tone: str | None,
    audience: str | None,
    colors: list[str],
    avoid_words: str | None,
) -> str | None:
    if (
        tagline is None
        and tone is None
        and audience is None
        and len(colors) == 0
        and avoid_words is None
    ):
        return None
    lines = [
        f"Brand: {brand_name}",
        f"Tagline: {tagline or 'None specified'}",
        f"Tone: {tone or 'None specified'}",
        f"Audience: {audience or 'None specified'}",
        f"Colors: {', '.join(colors) if colors else 'None specified'}",
        f"Avoid: {avoid_words or 'None specified'}",
    ]
    return "\n".join(lines)
