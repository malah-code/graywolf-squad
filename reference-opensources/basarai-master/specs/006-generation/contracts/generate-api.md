# API Contract: Image Generation

**Branch**: `006-generation` | **Date**: 2026-04-11
**Router prefix**: `/brands/{brand_id}`
**Auth**: All endpoints require `Authorization: Bearer <supabase_access_token>` (Supabase JWT verified via JWKS).
**Scope**: **One endpoint only.** List, get, and delete generations are Phase 7 and are explicitly **not** part of Phase 6.

---

## POST /brands/{brand_id}/generate

Generate a single image for a brand. Synchronous — the request blocks until the pipeline reaches a terminal state (`succeeded` or `failed`) or the 120 s provider timeout fires.

### Request

```http
POST /brands/{brand_id}/generate
Authorization: Bearer <token>
Content-Type: application/json

{
  "prompt": "A modern minimal office with natural light, desk plants, and a laptop",
  "provider": "openai",
  "platform_preset": "instagram_post",
  "logo_mode": "watermark"
}
```

#### Request Fields

| Field | Type | Required | Constraints |
|-------|------|----------|-------------|
| `prompt` | string | yes | 3–4000 chars **after trim** (FR-002) |
| `provider` | enum | yes | `"openai"` or `"gemini"` (FR-003) |
| `platform_preset` | enum | yes | One of the 13 identifiers from Reference Table A in the spec (FR-005) |
| `logo_mode` | enum | no (default `"none"`) | `"none"` \| `"prompt"` \| `"watermark"` \| `"both"` (FR-006) |

**Notes for the implementing model**:

- **No `model` field in the request.** The model is resolved server-side from the `provider` field per FR-004 (`openai → gpt-image-1.5`, `gemini → gemini-3-pro-image-preview`). The response echoes the resolved model for transparency and the DB row stores it, but the client does not send it.
- `platform_preset` values are the exact identifiers in the spec's Reference Table A — no invention, no synonyms. Pydantic's `PlatformPresetEnum` will 422 any unknown value.
- `logo_mode` values `watermark` and `both` require the brand to have an uploaded logo (FR-007). The frontend hides/disables these options when no logo exists. The server also validates server-side — see Error Responses below.

### Response — 200 OK (success path)

```json
{
  "id": "12345678-1234-1234-1234-123456789012",
  "prompt": "A modern minimal office with natural light, desk plants, and a laptop",
  "provider": "openai",
  "model": "gpt-image-1.5",
  "platform_preset": "instagram_post",
  "width": 1080,
  "height": 1080,
  "logo_mode": "watermark",
  "status": "succeeded",
  "image_url": "https://xxx.supabase.co/storage/v1/object/public/brand-assets/brands/<brand-uuid>/generations/<gen-uuid>.png",
  "download_filename": "my-brand-instagram_post-20260411-143052.png",
  "error_code": null,
  "error_message": null,
  "created_at": "2026-04-11T14:30:49Z",
  "completed_at": "2026-04-11T14:30:52Z"
}
```

#### Response Fields (Success)

