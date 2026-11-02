# Data Model: Generation History

**Branch**: `008-generation-history` | **Date**: 2026-06-07

---

## Existing Table (no migration needed)

This feature reads and deletes rows from the existing `generations` table. It does not add columns, indexes, constraints, enums, storage buckets, or Vault usage.

```text
generations
├── id                    UUID (PK)
├── brand_id              UUID (FK -> brands.id ON DELETE CASCADE)
├── prompt                TEXT
├── provider              provider_t enum: openai | gemini
├── model                 TEXT
├── platform_preset       platform_preset_t enum
├── width                 INT
├── height                INT
├── logo_mode             logo_mode_t enum
├── status                generation_status_t enum
├── provider_request_id   TEXT | NULL
├── image_path            TEXT | NULL
├── error_code            TEXT | NULL
├── error_message         TEXT | NULL
├── created_at            TIMESTAMPTZ
├── updated_at            TIMESTAMPTZ
└── completed_at          TIMESTAMPTZ | NULL
```

### Existing constraints relevant to history

- `status = 'succeeded'` requires `image_path IS NOT NULL`, no error fields, and `completed_at IS NOT NULL`.
- `status = 'failed'` requires `image_path IS NULL`, `error_code IS NOT NULL`, and `completed_at IS NOT NULL`.
- `image_path` must match `brands/{brandId}/generations/{generationId}.png` when present.
- Prompt/model/dimensions constraints are already enforced by Phase 1 schema.

### Existing indexes relevant to history

- `idx_generations_brand_created (brand_id, created_at DESC)` for newest-first brand history.
- `idx_generations_brand_status_created (brand_id, status, created_at DESC)` for status-filtered history.
- `idx_generations_brand_provider_created (brand_id, provider, created_at DESC)` for provider-filtered history.

### Existing RLS policy

Generation rows are protected by brand ownership RLS. The backend uses the service client and must keep explicit server-side brand ownership checks before every read/delete.

---

## Backend Response Models

Add these Pydantic models to `backend/app/models/generation.py`.

### GenerationHistoryStatusEnum

```python
class GenerationHistoryStatusEnum(str, Enum):
    succeeded = "succeeded"
    failed = "failed"
```

Only terminal statuses are valid for history filtering.

### GenerationHistoryItem

Summary record for the list page.

```python
class GenerationHistoryItem(BaseModel):
    id: str
    prompt_excerpt: str
    provider: ProviderEnum
    model: str
    platform_preset: PlatformPresetEnum
    width: int
    height: int
    logo_mode: LogoModeEnum
    status: GenerationStatusEnum
    image_url: str | None
    error_message: str | None
    created_at: datetime
    completed_at: datetime | None
```

Validation/derivation:

- `prompt_excerpt` is derived from the stored prompt and capped for list display.
- `image_url` is present only when `image_path` is present.
- `image_path` is never returned.

### GenerationHistoryPage

Paginated list response.

```python
class GenerationHistoryPage(BaseModel):
    items: list[GenerationHistoryItem]
    next_cursor: str | None
    page_size: int
```

Validation/derivation:

- `page_size` is always `24`.
- `next_cursor` is null when no additional matching records exist.

### GenerationDetailResponse

Full detail page response.

```python
class GenerationDetailResponse(BaseModel):
    id: str
    prompt: str
    provider: ProviderEnum
    model: str
    platform_preset: PlatformPresetEnum
    width: int
    height: int
    logo_mode: LogoModeEnum
    status: GenerationStatusEnum
    provider_request_id: str | None
    image_url: str | None
    download_filename: str | None
    error_code: str | None
    error_message: str | None
    created_at: datetime
    completed_at: datetime | None
```

Validation/derivation:

- `download_filename` is present only when `image_path` and `completed_at` are present.
- `download_filename` uses the existing `build_download_filename(brand_name, platform_preset, completed_at)` helper.
- `image_path` is never returned.

---

## Frontend TypeScript Types

Add to `frontend/types/index.ts`.

```typescript
export type GenerationHistoryStatus = 'succeeded' | 'failed'

export interface GenerationHistoryItem {
  id: string
  prompt_excerpt: string
  provider: Provider
  model: string
  platform_preset: PlatformPreset
  width: number
  height: number
  logo_mode: LogoMode
  status: GenerationStatus
  image_url: string | null
  error_message: string | null
  created_at: string
  completed_at: string | null
}

export interface GenerationHistoryPage {
  items: GenerationHistoryItem[]
  next_cursor: string | null
  page_size: 24
}

export interface GenerationDetail extends GenerationResponse {
  provider_request_id: string | null
}
```

---

## Entity Relationships

```text
brands (1) ─────────────── (N) generations
  id ◄────────────────────── brand_id
  owner_user_id ─── ownership check
```

History never crosses brand boundaries. A generation detail or delete operation must match both:

```text
generation.id = requested generation id
generation.brand_id = requested brand id
brand.owner_user_id = authenticated user id
```

---

## State and Delete Transitions

History exposes only terminal states:

```text
succeeded -> deleted
failed    -> deleted
```

Delete behavior:

| Current row shape | Stored image state | Result |
|-------------------|--------------------|--------|
| `succeeded`, image exists | Removal succeeds | Delete row, return 204 |
| `succeeded`, image already missing | Treat as no remaining asset | Delete row, return 204 |
| `succeeded`, image removal fails otherwise | Asset state unknown | Keep row, return deletion failure |
| `failed`, no image path | No asset to remove | Delete row, return 204 |

No soft-delete marker is introduced. Deleted rows are removed from the table.

---

## Data Not Returned

- `image_path`: never returned to the browser; responses expose `image_url` only.
- Provider API keys or Vault ids: not read or returned.
- Cross-brand metadata: never returned.

---

## Volume Assumptions

- Page size is fixed at 24 items and is not client-configurable.
- MVP per-brand history volume is low to moderate.
- Existing indexes are sufficient for Phase 7. If future history grows beyond this, date/text search can be specified as a later feature.
