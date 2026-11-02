# Research: Brand Management (003-brand-crud)

**Date**: 2026-03-07

## R-001: Logo Resize on Upload

**Decision**: Use Pillow (PIL) to resize logos server-side to max 512x512 px, preserving aspect ratio.

**Rationale**: Pillow is the standard Python image library. It's already well-supported, lightweight, and handles PNG/JPG/WebP natively. SVG is excluded from accepted formats due to security risks (embedded JavaScript, XML external entity attacks).

**Alternatives considered**:
- **ImageMagick via subprocess**: Overkill for simple resize. Adds a system dependency.
- **Sharp (Node.js)**: Wrong layer — resize must happen in the FastAPI backend, not the Next.js frontend.
- **Client-side resize before upload**: Unreliable; users could bypass it. Server-side is authoritative.

**Implementation note**: Add `Pillow>=10.0.0` to `backend/requirements.txt`.

## R-002: Supabase Storage Upload Pattern

**Decision**: Use the Supabase service-role client (`get_service_client()`) for all storage operations (upload, delete). The backend receives the file from the frontend via multipart form upload, resizes it, then uploads to Supabase Storage.

**Rationale**: The service-role client bypasses RLS. This is correct because the backend already verifies brand ownership before performing any storage operation. Using the user client for storage would require the user's access token and adds complexity.

**Alternatives considered**:
- **Direct client-to-storage upload**: Skips server-side resize. We need resize, so the file must pass through the backend.
- **Signed URL upload**: Adds complexity and still doesn't allow server-side processing.

## R-003: Brand Ownership Verification Pattern

**Decision**: For all brand endpoints, verify ownership by querying the `brands` table with both `id = brand_id` AND `owner_user_id = current_user.id`. Return 404 (not 403) if the brand doesn't exist or isn't owned by the user.

**Rationale**: Returning 404 instead of 403 prevents information leakage (attacker can't determine if a brand ID exists). This matches the existing pattern in `me.py` and aligns with the spec edge case requirement.

**Alternatives considered**:
- **Rely on RLS only**: RLS protects the DB, but the backend needs to check ownership explicitly for storage operations and cascade logic (service-role client bypasses RLS).
- **Return 403 for unauthorized access**: Leaks information about brand existence.

## R-004: Hard Delete Cascade Strategy

**Decision**: Delete brand via the service-role client. The `ON DELETE CASCADE` on foreign keys handles `brand_kits`, `provider_keys`, and `generations` rows automatically. Before deleting the brand row, the backend must:
1. Fetch all `generations` with non-null `image_path` and delete those files from storage.
2. Delete the brand logo from storage if it exists.
3. Fetch all `provider_keys` and delete their Vault secrets.
4. Then delete the brand row (cascade handles the rest).

**Rationale**: DB cascade handles relational cleanup, but storage files and Vault secrets are external resources that need explicit cleanup. Storage/Vault deletions are best-effort (log warnings on failure) to prevent orphaned DB rows if external cleanup partially fails.

**Alternatives considered**:
- **Manual deletion of all tables**: More code, same result. `ON DELETE CASCADE` is already configured.
- **Background job for cleanup**: Premature for MVP. Synchronous cleanup within the 10-second success criterion is sufficient.

## R-005: Brand List Sort Order

**Decision**: Sort brands by `created_at DESC` (newest first). The existing index `idx_brands_owner_created` on `(owner_user_id, created_at DESC)` already supports this efficiently.

**Rationale**: Newest-first is the most common default for user-created resources. The existing database index is already optimized for this query pattern.

**Alternatives considered**:
- **Alphabetical sort**: Less intuitive for a creation-oriented workflow.
- **Last-used sort**: Requires tracking last-used timestamps, out of scope for MVP.

## R-006: Brand Selector Component Pattern

**Decision**: Implement as a dropdown (combobox) in the dashboard navigation bar. It shows the currently selected brand and allows switching. The selected brand ID is part of the URL path (`/[brandId]/...`), so switching brands navigates to the new brand's main view.

**Rationale**: URL-based brand context means bookmarkable links and no client-side state management complexity. Matches the Next.js App Router `[brandId]` dynamic segment already planned in the frontend structure.

**Alternatives considered**:
- **Context/state-based selection**: Loses URL shareability. Requires state sync.
- **Sidebar with brand list**: Takes too much screen space for a selector.
