---
description: "Task list for Image Generation implementation"
---

# Tasks: Image Generation

**Input**: Design documents from `/specs/006-generation/`
**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/generate-api.md](./contracts/generate-api.md), [quickstart.md](./quickstart.md)

**Organization**: Tasks are grouped by user story to enable phase-by-phase review.

---

## Phase Execution Rules (READ FIRST)

- Complete phases strictly in order: Phase 1 → Phase 2 → Phase 3 → Phase 4 → Phase 5 → Phase 6 → Phase 7
- **STOP at each "PHASE REVIEW CHECKPOINT"** and wait for review before starting the next phase
- Each task gives you the full context you need: exact file path, code shape, patterns to copy from existing files
- **When copying patterns from existing files, read them first with the Read tool — don't guess**
- Use the **Edit tool** for modifications and the **Write tool** only for NEW files that don't exist yet
- All file paths below are relative to the repo root (e.g., `backend/app/routers/generations.py`)
- **Never invent preset identifiers, error codes, enum values, or dimensions.** The spec's Reference Tables A/B/C, the contract's error code table, and this tasks file are the only source of truth — if something is not in those, stop and ask
- **Provider keys MUST NEVER appear in logs, responses, or frontend state** (Constitution §II Non-Negotiable). If you are about to log or return something that might contain a key, stop
- This phase touches **the `generations` table only** — no new DB migrations, no new columns, no new bucket policies

---

## Phase 1: Setup

**Purpose**: Verify the working branch and environment are ready. Read the existing patterns you will mirror. No code changes.

### T001 — Verify branch + read existing patterns

- [x] T001 Run `git branch --show-current` and verify the output is exactly `006-generation`. If not, STOP and ask the reviewer. Then **read these files in full** with the Read tool to understand the patterns you will mirror in later tasks (do NOT modify them in T001):
  1. `backend/app/routers/keys.py` — router + helpers pattern (`_error_response`, `_get_brand_or_404`, prefix shape, `Depends(get_current_user)`, `UUID` path params, error envelope)
  2. `backend/app/routers/brands.py` — Supabase Storage usage pattern (`client.storage.from_(settings.STORAGE_BUCKET).upload(...)`, download, remove) and the `_build_logo_url` helper
  3. `backend/app/services/provider_validation.py` — existing async `httpx` call pattern for OpenAI/Gemini (we will mirror this for the image endpoints)
  4. `backend/app/core/vault.py` — the three Vault RPC wrappers (`store_secret`, `read_secret`, `delete_secret`) — you will use `read_secret` in T013
  5. `backend/app/services/kit_summary.py` — pure-utility service module style (no FastAPI imports) you will mirror in T002–T006
  6. `backend/app/main.py` — how existing routers are registered (you will add one line in T014)
  7. `frontend/app/(dashboard)/[brandId]/layout.tsx` — the existing `ensureBrandAccess` helper returns a `Brand` object with `logo_url` and `name`; T028 will read from the same endpoint
  8. `frontend/app/(dashboard)/[brandId]/kit/page.tsx` — client-page pattern you will mirror for the generator page in T028
  9. `frontend/lib/api.ts` — the `apiRequest<T>` helper you will use from hooks
  10. `frontend/components/kit/kit-wizard.tsx` — client-component state + useState + submit pattern (for reference only — do NOT copy wizard-specific logic)

Report: a one-line confirmation that you read all 10 files and are ready for Phase 2.

### 🛑 PHASE 1 REVIEW CHECKPOINT

Report: "Phase 1 complete — branch verified, 10 reference files read." Then STOP for review.

---

## Phase 2: Foundational (Backend API)

**Purpose**: Build the entire backend generation pipeline. This phase delivers a fully working `POST /brands/{brand_id}/generate` endpoint with unit tests for every pure service module.

**⚠️ CRITICAL**: No frontend work (Phase 3+) may begin until this phase is complete and reviewed.

### T002 — Add google-genai dependency

