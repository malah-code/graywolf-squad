# Tasks: Provider Keys

**Input**: Design documents from `/specs/004-provider-keys/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/api.md

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2)
- Exact file paths included in every task description

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Database migration for Vault RPC functions and backend scaffolding that all endpoints depend on.

- [x] T001 Create Supabase migration for Vault RPC helper functions in `supabase/migrations/00012_vault_secret_helpers.sql`

  **What to create**: Three SQL functions in the `public` schema, all with `SECURITY DEFINER` and `SET search_path = public`:

  1. `insert_vault_secret(name text, secret text) RETURNS uuid` — calls `vault.create_secret(secret, name)` and returns the UUID.
  2. `read_vault_secret(secret_id uuid) RETURNS text` — queries `SELECT decrypted_secret FROM vault.decrypted_secrets WHERE id = secret_id` and returns the plaintext string.
  3. `delete_vault_secret(secret_id uuid) RETURNS void` — runs `DELETE FROM vault.secrets WHERE id = secret_id`.

  **Security (CRITICAL)**: After each function definition, add:
  ```sql
  REVOKE EXECUTE ON FUNCTION <function_name> FROM public, anon, authenticated;
  GRANT EXECUTE ON FUNCTION <function_name> TO service_role;
  ```

  **Test**: Run `supabase db push` and verify in SQL editor: `SELECT insert_vault_secret('test', 'hello');` returns a UUID, `SELECT read_vault_secret(<that uuid>);` returns `'hello'`, `SELECT delete_vault_secret(<that uuid>);` runs without error.

- [x] T002 [P] Create Vault wrapper module in `backend/app/core/vault.py`

  **What to create**: A Python module with 3 functions that call the Supabase RPC wrappers from T001. Import `get_service_client` from `app.core.supabase`.

  1. `def store_secret(name: str, value: str) -> str` — calls `get_service_client().rpc("insert_vault_secret", {"name": name, "secret": value}).execute()`, returns `resp.data` (a UUID string).
  2. `def read_secret(secret_id: str) -> str | None` — calls `get_service_client().rpc("read_vault_secret", {"secret_id": secret_id}).execute()`, returns `resp.data` (plaintext string or None).
  3. `def delete_secret(secret_id: str) -> None` — calls `get_service_client().rpc("delete_vault_secret", {"secret_id": secret_id}).execute()`.

  **Pattern to follow**: Look at how `get_service_client()` is used in `backend/app/routers/brands.py` (lines 35-46). The `client.rpc(fn_name, params).execute()` pattern is the standard.

  **IMPORTANT**: The `brands.py` delete handler (line 222) already calls `client.rpc("delete_secret", {"secret_id": ...})`. The RPC function name in the migration (T001) is `delete_vault_secret`, NOT `delete_secret`. You must ALSO update brands.py line 222 to call `delete_vault_secret` instead of `delete_secret`, OR name the migration function `delete_secret`. **Choose consistent naming.** Recommended: name the migration functions `insert_vault_secret`, `read_vault_secret`, `delete_vault_secret` and update brands.py to match.

- [x] T003 [P] Create Pydantic models in `backend/app/models/provider_key.py`

  **What to create**: Request and response models. Follow the same pattern as `backend/app/models/brand.py`.

  **Models to define** (all inherit from `pydantic.BaseModel`):

  1. `AddKeyRequest`:
     - `provider: str` — must be `"openai"` or `"gemini"`. Add a `@field_validator("provider")` that raises ValueError if not one of these two values.
     - `key: str` — the raw API key. Add a `@field_validator("key")` that strips whitespace and raises ValueError if empty.
     - `label: str | None = None` — optional, max 100 chars. Add a `@field_validator("label")` that strips whitespace, returns None if empty, raises ValueError if > 100 chars.
     - `make_active: bool = True`

  2. `ProviderKeyResponse`:
     - `id: str`
     - `provider: str`
     - `label: str | None = None`
     - `key_hint: str | None = None`
     - `is_active: bool`
     - `is_valid: bool | None = None`
     - `last_validated_at: datetime | None = None`
     - `last_validation_error: str | None = None`
     - `created_at: datetime`

     Import `datetime` from `datetime`.

  3. `ValidateKeyResponse`:
     - `valid: bool`
     - `validated_at: datetime`
     - `error: str | None = None`
     - `key_id: str`

- [x] T004 [P] Create provider validation service in `backend/app/services/provider_validation.py`

  **Pre-step**: The `backend/app/services/` directory does NOT exist yet. Create it with an `__init__.py` file first.

  **What to create**: Two async validation functions using `httpx.AsyncClient`. Import `httpx` (already available as a transitive dependency of supabase-py).

  1. `async def validate_openai_key(api_key: str) -> tuple[bool, str | None]`:
     - Create `async with httpx.AsyncClient(timeout=30.0) as client:`
     - Send `GET` to `https://api.openai.com/v1/models` with header `Authorization: Bearer {api_key}`
     - If `resp.status_code == 200`: return `(True, None)`
     - If `resp.status_code == 401`: parse JSON, extract `resp.json()["error"]["message"]`, return `(False, message)`
     - On `httpx.TimeoutException`: return `(False, "Provider API timed out")`
     - On any other exception: return `(False, str(e))`

  2. `async def validate_gemini_key(api_key: str) -> tuple[bool, str | None]`:
     - Create `async with httpx.AsyncClient(timeout=30.0) as client:`
     - Send `GET` to `https://generativelanguage.googleapis.com/v1beta/models` with params `{"key": api_key, "pageSize": "1"}`
     - If `resp.status_code == 200`: return `(True, None)`
     - If `resp.status_code in (400, 403)`: parse JSON, extract error message, return `(False, message)`
     - On `httpx.TimeoutException`: return `(False, "Provider API timed out")`
     - On any other exception: return `(False, str(e))`

  3. `async def validate_provider_key(provider: str, api_key: str) -> tuple[bool, str | None]`:
     - If `provider == "openai"`: call `validate_openai_key(api_key)`
     - If `provider == "gemini"`: call `validate_gemini_key(api_key)`
     - Else: return `(False, f"Unsupported provider: {provider}")`

  **IMPORTANT**: Add `import logging` and `logger = logging.getLogger(__name__)`. Log validation attempts at DEBUG level but NEVER log the `api_key` value. Example: `logger.debug("Validating %s key for brand", provider)`.

