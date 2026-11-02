from app.services.prompt_composer import (
    BrandContext,
    PlatformContext,
    PLATFORM_NOTES,
    TONE_STYLE_MAP,
    compose_full_prompt,
)
from app.services.presets import PLATFORM_PRESETS

USER_PROMPT = "A modern minimal office"

SAMPLE_BRAND = BrandContext(
    name="Acme",
    tagline="Build the future",
    tone="professional",
    audience="startup founders aged 25-40",
    colors=["#1E3A8A", "#3B82F6"],
    avoid_words="cheap, discount, budget",
)

SAMPLE_PLATFORM = PlatformContext(
    label="Instagram Post",
    width=1080,
    height=1080,
    aspect_ratio="1:1",
    note="Square 1:1 format. Design should work as a grid tile — keep key content centered.",
)


# --- Section ordering ---


def test_system_role_is_first():
    result = compose_full_prompt(
        user_prompt=USER_PROMPT,
        brand_context=None,
        platform=SAMPLE_PLATFORM,
        logo_mode="none",
        brand_has_logo=False,
    )
    assert result.startswith("You are a professional social media image designer.")


def test_section_ordering_full():
    result = compose_full_prompt(
        user_prompt=USER_PROMPT,
        brand_context=SAMPLE_BRAND,
        platform=SAMPLE_PLATFORM,
        logo_mode="prompt",
        brand_has_logo=True,
    )
    brand_idx = result.index("=== BRAND IDENTITY ===")
    composition_idx = result.index("=== COMPOSITION ===")
    logo_idx = result.index("=== LOGO ===")
    request_idx = result.index("=== IMAGE REQUEST ===")
    assert brand_idx < composition_idx < logo_idx < request_idx


def test_user_request_is_last():
    result = compose_full_prompt(
        user_prompt=USER_PROMPT,
        brand_context=SAMPLE_BRAND,
        platform=SAMPLE_PLATFORM,
        logo_mode="none",
        brand_has_logo=False,
    )
    assert result.endswith(f"=== IMAGE REQUEST ===\n{USER_PROMPT}")


# --- Brand context ---


def test_no_brand_context_omits_brand_section():
    result = compose_full_prompt(
        user_prompt=USER_PROMPT,
        brand_context=None,
        platform=SAMPLE_PLATFORM,
        logo_mode="none",
        brand_has_logo=False,
    )
    assert "BRAND IDENTITY" not in result


def test_full_brand_context_includes_all_fields():
    result = compose_full_prompt(
        user_prompt=USER_PROMPT,
        brand_context=SAMPLE_BRAND,
        platform=SAMPLE_PLATFORM,
        logo_mode="none",
        brand_has_logo=False,
    )
    assert "Brand: Acme" in result
    assert 'Tagline: "Build the future"' in result
    assert "Visual style:" in result
    assert "Target audience: startup founders aged 25-40" in result
    assert "Brand colors: #1E3A8A, #3B82F6" in result
    assert "AVOID" in result
    assert "cheap, discount, budget" in result


def test_partial_brand_context_omits_null_fields():
    partial = BrandContext(name="MiniBrand", tone="casual", audience="teens", colors=["#FF0000"])
    result = compose_full_prompt(
        user_prompt=USER_PROMPT,
        brand_context=partial,
        platform=SAMPLE_PLATFORM,
        logo_mode="none",
        brand_has_logo=False,
    )
    assert "Brand: MiniBrand" in result
    assert "Tagline" not in result
    assert "AVOID" not in result
    assert "Visual style:" in result
    assert "Target audience: teens" in result


def test_no_none_specified_in_output():
    partial = BrandContext(name="TestBrand")
    result = compose_full_prompt(
        user_prompt=USER_PROMPT,
        brand_context=partial,
        platform=SAMPLE_PLATFORM,
        logo_mode="none",
        brand_has_logo=False,
    )
    assert "None specified" not in result
    assert "None" not in result.split("=== BRAND IDENTITY ===")[1].split("=== PLATFORM ===")[0]


# --- Tone mapping ---


def test_each_tone_maps_to_style():
    for tone, expected_style in TONE_STYLE_MAP.items():
        ctx = BrandContext(name="T", tone=tone, audience="x", colors=["#000"])
        result = compose_full_prompt(
            user_prompt=USER_PROMPT,
            brand_context=ctx,
            platform=SAMPLE_PLATFORM,
            logo_mode="none",
            brand_has_logo=False,
        )
        assert expected_style in result, f"tone={tone} style not found"


# --- Platform context ---


def test_platform_always_present():
    result = compose_full_prompt(
        user_prompt=USER_PROMPT,
        brand_context=None,
        platform=SAMPLE_PLATFORM,
        logo_mode="none",
        brand_has_logo=False,
    )
    assert "=== COMPOSITION ===" in result
    assert "grid tile" in result


def test_platform_label_and_dimensions_not_leaked_to_prompt():
    # Prevents Gemini from rendering platform metadata as on-canvas text.
    # See: regression where "Facebook Post" + "1200x630 landscape" appeared
    # as a header/subtitle on generated images.
    result = compose_full_prompt(
        user_prompt=USER_PROMPT,
        brand_context=None,
        platform=SAMPLE_PLATFORM,
        logo_mode="none",
        brand_has_logo=False,
    )
    assert "Instagram Post" not in result
    assert "1080x1080" not in result
    assert "Platform:" not in result


def test_platform_notes_cover_all_presets():
    for preset_id in PLATFORM_PRESETS:
        assert preset_id in PLATFORM_NOTES, f"Missing PLATFORM_NOTES entry for {preset_id}"


# --- Logo mode ---


def test_logo_prompt_mode_with_logo():
    result = compose_full_prompt(
        user_prompt=USER_PROMPT,
        brand_context=None,
        platform=SAMPLE_PLATFORM,
        logo_mode="prompt",
        brand_has_logo=True,
    )
    assert "=== LOGO ===" in result
    assert "corner" in result


def test_logo_prompt_mode_without_logo():
    result = compose_full_prompt(
        user_prompt=USER_PROMPT,
        brand_context=None,
        platform=SAMPLE_PLATFORM,
        logo_mode="prompt",
        brand_has_logo=False,
    )
    assert "LOGO" not in result


def test_logo_watermark_mode_never_in_prompt():
    result = compose_full_prompt(
        user_prompt=USER_PROMPT,
        brand_context=None,
        platform=SAMPLE_PLATFORM,
        logo_mode="watermark",
        brand_has_logo=True,
    )
    assert "LOGO" not in result


def test_logo_both_mode_with_logo():
    result = compose_full_prompt(
        user_prompt=USER_PROMPT,
        brand_context=None,
        platform=SAMPLE_PLATFORM,
        logo_mode="both",
        brand_has_logo=True,
    )
    assert "=== LOGO ===" in result


def test_logo_both_mode_without_logo():
    result = compose_full_prompt(
        user_prompt=USER_PROMPT,
        brand_context=None,
        platform=SAMPLE_PLATFORM,
        logo_mode="both",
        brand_has_logo=False,
    )
    assert "LOGO" not in result


def test_logo_none_mode():
    result = compose_full_prompt(
        user_prompt=USER_PROMPT,
        brand_context=None,
        platform=SAMPLE_PLATFORM,
        logo_mode="none",
        brand_has_logo=True,
    )
    assert "LOGO" not in result
