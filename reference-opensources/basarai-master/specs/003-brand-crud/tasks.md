# Tasks: Brand Management (003-brand-crud)

**Input**: Design documents from `/specs/003-brand-crud/`
**Prerequisites**: plan.md, spec.md, data-model.md, contracts/api.md, research.md, quickstart.md

**Tests**: Not explicitly requested. No test tasks included. Manual testing checklist in quickstart.md.

**Organization**: Tasks grouped by user story. Each task is self-contained with exact file paths, code patterns, and expected behavior.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks in this phase)
- **[Story]**: Which user story (US1-US6) from spec.md

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Add the new dependency, create the migration, and define shared data types used by all subsequent tasks.

- [x] T001 [P] Create migration to remove SVG from storage bucket allowed MIME types in `supabase/migrations/00011_remove_svg_from_storage_bucket.sql`

  **What to do**: Create a new SQL migration file with this exact content:
  ```sql
  -- Remove SVG from allowed MIME types (security risk: embedded scripts, XML entity attacks)
  UPDATE storage.buckets
  SET allowed_mime_types = ARRAY['image/png', 'image/jpeg', 'image/webp']
  WHERE id = 'brand-assets';
  ```
  **Why**: SVG files can contain embedded JavaScript and XML entity attacks. We only accept PNG, JPG, and WebP.

- [x] T002 [P] Add Pillow dependency to `backend/requirements.txt`

  **What to do**: Add this line to the end of `backend/requirements.txt`:
  ```
  Pillow>=10.0.0
  ```
  Then run `cd backend && pip install -r requirements.txt` to install it.
  **Why**: Pillow is used to resize uploaded logo images to max 512x512 px before storing them.

- [x] T003 [P] Create Brand Pydantic models in `backend/app/models/brand.py`

  **What to do**: Create a new file `backend/app/models/brand.py`. Follow the same pattern as `backend/app/models/profile.py` (read that file first for reference).

  Define these 4 models:

  1. `CreateBrandRequest` — request body for POST /brands:
     - `name: str` (required)
     - Add a `field_validator` for `name`: strip whitespace, then check length is between 2 and 120 characters. Raise `ValueError` if invalid.

  2. `UpdateBrandRequest` — request body for PATCH /brands/{id}:
     - `name: str` (required)
     - Same `field_validator` as `CreateBrandRequest` (same rules).

  3. `BrandResponse` — response for single brand:
     - `id: str`
     - `name: str`
     - `logo_url: Optional[str] = None`
     - `kit_status: str = "not_started"`
     - `created_at: datetime`
     - `updated_at: datetime`

  4. `BrandListItem` — response for brand list items (fewer fields):
     - `id: str`
     - `name: str`
     - `logo_url: Optional[str] = None`
     - `kit_status: str = "not_started"`
     - `created_at: datetime`

  5. `LogoUploadResponse`:
     - `logo_url: str`

  **Imports needed**: `from datetime import datetime`, `from typing import Optional`, `from pydantic import BaseModel, field_validator`.

- [x] T004 [P] Add Brand TypeScript types to `frontend/types/index.ts`

  **What to do**: Open `frontend/types/index.ts` (it already has `Profile`, `UpdateProfileRequest`, `ErrorResponse`). Add these types at the end of the file:

  ```typescript
  export interface Brand {
    id: string
    name: string
    logo_url: string | null
    kit_status: string
    created_at: string
    updated_at: string
  }

  export interface BrandListItem {
    id: string
    name: string
    logo_url: string | null
    kit_status: string
    created_at: string
  }

  export interface CreateBrandRequest {
    name: string
  }

  export interface UpdateBrandRequest {
    name: string
  }

  export interface LogoUploadResponse {
    logo_url: string
  }
  ```

  Do NOT remove the existing types (`Profile`, `UpdateProfileRequest`, `ErrorResponse`). Only add the new ones.

---

## Phase 2: Foundational (Backend Router + Frontend Hooks)

**Purpose**: Create the brands router file with shared helper functions and register it. Create frontend hooks that all UI tasks will use.

**CRITICAL**: Phase 1 must be complete before starting this phase.

- [x] T005 Create brands router skeleton with helper functions in `backend/app/routers/brands.py` and register it in `backend/app/main.py`

  **What to do (Part A)** — Create `backend/app/routers/brands.py`:

  Read `backend/app/routers/me.py` first — use the same patterns for imports, error handling, and Supabase client usage.

  Create the file with:
  1. Imports: `logging`, `uuid4`, `UUID` from uuid, `APIRouter`, `Depends`, `HTTPException`, `UploadFile`, `File`, `status` from fastapi, `User`/`get_current_user` from `app.core.auth`, `get_service_client` from `app.core.supabase`, `settings` from `app.config`, and all brand models from `app.models.brand`.
  2. `logger = logging.getLogger(__name__)`
  3. `router = APIRouter(prefix="/brands", tags=["brands"])`
  4. A helper function `_error_response(status_code, code, message)` — same as in `me.py`:
     ```python
     def _error_response(status_code: int, code: str, message: str) -> HTTPException:
         return HTTPException(
             status_code=status_code,
             detail={"error": {"code": code, "message": message, "request_id": str(uuid4())}},
         )
     ```
  5. A helper function `_get_brand_or_404(brand_id: UUID, user_id: str)` that:
     - Calls `get_service_client()` to get the client
     - Queries `client.table("brands").select("*").eq("id", str(brand_id)).eq("owner_user_id", user_id).maybe_single().execute()`
     - If `result.data` is None, raises `_error_response(404, "BRAND_NOT_FOUND", "Brand not found")`
     - Otherwise returns `result.data` (the brand dict)
  6. A helper function `_build_logo_url(logo_path: str | None) -> str | None` that:
     - If `logo_path` is None, returns None
     - Otherwise returns `f"{settings.SUPABASE_URL}/storage/v1/object/public/{settings.STORAGE_BUCKET}/{logo_path}"`
  7. A helper function `_get_kit_status(brand_id: str) -> str` that:
     - Queries `client.table("brand_kits").select("status").eq("brand_id", brand_id).maybe_single().execute()`
     - If `result.data` is None (no kit yet), returns `"not_started"`
     - Otherwise returns `result.data["status"]`
  8. Leave placeholder comments for each endpoint: `# GET /brands`, `# POST /brands`, `# GET /brands/{brand_id}`, `# PATCH /brands/{brand_id}`, `# DELETE /brands/{brand_id}`, `# POST /brands/{brand_id}/logo`, `# DELETE /brands/{brand_id}/logo`

  **What to do (Part B)** — Modify `backend/app/main.py`:

  1. Add import: `from app.routers import health, me, brands` (add `brands` to the existing import)
  2. Add router: `app.include_router(brands.router, tags=["brands"])` (add after the existing `me.router` line)

