# Phase 0 Research: Image Generation

**Branch**: `006-generation` | **Date**: 2026-04-11

## Summary

No blocking unknowns. All technical decisions were either (a) already locked in the spec via the clarification session (120 s timeout, zero retries, fixed watermark, FR-033 provider default, FR-034 filename format), or (b) inherited from the Phase 1 database schema and the existing Phase 3/4 backend patterns. The only net-new technical concern is **how to enforce a uniform 120 s provider-call timeout across two very different provider SDKs** — this is resolved in Decision 3 below.

---

## Decision 1: Gemini SDK choice — `google-genai` vs. raw HTTPX

**Decision**: Use the **official `google-genai` Python SDK** (imported as `from google import genai`, version `>=1.0.0`).

**Rationale**:

- **Constitutional requirement** (§II Non-Negotiables): "The system MUST use only official API endpoints for OpenAI and Gemini; no proxies or unofficial APIs." The `google-genai` package is Google's official Python SDK for the Generative Language API and is maintained in Google's `googleapis` GitHub org.
- **Image response parsing is non-trivial**: Gemini returns image data inside `response.candidates[0].content.parts[*].inline_data`, base64-encoded. The SDK exposes this as a typed structure (`GenerateContentResponse`); a hand-rolled HTTPX client would need to re-implement this parsing.
- **Request payload shape is evolving**: Image-generation support on `generateContent` is newer, and the specific `image_config` with `aspect_ratio` + `image_size` is encoded via typed config objects (`types.GenerateContentConfig`, `types.ImageConfig`). The SDK tracks these changes; a raw HTTPX caller would need to chase them manually.
- **Already available locally** (`python3 -c "import google.genai; print(google.genai.__version__)"` returns `1.52.0` on the dev machine), confirming pip install works without bespoke indexes.

**Alternatives considered**:

- **Raw `httpx` against `https://generativelanguage.googleapis.com/v1beta/models/.../:generateContent`**: Rejected — forces us to track Gemini's wire format ourselves; provides no benefit when the official SDK exists.
- **`google-generativeai` (older SDK)**: Rejected — this is the legacy SDK; `google-genai` supersedes it per Google's public migration guide.

**Implementation impact**: Add `google-genai>=1.0.0` to `backend/requirements.txt`. No runtime config changes — the SDK reads the API key from the `api_key` kwarg on `genai.Client(...)`, not from an environment variable, which is exactly what we need for the BYOK model.

---

## Decision 2: OpenAI client choice — raw HTTPX vs. `openai` SDK

**Decision**: Continue using **raw `httpx`** directly against `https://api.openai.com/v1/images/generations`, mirroring the Phase 4 `services/provider_validation.py` pattern.

**Rationale**:

- **Consistency**: Phase 4 already uses `httpx` for OpenAI key validation (`services/provider_validation.py::validate_openai_key`). Adding the `openai` SDK for one endpoint creates a split-brain where half of OpenAI calls go through the SDK and half through HTTPX.
- **Trivial surface area**: The OpenAI images endpoint takes a JSON body and returns a JSON response — no streaming, no tool calls, no complex types. HTTPX covers this in 10 lines.
- **Timeout enforcement is cleaner**: `httpx.AsyncClient(timeout=httpx.Timeout(120.0))` gives us one place to enforce FR-031 uniformly (connect + read + pool + write). The `openai` SDK accepts a `timeout` kwarg per call, but it's applied inside the SDK's own transport, making it harder to observe in tests.
- **Zero new dependencies**: `httpx` is already in `requirements.txt`.

**Alternatives considered**:

- **`openai>=1.0.0` async client**: Rejected for consistency and to avoid adding a dependency for one endpoint.

---

## Decision 3: Enforcing the 120 s timeout uniformly across both providers (FR-031)

**Problem**: OpenAI is called via `httpx.AsyncClient` (async-native, supports `httpx.Timeout(120.0)`). Gemini is called via the **synchronous** `google-genai` SDK method `client.models.generate_content(...)`, which at the current SDK version does not expose a reliable top-level timeout parameter and blocks the calling thread.

**Decision**:

1. **OpenAI**: Set `httpx.Timeout(120.0)` on the `AsyncClient`. On timeout, `httpx.TimeoutException` is raised — the router catches it and maps to the `TIMEOUT` error category.
2. **Gemini**: Wrap the blocking SDK call in **`asyncio.to_thread(...)`** to run it off the event loop, then wrap **that** call in **`asyncio.wait_for(..., timeout=120.0)`**. On timeout, `asyncio.wait_for` raises `asyncio.TimeoutError` and cancels the awaited task.
3. **In the router**, both providers are awaited the same way and both `httpx.TimeoutException` and `asyncio.TimeoutError` are caught and mapped to the same `ProviderError('TIMEOUT', ...)`.

