# Quickstart: Brand Management (003-brand-crud)

## What This Feature Does

Adds brand CRUD (Create, Read, Update, Delete) to Basar AI. Users can create brands, view their brand list, rename brands, upload/remove logos, switch between brands, and permanently delete brands (hard delete with full data cleanup).

## Prerequisites

Before starting, make sure:
1. You are on the `003-brand-crud` branch: `git checkout 003-brand-crud`
2. Backend venv is active: `cd backend && source venv/bin/activate`
3. Supabase is running: `supabase start` (from project root)
4. Backend runs: `cd backend && uvicorn app.main:app --reload`
5. Frontend runs: `cd frontend && npm run dev`

## Existing Code to Know

These files already exist and you will extend them:

### Backend (Python/FastAPI)
- `backend/app/main.py` — FastAPI app. You will add the new brands router here.
- `backend/app/core/auth.py` — `get_current_user` dependency. Use this for all brand endpoints.
- `backend/app/core/supabase.py` — `get_service_client()` and `get_user_client()`. Use `get_service_client()` for all DB and storage operations (it bypasses RLS, so you must check ownership in code).
- `backend/app/config.py` — Settings. `STORAGE_BUCKET` is already configured as `"brand-assets"`.
- `backend/app/models/profile.py` — Example of Pydantic model patterns (request/response).
- `backend/app/routers/me.py` — Example of router patterns (error responses, Supabase client usage).
- `backend/requirements.txt` — Add `Pillow>=10.0.0` here for logo resize.

### Frontend (TypeScript/Next.js 14)
- `frontend/lib/api.ts` — `apiRequest<T>()` helper. Use this for all backend API calls.
- `frontend/hooks/use-profile.ts` — Example hook pattern (fetch, loading, error, mutate).
- `frontend/types/index.ts` — Add Brand types here.
- `frontend/app/(dashboard)/layout.tsx` — Dashboard nav. Add the brand selector here.
- `frontend/app/(dashboard)/brands/page.tsx` — Placeholder brand list page. Replace this.
- `frontend/components/ui/` — shadcn/ui components (button, card, form, input, toast, etc.).
- `frontend/middleware.ts` — Auth middleware. No changes needed.

### Database (already migrated)
- `supabase/migrations/00003_create_brands.sql` — Brands table with constraints and indexes.
- `supabase/migrations/00008_add_rls_policies.sql` — RLS policies for all tables.
- `supabase/migrations/00009_create_storage_bucket.sql` — `brand-assets` bucket with storage RLS.
- No new migrations needed for this feature.

## Files to Create

### Backend
- `backend/app/models/brand.py` — Pydantic models: `CreateBrandRequest`, `UpdateBrandRequest`, `BrandResponse`, `LogoUploadResponse`.
- `backend/app/routers/brands.py` — Router with all 7 brand endpoints (list, create, get, update, delete, upload logo, delete logo).

### Frontend
- `frontend/hooks/use-brands.ts` — Hook for brand list (fetch all brands).
- `frontend/hooks/use-brand.ts` — Hook for single brand (fetch, rename, delete).
- `frontend/components/brand/brand-card.tsx` — Brand card for the list page.
- `frontend/components/brand/create-brand-modal.tsx` — Modal dialog to create a brand.
- `frontend/components/brand/delete-brand-dialog.tsx` — Delete confirmation dialog (type brand name).
- `frontend/components/brand-selector.tsx` — Dropdown in nav to switch brands.
- `frontend/app/(dashboard)/brands/new/page.tsx` — Create brand page (or just use modal from list page).
- `frontend/app/(dashboard)/[brandId]/layout.tsx` — Brand-specific layout.
- `frontend/app/(dashboard)/[brandId]/page.tsx` — Brand main view (placeholder for generator).
- `frontend/app/(dashboard)/[brandId]/settings/page.tsx` — Brand settings (rename, logo, delete).

## Key Patterns

### Backend Error Responses
Follow the existing pattern from `me.py`:
```python
def _error_response(status_code: int, code: str, message: str) -> HTTPException:
    return HTTPException(
        status_code=status_code,
        detail={"error": {"code": code, "message": message, "request_id": str(uuid4())}},
    )
```

### Backend Brand Ownership Check
Every endpoint must verify the user owns the brand before proceeding:
```python
result = client.table("brands").select("*").eq("id", str(brand_id)).eq("owner_user_id", current_user.id).maybe_single().execute()
if not result.data:
    raise _error_response(404, "BRAND_NOT_FOUND", "Brand not found")
```

### Backend Logo Resize (Pillow)
For raster images (PNG/JPG/WebP), resize to max 512x512 preserving aspect ratio:
```python
import io
from PIL import Image
img = Image.open(io.BytesIO(file_bytes))
img.thumbnail((512, 512))
```
SVG files are rejected (security risk — embedded scripts, XML entity attacks).

### Backend Storage Upload
Use the service client to upload to Supabase Storage:
```python
client = get_service_client()
storage_path = f"brands/{brand_id}/logo.{ext}"
client.storage.from_(settings.STORAGE_BUCKET).upload(storage_path, file_bytes, {"content-type": mime_type, "upsert": "true"})
```

### Backend Logo URL Construction
Build the public URL from the storage path:
```python
logo_url = f"{settings.SUPABASE_URL}/storage/v1/object/public/{settings.STORAGE_BUCKET}/{logo_path}"
```

### Frontend API Calls
Use the existing `apiRequest` helper:
```typescript
const brands = await apiRequest<Brand[]>('/brands')
const brand = await apiRequest<Brand>('/brands', { method: 'POST', body: JSON.stringify({ name }) })
```

### Frontend Hook Pattern
Follow `use-profile.ts`:
```typescript
const [brands, setBrands] = useState<Brand[]>([])
const [loading, setLoading] = useState(true)
const [error, setError] = useState<string | null>(null)
```

## Testing

### Backend Tests
Add to `backend/tests/`:
- `test_brands.py` — Test all 7 endpoints. Mock Supabase client. Test validation, ownership checks, error codes.

### Manual Testing Checklist
1. Create a brand with valid name -> appears in list
2. Create brand with duplicate name (case-insensitive) -> 409 error
3. Create brand with name < 2 chars -> 400 error
4. Rename a brand -> name updates everywhere
5. Upload logo (PNG, < 5MB) -> logo displays
6. Upload logo (replace existing) -> old logo gone, new one shows
7. Delete logo -> placeholder shows
8. Delete brand (type name correctly) -> brand gone, storage cleaned up
9. Delete brand (type name incorrectly) -> blocked
10. Brand selector in nav -> switches brands
11. Access another user's brand by URL -> 404
12. Empty brand list -> shows empty state with create CTA