- [x] T006 [P] Create `useBrands` hook in `frontend/hooks/use-brands.ts`

  **What to do**: Create a new file. Follow the exact same pattern as `frontend/hooks/use-profile.ts` (read it first).

  The hook should:
  1. Have state: `brands: BrandListItem[]` (default `[]`), `loading: boolean` (default `true`), `error: string | null` (default `null`)
  2. Have a `fetchBrands` function (wrapped in `useCallback`) that calls `apiRequest<BrandListItem[]>('/brands')` and sets the state
  3. Call `fetchBrands` in a `useEffect` on mount
  4. Have a `mutate` function to update the brands list locally
  5. Return `{ brands, loading, error, mutate, refetch: fetchBrands }`

  **Imports**: `useCallback`, `useEffect`, `useState` from `react`, `apiRequest` from `@/lib/api`, `BrandListItem` from `@/types`.

- [x] T007 [P] Create `useBrand` hook in `frontend/hooks/use-brand.ts`

  **What to do**: Create a new file. Similar to `use-brands.ts` but for a single brand.

  The hook takes `brandId: string` as parameter and:
  1. Has state: `brand: Brand | null` (default `null`), `loading: boolean` (default `true`), `error: string | null` (default `null`)
  2. Has a `fetchBrand` function that calls `apiRequest<Brand>(`/brands/${brandId}`)` and sets the state
  3. Calls `fetchBrand` in a `useEffect` when `brandId` changes
  4. Has a `mutate` function to update the brand locally
  5. Returns `{ brand, loading, error, mutate, refetch: fetchBrand }`

  **Imports**: `useCallback`, `useEffect`, `useState` from `react`, `apiRequest` from `@/lib/api`, `Brand` from `@/types`.

**Checkpoint**: Router skeleton registered, helper functions ready, frontend hooks ready. All subsequent phases can now build on this foundation.

---

## Phase 3: User Story 1 - Create a Brand (Priority: P1)

**Goal**: Users can create a brand by providing a name. The system validates the name (2-120 chars, trimmed, case-insensitive unique per user) and creates the brand.

**Independent Test**: Log in, click "Create Brand", enter a name, see the new brand appear.

- [x] T008 [US1] Implement `POST /brands` endpoint in `backend/app/routers/brands.py`

  **What to do**: Add this endpoint to the brands router file (replace the `# POST /brands` placeholder comment).

  ```python
  @router.post("", response_model=BrandResponse, status_code=status.HTTP_201_CREATED)
  async def create_brand(body: CreateBrandRequest, current_user: User = Depends(get_current_user)):
  ```

  Logic:
  1. Get the service client: `client = get_service_client()`
  2. Strip the name: `name = body.name.strip()`
  3. Try to insert into the brands table:
     ```python
     result = client.table("brands").insert({
         "owner_user_id": current_user.id,
         "name": name,
     }).execute()
     ```
  4. If the insert fails with a unique constraint violation (the error message will contain `uq_brands_owner_name_ci` or `duplicate key`), catch it and raise `_error_response(409, "DUPLICATE_BRAND_NAME", "A brand with this name already exists")`
  5. To catch the Supabase error, wrap the insert in a try/except block. The supabase-py library raises `postgrest.exceptions.APIError` on constraint violations. Import it: `from postgrest.exceptions import APIError`. In the except block, check if `"uq_brands_owner_name_ci"` is in `str(e)` or `"duplicate key"` is in `str(e)`.
  6. On success, get the inserted row from `result.data[0]`
  7. Get kit_status: `kit_status = _get_kit_status(row["id"])`
  8. Return a `BrandResponse` with all fields populated. Use `_build_logo_url(row.get("logo_path"))` for `logo_url`.

  **Error codes**: 400 (validation from Pydantic), 409 (duplicate name).
  **Response**: 201 with `BrandResponse` JSON.