**Known limitation**: `asyncio.wait_for` can cancel the *awaiter*, but `asyncio.to_thread` runs the work on a thread-pool executor that **does not support cancellation**. Concretely, after 120 s elapses:
- The router observes a `TimeoutError` and updates the generation row to `failed` → the user sees a timeout error.
- The underlying SDK thread may continue running until the HTTP call in the SDK eventually completes or errors out. It will write nothing (the awaiter is gone).
- Worst case: a single thread pool slot is occupied for some extra seconds/minutes. Thread pool exhaustion is not a concern at MVP scale (one generation per user per form, no queue).

**Rationale**: This is the idiomatic async pattern for mixing sync SDKs into an async FastAPI handler. The one-shot thread-pool leak is acceptable for MVP and mirrors how most Python projects wrap the `openai` sync client in async code. Upgrading to a fully-async Gemini SDK (when Google publishes one) removes the concern entirely.

**Alternatives considered**:

- **Run the sync `google-genai` call inline (blocking the event loop)**: Rejected — blocks ALL concurrent requests for up to 120 s.
- **Spawn a subprocess per Gemini call**: Rejected — massive overhead, complicates testing.
- **Skip the timeout and rely on the SDK's internal timeout**: Rejected — the SDK does not expose a reliable 120 s timeout knob, and clarification Q1 locked the spec on a 120 s ceiling.

---

## Decision 4: Storage access pattern — public URL vs. signed URL

**Decision**: Use the **public bucket URL** format: `{SUPABASE_URL}/storage/v1/object/public/{STORAGE_BUCKET}/{image_path}`, identical to the Phase 3 brand-logo pattern (`routers/brands.py::_build_logo_url`).

**Rationale**:

- **The `brand-assets` bucket is already public** (confirmed in the Phase 1 implementation plan and by existing Phase 3 code using public URLs for logos). Brand isolation is enforced at the database layer via RLS + ownership checks, and paths are unguessable UUIDs — the "Single public bucket, unguessable path" assumption already declared in the spec.
- **Signed URLs would add complexity** (expiry management, re-signing on each fetch, session plumbing) with no security benefit when the path itself is a UUID.
- **The Download button approach** (fetch blob → Object URL → `<a download>`) works identically with public and signed URLs, so we preserve the flexibility to switch later with zero frontend changes.

**Alternatives considered**:

- **Signed URLs with a 10-minute expiry**: Rejected — no security benefit for MVP; complicates client caching.
- **Proxy through FastAPI**: Rejected as the default — listed as Decision 7 below as a *fallback* only.

---

## Decision 5: Prompt composition order

**Decision**: When composing the full prompt, the order is **always** `[brand_context_summary?] → [logo_instruction?] → "Image Request:\n" + user_prompt`, joined by `\n\n`.

**Rationale**: Matches the implementation plan pseudocode (lines 838–846 of `docs/implementation-plan.md`) and is consistent with how prompt engineering best practices order context-before-ask. Also prevents the cheaper implementation model from accidentally interleaving the user's prompt with the brand context in ways that could leak identity keywords into the middle of a creative request.

**Alternatives considered**: None meaningful — the order is determined by the existing reference implementation.

**Edge case**: `logo_mode='prompt'` on a brand **without** a logo asset produces **no** logo instruction. Rationale: we must never tell the provider to "incorporate the brand logo" when we have no logo to enforce that promise. This is asserted in `test_prompt_composer.py`.

---

## Decision 6: Cross-origin Download → forced filename (FR-034)

**Problem**: The browser saves a file with the server's `Content-Disposition` filename. Supabase public bucket URLs do not serve `Content-Disposition: attachment; filename="..."`. A naive `<a href={image_url} download>` will either ignore the `download` attribute (cross-origin without CORS) or use the URL basename (the UUID), not the FR-034 format.

**Decision**: In `generator-result.tsx`, the Download button handler runs:

```typescript
const response = await fetch(result.image_url)       // CORS fetch
const blob = await response.blob()
const url = URL.createObjectURL(blob)                 // blob: URL → same origin
const a = document.createElement('a')
a.href = url
a.download = result.download_filename                 // Now honored (same origin)
document.body.appendChild(a); a.click(); a.remove()
URL.revokeObjectURL(url)
```

**Prerequisite**: Supabase Storage public buckets must serve `Access-Control-Allow-Origin: *` for the PNG. Supabase's default public bucket CORS config satisfies this (confirmed in Supabase docs) and is already relied upon by Phase 3 for brand-logo display.

**Verification**: Task T020 in `tasks.md` includes an explicit DevTools Network-tab check that the fetch succeeds and the downloaded file has the FR-034 filename.

**Fallback (not implemented in Phase 6 unless the prerequisite fails)**: Add `GET /brands/{brand_id}/generations/{gen_id}/download` that streams the PNG with `Content-Disposition: attachment; filename="{sanitized}"`. This is a one-file addition that the cheaper implementation model can do later; it does not require any architectural change.

---

## Decision 7: Pillow compositing — `paste` vs. `alpha_composite`