- [x] T005 [P] Add TypeScript types for ProviderKey in `frontend/types/index.ts`

  **What to add**: Append these interfaces to the BOTTOM of the existing file (do NOT modify existing types):

  ```typescript
  export interface ProviderKey {
    id: string
    provider: 'openai' | 'gemini'
    label: string | null
    key_hint: string | null
    is_active: boolean
    is_valid: boolean | null
    last_validated_at: string | null
    last_validation_error: string | null
    created_at: string
  }

  export interface AddKeyRequest {
    provider: 'openai' | 'gemini'
    key: string
    label?: string | null
    make_active?: boolean
  }

  export interface ValidateKeyResponse {
    valid: boolean
    validated_at: string
    error: string | null
    key_id: string
  }
  ```

**Checkpoint**: Migration pushed, vault wrapper ready, Pydantic models defined, validation service ready, TypeScript types added. No endpoints or UI yet.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The keys router with the core helper functions that all user story endpoints depend on.

**CRITICAL**: No user story endpoints can be implemented until this phase is complete.

- [x] T006 Create the keys router file and register it in `backend/app/routers/keys.py` and `backend/app/main.py`

  **Step 1 — Create `backend/app/routers/keys.py`**:

  Start with this exact scaffold (copy the pattern from `backend/app/routers/brands.py`):

  ```python
  import logging
  from uuid import UUID, uuid4

  from fastapi import APIRouter, Depends, HTTPException, status

  from app.core.auth import User, get_current_user
  from app.core.supabase import get_service_client
  from app.core.vault import store_secret, read_secret, delete_secret
  from app.models.provider_key import (
      AddKeyRequest,
      ProviderKeyResponse,
      ValidateKeyResponse,
  )
  from app.services.provider_validation import validate_provider_key

  logger = logging.getLogger(__name__)

  router = APIRouter(prefix="/brands/{brand_id}/keys", tags=["provider-keys"])


  def _error_response(status_code: int, code: str, message: str) -> HTTPException:
      return HTTPException(
          status_code=status_code,
          detail={"error": {"code": code, "message": message, "request_id": str(uuid4())}},
      )


  def _get_brand_or_404(brand_id: UUID, user_id: str) -> dict:
      client = get_service_client()
      result = (
          client.table("brands")
          .select("*")
          .eq("id", str(brand_id))
          .eq("owner_user_id", user_id)
          .maybe_single()
          .execute()
      )
      if result is None or result.data is None:
          raise _error_response(404, "BRAND_NOT_FOUND", "Brand not found")
      return result.data


  def _get_key_or_404(brand_id: UUID, key_id: UUID) -> dict:
      client = get_service_client()
      result = (
          client.table("provider_keys")
          .select("*")
          .eq("id", str(key_id))
          .eq("brand_id", str(brand_id))
          .maybe_single()
          .execute()
      )
      if result is None or result.data is None:
          raise _error_response(404, "KEY_NOT_FOUND", "Key not found")
      return result.data


  def _key_response(row: dict) -> ProviderKeyResponse:
      return ProviderKeyResponse(
          id=row["id"],
          provider=row["provider"],
          label=row.get("label"),
          key_hint=row.get("key_hint"),
          is_active=row["is_active"],
          is_valid=row.get("is_valid"),
          last_validated_at=row.get("last_validated_at"),
          last_validation_error=row.get("last_validation_error"),
          created_at=row["created_at"],
      )
  ```

  **Step 2 — Register in `backend/app/main.py`**:

  Add `keys` to the import on line 8: change `from app.routers import brands, health, me` to `from app.routers import brands, health, keys, me`.

  Add this line after `app.include_router(brands.router)` (line 33): `app.include_router(keys.router)`.

  **Verify**: Run `cd backend && python -c "from app.main import app; print([r.path for r in app.routes])"` — should include `/brands/{brand_id}/keys` paths.