- [x] T009 [US1] Create create-brand-modal component in `frontend/components/brand/create-brand-modal.tsx`

  **What to do**: Create the directory `frontend/components/brand/` if it doesn't exist, then create the file.

  This is a `'use client'` component. It should:
  1. Accept props: `open: boolean`, `onOpenChange: (open: boolean) => void`, `onBrandCreated: (brand: Brand) => void`
  2. Have local state: `name: string` (default `""`), `loading: boolean` (default `false`), `error: string | null` (default `null`)
  3. On form submit:
     - Set `loading = true`, `error = null`
     - Call `apiRequest<Brand>('/brands', { method: 'POST', body: JSON.stringify({ name: name.trim() }) })`
     - On success: call `onBrandCreated(brand)`, reset the name field, close the modal via `onOpenChange(false)`
     - On error: set `error` to the error message
     - Finally: set `loading = false`
  4. Render a simple dialog/modal with:
     - Title: "Create Brand"
     - An input field for the brand name (placeholder: "Enter brand name")
     - Error message display (if error is not null, show it in red text)
     - A "Cancel" button that closes the modal
     - A "Create" button that submits (disabled while loading)

  **UI approach**: Since the project already has shadcn/ui, you can use basic HTML elements (`<div>`, `<input>`, `<button>`) styled with Tailwind classes. Use a simple overlay pattern:
  - If `!open`, return `null`
  - Render a fixed overlay `div` with `className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"`
  - Inside, a white card `div` with `className="w-full max-w-md rounded-lg bg-white p-6 shadow-lg"`
  - Form with `onSubmit` handler (call `e.preventDefault()` first)

  **Imports**: `useState` from `react`, `apiRequest` from `@/lib/api`, `Brand` from `@/types`.

- [x] T010 [US1] Add create brand button and modal to brands page in `frontend/app/(dashboard)/brands/page.tsx`

  **What to do**: Replace the current placeholder content of this file. The file currently just shows "Brands" heading and placeholder text.

  Make it a `'use client'` component that:
  1. Imports `useState` from `react`, `useRouter` from `next/navigation`, `useBrands` from `@/hooks/use-brands`, `CreateBrandModal` from `@/components/brand/create-brand-modal`, `Brand` from `@/types`
  2. Has state: `showCreateModal: boolean` (default `false`)
  3. Uses `useBrands()` hook to get `{ brands, loading, error, refetch }`
  4. Uses `useRouter()` for navigation
  5. Has a handler `handleBrandCreated(brand: Brand)` that:
     - Calls `refetch()` to refresh the brand list
     - Navigates to the new brand: `router.push(`/${brand.id}`)`
  6. Renders:
     - A header row with "Brands" title and a "Create Brand" button (opens the modal)
     - If `loading`: show "Loading..." text
     - If `error`: show error in red text
     - If `brands.length === 0` and not loading: show empty state — "No brands yet. Create your first brand to get started." with a "Create Brand" button
     - If `brands.length > 0`: show brand cards in a grid (for now, just show brand name and created_at as simple cards — the full brand-card component will be built in US2/T013)
     - The `CreateBrandModal` at the bottom of the JSX, with `open={showCreateModal}`, `onOpenChange={setShowCreateModal}`, `onBrandCreated={handleBrandCreated}`

  **Note**: This page will be enhanced in US2 (Phase 4) with proper brand cards. For now, a simple list with name is enough to verify brand creation works.

**Checkpoint**: User can create a brand. After creation, they are redirected to the brand's view. The brands page shows their brands (basic list). Empty state shown when no brands exist.

---

## Phase 4: User Story 2 - View and Browse Brands (Priority: P1)

**Goal**: Users see all their brands in a list with name, logo placeholder, and kit status. A brand selector in the nav allows switching. Brand detail page shows full info.

**Independent Test**: Create 2+ brands, verify they all appear in the list and selector, click one to view details.

- [x] T011 [P] [US2] Implement `GET /brands` (list) endpoint in `backend/app/routers/brands.py`

  **What to do**: Add this endpoint (replace the `# GET /brands` placeholder comment).

  ```python
  @router.get("", response_model=list[BrandListItem])
  async def list_brands(current_user: User = Depends(get_current_user)):
  ```

  Logic:
  1. Get service client
  2. Query: `client.table("brands").select("*").eq("owner_user_id", current_user.id).order("created_at", desc=True).execute()`
  3. For each brand row, build a `BrandListItem`:
     - `id`, `name`, `created_at` from the row
     - `logo_url` from `_build_logo_url(row.get("logo_path"))`
     - `kit_status` from `_get_kit_status(row["id"])`
  4. Return the list (empty list `[]` if no brands)

  **Response**: 200 with array of `BrandListItem`.

- [x] T012 [P] [US2] Implement `GET /brands/{brand_id}` endpoint in `backend/app/routers/brands.py`

  **What to do**: Add this endpoint (replace the `# GET /brands/{brand_id}` placeholder comment).

  ```python
  @router.get("/{brand_id}", response_model=BrandResponse)
  async def get_brand(brand_id: UUID, current_user: User = Depends(get_current_user)):
  ```

  Logic:
  1. Call `brand = _get_brand_or_404(brand_id, current_user.id)` — this returns the brand dict or raises 404
  2. Get `kit_status = _get_kit_status(brand["id"])`
  3. Return a `BrandResponse` with: `id`, `name`, `logo_url` (via `_build_logo_url`), `kit_status`, `created_at`, `updated_at`

  **Response**: 200 with `BrandResponse`.

