# Quickstart: Provider Keys

**Feature**: 004-provider-keys
**Branch**: `004-provider-keys`

## Prerequisites

- Backend running: `cd backend && uvicorn app.main:app --reload`
- Frontend running: `cd frontend && npm run dev`
- Supabase project linked: `supabase link --project-ref <ref>`
- Vault extension enabled on Supabase (enabled by default)

## Setup Steps

### 1. Push Vault RPC Migration

```bash
supabase db push
```

This deploys the new migration with `insert_vault_secret`, `read_vault_secret`, and `delete_vault_secret` RPC functions.

### 2. Verify Vault Functions

```bash
# Verify via SQL editor (the Vault RPCs are SQL functions, not Edge Functions)
```

In the Supabase SQL editor, verify:
```sql
SELECT insert_vault_secret('test_key', 'test_value');
-- Should return a UUID
SELECT read_vault_secret('<uuid_from_above>');
-- Should return 'test_value'
SELECT delete_vault_secret('<uuid_from_above>');
-- Should succeed silently
```

### 3. Test API Endpoints

```bash
# Get a valid JWT token (login via frontend or use Supabase auth)
TOKEN="your-jwt-token"
BRAND_ID="your-brand-id"

# Add a key
curl -X POST http://localhost:8000/brands/$BRAND_ID/keys \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"provider": "openai", "key": "sk-your-key", "label": "Test Key", "make_active": true}'

# List keys
curl http://localhost:8000/brands/$BRAND_ID/keys \
  -H "Authorization: Bearer $TOKEN"

# Validate a key
curl -X POST http://localhost:8000/brands/$BRAND_ID/keys/{keyId}/validate \
  -H "Authorization: Bearer $TOKEN"

# Activate a key
curl -X PATCH http://localhost:8000/brands/$BRAND_ID/keys/{keyId}/activate \
  -H "Authorization: Bearer $TOKEN"

# Delete a key
curl -X DELETE http://localhost:8000/brands/$BRAND_ID/keys/{keyId} \
  -H "Authorization: Bearer $TOKEN"
```

### 4. Frontend

Navigate to `/brands/{brandId}/keys` to see the keys management page with:
- Provider tabs (OpenAI / Gemini)
- Add key modal
- Key cards with validate, activate, and delete actions

## Key Files

### Backend
- `backend/app/routers/keys.py` — API endpoints
- `backend/app/models/provider_key.py` — Pydantic models
- `backend/app/core/vault.py` — Vault RPC wrapper
- `backend/app/services/provider_validation.py` — Key validation logic

### Frontend
- `frontend/app/(dashboard)/[brandId]/keys/page.tsx` — Keys page
- `frontend/components/keys/` — Key card, add key modal, provider tabs
- `frontend/hooks/use-keys.ts` — Key data fetching hook
- `frontend/types/index.ts` — TypeScript interfaces (ProviderKey, etc.)

### Database
- `supabase/migrations/00012_vault_secret_helpers.sql` — Vault RPC functions

## Verification

- [ ] Adding a key stores it in Vault (check `vault.decrypted_secrets` via SQL editor)
- [ ] Key value never appears in API responses (only `key_hint`)
- [ ] Activating a key deactivates the previous one (check `is_active` in DB)
- [ ] Validation calls the correct provider endpoint
- [ ] Deleting a key removes both DB record and Vault secret
- [ ] Brand ownership enforced (cross-brand access returns 404)
