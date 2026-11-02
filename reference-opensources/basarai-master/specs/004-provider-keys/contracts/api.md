# API Contracts: Provider Keys

**Feature**: 004-provider-keys
**Base path**: `/brands/{brandId}/keys`
**Auth**: Bearer token (Supabase JWT) required on all endpoints. Brand ownership verified server-side.

---

## Shared Types

### ProviderKeyResponse

Returned for all endpoints that return a key. The full key value is **never** included.

```json
{
  "id": "uuid",
  "provider": "openai | gemini",
  "label": "string | null",
  "key_hint": "string | null",
  "is_active": true,
  "is_valid": "boolean | null",
  "last_validated_at": "ISO 8601 | null",
  "last_validation_error": "string | null",
  "created_at": "ISO 8601"
}
```

### ValidateKeyResponse

```json
{
  "valid": true,
  "validated_at": "ISO 8601",
  "error": "string | null",
  "key_id": "uuid"
}
```

### ErrorResponse

```json
{
  "error": {
    "code": "string",
    "message": "string",
    "request_id": "uuid"
  }
}
```

---

## Endpoints

### 1. List Keys

**`GET /brands/{brandId}/keys`**

Returns all keys for the brand, ordered by provider then created_at descending.

**Response**: `200 OK`
```json
[ProviderKeyResponse, ...]
```

**Errors**:
| Status | Code | When |
|--------|------|------|
| 404 | BRAND_NOT_FOUND | Brand not found or not owned by user |

---

### 2. Add Key

**`POST /brands/{brandId}/keys`**

Stores a new provider key in Vault and creates a metadata record.

**Request body**:
```json
{
  "provider": "openai | gemini",
  "key": "sk-...",
  "label": "string | null (max 100 chars)",
  "make_active": true
}
```

**Response**: `201 Created`
```json
ProviderKeyResponse
```

**Behavior**:
- Derives `key_hint` from last 4 characters of `key`.
- Stores `key` in Vault; only `vault_secret_id` stored in DB.
- If `make_active: true` and another key for same provider is active, deactivates it atomically.
- The `key` field is never logged or returned.

**Errors**:
| Status | Code | When |
|--------|------|------|
| 404 | BRAND_NOT_FOUND | Brand not found or not owned by user |
| 422 | VALIDATION_ERROR | Missing/invalid fields (empty key, invalid provider, label too long) |
| 502 | VAULT_ERROR | Vault service unavailable |

---

### 3. Activate Key

**`PATCH /brands/{brandId}/keys/{keyId}/activate`**

Sets this key as active, deactivating the current active key for the same provider.

**Request body**: None

**Response**: `200 OK`
```json
ProviderKeyResponse
```

**Behavior**:
- Atomic: deactivate current active key + activate this key in one transaction.
- Idempotent: activating an already-active key is a no-op that returns 200.
- Only affects keys of the same provider.

**Errors**:
| Status | Code | When |
|--------|------|------|
| 404 | BRAND_NOT_FOUND | Brand not found or not owned by user |
| 404 | KEY_NOT_FOUND | Key not found or belongs to a different brand |

---

### 4. Validate Key

**`POST /brands/{brandId}/keys/{keyId}/validate`**

Makes a lightweight test call to the provider's API to verify the key works.

**Request body**: None

**Response**: `200 OK`
```json
ValidateKeyResponse
```

**Behavior**:
- OpenAI: `GET /v1/models` — 200 = valid, 401 = invalid.
- Gemini: `GET /v1beta/models?pageSize=1` — 200 = valid, 400/403 = invalid.
- Persists `is_valid`, `last_validated_at`, and `last_validation_error` on the key record.
- Clears `last_validation_error` on success.

**Errors**:
| Status | Code | When |
|--------|------|------|
| 404 | BRAND_NOT_FOUND | Brand not found or not owned by user |
| 404 | KEY_NOT_FOUND | Key not found or belongs to a different brand |
| 502 | VAULT_ERROR | Failed to retrieve key from Vault |
| 504 | PROVIDER_TIMEOUT | Provider API did not respond within 30 seconds |

---

### 5. Delete Key

**`DELETE /brands/{brandId}/keys/{keyId}`**

Permanently removes the key from both Vault and the database.

**Request body**: None

**Response**: `204 No Content`

**Behavior**:
- Deletes the Vault secret first, then the DB record.
- If Vault deletion fails, logs a warning but still deletes the DB record (best-effort vault cleanup).
- No auto-promotion: if the deleted key was active, no key is active for that provider.

**Errors**:
| Status | Code | When |
|--------|------|------|
| 404 | BRAND_NOT_FOUND | Brand not found or not owned by user |
| 404 | KEY_NOT_FOUND | Key not found or belongs to a different brand |
