# Quickstart: Image Generation

**Branch**: `006-generation` | **Date**: 2026-04-11

This guide walks you through end-to-end verification of Phase 6 once the implementation is complete. It mirrors the acceptance scenarios in the spec and the manual DoD checks from the plan.

---

## Prerequisites

1. Repository on `006-generation` branch with the implementation complete.
2. `.env` files configured for local development:
   - `backend/.env` — `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `STORAGE_BUCKET=brand-assets`
   - `frontend/.env.local` — `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
3. Python deps installed: `cd backend && pip install -r requirements.txt` (this installs the new `google-genai` dep added in Phase 6).
4. A real **OpenAI API key** and a real **Gemini API key** for manual provider verification.
5. A test user account registered in Supabase with at least one brand.

---

## Start the stack

Two terminals:

```bash
# Terminal 1 — backend
cd backend
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000

# Terminal 2 — frontend
cd frontend
npm run dev
```

Open `http://localhost:3000`, sign in, and pick (or create) a brand.

---

## Path 1: Happy path — OpenAI, Instagram Post, no logo

**Covers**: User Story 1 AS1, FR-001, FR-002, FR-003, FR-005, FR-010–FR-020, FR-023, FR-024, FR-025, SC-001, SC-002, SC-009.

1. On the brand page, add an **OpenAI** key via the Keys tab and mark it active.
2. Return to the Generator (brand's root page).
3. Confirm the provider selector has **OpenAI** pre-selected (per FR-033, since OpenAI is the only active provider).
4. Enter the prompt: `A modern minimal office with natural light, desk plants, and a laptop`
5. Pick the **Instagram Post** preset (group: Instagram, dimensions shown: 1080 × 1080).
6. Keep logo mode at `none`.
7. Click **Generate**. Verify:
   - The button becomes disabled and a loading indicator appears (FR-028).
   - Within 90 seconds, the preview area shows a PNG image (SC-001).
   - The image appears to be exactly square (1080 × 1080).
8. Right-click → "Save image as..." on the preview and confirm the dimensions with `file` or an image viewer: width=1080, height=1080 (SC-002).
9. Click **Download**. Verify:
   - A file is saved to disk with the name `{sanitized-brand-name}-instagram_post-<YYYYMMDD-HHmmss>.png` (FR-034).
   - The downloaded file's bytes match the previewed image (SC-007).
10. Inspect the database row:

    ```bash
    # In Supabase SQL editor:
    SELECT id, status, prompt, provider, model, width, height, image_path, error_code, completed_at
    FROM generations
    ORDER BY created_at DESC
    LIMIT 1;
    ```

    Verify:
    - `status = 'succeeded'`
    - `prompt` equals the raw user input (**not** the enriched version — FR-022)
    - `provider = 'openai'`, `model = 'gpt-image-1.5'` (FR-004)
    - `width = 1080`, `height = 1080`
    - `image_path` matches `brands/<brand-id>/generations/<gen-id>.png`
    - `error_code IS NULL`, `completed_at IS NOT NULL`

---

## Path 2: Gemini + YouTube Thumbnail + post-processing correctness

**Covers**: User Story 1 AS2, FR-016, FR-017, FR-018, SC-002, SC-009.

1. Add a **Gemini** key via the Keys tab and mark it active. (OpenAI key can remain active.)
2. Return to the Generator. With both providers active, provider selector should default to **Gemini** (FR-033 rule 2).
3. Keep the same prompt from Path 1.
4. Pick the **YouTube Thumbnail** preset (dimensions shown: 1280 × 720).
5. Keep logo mode at `none`.
6. Click **Generate**.
7. When the preview appears, confirm it is a **16:9 landscape** image at **exactly 1280 × 720**, even though Gemini natively returns a different resolution at the `1:1` / `16:9` / `9:16` aspect ratios with `image_size='1K'`. This verifies `resize_to_preset` is doing scale-to-cover + center-crop correctly (FR-018).
8. Verify the stored PNG matches — same method as Path 1 step 10.
9. In the DB row: `provider = 'gemini'`, `model = 'gemini-3-pro-image-preview'`.

---

## Path 3: Logo watermark (all four modes)

**Covers**: User Story 2 AS1–AS5, FR-007, FR-015, FR-019.

Prerequisites: upload a logo for the brand (Phase 3 feature). Use a PNG with transparency to see the watermark effect clearly.

For each of the four modes, generate once with the Instagram Post preset on OpenAI:

1. **`none`** — Verify the returned image has **no** visible logo overlay and the backend log shows the composed prompt ends at `Image Request:\n…` with no logo instruction.
2. **`prompt`** — Verify the returned image has **no** overlay, but the image itself may incorporate a logo-like element (the provider was told to include it). The backend log should show the composed prompt contains `Incorporate the brand logo naturally into the image.` (redacted if you're doing any log scanning — the line appears only at DEBUG level).
3. **`watermark`** — Verify the returned image has a visible logo in the **bottom-right corner**, at roughly **15% of the image width**, with **~70% opacity**, and with a **20 px margin** from the right and bottom edges (FR-019). Check with an image viewer that shows pixel coordinates.
4. **`both`** — Verify both behaviors: the provider was instructed to incorporate the logo AND the post-processed image has the fixed watermark overlay.

Now remove the brand logo (Phase 3 settings page) and reload the Generator. Verify:

- The `watermark` and `both` options are **disabled or hidden** in the logo mode selector (FR-007).
- Attempting to POST directly to `/brands/{id}/generate` with `logo_mode='watermark'` while the brand has no logo returns `400 LOGO_REQUIRED` (contract defense in depth).

---

## Path 4: Brand kit enrichment

**Covers**: User Story 4 AS1–AS3, FR-014, FR-022, SC-010.

1. Complete the brand kit via the Kit wizard (Phase 5) — fill tagline, tone, audience, colors, avoid words.
2. Back on the Generator, use a short prompt like `product photo` on the Instagram Post preset.
3. Click Generate. Verify the result reflects the brand's tone/colors/audience — e.g., a playful tone produces a different image than a formal tone on the same prompt.
4. Inspect the DB row: `prompt` should be exactly `product photo` (the raw input), **not** the enriched version (FR-022, SC-010).
5. Repeat on a second brand with **no** brand kit. Verify the generation still succeeds and `prompt` is again exactly the raw user input.

---

## Path 5: Provider failure handling

**Covers**: User Story 3 AS1–AS5, FR-021, FR-026, FR-027, FR-032, SC-003, SC-004.

### 5a. Invalid key

1. On a test brand, add an obviously invalid OpenAI key (e.g., `sk-invalid-abcdef`) and mark it active. (Phase 4's validation will flag it, but it should still be persisted as active if you force it through.)
2. Generator → Generate.
3. Verify:
   - The preview area shows a friendly error: "Your provider key was rejected. Please check your keys." (FR-026)
   - The error message includes a link to the Keys page.
   - The form retains the prompt, preset, provider, and logo mode (FR-027).
   - The Generate button is re-enabled.
4. DB row: `status='failed'`, `error_code='INVALID_KEY'`, `error_message` populated, `image_path IS NULL`, `completed_at IS NOT NULL` (SC-003).
5. No PNG file exists at `brands/<brand-id>/generations/<gen-id>.png` in the Storage bucket (invariant #5).

### 5b. Timeout (optional — requires cooperation from the provider)

Hard to reliably trigger. Acceptable substitute: temporarily lower `backend/app/routers/generations.py`'s `asyncio.wait_for` timeout from 120.0 to 0.1 seconds, generate once, and verify:

- The error shows `TIMEOUT` with user message "The request took too long to complete. Please try again."
- DB row has `error_code='TIMEOUT'`, `status='failed'`.
- **Revert the timeout change** before committing.

### 5c. No active key for selected provider

1. Delete or deactivate the brand's OpenAI key.
2. Reload the Generator. Verify:
   - Provider selector still shows OpenAI (if that's the only provider with any key history) but inline "no active key" notice is visible with a link to the Keys page (FR-009).
   - Generate button is disabled (FR-008).
3. Attempt to POST directly with `curl`:

   ```bash
   curl -X POST http://127.0.0.1:8000/brands/<brand-id>/generate \
     -H "Authorization: Bearer <token>" \
     -H "Content-Type: application/json" \
     -d '{"prompt": "test prompt here", "provider": "openai", "platform_preset": "instagram_post", "logo_mode": "none"}'
   ```

   Verify response is `400 NO_ACTIVE_KEY`.

---

## Path 6: Ownership enforcement (FR-029, SC-008)

1. Create two test users: A and B.
2. User A creates a brand and adds a key. Note the brand id.
3. Sign in as User B and obtain a fresh JWT.
4. Attempt to POST as User B to User A's brand:

   ```bash
   curl -X POST http://127.0.0.1:8000/brands/<user-a-brand-id>/generate \
     -H "Authorization: Bearer <user-b-token>" \
     -H "Content-Type: application/json" \
     -d '{"prompt": "this should fail", "provider": "openai", "platform_preset": "instagram_post", "logo_mode": "none"}'
   ```

5. Verify the response is `404 BRAND_NOT_FOUND` (not 403 — the project-wide convention hides ownership).
6. Verify **no** row was inserted into `generations` for the target brand (SC-008).

---

## Path 7: Concurrency guard (FR-028, SC-006)

1. In the Generator, click Generate on a valid form.
2. Before the response arrives, attempt to click Generate again. Verify:
   - The button is disabled for the duration of the in-flight request.
   - The form cannot be submitted a second time.
3. If you can issue a second request via DevTools / curl in parallel, the frontend does not prevent that — but the user-visible behavior is correct (one click → one generation).

---

## Path 8: Key secrecy (Constitution §II, FR-030)

1. Generate one image successfully.
2. Inspect the browser DevTools Network tab → the `POST /brands/<id>/generate` response body. Verify the response contains no key-shaped string (no `sk-...` or `AIza...`).
3. Inspect the backend logs from the `uvicorn` terminal. Verify:
   - `grep -E 'sk-[A-Za-z0-9]{20,}|AIza[A-Za-z0-9_-]{20,}' backend/logs/*` (or stdout) returns nothing.
   - The request_id and generation_id are logged, but the prompt body is not (at INFO level) and the key is never logged at any level.
4. Inspect the `generations` DB row. Verify no column contains the key.

---

## Path 9: Download filename correctness (FR-034)

**Covers**: FR-034, explicit example from the clarification session.

1. Rename (or create) a brand as exactly `My Brand!`.
2. Generate an **Instagram Post** at a known UTC time, e.g. `14:30:52` on 2026-04-11.
3. Click Download. Verify the file is saved as:

   ```text
   my-brand-instagram_post-20260411-143052.png
   ```

   matching the example in FR-034.
4. Test edge cases:
   - Brand named `日本語` (non-ASCII only) → filename starts with `brand-` (fallback).
   - Brand named `!!!---...` → filename starts with `brand-` (fallback after sanitization empties it).
   - Brand named `A very long brand name with many many many many words to test the truncation at forty characters` → the `sanitized-brand-name` portion is exactly 40 chars max.

---

## Definition of Done checklist (Constitution §VII)

After completing all paths above:

- [ ] Works for brand with 0 kit answers (Path 4, second half)
- [ ] Works for brand with complete kit (Path 4, first half)
- [ ] Works with OpenAI provider (Path 1)
- [ ] Works with Gemini provider (Path 2)
- [ ] RLS / cross-user isolation tested (Path 6)
- [ ] Hard delete — **N/A for Phase 6** (Phase 7 owns delete)
- [ ] Lifecycle `pending → processing → succeeded|failed` verified (Paths 1, 5a — DB inspection)
- [ ] Preset dimensions exact (Paths 1, 2 — SC-002)
- [ ] Key secrecy (Path 8)
- [ ] Download filename correct (Path 9 — FR-034)

If every box above is checked, Phase 6 is complete.
