# Data Model: Image Generation

**Branch**: `006-generation` | **Date**: 2026-04-11

## Existing Table (no migration needed)

The `generations` table and its RLS policy were created in Phase 1. This feature **only reads and writes** to it via the existing shape — no new columns, no new indexes, no new constraints.

```text
generations
├── id                    UUID (PK, default gen_random_uuid())
├── brand_id              UUID (FK → brands.id ON DELETE CASCADE)
├── prompt                TEXT (3–4000 chars after trim) — FR-022: raw user prompt only
├── provider              provider_t enum — 'openai' | 'gemini'
├── model                 TEXT (3–100 chars) — e.g. 'gpt-image-1.5' | 'gemini-3-pro-image-preview'
├── platform_preset       platform_preset_t enum — one of the 13 preset identifiers
├── width                 INT (256–4096)
├── height                INT (256–4096)
├── logo_mode             logo_mode_t enum — 'none' | 'prompt' | 'watermark' | 'both', default 'none'
├── status                generation_status_t enum — 'pending' | 'processing' | 'succeeded' | 'failed'
├── provider_request_id   TEXT | NULL — provider's tracking id (OpenAI x-request-id, Gemini response_id)
├── image_path            TEXT | NULL — REGEX: '^brands/[0-9a-f-]+/generations/[0-9a-f-]+\.png$'
├── error_code            TEXT | NULL — one of: INVALID_KEY, RATE_LIMITED, CONTENT_POLICY,
│                                                TIMEOUT, NETWORK, EMPTY_RESPONSE,
│                                                PROVIDER_CLIENT_ERROR, PROVIDER_SERVER_ERROR,
│                                                INTERNAL_ERROR
├── error_message         TEXT | NULL — human-readable (truncated at 1000 chars)
├── created_at            TIMESTAMPTZ (default now())
├── updated_at            TIMESTAMPTZ (default now(), trigger-updated)
└── completed_at          TIMESTAMPTZ | NULL
```

### Constraints Already in the Database (Phase 1)

From `supabase/migrations/00006_create_generations.sql`:

1. `char_length(btrim(prompt)) BETWEEN 3 AND 4000` — matches FR-002
2. `char_length(model) BETWEEN 3 AND 100`
3. `width BETWEEN 256 AND 4096`, `height BETWEEN 256 AND 4096`
4. `image_path IS NULL OR image_path ~ '^brands/[0-9a-f-]+/generations/[0-9a-f-]+\.png$'` — enforces the filename convention + `.png` suffix
5. **Status × completeness CHECK** — exactly one of three shapes:
   - `status = 'succeeded'` → `image_path IS NOT NULL AND error_code IS NULL AND error_message IS NULL AND completed_at IS NOT NULL`
   - `status = 'failed'` → `image_path IS NULL AND error_code IS NOT NULL AND completed_at IS NOT NULL`
   - `status IN ('pending', 'processing')` → `image_path IS NULL AND error_code IS NULL AND error_message IS NULL AND completed_at IS NULL`

**Consequence**: The three database writes in the pipeline (insert `pending` → update `processing` → update `succeeded`/`failed`) must each conform to the matching CHECK shape. Any attempt to mark `succeeded` without an `image_path`, or `failed` without an `error_code`, is rejected at the DB layer — so the service code cannot silently produce invalid rows even if a logic bug slips through.

### Indexes Already in the Database (Phase 1)

- `idx_generations_brand_created (brand_id, created_at DESC)` — used by Phase 7 history listing; touched here only for writes (index maintenance cost is negligible)
- `idx_generations_brand_status_created (brand_id, status, created_at DESC)`
- `idx_generations_brand_provider_created (brand_id, provider, created_at DESC)`

### RLS Policy Already in the Database (Phase 1)

```sql
CREATE POLICY generations_owner_all ON generations FOR ALL
  USING (is_brand_owner(brand_id))
  WITH CHECK (is_brand_owner(brand_id));
```

