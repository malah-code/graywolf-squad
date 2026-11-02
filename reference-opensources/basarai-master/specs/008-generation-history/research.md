# Research: Generation History

**Branch**: `008-generation-history` | **Date**: 2026-06-07

---

## Decision 1: Reuse the existing `generations` table

**Decision**: Build history from the existing `generations` table and storage paths. No new migration, table, enum, or bucket is needed.

**Rationale**: Phase 6 already persists all history fields required by the spec: prompt, provider, model, platform preset, width, height, logo mode, status, image path, error code/message, and timestamps. Existing indexes support newest-first brand history and provider/status filtering.

**Alternatives considered**:

- New `generation_history` table: rejected because it duplicates canonical generation records.
- Materialized summary table: rejected because MVP volume does not require denormalization.
- Storage-only gallery: rejected because failed generation history and metadata would be lost.

---

## Decision 2: Add history endpoints to the existing generations router

**Decision**: Extend `backend/app/routers/generations.py` with list/detail/delete endpoints under the existing `/brands/{brand_id}` prefix.

**Rationale**: Phase 6 already registered a brand-scoped generations router and contains the ownership helper, response builder, and generation-specific storage URL/filename logic. Keeping history in the same router avoids divergent error envelopes and ownership checks.

**Alternatives considered**:

- New `history.py` router: rejected because it would duplicate generation ownership and response-building helpers.
- Put endpoints under `brands.py`: rejected because generation history is a generation concern, not brand metadata.

---

## Decision 3: Cursor pagination by newest-first ordering

**Decision**: List history in pages of 24 using a cursor based on the last visible record's `created_at` and `id`, with deterministic ordering by `created_at DESC, id DESC`.

**Rationale**: Offset pagination is simpler but can duplicate or skip records when new generations are created while a user browses history. A cursor tied to the last row better matches the spec's no duplicate/skip requirement while still using existing indexes.

**Alternatives considered**:

- Offset + page number: rejected due to duplicate/skip risk on active history.
- Infinite scroll without explicit cursor: rejected because quickstart and contracts need a precise, testable pagination boundary.
- Load all records: rejected because history must remain usable as per-brand volume grows.

---

## Decision 4: Terminal statuses only

**Decision**: Status filters expose only `succeeded` and `failed`.

**Rationale**: Phase 6 requests are synchronous and are expected to leave no persisted `pending` or `processing` rows after a request returns. Showing transient statuses would complicate UX for states users should rarely or never see.

**Alternatives considered**:

- Include all statuses: rejected because it would imply live job monitoring that this feature does not provide.
- Use grouped filters such as "Has image" and "Failed": rejected because the spec explicitly asks for status filtering.

---

## Decision 5: Storage-first hard delete with missing-image tolerance

**Decision**: For successful generations, remove the stored PNG first and delete the generation row only after storage removal succeeds or the object is already missing. For other storage failures, keep the row and return a deletion failure. For failed generations, delete the row directly because no image path should exist.

**Rationale**: The constitution forbids soft delete and requires stored assets to be removed. Deleting the row before the image risks orphaned storage. Treating already-missing storage as safe avoids blocking cleanup when the desired final state is already true.

**Alternatives considered**:

- Always delete row even if storage deletion fails: rejected because it can orphan assets.
- Never delete row unless storage confirms positive deletion: rejected because an already-missing object would become impossible to clean up.
- Best-effort delete with warning only: rejected because it weakens hard-delete verification.

---

## Decision 6: Dedicated detail pages

**Decision**: Open history items on dedicated detail pages.

**Rationale**: Dedicated pages make refresh, direct access checks, post-delete not-found behavior, and browser back navigation easier to verify. They also align with Next.js App Router route structure already used in the dashboard.

**Alternatives considered**:

- Modal-only detail view: rejected because direct access and refresh behavior are harder to validate.
- Both modal and page: rejected for MVP because it increases implementation scope without adding required value.

---

## Decision 7: Preserve generation download filename behavior

**Decision**: Successful history detail pages include a Download action that uses the same saved filename behavior as the original generation result.

**Rationale**: Phase 6 already defines a user-friendly download filename. History is where users return to usable generated assets after the session-scoped preview disappears, so losing Download would make history less useful.

**Alternatives considered**:

- View-only history: rejected because it forces browser save behavior and may lose the intended filename.
- Full image open only: rejected for the same reason and because it makes SC-007 untestable.

---

## Decision 8: No new frontend data library

**Decision**: Use existing `apiRequest` plus feature hooks for list/delete. Do not add SWR, React Query, or another state library.

**Rationale**: Existing frontend features already use small hooks and local state. History's pagination/filter state is simple and does not justify a new dependency.

**Alternatives considered**:

- Add React Query/SWR: rejected because it is extra dependency surface for one feature.
- Server-only pages for all data: rejected because filters, pagination, delete confirmation, and client-side refetch behavior are naturally interactive.
