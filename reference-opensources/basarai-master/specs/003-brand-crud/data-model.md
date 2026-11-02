# Data Model: Brand Management (003-brand-crud)

**Date**: 2026-03-07

## Entities

### Brand (existing table — `brands`)

The `brands` table already exists from migration `00003_create_brands.sql`. No schema changes needed.

| Field | Type | Constraints | Notes |
|-------|------|-------------|-------|
| `id` | UUID | PK, auto-generated | `gen_random_uuid()` |
| `owner_user_id` | UUID | NOT NULL, FK → `auth.users(id)` ON DELETE CASCADE | The user who owns this brand |
| `name` | TEXT | NOT NULL, 2-120 chars after trim | Check constraint `chk_brands_name_length` |
| `logo_path` | TEXT | NULL allowed, regex validated | Pattern: `brands/{uuid}/logo.{ext}`. Check constraint `chk_brands_logo_path_format` |
| `created_at` | TIMESTAMPTZ | NOT NULL, default `NOW()` | |
| `updated_at` | TIMESTAMPTZ | NOT NULL, default `NOW()` | Auto-updated via trigger from migration `00007` |

**Indexes** (already exist):
- `uq_brands_owner_name_ci` — UNIQUE on `(owner_user_id, lower(name))`: Enforces case-insensitive name uniqueness per user.
- `idx_brands_owner_created` — on `(owner_user_id, created_at DESC)`: Supports list query sorted by newest first.

**RLS** (already configured in migration `00008`):
- `brands_select_own`: SELECT where `owner_user_id = auth.uid()`
- `brands_insert_own`: INSERT where `owner_user_id = auth.uid()`
- `brands_update_own`: UPDATE where `owner_user_id = auth.uid()`
- `brands_delete_own`: DELETE where `owner_user_id = auth.uid()`

### Brand Logo (storage object — not a DB table)

| Attribute | Value |
|-----------|-------|
| Bucket | `brand-assets` (public, already created in migration `00009`) |
| Path pattern | `brands/{brandId}/logo.{ext}` |
| Allowed MIME types | `image/png`, `image/jpeg`, `image/webp` |
| Max file size | 5 MB (enforced by bucket config) |
| Max dimensions | 512x512 px (enforced by backend resize on upload) |

**Storage RLS** (already configured in migration `00009`):
- Public read for all objects in `brand-assets`
- Authenticated insert/update/delete scoped to user's own brands via `storage.foldername`

## Relationships

```
auth.users (1) ──── owns ────> (N) brands
brands (1) ──── has ────> (0..1) brand logo (storage object)
brands (1) ──── has ────> (0..1) brand_kits (FK cascade, managed by Phase 5)
brands (1) ──── has ────> (N) provider_keys (FK cascade, managed by Phase 4)
brands (1) ──── has ────> (N) generations (FK cascade, managed by Phase 6)
```

## Validation Rules

| Rule | Where Enforced | Details |
|------|----------------|---------|
| Name length 2-120 chars | DB check + backend Pydantic | Trim whitespace first, then validate length |
| Name uniqueness per user (case-insensitive) | DB unique index | `uq_brands_owner_name_ci` on `(owner_user_id, lower(name))` |
| Logo path format | DB check constraint | Must match `^brands/[0-9a-f-]+/logo\.[A-Za-z0-9]+$` or be NULL |
| Logo file type | Storage bucket config + backend validation | Only PNG, JPEG, WebP (SVG excluded for security) |
| Logo file size | Storage bucket config | Max 5 MB |
| Logo dimensions | Backend (Pillow resize) | Max 512x512 px, aspect ratio preserved |
| Owner must match auth user | RLS policies + backend check | Both DB-level (RLS) and application-level (explicit check with service client) |

## State Transitions

Brand has no explicit status field. The only lifecycle transitions are:

```
[Created] → exists in DB with name, no logo, kit_status="not_started"
[Updated] → name changed (rename) or logo_path changed (upload/remove)
[Deleted] → hard delete: DB row removed, storage files removed, cascades to related tables
```

## Schema Changes Required

**One migration required:** Remove `image/svg+xml` from the `brand-assets` storage bucket's `allowed_mime_types`. SVG is excluded due to security risks (embedded scripts, XML entity attacks).

Migration `00011_remove_svg_from_storage_bucket.sql`:
```sql
UPDATE storage.buckets
SET allowed_mime_types = ARRAY['image/png', 'image/jpeg', 'image/webp']
WHERE id = 'brand-assets';
```

All other tables, indexes, constraints, and RLS policies are already in place from existing migrations (00003, 00007, 00008, 00009).