The backend uses the service client (which bypasses RLS) and enforces ownership via the explicit `_get_brand_or_404(brand_id, current_user.id)` check at the router boundary — the same defense-in-depth pattern used by Phases 3–5.

---

## Lifecycle State Machine

```text
            INSERT
              │
              ▼
          ┌─────────┐
          │ pending │
          └─────────┘
              │
              │ UPDATE status='processing'
              ▼
          ┌────────────┐
          │ processing │
          └────────────┘
              │
       ┌──────┴──────┐
       │             │
  SUCCESS          FAILURE
       │             │
       ▼             ▼
 ┌───────────┐ ┌────────┐
 │ succeeded │ │ failed │
 └───────────┘ └────────┘
```

**Invariants**:

- The row spends O(ms) in `pending` (only between the INSERT and the first UPDATE).
- The row spends the bulk of its lifetime in `processing` (dominated by the up-to-120 s provider call + post-processing + upload).
- Terminal states (`succeeded`, `failed`) are final — no re-transitions. A retry creates a **new** generation row with a **new** `id`.
- No row ever remains in `pending` or `processing` after the HTTP request returns — the `try/except/finally` structure in the router guarantees a terminal UPDATE before the response or a `_mark_failed` call in an `except` branch (verified in tasks.md T024 DoD check).

---

## Data Ownership and Cascade

```text
auth.users
    │ 1:1
profiles
    │
brands (owner_user_id → auth.users)
    │ 1:N
    ├── brand_kits (FK brand_id, ON DELETE CASCADE)
    ├── provider_keys (FK brand_id, ON DELETE CASCADE)
    └── generations (FK brand_id, ON DELETE CASCADE)  ← Phase 6 touches only this table
```

- `ON DELETE CASCADE` from `brands.id` means deleting a brand will remove all its generations automatically. Phase 7 owns the hard-delete flow that additionally removes stored PNGs from the `brand-assets` bucket.

---

## Storage Object

**Bucket**: `brand-assets` (public, already provisioned)
**Path**: `brands/{brand_id}/generations/{generation_id}.png`
**Content-Type**: `image/png` (always — FR-023, Constitution §II)
**Write**: only when the pipeline reaches the "upload" step (after post-processing + watermarking)
**Read**: via the bucket's public URL: `{SUPABASE_URL}/storage/v1/object/public/brand-assets/{image_path}`
**Delete**: not in Phase 6 (Phase 7 only)

**Failure guarantee**: If any step before upload fails, no storage object is written. If upload itself fails (e.g., Storage outage), the generation is marked `failed` with `error_code='INTERNAL_ERROR'` and no orphaned DB row references a non-existent file (the CHECK constraint ensures `image_path` is NULL on a `failed` row).

---

## Read Dependencies (tables this feature reads)

- **`brands`** — for ownership check and `logo_path` (to detect whether watermark modes are applicable and to download the logo bytes).
- **`provider_keys`** — for the active key row matching `(brand_id, provider, is_active=true)`. Phase 4 already enforces at most one active key per `(brand_id, provider)` pair.
- **`brand_kits`** — for the `summary` column on rows with `status='complete'`. A missing row or non-complete status is treated as "no brand context" (FR-014).

---

## Write Dependencies (tables this feature writes)

- **`generations`** — 1 INSERT + up to 2 UPDATEs per request (see Lifecycle above).
- **`provider_keys`** — 1 UPDATE of `last_used_at` on success only (FR-020, step 3).
- **`brand-assets` Storage bucket** — 1 PNG upload on success.

---

## Fields that are NOT persisted (deliberately)

- The **enriched/combined prompt** (brand context + logo instruction + user prompt) sent to the provider. FR-022 mandates the row stores the raw user prompt only. The full prompt is composed in memory, sent to the provider, and discarded.
- The **raw provider response payload** (metadata, usage counts, etc.). Only `provider_request_id` is kept for operational traceability.
- The **provider API key**. Already hard-ruled by Constitution §II — the key exists in memory only for the duration of the single provider call and is never persisted, logged, or returned.
