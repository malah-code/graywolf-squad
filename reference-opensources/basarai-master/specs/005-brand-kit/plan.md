# Implementation Plan: Brand Kit Interview

**Branch**: `005-brand-kit` | **Date**: 2026-04-11 | **Spec**: [spec.md](./spec.md)  
**Input**: Feature specification from `/specs/005-brand-kit/spec.md`

---

## Summary

Implement the Brand Kit Interview feature: a 7-screen wizard (1 read-only intro + 5 input screens + 1 review screen) that collects brand identity answers (tagline, tone, audience, colors, avoid words), persists them via a single `PUT /brands/{id}/kit` call from the review screen, and displays the server-derived brand context summary. A clickable kit status badge is added to the brand navigation. No new database migrations are required — the `brand_kits` table and its RLS policies exist from Phase 1.

---

## Technical Context

**Language/Version**: Python 3.13 (backend), TypeScript 5.x / Next.js 14 (frontend)  
**Primary Dependencies**: FastAPI + Pydantic 2.x (backend); shadcn/ui, Tailwind CSS, react-hook-form (not used for wizard), Lucide React, zod (frontend)  
**Storage**: Supabase PostgreSQL — `brand_kits` table (already migrated)  
**Testing**: pytest (backend)  
**Target Platform**: Bunny Magic Container (Linux, single image)  
**Project Type**: web-service (FastAPI) + web-app (Next.js 14 App Router)  
**Performance Goals**: Kit save round-trip under 2 seconds perceived by user  
**Constraints**: No new DB migrations; no new npm packages; `brand_kits` table already RLS-enabled  
**Scale/Scope**: One kit per brand, low data volume; no new Vault or Storage usage

---

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Check | Notes |
|-----------|-------|-------|
| Brand Isolation | ✅ PASS | `GET` and `PUT` both call `_get_brand_or_404(brand_id, user_id)` before any kit operation |
| Hard Delete | ✅ PASS | `brand_kits` cascades with `brands` (already in schema); no additional storage assets |
| Key Secrecy | ✅ N/A | No provider keys touched in this feature |
| Official Endpoints | ✅ N/A | No external API calls |
| PNG Output | ✅ N/A | No image generation |
| RLS | ✅ PASS | `brand_kits` RLS enabled from Phase 1; backend uses service client with server-side ownership check |
| Server-side Brand ID Verification | ✅ PASS | `_get_brand_or_404` called before every read/write operation |
| Client-never-calls-providers | ✅ N/A | No provider calls |

**No violations. No complexity exceptions required.**

---

## Project Structure

### Documentation (this feature)

```text
specs/005-brand-kit/
├── plan.md              ← this file
├── research.md          ← Phase 0 output
├── data-model.md        ← Phase 1 output
├── quickstart.md        ← Phase 1 output
├── contracts/
│   └── kit-api.md       ← Phase 1 output
├── checklists/
│   └── requirements.md
└── tasks.md             ← Phase 2 output (from /speckit.tasks)
```

### Source Code

```text
backend/
├── app/
│   ├── main.py                          ← MODIFY: register kit router
│   ├── models/
│   │   └── kit.py                       ← NEW: ToneEnum, KitStatusEnum, KitAnswers,
│   │                                            UpsertKitRequest, KitResponse
│   ├── routers/
│   │   └── kit.py                       ← NEW: GET + PUT /brands/{id}/kit
│   └── services/
│       └── kit_summary.py               ← NEW: derive_summary(), derive_status()
└── tests/
    ├── test_kit_summary.py              ← NEW: unit tests for status + summary derivation
    └── test_kit_models.py               ← NEW: unit tests for Pydantic validators

frontend/
├── app/
│   └── (dashboard)/
│       └── [brandId]/
│           ├── layout.tsx               ← MODIFY: fetch brand data, render KitStatusBadge
│           └── kit/
│               └── page.tsx             ← NEW: client component, renders KitWizard
├── components/
│   └── kit/
│       ├── kit-wizard.tsx               ← NEW: multi-step wizard container (state + nav)
│       ├── kit-status-badge.tsx         ← NEW: clickable status badge for nav
│       ├── color-slot.tsx               ← NEW: native color picker + hex text input pair
│       └── steps/
│           ├── step-name.tsx            ← NEW: Step 1 — read-only brand name display
│           ├── step-tagline.tsx         ← NEW: Step 2 — tagline text input
│           ├── step-tone.tsx            ← NEW: Step 3 — tone selector (5 options)
│           ├── step-audience.tsx        ← NEW: Step 4 — audience text area
│           ├── step-colors.tsx          ← NEW: Step 5 — up to 3 ColorSlots
│           ├── step-avoid-words.tsx     ← NEW: Step 6 — avoid words text area
│           └── step-review.tsx          ← NEW: Final step — summary preview + Save button
├── hooks/
│   └── use-kit.ts                       ← NEW: fetch + save kit; returns { kit, loading, error, saveKit }
└── types/
    └── index.ts                         ← MODIFY: add ToneOption, KitStatus, KitAnswers,
                                                   BrandKit, UpsertKitRequest
```

