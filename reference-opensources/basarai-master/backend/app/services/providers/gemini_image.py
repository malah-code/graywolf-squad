import base64
import logging

from google import genai
from google.genai import types as genai_types

from app.services.providers.base import ProviderError, ProviderResult

logger = logging.getLogger(__name__)


def gemini_generate(
    *,
    api_key: str,
    prompt: str,
    aspect_ratio: str,
    model: str,
) -> ProviderResult:
    logger.info("gemini_generate: model=%s aspect_ratio=%s", model, aspect_ratio)
    client = genai.Client(
        api_key=api_key,
        http_options=genai_types.HttpOptions(timeout=120000),
    )
    response = client.models.generate_content(
        model=model,
        contents=[prompt],
        config=genai_types.GenerateContentConfig(
            response_modalities=["Image"],
            image_config=genai_types.ImageConfig(
                aspect_ratio=aspect_ratio,
                image_size="2K",
            ),
        ),
    )

    try:
        candidates = response.candidates or []
        parts = candidates[0].content.parts if candidates else []
    except (AttributeError, IndexError):
        parts = []

    for part in parts:
        inline = getattr(part, "inline_data", None)
        if inline is not None and getattr(inline, "data", None):
            data = inline.data
            if isinstance(data, bytes):
                image_bytes = data
            else:
                image_bytes = base64.b64decode(data)
            return ProviderResult(
                image_bytes=image_bytes,
                request_id=getattr(response, "response_id", None),
            )

    raise ProviderError(
        "EMPTY_RESPONSE",
        "The provider returned no image. Please try again.",
    )
