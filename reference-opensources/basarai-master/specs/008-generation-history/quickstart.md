# Quickstart: Generation History

**Branch**: `008-generation-history` | **Date**: 2026-06-07

This guide verifies the history feature after implementation. It assumes Phase 6 generation is already working.

## Implementation verification note

Docker is the authoritative workflow for this repository. During the review-fix pass, these checks completed successfully:

- Dockerized backend tests in `python:3.13-slim`: `109 passed, 1 warning`.
- Dockerized frontend `npm run lint` and `npm run build` in `node:20-slim`: passed.
- `make build`: built the deployable `basarai:latest` image.

Manual quickstart Paths 1-9 still require a seeded Supabase environment with multiple brands, providers, terminal statuses, and storage objects.

---

## Prerequisites

1. Repository on `008-generation-history` with implementation complete.
2. Local environment configured:
   - `backend/.env`: `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `STORAGE_BUCKET=brand-assets`
   - `frontend/.env.local`: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `NEXT_PUBLIC_API_URL`
3. A test user with at least two brands.
4. At least one active OpenAI key and one active Gemini key across test brands.
5. Enough generated records to test history:
   - Brand A: at least 25 generations total.
   - Include both providers (`openai`, `gemini`).
   - Include both terminal statuses (`succeeded`, `failed`).

---

## Start the stack

```bash
make up
```

Open `http://localhost:3001`, sign in, and select Brand A.

Useful Docker checks:

```bash
make health
make logs
```

---

## Path 1: Browse history, newest first, 24 per page

**Covers**: US1, FR-001 through FR-006, FR-010, SC-001, SC-002.

1. Navigate to `/{brandId}/history`.
2. Verify the first page renders in under 2 seconds.
3. Verify exactly 24 history items appear when Brand A has at least 25 matching records.
4. Verify items are sorted newest first by creation time.
5. Verify successful items show an image preview.
6. Verify failed items show failed status and human-readable failure message, not a broken image.
7. Load the next page.
8. Verify the remaining records appear without duplicating any item from page 1.
9. Switch to Brand B and open History.
10. Verify Brand A records do not appear.

---

## Path 2: Provider and terminal-status filters

**Covers**: US2, FR-007 through FR-011, SC-003, SC-004.

1. On Brand A History, filter provider to OpenAI.
2. Verify every visible item has provider `openai`.
3. Move to the next page if available and verify the filter still applies.
4. Change provider to Gemini.
5. Verify every visible item has provider `gemini`.
6. Clear provider and filter status to `succeeded`.
7. Verify every visible item has status `succeeded`.
8. Change status to `failed`.
9. Verify every visible item has status `failed`.
10. Combine provider and status filters.
11. Verify every visible item matches both criteria.
12. Choose a filter combination with no matches.
13. Verify the empty filtered state says there are no matching history items, not that the brand has no history.

---

## Path 3: Successful generation detail and Download

**Covers**: US3 successful path, FR-012 through FR-016, FR-028, FR-029, SC-005, SC-007, SC-011.

1. From Brand A History, open a successful generation.
2. Verify the browser lands on a dedicated detail page.
3. Verify the page shows full image and metadata:
   - prompt
   - provider
   - model
   - platform preset
   - width and height
   - logo mode
   - status
   - created/completed timestamps
4. Click Download.
5. Verify the saved file is a PNG.
6. Verify the filename matches the original generation filename format:

   ```text
   {sanitized-brand-name}-{preset-identifier}-{YYYYMMDD-HHmmss}.png
   ```

7. Verify the downloaded file bytes match the stored generation result.
8. Navigate back to History.
9. Verify active filters and page position are preserved.

---

## Path 4: Failed generation detail

**Covers**: US3 failed path, FR-014, FR-028, FR-029, SC-006, SC-011.

1. From Brand A History, open a failed generation.
2. Verify the browser lands on a dedicated detail page.
3. Verify the page shows:
   - prompt
   - provider
   - model
   - platform preset
   - logo mode
   - failed status
   - error code
   - human-readable error message
   - timestamps
4. Verify no image preview is shown.
5. Verify no Download action is available.

---

## Path 5: Delete successful generation

**Covers**: US4, FR-017 through FR-024, SC-008.