| Field | Type | Notes |
|-------|------|-------|
| `id` | UUID string | Generation id |
| `prompt` | string | **Raw user prompt only** — never the enriched/combined version sent to the provider (FR-022) |
| `provider` | enum | echo of request |
| `model` | string | Resolved from provider (FR-004) — e.g. `gpt-image-1.5` |
| `platform_preset` | enum | echo of request |
| `width`, `height` | int | Exact preset dimensions (SC-002 — always matches Reference Table A, not the provider's native output size) |
| `logo_mode` | enum | echo of request |
| `status` | enum | Always `"succeeded"` on a 200 response |
| `image_url` | string | Public Supabase Storage URL (FR-024) |
| `download_filename` | string | FR-034 filename, ready for the browser `<a download>` attribute |
| `error_code`, `error_message` | `null` | null on success |
| `created_at`, `completed_at` | ISO 8601 | Both populated on success |

### Response — 400 Bad Request (`VALIDATION_ERROR`)

Raised by Pydantic for any body field that fails the schema (prompt too short/long, unknown preset, unknown provider, unknown logo_mode). Matches the existing project-wide error envelope:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Prompt must be at least 3 characters after trimming",
    "request_id": "7a9f..."
  }
}
```

### Response — 400 Bad Request (`NO_ACTIVE_KEY`)

Raised when the brand has no active provider key for the selected provider (FR-009 server-side mirror).

```json
{
  "error": {
    "code": "NO_ACTIVE_KEY",
    "message": "No active openai key for this brand. Add or activate a key on the Keys page.",
    "request_id": "7a9f..."
  }
}
```

### Response — 400 Bad Request (`LOGO_REQUIRED`)

Raised when `logo_mode ∈ {watermark, both}` but the brand has no `logo_path` in the `brands` table. This is a server-side mirror of the frontend's disabled state (FR-007) — defense in depth against stale UI or API clients.

```json
{
  "error": {
    "code": "LOGO_REQUIRED",
    "message": "This logo mode requires an uploaded brand logo. Please upload a logo on the Settings page.",
    "request_id": "7a9f..."
  }
}
```

### Response — 404 Not Found (`BRAND_NOT_FOUND`)

Raised when the authenticated user does not own `brand_id` (FR-029). Follows the existing project pattern — does NOT distinguish "not your brand" from "doesn't exist" to avoid leaking ownership metadata.

```json
{
  "error": {
    "code": "BRAND_NOT_FOUND",
    "message": "Brand not found",
    "request_id": "7a9f..."
  }
}
```

### Response — 502 Bad Gateway (provider failures, `status='failed'`)

Raised when the provider call fails for any reason. The generation row is persisted as `status='failed'` with the same `error_code` and a 1000-char-truncated `error_message` (FR-021). The response body maps to the error category via `services/error_mapping.py`:

| `error_code` | HTTP | User message | Cause |
|--------------|------|--------------|-------|
| `INVALID_KEY` | 502 | "Your provider key was rejected. Please check your keys." | 401 from provider |
| `RATE_LIMITED` | 502 | "The provider is currently rate-limiting your account. Please try again in a moment." | 429 from provider |
| `CONTENT_POLICY` | 502 | "The provider refused this prompt due to its content policy. Please try a different description." | Safety block / policy rejection |
| `TIMEOUT` | 502 | "The request took too long to complete. Please try again." | Provider call exceeded 120 s (FR-031) |
| `NETWORK` | 502 | "Could not reach the provider. Please check your connection and try again." | Connect/DNS/reset |
| `EMPTY_RESPONSE` | 502 | "The provider returned no image. Please try again." | HTTP 200 with no image bytes |
| `PROVIDER_CLIENT_ERROR` | 502 | "The provider rejected this request. Please try again or adjust your prompt." | Other 4xx |
| `PROVIDER_SERVER_ERROR` | 502 | "The provider service is temporarily unavailable. Please try again." | Other 5xx |

```json
{
  "error": {
    "code": "INVALID_KEY",
    "message": "Your provider key was rejected. Please check your keys.",
    "request_id": "7a9f..."
  }
}
```

**Zero automatic retries** (FR-032) — the user retries manually by clicking Generate again, which creates a new row.

### Response — 500 Internal Server Error (`INTERNAL_ERROR`)

Raised when a non-provider step fails (post-processing, watermarking, storage upload, DB write). The generation row is persisted as `status='failed'` with `error_code='INTERNAL_ERROR'`. The response body does not leak technical details:

```json
{
  "error": {
    "code": "INTERNAL_ERROR",
    "message": "Something went wrong. Please try again.",
    "request_id": "7a9f..."
  }
}
```

The full traceback is logged server-side with `logger.exception(...)` and the `request_id` + `generation_id` for operator correlation.

---

## Behavior Contract (Invariants)

These are invariants the implementation must guarantee regardless of the happy path:

1. **Ownership first**: `_get_brand_or_404` runs before any DB insert, Vault read, or provider call. A user who does not own the brand sees no side effects of any kind.
2. **Raw prompt in the row**: `generations.prompt` equals the client-submitted prompt, never the enriched version (FR-022, SC-010).
3. **Exact dimensions**: For every successful row, the stored PNG's pixel dimensions equal `generations.width` and `generations.height`, which equal the Reference Table A values for `generations.platform_preset` (SC-002, SC-009).
4. **Lifecycle completeness**: No generation row ever persists in `pending` or `processing` after the request returns a response (FR-011).
5. **No partial files**: If `status='failed'`, no PNG is present at `brands/{brand_id}/generations/{id}.png` in Storage.
6. **Key secrecy**: The provider API key appears in no response body, no log line, no DB column, and no frontend state at any time (Constitution §II, FR-030).
7. **One attempt**: Exactly one provider HTTP call per request. Zero retries (FR-032).
8. **Download filename correctness**: `download_filename` on a success response matches the regex `^[a-z0-9-]{1,40}-[a-z_]+-\d{8}-\d{6}\.png$` and conforms to FR-034's example `my-brand-instagram_post-20260411-143052.png` for the example inputs.

---

## Out of Scope (Phase 6)

The following endpoints belong to **Phase 7 (History)** and **MUST NOT** be implemented as part of this feature. The cheaper implementation model should ignore any reference to them in `docs/implementation-plan.md`:

- `GET /brands/{id}/generations` — list generations
- `GET /brands/{id}/generations/{genId}` — get generation details
- `DELETE /brands/{id}/generations/{genId}` — hard delete generation

Implementing any of these in Phase 6 is a scope violation. The spec's Out of Scope section lists the same items for belt-and-suspenders.