**Checkpoint**: Router scaffolded and registered. Endpoints will be added per user story.

---

## Phase 3: User Story 1 — Add a Provider Key (Priority: P1) — MVP

**Goal**: User can add an API key for OpenAI or Gemini to their brand. The key is stored in Vault, never returned. The user sees a masked hint.

**Independent Test**: Add a key via POST, then list keys and verify the hint, label, provider, and active status are correct. Verify the full key value is NOT in the response.

### Implementation for User Story 1

- [x] T007 [US1] Implement the Add Key endpoint (`POST /brands/{brand_id}/keys`) in `backend/app/routers/keys.py`

  **Add this function** to the keys router file created in T006, after the helper functions:

  ```python
  @router.post("", response_model=ProviderKeyResponse, status_code=status.HTTP_201_CREATED)
  async def add_key(
      brand_id: UUID,
      body: AddKeyRequest,
      current_user: User = Depends(get_current_user),
  ):
      _get_brand_or_404(brand_id, current_user.id)
      client = get_service_client()

      # 1. Derive key_hint from last 4 chars
      key_hint = body.key[-4:] if len(body.key) >= 4 else body.key

      # 2. Store the raw key in Vault
      try:
          vault_secret_id = store_secret(
              name=f"provider_key_{uuid4()}",
              value=body.key,
          )
      except Exception as e:
          logger.error("Vault store failed: %s", e)
          raise _error_response(502, "VAULT_ERROR", "Failed to store key securely")

      # 3. If make_active, deactivate current active key for this provider
      if body.make_active:
          client.table("provider_keys").update(
              {"is_active": False}
          ).eq(
              "brand_id", str(brand_id)
          ).eq(
              "provider", body.provider
          ).eq(
              "is_active", True
          ).execute()

      # 4. Insert the provider_keys row
      row_data = {
          "brand_id": str(brand_id),
          "provider": body.provider,
          "vault_secret_id": vault_secret_id,
          "label": body.label,
          "key_hint": key_hint,
          "is_active": body.make_active,
      }
      result = client.table("provider_keys").insert(row_data).execute()
      return _key_response(result.data[0])
  ```

  **SECURITY CHECK**: Confirm the `body.key` value does NOT appear in the response or in any log statement. Only `key_hint` (last 4 chars) is stored in the DB.

- [x] T008 [US1] Implement the List Keys endpoint (`GET /brands/{brand_id}/keys`) in `backend/app/routers/keys.py`

  **Add this function** to the keys router file, before the `add_key` function (GET before POST by convention):

  ```python
  @router.get("", response_model=list[ProviderKeyResponse])
  async def list_keys(
      brand_id: UUID,
      current_user: User = Depends(get_current_user),
  ):
      _get_brand_or_404(brand_id, current_user.id)
      client = get_service_client()
      result = (
          client.table("provider_keys")
          .select("*")
          .eq("brand_id", str(brand_id))
          .order("provider")
          .order("created_at", desc=True)
          .execute()
      )
      return [_key_response(row) for row in result.data or []]
  ```