- [x] T013 [P] [US2] Create brand-card component in `frontend/components/brand/brand-card.tsx`

  **What to do**: Create `frontend/components/brand/brand-card.tsx`. This is a `'use client'` component.

  Props: `brand: BrandListItem`

  It renders a clickable card (wrapped in Next.js `Link` to `/${brand.id}`) showing:
  1. Brand logo: if `brand.logo_url` is not null, show an `<img>` tag with `src={brand.logo_url}`, `alt={brand.name}`, class `h-12 w-12 rounded-full object-cover`. If null, show a placeholder div with the first letter of the brand name (e.g., `<div className="flex h-12 w-12 items-center justify-center rounded-full bg-gray-200 text-lg font-semibold text-gray-500">{brand.name[0].toUpperCase()}</div>`).
  2. Brand name: `<h3>` with `className="font-medium"`
  3. Kit status badge: a small `<span>` showing `brand.kit_status` with different colors:
     - `"not_started"`: gray background, text "Not Started"
     - `"in_progress"`: yellow background, text "In Progress"
     - `"complete"`: green background, text "Complete"
  4. Created date: formatted nicely (use `new Date(brand.created_at).toLocaleDateString()`)

  Style the card with: `className="flex items-center gap-4 rounded-lg border p-4 hover:bg-gray-50 transition-colors"`.

  **Imports**: `Link` from `next/link`, `BrandListItem` from `@/types`.

- [x] T014 [US2] Update brand list page to use brand cards and show empty state in `frontend/app/(dashboard)/brands/page.tsx`

  **What to do**: Update the brands page created in T010. Replace the simple brand name list with proper `BrandCard` components.

  Changes:
  1. Import `BrandCard` from `@/components/brand/brand-card`
  2. In the brands display section (where brands are listed), replace the simple list with:
     ```tsx
     <div className="grid gap-4">
       {brands.map((brand) => (
         <BrandCard key={brand.id} brand={brand} />
       ))}
     </div>
     ```
  3. Keep the empty state as-is (from T010)
  4. Keep the loading and error states as-is

- [x] T015 [P] [US2] Create brand-selector dropdown component in `frontend/components/brand-selector.tsx`

  **What to do**: Create `frontend/components/brand-selector.tsx`. This is a `'use client'` component.

  Props: `brands: BrandListItem[]`, `currentBrandId?: string`

  It renders a dropdown/select that:
  1. Shows the currently selected brand name (or "Select a brand" if no brand is selected)
  2. Lists all brands as options
  3. On selecting a brand, navigates to `/${brand.id}` using `useRouter().push()`

  Implementation:
  - Use a `<select>` element styled with Tailwind: `className="rounded-md border bg-white px-3 py-1.5 text-sm"`
  - Default option: `<option value="">Select a brand</option>`
  - Map each brand to `<option key={brand.id} value={brand.id}>{brand.name}</option>`
  - On `onChange`, get the selected value and navigate: `router.push(`/${e.target.value}`)`
  - Set `value` to `currentBrandId || ""`

  **Imports**: `useRouter` from `next/navigation`, `BrandListItem` from `@/types`.

- [x] T016 [US2] Add brand selector to dashboard navigation in `frontend/app/(dashboard)/layout.tsx`

  **What to do**: Modify the existing dashboard layout. Read `frontend/app/(dashboard)/layout.tsx` first.

  Changes:
  1. Import `useBrands` from `@/hooks/use-brands`
  2. Import `BrandSelector` from `@/components/brand-selector`
  3. Import `useParams` from `next/navigation`
  4. Inside the component, add:
     ```tsx
     const { brands } = useBrands()
     const params = useParams()
     const currentBrandId = params.brandId as string | undefined
     ```
  5. In the nav bar, between the "Basar AI" link and the Account/Logout buttons, add:
     ```tsx
     {brands.length > 0 && (
       <BrandSelector brands={brands} currentBrandId={currentBrandId} />
     )}
     ```

- [x] T017 [P] [US2] Create `[brandId]` layout in `frontend/app/(dashboard)/[brandId]/layout.tsx`

  **What to do**: Create the directory `frontend/app/(dashboard)/[brandId]/` and the layout file.

  This layout:
  1. Is a `'use client'` component
  2. Takes `children` and `params: { brandId: string }` as props
  3. Uses `useBrand(params.brandId)` to fetch the brand
  4. If `loading`, shows "Loading..."
  5. If `error` or `!brand`, shows "Brand not found"
  6. Otherwise, renders:
     - A sub-navigation bar with links: "Generator" (href `/${brand.id}`), "Brand Kit" (href `/${brand.id}/kit`), "Keys" (href `/${brand.id}/keys`), "History" (href `/${brand.id}/history`), "Settings" (href `/${brand.id}/settings`)
     - Then renders `{children}` below the sub-nav
  7. Style the sub-nav with: `className="mb-6 flex gap-4 border-b pb-2"` and each link with `className="text-sm text-muted-foreground hover:text-foreground"`

  **Imports**: `Link` from `next/link`, `useBrand` from `@/hooks/use-brand`.

  **Note**: The "Generator", "Brand Kit", "Keys", and "History" links will show 404 for now — those pages will be built in future phases. That's expected.

- [x] T018 [P] [US2] Create `[brandId]` main page (placeholder) in `frontend/app/(dashboard)/[brandId]/page.tsx`

  **What to do**: Create `frontend/app/(dashboard)/[brandId]/page.tsx`.

  This is a simple page that shows:
  ```tsx
  export default function BrandPage() {
    return (
      <div>
        <h2 className="text-xl font-semibold">Generator</h2>
        <p className="mt-2 text-muted-foreground">
          Image generation will be available in a future update.
        </p>
      </div>
    )
  }
  ```

  This is a placeholder — the actual generator UI will be built in Phase 6 of the overall project.

