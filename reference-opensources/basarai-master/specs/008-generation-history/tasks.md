# Tasks: Generation History

**Input**: Design documents from `/specs/008-generation-history/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/history-api.md, quickstart.md

**Tests**: Backend tests are included for Pydantic response models and pure helper behavior described in the plan. End-to-end browser/API verification is covered by quickstart paths.

**Organization**: Tasks are grouped by user story so each story can be implemented and verified independently.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel because it touches different files and does not depend on incomplete tasks
- **[Story]**: User story label from spec.md
- All descriptions include exact file paths

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Prepare the existing backend/frontend structure for history work without adding migrations or dependencies.

- [x] T001 Review existing generation router, response builder, and download behavior in `backend/app/routers/generations.py`, `backend/app/models/generation.py`, and `frontend/components/generation/generator-result.tsx`
- [x] T002 [P] Create the history route/component directory structure at `frontend/app/(dashboard)/[brandId]/history/`, `frontend/app/(dashboard)/[brandId]/history/[generationId]/`, and `frontend/components/history/`
- [x] T003 [P] Create backend history test files at `backend/tests/test_generation_history_models.py` and `backend/tests/test_generation_history_contract.py`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Add shared contracts and helpers required before any story can be completed.

**CRITICAL**: No user story work should begin until this phase is complete.

- [x] T004 Add `GenerationHistoryStatusEnum`, `GenerationHistoryItem`, `GenerationHistoryPage`, and `GenerationDetailResponse` models in `backend/app/models/generation.py`
- [x] T005 [P] Add `GenerationHistoryStatus`, `GenerationHistoryItem`, `GenerationHistoryPage`, and `GenerationDetail` frontend types in `frontend/types/index.ts`
- [x] T006 Add shared history helpers for public image URLs, prompt excerpts, fixed page size, cursor encode/decode, and detail/list response building in `backend/app/routers/generations.py`
- [x] T007 [P] Add a reusable `downloadImageFile` helper for image URL plus filename downloads in `frontend/lib/download.ts`
- [x] T008 Add model and helper coverage for history response shape, fixed `page_size: 24`, prompt excerpts, and cursor encode/decode in `backend/tests/test_generation_history_models.py` and `backend/tests/test_generation_history_contract.py`

**Checkpoint**: Backend/frontend contracts exist, cursor/page behavior is defined, and story implementation can start.

---

## Phase 3: User Story 1 - Browse Generation History (Priority: P1) MVP

**Goal**: Brand owners can open a brand History area and browse newest-first successful and failed generation records, 24 items at a time, without seeing records from other brands.

**Independent Test**: Create a brand with at least 25 successful/failed generation records, open `/{brandId}/history`, verify the first 24 newest records appear, load the next page without duplicates/skips, and confirm another brand's records never appear.

### Implementation for User Story 1

- [x] T009 [US1] Implement `GET /brands/{brand_id}/generations` with brand ownership verification, terminal-only history rows, `created_at DESC, id DESC` ordering, 24-item cursor pagination, and `GenerationHistoryPage` response in `backend/app/routers/generations.py`
- [x] T010 [US1] Ensure the list endpoint returns `image_url` only when an image path is usable, never returns `image_path`, and includes failed-generation error messages in `backend/app/routers/generations.py`
- [x] T011 [P] [US1] Create `useGenerationHistory` with loading/error states, cursor stack, next-page loading, and stale response protection in `frontend/hooks/use-generation-history.ts`
- [x] T012 [P] [US1] Create the history card UI for image preview, status, provider, preset, prompt excerpt, and creation time in `frontend/components/history/history-card.tsx`
- [x] T013 [P] [US1] Create the history list UI with loading, error, no-history empty state, 24-item layout, and next-page control in `frontend/components/history/history-list.tsx`
- [x] T014 [US1] Implement the History page using `useGenerationHistory`, `HistoryList`, and brand-scoped API calls in `frontend/app/(dashboard)/[brandId]/history/page.tsx`

**Checkpoint**: User Story 1 is independently functional and can be validated with quickstart Path 1.

---

## Phase 4: User Story 2 - Filter History by Provider and Status (Priority: P2)

**Goal**: Brand owners can filter history by provider and terminal status, combine both filters, and page through filtered results.

**Independent Test**: Seed a brand with OpenAI/Gemini and succeeded/failed records, apply each filter alone and together, verify every visible item matches the selected filters across pages, and verify the filtered empty state when no records match.

### Implementation for User Story 2

- [x] T015 [P] [US2] Create provider/status filter controls with All/OpenAI/Gemini and All/Succeeded/Failed choices in `frontend/components/history/history-filters.tsx`
- [x] T016 [US2] Add provider/status query validation and `400 VALIDATION_ERROR` handling for invalid filter values in `backend/app/routers/generations.py`
- [x] T017 [US2] Extend `useGenerationHistory` to send `provider`, `status`, and `cursor` query params, reset pagination on filter changes, and ignore stale filter responses in `frontend/hooks/use-generation-history.ts`
- [x] T018 [US2] Wire filter state into the History page URL/search state and preserve filtered pagination context in `frontend/app/(dashboard)/[brandId]/history/page.tsx`
- [x] T019 [US2] Add a distinct filtered-empty state that does not imply the brand has no history in `frontend/components/history/history-list.tsx`

**Checkpoint**: User Stories 1 and 2 work independently and can be validated with quickstart Paths 1 and 2.

---

## Phase 5: User Story 3 - View a Past Generation (Priority: P3)

**Goal**: Brand owners can open a history item on a dedicated detail page, inspect full metadata, view/download successful images, and inspect failure details for failed generations.

**Independent Test**: Open one successful and one failed generation from history, verify dedicated detail pages show the required fields, verify successful download filename/content behavior, and verify returning to History preserves filter/page context.

### Implementation for User Story 3

- [x] T020 [US3] Implement `GET /brands/{brand_id}/generations/{generation_id}` with brand ownership verification, brand+generation id matching, `GenerationDetailResponse`, and no `image_path` exposure in `backend/app/routers/generations.py`
- [x] T021 [P] [US3] Create a detail fetch hook with loading, not-found, and error states in `frontend/hooks/use-generation-detail.ts`
- [x] T022 [P] [US3] Create the history download button using `downloadImageFile` and disable it when `image_url` or `download_filename` is unavailable in `frontend/components/history/history-download-button.tsx`
- [x] T023 [P] [US3] Create the history detail UI for full image, prompt, provider, model, preset, dimensions, logo mode, status, timestamps, and failure details in `frontend/components/history/history-detail.tsx`
- [x] T024 [US3] Implement the dedicated detail route with loading, not-found, successful, and failed states in `frontend/app/(dashboard)/[brandId]/history/[generationId]/page.tsx`
- [x] T025 [US3] Preserve History return context by passing current search params from cards to detail links and back links in `frontend/components/history/history-card.tsx` and `frontend/app/(dashboard)/[brandId]/history/[generationId]/page.tsx`
- [x] T026 [US3] Refactor the existing generation result Download action to use `downloadImageFile` without changing current generation behavior in `frontend/components/generation/generator-result.tsx`

**Checkpoint**: User Stories 1 through 3 work independently and can be validated with quickstart Paths 1 through 4.

---

## Phase 6: User Story 4 - Delete a Generation Permanently (Priority: P4)

**Goal**: Brand owners can delete one generation from the list or detail page with confirmation, hard-deleting the database row and stored PNG when present.

**Independent Test**: Delete one successful generation and one failed generation, verify both disappear from history and detail access, verify successful image storage is removed, verify already-missing images still allow row deletion, and verify storage deletion failure keeps the row.

### Implementation for User Story 4

- [x] T027 [US4] Implement `DELETE /brands/{brand_id}/generations/{generation_id}` with brand ownership verification, storage-first hard delete, already-missing image tolerance, failed-row direct delete, and `STORAGE_DELETE_FAILED` row retention in `backend/app/routers/generations.py`
- [x] T028 [P] [US4] Create `useDeleteGeneration` with 204 success handling and API error propagation in `frontend/hooks/use-delete-generation.ts`
- [x] T029 [P] [US4] Create a delete confirmation dialog with cancel, confirm, loading, and failure states in `frontend/components/history/delete-generation-dialog.tsx`
- [x] T030 [US4] Wire delete actions from list cards and detail view without adding bulk actions in `frontend/components/history/history-card.tsx` and `frontend/components/history/history-detail.tsx`
- [x] T031 [US4] Refresh the current history context after delete and handle deleted-detail navigation in `frontend/app/(dashboard)/[brandId]/history/page.tsx` and `frontend/app/(dashboard)/[brandId]/history/[generationId]/page.tsx`
- [x] T032 [US4] Extend helper coverage for successful delete, failed-row delete, already-missing image delete, and storage failure row retention in `backend/tests/test_generation_history_contract.py`

**Checkpoint**: User Stories 1 through 4 are complete and can be validated with quickstart Paths 1 through 8.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Verify quality, preserve scope, and complete end-to-end checks across all stories.

- [x] T033 [P] Add responsive safeguards for long prompts, long error messages, missing images, and fixed card/detail dimensions in `frontend/components/history/history-card.tsx` and `frontend/components/history/history-detail.tsx`
- [x] T034 [P] Update implementation-specific verification notes only if needed in `specs/008-generation-history/quickstart.md`
- [x] T035 Run backend history tests in Docker with `python:3.13-slim`
- [x] T036 Run frontend verification in Docker with `node:20-slim`, covering `npm run lint` and `npm run build`, then fix issues in affected history files under `frontend/app/(dashboard)/[brandId]/history/`, `frontend/components/history/`, `frontend/hooks/`, and `frontend/types/index.ts`
- [ ] T037 Execute quickstart Paths 1 through 9 and record any implementation-specific deviations in `specs/008-generation-history/quickstart.md`
- [x] T038 Confirm no out-of-scope prompt reuse, regeneration, edit settings, bulk delete, cost reporting, admin stats, cross-brand history, date filtering, or text search was added in `frontend/app/(dashboard)/[brandId]/history/page.tsx` and `frontend/app/(dashboard)/[brandId]/history/[generationId]/page.tsx`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 Setup**: No dependencies
- **Phase 2 Foundational**: Depends on Phase 1; blocks all user stories
- **Phase 3 US1**: Depends on Phase 2; MVP
- **Phase 4 US2**: Depends on Phase 3 list foundation for filter integration
- **Phase 5 US3**: Depends on Phase 3 for entry links and shared response patterns
- **Phase 6 US4**: Depends on Phase 3 for list refresh behavior and Phase 5 for detail-page delete integration
- **Phase 7 Polish**: Depends on all implemented user stories

### User Story Dependencies

- **US1 Browse Generation History (P1)**: Required MVP; no dependency on later stories
- **US2 Filter History by Provider and Status (P2)**: Builds on US1 list endpoint/hook but remains independently testable with filtered list behavior
- **US3 View a Past Generation (P3)**: Builds on US1 list entries for navigation but can be verified directly by URL/API
- **US4 Delete a Generation Permanently (P4)**: Builds on US1 list refresh and US3 detail integration, but delete endpoint can be tested directly

### Backend Dependency Chain

- T004 before T006, T008, T009, T020, T027
- T006 before T008, T009, T020, T027
- T009 before T016
- T020 before T024
- T027 before T032

### Frontend Dependency Chain

- T005 before T011, T017, T021, T028
- T007 before T022 and T026
- T011 before T014 and T017
- T012 and T013 before T014
- T015, T017, T018, and T019 complete US2 filter behavior
- T021, T022, T023, T024, T025, and T026 complete US3 detail/download behavior
- T028, T029, T030, and T031 complete US4 delete behavior

---

## Parallel Execution Examples

### User Story 1

```text
Task T011: Create useGenerationHistory in frontend/hooks/use-generation-history.ts
Task T012: Create history-card UI in frontend/components/history/history-card.tsx
Task T013: Create history-list UI in frontend/components/history/history-list.tsx
```

### User Story 2

```text
Task T015: Create history-filters UI in frontend/components/history/history-filters.tsx
Task T016: Add backend filter validation in backend/app/routers/generations.py
```

### User Story 3

```text
Task T021: Create detail fetch hook in frontend/hooks/use-generation-detail.ts
Task T022: Create history download button in frontend/components/history/history-download-button.tsx
Task T023: Create history detail UI in frontend/components/history/history-detail.tsx
```

### User Story 4

```text
Task T028: Create useDeleteGeneration in frontend/hooks/use-delete-generation.ts
Task T029: Create delete-generation-dialog in frontend/components/history/delete-generation-dialog.tsx
Task T032: Extend backend helper tests in backend/tests/test_generation_history_contract.py
```

---

## Implementation Strategy

### MVP First: User Story 1 Only

1. Complete Phase 1 and Phase 2.
2. Complete Phase 3 tasks T009 through T014.
3. Stop and validate quickstart Path 1.
4. Demo the History list before adding filters, detail pages, or delete behavior.

### Incremental Delivery

1. Add US1 browse history and validate list isolation/pagination.
2. Add US2 filters and validate combined provider/status pagination.
3. Add US3 dedicated detail pages and download.
4. Add US4 hard delete and storage failure behavior.
5. Run polish checks and quickstart Paths 1 through 9.

### Parallel Team Strategy

1. Complete shared backend models/helpers and frontend types first.
2. Split independent frontend components/hooks across separate files.
3. Keep `backend/app/routers/generations.py` changes serialized because list, detail, and delete endpoints share helpers and error handling.
4. Keep final validation serialized after all target stories are implemented.

---

## Notes

- No database migration, storage bucket, provider dependency, or frontend data library should be added for this feature.
- Keep status filtering limited to `succeeded` and `failed`.
- Keep page size fixed at 24; clients only pass the server-provided `cursor` for additional pages.
- Delete must remove storage before deleting the row, except when the image is already missing.
- A storage deletion failure other than already-missing must keep the row visible for retry.