**Checkpoint**: User Story 1 backend is complete. Test with curl:
```bash
# Add a key
curl -X POST http://localhost:8000/brands/{brandId}/keys \
  -H "Authorization: Bearer {token}" -H "Content-Type: application/json" \
  -d '{"provider":"openai","key":"sk-test1234","label":"Test","make_active":true}'
# Expect: 201, response has key_hint "1234", no full key

# List keys
curl http://localhost:8000/brands/{brandId}/keys -H "Authorization: Bearer {token}"
# Expect: 200, array with the key added above
```

---

## Phase 4: User Story 2 — View and Manage Keys (Priority: P1)

**Goal**: User sees all keys in a tabbed UI organized by provider. Each key shows hint, label, active badge, and validation status.

**Independent Test**: Navigate to `/brands/{brandId}/keys` in the browser. The page shows provider tabs, key cards, and an empty state when no keys exist.

### Implementation for User Story 2

- [x] T009 [P] [US2] Create the `use-keys` hook in `frontend/hooks/use-keys.ts`

  **What to create**: A custom React hook that fetches keys for a brand. Follow the exact same pattern as `frontend/hooks/use-brand.ts`.

  ```typescript
  'use client'

  import { useCallback, useEffect, useState } from 'react'
  import { apiRequest } from '@/lib/api'
  import { ProviderKey } from '@/types'

  export function useKeys(brandId: string) {
    const [keys, setKeys] = useState<ProviderKey[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)

    const fetchKeys = useCallback(async () => {
      try {
        setLoading(true)
        setError(null)
        const data = await apiRequest<ProviderKey[]>(`/brands/${brandId}/keys`)
        setKeys(data)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load keys')
      } finally {
        setLoading(false)
      }
    }, [brandId])

    useEffect(() => {
      fetchKeys()
    }, [fetchKeys])

    return { keys, loading, error, refetch: fetchKeys }
  }
  ```

