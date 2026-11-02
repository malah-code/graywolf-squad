import io

from PIL import Image

from app.services.watermark import WATERMARK_MARGIN_PX, WATERMARK_SCALE, apply_watermark


def _solid_rgb(w: int, h: int, color: tuple[int, int, int]) -> bytes:
    out = io.BytesIO()
    Image.new("RGB", (w, h), color).save(out, format="PNG")
    return out.getvalue()


def _solid_rgba_logo(w: int, h: int) -> bytes:
    out = io.BytesIO()
    Image.new("RGBA", (w, h), (0, 255, 0, 255)).save(out, format="PNG")
    return out.getvalue()


def test_watermark_output_same_base_size():
    base = _solid_rgb(1080, 1080, (255, 0, 0))
    logo = _solid_rgba_logo(200, 200)
    result = apply_watermark(base, logo)
    out = Image.open(io.BytesIO(result))
    assert out.size == (1080, 1080)


def test_watermark_output_is_png():
    base = _solid_rgb(1080, 1080, (255, 0, 0))
    logo = _solid_rgba_logo(200, 200)
    result = apply_watermark(base, logo)
    assert Image.open(io.BytesIO(result)).format == "PNG"


def test_watermark_modifies_bottom_right_region():
    base = _solid_rgb(1080, 1080, (255, 0, 0))
    logo = _solid_rgba_logo(400, 400)
    result = apply_watermark(base, logo)
    out = Image.open(io.BytesIO(result)).convert("RGB")

    assert out.getpixel((10, 10)) == (255, 0, 0)

    logo_w = int(round(1080 * WATERMARK_SCALE))
    cx = 1080 - WATERMARK_MARGIN_PX - logo_w // 2
    cy = 1080 - WATERMARK_MARGIN_PX - logo_w // 2
    pixel = out.getpixel((cx, cy))
    assert pixel != (255, 0, 0)
    assert pixel[1] > pixel[0]


def test_watermark_margin_is_20_px():
    base = _solid_rgb(1080, 1080, (255, 0, 0))
    logo = _solid_rgba_logo(400, 400)
    result = apply_watermark(base, logo)
    out = Image.open(io.BytesIO(result)).convert("RGB")

    assert out.getpixel((1079, 1079)) == (255, 0, 0)