**Structure Decision**: Web application (Option 2). Backend is FastAPI in `backend/`, frontend is Next.js in `frontend/`. New files follow established feature patterns: model → router → service (backend); hook → page → components (frontend).

---

## Implementation Phases

### Phase A: Backend

#### A.1 — Kit Summary Service (`backend/app/services/kit_summary.py`)

Create a pure utility module — no FastAPI, no DB calls.

**`derive_status(answers) → KitStatusEnum`**:
- `complete` if `tone` and `audience` are not None and `len(colors) >= 1`
- `not_started` if tone is None and audience is None and colors is empty
- `in_progress` otherwise

**`derive_summary(brand_name, answers) → str | None`**:
- Returns `None` if status is `not_started`
- Formats the 6-line template per the implementation plan spec:
  ```text
  Brand: {brand_name}
  Tagline: {tagline or "None specified"}
  Tone: {tone}
  Audience: {audience}
  Colors: {", ".join(colors)}
  Avoid: {avoid_words or "None specified"}
  ```

#### A.2 — Kit Pydantic Models (`backend/app/models/kit.py`)

- `ToneEnum` and `KitStatusEnum` as `str, Enum`
- `KitAnswers`: Pydantic model with field validators:
  - `tagline`: strip whitespace, reject if trimmed > 160 chars
  - `audience`: strip; reject if provided and trimmed length < 2 or > 500
  - `colors`: validate each item matches `^#[0-9A-Fa-f]{6}$`; reject if `len > 3`
  - `avoid_words`: strip; reject if provided and trimmed > 500 chars
- `UpsertKitRequest`: wraps `KitAnswers`
- `KitResponse`: flat response with `brand_id`, `brand_name`, `answers`, `summary`, `status`, `completed_at`, `updated_at`

#### A.3 — Kit Router (`backend/app/routers/kit.py`)

Follow the exact same pattern as `brands.py` and `keys.py`:
- `_error_response(status_code, code, message) → HTTPException`
- `_get_brand_or_404(brand_id, user_id) → dict` — identical helper (ownership check)

**`GET /brands/{brand_id}/kit`**:
1. `_get_brand_or_404(brand_id, current_user.id)` — raises 404 if not owned
2. Query `brand_kits` where `brand_id = brand_id`
3. If no row: return default `KitResponse` with empty answers, `status="not_started"`, all nulls
4. Map row to `KitResponse` and return

**`PUT /brands/{brand_id}/kit`**:
1. `_get_brand_or_404(brand_id, current_user.id)` — raises 404 if not owned
2. Derive status from `body.answers` using `derive_status()`
3. Derive summary from brand name + answers using `derive_summary()`
4. Build upsert payload: all answer fields + `summary`, `status`, `completed_at` (set to now() on complete, None otherwise)
5. Upsert into `brand_kits` (insert + on_conflict=`brand_id` update all columns)
6. Map result to `KitResponse` and return

**Error codes:**
- `BRAND_NOT_FOUND` (404)
- `VALIDATION_ERROR` (400) — raised by Pydantic validators

#### A.4 — Register Router (`backend/app/main.py`)

Add `from app.routers import kit` and `app.include_router(kit.router)` alongside the existing routers.

#### A.5 — Backend Tests

