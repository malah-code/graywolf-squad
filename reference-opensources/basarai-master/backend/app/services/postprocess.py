import io

from PIL import Image


def resize_to_preset(
    image_bytes: bytes, target_width: int, target_height: int
) -> bytes:
    image = Image.open(io.BytesIO(image_bytes))
    if image.mode not in ("RGB", "RGBA"):
        image = image.convert("RGBA" if "A" in image.mode else "RGB")

    img_w, img_h = image.size
    scale = max(target_width / img_w, target_height / img_h)
    new_w = int(round(img_w * scale))
    new_h = int(round(img_h * scale))
    image = image.resize((new_w, new_h), Image.Resampling.LANCZOS)

    left = (new_w - target_width) // 2
    top = (new_h - target_height) // 2
    image = image.crop((left, top, left + target_width, top + target_height))

    out = io.BytesIO()
    image.save(out, format="PNG")
    return out.getvalue()
