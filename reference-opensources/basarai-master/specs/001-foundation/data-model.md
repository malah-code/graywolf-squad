# Data Model: Foundation

**Branch**: `001-foundation` | **Date**: 2026-02-08

## Overview

Phase 1 creates the complete database schema for all five core tables, even though only `profiles` is actively used in this phase. This avoids migration conflicts in later phases. All tables enforce row-level security and automatic `updated_at` timestamps.

## Custom Types (Enums)

| Type | Values | Used By |
|------|--------|---------|
| `provider_t` | `openai`, `gemini` | `provider_keys`, `generations` |
| `tone_t` | `formal`, `casual`, `playful`, `professional`, `friendly` | `brand_kits` |
| `logo_mode_t` | `none`, `prompt`, `watermark`, `both` | `generations` |
| `kit_status_t` | `not_started`, `in_progress`, `complete` | `brand_kits` |
| `generation_status_t` | `pending`, `processing`, `succeeded`, `failed` | `generations` |
| `platform_preset_t` | 13 values (instagram_post, instagram_story, ..., youtube_banner) | `generations` |

## Helper Functions

| Function | Purpose |
|----------|---------|
| `set_updated_at()` | Trigger function: sets `updated_at = now()` before UPDATE on any row |
| `all_hex_colors(TEXT[])` | Validates that all values in a text array match `#RRGGBB` hex format |
| `is_brand_owner(UUID)` | Returns TRUE if `auth.uid()` owns the brand with the given ID. `SECURITY DEFINER` to avoid RLS recursion |
| `handle_new_user()` | Trigger function: creates a `profiles` row when a new `auth.users` row is inserted. `SECURITY DEFINER` |

## Entities

### 1. Profile

**Purpose**: Stores editable account information for each user. One-to-one with `auth.users`.

| Field | Type | Constraints | Notes |
|-------|------|-------------|-------|
| `user_id` | UUID | PK, FK → `auth.users(id)` ON DELETE CASCADE | Matches auth identity |
| `full_name` | TEXT | Nullable, length 2–120 (trimmed) | User's display name |
| `avatar_url` | TEXT | Nullable, must match `^https?://.+` | External avatar URL |
| `created_at` | TIMESTAMPTZ | NOT NULL, default `now()` | Immutable |
| `updated_at` | TIMESTAMPTZ | NOT NULL, default `now()` | Auto-updated by trigger |

**Auto-creation**: A database trigger on `auth.users` INSERT creates the profile row automatically, extracting `full_name` and `avatar_url` from `raw_user_meta_data`.

**RLS**: Users can only read and modify their own profile (`user_id = auth.uid()`).

**State transitions**: None (stateless entity).

---

### 2. Brand

**Purpose**: Represents a business brand owned by a single user. Tenant root for all brand-scoped resources.

| Field | Type | Constraints | Notes |
|-------|------|-------------|-------|
| `id` | UUID | PK, default `gen_random_uuid()` | |
| `owner_user_id` | UUID | NOT NULL, FK → `auth.users(id)` ON DELETE CASCADE | Brand owner |
| `name` | TEXT | NOT NULL, length 2–120 (trimmed) | Brand display name |
| `logo_path` | TEXT | Nullable, regex `^brands/[0-9a-f-]+/logo\.[A-Za-z0-9]+$` | Storage path |
| `created_at` | TIMESTAMPTZ | NOT NULL, default `now()` | Immutable |
| `updated_at` | TIMESTAMPTZ | NOT NULL, default `now()` | Auto-updated by trigger |

**Uniqueness**: Case-insensitive unique constraint on `(owner_user_id, lower(name))`. A user cannot have two brands with the same name.

**Indexes**:
- `uq_brands_owner_name_ci`: Unique on `(owner_user_id, lower(name))`
- `idx_brands_owner_created`: On `(owner_user_id, created_at DESC)`

**RLS**: Users can only CRUD their own brands (`owner_user_id = auth.uid()`).

**State transitions**: None (stateless entity; deletion is hard delete).

---

### 3. Brand Kit

**Purpose**: Stores answers to the brand identity questionnaire. One-to-one with brand.

| Field | Type | Constraints | Notes |
|-------|------|-------------|-------|
| `brand_id` | UUID | PK, FK → `brands(id)` ON DELETE CASCADE | One kit per brand |
| `tagline` | TEXT | Nullable, max 160 chars | Brand slogan |
| `tone` | `tone_t` | Nullable | Brand tone of voice |
| `audience` | TEXT | Nullable, length 2–500 (trimmed) | Target audience |
| `colors` | TEXT[] | NOT NULL, default `{}`, max 3 elements, all `#RRGGBB` | Brand colors |
| `avoid_words` | TEXT | Nullable | Words/themes to avoid |
| `summary` | TEXT | Nullable | Derived brand context summary |
| `status` | `kit_status_t` | NOT NULL, default `not_started` | Completion status |
| `completed_at` | TIMESTAMPTZ | Nullable | Set when status → `complete` |
| `created_at` | TIMESTAMPTZ | NOT NULL, default `now()` | Immutable |
| `updated_at` | TIMESTAMPTZ | NOT NULL, default `now()` | Auto-updated by trigger |

**Validation constraints**:
- `status = 'complete'` requires `tone IS NOT NULL AND audience IS NOT NULL AND cardinality(colors) >= 1`
- `completed_at` must be set iff `status = 'complete'`