Split into two pure-unit-test files (the existing `tests/conftest.py` has no Supabase mock, so endpoint-level integration tests are deferred to manual verification in the polish phase).

**`backend/tests/test_kit_summary.py`** — covers `derive_status` and `derive_summary`:
- `derive_status` returns `not_started` when all answer fields are None/empty
- `derive_status` returns `complete` when tone + audience + ≥1 color are present
- `derive_status` returns `in_progress` when only tagline is set
- `derive_status` returns `in_progress` when tone + audience present but colors empty
- `derive_summary` returns `None` when status is `not_started`
- `derive_summary` includes the brand name
- `derive_summary` shows "None specified" for missing optional fields
- `derive_summary` joins colors with `", "`

**`backend/tests/test_kit_models.py`** — covers `KitAnswers` Pydantic validators:
- Valid answers construct without error
- Tagline > 160 chars raises ValueError
- Audience < 2 chars or > 500 chars raises ValueError
- More than 3 colors raises ValueError
- Invalid hex color raises ValueError
- Lowercase hex colors are uppercased after validation
- Avoid words > 500 chars raises ValueError
- Whitespace-only strings become None

**Cross-user authorization (FR-010)** is verified manually in the polish phase via an explicit curl-based check (see tasks.md T024) — acceptable per Constitution §VII ("RLS policies tested OR explicit integration checks documented").

---

### Phase B: Frontend

#### B.1 — TypeScript Types (`frontend/types/index.ts`)

Append to the existing file:
- `ToneOption`, `KitStatus`, `KitAnswers`, `BrandKit`, `UpsertKitRequest`

#### B.2 — Data Hook (`frontend/hooks/use-kit.ts`)

Follow the `use-brand.ts` pattern:
- `useKit(brandId: string)` — fetches `GET /brands/{brandId}/kit`
- Returns `{ kit, loading, error, refetch }`
- `saveKit(brandId: string, answers: KitAnswers): Promise<BrandKit>` — calls `PUT`, exported separately or as part of hook

#### B.3 — `ColorSlot` Component (`frontend/components/kit/color-slot.tsx`)

```text
Props: { value: string; onChange: (hex: string) => void; onRemove: () => void }
```
- Renders `<input type="color">` + `<input type="text">` side by side
- Both inputs sync to the same `value`
- Text input validates hex on blur; shows error border if invalid
- Remove button (×) triggers `onRemove`

#### B.4 — Wizard Screen Components (`frontend/components/kit/steps/`)

Each screen receives `{ answers: KitAnswers; onChange: (partial: Partial<KitAnswers>) => void; brandName: string }`. All step files use named exports so the wizard can import them by name.

- **Screen 1 (Name)**: Displays brand name as read-only text. No inputs. "This is the brand name you registered."
- **Screen 2 (Tagline)**: Single `<input>` bound to `answers.tagline`. Character counter (0/160).
- **Screen 3 (Tone)**: 5 radio cards or buttons, one per tone option. Selected option highlighted.
- **Screen 4 (Audience)**: `<textarea>` bound to `answers.audience`. Character counter (0/500). Required field indicator.
- **Screen 5 (Colors)**: Renders up to 3 `ColorSlot` components. "+ Add Color" button (disabled when 3 slots exist). Remove button per slot.
- **Screen 6 (Avoid Words)**: `<textarea>` bound to `answers.avoid_words`. Character counter (0/500).
- **Screen 7 (Review)**: Displays all answers in a read-only summary card. Renders the **server-derived** summary passed in via `savedSummary` prop (no client-side re-derivation — backend is the single source of truth). Shows a "Summary will update after Save" hint when dirty. **Save** button triggers save.

> Note: The wizard has 7 screens total — 1 intro + 5 input + 1 review — corresponding to the 5 input fields in FR-002 plus a read-only intro for the brand name and a final review/save screen. This matches spec FR-005 (which describes the 7-screen model explicitly).

#### B.5 — Wizard Container (`frontend/components/kit/kit-wizard.tsx`)

```text
Props: { brandId: string; brandName: string; initialKit: BrandKit }
```

