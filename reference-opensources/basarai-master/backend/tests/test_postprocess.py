import io

from PIL import Image

from app.services.postprocess import resize_to_preset
from app.services.presets import PLATFORM_PRESETS


def _make_image(width: int, height: int, color: tuple[int, int, int] = (255, 0, 0)) -> bytes:
    image = Image.new("RGB", (width, height), color)
    out = io.BytesIO()
    image.save(out, format="PNG")
    return out.getvalue()


def test_resize_same_aspect_downscales_correctly():
    src = _make_image(2048, 2048)
    result = resize_to_preset(src, 1080, 1080)
    out = Image.open(io.BytesIO(result))
    assert out.size == (1080, 1080)


def test_resize_wider_source_crops_to_square():
    src = _make_image(2000, 1000)
    result = resize_to_preset(src, 1080, 1080)
    out = Image.open(io.BytesIO(result))
    assert out.size == (1080, 1080)


def test_resize_taller_source_crops_to_square():
    src = _make_image(1000, 2000)
    result = resize_to_preset(src, 1080, 1080)
    out = Image.open(io.BytesIO(result))
    assert out.size == (1080, 1080)


def test_resize_tiny_source_upscales():
    src = _make_image(100, 100)
    result = resize_to_preset(src, 1080, 1080)
    out = Image.open(io.BytesIO(result))
    assert out.size == (1080, 1080)


def test_resize_every_preset_reaches_exact_dimensions():
    src = _make_image(1024, 1024)
    for key, (target_w, target_h, _label) in PLATFORM_PRESETS.items():
        result = resize_to_preset(src, target_w, target_h)
        out = Image.open(io.BytesIO(result))
        assert out.size == (target_w, target_h), f"{key} produced {out.size}"


def test_resize_output_is_png():
    src = _make_image(2000, 2000)
    result = resize_to_preset(src, 1080, 1080)
    assert Image.open(io.BytesIO(result)).format == "PNG"
