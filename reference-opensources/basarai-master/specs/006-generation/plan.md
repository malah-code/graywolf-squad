# Implementation Plan: Image Generation

**Branch**: `006-generation` | **Date**: 2026-04-11 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/006-generation/spec.md`

---

## Summary

Implement the end-to-end image generation pipeline: one backend endpoint `POST /brands/{brand_id}/generate` that (1) verifies ownership, (2) resolves the platform preset to exact target dimensions, (3) fetches the brand's active provider key from Supabase Vault, (4) inserts a `pending` generation row and transitions it through `processing` → `succeeded | failed`, (5) composes the full prompt (kit summary + user prompt + optional logo instruction), (6) calls the chosen provider (OpenAI via HTTPX, Gemini via `google-genai` SDK) with a 120 s provider-call timeout and zero automatic retries, (7) post-processes the returned image to the preset's exact pixel dimensions (scale-to-cover + center-crop), (8) optionally composites the brand logo as a watermark (bottom-right, 15% width, 70% opacity, 20 px margin), (9) uploads the PNG to `brands/{brandId}/generations/{generationId}.png` in the `brand-assets` bucket, (10) returns a generation response with a public image URL.

On the frontend, build a single `Generator` page mounted at `/(dashboard)/[brandId]/page.tsx` — the existing placeholder is replaced with a form (prompt textarea, grouped preset selector, provider selector with smart pre-selection per FR-033, logo mode selector, Generate button) that calls the endpoint and renders a result preview with a Download button that delivers the PNG with a human-readable filename (FR-034). Failure paths render a human-readable, category-based error message while preserving form state for immediate retry (FR-026, FR-027).

**No new database migrations.** The `generations` table, its RLS policy, CHECK constraints, and storage bucket path constraint (`^brands/[0-9a-f-]+/generations/[0-9a-f-]+\.png$`) were created in Phase 1. **One new Python dependency** is required: `google-genai` for the official Gemini SDK.

**Out of scope for this plan (and for this phase):** listing, viewing, or deleting past generations; history UI; filters; admin stats. Those belong to Phase 7/8. The only persistent surface in Phase 6 is the Generator page + session-scoped preview (see spec's Out of Scope section).

---

## Technical Context

**Language/Version**: Python 3.13 (backend), TypeScript 5.x / Next.js 14 App Router (frontend)
**Primary Dependencies**: FastAPI 0.109+, Pydantic 2.x, httpx (async HTTP), Pillow 10+ (post-process + watermark), **`google-genai` (NEW — official Google Gen AI SDK for Gemini image calls)**, `supabase-py` (Storage + DB + Vault RPC); shadcn/ui, Tailwind, react-hook-form, zod, lucide-react (frontend)
**Storage**: Supabase PostgreSQL — `generations` table (already migrated); Supabase Storage `brand-assets` bucket (public) — PNGs stored at `brands/{brandId}/generations/{generationId}.png`; Supabase Vault (read-only in this feature) — provider API keys resolved by `vault_secret_id`
**Testing**: `pytest` (backend) — unit tests for `postprocess.resize_to_preset`, `watermark.apply_watermark`, `prompt_composer.compose_full_prompt`, `presets` tables, and `error_mapping.classify_provider_error`; endpoint-level integration is deferred to manual verification via `curl` in the DoD checklist (no Supabase mock exists in `tests/conftest.py`, matching the 005 precedent)
**Target Platform**: Bunny Magic Container (Linux, single image, HTTP-only behind platform HTTPS)
**Project Type**: web-service (FastAPI) + web-app (Next.js 14 App Router)
**Performance Goals**: SC-001 — Generate click → preview within **90 s** for standard presets (e.g., Instagram Post, YouTube Thumbnail); end-to-end round-trip is dominated by provider latency
**Constraints**: 120 s provider-call timeout (FR-031) applies to the provider HTTP call ONLY — post-processing, watermarking, and storage upload run after the provider returns; **zero** automatic retries on any failure (FR-032); PNG output only (Constitution § II); provider keys NEVER in logs, responses, or client state (Constitution § II / § VI, FR-030); exactly one model per provider (FR-004); synchronous pipeline (no queue, no background workers); one generation at a time per form (FR-008, FR-028)
**Scale/Scope**: MVP scale — synchronous single-generation requests, no quota, no cost tracking; each generation writes one DB row + one storage object

---

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Check | Evidence |
|-----------|-------|---------|
| I. Product Truth — Brand isolation, BYOK | ✅ PASS | All pipeline work is scoped to a verified owned brand; provider key is fetched per-brand from Vault |
| II. Non-Negotiable: Brand Isolation | ✅ PASS | `_get_brand_or_404(brand_id, user_id)` runs before any DB/storage/provider action |
| II. Non-Negotiable: Hard Delete | ✅ N/A (create only) | Phase 6 only creates generations; on failure no storage asset is written; Phase 7 owns delete |
| II. Non-Negotiable: Key Secrecy | ✅ PASS | Vault read happens server-side; key string is passed only to provider call; `logger` never receives the key; no field on any response model contains the key |
| II. Non-Negotiable: Official Endpoints Only | ✅ PASS | OpenAI → `https://api.openai.com/v1/images/generations`; Gemini → official `google-genai` SDK (`genai.Client(api_key=…)`) |
| II. Non-Negotiable: PNG Output Only | ✅ PASS | `Pillow` saves with `format='PNG'` in both `postprocess.py` and `watermark.py`; storage upload uses `content-type: image/png`; DB CHECK constraint on `image_path` enforces `.png` suffix |
| III. Tech Constraints (fixed stack) | ✅ PASS | No stack deviations — FastAPI, Next.js 14, Supabase, OpenAI+Gemini, Bunny Magic |
| IV. Data Rules | ✅ PASS | `generations` row stores `prompt` (raw user prompt per FR-022, not the enriched version), `provider`, `model`, `platform_preset`, `width`, `height`, `image_path` (on success), and error metadata (on failure); provider key referenced only via `vault_secret_id` on `provider_keys` — raw key never stored |
| V. UX Rules | ✅ PASS | Free-form prompt is primary input; preset selection required (no default — the user must pick one); brand kit is interview-built (Phase 5) and its summary enriches the request silently (FR-014); history is not touched in this phase |
| VI. Security: RLS on all tables | ✅ PASS | `generations` already has `generations_owner_all` policy from Phase 1 (see `00009_add_rls_policies.sql`); backend uses service client + explicit `_get_brand_or_404` for defense in depth |
| VI. Security: Server-side brand ID verification | ✅ PASS | Every request verifies `brand_id` vs `current_user.id` before any write |
| VI. Security: Providers called from server only | ✅ PASS | All provider calls live in `backend/app/services/providers/`; no client-side provider calls; browser never sees the raw key |
| VI. Security: Logs contain no keys/PII | ✅ PASS | `logger.info/error` calls log `request_id`, `generation_id`, `brand_id`, `provider`, and error *category* only — never the prompt body beyond a truncated excerpt and never the key |
| VII. Definition of Done | ✅ PASS (plan covers all boxes) | Covered in the [Definition of Done pre-check](#definition-of-done-pre-check) below |

**No violations. No complexity exceptions required.**

---

## Project Structure

### Documentation (this feature)

```text
specs/006-generation/
├── plan.md              ← this file
├── research.md          ← Phase 0 output
├── data-model.md        ← Phase 1 output
├── quickstart.md        ← Phase 1 output
├── contracts/
│   └── generate-api.md  ← Phase 1 output
├── checklists/
│   └── requirements.md  ← from /speckit.specify
└── tasks.md             ← Phase 2 output (from /speckit.tasks — NOT created by /speckit.plan)
```

### Source Code

```text
backend/
├── app/
│   ├── main.py                                ← MODIFY: register generations router
│   ├── models/
│   │   └── generation.py                      ← NEW: ProviderEnum, LogoModeEnum, GenerationStatusEnum,
│   │                                                  PlatformPresetEnum, GenerateRequest, GenerationResponse
│   ├── routers/
│   │   └── generations.py                     ← NEW: POST /brands/{brand_id}/generate (only endpoint in Phase 6)
│   └── services/
│       ├── presets.py                         ← NEW: PLATFORM_PRESETS dict + PRESET_TO_ASPECT_RATIO dict
│       │                                             + filename_timestamp / sanitize_brand_name helpers (FR-034)
│       ├── prompt_composer.py                 ← NEW: compose_full_prompt(kit_summary, user_prompt, logo_mode, brand_has_logo)
│       ├── postprocess.py                     ← NEW: resize_to_preset(image_bytes, target_w, target_h) → bytes
│       ├── watermark.py                       ← NEW: apply_watermark(image_bytes, logo_bytes) → bytes
│       │                                             with fixed params from FR-019 (bottom-right, 15%, 70%, 20 px)
│       ├── error_mapping.py                   ← NEW: classify_provider_error(exc_or_status) → (code, user_msg)
│       └── providers/
│           ├── __init__.py                    ← NEW
│           ├── base.py                        ← NEW: ProviderResult dataclass, ProviderError exception
│           ├── openai_image.py                ← NEW: openai_generate(api_key, prompt, w, h, model) → ProviderResult
│           └── gemini_image.py                ← NEW: gemini_generate(api_key, prompt, aspect_ratio, model)
│                                                      → ProviderResult, wraps google-genai SDK
├── requirements.txt                           ← MODIFY: add `google-genai>=1.0.0`
└── tests/
    ├── test_postprocess.py                    ← NEW: scale-to-cover + center-crop correctness
    ├── test_watermark.py                      ← NEW: position, size, opacity, PNG round-trip
    ├── test_prompt_composer.py                ← NEW: all 4 logo modes × (kit / no-kit) × (has-logo / no-logo) matrix
    ├── test_presets.py                        ← NEW: all 13 presets present + every preset maps to an aspect ratio
    ├── test_error_mapping.py                  ← NEW: each error category → correct code + non-technical message
    └── test_filename.py                       ← NEW: brand-name sanitization rules (FR-034 examples)

frontend/
├── app/
│   └── (dashboard)/
│       └── [brandId]/
│           └── page.tsx                       ← MODIFY: replace placeholder with <GeneratorPage />
├── components/
│   └── generation/
│       ├── generator-form.tsx                 ← NEW: top-level client component holding form state
│       ├── prompt-input.tsx                   ← NEW: textarea + 3–4000 char counter
│       ├── preset-selector.tsx                ← NEW: accordion / grouped combobox over PRESETS_BY_PLATFORM
│       ├── provider-selector.tsx              ← NEW: OpenAI / Gemini toggle driven by useActiveKeys + FR-033 rule
│       ├── logo-mode-selector.tsx             ← NEW: 4-option selector; disables watermark/both when !brand.logo_url
│       ├── generator-result.tsx               ← NEW: preview panel — shows success image + Download OR error card
│       ├── error-message.tsx                  ← NEW: pure presentational renderer for classified errors
│       └── no-key-notice.tsx                  ← NEW: inline notice + link to /{brandId}/keys (FR-009)
├── hooks/
│   ├── use-active-keys.ts                    ← NEW: GET /brands/{brandId}/keys filtered to is_active; used to drive FR-033
│   └── use-generate.ts                        ← NEW: POST /brands/{brandId}/generate; returns {generate, result, error, isSubmitting}
├── lib/
│   └── presets.ts                             ← NEW: PLATFORM_PRESETS + PRESETS_BY_PLATFORM + labels (mirror of backend)
└── types/
    └── index.ts                               ← MODIFY: add Provider, LogoMode, PlatformPreset, GenerationStatus,
                                                          GenerateRequest, GenerationResponse
```

**Structure Decision**: Web application (backend + frontend). Backend files follow the established feature pattern: **Pydantic models → router → services**. Frontend files follow the established pattern: **types → hook(s) → page → components**. No new top-level directories are introduced.

---

## Implementation Phases

### Phase A: Backend Services (pure, testable, no FastAPI)

These modules have zero external I/O (except the provider modules, which are thin wrappers) and are covered by unit tests.

#### A.1 — Presets (`backend/app/services/presets.py`)

Single source of truth for the 13 presets and Gemini aspect-ratio mapping. Mirrors Reference Tables A and C from the spec verbatim.

```python
# Keys are the exact preset identifiers from Reference Table A.
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

MODEL_FOR_PROVIDER = {
    "openai": "gpt-image-1.5",
    "gemini": "gemini-3-pro-image-preview",
}
```

Unit test (`test_presets.py`) asserts both dicts have identical key sets of exactly 13 identifiers, every width/height is in `[256, 4096]` (DB CHECK from Phase 1), and every aspect ratio value is one of the Gemini-supported set.

#### A.2 — Filename helpers (`backend/app/services/presets.py`, same module)

Implements FR-034 sanitization. **Tested with the literal examples from the spec.**

```python
import re
from datetime import datetime

_BRAND_NAME_NON_ALNUM = re.compile(r"[^a-z0-9]+")

def sanitize_brand_name(raw: str) -> str:
    """FR-034: lowercase → non-[a-z0-9] → '-' → collapse → trim → max 40 chars → fallback 'brand'."""
    cleaned = _BRAND_NAME_NON_ALNUM.sub("-", raw.lower()).strip("-")
    if not cleaned:
        return "brand"
    return cleaned[:40].rstrip("-") or "brand"

def build_download_filename(brand_name: str, preset_identifier: str, completed_at: datetime) -> str:
    """FR-034: `{sanitized-brand-name}-{preset}-{YYYYMMDD-HHmmss}.png` in UTC."""
    ts = completed_at.astimezone(timezone.utc).strftime("%Y%m%d-%H%M%S")
    return f"{sanitize_brand_name(brand_name)}-{preset_identifier}-{ts}.png"
```

#### A.3 — Prompt Composer (`backend/app/services/prompt_composer.py`)

Pure function: the 12-cell matrix (4 logo modes × has-logo/no-logo × kit-present/kit-missing is actually 4 × 2 × 2 = 16 but several cells are equivalent; the test asserts all 16).

```python
def compose_full_prompt(
    *,
    user_prompt: str,
    brand_context_summary: str | None,  # None if no complete kit — FR-014
    logo_mode: str,                      # 'none' | 'prompt' | 'watermark' | 'both'
    brand_has_logo: bool,                # True only when a logo asset exists in Storage
) -> str:
    parts: list[str] = []
    if brand_context_summary:
        parts.append(f"Brand Context:\n{brand_context_summary}")
    if logo_mode in ("prompt", "both") and brand_has_logo:
        parts.append("Incorporate the brand logo naturally into the image.")
    parts.append(f"Image Request:\n{user_prompt}")
    return "\n\n".join(parts)
```

Unit test table covers every combination and asserts the order is always `[brand_context?] → [logo_instruction?] → user_prompt`, and that `logo_mode='prompt'` on a brand **without** a logo produces **no** logo instruction (safety: we never tell the provider to include a logo we can't verify exists).

#### A.4 — Post-processing (`backend/app/services/postprocess.py`)

Implements FR-018 scale-to-cover + center-crop using Pillow. Adapted from the implementation plan pseudocode but wrapped as a pure function.

```python
from PIL import Image
import io

def resize_to_preset(image_bytes: bytes, target_width: int, target_height: int) -> bytes:
    image = Image.open(io.BytesIO(image_bytes))
    # Ensure RGB/RGBA — some providers may return paletted images
    if image.mode not in ("RGB", "RGBA"):
        image = image.convert("RGBA" if "A" in image.mode else "RGB")

    img_w, img_h = image.size
    scale = max(target_width / img_w, target_height / img_h)
    new_w, new_h = int(round(img_w * scale)), int(round(img_h * scale))
    image = image.resize((new_w, new_h), Image.Resampling.LANCZOS)

    left = (new_w - target_width) // 2
    top = (new_h - target_height) // 2
    image = image.crop((left, top, left + target_width, top + target_height))

    out = io.BytesIO()
    image.save(out, format="PNG")
    return out.getvalue()
```

Unit tests create synthetic Pillow images at several input sizes (including same-aspect, wider, taller, tiny, huge) and assert the returned PNG decodes to **exactly** `(target_width, target_height)` for every Reference Table A preset.

#### A.5 — Watermark (`backend/app/services/watermark.py`)

Implements FR-019 with the fixed parameters locked in via clarification Q3. **No configurability.**

```python
from PIL import Image
import io

WATERMARK_SCALE = 0.15      # FR-019: 15% of image width
WATERMARK_OPACITY = 0.70    # FR-019: 70% alpha multiplier
WATERMARK_MARGIN_PX = 20    # FR-019: 20 px from right and bottom edges

def apply_watermark(image_bytes: bytes, logo_bytes: bytes) -> bytes:
    base = Image.open(io.BytesIO(image_bytes)).convert("RGBA")
    logo = Image.open(io.BytesIO(logo_bytes)).convert("RGBA")

    # Scale logo to 15% of base width, preserving aspect ratio
    target_logo_w = max(1, int(round(base.width * WATERMARK_SCALE)))
    ratio = target_logo_w / logo.width
    target_logo_h = max(1, int(round(logo.height * ratio)))
    logo = logo.resize((target_logo_w, target_logo_h), Image.Resampling.LANCZOS)

    # Apply 70% opacity to the logo's alpha channel
    r, g, b, a = logo.split()
    a = a.point(lambda px: int(px * WATERMARK_OPACITY))
    logo = Image.merge("RGBA", (r, g, b, a))

    # Position: bottom-right, 20 px margin
    x = base.width - target_logo_w - WATERMARK_MARGIN_PX
    y = base.height - target_logo_h - WATERMARK_MARGIN_PX
    base.alpha_composite(logo, dest=(x, y))

    out = io.BytesIO()
    base.convert("RGB").save(out, format="PNG")
    return out.getvalue()
```

Unit tests assert: (1) output decodes as PNG at the same base dimensions; (2) the composited region is measurably modified (pixel compare vs. the original at the watermark bbox, expect difference); (3) the rest of the image (outside the bbox) is unchanged.

#### A.6 — Error Mapping (`backend/app/services/error_mapping.py`)

Translates provider exceptions / HTTP status codes into a stable error code + a user-friendly message (FR-021, FR-026). **Never leaks raw provider payloads.**

| Category | `error_code` | User message |
|----------|--------------|--------------|
| Invalid or revoked key | `INVALID_KEY` | "Your provider key was rejected. Please check your keys." |
| Rate limit / 429 | `RATE_LIMITED` | "The provider is currently rate-limiting your account. Please try again in a moment." |
| Content policy / safety block | `CONTENT_POLICY` | "The provider refused this prompt due to its content policy. Please try a different description." |
| Timeout (> 120 s) | `TIMEOUT` | "The request took too long to complete. Please try again." |
| Network failure (connect, DNS, reset) | `NETWORK` | "Could not reach the provider. Please check your connection and try again." |
| Empty response (HTTP 200 but no image) | `EMPTY_RESPONSE` | "The provider returned no image. Please try again." |
| Any other 4xx | `PROVIDER_CLIENT_ERROR` | "The provider rejected this request. Please try again or adjust your prompt." |
| Any other 5xx / unknown | `PROVIDER_SERVER_ERROR` | "The provider service is temporarily unavailable. Please try again." |

`classify_provider_error(exc: Exception)` inspects the exception's type and (for `httpx.HTTPStatusError`) its `response.status_code` to emit the correct tuple. The router catches `ProviderError` raised by the provider modules and `httpx.TimeoutException` separately.

#### A.7 — OpenAI Provider (`backend/app/services/providers/openai_image.py`)

Thin wrapper around the official OpenAI REST endpoint using `httpx`. Mirrors the implementation plan pseudocode.

- URL: `https://api.openai.com/v1/images/generations` (Constitution: official endpoint only)
- Model: `gpt-image-1.5` (fixed via FR-004; passed in by router so the record reflects `MODEL_FOR_PROVIDER['openai']`)
- Payload: `{model, prompt, size: f"{w}x{h}", response_format: "b64_json", n: 1}`
- **Timeout: `httpx.Timeout(120.0)`** (FR-031) — wraps the whole call so connect + read + pool all count
- **No retries** (FR-032) — `httpx` default transport; `retries` not set
- On `HTTPStatusError`: raise `ProviderError(category=classify_provider_error(exc))` with the original status in the exception
- On success: return `ProviderResult(image_bytes=base64.b64decode(data.data[0].b64_json), request_id=response.headers.get('x-request-id'))`

#### A.8 — Gemini Provider (`backend/app/services/providers/gemini_image.py`)

Wraps the official **`google-genai`** Python SDK (constitutional requirement: official SDKs only).

```python
from google import genai
from google.genai import types as genai_types
import base64

def gemini_generate(
    *, api_key: str, prompt: str, aspect_ratio: str, model: str,
) -> ProviderResult:
    client = genai.Client(api_key=api_key)
    response = client.models.generate_content(
        model=model,  # 'gemini-3-pro-image-preview' from MODEL_FOR_PROVIDER
        contents=[prompt],
        config=genai_types.GenerateContentConfig(
            response_modalities=['Image'],
            image_config=genai_types.ImageConfig(
                aspect_ratio=aspect_ratio,  # FR-017, Reference Table C
                image_size='1K',            # MVP — Pillow post-processes to exact preset dimensions
            ),
        ),
    )
    for part in response.candidates[0].content.parts:
        if getattr(part, 'inline_data', None):
            return ProviderResult(
                image_bytes=base64.b64decode(part.inline_data.data),
                request_id=getattr(response, 'response_id', None),
            )
    raise ProviderError('EMPTY_RESPONSE', 'Gemini returned no image data')
```

**Timeout**: The `google-genai` SDK uses `httpx` internally but does not currently accept a top-level timeout param. The router wraps the entire Gemini call in `asyncio.wait_for(..., timeout=120.0)` to enforce FR-031 uniformly across both providers. The Gemini function is defined as **`async`** and runs the blocking SDK call in a thread pool via `asyncio.to_thread`. (This is documented in **research.md Decision 3**.)

### Phase B: Backend Pydantic Models (`backend/app/models/generation.py`)

```python
from enum import Enum
from datetime import datetime
from pydantic import BaseModel, Field, field_validator

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

# Enum of the 13 preset identifiers — prevents the cheaper implementation model
# from inventing new preset names. The enum values are identical to the keys of
# services/presets.PLATFORM_PRESETS (enforced by a unit test).
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
        return v

class GenerationResponse(BaseModel):
    id: str
    prompt: str                      # FR-022: raw user prompt, NOT the enriched version
    provider: ProviderEnum
    model: str
    platform_preset: PlatformPresetEnum
    width: int
    height: int
    logo_mode: LogoModeEnum
    status: GenerationStatusEnum
    image_url: str | None            # Populated on success (FR-024)
    download_filename: str | None    # FR-034: pre-computed server-side
    error_code: str | None           # FR-021, FR-026
    error_message: str | None
    created_at: datetime
    completed_at: datetime | None
```

> **Why an enum (not a plain string) for `platform_preset` and `provider`?** Pydantic will 422 any request body with an unknown value before the request reaches the router. This is a **deliberate rigidity** that prevents the cheaper implementation model from accepting arbitrary preset/provider values during implementation. The DB already has a matching PostgreSQL enum, so the type discipline is end-to-end.

### Phase C: Generations Router (`backend/app/routers/generations.py`)

**Prefix**: `/brands/{brand_id}/generations` (matches existing routers — `brands`, `keys`, `kit`).
**Only endpoint in Phase 6**: `POST /brands/{brand_id}/generate` (deliberately scoped — list/get/delete are Phase 7).

```python
router = APIRouter(prefix="/brands/{brand_id}", tags=["generations"])

@router.post("/generate", response_model=GenerationResponse)
async def generate_image(
    brand_id: UUID,
    body: GenerateRequest,
    current_user: User = Depends(get_current_user),
):
    brand = _get_brand_or_404(brand_id, current_user.id)                    # FR-001, FR-029
    preset_width, preset_height, _preset_label = PLATFORM_PRESETS[body.platform_preset.value]  # FR-012
    active_key = _get_active_key_or_400(brand_id, body.provider.value)      # FR-013
    kit = _get_brand_kit(brand_id)                                          # May be None — FR-014

    # Create generation row (status=pending) — FR-010, FR-011
    generation_id = uuid4()
    client.table("generations").insert({
        "id": str(generation_id),
        "brand_id": str(brand_id),
        "prompt": body.prompt,                                              # FR-022: raw, not enriched
        "provider": body.provider.value,
        "model": MODEL_FOR_PROVIDER[body.provider.value],                    # FR-004
        "platform_preset": body.platform_preset.value,
        "width": preset_width,
        "height": preset_height,
        "logo_mode": body.logo_mode.value,
        "status": "pending",
    }).execute()

    try:
        # Transition to processing — FR-011
        client.table("generations").update({"status": "processing"}) \
            .eq("id", str(generation_id)).execute()

        # Compose the full prompt — FR-014, FR-015
        brand_has_logo = bool(brand.get("logo_path"))
        full_prompt = compose_full_prompt(
            user_prompt=body.prompt,
            brand_context_summary=kit["summary"] if kit and kit.get("status") == "complete" else None,
            logo_mode=body.logo_mode.value,
            brand_has_logo=brand_has_logo,
        )

        # Resolve Vault secret → provider call
        api_key = read_secret(active_key["vault_secret_id"])

        try:
            if body.provider is ProviderEnum.openai:
                result = await asyncio.wait_for(                            # FR-031
                    openai_generate(
                        api_key=api_key, prompt=full_prompt,
                        width=preset_width, height=preset_height,
                        model=MODEL_FOR_PROVIDER["openai"],
                    ),
                    timeout=120.0,
                )
            else:
                aspect_ratio = PRESET_TO_ASPECT_RATIO[body.platform_preset.value]  # FR-017
                result = await asyncio.wait_for(                            # FR-031
                    asyncio.to_thread(
                        gemini_generate,
                        api_key=api_key, prompt=full_prompt,
                        aspect_ratio=aspect_ratio,
                        model=MODEL_FOR_PROVIDER["gemini"],
                    ),
                    timeout=120.0,
                )
        except asyncio.TimeoutError:
            raise ProviderError("TIMEOUT", "The request took too long to complete. Please try again.")

        # Post-process to exact preset dimensions — FR-018
        image_bytes = resize_to_preset(result.image_bytes, preset_width, preset_height)

        # Apply watermark — FR-019
        if body.logo_mode in (LogoModeEnum.watermark, LogoModeEnum.both) and brand_has_logo:
            logo_bytes = client.storage.from_(settings.STORAGE_BUCKET).download(brand["logo_path"])
            image_bytes = apply_watermark(image_bytes, logo_bytes)

        # Upload to Storage — FR-020
        image_path = f"brands/{brand_id}/generations/{generation_id}.png"
        client.storage.from_(settings.STORAGE_BUCKET).upload(
            image_path, image_bytes, {"content-type": "image/png", "upsert": "false"},
        )

        # Mark succeeded — FR-011, FR-020
        now = datetime.now(timezone.utc)
        updated = client.table("generations").update({
            "status": "succeeded",
            "image_path": image_path,
            "provider_request_id": result.request_id,
            "completed_at": now.isoformat(),
        }).eq("id", str(generation_id)).execute()

        # Update provider key last_used_at — FR-020
        client.table("provider_keys").update({"last_used_at": now.isoformat()}) \
            .eq("id", active_key["id"]).execute()

        return _build_response(updated.data[0], brand["name"])

    except ProviderError as e:
        _mark_failed(generation_id, e.code, e.message)                      # FR-021
        raise _error_response(502, e.code, e.user_message)                  # FR-026
    except Exception:
        logger.exception("generate pipeline failed", extra={"generation_id": str(generation_id)})
        _mark_failed(generation_id, "INTERNAL_ERROR", "Internal error")
        raise _error_response(500, "INTERNAL_ERROR", "Something went wrong. Please try again.")
```

Helpers: `_get_active_key_or_400`, `_get_brand_kit`, `_mark_failed`, `_build_response` (calls `build_download_filename` from `services/presets.py`). All follow the exact pattern from `routers/keys.py` and `routers/brands.py`.

**Error codes**: `BRAND_NOT_FOUND` (404), `VALIDATION_ERROR` (400 — handled by FastAPI via Pydantic), `NO_ACTIVE_KEY` (400 — FR-009 server-side mirror), plus all provider categories from A.6 (502).

### Phase D: Register Router (`backend/app/main.py`)

Add one import and one `app.include_router(generations.router)` line alongside the existing four routers.

### Phase E: Frontend

#### E.1 — Types (`frontend/types/index.ts`) — MODIFY

Append:

```typescript
export type Provider = 'openai' | 'gemini'
export type LogoMode = 'none' | 'prompt' | 'watermark' | 'both'
export type GenerationStatus = 'pending' | 'processing' | 'succeeded' | 'failed'
export type PlatformPreset =
  | 'instagram_post' | 'instagram_story' | 'instagram_reel_cover'
  | 'facebook_post'  | 'facebook_cover'  | 'facebook_story'
  | 'twitter_post'   | 'twitter_header'
  | 'linkedin_post'  | 'linkedin_banner'
  | 'tiktok_video_cover'
  | 'youtube_thumbnail' | 'youtube_banner'

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

#### E.2 — Preset Mirror (`frontend/lib/presets.ts`) — NEW

Client-side `PLATFORM_PRESETS` and `PRESETS_BY_PLATFORM` (mirroring backend A.1). A unit-style sanity import in `generator-form.tsx` ensures the dict keys are a subset of the `PlatformPreset` type (TypeScript catches drift at compile time).

#### E.3 — `use-active-keys` Hook (`frontend/hooks/use-active-keys.ts`) — NEW

Wraps `GET /brands/{brandId}/keys`, filters rows where `is_active === true`. Returns `{ openaiActive, geminiActive, loading, error }`. Drives provider pre-selection (FR-033) and the "no active key" notice (FR-009).

#### E.4 — `use-generate` Hook (`frontend/hooks/use-generate.ts`) — NEW

```typescript
type State =
  | { status: 'idle' }
  | { status: 'submitting' }
  | { status: 'success'; result: GenerationResponse }
  | { status: 'error'; code: string; message: string }

export function useGenerate(brandId: string) {
  const [state, setState] = useState<State>({ status: 'idle' })

  async function generate(body: GenerateRequest) {
    setState({ status: 'submitting' })
    try {
      const result = await apiRequest<GenerationResponse>(
        `/brands/${brandId}/generate`,
        { method: 'POST', body: JSON.stringify(body) },
      )
      setState({ status: 'success', result })
    } catch (err) {
      // apiRequest normalizes backend errors; extract code + message
      setState({ status: 'error', code: err.code ?? 'UNKNOWN', message: err.message ?? 'Something went wrong' })
    }
  }

  return { state, generate, reset: () => setState({ status: 'idle' }) }
}
```

#### E.5 — Components (`frontend/components/generation/`) — NEW

- **`generator-form.tsx`** — client component, mounted on the brand's index page. Holds form state (`prompt`, `provider`, `preset`, `logoMode`) and `useActiveKeys` / `useGenerate`. On mount, applies FR-033 to set the initial `provider`. Disables the Generate button when ANY of FR-008's five conditions are true. Submits via `useGenerate.generate({...})`. Preserves form state after success/failure (FR-027).
- **`prompt-input.tsx`** — textarea with live `length/4000` counter, inline validation message for < 3 or > 4000.
- **`preset-selector.tsx`** — grouped radio/select over `PRESETS_BY_PLATFORM` with the six platform headers (Instagram, Facebook, Twitter/X, LinkedIn, TikTok, YouTube). Shows `{width} × {height}` next to each label.
- **`provider-selector.tsx`** — OpenAI / Gemini toggle. Takes `openaiActive` / `geminiActive` from `useActiveKeys`; displays an icon/state per option; renders `<NoKeyNotice />` inline when the currently selected provider has no active key.
- **`logo-mode-selector.tsx`** — 4 buttons / radio group. When `brand.logo_url == null`, the `watermark` and `both` options are visually disabled and carry a tooltip "Upload a logo on the Settings page to enable watermark modes."
- **`generator-result.tsx`** — Success state: renders `<img src={result.image_url} />` in an aspect-preserving container plus a Download button whose click handler fetches `image_url`, creates an Object URL, and sets `download={result.download_filename}` on a synthesized anchor (ensures the FR-034 filename, not the UUID path). Failure state: renders `<ErrorMessage code={error.code} message={error.message} />`.
- **`error-message.tsx`** — Pure presentational renderer: takes an error code and displays the server-provided user message with an icon. For `INVALID_KEY`, includes a `<Link href="/{brandId}/keys">Review your keys</Link>` inline action.
- **`no-key-notice.tsx`** — Small inline card with text "No active {provider} key for this brand" and a `<Link href="/{brandId}/keys">Add or activate a key</Link>`.

#### E.6 — Generator Page (`frontend/app/(dashboard)/[brandId]/page.tsx`) — MODIFY

Replace the current placeholder with a minimal server component that fetches `GET /brands/{brandId}` (via the same pattern used in `layout.tsx`) to get `brand.logo_url` and `brand.name`, then renders `<GeneratorForm brandId={brandId} brandName={brand.name} brandHasLogo={!!brand.logo_url} />`.

---

## Download filename delivery (FR-034)

**Where the filename is produced**: server-side, in `services/presets.py::build_download_filename`, and included in `GenerationResponse.download_filename`. This means the implementation model does not need to re-implement sanitization on the client.

**How the browser saves it with that name**: The PNG is hosted at Supabase Storage's public URL. The browser cannot rewrite a cross-origin `Content-Disposition` header. Two acceptable approaches:

1. **`<a download="...">` with same-origin fetch** (preferred): In `generator-result.tsx`, the Download button handler does `fetch(result.image_url)` → `res.blob()` → `URL.createObjectURL(blob)` → synthesized `<a download={result.download_filename}>` → click. This works cross-origin as long as the PNG is CORS-readable (Supabase Storage public buckets serve `Access-Control-Allow-Origin: *` by default).
2. **Proxy through FastAPI** (fallback if CORS breaks): Add `GET /brands/{brand_id}/generations/{gen_id}/download` that streams the PNG with `Content-Disposition: attachment; filename="…"`. This is **not** implemented in Phase 6 unless approach 1 fails the DoD check.

Approach 1 is listed as the default in `quickstart.md`. If a future verification shows Supabase's public bucket does not serve the necessary CORS header, the fallback is trivially added without changing any other file.

---

## Definition of Done pre-check

Mapped against Constitution §VII:

- [ ] **Works for brand with 0 kit answers** → `compose_full_prompt` test covers `brand_context_summary=None`; manual verification: create a brand, add an OpenAI key, generate without completing the kit, verify success
- [ ] **Works for brand with complete kit** → same test covers `brand_context_summary='Brand: …\nTone: …\n…'`; manual verification: complete the kit, generate, verify the request body logged at `DEBUG` level (never the prompt itself — just a hash) includes kit context
- [ ] **Works with OpenAI provider** → manual verification via real key (tasks.md T021)
- [ ] **Works with Gemini provider** → manual verification via real key (tasks.md T022); verifies `image_size='1K'` + post-process reaches exact dimensions
- [ ] **RLS / cross-user isolation** → explicit integration check in tasks.md T023: curl `POST /brands/{other-user-brand-id}/generate` with user A's JWT returns 404 (matches `brand_kits` pattern from 005)
- [ ] **Hard delete** → **N/A for this feature.** Phase 6 only creates generations. On failure, no storage asset is written (verified by test_postprocess + test_watermark not touching Storage, and the `try` block in the router writing to Storage only after all pipeline steps succeed). Deletion is Phase 7.

**Additional Phase 6–specific DoD items** (in tasks.md T024):

- [ ] **Lifecycle**: `pending → processing → succeeded|failed` verified by inspecting the row after a manual generation (no row ever remains in `pending` or `processing` after the request returns)
- [ ] **Preset dimensions** (SC-002): pick 3 presets across Instagram/YouTube/LinkedIn banner, generate with Gemini (which returns non-matching native sizes), and confirm the stored PNG's dimensions match exactly
- [ ] **Key secrecy** (Constitution §II): `grep -r <key-prefix> backend/logs/` returns nothing; browser DevTools → Network → no provider call; no key string in any API response body
- [ ] **Filename** (FR-034): manual test with a brand named "My Brand!" produces `my-brand-instagram_post-YYYYMMDD-HHmmss.png`

---

## Constitution Check (Post-Design)

Re-verified against the concrete design above — no principle is relaxed by Phase 1 decisions.

| Principle | Status | Evidence |
|-----------|--------|---------|
| Brand Isolation | ✅ | `_get_brand_or_404` is the first line of the router body |
| Hard Delete | ✅ N/A | Feature only creates; no delete path |
| Key Secrecy | ✅ | Key string exists only in a local variable inside the `try` block; never logged, never returned |
| Official Endpoints | ✅ | OpenAI direct URL; Gemini via `google-genai` SDK |
| PNG Output | ✅ | Pillow `save(format='PNG')`; storage `content-type: image/png`; DB regex on `image_path` enforces `.png` |
| RLS | ✅ | Policy `generations_owner_all` from 00009 migration; service client + explicit ownership check |
| Server-side Brand Verification | ✅ | Single `_get_brand_or_404` call before any pipeline work |
| Client-never-calls-providers | ✅ | Providers live under `backend/app/services/providers/` only |
| Logs clean | ✅ | `logger.info/error` logs the `generation_id`, `brand_id`, `provider`, and error *category* — never prompt text, never key |

**No new violations. No complexity exceptions required.**

---

## Complexity Tracking

No violations. Section not required.
