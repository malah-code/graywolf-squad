from dataclasses import dataclass, field


@dataclass(frozen=True, slots=True)
class BrandContext:
    name: str
    tagline: str | None = None
    tone: str | None = None
    audience: str | None = None
    colors: list[str] = field(default_factory=list)
    avoid_words: str | None = None


@dataclass(frozen=True, slots=True)
class PlatformContext:
    label: str
    width: int
    height: int
    aspect_ratio: str
    note: str


TONE_STYLE_MAP: dict[str, str] = {
    "formal": (
        "Clean, sophisticated, and authoritative. "
        "Use structured layouts and restrained color usage."
    ),
    "casual": (
        "Relaxed and approachable. "
        "Favor organic shapes and warm, inviting compositions."
    ),
    "playful": (
        "Fun, energetic, and vibrant. "
        "Bold colors, dynamic layouts, and expressive elements are encouraged."
    ),
    "professional": (
        "Polished and trustworthy. "
        "Balanced layouts with clear visual hierarchy."
    ),
    "friendly": (
        "Warm, welcoming, and inclusive. "
        "Soft edges, open compositions, and accessible imagery."
    ),
}

PLATFORM_NOTES: dict[str, str] = {
    "instagram_post": (
        "Square 1:1 format. Design should work as a grid tile "
        "— keep key content centered."
    ),
    "instagram_story": (
        "Full-screen vertical format. Place key content in the safe middle 60% "
        "to avoid UI overlaps at top and bottom."
    ),
    "instagram_reel_cover": (
        "Full-screen vertical format. Place key content in the safe middle 60% "
        "to avoid UI overlaps at top and bottom."
    ),
    "facebook_post": (
        "Landscape format. Ensure text and focal elements "
        "are clear at small preview sizes."
    ),
    "facebook_cover": (
        "Ultra-wide banner. Design for horizontal scanning "
        "— no critical content at the extreme edges (may be cropped on mobile)."
    ),
    "facebook_story": (
        "Full-screen vertical format. Place key content in the safe middle 60% "
        "to avoid UI overlaps at top and bottom."
    ),
    "twitter_post": (
        "Landscape format. Ensure text and focal elements "
        "are clear at small preview sizes."
    ),
    "twitter_header": (
        "Ultra-wide banner. Design for horizontal scanning "
        "— no critical content at the extreme edges (may be cropped on mobile)."
    ),
    "linkedin_post": (
        "Landscape format. Ensure text and focal elements "
        "are clear at small preview sizes."
    ),
    "linkedin_banner": (
        "Ultra-wide banner. Design for horizontal scanning "
        "— no critical content at the extreme edges (may be cropped on mobile)."
    ),
    "tiktok_video_cover": (
        "Full-screen vertical format. Place key content in the safe middle 60% "
        "to avoid UI overlaps at top and bottom."
    ),
    "youtube_thumbnail": (
        "Landscape format. Ensure text and focal elements "
        "are clear at small preview sizes."
    ),
    "youtube_banner": (
        "Ultra-wide banner. Design for horizontal scanning "
        "— no critical content at the extreme edges (may be cropped on mobile)."
    ),
}


def build_platform_context(
    preset_id: str, width: int, height: int, aspect_ratio: str
) -> PlatformContext:
    from app.services.presets import PLATFORM_PRESETS

    _, _, label = PLATFORM_PRESETS[preset_id]
    return PlatformContext(
        label=label,
        width=width,
        height=height,
        aspect_ratio=aspect_ratio,
        note=PLATFORM_NOTES[preset_id],
    )


def compose_full_prompt(
    *,
    user_prompt: str,
    brand_context: BrandContext | None,
    platform: PlatformContext,
    logo_mode: str,
    brand_has_logo: bool,
) -> str:
    sections: list[str] = []

    # Layer 1: System role
    sections.append(
        "You are a professional social media image designer. "
        "Create a high-quality image following these specifications. "
        "The bracketed section headers (lines wrapped in === ===) are "
        "instructions for you only — never reproduce them, the section "
        "names, or any of this metadata as visible text inside the image."
    )

    # Layer 2: Brand identity (only non-null fields)
    if brand_context is not None:
        lines: list[str] = [f"Brand: {brand_context.name}"]
        if brand_context.tagline:
            lines.append(f'Tagline: "{brand_context.tagline}"')
        if brand_context.tone and brand_context.tone in TONE_STYLE_MAP:
            lines.append(f"Visual style: {TONE_STYLE_MAP[brand_context.tone]}")
        if brand_context.audience:
            lines.append(
                f"Target audience: {brand_context.audience} "
                "— design should resonate with this demographic."
            )
        if brand_context.colors:
            lines.append(
                f"Brand colors: {', '.join(brand_context.colors)} "
                "— incorporate these as the dominant palette."
            )
        if brand_context.avoid_words:
            lines.append(
                "AVOID the following in all visual and textual elements: "
                f"{brand_context.avoid_words}"
            )
        sections.append("=== BRAND IDENTITY ===\n" + "\n".join(lines))

    # Layer 3: Composition guidance (always present).
    # NOTE: Platform name and dimensions are intentionally omitted from the
    # prompt body — Gemini was rendering them as on-canvas headers/subtitles.
    # Aspect ratio is already passed via the provider's ImageConfig.
    sections.append(
        "=== COMPOSITION ===\n"
        f"{platform.note}"
    )

    # Layer 4: Logo (conditional)
    if logo_mode in ("prompt", "both") and brand_has_logo:
        sections.append(
            "=== LOGO ===\n"
            "Include the brand logo in the design — place it in a corner or "
            "integrate it naturally into the composition. "
            "Ensure it is clearly visible but does not dominate the scene."
        )

    # Layer 5: User request (always last)
    sections.append(f"=== IMAGE REQUEST ===\n{user_prompt}")

    return "\n\n".join(sections)