**Checkpoint**: Users can see all their brands in a list, switch between brands using the nav selector, view individual brand pages, and see the brand detail sub-navigation.

---

## Phase 5: User Story 3 - Upload and Remove Brand Logo (Priority: P2)

**Goal**: Brand owners can upload a logo (PNG/JPG/WebP, max 5MB, resized to 512x512) and remove it.

**Independent Test**: Navigate to a brand, upload a logo image, see it display. Then remove it, see placeholder return.

- [x] T019 [US3] Implement `POST /brands/{brand_id}/logo` endpoint in `backend/app/routers/brands.py`

  **What to do**: Add this endpoint (replace the `# POST /brands/{brand_id}/logo` placeholder).

  ```python
  @router.post("/{brand_id}/logo", response_model=LogoUploadResponse)
  async def upload_logo(brand_id: UUID, file: UploadFile = File(...), current_user: User = Depends(get_current_user)):
  ```

  Logic:
  1. Call `brand = _get_brand_or_404(brand_id, current_user.id)` — verifies ownership
  2. Validate the file MIME type. Check `file.content_type` is in `["image/png", "image/jpeg", "image/webp"]`. If not, raise `_error_response(400, "INVALID_FILE_TYPE", "Only PNG, JPG, and WebP images are accepted")`.
  3. Read the file bytes: `file_bytes = await file.read()`
  4. Check size: if `len(file_bytes) > 5 * 1024 * 1024`, raise `_error_response(400, "VALIDATION_ERROR", "File size exceeds 5 MB limit")`
  5. Resize with Pillow:
     ```python
     from PIL import Image
     import io
     img = Image.open(io.BytesIO(file_bytes))
     img.thumbnail((512, 512))
     output = io.BytesIO()
     # Determine format from content type
     fmt_map = {"image/png": "PNG", "image/jpeg": "JPEG", "image/webp": "WEBP"}
     fmt = fmt_map[file.content_type]
     img.save(output, format=fmt)
     resized_bytes = output.getvalue()
     ```
  6. Determine file extension: `ext_map = {"image/png": "png", "image/jpeg": "jpg", "image/webp": "webp"}`, `ext = ext_map[file.content_type]`
  7. Build storage path: `storage_path = f"brands/{brand_id}/logo.{ext}"`
  8. If the brand already has a logo (`brand.get("logo_path")`), delete the old logo from storage first:
     ```python
     if brand.get("logo_path"):
         try:
             client.storage.from_(settings.STORAGE_BUCKET).remove([brand["logo_path"]])
         except Exception as e:
             logger.warning(f"Failed to delete old logo: {e}")
     ```
  9. Upload the resized image to Supabase Storage:
     ```python
     client = get_service_client()
     client.storage.from_(settings.STORAGE_BUCKET).upload(
         storage_path, resized_bytes,
         {"content-type": file.content_type, "upsert": "true"}
     )
     ```
  10. Update the brand row in the database:
      ```python
      client.table("brands").update({"logo_path": storage_path}).eq("id", str(brand_id)).execute()
      ```
  11. Return `LogoUploadResponse(logo_url=_build_logo_url(storage_path))`

  **Important**: Import `from PIL import Image` and `import io` at the top of the file.

- [x] T020 [US3] Implement `DELETE /brands/{brand_id}/logo` endpoint in `backend/app/routers/brands.py`

  **What to do**: Add this endpoint (replace the `# DELETE /brands/{brand_id}/logo` placeholder).

  ```python
  @router.delete("/{brand_id}/logo", status_code=status.HTTP_204_NO_CONTENT)
  async def delete_logo(brand_id: UUID, current_user: User = Depends(get_current_user)):
  ```

  Logic:
  1. Call `brand = _get_brand_or_404(brand_id, current_user.id)`
  2. If `brand.get("logo_path")` is None, raise `_error_response(404, "LOGO_NOT_FOUND", "Brand has no logo to delete")`
  3. Delete the file from storage:
     ```python
     client = get_service_client()
     client.storage.from_(settings.STORAGE_BUCKET).remove([brand["logo_path"]])
     ```
  4. Set `logo_path` to NULL in the database:
     ```python
     client.table("brands").update({"logo_path": None}).eq("id", str(brand_id)).execute()
     ```
  5. Return nothing (204 No Content — FastAPI handles this automatically with `status_code=204`).

**Checkpoint**: Logo upload and removal works via API. Frontend integration happens in US6 (Settings Page).

---

## Phase 6: User Story 4 - Delete a Brand (Priority: P2)

**Goal**: Brand owners can permanently delete a brand. All associated data (DB rows via cascade + storage files + Vault secrets) is removed. Frontend requires typing the brand name (case-sensitive) to confirm.

**Independent Test**: Create a brand, delete it (type the exact name), verify it's gone from the list and direct URL returns 404.

