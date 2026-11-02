# Implementation Plan: Generation History

**Branch**: `008-generation-history` | **Date**: 2026-06-07 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/008-generation-history/spec.md`

---

## Summary

Implement brand-scoped generation history on top of the existing `generations` table and `brand-assets` storage paths delivered by Phase 6. The backend adds history read/delete surfaces under the existing brand-scoped generations router: list terminal history items 24 per page with provider/status filters, fetch one generation detail by id, and hard-delete one generation. Every endpoint verifies brand ownership before touching generation records or storage. Delete behavior follows the clarified rule: if a successful generation's image is already missing, delete the history record; if storage removal fails for any other reason, keep the record and return a deletion failure so the owner can retry.

The frontend adds a first-class History area at `/(dashboard)/[brandId]/history/page.tsx` and dedicated detail pages at `/(dashboard)/[brandId]/history/[generationId]/page.tsx`. The list shows newest-first cards, 24-item pagination, provider and terminal-status filters (`succeeded` / `failed` only), empty states, and delete confirmation. The detail page shows full metadata, image/download for successful records, failure details for failed records, and preserves list context when navigating back.

No new database migrations, storage buckets, provider integrations, key handling, prompt reuse, regeneration, bulk actions, cost reporting, or admin features are part of this plan.

---

## Technical Context

**Language/Version**: Python 3.13 (backend), TypeScript 5.x / Next.js 14 App Router (frontend)
**Primary Dependencies**: FastAPI 0.109+, Pydantic 2.x, `supabase-py` for DB/Storage operations; Next.js 14, `@supabase/ssr`, `@supabase/supabase-js`, shadcn/ui conventions, Tailwind CSS, lucide-react
**Storage**: Existing Supabase PostgreSQL `generations` table; existing public Supabase Storage bucket `brand-assets` with paths `brands/{brandId}/generations/{generationId}.png`
**Testing**: Backend `pytest` for model/contract helper tests where pure logic exists; manual end-to-end verification via quickstart for Supabase ownership, storage deletion, pagination, filters, download, and browser navigation
**Target Platform**: Bunny Magic Container (Linux, single image, HTTP-only behind platform HTTPS)
**Project Type**: web-service (FastAPI) + web-app (Next.js 14 App Router)
**Performance Goals**: SC-001 - brand owner with 25 generation records sees first page of 24 newest records in under 2 seconds on normal broadband
**Constraints**: Brand ownership verified server-side before list/detail/delete; no raw provider keys involved or exposed; terminal status filters only (`succeeded`, `failed`); fixed 24 items per page; hard delete removes row and stored PNG when present; missing image is deletion-safe, other storage removal failures block row deletion; no prompt reuse/regeneration/admin/cost/bulk/date/text-search scope
**Scale/Scope**: MVP history for one owner per brand, low to moderate per-brand history volume; leverages existing indexes `(brand_id, created_at DESC)`, `(brand_id, status, created_at DESC)`, and `(brand_id, provider, created_at DESC)`

---

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Check | Evidence |
|-----------|-------|----------|
| I. Product Truth - Brand tenancy | PASS | Every list/detail/delete operation is scoped to one verified brand id and one owner user |
| I. Product Truth - Image generation capability only | PASS | Feature exposes history for generated images only; no new product capability beyond viewing/downloading/deleting generated assets |
| II. Brand Isolation | PASS | `_get_brand_or_404(brand_id, user_id)` pattern runs before generation reads/deletes; detail endpoints also match generation id to brand id |
| II. Hard Delete | PASS | Delete removes the storage PNG before the history record; storage failures other than "already missing" leave the record for retry |
| II. Key Secrecy | PASS | History never reads provider key tables or Vault and does not expose keys |
| II. Official Endpoints Only | PASS | No provider calls are made in this feature |
| II. PNG Output Only | PASS | Download/view surfaces only existing PNG assets from Phase 6 |
| III. Tech Constraints | PASS | Uses existing FastAPI + Next.js 14 + Supabase + Bunny Magic stack |
| IV. Data Rules | PASS | Reads existing generation fields: prompt, provider, model, dimensions preset, and image path |
| V. UX Rules - History first-class | PASS | Adds History list, filters, dedicated detail pages, download, and delete confirmation |
| VI. RLS / server-side brand verification | PASS | RLS already exists; backend service-client operations remain guarded by explicit brand ownership checks |
| VI. Logs contain safe metadata only | PASS | Planned logs include request ids, brand id, generation id, and safe status/error codes only |
| VII. Definition of Done | PASS | Quickstart includes no-kit/complete-kit relevance checks, provider history coverage, ownership checks, and hard-delete verification |

**No violations. No complexity exceptions required.**

---

## Project Structure

### Documentation (this feature)

```text
specs/008-generation-history/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── history-api.md
├── checklists/
│   └── requirements.md
└── tasks.md
```

### Source Code

```text
backend/
├── app/
│   ├── models/
│   │   └── generation.py              # MODIFY: add history list/detail response models
│   └── routers/
│       └── generations.py             # MODIFY: add list/detail/delete history endpoints
└── tests/
    ├── test_generation_history_models.py      # NEW: response shape/page validation tests
    └── test_generation_history_contract.py    # NEW: pure helper tests if helpers are extracted