- [x] T002 Modify `backend/requirements.txt`. Append this single new line at the end of the file:

    ```text
    google-genai>=1.0.0
    ```

    Do NOT touch any other line. Then run `cd backend && pip install -r requirements.txt` (or the project's equivalent venv activation + install) and report the final installed version of `google-genai`. If install fails, STOP and report the error.

### T003 — Create presets service (PLATFORM_PRESETS + PRESET_TO_ASPECT_RATIO + filename helpers)

- [x] T003 Create NEW file `backend/app/services/presets.py`. Pure utility module — no FastAPI, no DB, no HTTP. Requirements:

    **Imports (exact):**
    ```python
    import re
    from datetime import datetime, timezone
    ```

    **Constant `PLATFORM_PRESETS`** — dict of exactly 13 entries, keys are the preset identifiers from the spec's Reference Table A, values are `(width: int, height: int, label: str)` tuples:
    ```python
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
    ```

    **Constant `PRESET_TO_ASPECT_RATIO`** — dict mapping each preset identifier to its Gemini aspect ratio string, from Reference Table C:
    ```python
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
    ```

    **Constant `MODEL_FOR_PROVIDER`** — the fixed model per provider (FR-004):
    ```python
    MODEL_FOR_PROVIDER: dict[str, str] = {
        "openai": "gpt-image-1.5",
        "gemini": "gemini-3-pro-image-preview",
    }
    ```

    **Module-level regex** for filename sanitization (FR-034):
    ```python
    _BRAND_NAME_NON_ALNUM = re.compile(r"[^a-z0-9]+")
    ```

    **Function `sanitize_brand_name(raw: str) -> str`** — implement FR-034 sanitization rules exactly:
    ```python
    def sanitize_brand_name(raw: str) -> str:
        """FR-034: lowercase → non-[a-z0-9] → '-' → collapse → trim → max 40 chars → fallback 'brand'."""
        cleaned = _BRAND_NAME_NON_ALNUM.sub("-", raw.lower()).strip("-")
        if not cleaned:
            return "brand"
        truncated = cleaned[:40].rstrip("-")
        return truncated or "brand"
    ```

    **Function `build_download_filename(brand_name: str, preset_identifier: str, completed_at: datetime) -> str`**:
    ```python
    def build_download_filename(
        brand_name: str, preset_identifier: str, completed_at: datetime
    ) -> str:
        """FR-034: `{sanitized-brand-name}-{preset}-{YYYYMMDD-HHmmss}.png` in UTC."""
        ts = completed_at.astimezone(timezone.utc).strftime("%Y%m%d-%H%M%S")
        return f"{sanitize_brand_name(brand_name)}-{preset_identifier}-{ts}.png"
    ```

    > **DO NOT** invent alternative preset keys or aspect ratios. The spec's Reference Tables A and C are the only source of truth. The order of entries does not matter, but the key set and values must match exactly. **T010, T012, T013 all import from this module.**

### T004 — Create prompt composer service

- [x] T004 Create NEW file `backend/app/services/prompt_composer.py`. Pure function, no imports other than standard library. Requirements:

    ```python
    def compose_full_prompt(
        *,
        user_prompt: str,
        brand_context_summary: str | None,
        logo_mode: str,
        brand_has_logo: bool,
    ) -> str:
        """
        Compose the full prompt sent to the provider.

        FR-014: prepend brand context summary if present (complete kit only; caller passes None otherwise).
        FR-015: append logo instruction only when logo_mode is 'prompt' or 'both' AND the brand has a logo.
        Order is ALWAYS: [brand_context_summary?] → [logo_instruction?] → user_prompt.
        """
        parts: list[str] = []
        if brand_context_summary:
            parts.append(f"Brand Context:\n{brand_context_summary}")
        if logo_mode in ("prompt", "both") and brand_has_logo:
            parts.append("Incorporate the brand logo naturally into the image.")
        parts.append(f"Image Request:\n{user_prompt}")
        return "\n\n".join(parts)
    ```

    > **Critical safety rule**: if `logo_mode='prompt'` but `brand_has_logo=False`, NO logo instruction is added — we must never tell the provider to "incorporate the brand logo" when no logo exists. This is asserted by T017.

### T005 — Create postprocess service

- [x] T005 Create NEW file `backend/app/services/postprocess.py`. Uses Pillow (already in `requirements.txt`). Requirements:

    **Imports (exact):**
    ```python
    import io
    from PIL import Image
    ```

    **Function `resize_to_preset(image_bytes, target_width, target_height) -> bytes`** — implement FR-018 scale-to-cover + center-crop:
    ```python
    def resize_to_preset(
        image_bytes: bytes, target_width: int, target_height: int
    ) -> bytes:
        """
        FR-018: scale the provider's image to cover (target_width, target_height),
        then center-crop to exactly those dimensions, and return PNG bytes.
        """
        image = Image.open(io.BytesIO(image_bytes))
        # Normalize to RGB or RGBA — some providers may return palette-mode images
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
    ```

    > **Do NOT change the resampling filter or the crop math**. T015 asserts that the returned PNG has dimensions exactly `(target_width, target_height)` for every preset in Reference Table A.

### T006 — Create watermark service

- [x] T006 Create NEW file `backend/app/services/watermark.py`. Implements FR-019 with **fixed** parameters. Requirements:

    **Imports (exact):**
    ```python
    import io
    from PIL import Image
    ```

    **Module-level constants** (FR-019):
    ```python
    WATERMARK_SCALE = 0.15       # 15% of image width
    WATERMARK_OPACITY = 0.70     # 70% alpha multiplier
    WATERMARK_MARGIN_PX = 20     # 20 px from right and bottom edges
    ```

    **Function `apply_watermark(image_bytes, logo_bytes) -> bytes`**:
    ```python
    def apply_watermark(image_bytes: bytes, logo_bytes: bytes) -> bytes:
        """
        FR-019: composite the brand logo onto the base image at the bottom-right
        corner, scaled to 15% of the base width, at 70% opacity, with a 20 px margin
        from both the right and bottom edges. Returns PNG bytes.
        """
        base = Image.open(io.BytesIO(image_bytes)).convert("RGBA")
        logo = Image.open(io.BytesIO(logo_bytes)).convert("RGBA")

        # Scale logo to 15% of base width, preserving aspect ratio
        target_logo_w = max(1, int(round(base.width * WATERMARK_SCALE)))
        ratio = target_logo_w / logo.width
        target_logo_h = max(1, int(round(logo.height * ratio)))
        logo = logo.resize(
            (target_logo_w, target_logo_h), Image.Resampling.LANCZOS
        )

        # Apply 70% opacity to the logo's alpha channel (Porter-Duff "over" compositing)
        r, g, b, a = logo.split()
        a = a.point(lambda px: int(px * WATERMARK_OPACITY))
        logo = Image.merge("RGBA", (r, g, b, a))

        # Bottom-right, 20 px margin from both edges
        x = base.width - target_logo_w - WATERMARK_MARGIN_PX
        y = base.height - target_logo_h - WATERMARK_MARGIN_PX
        base.alpha_composite(logo, dest=(x, y))

        # Flatten to RGB for the final PNG (we do not carry alpha through)
        out = io.BytesIO()
        base.convert("RGB").save(out, format="PNG")
        return out.getvalue()
    ```

    > **Use `alpha_composite`, not `paste`** — see research.md Decision 7. `paste` does not correctly handle semi-transparent overlays. This is asserted by T016.

### T007 — Create error mapping service

- [x] T007 Create NEW file `backend/app/services/error_mapping.py`. Pure function, no imports. Requirements:

    **Imports (exact):**
    ```python
    import httpx
    ```

    **Dict `ERROR_USER_MESSAGES`** — one message per error code from the contract (contracts/generate-api.md):
    ```python
    ERROR_USER_MESSAGES: dict[str, str] = {
        "INVALID_KEY":           "Your provider key was rejected. Please check your keys.",
        "RATE_LIMITED":          "The provider is currently rate-limiting your account. Please try again in a moment.",
        "CONTENT_POLICY":        "The provider refused this prompt due to its content policy. Please try a different description.",
        "TIMEOUT":               "The request took too long to complete. Please try again.",
        "NETWORK":               "Could not reach the provider. Please check your connection and try again.",
        "EMPTY_RESPONSE":        "The provider returned no image. Please try again.",
        "PROVIDER_CLIENT_ERROR": "The provider rejected this request. Please try again or adjust your prompt.",
        "PROVIDER_SERVER_ERROR": "The provider service is temporarily unavailable. Please try again.",
    }
    ```

    **Function `classify_provider_error(exc: Exception) -> tuple[str, str]`** — returns `(error_code, user_message)`:
    ```python
    def classify_provider_error(exc: Exception) -> tuple[str, str]:
        """
        Map a provider exception to a stable (error_code, user_message) tuple.
        Never returns the raw provider payload — always a human-friendly string.
        """
        # httpx timeout (network-level) — FR-031 handling in the router uses TIMEOUT directly
        if isinstance(exc, httpx.TimeoutException):
            return ("TIMEOUT", ERROR_USER_MESSAGES["TIMEOUT"])

        # httpx network errors (connect failure, DNS, reset, ...)
        if isinstance(exc, (httpx.ConnectError, httpx.ReadError, httpx.WriteError, httpx.RemoteProtocolError)):
            return ("NETWORK", ERROR_USER_MESSAGES["NETWORK"])

        # httpx HTTP-status errors — inspect the status code
        if isinstance(exc, httpx.HTTPStatusError):
            status = exc.response.status_code
            if status == 401:
                return ("INVALID_KEY", ERROR_USER_MESSAGES["INVALID_KEY"])
            if status == 429:
                return ("RATE_LIMITED", ERROR_USER_MESSAGES["RATE_LIMITED"])
            if status in (400, 422):
                # 400/422 are commonly used for content-policy blocks; inspect the
                # body for policy-related keywords before falling back to a generic
                # client error.
                body = exc.response.text.lower() if exc.response is not None else ""
                if "policy" in body or "safety" in body or "blocked" in body:
                    return ("CONTENT_POLICY", ERROR_USER_MESSAGES["CONTENT_POLICY"])
                return ("PROVIDER_CLIENT_ERROR", ERROR_USER_MESSAGES["PROVIDER_CLIENT_ERROR"])
            if 400 <= status < 500:
                return ("PROVIDER_CLIENT_ERROR", ERROR_USER_MESSAGES["PROVIDER_CLIENT_ERROR"])
            if 500 <= status < 600:
                return ("PROVIDER_SERVER_ERROR", ERROR_USER_MESSAGES["PROVIDER_SERVER_ERROR"])

        # Fallback — anything else that reached here is treated as a server-side provider failure
        return ("PROVIDER_SERVER_ERROR", ERROR_USER_MESSAGES["PROVIDER_SERVER_ERROR"])
    ```

    > **Do NOT** include the raw `exc` message in the returned user_message. The user-facing string must come from `ERROR_USER_MESSAGES` only. The router will log the raw exception separately via `logger.exception`.

### T008 — Create providers package scaffolding

- [x] T008 Create a NEW directory + two NEW files:

    1. `backend/app/services/providers/__init__.py` — completely empty file (creates the package).
    2. `backend/app/services/providers/base.py` — shared types:

        ```python
        from dataclasses import dataclass


        @dataclass
        class ProviderResult:
            """Raw image bytes and the provider's request id (for operational traceability)."""
            image_bytes: bytes
            request_id: str | None


        class ProviderError(Exception):
            """
            Raised by a provider wrapper when it cannot return a ProviderResult.

            Attributes:
                code: one of the error_code strings from services.error_mapping.ERROR_USER_MESSAGES
                user_message: the human-facing string; caller passes through to the API response
            """

            def __init__(self, code: str, user_message: str):
                super().__init__(user_message)
                self.code = code
                self.user_message = user_message
        ```

### T009 — Create OpenAI provider wrapper

- [x] T009 Create NEW file `backend/app/services/providers/openai_image.py`. Thin async wrapper around the official OpenAI image endpoint. Requirements:

    **Imports (exact):**
    ```python
    import base64
    import logging

    import httpx

    from app.services.providers.base import ProviderError, ProviderResult

    logger = logging.getLogger(__name__)
    ```

    **Module-level constant** for the endpoint URL (Constitution §II — official endpoints only):
    ```python
    OPENAI_IMAGES_URL = "https://api.openai.com/v1/images/generations"
    ```

    **Function `openai_generate(...)`** — async, uses `httpx.AsyncClient`:
    ```python
    async def openai_generate(
        *,
        api_key: str,
        prompt: str,
        width: int,
        height: int,
        model: str,
    ) -> ProviderResult:
        """
        Call OpenAI's /v1/images/generations endpoint and return the decoded image bytes.

        Timeout enforcement: the caller (router) wraps this coroutine in asyncio.wait_for(120).
        The httpx.Timeout below is a safety net at the transport level.
        """
        logger.info("openai_generate: model=%s size=%dx%d", model, width, height)
        async with httpx.AsyncClient(timeout=httpx.Timeout(120.0)) as client:
            response = await client.post(
                OPENAI_IMAGES_URL,
                headers={"Authorization": f"Bearer {api_key}"},
                json={
                    "model": model,
                    "prompt": prompt,
                    "size": f"{width}x{height}",
                    "response_format": "b64_json",
                    "n": 1,
                },
            )
            response.raise_for_status()
            data = response.json()

        try:
            b64 = data["data"][0]["b64_json"]
        except (KeyError, IndexError, TypeError):
            raise ProviderError(
                "EMPTY_RESPONSE",
                "The provider returned no image. Please try again.",
            )

        return ProviderResult(
            image_bytes=base64.b64decode(b64),
            request_id=response.headers.get("x-request-id"),
        )
    ```

    > **Do NOT** log `api_key`, `prompt`, or `data` — the `logger.info` line above is the only permitted log line in this function. **Do NOT** import the `openai` SDK — we use raw `httpx` per research.md Decision 2. **Do NOT** add retry logic — FR-032 mandates zero retries.

### T010 — Create Gemini provider wrapper

- [x] T010 Create NEW file `backend/app/services/providers/gemini_image.py`. Wraps the official `google-genai` SDK (see research.md Decision 1). Requirements:

    **Imports (exact):**
    ```python
    import base64
    import logging

    from google import genai
    from google.genai import types as genai_types

    from app.services.providers.base import ProviderError, ProviderResult

    logger = logging.getLogger(__name__)
    ```

    **Function `gemini_generate(...)`** — **synchronous** (the SDK is sync). The router will run it in a thread pool via `asyncio.to_thread`:

    ```python
    def gemini_generate(
        *,
        api_key: str,
        prompt: str,
        aspect_ratio: str,
        model: str,
    ) -> ProviderResult:
        """
        Call Gemini via the official google-genai SDK and return the decoded image bytes.

        This function is sync because the SDK is sync. The router wraps this call in
        asyncio.to_thread(...) inside asyncio.wait_for(..., timeout=120.0) to enforce
        FR-031 while keeping the event loop free.
        """
        logger.info("gemini_generate: model=%s aspect_ratio=%s", model, aspect_ratio)
        client = genai.Client(api_key=api_key)
        response = client.models.generate_content(
            model=model,
            contents=[prompt],
            config=genai_types.GenerateContentConfig(
                response_modalities=["Image"],
                image_config=genai_types.ImageConfig(
                    aspect_ratio=aspect_ratio,
                    image_size="1K",
                ),
            ),
        )

        # Response structure: response.candidates[0].content.parts[*].inline_data
        try:
            candidates = response.candidates or []
            parts = candidates[0].content.parts if candidates else []
        except (AttributeError, IndexError):
            parts = []

        for part in parts:
            inline = getattr(part, "inline_data", None)
            if inline is not None and getattr(inline, "data", None):
                data = inline.data
                # SDK may return bytes directly or a base64 string depending on transport
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
    ```

    > **Do NOT** log `api_key` or `prompt`. **Do NOT** add retry logic. **Do NOT** import `asyncio` here — the router handles timeout and threading. **Do NOT** use a different model or image_size — those are fixed per FR-004 and research.md.

### T011 — Create generation Pydantic models

- [x] T011 Create NEW file `backend/app/models/generation.py`. Read `backend/app/models/provider_key.py` first for the style. Requirements:

    **Imports (exact):**
    ```python
    from datetime import datetime
    from enum import Enum

    from pydantic import BaseModel, Field, field_validator
    ```

    **Enums:**
    ```python
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
    ```

    **Request model `GenerateRequest`:**
    ```python
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
    ```

    **Response model `GenerationResponse`:**
    ```python
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
    ```

    > **Do NOT add a `model` field to `GenerateRequest`.** Per FR-004, the model is resolved server-side from the provider — the client never sends it. The response echoes the resolved model (populated from `MODEL_FOR_PROVIDER` in the router).

### T012 — Create generations router

- [x] T012 Create NEW file `backend/app/routers/generations.py`. **Read `backend/app/routers/keys.py` AND `backend/app/routers/brands.py` first** — copy their exact patterns for `_error_response`, `_get_brand_or_404`, error envelope shape, logger pattern, and Supabase Storage usage. Requirements:

    **Imports (exact, in this order):**
    ```python
    import asyncio
    import logging
    from datetime import datetime, timezone
    from uuid import UUID, uuid4

    from fastapi import APIRouter, Depends, HTTPException, status

    from app.config import settings
    from app.core.auth import User, get_current_user
    from app.core.supabase import get_service_client
    from app.core.vault import read_secret
    from app.models.generation import (
        GenerateRequest,
        GenerationResponse,
        GenerationStatusEnum,
        LogoModeEnum,
        ProviderEnum,
    )
    from app.services.error_mapping import classify_provider_error
    from app.services.postprocess import resize_to_preset
    from app.services.presets import (
        MODEL_FOR_PROVIDER,
        PLATFORM_PRESETS,
        PRESET_TO_ASPECT_RATIO,
        build_download_filename,
    )
    from app.services.prompt_composer import compose_full_prompt
    from app.services.providers.base import ProviderError, ProviderResult
    from app.services.providers.gemini_image import gemini_generate
    from app.services.providers.openai_image import openai_generate
    from app.services.watermark import apply_watermark

    logger = logging.getLogger(__name__)

    router = APIRouter(prefix="/brands/{brand_id}", tags=["generations"])
    ```

    **Helpers (mirror `routers/keys.py`):**
    ```python
    def _error_response(status_code: int, code: str, message: str) -> HTTPException:
        return HTTPException(
            status_code=status_code,
            detail={
                "error": {
                    "code": code,
                    "message": message,
                    "request_id": str(uuid4()),
                }
            },
        )


    def _get_brand_or_404(brand_id: UUID, user_id: str) -> dict:
        client = get_service_client()
        result = (
            client.table("brands")
            .select("*")
            .eq("id", str(brand_id))
            .eq("owner_user_id", user_id)
            .maybe_single()
            .execute()
        )
        if result is None or result.data is None:
            raise _error_response(404, "BRAND_NOT_FOUND", "Brand not found")
        return result.data


    def _get_active_key_or_400(brand_id: UUID, provider: str) -> dict:
        client = get_service_client()
        result = (
            client.table("provider_keys")
            .select("*")
            .eq("brand_id", str(brand_id))
            .eq("provider", provider)
            .eq("is_active", True)
            .maybe_single()
            .execute()
        )
        if result is None or result.data is None:
            raise _error_response(
                400,
                "NO_ACTIVE_KEY",
                f"No active {provider} key for this brand. Add or activate a key on the Keys page.",
            )
        return result.data


    def _get_brand_kit_summary(brand_id: UUID) -> str | None:
        """Return the brand kit summary only when status == 'complete', else None (FR-014)."""
        client = get_service_client()
        result = (
            client.table("brand_kits")
            .select("summary, status")
            .eq("brand_id", str(brand_id))
            .maybe_single()
            .execute()
        )
        if result is None or result.data is None:
            return None
        if result.data.get("status") != "complete":
            return None
        return result.data.get("summary")


    def _mark_failed(generation_id: UUID, code: str, message: str) -> None:
        client = get_service_client()
        now = datetime.now(timezone.utc).isoformat()
        client.table("generations").update(
            {
                "status": "failed",
                "error_code": code,
                "error_message": (message or "")[:1000],
                "completed_at": now,
            }
        ).eq("id", str(generation_id)).execute()


    def _build_response(row: dict, brand_name: str) -> GenerationResponse:
        image_url = None
        download_filename = None
        if row.get("image_path") and row.get("completed_at"):
            image_url = (
                f"{settings.SUPABASE_URL}/storage/v1/object/public/"
                f"{settings.STORAGE_BUCKET}/{row['image_path']}"
            )
            completed_at = row["completed_at"]
            if isinstance(completed_at, str):
                completed_at = datetime.fromisoformat(completed_at.replace("Z", "+00:00"))
            download_filename = build_download_filename(
                brand_name=brand_name,
                preset_identifier=row["platform_preset"],
                completed_at=completed_at,
            )
        return GenerationResponse(
            id=row["id"],
            prompt=row["prompt"],
            provider=row["provider"],
            model=row["model"],
            platform_preset=row["platform_preset"],
            width=row["width"],
            height=row["height"],
            logo_mode=row["logo_mode"],
            status=row["status"],
            image_url=image_url,
            download_filename=download_filename,
            error_code=row.get("error_code"),
            error_message=row.get("error_message"),
            created_at=row["created_at"],
            completed_at=row.get("completed_at"),
        )
    ```

    **The endpoint — `POST /brands/{brand_id}/generate`:**
    ```python
    @router.post("/generate", response_model=GenerationResponse)
    async def generate_image(
        brand_id: UUID,
        body: GenerateRequest,
        current_user: User = Depends(get_current_user),
    ) -> GenerationResponse:
        # FR-001, FR-029 — ownership check
        brand = _get_brand_or_404(brand_id, current_user.id)
        brand_name = brand["name"]
        brand_has_logo = bool(brand.get("logo_path"))

        # FR-007 mirror: refuse watermark/both when no logo exists
        if body.logo_mode in (LogoModeEnum.watermark, LogoModeEnum.both) and not brand_has_logo:
            raise _error_response(
                400,
                "LOGO_REQUIRED",
                "This logo mode requires an uploaded brand logo. Please upload a logo on the Settings page.",
            )

        # FR-012 — resolve preset dimensions
        preset_w, preset_h, _label = PLATFORM_PRESETS[body.platform_preset.value]

        # FR-013 — fetch active key
        active_key = _get_active_key_or_400(brand_id, body.provider.value)

        # FR-014 — fetch brand kit summary (complete kit only)
        brand_context_summary = _get_brand_kit_summary(brand_id)

        # FR-010 — insert pending row
        generation_id = uuid4()
        resolved_model = MODEL_FOR_PROVIDER[body.provider.value]

        client = get_service_client()
        client.table("generations").insert(
            {
                "id": str(generation_id),
                "brand_id": str(brand_id),
                "prompt": body.prompt,          # FR-022: raw, not enriched
                "provider": body.provider.value,
                "model": resolved_model,
                "platform_preset": body.platform_preset.value,
                "width": preset_w,
                "height": preset_h,
                "logo_mode": body.logo_mode.value,
                "status": "pending",
            }
        ).execute()

        logger.info(
            "generate start generation_id=%s brand_id=%s provider=%s preset=%s logo_mode=%s",
            generation_id, brand_id, body.provider.value,
            body.platform_preset.value, body.logo_mode.value,
        )

        try:
            # FR-011 — transition to processing
            client.table("generations").update({"status": "processing"}).eq(
                "id", str(generation_id)
            ).execute()

            # FR-014, FR-015 — compose prompt
            full_prompt = compose_full_prompt(
                user_prompt=body.prompt,
                brand_context_summary=brand_context_summary,
                logo_mode=body.logo_mode.value,
                brand_has_logo=brand_has_logo,
            )

            # Resolve Vault secret
            api_key = read_secret(active_key["vault_secret_id"])

            # FR-016 — call provider with 120 s timeout (FR-031) and zero retries (FR-032)
            try:
                if body.provider is ProviderEnum.openai:
                    result: ProviderResult = await asyncio.wait_for(
                        openai_generate(
                            api_key=api_key,
                            prompt=full_prompt,
                            width=preset_w,
                            height=preset_h,
                            model=resolved_model,
                        ),
                        timeout=120.0,
                    )
                else:
                    aspect_ratio = PRESET_TO_ASPECT_RATIO[body.platform_preset.value]
                    result = await asyncio.wait_for(
                        asyncio.to_thread(
                            gemini_generate,
                            api_key=api_key,
                            prompt=full_prompt,
                            aspect_ratio=aspect_ratio,
                            model=resolved_model,
                        ),
                        timeout=120.0,
                    )
            except asyncio.TimeoutError:
                raise ProviderError(
                    "TIMEOUT",
                    "The request took too long to complete. Please try again.",
                )
            except ProviderError:
                raise
            except Exception as exc:
                code, user_msg = classify_provider_error(exc)
                raise ProviderError(code, user_msg)

            # FR-018 — post-process to exact preset dimensions
            image_bytes = resize_to_preset(result.image_bytes, preset_w, preset_h)

            # FR-019 — apply watermark when requested and the brand has a logo
            if (
                body.logo_mode in (LogoModeEnum.watermark, LogoModeEnum.both)
                and brand_has_logo
            ):
                logo_bytes = client.storage.from_(settings.STORAGE_BUCKET).download(
                    brand["logo_path"]
                )
                image_bytes = apply_watermark(image_bytes, logo_bytes)

            # FR-020 — upload PNG
            image_path = f"brands/{brand_id}/generations/{generation_id}.png"
            client.storage.from_(settings.STORAGE_BUCKET).upload(
                image_path,
                image_bytes,
                {"content-type": "image/png", "upsert": "false"},
            )

            # FR-011, FR-020 — mark succeeded
            now_iso = datetime.now(timezone.utc).isoformat()
            updated = (
                client.table("generations")
                .update(
                    {
                        "status": "succeeded",
                        "image_path": image_path,
                        "provider_request_id": result.request_id,
                        "completed_at": now_iso,
                    }
                )
                .eq("id", str(generation_id))
                .execute()
            )

            # FR-020 — bump last_used_at on the key
            client.table("provider_keys").update({"last_used_at": now_iso}).eq(
                "id", active_key["id"]
            ).execute()

            row = updated.data[0] if updated.data else None
            if row is None:
                # Extremely defensive — re-fetch the row if the update response was empty
                row = (
                    client.table("generations")
                    .select("*")
                    .eq("id", str(generation_id))
                    .single()
                    .execute()
                    .data
                )
            logger.info(
                "generate success generation_id=%s brand_id=%s",
                generation_id, brand_id,
            )
            return _build_response(row, brand_name)

        except ProviderError as e:
            _mark_failed(generation_id, e.code, e.user_message)
            logger.info(
                "generate failed code=%s generation_id=%s brand_id=%s",
                e.code, generation_id, brand_id,
            )
            raise _error_response(502, e.code, e.user_message)
        except Exception:
            logger.exception(
                "generate pipeline unexpected error generation_id=%s brand_id=%s",
                generation_id, brand_id,
            )
            _mark_failed(
                generation_id, "INTERNAL_ERROR", "Internal error"
            )
            raise _error_response(
                500,
                "INTERNAL_ERROR",
                "Something went wrong. Please try again.",
            )
    ```

    > **Do NOT log `api_key`, `full_prompt`, or `body.prompt`.** The only permitted log lines are the `logger.info` calls shown above (start, success, failed) and the `logger.exception` line for the generic fallback. **Do NOT** catch any exception in a way that swallows the `ProviderError` flow or bypasses `_mark_failed`.

### T013 — Register generations router in main.py

- [x] T013 Modify `backend/app/main.py`. Make exactly two changes and nothing else:

    1. On line 9, change:
        ```python
        from app.routers import brands, health, keys, kit, me
        ```
        to:
        ```python
        from app.routers import brands, generations, health, keys, kit, me
        ```

    2. Add this line immediately after the existing `app.include_router(kit.router)` line:
        ```python
        app.include_router(generations.router)
        ```

    Do NOT modify any other lines. Run `python3 -c "from app.main import app; print('ok')"` from `backend/` to confirm the app imports cleanly. If the import fails, fix the syntax and re-run.

### T014 — Unit tests for presets service

- [x] T014 [P] Create NEW file `backend/tests/test_presets.py`. Pure unit tests. Imports:

    ```python
    from datetime import datetime, timezone

    from app.services.presets import (
        MODEL_FOR_PROVIDER,
        PLATFORM_PRESETS,
        PRESET_TO_ASPECT_RATIO,
        build_download_filename,
        sanitize_brand_name,
    )
    ```

    **Test functions:**

    ```python
    def test_presets_has_exactly_13_entries():
        assert len(PLATFORM_PRESETS) == 13

    def test_presets_dimensions_within_db_bounds():
        # Phase 1 CHECK constraint: width/height BETWEEN 256 AND 4096
        for key, (w, h, _label) in PLATFORM_PRESETS.items():
            assert 256 <= w <= 4096, f"{key} width out of range"
            assert 256 <= h <= 4096, f"{key} height out of range"

    def test_every_preset_has_an_aspect_ratio():
        assert set(PLATFORM_PRESETS.keys()) == set(PRESET_TO_ASPECT_RATIO.keys())

    def test_aspect_ratios_are_from_supported_set():
        supported = {"1:1", "9:16", "16:9"}
        for ratio in PRESET_TO_ASPECT_RATIO.values():
            assert ratio in supported

    def test_model_for_provider():
        assert MODEL_FOR_PROVIDER == {
            "openai": "gpt-image-1.5",
            "gemini": "gemini-3-pro-image-preview",
        }

    def test_sanitize_brand_name_simple():
        assert sanitize_brand_name("My Brand!") == "my-brand"

    def test_sanitize_brand_name_non_ascii_fallback():
        assert sanitize_brand_name("日本語") == "brand"

    def test_sanitize_brand_name_only_punctuation_fallback():
        assert sanitize_brand_name("!!!---...") == "brand"

    def test_sanitize_brand_name_truncation_at_40():
        raw = "A very long brand name with many many many words to test truncation"
        result = sanitize_brand_name(raw)
        assert len(result) <= 40
        assert not result.endswith("-")

    def test_sanitize_brand_name_collapses_hyphens():
        assert sanitize_brand_name("foo  !! bar") == "foo-bar"

    def test_build_download_filename_example_from_spec():
        dt = datetime(2026, 4, 11, 14, 30, 52, tzinfo=timezone.utc)
        result = build_download_filename("My Brand!", "instagram_post", dt)
        assert result == "my-brand-instagram_post-20260411-143052.png"

    def test_build_download_filename_converts_to_utc():
        # Non-UTC timezone input must be converted
        from datetime import timedelta, timezone as tz
        eastern = tz(timedelta(hours=-4))
        dt = datetime(2026, 4, 11, 10, 30, 52, tzinfo=eastern)  # 14:30:52 UTC
        result = build_download_filename("My Brand!", "instagram_post", dt)
        assert result == "my-brand-instagram_post-20260411-143052.png"
    ```

### T015 — Unit tests for prompt composer

- [x] T015 [P] Create NEW file `backend/tests/test_prompt_composer.py`. Pure unit tests. Imports:

    ```python
    from app.services.prompt_composer import compose_full_prompt
    ```

    **Test functions:**

    ```python
    USER_PROMPT = "A modern minimal office"
    KIT_SUMMARY = "Brand: Acme\nTone: professional\nAudience: founders"

    def test_no_kit_no_logo_mode_none():
        result = compose_full_prompt(
            user_prompt=USER_PROMPT,
            brand_context_summary=None,
            logo_mode="none",
            brand_has_logo=False,
        )
        assert result == f"Image Request:\n{USER_PROMPT}"

    def test_kit_only_mode_none():
        result = compose_full_prompt(
            user_prompt=USER_PROMPT,
            brand_context_summary=KIT_SUMMARY,
            logo_mode="none",
            brand_has_logo=False,
        )
        assert result.startswith("Brand Context:\n")
        assert result.endswith(f"Image Request:\n{USER_PROMPT}")
        assert "Incorporate the brand logo" not in result

    def test_logo_mode_prompt_with_logo_no_kit():
        result = compose_full_prompt(
            user_prompt=USER_PROMPT,
            brand_context_summary=None,
            logo_mode="prompt",
            brand_has_logo=True,
        )
        assert "Incorporate the brand logo naturally into the image." in result
        assert result.endswith(f"Image Request:\n{USER_PROMPT}")

    def test_logo_mode_prompt_without_logo_omits_instruction():
        # Critical safety rule: no logo instruction when no logo exists
        result = compose_full_prompt(
            user_prompt=USER_PROMPT,
            brand_context_summary=None,
            logo_mode="prompt",
            brand_has_logo=False,
        )
        assert "Incorporate the brand logo" not in result

    def test_logo_mode_watermark_never_adds_prompt_instruction():
        result = compose_full_prompt(
            user_prompt=USER_PROMPT,
            brand_context_summary=None,
            logo_mode="watermark",
            brand_has_logo=True,
        )
        assert "Incorporate the brand logo" not in result

    def test_logo_mode_both_with_logo_adds_instruction():
        result = compose_full_prompt(
            user_prompt=USER_PROMPT,
            brand_context_summary=None,
            logo_mode="both",
            brand_has_logo=True,
        )
        assert "Incorporate the brand logo naturally into the image." in result

    def test_logo_mode_both_without_logo_omits_instruction():
        result = compose_full_prompt(
            user_prompt=USER_PROMPT,
            brand_context_summary=None,
            logo_mode="both",
            brand_has_logo=False,
        )
        assert "Incorporate the brand logo" not in result

    def test_kit_and_logo_prompt_ordering():
        result = compose_full_prompt(
            user_prompt=USER_PROMPT,
            brand_context_summary=KIT_SUMMARY,
            logo_mode="prompt",
            brand_has_logo=True,
        )
        # Order: brand context → logo instruction → user prompt
        kit_idx = result.index("Brand Context:")
        logo_idx = result.index("Incorporate the brand logo")
        user_idx = result.index("Image Request:")
        assert kit_idx < logo_idx < user_idx
    ```

### T016 — Unit tests for postprocess

- [x] T016 [P] Create NEW file `backend/tests/test_postprocess.py`. Uses Pillow to generate synthetic test images. Imports:

    ```python
    import io

    from PIL import Image

    from app.services.postprocess import resize_to_preset
    from app.services.presets import PLATFORM_PRESETS
    ```

    **Helper:**
    ```python
    def _make_image(width: int, height: int, color: tuple[int, int, int] = (255, 0, 0)) -> bytes:
        image = Image.new("RGB", (width, height), color)
        out = io.BytesIO()
        image.save(out, format="PNG")
        return out.getvalue()
    ```

    **Test functions:**
    ```python
    def test_resize_same_aspect_downscales_correctly():
        src = _make_image(2048, 2048)
        result = resize_to_preset(src, 1080, 1080)
        out = Image.open(io.BytesIO(result))
        assert out.size == (1080, 1080)

    def test_resize_wider_source_crops_to_square():
        src = _make_image(2000, 1000)  # 2:1
        result = resize_to_preset(src, 1080, 1080)
        out = Image.open(io.BytesIO(result))
        assert out.size == (1080, 1080)

    def test_resize_taller_source_crops_to_square():
        src = _make_image(1000, 2000)  # 1:2
        result = resize_to_preset(src, 1080, 1080)
        out = Image.open(io.BytesIO(result))
        assert out.size == (1080, 1080)

    def test_resize_tiny_source_upscales():
        src = _make_image(100, 100)
        result = resize_to_preset(src, 1080, 1080)
        out = Image.open(io.BytesIO(result))
        assert out.size == (1080, 1080)

    def test_resize_every_preset_reaches_exact_dimensions():
        # Synthesize a 1024x1024 source (Gemini '1:1' '1K' approximation) and
        # verify every preset reaches its exact target dimensions.
        src = _make_image(1024, 1024)
        for key, (target_w, target_h, _label) in PLATFORM_PRESETS.items():
            result = resize_to_preset(src, target_w, target_h)
            out = Image.open(io.BytesIO(result))
            assert out.size == (target_w, target_h), f"{key} produced {out.size}"

    def test_resize_output_is_png():
        src = _make_image(2000, 2000)
        result = resize_to_preset(src, 1080, 1080)
        assert Image.open(io.BytesIO(result)).format == "PNG"
    ```

### T017 — Unit tests for watermark

- [x] T017 [P] Create NEW file `backend/tests/test_watermark.py`. Imports:

    ```python
    import io

    from PIL import Image

    from app.services.watermark import WATERMARK_MARGIN_PX, WATERMARK_SCALE, apply_watermark
    ```

    **Helper:**
    ```python
    def _solid_rgb(w: int, h: int, color: tuple[int, int, int]) -> bytes:
        out = io.BytesIO()
        Image.new("RGB", (w, h), color).save(out, format="PNG")
        return out.getvalue()

    def _solid_rgba_logo(w: int, h: int) -> bytes:
        # Opaque green square — easy to compare against the red base
        out = io.BytesIO()
        Image.new("RGBA", (w, h), (0, 255, 0, 255)).save(out, format="PNG")
        return out.getvalue()
    ```

    **Test functions:**
    ```python
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
        # Make a pure red base and a pure green logo, then verify that a pixel
        # inside the expected watermark bbox differs from the original, while
        # the top-left corner does not.
        base = _solid_rgb(1080, 1080, (255, 0, 0))
        logo = _solid_rgba_logo(400, 400)  # will be scaled to 15% = 162 px
        result = apply_watermark(base, logo)
        out = Image.open(io.BytesIO(result)).convert("RGB")

        # Top-left should be untouched red
        assert out.getpixel((10, 10)) == (255, 0, 0)

        # Pixel inside the watermark bbox: margin + logo/2 from each edge
        logo_w = int(round(1080 * WATERMARK_SCALE))
        cx = 1080 - WATERMARK_MARGIN_PX - logo_w // 2
        cy = 1080 - WATERMARK_MARGIN_PX - logo_w // 2
        pixel = out.getpixel((cx, cy))
        # 70% opacity green over red ≈ (0.3*255, 0.7*255, 0.0) ≈ (76, 178, 0)
        assert pixel != (255, 0, 0)
        assert pixel[1] > pixel[0]  # More green than red

    def test_watermark_margin_is_20_px():
        base = _solid_rgb(1080, 1080, (255, 0, 0))
        logo = _solid_rgba_logo(400, 400)
        result = apply_watermark(base, logo)
        out = Image.open(io.BytesIO(result)).convert("RGB")

        # Pixel at exactly (1080 - 1, 1080 - 1) should still be red —
        # the logo stops 20 px from the edge.
        assert out.getpixel((1079, 1079)) == (255, 0, 0)
    ```

### T018 — Unit tests for error mapping

- [x] T018 [P] Create NEW file `backend/tests/test_error_mapping.py`. Imports:

    ```python
    from unittest.mock import Mock

    import httpx

    from app.services.error_mapping import ERROR_USER_MESSAGES, classify_provider_error
    ```

    **Helper:**
    ```python
    def _status_error(code: int, body: str = "") -> httpx.HTTPStatusError:
        request = httpx.Request("POST", "https://example.com/")
        response = httpx.Response(code, content=body.encode(), request=request)
        return httpx.HTTPStatusError(message=f"HTTP {code}", request=request, response=response)
    ```

    **Test functions:**
    ```python
    def test_all_error_codes_have_messages():
        expected_codes = {
            "INVALID_KEY", "RATE_LIMITED", "CONTENT_POLICY", "TIMEOUT",
            "NETWORK", "EMPTY_RESPONSE", "PROVIDER_CLIENT_ERROR", "PROVIDER_SERVER_ERROR",
        }
        assert expected_codes.issubset(ERROR_USER_MESSAGES.keys())

    def test_timeout_exception():
        exc = httpx.TimeoutException("timed out")
        code, msg = classify_provider_error(exc)
        assert code == "TIMEOUT"
        assert msg == ERROR_USER_MESSAGES["TIMEOUT"]

    def test_connect_error_is_network():
        exc = httpx.ConnectError("connection refused")
        code, msg = classify_provider_error(exc)
        assert code == "NETWORK"

    def test_401_is_invalid_key():
        code, _ = classify_provider_error(_status_error(401))
        assert code == "INVALID_KEY"

    def test_429_is_rate_limited():
        code, _ = classify_provider_error(_status_error(429))
        assert code == "RATE_LIMITED"

    def test_400_with_policy_body_is_content_policy():
        code, _ = classify_provider_error(_status_error(400, '{"error": "content policy violation"}'))
        assert code == "CONTENT_POLICY"

    def test_400_without_policy_keyword_is_client_error():
        code, _ = classify_provider_error(_status_error(400, '{"error": "invalid parameter"}'))
        assert code == "PROVIDER_CLIENT_ERROR"

    def test_500_is_server_error():
        code, _ = classify_provider_error(_status_error(500))
        assert code == "PROVIDER_SERVER_ERROR"

    def test_unknown_exception_falls_back_to_server_error():
        code, _ = classify_provider_error(RuntimeError("who knows"))
        assert code == "PROVIDER_SERVER_ERROR"

    def test_messages_never_leak_exception_detail():
        exc = _status_error(500, "this should not leak to users")
        _, msg = classify_provider_error(exc)
        assert "this should not leak" not in msg
    ```

### T019 — Run backend tests

- [x] T019 Run from `backend/`: `pytest tests/test_presets.py tests/test_prompt_composer.py tests/test_postprocess.py tests/test_watermark.py tests/test_error_mapping.py -v` and confirm all tests pass. If any fail, fix the corresponding source file (T003–T007) and re-run until green. Do NOT proceed until all tests pass. Report the total test count (should be ~35 tests).

### T020 — Manual backend smoke test

- [x] T020 With the backend running (`cd backend && uvicorn app.main:app --reload --port 8000`), open `http://127.0.0.1:8000/docs` and confirm:
    1. A new tag `generations` appears
    2. Under it, exactly ONE endpoint: `POST /brands/{brand_id}/generate`
    3. **No** `GET /brands/{brand_id}/generations`, `GET /brands/{brand_id}/generations/{gen_id}`, or `DELETE /brands/{brand_id}/generations/{gen_id}` endpoints — these are Phase 7, not Phase 6. If any of those four unwanted endpoints appear, STOP and delete them from `backend/app/routers/generations.py`.
    4. The `POST /brands/{brand_id}/generate` request schema shows `prompt`, `provider`, `platform_preset`, `logo_mode` — and **does NOT show a `model` field** (per FR-004).

    Report: confirmation that the endpoint is registered and none of the Phase 7 endpoints exist.

### 🛑 PHASE 2 REVIEW CHECKPOINT

Report: "Phase 2 complete — backend generation pipeline built and tested. X tests passing, endpoint visible in /docs." Then STOP for review.

---

## Phase 3: User Story 1 — Generate an Image End-to-End (Priority: P1) 🎯 MVP

**Goal**: A brand owner can open the generator page, pick a preset, enter a prompt, click Generate, and see/download the resulting PNG.

**Independent Test**: On a brand with an active provider key, open the generator, enter a valid prompt, select any preset, click Generate, wait for the result, verify the image dimensions match the preset exactly, and verify the Download button saves a PNG file.

### T021 — Add generation TypeScript types

- [x] T021 [US1] Modify `frontend/types/index.ts`. Read the file first. Append the following block at the end of the file (do not modify anything already there):

    ```typescript
    export type Provider = 'openai' | 'gemini'
    export type LogoMode = 'none' | 'prompt' | 'watermark' | 'both'
    export type GenerationStatus = 'pending' | 'processing' | 'succeeded' | 'failed'

    export type PlatformPreset =
      | 'instagram_post'
      | 'instagram_story'
      | 'instagram_reel_cover'
      | 'facebook_post'
      | 'facebook_cover'
      | 'facebook_story'
      | 'twitter_post'
      | 'twitter_header'
      | 'linkedin_post'
      | 'linkedin_banner'
      | 'tiktok_video_cover'
      | 'youtube_thumbnail'
      | 'youtube_banner'

    export interface GenerateRequest {
      prompt: string
      provider: Provider
      platform_preset: PlatformPreset
      logo_mode: LogoMode
    }

    export interface GenerationResponse {
      id: string
      prompt: string
      provider: Provider
      model: string
      platform_preset: PlatformPreset
      width: number
      height: number
      logo_mode: LogoMode
      status: GenerationStatus
      image_url: string | null
      download_filename: string | null
      error_code: string | null
      error_message: string | null
      created_at: string
      completed_at: string | null
    }
    ```

### T022 — [P] [US1] Create presets mirror (frontend)

- [x] T022 [P] [US1] Create NEW file `frontend/lib/presets.ts`. Client-side mirror of the backend's `PLATFORM_PRESETS`. Requirements:

    ```typescript
    import type { PlatformPreset } from '@/types'

    export interface PresetInfo {
      width: number
      height: number
      label: string
    }

    export const PLATFORM_PRESETS: Record<PlatformPreset, PresetInfo> = {
      instagram_post:       { width: 1080, height: 1080, label: 'Instagram Post' },
      instagram_story:      { width: 1080, height: 1920, label: 'Instagram Story' },
      instagram_reel_cover: { width: 1080, height: 1920, label: 'Instagram Reel Cover' },
      facebook_post:        { width: 1200, height:  630, label: 'Facebook Post' },
      facebook_cover:       { width:  820, height:  312, label: 'Facebook Cover' },
      facebook_story:       { width: 1080, height: 1920, label: 'Facebook Story' },
      twitter_post:         { width: 1200, height:  675, label: 'Twitter Post' },
      twitter_header:       { width: 1500, height:  500, label: 'Twitter Header' },
      linkedin_post:        { width: 1200, height:  627, label: 'LinkedIn Post' },
      linkedin_banner:      { width: 1584, height:  396, label: 'LinkedIn Banner' },
      tiktok_video_cover:   { width: 1080, height: 1920, label: 'TikTok Video Cover' },
      youtube_thumbnail:    { width: 1280, height:  720, label: 'YouTube Thumbnail' },
      youtube_banner:       { width: 2560, height: 1440, label: 'YouTube Banner' },
    }

    export const PRESETS_BY_PLATFORM: Record<string, PlatformPreset[]> = {
      Instagram: ['instagram_post', 'instagram_story', 'instagram_reel_cover'],
      Facebook:  ['facebook_post', 'facebook_cover', 'facebook_story'],
      'Twitter/X': ['twitter_post', 'twitter_header'],
      LinkedIn:  ['linkedin_post', 'linkedin_banner'],
      TikTok:    ['tiktok_video_cover'],
      YouTube:   ['youtube_thumbnail', 'youtube_banner'],
    }
    ```

### T023 — [P] [US1] Create useActiveKeys hook

- [x] T023 [P] [US1] Create NEW file `frontend/hooks/use-active-keys.ts`. **Read `frontend/hooks/use-brand.ts` first** (if it exists) for the pattern; otherwise mirror the shape shown below. The hook calls `GET /brands/{brandId}/keys` and filters to active keys per provider. Requirements:

    ```typescript
    'use client'

    import { useEffect, useState } from 'react'
    import { apiRequest } from '@/lib/api'
    import type { ProviderKey } from '@/types'

    export interface ActiveKeys {
      openaiActive: boolean
      geminiActive: boolean
    }

    interface UseActiveKeysResult {
      activeKeys: ActiveKeys
      loading: boolean
      error: string | null
      refetch: () => Promise<void>
    }

    export function useActiveKeys(brandId: string): UseActiveKeysResult {
      const [activeKeys, setActiveKeys] = useState<ActiveKeys>({
        openaiActive: false,
        geminiActive: false,
      })
      const [loading, setLoading] = useState(true)
      const [error, setError] = useState<string | null>(null)

      async function load() {
        setLoading(true)
        setError(null)
        try {
          const keys = await apiRequest<ProviderKey[]>(`/brands/${brandId}/keys`)
          setActiveKeys({
            openaiActive: keys.some(k => k.provider === 'openai' && k.is_active),
            geminiActive: keys.some(k => k.provider === 'gemini' && k.is_active),
          })
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Failed to load keys')
        } finally {
          setLoading(false)
        }
      }

      useEffect(() => {
        load()
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [brandId])

      return { activeKeys, loading, error, refetch: load }
    }
    ```

### T024 — [P] [US1] Create useGenerate hook

- [x] T024 [P] [US1] Create NEW file `frontend/hooks/use-generate.ts`. Wraps `POST /brands/{brandId}/generate`. Requirements:

    ```typescript
    'use client'

    import { useState } from 'react'
    import { apiRequest } from '@/lib/api'
    import type { GenerateRequest, GenerationResponse } from '@/types'

    export type GenerateState =
      | { status: 'idle' }
      | { status: 'submitting' }
      | { status: 'success'; result: GenerationResponse }
      | { status: 'error'; code: string; message: string }

    interface UseGenerateResult {
      state: GenerateState
      generate: (body: GenerateRequest) => Promise<void>
      reset: () => void
    }

    export function useGenerate(brandId: string): UseGenerateResult {
      const [state, setState] = useState<GenerateState>({ status: 'idle' })

      async function generate(body: GenerateRequest) {
        setState({ status: 'submitting' })
        try {
          const result = await apiRequest<GenerationResponse>(
            `/brands/${brandId}/generate`,
            { method: 'POST', body: JSON.stringify(body) },
          )
          setState({ status: 'success', result })
        } catch (err) {
          // apiRequest throws Error objects with optional code/message fields (see lib/api.ts)
          const code = (err as { code?: string }).code ?? 'UNKNOWN'
          const message =
            err instanceof Error ? err.message : 'Something went wrong. Please try again.'
          setState({ status: 'error', code, message })
        }
      }

      function reset() {
        setState({ status: 'idle' })
      }

      return { state, generate, reset }
    }
    ```

    > After writing this file, read `frontend/lib/api.ts` and confirm that `apiRequest` throws an `Error` with the server-provided message (from the `error.message` field) on non-2xx responses. If `apiRequest` does NOT currently surface the error `code`, that's OK — we extract what's there and fall back to `UNKNOWN`. **Do NOT modify `lib/api.ts` in this task.**

### T025 — [P] [US1] Create no-key-notice component

- [x] T025 [P] [US1] Create NEW file `frontend/components/generation/no-key-notice.tsx`. Inline warning shown when the selected provider has no active key (FR-009). Requirements:

    ```tsx
    import Link from 'next/link'
    import type { Provider } from '@/types'

    interface NoKeyNoticeProps {
      provider: Provider
      brandId: string
    }

    export function NoKeyNotice({ provider, brandId }: NoKeyNoticeProps) {
      const label = provider === 'openai' ? 'OpenAI' : 'Gemini'
      return (
        <div className="rounded-md border border-yellow-300 bg-yellow-50 p-3 text-sm text-yellow-900">
          No active {label} key for this brand.{' '}
          <Link
            href={`/${brandId}/keys`}
            className="font-medium underline underline-offset-2"
          >
            Add or activate a key
          </Link>
        </div>
      )
    }
    ```

### T026 — [P] [US1] Create prompt-input component

- [x] T026 [P] [US1] Create NEW file `frontend/components/generation/prompt-input.tsx`. Requirements:

    ```tsx
    'use client'

    interface PromptInputProps {
      value: string
      onChange: (value: string) => void
      disabled?: boolean
    }

    const MIN = 3
    const MAX = 4000

    export function PromptInput({ value, onChange, disabled }: PromptInputProps) {
      const trimmedLength = value.trim().length
      const tooShort = trimmedLength > 0 && trimmedLength < MIN
      const tooLong = trimmedLength > MAX

      return (
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium">Prompt</label>
          <textarea
            value={value}
            onChange={(e) => onChange(e.target.value)}
            disabled={disabled}
            rows={5}
            placeholder="Describe the image you want…"
            className="w-full rounded-md border border-input bg-background p-2 text-sm disabled:opacity-50"
            maxLength={MAX + 200}
          />
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>
              {tooShort && `Minimum ${MIN} characters`}
              {tooLong && `Maximum ${MAX} characters`}
            </span>
            <span>{trimmedLength} / {MAX}</span>
          </div>
        </div>
      )
    }
    ```

### T027 — [P] [US1] Create preset-selector component

- [x] T027 [P] [US1] Create NEW file `frontend/components/generation/preset-selector.tsx`. Requirements:

    ```tsx
    'use client'

    import { PLATFORM_PRESETS, PRESETS_BY_PLATFORM } from '@/lib/presets'
    import type { PlatformPreset } from '@/types'

    interface PresetSelectorProps {
      value: PlatformPreset | null
      onChange: (value: PlatformPreset) => void
      disabled?: boolean
    }

    export function PresetSelector({ value, onChange, disabled }: PresetSelectorProps) {
      return (
        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium">Platform preset</label>
          <select
            value={value ?? ''}
            onChange={(e) => onChange(e.target.value as PlatformPreset)}
            disabled={disabled}
            className="w-full rounded-md border border-input bg-background p-2 text-sm disabled:opacity-50"
          >
            <option value="" disabled>Select a preset…</option>
            {Object.entries(PRESETS_BY_PLATFORM).map(([platform, presets]) => (
              <optgroup key={platform} label={platform}>
                {presets.map((preset) => {
                  const info = PLATFORM_PRESETS[preset]
                  return (
                    <option key={preset} value={preset}>
                      {info.label} — {info.width} × {info.height}
                    </option>
                  )
                })}
              </optgroup>
            ))}
          </select>
        </div>
      )
    }
    ```

### T028 — [P] [US1] Create provider-selector component

- [x] T028 [P] [US1] Create NEW file `frontend/components/generation/provider-selector.tsx`. Requirements:

    ```tsx
    'use client'

    import type { Provider } from '@/types'
    import type { ActiveKeys } from '@/hooks/use-active-keys'
    import { NoKeyNotice } from '@/components/generation/no-key-notice'

    interface ProviderSelectorProps {
      value: Provider
      onChange: (value: Provider) => void
      activeKeys: ActiveKeys
      brandId: string
      disabled?: boolean
    }

    export function ProviderSelector({
      value, onChange, activeKeys, brandId, disabled,
    }: ProviderSelectorProps) {
      const currentHasKey =
        (value === 'openai' && activeKeys.openaiActive) ||
        (value === 'gemini' && activeKeys.geminiActive)

      return (
        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium">Provider</label>
          <div className="flex gap-2">
            {(['openai', 'gemini'] as Provider[]).map((p) => (
              <button
                key={p}
                type="button"
                disabled={disabled}
                onClick={() => onChange(p)}
                className={
                  'rounded-md border px-3 py-1.5 text-sm capitalize transition-colors ' +
                  (value === p
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-input bg-background hover:bg-accent')
                }
              >
                {p === 'openai' ? 'OpenAI' : 'Gemini'}
              </button>
            ))}
          </div>
          {!currentHasKey && <NoKeyNotice provider={value} brandId={brandId} />}
        </div>
      )
    }
    ```

### T029 — [P] [US1] Create logo-mode-selector component

- [x] T029 [P] [US1] Create NEW file `frontend/components/generation/logo-mode-selector.tsx`. Requirements:

    ```tsx
    'use client'

    import type { LogoMode } from '@/types'

    interface LogoModeSelectorProps {
      value: LogoMode
      onChange: (value: LogoMode) => void
      brandHasLogo: boolean
      disabled?: boolean
    }

    const MODES: { value: LogoMode; label: string; requiresLogo: boolean }[] = [
      { value: 'none',      label: 'None',      requiresLogo: false },
      { value: 'prompt',    label: 'In prompt', requiresLogo: false },
      { value: 'watermark', label: 'Watermark', requiresLogo: true },
      { value: 'both',      label: 'Both',      requiresLogo: true },
    ]

    export function LogoModeSelector({
      value, onChange, brandHasLogo, disabled,
    }: LogoModeSelectorProps) {
      return (
        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium">Logo mode</label>
          <div className="flex flex-wrap gap-2">
            {MODES.map((mode) => {
              const modeDisabled = disabled || (mode.requiresLogo && !brandHasLogo)
              return (
                <button
                  key={mode.value}
                  type="button"
                  disabled={modeDisabled}
                  onClick={() => onChange(mode.value)}
                  title={
                    mode.requiresLogo && !brandHasLogo
                      ? 'Upload a logo on the Settings page to enable this mode.'
                      : undefined
                  }
                  className={
                    'rounded-md border px-3 py-1.5 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50 ' +
                    (value === mode.value
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-input bg-background hover:bg-accent')
                  }
                >
                  {mode.label}
                </button>
              )
            })}
          </div>
          {!brandHasLogo && (
            <p className="text-xs text-muted-foreground">
              Watermark and Both modes require a brand logo. Upload one on the Settings page.
            </p>
          )}
        </div>
      )
    }
    ```

### T030 — [P] [US1] Create error-message component

- [x] T030 [P] [US1] Create NEW file `frontend/components/generation/error-message.tsx`. Requirements:

    ```tsx
    import Link from 'next/link'

    interface ErrorMessageProps {
      code: string
      message: string
      brandId: string
    }

    export function ErrorMessage({ code, message, brandId }: ErrorMessageProps) {
      return (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 p-4">
          <p className="text-sm font-medium text-destructive">
            {message}
          </p>
          {code === 'INVALID_KEY' && (
            <p className="mt-2 text-sm">
              <Link
                href={`/${brandId}/keys`}
                className="text-destructive underline underline-offset-2"
              >
                Review your provider keys
              </Link>
            </p>
          )}
        </div>
      )
    }
    ```

### T031 — [US1] Create generator-result component (with Download button per FR-034)

- [x] T031 [US1] Create NEW file `frontend/components/generation/generator-result.tsx`. **This component handles the FR-034 filename download** — do NOT skip the `fetch → blob → <a download>` pattern. Requirements:

    ```tsx
    'use client'

    import { useState } from 'react'
    import type { GenerationResponse } from '@/types'
    import { ErrorMessage } from '@/components/generation/error-message'

    interface GeneratorResultProps {
      state:
        | { status: 'idle' }
        | { status: 'submitting' }
        | { status: 'success'; result: GenerationResponse }
        | { status: 'error'; code: string; message: string }
      brandId: string
    }

    export function GeneratorResult({ state, brandId }: GeneratorResultProps) {
      const [downloading, setDownloading] = useState(false)

      async function handleDownload(result: GenerationResponse) {
        if (!result.image_url || !result.download_filename) return
        setDownloading(true)
        try {
          // Fetch as blob → same-origin Object URL → <a download> with FR-034 filename
          const response = await fetch(result.image_url)
          if (!response.ok) throw new Error('Failed to fetch image')
          const blob = await response.blob()
          const url = URL.createObjectURL(blob)
          const a = document.createElement('a')
          a.href = url
          a.download = result.download_filename
          document.body.appendChild(a)
          a.click()
          a.remove()
          URL.revokeObjectURL(url)
        } finally {
          setDownloading(false)
        }
      }

      if (state.status === 'idle') {
        return (
          <div className="flex h-64 items-center justify-center rounded-md border border-dashed text-sm text-muted-foreground">
            Your generated image will appear here.
          </div>
        )
      }

      if (state.status === 'submitting') {
        return (
          <div className="flex h-64 items-center justify-center rounded-md border border-dashed text-sm text-muted-foreground">
            Generating…
          </div>
        )
      }

      if (state.status === 'error') {
        return (
          <ErrorMessage code={state.code} message={state.message} brandId={brandId} />
        )
      }

      const { result } = state
      return (
        <div className="flex flex-col gap-3">
          {result.image_url && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={result.image_url}
              alt="Generated"
              className="w-full rounded-md border"
            />
          )}
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">
              {result.width} × {result.height} · {result.provider} · {result.model}
            </span>
            <button
              type="button"
              onClick={() => handleDownload(result)}
              disabled={downloading || !result.image_url}
              className="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {downloading ? 'Downloading…' : 'Download'}
            </button>
          </div>
        </div>
      )
    }
    ```

### T032 — [US1] Create generator-form (top-level client component)

- [x] T032 [US1] Create NEW file `frontend/components/generation/generator-form.tsx`. **This is the top-level client component.** It holds form state, applies FR-033 on mount, enforces FR-008 button disabling, and submits via `useGenerate`. Requirements:

    ```tsx
    'use client'

    import { useEffect, useState } from 'react'
    import { useActiveKeys } from '@/hooks/use-active-keys'
    import { useGenerate } from '@/hooks/use-generate'
    import { LogoModeSelector } from '@/components/generation/logo-mode-selector'
    import { PresetSelector } from '@/components/generation/preset-selector'
    import { PromptInput } from '@/components/generation/prompt-input'
    import { ProviderSelector } from '@/components/generation/provider-selector'
    import { GeneratorResult } from '@/components/generation/generator-result'
    import type { LogoMode, PlatformPreset, Provider } from '@/types'

    interface GeneratorFormProps {
      brandId: string
      brandName: string
      brandHasLogo: boolean
    }

    export function GeneratorForm({ brandId, brandName, brandHasLogo }: GeneratorFormProps) {
      const [prompt, setPrompt] = useState('')
      const [provider, setProvider] = useState<Provider>('openai')
      const [preset, setPreset] = useState<PlatformPreset | null>(null)
      const [logoMode, setLogoMode] = useState<LogoMode>('none')
      const [providerInitialized, setProviderInitialized] = useState(false)

      const { activeKeys, loading: keysLoading } = useActiveKeys(brandId)
      const { state, generate } = useGenerate(brandId)

      // FR-033 — deterministic provider pre-selection on first load
      useEffect(() => {
        if (keysLoading || providerInitialized) return
        if (activeKeys.openaiActive && !activeKeys.geminiActive) {
          setProvider('openai')
        } else if (!activeKeys.openaiActive && activeKeys.geminiActive) {
          setProvider('gemini')
        } else if (activeKeys.openaiActive && activeKeys.geminiActive) {
          setProvider('gemini')  // FR-033 rule 2: both present → Gemini
        } else {
          setProvider('openai')  // FR-033 rule 3: neither → OpenAI + notice
        }
        setProviderInitialized(true)
      }, [keysLoading, activeKeys, providerInitialized])

      // FR-008 — Generate button disabled conditions
      const trimmedLen = prompt.trim().length
      const submitting = state.status === 'submitting'
      const hasActiveKey =
        (provider === 'openai' && activeKeys.openaiActive) ||
        (provider === 'gemini' && activeKeys.geminiActive)
      const generateDisabled =
        submitting ||
        trimmedLen < 3 ||
        trimmedLen > 4000 ||
        preset === null ||
        !hasActiveKey

      async function handleSubmit(e: React.FormEvent) {
        e.preventDefault()
        if (generateDisabled || preset === null) return
        await generate({
          prompt: prompt.trim(),
          provider,
          platform_preset: preset,
          logo_mode: logoMode,
        })
      }

      return (
        <div className="grid gap-6 md:grid-cols-2">
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <h2 className="text-xl font-semibold">Generator — {brandName}</h2>
            <PromptInput value={prompt} onChange={setPrompt} disabled={submitting} />
            <PresetSelector value={preset} onChange={setPreset} disabled={submitting} />
            <ProviderSelector
              value={provider}
              onChange={setProvider}
              activeKeys={activeKeys}
              brandId={brandId}
              disabled={submitting}
            />
            <LogoModeSelector
              value={logoMode}
              onChange={setLogoMode}
              brandHasLogo={brandHasLogo}
              disabled={submitting}
            />
            <button
              type="submit"
              disabled={generateDisabled}
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting ? 'Generating…' : 'Generate'}
            </button>
          </form>
          <div className="flex flex-col gap-2">
            <h3 className="text-lg font-medium">Result</h3>
            <GeneratorResult state={state} brandId={brandId} />
          </div>
        </div>
      )
    }
    ```

### T033 — [US1] Replace the brand index page with the generator

- [x] T033 [US1] Modify `frontend/app/(dashboard)/[brandId]/page.tsx`. **Read the file first.** It currently returns a placeholder `<h2>Generator</h2>` with a paragraph. Replace the entire file contents with a server component that fetches the brand and renders `<GeneratorForm />`. Requirements:

    The page needs to know `brand.name` and whether `brand.logo_url` is non-null. **Copy the `ensureBrandAccess` pattern from the brand layout** — read `frontend/app/(dashboard)/[brandId]/layout.tsx` to understand how it constructs the server-side API URL. The simplest approach here is to re-use the same fetch logic by exporting `ensureBrandAccess` from the layout OR by duplicating it in the page.

    **Preferred approach — duplicate the helper here to avoid touching the layout:**

    ```tsx
    import { headers } from 'next/headers'
    import { notFound, redirect } from 'next/navigation'
    import { createClient } from '@/lib/supabase/server'
    import { GeneratorForm } from '@/components/generation/generator-form'
    import type { Brand } from '@/types'

    async function getServerApiUrl(path: string) {
      const serverBase = process.env.NEXT_SERVER_API_URL || process.env.NEXT_PUBLIC_API_URL
      if (!serverBase) throw new Error('API base URL is not configured')
      if (serverBase.startsWith('http://') || serverBase.startsWith('https://')) {
        const base = new URL(serverBase)
        const basePathname = base.pathname.replace(/\/+$/, '')
        const nextPathname = path.replace(/^\/+/, '')
        base.pathname = [basePathname, nextPathname].filter(Boolean).join('/') || '/'
        return base.toString()
      }
      const requestHeaders = await headers()
      const host = requestHeaders.get('x-forwarded-host') || requestHeaders.get('host')
      const protocol = requestHeaders.get('x-forwarded-proto') || 'http'
      if (!host) throw new Error('Request host is unavailable for server-side API call')
      const normalizedBase = serverBase.replace(/\/+$/, '')
      const normalizedPath = path.replace(/^\/+/, '')
      return new URL(`${normalizedBase}/${normalizedPath}`, `${protocol}://${host}`).toString()
    }

    async function loadBrand(brandId: string): Promise<Brand> {
      const supabase = await createClient()
      const { data: { user } } = await supabase.auth.getUser()
      const { data: { session } } = await supabase.auth.getSession()
      if (!user || !session?.access_token) redirect('/login')

      const apiUrl = await getServerApiUrl(`/brands/${brandId}`)
      const response = await fetch(apiUrl, {
        headers: { Authorization: `Bearer ${session.access_token}` },
        cache: 'no-store',
      })
      if (response.status === 404) notFound()
      if (response.status === 401) redirect('/login')
      if (!response.ok) throw new Error('Failed to load brand')

      const payload: unknown = await response.json()
      if (!payload || typeof payload !== 'object') throw new Error('Invalid brand payload')
      return payload as Brand
    }

    export default async function BrandGeneratorPage({
      params,
    }: {
      params: { brandId: string }
    }) {
      const { brandId } = params
      const brand = await loadBrand(brandId)
      return (
        <GeneratorForm
          brandId={brandId}
          brandName={brand.name}
          brandHasLogo={Boolean(brand.logo_url)}
        />
      )
    }
    ```

    > **Do NOT delete anything from the `[brandId]/layout.tsx` file.** The layout is still responsible for the nav and the kit status badge — only the `page.tsx` file's `BrandPage` function body is being replaced.

### T034 — [US1] Manual smoke test — happy path

- [ ] T034 [US1] With both backend and frontend running, follow **quickstart.md → Path 1** exactly. Perform all 10 steps (add OpenAI key, open generator, generate Instagram Post, verify dimensions 1080×1080, verify Download button produces a correctly-named PNG, inspect DB row). Report PASS/FAIL for each of the 10 steps. If any step fails, STOP and fix the corresponding task output before proceeding.

### 🛑 PHASE 3 REVIEW CHECKPOINT

Report: "Phase 3 complete — US1 end-to-end generation working. Path 1 smoke test PASSED." Then STOP for review.

---

## Phase 4: User Story 2 — Apply the Brand Logo (Priority: P2)

**Goal**: All four logo modes (none, prompt, watermark, both) work correctly on a brand that has an uploaded logo. On a brand without a logo, watermark and both modes are unavailable.

**Independent Test**: For a brand with a logo, generate one image per logo mode and visually verify the effect. For a brand without a logo, verify watermark/both are disabled.

> **No new code is expected in this phase.** T006 (backend watermark service), T012 (router logo flow and `LOGO_REQUIRED` validation), and T029 (frontend logo-mode-selector with disabled state) already deliver the behavior. This phase is manual verification.

### T035 — [US2] Manual test — all four logo modes

- [ ] T035 [US2] With both backend and frontend running, follow **quickstart.md → Path 3** exactly. Test all four logo modes on a brand **with** a logo (four separate generations). Then remove the brand logo and verify the `watermark` and `both` options are disabled in the UI. Finally, use curl to POST directly with `logo_mode='watermark'` on the no-logo brand and verify the response is `400 LOGO_REQUIRED`.

    Report PASS/FAIL for each of the 6 checks:
    1. `none` — no overlay, no logo instruction
    2. `prompt` — no overlay, logo instruction present in composed prompt (infer from backend log line)
    3. `watermark` — overlay visible at bottom-right, ~15% width, ~70% opacity, 20 px margin
    4. `both` — overlay visible AND logo instruction present
    5. No-logo brand: `watermark`/`both` disabled in UI
    6. No-logo brand: curl with `watermark` returns 400 `LOGO_REQUIRED`

### 🛑 PHASE 4 REVIEW CHECKPOINT

Report: "Phase 4 complete — US2 logo modes verified." Then STOP for review.

---

## Phase 5: User Story 3 — Handle Provider Failures Gracefully (Priority: P3)

**Goal**: Provider failures produce human-readable errors, preserve form state, persist failed rows, and never leave partial files.

**Independent Test**: Force a provider error, verify the user sees a clean error message and the form retains state, then verify the DB row is `failed` with an error code and no storage file.

> **No new code is expected in this phase.** T007 (error mapping), T012 (router error handling + `_mark_failed`), T030 (error-message component), T031 (generator-result error rendering), and T032 (form state retention via state hooks) already deliver the behavior. This phase is manual verification.

### T036 — [US3] Manual test — invalid key + no-key + FR-033 default provider

- [ ] T036 [US3] With both backend and frontend running, follow **quickstart.md → Path 5** (5a, 5b optional, 5c) exactly. Then additionally verify FR-033 by testing these three provider-default scenarios on a fresh brand:

    **Path 5a (invalid key):** Add an obviously invalid OpenAI key, generate, and verify:
    1. User sees the friendly "Your provider key was rejected…" message
    2. The message includes a link to the Keys page
    3. Form retains prompt, preset, provider, logo mode
    4. Generate button is re-enabled
    5. DB row: `status='failed'`, `error_code='INVALID_KEY'`, `error_message` populated, `image_path IS NULL`, `completed_at IS NOT NULL`
    6. No PNG exists at `brands/<brand-id>/generations/<gen-id>.png` in Storage

    **Path 5c (no active key):** Delete/deactivate the OpenAI key, reload the generator, and verify:
    7. Inline "no active key" notice visible with a link to the Keys page
    8. Generate button is disabled
    9. Direct curl POST returns `400 NO_ACTIVE_KEY`

    **FR-033 default provider rule:**
    10. Fresh brand with **only OpenAI active** → generator opens with OpenAI pre-selected
    11. Fresh brand with **only Gemini active** → generator opens with Gemini pre-selected
    12. Fresh brand with **both active** → generator opens with **Gemini** pre-selected (FR-033 rule 2)
    13. Fresh brand with **neither active** → generator opens with OpenAI pre-selected AND the no-key notice visible (FR-033 rule 3)

    Report PASS/FAIL for each of the 13 checks.

### 🛑 PHASE 5 REVIEW CHECKPOINT

Report: "Phase 5 complete — US3 failure handling verified. FR-033 default provider rule verified." Then STOP for review.

---

## Phase 6: User Story 4 — Brand Context Enriches Generation (Priority: P4)

**Goal**: Generations on a kit-complete brand include the kit's summary in the provider request; generations on a kit-missing brand still succeed; the stored `generations.prompt` is always the raw user input.

**Independent Test**: Generate on two brands (one with complete kit, one without), verify both succeed, verify the stored `prompt` column is the raw input in both cases.

> **No new code is expected in this phase.** T004 (prompt_composer) and T012 (`_get_brand_kit_summary` helper) already deliver the behavior. This phase is manual verification.

### T037 — [US4] Manual test — kit enrichment

- [ ] T037 [US4] With both backend and frontend running, follow **quickstart.md → Path 4** exactly. On Brand A (complete kit) and Brand B (no kit), generate with the same prompt `product photo` on Instagram Post. Verify:

    1. Brand A generation succeeds
    2. Brand A DB row: `prompt = 'product photo'` (raw, NOT enriched) — run `SELECT prompt FROM generations ORDER BY created_at DESC LIMIT 1;`
    3. Brand B generation succeeds
    4. Brand B DB row: `prompt = 'product photo'` (raw)
    5. Visually, the two results look different (Brand A reflects the kit's tone/colors/audience; Brand B is generic)

    Report PASS/FAIL for each of the 5 checks. If check 2 or 4 fails (i.e., the DB row contains the enriched prompt), STOP and fix `backend/app/routers/generations.py` — the `prompt` field in the `client.table("generations").insert(...)` call must be `body.prompt`, not `full_prompt`.

### 🛑 PHASE 6 REVIEW CHECKPOINT

Report: "Phase 6 complete — US4 kit enrichment verified. FR-022 raw prompt storage verified." Then STOP for review.

---

## Phase 7: Polish & Cross-Cutting (Constitution DoD + SC verification)

### T038 — Cross-user authorization check (Constitution §VII DoD, FR-029, SC-008)

- [ ] T038 **CRITICAL for Constitution DoD.** Explicitly verify that User B cannot generate for User A's brand. Follow **quickstart.md → Path 6** exactly. Steps: **[MANUAL — requires two user accounts and running backend]**

    1. Create two test users A and B (or use existing ones)
    2. User A creates a brand `A-brand` and adds an active OpenAI key
    3. Capture User B's JWT access token (sign in as B, copy from DevTools or Supabase session)
    4. Run this curl command (substitute `<A-brand-id>` and `<B-token>`):

        ```bash
        curl -s -o /tmp/resp.json -w "%{http_code}\n" -X POST \
          http://127.0.0.1:8000/brands/<A-brand-id>/generate \
          -H "Authorization: Bearer <B-token>" \
          -H "Content-Type: application/json" \
          -d '{"prompt": "this should fail", "provider": "openai", "platform_preset": "instagram_post", "logo_mode": "none"}'
        cat /tmp/resp.json
        ```

    5. Verify HTTP status is `404` and response body contains `"code": "BRAND_NOT_FOUND"`
    6. Verify no new row was inserted into `generations` for `A-brand` by running in Supabase SQL editor:
        `SELECT count(*) FROM generations WHERE brand_id = '<A-brand-id>' AND prompt = 'this should fail';`
        This MUST return 0.

    Report the curl output and the SELECT result.

### T039 — Key secrecy verification (Constitution §II, FR-030, SC-004)

- [ ] T039 **CRITICAL for Constitution DoD.** Follow **quickstart.md → Path 8** exactly.

    1. Generate one image successfully as normal
    2. Open DevTools → Network tab → click the `POST /brands/{id}/generate` request → Response tab. Search the response body for `sk-` and for `AIza`. Both searches MUST return zero matches.
    3. Back in the `uvicorn` terminal where the backend is running, scroll through all output since the last generation. Search for `sk-` and `AIza`. Both searches MUST return zero matches.
    4. In Supabase SQL editor: `SELECT * FROM generations ORDER BY created_at DESC LIMIT 1;` — inspect all columns. No column may contain a key-shaped string.

    Report PASS/FAIL for each of the 4 checks.

### T040 — Run quickstart.md in full

- [ ] T040 Execute every path in `specs/006-generation/quickstart.md` (Paths 1–9) against the running system. For each path, report PASS/FAIL with any failures attached. The goal is to verify every acceptance scenario and every success criterion end-to-end.

### T041 — Verify all functional requirements from spec

- [ ] T041 Walk through `specs/006-generation/spec.md` → "Functional Requirements" section (FR-001 through FR-034) one by one. For each requirement, report PASS or FAIL based on the built feature. **Do NOT modify any code in this task** — only report. If any FR fails, create a follow-up task list for the reviewer.

### T042 — Final backend test run

- [ ] T042 Run from `backend/`: `pytest tests/test_presets.py tests/test_prompt_composer.py tests/test_postprocess.py tests/test_watermark.py tests/test_error_mapping.py -v` and confirm all tests still pass. Report the total test count and pass/fail.

### T043 — Definition of Done final checklist

- [ ] T043 Fill out this checklist against the built feature and report:

    - [ ] Works for brand with 0 kit answers (T037 check 3)
    - [ ] Works for brand with complete kit (T037 check 1)
    - [ ] Works with OpenAI provider (T034)
    - [ ] Works with Gemini provider (quickstart Path 2)
    - [ ] RLS / cross-user isolation tested (T038)
    - [ ] Hard delete — **N/A for Phase 6** (Phase 7 owns delete)
    - [ ] Lifecycle `pending → processing → succeeded|failed` — no row remains in `pending`/`processing` after the request returns (inspect DB after a success AND after a failure)
    - [ ] Preset dimensions exact (SC-002) — verified against a Gemini generation where native size ≠ preset size
    - [ ] Key secrecy (T039)
    - [ ] Download filename correct (quickstart Path 9)

    If every box above is checked, Phase 6 is complete.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: No dependencies — start immediately
- **Phase 2 (Foundational Backend)**: Depends on Phase 1 — BLOCKS all user stories. Within Phase 2:
  - T002 (requirements) first
  - T003–T010 (services + providers + models) can run in parallel where marked [P] conceptually, but in practice follow the sequential numbering for clarity
  - T011 (models) depends on no services but is imported by T012
  - T012 (router) depends on T003–T011
  - T013 (register router) depends on T012
  - T014–T018 (tests) can run in parallel after their corresponding service is written (all marked [P])
  - T019 (pytest) depends on T014–T018
  - T020 (manual smoke test) depends on T013, T019
- **Phase 3 (US1)**: Depends on Phase 2 complete. Within Phase 3:
  - T021 (types) first
  - T022–T030 can run in parallel where marked [P]
  - T031, T032, T033 depend on the components they import
  - T034 (smoke test) depends on T033
- **Phase 4, 5, 6 (US2, US3, US4)**: Each depends on Phase 3 complete. They are manual-test-only phases and can run in any order — no new code.
- **Phase 7 (Polish/DoD)**: Depends on Phases 3–6 all complete.

### Parallel Opportunities

- **Within Phase 2**: T014–T018 (the five unit test files) are all marked [P] and can be written in parallel by different developers.
- **Within Phase 3**: T022–T030 (hooks + small components) are all marked [P] and have no cross-dependencies beyond the shared types from T021.

---

## Implementation Strategy

### MVP (User Story 1 only — P1)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational backend (critical — blocks everything else)
3. Complete Phase 3: User Story 1
4. **STOP and VALIDATE**: Complete T034 smoke test
5. Deploy/demo — MVP is ready: a user can generate and download a branded image end-to-end

### Incremental delivery (remaining user stories)

6. Phase 4: US2 logo modes → validate T035 → demo
7. Phase 5: US3 failure handling → validate T036 → demo
8. Phase 6: US4 kit enrichment → validate T037 → demo
9. Phase 7: Polish + DoD verification → ready for merge

Each phase after the MVP adds value without breaking the previous stories. Phases 4–6 are manual-test-only — no new code — because the backend pipeline (Phase 2) and the frontend components (Phase 3) already cover their behaviors.

---

## Notes

- `[P]` tasks = different files, no dependencies — safe to parallelize
- `[US1]`/`[US2]`/`[US3]`/`[US4]` labels map tasks to user stories for traceability
- **Never** invent preset identifiers, aspect ratios, error codes, or watermark parameters. The spec's Reference Tables, the contract's error code table, and the tasks above are the only source of truth.
- **Never** log, return, or store a provider API key in any form (Constitution §II Non-Negotiable).
- Commit after each task or logical group. Recommended commit message style (matches existing project history): `feat(006): T010 openai provider wrapper` / `test(006): T014 presets unit tests` / `feat(006): T032 generator form component`.
- Stop at any checkpoint to validate independently. If a review reveals issues, fix the specific task's output file(s) and re-verify.
- **Avoid** cross-story dependencies in frontend components — each phase should be independently demoable.
- **Avoid** retry logic, queueing, background workers, or history endpoints — all of these are Phase 7+ and are explicitly out of scope for Phase 6.