- [x] T021 [US4] Implement `DELETE /brands/{brand_id}` endpoint (hard delete with cascade) in `backend/app/routers/brands.py`

  **What to do**: Add this endpoint (replace the `# DELETE /brands/{brand_id}` placeholder). This is the most complex endpoint.

  ```python
  @router.delete("/{brand_id}", status_code=status.HTTP_204_NO_CONTENT)
  async def delete_brand(brand_id: UUID, current_user: User = Depends(get_current_user)):
  ```

  Logic (follow this EXACT order):
  1. Call `brand = _get_brand_or_404(brand_id, current_user.id)` — verifies ownership
  2. Get service client: `client = get_service_client()`

  3. **Step 1 — Delete generation images from storage**:
     ```python
     gen_result = client.table("generations").select("image_path").eq("brand_id", str(brand_id)).not_.is_("image_path", "null").execute()
     for gen in (gen_result.data or []):
         try:
             client.storage.from_(settings.STORAGE_BUCKET).remove([gen["image_path"]])
         except Exception as e:
             logger.warning(f"Failed to delete generation image {gen['image_path']}: {e}")
     ```

  4. **Step 2 — Delete brand logo from storage**:
     ```python
     if brand.get("logo_path"):
         try:
             client.storage.from_(settings.STORAGE_BUCKET).remove([brand["logo_path"]])
         except Exception as e:
             logger.warning(f"Failed to delete logo {brand['logo_path']}: {e}")
     ```

  5. **Step 3 — Delete Vault secrets for provider keys**:
     ```python
     keys_result = client.table("provider_keys").select("vault_secret_id").eq("brand_id", str(brand_id)).execute()
     for key in (keys_result.data or []):
         try:
             client.rpc("delete_secret", {"secret_id": key["vault_secret_id"]}).execute()
         except Exception as e:
             logger.warning(f"Failed to delete vault secret: {e}")
     ```
     **Note**: The Vault secret deletion uses an RPC call. If the `delete_secret` function doesn't exist yet (it may be added in a later phase), this step will log a warning and continue. That's fine — the important thing is that it doesn't block the brand deletion.

  6. **Step 4 — Delete the brand row** (DB cascade handles brand_kits, provider_keys, generations):
     ```python
     client.table("brands").delete().eq("id", str(brand_id)).execute()
     ```

  7. Return nothing (204 No Content).

  **Important**: Storage and Vault deletions are best-effort (wrapped in try/except). Only the final brand row deletion is required to succeed.

- [x] T022 [US4] Create delete-brand-dialog component in `frontend/components/brand/delete-brand-dialog.tsx`

  **What to do**: Create `frontend/components/brand/delete-brand-dialog.tsx`. This is a `'use client'` component.

  Props: `brand: Brand`, `open: boolean`, `onOpenChange: (open: boolean) => void`, `onBrandDeleted: () => void`

  It renders a confirmation dialog where the user must type the brand name (case-sensitive exact match) to confirm deletion:
  1. Has local state: `confirmName: string` (default `""`), `loading: boolean` (default `false`), `error: string | null` (default `null`)
  2. The "Delete" button is disabled unless `confirmName === brand.name` (exact case-sensitive match) AND `loading` is false
  3. On clicking "Delete":
     - Set `loading = true`, `error = null`
     - Call `apiRequest('/brands/${brand.id}', { method: 'DELETE' })`
     - On success: call `onBrandDeleted()`, close the dialog
     - On error: set `error` to the error message
     - Finally: set `loading = false`
  4. Render:
     - Same overlay pattern as create-brand-modal (T009)
     - Title: "Delete Brand" in red text
     - Warning text: "This action is permanent and cannot be undone. All data associated with this brand (generated images, provider keys, brand kit) will be permanently deleted."
     - Instruction: `Type "${brand.name}" to confirm deletion:`
     - An input field for typing the brand name
     - Error message display (if any)
     - "Cancel" button and "Delete Brand" button (red, disabled until name matches)

  **Imports**: `useState` from `react`, `apiRequest` from `@/lib/api`, `Brand` from `@/types`.

**Checkpoint**: Brand deletion works end-to-end. The delete dialog will be placed on the settings page in US6.

---

## Phase 7: User Story 5 - Rename a Brand (Priority: P2)

**Goal**: Brand owners can change a brand's name. Same validation rules apply (2-120 chars, trimmed, case-insensitive unique per user).

**Independent Test**: Rename a brand, verify the new name appears in the brand list, selector, and settings.

