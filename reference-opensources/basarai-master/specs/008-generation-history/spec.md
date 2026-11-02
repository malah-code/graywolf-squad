# Feature Specification: Generation History

**Feature Branch**: `008-generation-history`
**Created**: 2026-06-07
**Status**: Draft
**Input**: User description: "Phase 7 History: brand owners can list their past generations for a brand with pagination and provider/status filters, open a past generation to view the full image and metadata, and delete a generation with hard delete of both the stored image and the saved history record. Scope is view and delete only for the brand owner. Do not include prompt reuse, admin dashboards, cost stats, bulk actions, or editing regeneration settings."

## Overview

This feature gives a brand owner a persistent history for images they already generated. The owner can open a brand's History area, scan past generation attempts, filter the list by provider and outcome status, open a generation to inspect the full image and saved metadata, and permanently delete an individual generation.

The phase is intentionally narrow: **view + delete only**. It does not let users reuse prompts, regenerate from history, edit generation settings, perform bulk actions, view admin metrics, or manage costs.

## Clarifications

### Session 2026-06-07

- Q: How should deletion behave if stored image removal cannot be completed? → A: If the stored image is already missing, delete the history record; if image removal fails for another reason, keep the record and show deletion failed.
- Q: How many generation history items should load per page? → A: 24 items per page.
- Q: Should successful history items include a Download action? → A: Successful history details include a Download action with the original saved filename behavior.
- Q: Which statuses should the History status filter include? → A: Only `succeeded` and `failed`.
- Q: How should a history item open for detailed viewing? → A: Open each history item on a dedicated detail page.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Browse Generation History (Priority: P1)

A brand owner opens the History area for one of their brands and sees the brand's past generation attempts in reverse chronological order. Successful generations show an image preview with enough metadata to recognize the output. Failed generations remain visible with their failure status and message so the owner understands what happened.

**Why this priority**: Generated images stop being useful if they disappear after the current session. A persistent history turns generation from a one-shot preview into a usable brand asset workflow.

**Independent Test**: Create a brand with at least 25 generation records across success and failure states, open History for that brand, and verify that the newest 24 records appear on the first page, the remaining records appear on the next page, success and failure states are both represented, and no records from another brand appear.

**Acceptance Scenarios**:

1. **Given** a brand owner has successful and failed generations for a brand, **When** they open that brand's History area, **Then** they see the newest generation attempts first with provider, preset, status, prompt excerpt, and creation time.
2. **Given** the brand has more than 24 history items, **When** the owner reaches the end of the first page and requests more, **Then** the next page loads without duplicating or skipping generation records.
3. **Given** a generation failed, **When** it appears in the history list, **Then** the owner sees its failed status and human-readable failure message instead of a broken image preview.
4. **Given** a user opens History for Brand A, **When** Brand B has generation records under the same account, **Then** Brand B records are not shown in Brand A's list.

---

### User Story 2 - Filter History by Provider and Status (Priority: P2)

A brand owner with many generations narrows the history list to the items they care about, such as Gemini successes or OpenAI failures. Status filtering covers only terminal outcomes (`succeeded` and `failed`). Filters help the owner find usable assets and diagnose repeated provider failures without scrolling through every generation.

**Why this priority**: Filtering is the minimum search aid promised by the Phase 7 roadmap. It keeps history usable once a brand has more than a small number of generations.

**Independent Test**: Seed a brand with generations across both providers and both terminal statuses (`succeeded` and `failed`), apply each filter alone and together, and verify every visible item matches the selected criteria while pagination still works.

**Acceptance Scenarios**:

1. **Given** a brand has history from both supported providers, **When** the owner filters by one provider, **Then** every visible generation belongs to that provider and the total visible set updates.
2. **Given** a brand has both succeeded and failed generations, **When** the owner filters by status, **Then** every visible generation has that status.
3. **Given** provider and status filters are both active, **When** the owner pages through results, **Then** every page respects both filters.
4. **Given** filters match no generations, **When** the list refreshes, **Then** the owner sees an empty filtered state that explains no matching history exists.

---

### User Story 3 - View a Past Generation (Priority: P3)

A brand owner clicks a history item to inspect the past result on a dedicated detail page. For successful generations, they can view the full image and the saved metadata needed to understand how it was created. For failed generations, they can view the prompt, provider, preset, failure code, and failure message.

**Why this priority**: A thumbnail-only list is not enough for brand work. Owners need to inspect the image and verify the prompt, provider, preset, size, logo mode, and completion time before deciding whether to use or delete it.