State:
- `step: number` (0–6, representing the 7 wizard screens)
- `answers: KitAnswers` (initialized from `initialKit.answers`)
- `savedSummary: string | null` (initialized from `initialKit.summary`; updated on each successful save)
- `isDirty: boolean` (set to `true` on first change, `false` after save)
- `saving: boolean`
- `saveError: string | null`

Behavior:
- Back/Next buttons advance `step`; Back on screen 0 is hidden/disabled
- Screen progress indicator (e.g., "Screen 2 of 7")
- On Save (review screen): `PUT /brands/{brandId}/kit`, capture the returned `summary` into `savedSummary`, then call `router.refresh()` to update the nav badge, set `isDirty = false`
- Unsaved warning: `useEffect` attaches `beforeunload` listener when `isDirty = true`; Phase 4 adds an additional click-delegated anchor interceptor for in-app navigation

#### B.6 — Kit Status Badge (`frontend/components/kit/kit-status-badge.tsx`)

```text
Props: { status: KitStatus; brandId: string }
```

- Renders a small colored badge: grey (not_started), yellow (in_progress), green (complete)
- The entire badge is wrapped in `<Link href="/{brandId}/kit">` so clicking navigates to the kit editor
- Status label text: "Not started" / "In progress" / "Complete"

#### B.7 — Brand Layout Modification (`frontend/app/(dashboard)/[brandId]/layout.tsx`)

Refactor `ensureBrandAccess`:
- Change it to return the parsed brand JSON (it already fetches it; just return the data)
- Rename to `getBrandOrRedirect(brandId) → Brand`

In the layout render:
- Render `KitStatusBadge` next to the "Brand Kit" nav link, passing `brand.kit_status` and `brandId`
- `KitStatusBadge` must be a client component (or simply an inline badge if no interactivity beyond Link is needed; since `Link` is fine in RSC, it can stay as a server-rendered badge)

#### B.8 — Kit Page (`frontend/app/(dashboard)/[brandId]/kit/page.tsx`)

Client component (`'use client'`):
- Uses `useParams` for `brandId`
- Uses `useKit(brandId)` for data
- Loading state: spinner/skeleton
- Error state: error message with retry
- Renders `<KitWizard brandId={brandId} brandName={kit.brand_name} initialKit={kit} />`

---

## Constitution Check (Post-Design)

All principles re-verified against the design:

| Principle | Status | Evidence |
|-----------|--------|---------|
| Brand Isolation | ✅ | `_get_brand_or_404` called in both endpoints; `brand_id` verified against `owner_user_id` |
| Hard Delete | ✅ | No new storage assets; kit cascades with brand |
| Key Secrecy | ✅ N/A | |
| Official Endpoints | ✅ N/A | |
| PNG Output | ✅ N/A | |
| RLS | ✅ | Service client bypasses RLS, ownership is enforced in code; existing RLS on `brand_kits` provides defense-in-depth |
| Server-side Brand Verification | ✅ | Both endpoints: ownership check before any DB operation |
| Client-never-calls-providers | ✅ N/A | |

**DoD pre-check for this feature** (verified during Phase 6 — see tasks.md T024 and T024b):
- [ ] Works for a brand with no kit (0 answers) — GET returns `not_started` default  → verified in T017 / T023
- [ ] Works for a brand with a completed kit — GET returns `complete` status + summary  → verified in T017 / T023
- [x] **Works with OpenAI provider — N/A for this feature.** This phase does not call any LLM provider. Marked not applicable.
- [x] **Works with Gemini provider — N/A for this feature.** This phase does not call any LLM provider. Marked not applicable.
- [ ] RLS / cross-user isolation: explicit manual integration check documented in tasks.md **T024b** (curl with another user's JWT must return 404)
- [x] **Hard delete — N/A for this feature.** No new storage assets are introduced. The `brand_kits` row is removed automatically via `ON DELETE CASCADE` from `brands`, which was verified in Phase 3.

Rationale for the three N/A items: this feature adds only database fields, a derived summary, and a UI wizard. It does not call OpenAI/Gemini and does not create new Supabase Storage objects or Vault secrets. The N/A marks are load-bearing — a PR reviewer who sees unchecked boxes should NOT block merge on these.

---

## Complexity Tracking

No violations. Section not required.
