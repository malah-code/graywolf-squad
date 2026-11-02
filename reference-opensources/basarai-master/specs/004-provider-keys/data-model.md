# Data Model: Provider Keys

**Feature**: 004-provider-keys
**Date**: 2026-03-29

## Entities

### ProviderKey

Stores metadata for a user-provided API key. The actual secret value lives in Supabase Vault; only an opaque reference (`vault_secret_id`) is stored here.

| Field | Type | Nullable | Constraints | Description |
|-------|------|----------|-------------|-------------|
| id | UUID | No | PK, auto-generated | Unique key identifier |
| brand_id | UUID | No | FK → brands(id) ON DELETE CASCADE | Owning brand |
| provider | provider_t (enum) | No | 'openai' or 'gemini' | Provider type |
| vault_secret_id | UUID | No | | Reference to Vault secret |
| label | text | Yes | max 100 chars (trimmed) | User-assigned label |
| key_hint | text | Yes | regex `^[A-Za-z0-9_-]{2,16}$` | Masked last 4 chars for display |
| is_active | boolean | No | default TRUE | Whether this is the active key for the provider |
| is_valid | boolean | Yes | | Last validation result (null = never validated) |
| last_validated_at | timestamptz | Yes | | Timestamp of last validation |
| last_validation_error | text | Yes | | Error message from last failed validation |
| last_used_at | timestamptz | Yes | | Timestamp of last generation usage |
| created_at | timestamptz | No | default now() | Creation time |
| updated_at | timestamptz | No | default now(), auto-updated via trigger | Last modification time |

**Indexes**:
- `uq_provider_keys_one_active ON (brand_id, provider) WHERE is_active` — enforces at most one active key per brand/provider
- `idx_provider_keys_lookup ON (brand_id, provider, created_at DESC)` — supports listing keys by provider

**RLS**: `provider_keys_owner_all` — all operations require `is_brand_owner(brand_id)`.

### Vault Secret (external, Supabase Vault)

| Field | Type | Description |
|-------|------|-------------|
| id | UUID | Secret identifier (stored as `vault_secret_id` in provider_keys) |
| name | text | `provider_key_{provider_key_uuid}` naming convention |
| secret | bytea | Encrypted API key value |
| decrypted_secret | text | Plaintext (only available via `vault.decrypted_secrets` view) |

## Relationships

```
brands 1──* provider_keys (brand_id FK, CASCADE delete)
provider_keys 1──1 vault.secrets (vault_secret_id, application-managed lifecycle)
```

## State Transitions

### Active Status (is_active)

```
[New Key with make_active=true] ──► active (TRUE)
[New Key with make_active=false] ──► inactive (FALSE)
[Activate endpoint called] ──► active (TRUE), previous active key ──► inactive (FALSE)
[Deleted] ──► removed (no auto-promotion of next key)
```

The `uq_provider_keys_one_active` partial unique index enforces the invariant at the database level. Activation must atomically deactivate the current active key (same transaction).

### Validation Status (is_valid)

```
[New Key] ──► null (never validated)
[Validate: success] ──► true, last_validated_at = now(), last_validation_error = null
[Validate: failure] ──► false, last_validated_at = now(), last_validation_error = error message
```

## Vault RPC Functions (new migration required)

Three SECURITY DEFINER wrapper functions in the `public` schema:

1. **insert_vault_secret(name text, secret text) → UUID**: Wraps `vault.create_secret()`.
2. **read_vault_secret(secret_id UUID) → text**: Reads `decrypted_secret` from `vault.decrypted_secrets` by ID.
3. **delete_vault_secret(secret_id UUID) → void**: Deletes from `vault.secrets` by ID.

All restricted to `service_role` only (REVOKE from public, anon, authenticated).

## Existing Schema (already migrated)

The `provider_keys` table and its indexes already exist in `supabase/migrations/00005_create_provider_keys.sql`. No table migration needed — only the Vault RPC functions are new.