**Independent Test**: Open a successful generation and a failed generation from history, verify that each dedicated detail page contains the correct fields, verify that the successful detail page can download the PNG with the same saved filename behavior used by generation, and verify that the detail page belongs to the selected brand and generation.

**Acceptance Scenarios**:

1. **Given** a successful generation appears in history, **When** the owner opens it, **Then** they land on a dedicated detail page showing the full image, a Download action, and metadata including prompt, provider, model, preset, dimensions, logo mode, status, and timestamps.
2. **Given** a failed generation appears in history, **When** the owner opens it, **Then** they land on a dedicated detail page showing the prompt, provider, model, preset, logo mode, failed status, failure code, failure message, and timestamps, without an image preview.
3. **Given** the owner navigates back from the detail page, **When** they return to history, **Then** the list keeps its current filter and page position.

---

### User Story 4 - Delete a Generation Permanently (Priority: P4)

A brand owner deletes an individual generation they no longer want to keep. The system requires confirmation, removes the history record, and removes the stored image file for successful generations. Failed generations can also be deleted even when no image file exists.

**Why this priority**: The project's data rules require hard delete for user-owned assets. History must not become a permanent pile of unwanted or failed attempts.

**Independent Test**: Delete one successful generation and one failed generation from a brand's history, then verify each disappears from the list, direct access to each generation no longer works for the owner, and the successful generation's stored image is no longer available.

**Acceptance Scenarios**:

1. **Given** a successful generation appears in history, **When** the owner confirms deletion, **Then** the generation disappears from history and its stored image is permanently removed.
2. **Given** a failed generation appears in history, **When** the owner confirms deletion, **Then** the generation disappears from history without requiring an image file to exist.
3. **Given** the owner starts deletion but cancels the confirmation, **When** they return to history, **Then** the generation remains unchanged.
4. **Given** a deletion succeeds while filters are active, **When** the list refreshes, **Then** the owner remains in the filtered history context and the deleted item is absent.

---

### Edge Cases

- A brand has no generations yet: History shows an empty state that points back to generation, without implying that anything failed.
- A filter combination has no matches: the filtered empty state distinguishes "no matching items" from "no history yet".
- A stored image for a successful generation is missing or unavailable: the list/detail page shows the generation metadata and a recoverable image-unavailable message instead of breaking the page; the Download action is unavailable until the image can be loaded.
- A deletion is confirmed for a successful generation whose stored image is already missing: the history record is still deleted because there is no remaining image asset to remove.
- A deletion is confirmed for a successful generation whose stored image cannot be removed for any other reason: the history record remains visible and the user sees that deletion failed so they can retry later.
- A deletion is attempted for a generation that was already deleted: the user sees a neutral not-found result and the history list remains consistent.
- A user tries to view or delete a generation belonging to another user's brand: access is rejected and no generation metadata or image location is revealed.
- A user changes filters while a page of history is loading: the final visible list must reflect the latest selected filters, not stale results.
- A generation has a very long prompt or error message: list views show readable excerpts, while detail pages show the full stored text within the page layout.
- Pagination reaches the last page: the user is not offered more pages once there are no additional matching records.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST provide a History area for every brand the authenticated user owns.
- **FR-002**: The History area MUST list only generation records that belong to the current brand.
- **FR-003**: The History list MUST order generation records from newest to oldest by creation time.
- **FR-004**: The History list MUST load records in pages of 24 items.
- **FR-005**: Each history list item MUST show enough information to identify the generation: status, provider, platform preset, prompt excerpt, creation time, and an image preview when one exists.
- **FR-006**: Failed generations MUST remain visible in history and MUST show their human-readable failure message without trying to render an image preview.
- **FR-007**: The owner MUST be able to filter history by provider.
- **FR-008**: The owner MUST be able to filter history by terminal status: `succeeded` or `failed`.
- **FR-009**: Provider and status filters MUST be combinable, and pagination MUST respect the active filters.
- **FR-010**: The History area MUST show a distinct empty state when the brand has no generation history.
- **FR-011**: The History area MUST show a distinct empty filtered state when active filters match no generation records.
- **FR-012**: The owner MUST be able to open a successful generation from history and view its full image.
- **FR-013**: Each history item MUST open on a dedicated detail page.
- **FR-014**: The owner MUST be able to open any generation from history and view its saved metadata: prompt, provider, model, platform preset, width, height, logo mode, status, creation time, completion time when present, and failure details when present.
- **FR-015**: The successful generation detail page MUST include a Download action that saves the stored PNG using the same filename behavior as the original generation result.
- **FR-016**: Returning from a detail page to the History list MUST preserve the owner's current history context, including active filters and page position.
- **FR-017**: The owner MUST be able to delete an individual generation from the history list or detail page.
- **FR-018**: Deleting a generation MUST require an explicit confirmation step before permanent removal.
- **FR-019**: If deletion is canceled, the generation MUST remain unchanged and visible.
- **FR-020**: If deletion is confirmed for a successful generation, the system MUST permanently remove both the generation record and its stored image file.
- **FR-021**: If deletion is confirmed for a failed generation, the system MUST permanently remove the generation record even when no stored image file exists.
- **FR-022**: If deletion is confirmed for a successful generation and the stored image is already missing, the system MUST still remove the generation record.
- **FR-023**: If deletion is confirmed for a successful generation and the stored image cannot be removed for any other reason, the system MUST keep the generation record and show that deletion failed.
- **FR-024**: After a successful deletion, the deleted generation MUST no longer appear in history, detail access, or future filtered results.
- **FR-025**: A user MUST NOT be able to view, list, or delete generation records for a brand they do not own.
- **FR-026**: The system MUST NOT expose another user's generation metadata, prompt text, failure details, or stored image location.
- **FR-027**: History MUST be scoped to view and delete actions only. The feature MUST NOT provide prompt reuse, regeneration, editing of generation settings, bulk deletion, cost tracking, admin statistics, or cross-brand history search.
- **FR-028**: The list and detail pages MUST handle missing stored images gracefully by showing metadata and an image-unavailable message.
- **FR-029**: Long prompts and long failure messages MUST remain readable without breaking the layout.

