# API Contract: Generation History

**Branch**: `008-generation-history` | **Date**: 2026-06-07
**Router prefix**: `/brands/{brand_id}`
**Auth**: All endpoints require `Authorization: Bearer <supabase_access_token>`.
**Scope**: Brand-scoped list, detail, download metadata, and hard delete for generation history.

---

## Shared Types

### GenerationHistoryItem

```json
{
  "id": "uuid",
  "prompt_excerpt": "A modern minimal office with natural light...",
  "provider": "openai",
  "model": "gpt-image-2",
  "platform_preset": "instagram_post",
  "width": 1080,
  "height": 1080,
  "logo_mode": "none",
  "status": "succeeded",
  "image_url": "https://.../brand-assets/brands/<brand-id>/generations/<generation-id>.png",
  "error_message": null,
  "created_at": "2026-06-07T12:30:00Z",
  "completed_at": "2026-06-07T12:30:15Z"
}
```

Notes:

- `image_url` is `null` for failed generations or missing successful images.
- `prompt_excerpt` is for list display only; detail returns full `prompt`.
- `image_path` is never returned.

### GenerationHistoryPage

```json
{
  "items": [GenerationHistoryItem],
  "next_cursor": "opaque-cursor-or-null",
  "page_size": 24
}
```

### GenerationDetailResponse

```json
{
  "id": "uuid",
  "prompt": "A modern minimal office with natural light, desk plants, and a laptop",
  "provider": "openai",
  "model": "gpt-image-2",
  "platform_preset": "instagram_post",
  "width": 1080,
  "height": 1080,
  "logo_mode": "none",
  "status": "succeeded",
  "provider_request_id": "provider-request-id-or-null",
  "image_url": "https://.../brand-assets/brands/<brand-id>/generations/<generation-id>.png",
  "download_filename": "my-brand-instagram_post-20260607-123015.png",
  "error_code": null,
  "error_message": null,
  "created_at": "2026-06-07T12:30:00Z",
  "completed_at": "2026-06-07T12:30:15Z"
}
```

Failed detail responses set `image_url` and `download_filename` to `null` and include `error_code` / `error_message`.

### ErrorResponse

All errors follow the project-standard shape:

```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable message",
    "request_id": "uuid"
  }
}
```

---

## GET /brands/{brand_id}/generations

List terminal generation history items for a brand, newest first.

### Query Parameters

| Name | Required | Values | Notes |
|------|----------|--------|-------|
| `provider` | no | `openai`, `gemini` | Omit for all providers |
| `status` | no | `succeeded`, `failed` | Omit for both terminal statuses |
| `cursor` | no | opaque string | Returned from previous page |

Page size is fixed at 24 and is not client-configurable.

### Response - 200 OK

```json
{
  "items": [
    {
      "id": "12345678-1234-1234-1234-123456789012",
      "prompt_excerpt": "A modern minimal office with natural light...",
      "provider": "openai",
      "model": "gpt-image-2",
      "platform_preset": "instagram_post",
      "width": 1080,
      "height": 1080,
      "logo_mode": "none",
      "status": "succeeded",
      "image_url": "https://xxx.supabase.co/storage/v1/object/public/brand-assets/brands/<brand-id>/generations/<generation-id>.png",
      "error_message": null,
      "created_at": "2026-06-07T12:30:00Z",
      "completed_at": "2026-06-07T12:30:15Z"
    }
  ],
  "next_cursor": null,
  "page_size": 24
}
```

### Behavior

- Verifies brand ownership first.
- Returns only rows for `brand_id`.
- Returns only terminal rows (`succeeded`, `failed`).
- Sort order is `created_at DESC, id DESC`.
- `next_cursor` is `null` when there are no more matching rows.

### Errors

| Status | Code | When |
|--------|------|------|
| 400 | `VALIDATION_ERROR` | Invalid provider, invalid status, or invalid cursor |
| 401 | `UNAUTHORIZED` | Missing or invalid token |
| 404 | `BRAND_NOT_FOUND` | Brand does not exist or is not owned by user |

---

## GET /brands/{brand_id}/generations/{generation_id}

Fetch one generation detail for a dedicated history detail page.

### Response - 200 OK

```json
{
  "id": "12345678-1234-1234-1234-123456789012",
  "prompt": "A modern minimal office with natural light, desk plants, and a laptop",
  "provider": "openai",
  "model": "gpt-image-2",
  "platform_preset": "instagram_post",
  "width": 1080,
  "height": 1080,
  "logo_mode": "none",
  "status": "succeeded",
  "provider_request_id": "req_abc123",
  "image_url": "https://xxx.supabase.co/storage/v1/object/public/brand-assets/brands/<brand-id>/generations/<generation-id>.png",
  "download_filename": "my-brand-instagram_post-20260607-123015.png",
  "error_code": null,
  "error_message": null,
  "created_at": "2026-06-07T12:30:00Z",
  "completed_at": "2026-06-07T12:30:15Z"
}
```

### Behavior

- Verifies brand ownership first.
- Finds the row by both `brand_id` and `generation_id`.
- Does not return `image_path`.
- Returns `download_filename` only for successful generations with image and completion timestamp.
- If the stored image is unavailable, `image_url` may be `null`; metadata still returns.

### Errors

| Status | Code | When |
|--------|------|------|
| 401 | `UNAUTHORIZED` | Missing or invalid token |
| 404 | `BRAND_NOT_FOUND` | Brand does not exist or is not owned by user |
| 404 | `GENERATION_NOT_FOUND` | Generation does not exist or does not belong to this brand |

---

## DELETE /brands/{brand_id}/generations/{generation_id}

Permanently delete one generation history item.

### Response - 204 No Content

No response body.

### Behavior

1. Verifies brand ownership first.
2. Finds the row by both `brand_id` and `generation_id`.
3. If the row is `succeeded` and has an image path:
   - Remove the stored PNG first.
   - If the PNG is already missing, continue.
   - If removal fails for any other reason, keep the row and return `502 STORAGE_DELETE_FAILED`.
4. Delete the generation row.
5. Future list/detail requests do not return the deleted generation.

### Errors

| Status | Code | When |
|--------|------|------|
| 401 | `UNAUTHORIZED` | Missing or invalid token |
| 404 | `BRAND_NOT_FOUND` | Brand does not exist or is not owned by user |
| 404 | `GENERATION_NOT_FOUND` | Generation does not exist or does not belong to this brand |
| 502 | `STORAGE_DELETE_FAILED` | Stored image removal failed for a reason other than already-missing object |

---

## Contract Invariants

1. No endpoint exposes provider keys, Vault ids, or `image_path`.
2. No endpoint returns data for another brand or owner.
3. List endpoint never returns non-terminal `pending` or `processing` statuses.
4. Delete is hard delete; there is no soft-delete state.
5. Row deletion for successful generations happens only after storage is removed or confirmed already missing.
6. Download filename behavior matches the original generation result.