- [x] T023 [US5] Implement `PATCH /brands/{brand_id}` endpoint in `backend/app/routers/brands.py`

  **What to do**: Add this endpoint (replace the `# PATCH /brands/{brand_id}` placeholder).

  ```python
  @router.patch("/{brand_id}", response_model=BrandResponse)
  async def update_brand(brand_id: UUID, body: UpdateBrandRequest, current_user: User = Depends(get_current_user)):
  ```

  Logic:
  1. Call `brand = _get_brand_or_404(brand_id, current_user.id)` — verifies ownership
  2. Strip the name: `name = body.name.strip()`
  3. If `name == brand["name"]`, return the current brand as-is (no-op — don't error on same-name update)
  4. Try to update:
     ```python
     client = get_service_client()
     result = client.table("brands").update({"name": name}).eq("id", str(brand_id)).execute()
     ```
  5. Catch duplicate name errors the same way as in the create endpoint (T008): wrap in try/except for `APIError`, check for `"uq_brands_owner_name_ci"` or `"duplicate key"` in the error string, raise `_error_response(409, "DUPLICATE_BRAND_NAME", "A brand with this name already exists")`.
  6. Get the updated row from `result.data[0]`
  7. Get `kit_status = _get_kit_status(row["id"])`
  8. Return `BrandResponse` with all fields.

**Checkpoint**: Brand rename works via API. Frontend integration happens in US6 (Settings Page).

---

## Phase 8: User Story 6 - Brand Settings Page (Priority: P3)

**Goal**: A dedicated settings page where the brand owner can rename the brand, upload/remove the logo, and delete the brand. All actions from US3, US4, and US5 are consolidated here.

**Independent Test**: Navigate to brand settings, rename the brand, upload a logo, remove the logo, delete the brand.

- [x] T024 [US6] Create brand settings page in `frontend/app/(dashboard)/[brandId]/settings/page.tsx`

  **What to do**: Create the directory `frontend/app/(dashboard)/[brandId]/settings/` and the page file.

  This is a `'use client'` page component. It uses `useParams()` to get `brandId` and `useBrand(brandId)` to get the brand.

  The page has 3 sections:

  **Section 1 — Brand Name (Rename)**:
  1. Show the current brand name in an input field
  2. Have local state: `newName: string` (initialized to `brand.name`), `renameLoading`, `renameError`
  3. A "Save" button that calls `apiRequest<Brand>(`/brands/${brandId}`, { method: 'PATCH', body: JSON.stringify({ name: newName.trim() }) })`
  4. On success: call `mutate(updatedBrand)` to update the hook state, show a success message (or clear the error)
  5. On error: show the error message (e.g., "A brand with this name already exists")

  **Section 2 — Brand Logo**:
  1. Show the current logo (if `brand.logo_url` is not null, show an `<img>`; otherwise show placeholder)
  2. A file input `<input type="file" accept="image/png,image/jpeg,image/webp">` for uploading
  3. Have local state: `logoLoading`, `logoError`
  4. On file selection, upload immediately:
     ```typescript
     const formData = new FormData()
     formData.append('file', selectedFile)
     const result = await apiRequest<LogoUploadResponse>(
       `/brands/${brandId}/logo`,
       { method: 'POST', body: formData }
     )
     ```
     **Important**: When using `FormData`, do NOT set `Content-Type` header — the browser sets it automatically with the correct boundary. The existing `apiRequest` function in `frontend/lib/api.ts` already handles this: it only sets `Content-Type: application/json` if the body is NOT a `FormData` instance (check line 13-15 of that file).
  5. On success: update the brand's logo_url locally via `mutate({...brand, logo_url: result.logo_url})`
  6. A "Remove Logo" button (shown only if `brand.logo_url` is not null) that:
     - Calls `apiRequest(`/brands/${brandId}/logo`, { method: 'DELETE' })`
     - On success: update `mutate({...brand, logo_url: null})`

  **Section 3 — Danger Zone (Delete)**:
  1. A red-bordered section at the bottom with heading "Danger Zone"
  2. Text: "Permanently delete this brand and all associated data."
  3. A red "Delete Brand" button that opens the `DeleteBrandDialog`
  4. Import and use `DeleteBrandDialog` from `@/components/brand/delete-brand-dialog`
  5. Have state: `showDeleteDialog: boolean` (default `false`)
  6. Pass `onBrandDeleted` handler that navigates to `/brands` using `router.push('/brands')`

  **Layout**:
  ```
  <h2>Settings</h2>

  <div> <!-- Rename section -->
    <h3>Brand Name</h3>
    <input + save button>
  </div>

  <div> <!-- Logo section -->
    <h3>Brand Logo</h3>
    <current logo or placeholder>
    <file input + remove button>
  </div>

  <div className="mt-8 rounded-lg border border-red-200 p-6"> <!-- Danger zone -->
    <h3 className="text-red-600">Danger Zone</h3>
    <p>Permanently delete this brand...</p>
    <button red>Delete Brand</button>
  </div>

  <DeleteBrandDialog ... />
  ```

  **Imports**: `useState` from `react`, `useParams`, `useRouter` from `next/navigation`, `useBrand` from `@/hooks/use-brand`, `apiRequest` from `@/lib/api`, `DeleteBrandDialog` from `@/components/brand/delete-brand-dialog`, `Brand`, `LogoUploadResponse` from `@/types`.

**Checkpoint**: Settings page fully functional — rename, logo upload/remove, and delete all work from one page.

---

## Phase 9: Polish & Cross-Cutting Concerns

**Purpose**: Final cleanup, edge case handling, and verification.

- [x] T025 Add shadcn/ui Dialog component if not already installed, and refactor create-brand-modal and delete-brand-dialog to use it for better accessibility in `frontend/components/brand/create-brand-modal.tsx` and `frontend/components/brand/delete-brand-dialog.tsx`

  **What to do**: Check if `@radix-ui/react-dialog` is in `frontend/package.json`. If not, run `cd frontend && npx shadcn-ui@latest add dialog` to install it. Then refactor both modals to use the shadcn `Dialog` component instead of custom overlay divs. This improves accessibility (focus trap, escape key, screen reader support). If the shadcn dialog is already available, proceed with the refactor. If installing shadcn components doesn't work easily, skip this task — the custom overlay approach from T009/T022 is functional.

- [x] T026 Verify loading and error states across all pages: `frontend/app/(dashboard)/brands/page.tsx`, `frontend/app/(dashboard)/[brandId]/layout.tsx`, `frontend/app/(dashboard)/[brandId]/settings/page.tsx`

  **What to do**: Review each page and ensure:
  1. Loading states show a clear "Loading..." indicator (not a blank screen)
  2. Error states show the error message in red text with a suggestion to retry
  3. Forms disable their submit buttons while loading
  4. After successful actions (create, rename, delete), the UI updates immediately (optimistic or via refetch)
  5. Network errors (e.g., backend is down) show a generic "Something went wrong" message

- [x] T027 Run the manual testing checklist from `specs/003-brand-crud/quickstart.md` (Testing section)

  **What to do**: Go through each item in the manual testing checklist and verify it works:
  1. Create a brand with valid name -> appears in list
  2. Create brand with duplicate name (case-insensitive) -> 409 error shown
  3. Create brand with name < 2 chars -> 400 error shown
  4. Rename a brand -> name updates everywhere
  5. Upload logo (PNG, < 5MB) -> logo displays
  6. Upload logo (replace existing) -> old logo gone, new one shows
  7. Delete logo -> placeholder shows
  8. Delete brand (type name correctly) -> brand gone, storage cleaned up
  9. Delete brand (type name incorrectly) -> blocked
  10. Brand selector in nav -> switches brands
  11. Access another user's brand by URL -> 404
  12. Empty brand list -> shows empty state with create CTA

  Fix any issues found during testing.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately. All 4 tasks can run in parallel.
- **Foundational (Phase 2)**: Depends on Phase 1 completion (needs models and types). T005 requires T003 (brand models). T006/T007 require T004 (TypeScript types).
- **US1 (Phase 3)**: Depends on Phase 2 (needs router skeleton and hooks).
- **US2 (Phase 4)**: Depends on Phase 2. Can run in parallel with US1 if desired, but logically US1 first so you can create brands to view.
- **US3 (Phase 5)**: Depends on Phase 2 (router skeleton). Independent of US1/US2 at the backend level, but the frontend settings page (US6) integrates it.
- **US4 (Phase 6)**: Depends on Phase 2 (router skeleton). Independent of US1/US2/US3 at the backend level.
- **US5 (Phase 7)**: Depends on Phase 2 (router skeleton). Independent of US1/US2/US3/US4 at the backend level.
- **US6 (Phase 8)**: Depends on US3, US4, US5 (settings page combines rename, logo, delete). Also depends on US2 (for the [brandId] layout).
- **Polish (Phase 9)**: Depends on all previous phases.

### Recommended Execution Order (Sequential)

```
Phase 1 (Setup) → Phase 2 (Foundational) → Phase 3 (US1) → Phase 4 (US2) → Phase 5 (US3) → Phase 6 (US4) → Phase 7 (US5) → Phase 8 (US6) → Phase 9 (Polish)
```

### User Story Dependencies

- **US1 (Create Brand)**: Needs foundational only. First story to implement.
- **US2 (View/Browse)**: Needs foundational only. Best after US1 so there are brands to view.
- **US3 (Logo)**: Needs foundational only for backend. Frontend part goes in US6 settings page.
- **US4 (Delete)**: Needs foundational only for backend. Frontend part goes in US6 settings page.
- **US5 (Rename)**: Needs foundational only for backend. Frontend part goes in US6 settings page.
- **US6 (Settings Page)**: Needs US3, US4, US5 backend endpoints complete. Needs US2 for [brandId] layout.

### Parallel Opportunities

Within Phase 1: T001, T002, T003, T004 are all independent files — all can run in parallel.
Within Phase 2: T006 and T007 can run in parallel (different files). T005 must complete first as the router file is shared.
Within Phase 4: T011, T012, T013, T015, T017, T018 can run in parallel (all different files).
Backend for US3/US4/US5 (T019-T023) all modify the same file (`brands.py`) — run sequentially.

---

## Implementation Strategy

### MVP First (US1 + US2 Only)

1. Complete Phase 1: Setup (4 tasks)
2. Complete Phase 2: Foundational (3 tasks)
3. Complete Phase 3: US1 - Create a Brand (3 tasks)
4. Complete Phase 4: US2 - View and Browse (6 tasks)
5. **STOP and VALIDATE**: Users can create brands and view them. This is the MVP.

### Incremental Delivery

1. Setup + Foundational -> Foundation ready
2. US1 -> Users can create brands
3. US2 -> Users can view, browse, and switch brands (MVP complete)
4. US3 + US4 + US5 -> Backend endpoints for logo, delete, rename ready
5. US6 -> Settings page integrates logo, delete, rename into UI
6. Polish -> Loading states, error handling, accessibility

### Total Task Count: 27

| Phase | Tasks | Description |
|-------|-------|-------------|
| Phase 1: Setup | 4 | Migration, dependency, models, types |
| Phase 2: Foundational | 3 | Router skeleton, frontend hooks |
| Phase 3: US1 | 3 | Create brand (backend + frontend) |
| Phase 4: US2 | 6 | View/browse brands (backend + frontend) |
| Phase 5: US3 | 2 | Logo upload/remove (backend only) |
| Phase 6: US4 | 2 | Delete brand (backend + frontend dialog) |
| Phase 7: US5 | 1 | Rename brand (backend only) |
| Phase 8: US6 | 1 | Settings page (frontend — combines US3/4/5) |
| Phase 9: Polish | 3 | Accessibility, error states, testing |

---

## Notes

- [P] tasks = different files, no dependencies on incomplete tasks
- [Story] label maps task to specific user story
- Each user story should be independently testable after its phase completes
- Commit after each task or logical group
- The backend uses `get_service_client()` (service role) for ALL DB and storage operations. This bypasses RLS, so ownership checks MUST be done in code via `_get_brand_or_404()`.
- All endpoints return 404 (not 403) for unauthorized access — this prevents information leakage about brand existence.
- SVG files are REJECTED for security reasons. Only PNG, JPG, and WebP are accepted.
- Hard delete means NO soft delete, NO archive, NO undo. Data is permanently removed.