**State transitions**:
```
not_started → in_progress → complete
     │              │
     └──────────────┘ (can go back to edit)
```

**RLS**: Via `is_brand_owner(brand_id)`.

---

### 4. Provider Key

**Purpose**: Stores metadata for API keys used by image generation providers. The actual key is stored in Supabase Vault.

| Field | Type | Constraints | Notes |
|-------|------|-------------|-------|
| `id` | UUID | PK, default `gen_random_uuid()` | |
| `brand_id` | UUID | NOT NULL, FK → `brands(id)` ON DELETE CASCADE | Owning brand |
| `provider` | `provider_t` | NOT NULL | `openai` or `gemini` |
| `vault_secret_id` | UUID | NOT NULL | Reference to Vault secret |
| `label` | TEXT | Nullable, max 100 chars | User-assigned label |
| `key_hint` | TEXT | Nullable, regex `^[A-Za-z0-9_-]{2,16}$` | Last N chars for display |
| `is_active` | BOOLEAN | NOT NULL, default TRUE | Whether key is the active one |
| `is_valid` | BOOLEAN | Nullable | Last validation result |
| `last_validated_at` | TIMESTAMPTZ | Nullable | Last validation timestamp |
| `last_validation_error` | TEXT | Nullable | Error from last validation |
| `last_used_at` | TIMESTAMPTZ | Nullable | Last generation usage |
| `created_at` | TIMESTAMPTZ | NOT NULL, default `now()` | Immutable |
| `updated_at` | TIMESTAMPTZ | NOT NULL, default `now()` | Auto-updated by trigger |

**Uniqueness**: Partial unique index ensures at most one active key per `(brand_id, provider)` WHERE `is_active = TRUE`.

**Indexes**:
- `uq_provider_keys_one_active`: Unique on `(brand_id, provider)` WHERE `is_active`
- `idx_provider_keys_lookup`: On `(brand_id, provider, created_at DESC)`

**RLS**: Via `is_brand_owner(brand_id)`.

---

### 5. Generation

**Purpose**: Records each image generation request and its outcome.

| Field | Type | Constraints | Notes |
|-------|------|-------------|-------|
| `id` | UUID | PK, default `gen_random_uuid()` | |
| `brand_id` | UUID | NOT NULL, FK → `brands(id)` ON DELETE CASCADE | Owning brand |
| `prompt` | TEXT | NOT NULL, length 3–4000 (trimmed) | User's prompt |
| `provider` | `provider_t` | NOT NULL | `openai` or `gemini` |
| `model` | TEXT | NOT NULL, length 3–100 | Model identifier |
| `platform_preset` | `platform_preset_t` | NOT NULL | Target social platform size |
| `width` | INT | NOT NULL, 256–4096 | Output width in pixels |
| `height` | INT | NOT NULL, 256–4096 | Output height in pixels |
| `logo_mode` | `logo_mode_t` | NOT NULL, default `none` | Logo handling mode |
| `status` | `generation_status_t` | NOT NULL, default `pending` | Lifecycle status |
| `provider_request_id` | TEXT | Nullable | Provider's request ID |
| `image_path` | TEXT | Nullable, regex `^brands/[0-9a-f-]+/generations/[0-9a-f-]+\.png$` | Storage path |
| `error_code` | TEXT | Nullable | Error code on failure |
| `error_message` | TEXT | Nullable | Error description on failure |
| `created_at` | TIMESTAMPTZ | NOT NULL, default `now()` | Immutable |
| `updated_at` | TIMESTAMPTZ | NOT NULL, default `now()` | Auto-updated by trigger |
| `completed_at` | TIMESTAMPTZ | Nullable | Set on success or failure |

**Validation constraints** (status-dependent):
- `succeeded`: requires `image_path IS NOT NULL`, `error_code IS NULL`, `error_message IS NULL`, `completed_at IS NOT NULL`
- `failed`: requires `image_path IS NULL`, `error_code IS NOT NULL`, `completed_at IS NOT NULL`
- `pending`/`processing`: requires `image_path IS NULL`, `error_code IS NULL`, `error_message IS NULL`, `completed_at IS NULL`

**State transitions**:
```
pending → processing → succeeded
                    → failed
```

**Indexes**:
- `idx_generations_brand_created`: On `(brand_id, created_at DESC)`
- `idx_generations_brand_status_created`: On `(brand_id, status, created_at DESC)`
- `idx_generations_brand_provider_created`: On `(brand_id, provider, created_at DESC)`

**RLS**: Via `is_brand_owner(brand_id)`.

---

## Entity Relationships

```
auth.users (1) ──── (1) profiles
     │
     └── (1) ──── (N) brands
                        │
                        ├── (1) ──── (1) brand_kits
                        ├── (1) ──── (N) provider_keys
                        └── (1) ──── (N) generations
```

- All child entities cascade-delete when their parent is deleted.
- Brand is the tenant boundary. All brand-scoped resources (kit, keys, generations) are isolated per brand via RLS.

## Storage

**Bucket**: `brand-assets` (public read, owner write/delete)

**Paths**:
- `brands/{brandId}/logo.{ext}` — Brand logo
- `brands/{brandId}/generations/{generationId}.png` — Generated image (succeeded only)

**RLS policies**:
- SELECT: Anyone can read (public bucket).
- INSERT/UPDATE/DELETE: Authenticated users only, where the brand folder belongs to a brand they own.