### Key Entities

- **Generation History Item**: A summary of one generation attempt for a brand. Includes identity, prompt excerpt, provider, model, platform preset, dimensions, logo mode, status, timestamps, failure message when present, and image preview availability.
- **Generation Detail Page**: The dedicated owner-visible page for one generation attempt, including full prompt, full image when available, saved metadata, terminal status, and failure details when present.
- **History Filter**: The owner's selected criteria for narrowing the list. Phase 7 includes provider and status filters only.
- **History Download**: The owner action that saves the stored PNG from a successful generation detail page using the same filename behavior as the original generation result.
- **Delete Confirmation**: The explicit user decision required before a generation is permanently removed.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A brand owner with 25 generation records can open History and see the first page of 24 newest records in under 2 seconds on a normal broadband connection.
- **SC-002**: 100% of visible history items belong to the currently selected brand, verified with at least two brands under the same account.
- **SC-003**: 100% of provider-filtered results match the selected provider across at least two pages of results.
- **SC-004**: 100% of status-filtered results match the selected status across at least two pages of results.
- **SC-005**: A successful generation can be opened on its dedicated detail page and inspected with full image plus metadata in under 3 user actions from the History area.
- **SC-006**: A failed generation can be opened on its dedicated detail page and inspected with prompt, failure code, and human-readable failure message in under 3 user actions from the History area.
- **SC-007**: Downloading a successful generation from history saves a PNG whose contents and filename match the stored generation result in 100% of tested downloads.
- **SC-008**: After confirming deletion of a successful generation whose stored image can be removed or is already missing, the generation no longer appears in history and no stored image remains in 100% of tested deletions.
- **SC-009**: After confirming deletion of a failed generation, the generation no longer appears in history in 100% of tested deletions.
- **SC-010**: A user attempting to access another user's generation history or generation detail receives no generation metadata and cannot delete the generation.
- **SC-011**: At least 90% of evaluators can correctly identify the provider, preset, status, and prompt for a past generation from the history/detail experience without developer assistance.

## Out of Scope

- Reusing a past prompt to start a new generation.
- Regenerating or remixing from a history item.
- Editing generation settings from history.
- Bulk delete or multi-select actions.
- Cost tracking, quota reporting, provider usage analytics, or admin dashboards.
- Cross-brand global history.
- Date-range filtering, text search, or sorting controls beyond newest-first.
- New image generation behavior, provider behavior, watermark behavior, or prompt composition behavior.

## Assumptions

- Generation records and stored image files already exist from the Generation phase.
- Successful generation images are stored at stable brand-scoped locations and can be removed permanently.
- Failed generation records can exist without stored image files and still carry useful failure metadata.
- Newest-first ordering is the default and only ordering needed for Phase 7.
- Provider and status are the only filters needed for Phase 7 because they match the current roadmap's minimal history scope.

## Dependencies

- **Phase 1 (Foundation)**: Generation records, ownership rules, and stored image assets exist.
- **Phase 3 (Brand CRUD)**: Brand ownership and brand navigation exist, including the History navigation destination.
- **Phase 6 (Generation)**: Successful and failed generation records are created with the metadata required for history.
