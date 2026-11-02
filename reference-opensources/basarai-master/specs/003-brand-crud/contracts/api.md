# API Contracts: Brand Management

**Base path**: All endpoints are prefixed with the backend API URL.
**Auth**: All endpoints require a valid Bearer token (JWT from Supabase Auth).
**Error format**: All errors return `{ "error": { "code": "STRING", "message": "Human-readable", "request_id": "uuid" } }`.

---

## 1. List Brands

**`GET /brands`**

Returns all brands owned by the authenticated user, sorted by newest first.

**Request**: No body. No query parameters.

**Response** `200 OK`:
```json
[
  {
    "id": "uuid-string",
    "name": "My Brand",
    "logo_url": "https://supabase-url/storage/v1/object/public/brand-assets/brands/uuid/logo.png",
    "kit_status": "not_started",
    "created_at": "2026-03-07T12:00:00Z"
  }
]
```

**Fields**:
- `id` (string): Brand UUID.
- `name` (string): Brand display name.
- `logo_url` (string | null): Full public URL of the logo, or `null` if no logo.
- `kit_status` (string): One of `"not_started"`, `"in_progress"`, `"complete"`. Defaults to `"not_started"` if no brand kit exists yet.
- `created_at` (string): ISO 8601 timestamp.

**Errors**: None specific (empty array if user has no brands).

---

## 2. Create Brand

**`POST /brands`**

Creates a new brand for the authenticated user.

**Request body**:
```json
{
  "name": "My Brand"
}
```

**Validation**:
- `name` (string, required): 2-120 characters after trimming whitespace. Must not be empty or whitespace-only.

**Response** `201 Created`:
```json
{
  "id": "uuid-string",
  "name": "My Brand",
  "logo_url": null,
  "kit_status": "not_started",
  "created_at": "2026-03-07T12:00:00Z"
}
```

**Errors**:
- `400 VALIDATION_ERROR`: Name too short, too long, or empty.
- `409 DUPLICATE_BRAND_NAME`: A brand with this name (case-insensitive) already exists for this user.

---

## 3. Get Brand

**`GET /brands/{brand_id}`**

Returns details of a single brand. Returns 404 if brand doesn't exist or isn't owned by the user.

**Path parameters**:
- `brand_id` (UUID, required): The brand ID.

**Response** `200 OK`:
```json
{
  "id": "uuid-string",
  "name": "My Brand",
  "logo_url": "https://...",
  "kit_status": "not_started",
  "created_at": "2026-03-07T12:00:00Z",
  "updated_at": "2026-03-07T12:00:00Z"
}
```

**Note**: The `updated_at` field is included in the single-brand response but not in the list response (to keep the list payload small).

**Errors**:
- `404 BRAND_NOT_FOUND`: Brand does not exist or is not owned by the user.

---

## 4. Update Brand (Rename)

**`PATCH /brands/{brand_id}`**

Renames an existing brand. Returns 404 if brand doesn't exist or isn't owned by the user.

**Path parameters**:
- `brand_id` (UUID, required): The brand ID.

**Request body**:
```json
{
  "name": "New Brand Name"
}
```

**Validation**:
- `name` (string, required): 2-120 characters after trimming whitespace.

**Response** `200 OK`:
```json
{
  "id": "uuid-string",
  "name": "New Brand Name",
  "logo_url": "https://...",
  "kit_status": "not_started",
  "created_at": "2026-03-07T12:00:00Z",
  "updated_at": "2026-03-07T12:30:00Z"
}
```

**Errors**:
- `400 VALIDATION_ERROR`: Name too short, too long, or empty.
- `404 BRAND_NOT_FOUND`: Brand does not exist or is not owned by the user.
- `409 DUPLICATE_BRAND_NAME`: A brand with this name (case-insensitive) already exists for this user.

---

## 5. Delete Brand

**`DELETE /brands/{brand_id}`**

Hard-deletes a brand and all associated data (logo, generations, provider keys, brand kit). This is irreversible.

**Path parameters**:
- `brand_id` (UUID, required): The brand ID.

**Request**: No body.

**Response** `204 No Content`: Empty body on success.

**Errors**:
- `404 BRAND_NOT_FOUND`: Brand does not exist or is not owned by the user.

**Side effects** (all happen before the 204 is returned):
1. All generation image files for this brand are deleted from storage.
2. The brand logo file is deleted from storage (if it exists).
3. All Vault secrets for this brand's provider keys are deleted.
4. The brand DB row is deleted (cascades to `brand_kits`, `provider_keys`, `generations` rows).

**Note**: Storage and Vault deletions are best-effort. If an individual file/secret deletion fails, it is logged as a warning but does not block the overall delete.

---

## 6. Upload Brand Logo

**`POST /brands/{brand_id}/logo`**

Uploads or replaces the brand logo. The file is sent as multipart form data. The backend resizes images (PNG/JPG/WebP) to max 512x512 px (preserving aspect ratio). SVG files are rejected for security reasons.

**Path parameters**:
- `brand_id` (UUID, required): The brand ID.

**Request**: `Content-Type: multipart/form-data`
- `file` (file, required): The logo image file. Accepted types: PNG, JPG, WebP. Max 5 MB. SVG is rejected.

**Response** `200 OK`:
```json
{
  "logo_url": "https://supabase-url/storage/v1/object/public/brand-assets/brands/uuid/logo.png"
}
```

**Errors**:
- `400 VALIDATION_ERROR`: File missing, not an image, or exceeds size limit.
- `400 INVALID_FILE_TYPE`: File MIME type not in allowed list (PNG, JPEG, WebP). SVG is rejected.
- `404 BRAND_NOT_FOUND`: Brand does not exist or is not owned by the user.

**Side effects**:
1. If a previous logo exists, it is deleted from storage before uploading the new one.
2. The `brands.logo_path` column is updated to the new storage path.

---

## 7. Delete Brand Logo

**`DELETE /brands/{brand_id}/logo`**

Removes the brand logo. Sets `logo_path` to NULL.

**Path parameters**:
- `brand_id` (UUID, required): The brand ID.

**Request**: No body.

**Response** `204 No Content`: Empty body on success.

**Errors**:
- `404 BRAND_NOT_FOUND`: Brand does not exist or is not owned by the user.
- `404 LOGO_NOT_FOUND`: Brand exists but has no logo to delete.

**Side effects**:
1. The logo file is deleted from storage.
2. The `brands.logo_path` column is set to NULL.

---

## Error Code Reference

| HTTP Status | Code | When |
|-------------|------|------|
| 400 | `VALIDATION_ERROR` | Request body fails validation |
| 400 | `INVALID_FILE_TYPE` | Uploaded file is not an allowed image type |
| 401 | `AUTHENTICATION_REQUIRED` | Missing or invalid Bearer token |
| 404 | `BRAND_NOT_FOUND` | Brand ID not found or not owned by user |
| 404 | `LOGO_NOT_FOUND` | Brand has no logo to delete |
| 409 | `DUPLICATE_BRAND_NAME` | Brand name already taken (case-insensitive) for this user |