**Decision**: Use **`Image.alpha_composite`** for the watermark overlay (not the `paste(logo, (x, y), logo)` pattern from the implementation plan pseudocode).

**Rationale**:

- **`alpha_composite` is mathematically correct** for semi-transparent overlays: it performs Porter-Duff "over" compositing using both the foreground and background alpha channels. `paste` with a mask blends the foreground's RGB with the background's RGB but does not correctly combine alpha channels.
- **We need the 70% opacity watermark to blend naturally** over arbitrary backgrounds (sky, dark product shots, busy scenes). `alpha_composite` delivers this correctly; `paste` can produce visible edge artifacts where the logo meets busy underlying pixels.
- **Cost is identical** — both run in native Pillow code, neither affects runtime in any measurable way at these image sizes.

**Implementation note**: Because `alpha_composite` requires both images to be RGBA, the function opens the base image as `.convert("RGBA")`, composites, then writes out via `.convert("RGB")` before `save(format="PNG")` — preserving constitutional PNG-only output without carrying a permanent alpha channel into the final file.

**Alternatives considered**:

- **`image.paste(logo, (x, y), logo)`** (from the implementation plan pseudocode): Functional but technically incorrect for semi-transparent logos. We're deliberately diverging from the pseudocode here because the spec's fixed 70% opacity value (FR-019) makes correctness visible.

---

## Decision 8: Database write strategy — three separate updates vs. one aggregate

**Decision**: Three separate writes to the `generations` row during the pipeline:

1. `INSERT ... status='pending'` (creation)
2. `UPDATE ... status='processing'` (after enter try block)
3. `UPDATE ... status='succeeded' + image_path + completed_at + provider_request_id` (on success) OR `UPDATE ... status='failed' + error_code + error_message + completed_at` (on failure)

**Rationale**:

- **FR-011 explicitly mandates** the `pending → processing → succeeded|failed` lifecycle. Skipping `processing` would violate the requirement, even if the total time between states is milliseconds.
- **Operational visibility**: If a generation ever hangs (e.g., the SDK deadlocks before the timeout fires), support can see the row stuck in `processing` and investigate. A single-write "succeeded or failed" model would not distinguish "never started" from "stuck mid-call."
- **The extra writes are cheap**: Three sub-ms PostgreSQL UPDATEs over a network that is already waiting on a 90-second-plus provider call add negligible latency.
- **The DB CHECK constraint** from Phase 1 (`00006_create_generations.sql`) already permits all three intermediate states — we are not fighting the schema.

**Alternatives considered**:

- **Single write at the end**: Rejected — violates FR-011 and loses operational visibility.
- **Stream status via WebSocket**: Out of scope; synchronous request/response model was assumed in the spec.

---

## Decision 9: Where to enforce the FR-033 provider pre-selection

**Decision**: **Frontend only.** The backend always trusts the `provider` field from the request; the frontend applies the FR-033 rule at mount time using `useActiveKeys`.

**Rationale**:

- FR-033 is a UX default, not a security constraint. The user is allowed to freely switch providers afterward (stated in FR-033). There is nothing for the backend to enforce.
- Keeping the rule in the frontend means a single place to update the default logic if the clarification is revisited later.
- The backend already handles the "no active key" case via FR-008 / FR-009 with a 400 `NO_ACTIVE_KEY` response, so there's defense-in-depth regardless of which provider the client picks.

**Alternatives considered**:

- **Server-side default in the `GenerateRequest` schema**: Rejected — the request would no longer be idempotent (the same payload would behave differently depending on key state), which is confusing and out of line with how the rest of the API works.

---

## Decision 10: Test strategy — unit-only Phase 6, manual integration

**Decision**: Phase 6 ships with **pure unit tests** for the six service modules (post-process, watermark, prompt composer, presets, error mapping, filename helpers) plus manual curl/browser verification for the full pipeline.

**Rationale**:

- The existing `backend/tests/conftest.py` has no Supabase mock (confirmed via 005-brand-kit plan — §A.5). Building one just for Phase 6 is out of scope and would duplicate effort Phase 7/8 will have to repeat.
- The service modules are pure (`bytes → bytes`, `dict → str`, etc.) and are where the real complexity lives — exactly what unit tests are good at.
- The router is essentially orchestration code. Its correctness is easy to verify manually with two real API keys (one per provider) and three presets. Manual verification is already the pattern used in Phases 3–5.
- Constitution §VII allows "RLS policies tested OR explicit integration checks documented," and the tasks.md DoD block documents every integration check with its exact curl invocation.

**Alternatives considered**:

- **Build a full Supabase mock layer**: Rejected — large refactor, orthogonal to Phase 6's scope.
- **Record-and-replay provider responses with VCR**: Rejected — maintaining cassette fixtures for two providers across edge cases adds ongoing cost for a single phase.

---

## Unresolved items

**None.** All ambiguities were resolved either in the clarification session or by the decisions above.
