# Research: Provider Keys

**Feature**: 004-provider-keys
**Date**: 2026-03-29

## R1: Supabase Vault Integration Pattern

**Decision**: Use SQL wrapper functions in the `public` schema (SECURITY DEFINER) called via `supabase.rpc()` from Python.

**Rationale**: The `vault` schema is not exposed through PostgREST by default. Thin SQL wrappers with `SECURITY DEFINER` grant controlled access while keeping secrets locked to `service_role` only.

**Alternatives considered**:
- Direct SQL via `psycopg2`: Would bypass Supabase client entirely, adding a second connection pool. Rejected for complexity.
- Exposing `vault` schema in PostgREST config: Security risk — would expose vault functions to any authenticated user. Rejected.

**Implementation details**:
- `vault.create_secret(secret, name)` returns `UUID` — the wrapper returns this as `vault_secret_id` stored in `provider_keys`.
- `vault.decrypted_secrets` view provides plaintext via `SELECT decrypted_secret WHERE id = ?`.
- No built-in `vault.delete_secret` — use `DELETE FROM vault.secrets WHERE id = ?`.
- All wrappers must `REVOKE EXECUTE ... FROM public, anon, authenticated` and `GRANT ... TO service_role`.

**Migration required**: New migration for 3 RPC functions: `insert_vault_secret`, `read_vault_secret`, `delete_vault_secret`.

## R2: OpenAI Key Validation

**Decision**: Use `GET https://api.openai.com/v1/models` with `Authorization: Bearer {key}`.

**Rationale**: Zero-cost endpoint, no tokens consumed, deterministic response: 200 = valid, 401 = invalid.

**Alternatives considered**:
- `POST /v1/chat/completions` with minimal payload: Consumes tokens and costs money. Rejected.
- `GET /v1/organization`: Not available on all key types. Rejected.

**Error response structure**: `{"error": {"message": "...", "type": "invalid_request_error", "code": "invalid_api_key"}}` — use `error.message` for `last_validation_error`.

## R3: Gemini Key Validation

**Decision**: Use `GET https://generativelanguage.googleapis.com/v1beta/models?pageSize=1&key={key}`.

**Rationale**: Zero-cost endpoint, minimal response with `pageSize=1`, deterministic: 200 = valid, 400/403 = invalid.

**Alternatives considered**:
- `POST /v1beta/models/{model}:countTokens`: Requires a model name and request body. Rejected for unnecessary complexity.

**Error response structure**: Returns error with status 400 or 403 for invalid keys — use the error message for `last_validation_error`.

## R4: HTTP Client for Provider Validation

**Decision**: Use `httpx.AsyncClient` with 30-second timeout.

**Rationale**: `httpx` is already available in the backend dependency tree (transitive via `supabase-py`). Async-native, supports timeouts natively.

**Alternatives considered**:
- `aiohttp`: Would add a new dependency. Rejected.
- `requests` (sync): Would block the event loop in FastAPI async handlers. Rejected.

## R5: Secret Naming Convention

**Decision**: Use `provider_key_{provider_key_uuid}` as the vault secret name.

**Rationale**: Each provider key row has a unique UUID. Using it as the vault secret name creates a 1:1 mapping, avoids collisions, and simplifies lookup by ID. The `vault_secret_id` column in `provider_keys` stores the vault secret's UUID returned by `vault.create_secret()`.

**Alternatives considered**:
- `{brand_id}_{provider}_{label}`: Labels are optional and can collide. Rejected.
- Random UUID separate from the key row: Creates unnecessary indirection. Rejected.