frontend/
├── app/
│   └── (dashboard)/
│       └── [brandId]/
│           └── history/
│               ├── page.tsx                   # NEW: history list page
│               └── [generationId]/
│                   └── page.tsx               # NEW: dedicated detail page
├── components/
│   └── history/
│       ├── history-filters.tsx                # NEW: provider/status controls
│       ├── history-list.tsx                   # NEW: 24-item paged list + states
│       ├── history-card.tsx                   # NEW: summary card for one generation
│       ├── history-detail.tsx                 # NEW: metadata/image/failure detail surface
│       ├── history-download-button.tsx        # NEW: saved filename download behavior
│       └── delete-generation-dialog.tsx       # NEW: confirmation flow
├── hooks/
│   ├── use-generation-history.ts              # NEW: list/filter/pagination client hook
│   └── use-delete-generation.ts               # NEW: delete action wrapper
└── types/
    └── index.ts                               # MODIFY: add GenerationHistoryItem,
                                               # GenerationHistoryPage, GenerationDetail
```

**Structure Decision**: Web application using the existing backend/frontend split. Backend stays in the established Pydantic model + router pattern. Frontend follows the existing dashboard route pattern under `frontend/app/(dashboard)/[brandId]/`, using hooks for client API calls and components for repeated UI pieces. No new root-level directories.

---

## Phase 0: Research

Research decisions are captured in [research.md](./research.md). All planning unknowns are resolved; no `NEEDS CLARIFICATION` markers remain.

Key decisions:

1. Reuse the existing `generations` table and indexes; no migration.
2. Add brand-scoped history endpoints to the existing `generations` router.
3. Use cursor-style page navigation based on `created_at` + `id` ordering to avoid duplicate/skip behavior.
4. Keep the page size fixed at 24; clients request the next page with the server-provided cursor only.
5. Keep status filter choices to terminal statuses only: `succeeded`, `failed`.
6. Hard-delete storage first, then row; already-missing storage path is deletion-safe.
7. Use dedicated detail pages instead of modal-only history details.

---

## Phase 1: Design and Contracts

Artifacts produced:

- [data-model.md](./data-model.md)
- [contracts/history-api.md](./contracts/history-api.md)
- [quickstart.md](./quickstart.md)

### Backend Design

Add history models to `backend/app/models/generation.py`:

- `GenerationHistoryStatusEnum`: `succeeded | failed`
- `GenerationHistoryItem`: summary card response
- `GenerationHistoryPage`: paginated list response
- `GenerationDetailResponse`: detail page response, includes `download_filename` for successful images

Add endpoints to `backend/app/routers/generations.py` under existing prefix `/brands/{brand_id}`:

```text
GET    /brands/{brand_id}/generations
GET    /brands/{brand_id}/generations/{generation_id}
DELETE /brands/{brand_id}/generations/{generation_id}
```

Rules:

- Call `_get_brand_or_404` before every operation.
- Always filter generation rows by both `brand_id` and generation `id` for detail/delete.
- List returns terminal records only; status filter only accepts `succeeded` or `failed`.
- Page size is fixed at 24 and is not client-configurable.
- Build `image_url` and `download_filename` with the same helper as generation success responses.
- Do not return `image_path`.
- Delete successful generation storage object first. If storage says object is missing, proceed to row delete. If storage removal fails for another reason, return deletion failure and keep row.

### Frontend Design

History list page:

- Server route path: `/(dashboard)/[brandId]/history/page.tsx`
- Client hook fetches `/brands/{brandId}/generations?provider=&status=&cursor=`
- Provider filter: All, OpenAI, Gemini
- Status filter: All, Succeeded, Failed
- Cards show preview when available, status/provider/preset, prompt excerpt, and creation time.
- Empty states distinguish no history from no filtered results.

Detail page:

- Route path: `/(dashboard)/[brandId]/history/[generationId]/page.tsx`
- Fetches `/brands/{brandId}/generations/{generationId}`
- Successful detail shows full image, metadata, Download action, Delete action.
- Failed detail shows metadata, error code/message, Delete action, no image preview.
- Back link preserves list query string context when available.

### Definition of Done pre-check

- Brand isolation: list/detail/delete tested across two brands and two users.
- Hard delete: successful generation row and storage PNG removed; failed generation row removed; already-missing image still allows row delete; storage failure blocks row delete.
- History filters: provider/status filters and combined filters verified across at least two pages.
- Download: history Download file contents and filename match generation result.
- No scope drift: no prompt reuse, regeneration, bulk delete, date/text search, admin stats, or cost reporting.

---

## Constitution Check (Post-Design)

Re-verified against concrete design:

| Principle | Check | Evidence |
|-----------|-------|----------|
| Brand isolation | PASS | Contracts require brand ownership verification and brand+generation id matching |
| Hard delete | PASS | Delete contract specifies storage-first removal, already-missing safe path, and row retention on storage failure |
| Key secrecy | PASS | No key/Vault reads; responses contain generation metadata only |
| Fixed stack | PASS | Existing FastAPI, Next.js, Supabase, Bunny Magic stack only |
| Data rules | PASS | Existing generation record fields are used; no schema change |
| UX rules | PASS | First-class History page and provider filter included |
| Security rules | PASS | Server-side brand verification required for all endpoints |
| Definition of Done | PASS | Quickstart includes hard delete, ownership, providers, and no/complete kit checks |

No violations. No complexity exceptions required.

---

## Complexity Tracking

No constitution violations.