- [x] T010 [P] [US2] Create the provider tabs component in `frontend/components/keys/provider-tabs.tsx`

  **Pre-step**: Create the `frontend/components/keys/` directory.

  **What to create**: A component that renders two tabs ("OpenAI" and "Gemini") and filters the keys list by the selected provider.

  ```typescript
  'use client'

  import { useState } from 'react'
  import { ProviderKey } from '@/types'

  interface ProviderTabsProps {
    keys: ProviderKey[]
    children: (filteredKeys: ProviderKey[], activeProvider: string) => React.ReactNode
  }

  const PROVIDERS = [
    { id: 'openai', label: 'OpenAI' },
    { id: 'gemini', label: 'Gemini' },
  ]

  export function ProviderTabs({ keys, children }: ProviderTabsProps) {
    const [activeProvider, setActiveProvider] = useState('openai')

    const filteredKeys = keys.filter((k) => k.provider === activeProvider)

    return (
      <div>
        <div className="flex gap-1 border-b mb-4">
          {PROVIDERS.map((p) => {
            const count = keys.filter((k) => k.provider === p.id).length
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => setActiveProvider(p.id)}
                className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                  activeProvider === p.id
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                }`}
              >
                {p.label} ({count})
              </button>
            )
          })}
        </div>
        {children(filteredKeys, activeProvider)}
      </div>
    )
  }
  ```

- [x] T011 [P] [US2] Create the key card component in `frontend/components/keys/key-card.tsx`

  **What to create**: A card that displays a single key's metadata. It receives callback props for actions (validate, activate, delete) but does NOT implement the action logic itself — that comes in later stories.

  ```typescript
  'use client'

  import { ProviderKey } from '@/types'

  interface KeyCardProps {
    keyData: ProviderKey
    onValidate?: (keyId: string) => void
    onActivate?: (keyId: string) => void
    onDelete?: (keyId: string) => void
    isValidating?: boolean
  }

  export function KeyCard({ keyData, onValidate, onActivate, onDelete, isValidating }: KeyCardProps) {
    return (
      <div className="rounded-lg border p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="font-mono text-sm text-muted-foreground">
              ****{keyData.key_hint || '????'}
            </span>
            {keyData.label && (
              <span className="text-sm text-muted-foreground">— {keyData.label}</span>
            )}
          </div>
          {keyData.is_active && (
            <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
              Active
            </span>
          )}
        </div>

        {/* Validation status */}
        {keyData.is_valid !== null && (
          <div className="text-xs text-muted-foreground">
            {keyData.is_valid ? (
              <span className="text-green-600">Valid</span>
            ) : (
              <span className="text-red-600">
                Invalid{keyData.last_validation_error ? `: ${keyData.last_validation_error}` : ''}
              </span>
            )}
            {keyData.last_validated_at && (
              <span className="ml-2">
                (checked {new Date(keyData.last_validated_at).toLocaleDateString()})
              </span>
            )}
          </div>
        )}

        {/* Action buttons */}
        <div className="flex gap-2 pt-1">
          {onValidate && (
            <button
              type="button"
              onClick={() => onValidate(keyData.id)}
              disabled={isValidating}
              className="rounded-md border px-3 py-1 text-xs hover:bg-gray-50 disabled:opacity-50"
            >
              {isValidating ? 'Validating...' : 'Validate'}
            </button>
          )}
          {onActivate && !keyData.is_active && (
            <button
              type="button"
              onClick={() => onActivate(keyData.id)}
              className="rounded-md border px-3 py-1 text-xs hover:bg-gray-50"
            >
              Activate
            </button>
          )}
          {onDelete && (
            <button
              type="button"
              onClick={() => onDelete(keyData.id)}
              className="rounded-md border border-red-200 px-3 py-1 text-xs text-red-600 hover:bg-red-50"
            >
              Delete
            </button>
          )}
        </div>
      </div>
    )
  }
  ```

- [x] T012 [US2] Create the keys page in `frontend/app/(dashboard)/[brandId]/keys/page.tsx`

  **Pre-step**: Create the `frontend/app/(dashboard)/[brandId]/keys/` directory.

  **What to create**: The main keys management page. Follow the pattern of `frontend/app/(dashboard)/[brandId]/settings/page.tsx` (use `useParams`, get `brandId`, handle loading/error states).

  This page:
  - Uses `useKeys(brandId)` hook to fetch keys
  - Renders `ProviderTabs` with key cards inside
  - Shows an empty state when no keys exist for the selected provider tab
  - Includes a "Add Key" button (the modal itself comes in a later task)
  - Wires up action callbacks (validate, activate, delete) that will be connected in later story phases

  **Key structure**:
  ```typescript
  'use client'

  import { useState } from 'react'
  import { useParams } from 'next/navigation'
  import { useKeys } from '@/hooks/use-keys'
  import { ProviderTabs } from '@/components/keys/provider-tabs'
  import { KeyCard } from '@/components/keys/key-card'
  import { AddKeyModal } from '@/components/keys/add-key-modal'
  import { apiRequest } from '@/lib/api'
  import { ProviderKey, ValidateKeyResponse } from '@/types'
  ```

  The page should:
  1. Get `brandId` from `useParams()` (same pattern as settings page line 15)
  2. Call `useKeys(brandId)`
  3. Track state for: `showAddModal`, `validatingKeyId`
  4. Define action handlers: `handleValidate`, `handleActivate`, `handleDelete` — each calls the appropriate API endpoint and then calls `refetch()` to refresh the list
  5. Render: heading "API Keys", "Add Key" button, `ProviderTabs` wrapping `KeyCard` list with empty state

  **Action handler patterns** (use `apiRequest` from `@/lib/api`):
  - Validate: `await apiRequest<ValidateKeyResponse>(\`/brands/${brandId}/keys/${keyId}/validate\`, { method: 'POST' })`
  - Activate: `await apiRequest<ProviderKey>(\`/brands/${brandId}/keys/${keyId}/activate\`, { method: 'PATCH' })`
  - Delete: `await apiRequest(\`/brands/${brandId}/keys/${keyId}\`, { method: 'DELETE' })`
  - After each: call `refetch()` from the `useKeys` hook

  **Empty state**: When `filteredKeys.length === 0`, show: "No {provider} keys yet. Add your first key to start generating images."

  **NOTE**: Import `AddKeyModal` — it will be created in T013. If implementing sequentially, you can temporarily comment out the modal import and button until T013 is done.

- [x] T013 [US2] Create the Add Key modal in `frontend/components/keys/add-key-modal.tsx`

  **What to create**: A modal dialog for adding a new key. Uses a simple form with:
  - Provider selector (radio buttons or select: "OpenAI" / "Gemini")
  - Key input (type="password" to mask the value, with a show/hide toggle)
  - Label input (optional, text, max 100 chars)
  - "Set as active" checkbox (default checked)
  - Submit button

  **On submit**:
  - Call `apiRequest<ProviderKey>(\`/brands/${brandId}/keys\`, { method: 'POST', body: JSON.stringify({ provider, key, label: label || null, make_active }) })`
  - On success: call `onKeyAdded()` callback (which triggers `refetch` in the parent page) and close the modal
  - On error: display the error message below the form

  **Props interface**:
  ```typescript
  interface AddKeyModalProps {
    brandId: string
    open: boolean
    onOpenChange: (open: boolean) => void
    onKeyAdded: () => void
    defaultProvider?: string  // pre-select the current tab's provider
  }
  ```

  **UI pattern**: Use a simple overlay modal (div with fixed positioning, semi-transparent backdrop). Follow the same styling approach as the existing UI components (Tailwind classes, rounded borders, consistent spacing). Look at how `DeleteBrandDialog` in `frontend/components/brand/delete-brand-dialog.tsx` is structured for modal pattern reference.

  **SECURITY**: The key input field should use `type="password"` by default. Add a show/hide toggle button. The raw key value is only held in component state during form entry — it is cleared when the modal closes.

**Checkpoint**: User Stories 1 & 2 complete. The user can add keys via the API, view them in a tabbed UI, and add new keys via the modal. Test by navigating to `/brands/{brandId}/keys` in the browser.

---

## Phase 5: User Story 3 — Validate a Key (Priority: P2)

**Goal**: User can click "Validate" on a key card to test if the key still works with the provider. The result (valid/invalid + error) is shown on the card.

**Independent Test**: Add a key, click Validate, confirm the validation status updates on the card.

### Implementation for User Story 3

- [x] T014 [US3] Implement the Validate Key endpoint (`POST /brands/{brand_id}/keys/{key_id}/validate`) in `backend/app/routers/keys.py`

  **Add this function** to the keys router:

  ```python
  @router.post("/{key_id}/validate", response_model=ValidateKeyResponse)
  async def validate_key(
      brand_id: UUID,
      key_id: UUID,
      current_user: User = Depends(get_current_user),
  ):
      _get_brand_or_404(brand_id, current_user.id)
      key = _get_key_or_404(brand_id, key_id)

      # 1. Retrieve the actual key from Vault
      try:
          api_key = read_secret(key["vault_secret_id"])
      except Exception as e:
          logger.error("Vault read failed: %s", e)
          raise _error_response(502, "VAULT_ERROR", "Failed to retrieve key from vault")

      if not api_key:
          raise _error_response(502, "VAULT_ERROR", "Key not found in vault")

      # 2. Validate against provider
      is_valid, error_message = await validate_provider_key(key["provider"], api_key)

      # 3. Update the key record
      from datetime import datetime, timezone
      now = datetime.now(timezone.utc).isoformat()

      update_data = {
          "is_valid": is_valid,
          "last_validated_at": now,
          "last_validation_error": None if is_valid else error_message,
      }
      client = get_service_client()
      client.table("provider_keys").update(update_data).eq("id", str(key_id)).execute()

      return ValidateKeyResponse(
          valid=is_valid,
          validated_at=now,
          error=error_message,
          key_id=str(key_id),
      )
  ```

  **IMPORTANT**: The `validate_provider_key` function is `async` (it uses `httpx.AsyncClient`), so the `await` is correct here. The route handler is `async def` which allows this.

  **Error handling**: If the provider API times out (httpx.TimeoutException is caught inside `validate_provider_key`), the function returns `(False, "Provider API timed out")` — this is stored as `last_validation_error` on the key, NOT raised as a 504. The 504 response is only for cases where the vault itself fails.

**Checkpoint**: Validate endpoint works. The frontend already has the validate button wired up from T012 (`handleValidate` calls the endpoint and refetches). Test: click Validate on a key card, see the status update to "Valid" or "Invalid".

---

## Phase 6: User Story 4 — Activate a Key (Priority: P2)

**Goal**: User can activate a different key for the same provider. The previous active key is deactivated atomically.

**Independent Test**: Add two keys for the same provider, activate the second, verify only the second is active.

### Implementation for User Story 4

- [x] T015 [US4] Implement the Activate Key endpoint (`PATCH /brands/{brand_id}/keys/{key_id}/activate`) in `backend/app/routers/keys.py`

  **Add this function** to the keys router:

  ```python
  @router.patch("/{key_id}/activate", response_model=ProviderKeyResponse)
  async def activate_key(
      brand_id: UUID,
      key_id: UUID,
      current_user: User = Depends(get_current_user),
  ):
      _get_brand_or_404(brand_id, current_user.id)
      key = _get_key_or_404(brand_id, key_id)

      if key["is_active"]:
          # Already active — idempotent, just return current state
          return _key_response(key)

      client = get_service_client()

      # 1. Deactivate current active key for this provider
      client.table("provider_keys").update(
          {"is_active": False}
      ).eq(
          "brand_id", str(brand_id)
      ).eq(
          "provider", key["provider"]
      ).eq(
          "is_active", True
      ).execute()

      # 2. Activate the requested key
      result = (
          client.table("provider_keys")
          .update({"is_active": True})
          .eq("id", str(key_id))
          .execute()
      )
      return _key_response(result.data[0])
  ```

  **NOTE**: The deactivate + activate are two separate Supabase client calls. They are NOT in a database transaction (Supabase PostgREST doesn't support multi-statement transactions). However, the `uq_provider_keys_one_active` partial unique index in the DB enforces the constraint — if the activate fails, the index will catch the violation. For MVP this is acceptable.

**Checkpoint**: Activate works. Frontend already wires the Activate button (T012). Test: with two OpenAI keys, click Activate on the inactive one, verify it becomes active and the other becomes inactive.

---

## Phase 7: User Story 5 — Delete a Key (Priority: P3)

**Goal**: User can delete a key, removing it from both Vault and the database.

**Independent Test**: Add a key, delete it, verify it disappears from the list.

### Implementation for User Story 5

- [x] T016 [US5] Implement the Delete Key endpoint (`DELETE /brands/{brand_id}/keys/{key_id}`) in `backend/app/routers/keys.py`

  **Add this function** to the keys router:

  ```python
  @router.delete("/{key_id}", status_code=status.HTTP_204_NO_CONTENT)
  async def delete_key(
      brand_id: UUID,
      key_id: UUID,
      current_user: User = Depends(get_current_user),
  ):
      _get_brand_or_404(brand_id, current_user.id)
      key = _get_key_or_404(brand_id, key_id)

      # 1. Delete from Vault (best-effort)
      try:
          delete_secret(key["vault_secret_id"])
      except Exception as e:
          logger.warning("Failed to delete vault secret %s: %s", key["vault_secret_id"], e)

      # 2. Delete from DB
      client = get_service_client()
      client.table("provider_keys").delete().eq("id", str(key_id)).execute()
  ```

  **Behavior**: Vault deletion is best-effort (try/except with warning log). The DB record is always deleted. This matches the pattern in `backend/app/routers/brands.py` lines 220-224.

  **No auto-promotion**: If the deleted key was active, no other key becomes active. The user must manually activate another key.

**Checkpoint**: Delete works. Frontend already wires the Delete button (T012). Test: delete a key, verify it disappears. Delete the active key, verify no key is active.

---

## Phase 8: Polish & Cross-Cutting Concerns

**Purpose**: Fix the vault function naming inconsistency and do final verification.

- [x] T017 Update the brand deletion handler in `backend/app/routers/brands.py` to use the correct Vault RPC function name

  **What to change**: On line 222, the delete_brand handler calls `client.rpc("delete_secret", {"secret_id": key["vault_secret_id"]})`. This must match the migration function name from T001.

  If the migration names the function `delete_vault_secret` (as specified in T001), change line 222 to:
  ```python
  client.rpc("delete_vault_secret", {"secret_id": key["vault_secret_id"]}).execute()
  ```

  Alternatively, you can use the vault wrapper from T002:
  ```python
  from app.core.vault import delete_secret
  # ...
  delete_secret(key["vault_secret_id"])
  ```

  **The second approach (using the wrapper) is preferred** because it keeps vault access centralized.

- [x] T018 [P] Verify the `RequestValidationError` handler in `backend/app/main.py` works for keys endpoints

  **What to check**: The existing `request_validation_exception_handler` (lines 51-74) extracts error messages from the `name` field specifically. For the keys router, validation errors come from fields like `provider`, `key`, `label`. The fallback `message = name_error or "Invalid request payload"` will fire — this is acceptable but the message is generic.

  **Optional improvement**: If you want provider/key-specific validation error messages, update the handler to also check for these field names. But for MVP, the generic message plus Pydantic's built-in detail is sufficient — the client already parses `error.message` from the response.

  **Test**: Send a POST to `/brands/{brandId}/keys` with `{"provider":"invalid"}` — should get 400 with a validation error message.

- [x] T019 Run end-to-end verification against the Definition of Done

  **Verify each item**:
  1. Navigate to `/brands/{brandId}/keys` — page loads with tabs
  2. Add an OpenAI key — appears in list with hint, label, active badge
  3. Add a Gemini key — appears under Gemini tab
  4. Validate a key — status updates to Valid or Invalid
  5. Add a second OpenAI key and activate it — first key deactivated
  6. Delete a key — disappears from list
  7. Check browser Network tab — NO full key value in ANY request or response
  8. Check backend logs — NO key value logged
  9. Try accessing keys for a brand you don't own — 404
  10. Works for a brand with 0 kit answers (keys are independent of brand kit)
  11. Works for a brand with a completed brand kit

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: No dependencies — start immediately. T001 must be pushed to Supabase before backend can use vault. T002, T003, T004, T005 are all independent files and can run in parallel.
- **Phase 2 (Foundational)**: Depends on T002, T003, T004 (imports from vault, models, services). T001 must be pushed.
- **Phase 3 (US1 — Add Key)**: Depends on Phase 2 (T006).
- **Phase 4 (US2 — View/Manage)**: Depends on Phase 3 (T007, T008 must exist for the frontend to have data). T009, T010, T011 can run in parallel.
- **Phase 5 (US3 — Validate)**: Depends on Phase 2 (T006) and T004 (validation service). Independent of US2 frontend but makes more sense after it.
- **Phase 6 (US4 — Activate)**: Depends on Phase 2 (T006). Independent of other stories.
- **Phase 7 (US5 — Delete)**: Depends on Phase 2 (T006). Independent of other stories.
- **Phase 8 (Polish)**: Depends on all previous phases.

### User Story Dependencies

- **US1 (Add Key)**: Blocks US2 (need keys to display). Core MVP.
- **US2 (View/Manage)**: Depends on US1 backend. Frontend is independent.
- **US3 (Validate)**: Independent of US2 frontend. Only needs the router scaffold and validation service.
- **US4 (Activate)**: Independent. Only needs the router scaffold.
- **US5 (Delete)**: Independent. Only needs the router scaffold and vault wrapper.

### Within Each User Story

- Backend endpoints before frontend (frontend needs API to call)
- Models/types can be parallel (different files)
- Router scaffold must exist before endpoint functions are added

### Parallel Opportunities

Phase 1 tasks T002, T003, T004, T005 are all independent files — run all 4 in parallel.

Phase 4 tasks T009, T010, T011 are all independent frontend files — run all 3 in parallel.

Backend endpoints T014, T015, T016 (US3/US4/US5) are all in the same file (`keys.py`) so they CANNOT run in parallel, but they are independent stories and can be implemented in any order.

---

## Parallel Example: Phase 1 Setup

```
# Launch all 4 in parallel (different files, no dependencies):
Task T002: Create vault wrapper in backend/app/core/vault.py
Task T003: Create Pydantic models in backend/app/models/provider_key.py
Task T004: Create validation service in backend/app/services/provider_validation.py
Task T005: Add TypeScript types in frontend/types/index.ts
```

## Parallel Example: Phase 4 Frontend

```
# Launch all 3 in parallel (different files):
Task T009: Create use-keys hook in frontend/hooks/use-keys.ts
Task T010: Create provider-tabs in frontend/components/keys/provider-tabs.tsx
Task T011: Create key-card in frontend/components/keys/key-card.tsx
```

---

## Implementation Strategy

### MVP First (User Story 1 Only — Backend)

1. T001 → Push migration
2. T002 + T003 + T004 + T005 (parallel) → Setup files
3. T006 → Router scaffold
4. T007 + T008 → Add + List endpoints
5. **STOP and TEST**: curl add/list endpoints. Keys work at API level.

### Full Feature (All Stories)

1. Complete MVP above
2. T009 + T010 + T011 (parallel) → Frontend components
3. T012 + T013 → Keys page + modal (US2 complete)
4. T014 → Validate endpoint (US3 complete)
5. T015 → Activate endpoint (US4 complete)
6. T016 → Delete endpoint (US5 complete)
7. T017 + T018 + T019 → Polish and verify

---

## Notes

- [P] tasks = different files, no dependencies between them
- [Story] label maps each task to a user story for traceability
- Every task includes exact file paths and code patterns
- Reference existing files by path + line number when showing patterns to follow
- The `backend/app/services/` directory is NEW — T004 creates it
- All backend functions use sync Supabase client (`get_service_client()`) except `validate_provider_key` which uses async `httpx`
- The frontend nav already includes a "Keys" link (see `frontend/app/(dashboard)/[brandId]/layout.tsx` line 85)
- Commit after each phase or logical group of tasks
