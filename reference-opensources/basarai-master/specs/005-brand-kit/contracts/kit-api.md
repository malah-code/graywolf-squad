# API Contract: Brand Kit

**Branch**: `005-brand-kit` | **Date**: 2026-04-11  
**Router prefix**: `/brands/{brand_id}/kit`  
**Auth**: All endpoints require `Authorization: Bearer <supabase_access_token>`

---

## GET /brands/{brand_id}/kit

Retrieve the brand kit for a brand. If no kit record exists yet, returns a default `not_started` response rather than 404 — the client can always display the wizard.

### Request

```http
GET /brands/{brand_id}/kit
Authorization: Bearer <token>
```

### Response — 200 OK

```json
{
  "brand_id": "uuid",
  "brand_name": "Acme Corp",
  "answers": {
    "tagline": "Innovation for everyone",
    "tone": "professional",
    "audience": "Small business owners aged 25–45",
    "colors": ["#FF5733", "#3498DB"],
    "avoid_words": "cheap, discount"
  },
  "summary": "Brand: Acme Corp\nTagline: Innovation for everyone\nTone: professional\nAudience: Small business owners aged 25–45\nColors: #FF5733, #3498DB\nAvoid: cheap, discount",
  "status": "complete",
  "completed_at": "2026-04-11T10:00:00Z",
  "updated_at": "2026-04-11T10:00:00Z"
}
```

**Default response (no kit row exists)**:
```json
{
  "brand_id": "uuid",
  "brand_name": "Acme Corp",
  "answers": {
    "tagline": null,
    "tone": null,
    "audience": null,
    "colors": [],
    "avoid_words": null
  },
  "summary": null,
  "status": "not_started",
  "completed_at": null,
  "updated_at": null
}
```

### Error Responses

| Code | Error Code | Condition |
|------|------------|-----------|
| 401 | `UNAUTHORIZED` | Missing or invalid token |
| 404 | `BRAND_NOT_FOUND` | Brand does not exist or does not belong to the requesting user |

---

## PUT /brands/{brand_id}/kit

Upsert (create or replace) the brand kit answers. The backend derives the `status` and `summary` — never supplied by the client.

### Request

```http
PUT /brands/{brand_id}/kit
Authorization: Bearer <token>
Content-Type: application/json
```

```json
{
  "answers": {
    "tagline": "Innovation for everyone",
    "tone": "professional",
    "audience": "Small business owners aged 25–45",
    "colors": ["#FF5733", "#3498DB"],
    "avoid_words": "cheap, discount"
  }
}
```

**Field rules:**

| Field | Required | Constraints |
|-------|----------|-------------|
| `tagline` | No | `null` or string ≤ 160 chars |
| `tone` | No (required for `complete`) | One of: `formal`, `casual`, `playful`, `professional`, `friendly`; or `null` |
| `audience` | No (required for `complete`) | `null` or string 2–500 chars |
| `colors` | Yes (empty list OK) | Array of 0–3 strings, each matching `^#[0-9A-Fa-f]{6}$` |
| `avoid_words` | No | `null` or string ≤ 500 chars |

### Response — 200 OK

Same shape as `GET` response, reflecting the saved state after derivation.

### Error Responses

| Code | Error Code | Condition |
|------|------------|-----------|
| 400 | `VALIDATION_ERROR` | Field constraint violated (e.g., invalid hex, too many colors, audience too short) |
| 401 | `UNAUTHORIZED` | Missing or invalid token |
| 404 | `BRAND_NOT_FOUND` | Brand not found or not owned by requesting user |

---

## Error Response Shape

All errors follow the project-standard structure:

```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable description",
    "request_id": "uuid"
  }
}
```

---

## Notes

- The `summary` field is always derived by the backend from the saved answers. Clients MUST NOT attempt to submit a `summary` field.
- `status` is always derived by the backend. Clients MUST NOT submit a `status` field.
- A `PUT` with all nullable fields set to `null`/empty results in `status: "not_started"`.
- The endpoint performs an upsert: if no kit row exists, it is created; if one exists, it is replaced.
- `brand_name` in the response is read from the `brands` table at save time; it is not stored in `brand_kits`.