1. Pick a successful generation with a stored image.
2. Open its detail page.
3. Click Delete.
4. Cancel the confirmation.
5. Verify the generation remains visible.
6. Click Delete again and confirm.
7. Verify the app returns to History or shows a clear deleted state.
8. Verify the generation no longer appears in History.
9. Attempt to open its old detail URL.
10. Verify `GENERATION_NOT_FOUND` behavior.
11. Verify the stored PNG is no longer available from storage.

Suggested storage check in Supabase SQL or dashboard:

```sql
SELECT image_path FROM generations WHERE id = '<deleted-generation-id>';
```

This should return no rows after deletion.

---

## Path 6: Delete failed generation

**Covers**: US4 failed-row path, FR-021, SC-009.

1. Pick a failed generation.
2. Confirm it has no image preview and no Download action.
3. Delete it and confirm.
4. Verify it disappears from History.
5. Attempt to open its old detail URL.
6. Verify `GENERATION_NOT_FOUND` behavior.

---

## Path 7: Missing image and storage failure behavior

**Covers**: Clarified deletion behavior, FR-022, FR-023.

### Already-missing image

1. Create or identify a successful generation.
2. Manually remove its stored PNG from the `brand-assets` bucket while leaving the generation row.
3. Open the detail page.
4. Verify metadata still renders and the Download action is unavailable.
5. Confirm deletion.
6. Verify the history record is deleted successfully.

### Storage removal failure

1. Temporarily simulate a storage removal failure for a successful generation by forcing the storage remove call to fail in local development.
2. Confirm deletion.
3. Verify the user sees deletion failed.
4. Verify the generation row remains visible in History.
5. Revert the local failure simulation before committing.

---

## Path 8: Ownership enforcement

**Covers**: FR-025, FR-026, SC-010.

1. Create users A and B.
2. User A creates Brand A and has at least one generation.
3. Sign in as User B and obtain User B's token.
4. Attempt to list User A history:

   ```bash
   docker exec basarai-app python3 -c "import urllib.request; req=urllib.request.Request('http://127.0.0.1:8000/brands/<brand-a-id>/generations', headers={'Authorization':'Bearer <user-b-token>'}); print(urllib.request.urlopen(req).status)"
   ```

5. Verify `404 BRAND_NOT_FOUND`.
6. Attempt to fetch User A generation detail:

   ```bash
   docker exec basarai-app python3 -c "import urllib.request; req=urllib.request.Request('http://127.0.0.1:8000/brands/<brand-a-id>/generations/<generation-id>', headers={'Authorization':'Bearer <user-b-token>'}); print(urllib.request.urlopen(req).status)"
   ```

7. Verify no generation metadata is returned.
8. Attempt to delete User A generation as User B.
9. Verify deletion is rejected and User A's generation remains.

---

## Path 9: Scope guard

**Covers**: FR-027 and Out of Scope.

Verify History does not include:

- prompt reuse
- regenerate/remix
- edit generation settings
- bulk delete
- cost or quota reporting
- admin statistics
- cross-brand global history
- date-range filtering
- text search

---

## Backend checks

```bash
docker run --rm -v "$PWD/backend:/src:ro" -w /work python:3.13-slim sh -lc \
  'tar -C /src --exclude=venv --exclude=__pycache__ --exclude=.pytest_cache --exclude=.ruff_cache -cf - . | tar -xf - && pip install --no-cache-dir -r requirements.txt >/tmp/pip-install.log && pytest tests/test_generation_history_models.py tests/test_generation_history_contract.py -v'
```

If contract/helper tests are not created because the implementation has no pure helpers, document that endpoint-level verification is covered by Paths 1-8.

---

## Frontend checks

```bash
docker run --rm -v "$PWD/frontend:/src:ro" -w /work node:20-slim sh -lc \
  'tar -C /src --exclude=node_modules --exclude=.next --exclude=tsconfig.tsbuildinfo -cf - . | tar -xf - && npm ci && npm run lint && npm run build'
```

---

## Definition of Done checklist

- [ ] Works for brand with 0 kit answers: History list/detail/delete does not require brand kit data.
- [ ] Works for brand with complete kit: History list/detail/delete behaves the same.
- [ ] Works with OpenAI provider history.
- [ ] Works with Gemini provider history.
- [ ] RLS / cross-user isolation tested via Path 8.
- [ ] Hard delete verified: successful generation row removed and storage PNG removed; failed generation row removed.
- [ ] Already-missing image delete path verified.
- [ ] Storage deletion failure keeps the row and reports failure.
- [ ] History Download filename and contents verified.
- [ ] No out-of-scope actions are present.
