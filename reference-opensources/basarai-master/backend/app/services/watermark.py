import io

from PIL import Image

WATERMARK_SCALE = 0.15
WATERMARK_OPACITY = 0.70
WATERMARK_MARGIN_PX = 20


def apply_watermark(image_bytes: bytes, logo_bytes: bytes) -> bytes:
    base = Image.open(io.BytesIO(image_bytes)).convert("RGBA")
    logo = Image.open(io.BytesIO(logo_bytes)).convert("RGBA")

    max_logo_w = max(1, round(base.width * WATERMARK_SCALE))
    max_logo_h = max(1, base.height - (2 * WATERMARK_MARGIN_PX))
    scale = min(max_logo_w / logo.width, max_logo_h / logo.height)
    target_logo_w = max(1, round(logo.width * scale))
    target_logo_h = max(1, round(logo.height * scale))
    logo = logo.resize(
        (target_logo_w, target_logo_h), Image.Resampling.LANCZOS
    )

    r, g, b, a = logo.split()
    a = a.point(lambda px: int(px * WATERMARK_OPACITY))
    logo = Image.merge("RGBA", (r, g, b, a))

    x = base.width - target_logo_w - WATERMARK_MARGIN_PX
    y = base.height - target_logo_h - WATERMARK_MARGIN_PX
    base.alpha_composite(logo, dest=(x, y))

    out = io.BytesIO()
    base.convert("RGB").save(out, format="PNG")
    return out.getvalue()
