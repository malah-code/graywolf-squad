# Data Model: Brand Kit Interview

**Branch**: `005-brand-kit` | **Date**: 2026-04-11

## Existing Table (no migration needed)

The `brand_kits` table was created in Phase 1. This feature reads and writes to it via upsert.

```text
brand_kits
├── brand_id         UUID (PK, FK → brands.id ON DELETE CASCADE)
├── tagline          TEXT | NULL  (max 160 chars)
├── tone             tone_t | NULL  (enum: formal, casual, playful, professional, friendly)
├── audience         TEXT | NULL  (2–500 chars when provided)
├── colors           TEXT[]  (0–3 valid hex strings, default '{}')
├── avoid_words      TEXT | NULL  (0–500 chars when provided)
├── summary          TEXT | NULL  (derived; never user-supplied)
├── status           kit_status_t  (not_started | in_progress | complete, default 'not_started')
├── completed_at     TIMESTAMPTZ | NULL
├── created_at       TIMESTAMPTZ
└── updated_at       TIMESTAMPTZ
```

**Constraints (already in DB):**
- `cardinality(colors) <= 3`
- `all_hex_colors(colors)` — every element matches `^#[0-9A-Fa-f]{6}$` via PostgreSQL's `~*` case-insensitive regex operator; both `#ff5733` and `#FF5733` are accepted at the DB level
- `status = 'complete'` requires `tone IS NOT NULL AND audience IS NOT NULL AND cardinality(colors) >= 1`
- `completed_at IS NOT NULL` iff `status = 'complete'`
- Note: No DB length check on `avoid_words` — length enforcement lives in the Pydantic validator (FR-013: ≤ 500 chars)

---

## Backend Pydantic Models (`backend/app/models/kit.py`)

### Enums

```python
class ToneEnum(str, Enum):
    formal       = "formal"
    casual       = "casual"
    playful      = "playful"
    professional = "professional"
    friendly     = "friendly"

class KitStatusEnum(str, Enum):
    not_started = "not_started"
    in_progress = "in_progress"
    complete    = "complete"
```

### Request

```python
class KitAnswers(BaseModel):
    tagline:     str | None  # max 160 chars
    tone:        ToneEnum | None
    audience:    str | None  # 2–500 chars when provided
    colors:      list[str]   # 0–3 items, each must match ^#[0-9A-Fa-f]{6}$
    avoid_words: str | None  # max 500 chars

class UpsertKitRequest(BaseModel):
    answers: KitAnswers
```

### Response

```python
class KitResponse(BaseModel):
    brand_id:     str
    brand_name:   str
    answers:      KitAnswers
    summary:      str | None
    status:       KitStatusEnum
    completed_at: datetime | None
    updated_at:   datetime | None
```

---

## Frontend TypeScript Types (additions to `frontend/types/index.ts`)

```typescript
export type ToneOption = 'formal' | 'casual' | 'playful' | 'professional' | 'friendly'
export type KitStatus  = 'not_started' | 'in_progress' | 'complete'

export interface KitAnswers {
  tagline:     string | null
  tone:        ToneOption | null
  audience:    string | null
  colors:      string[]
  avoid_words: string | null
}

export interface BrandKit {
  brand_id:     string
  brand_name:   string
  answers:      KitAnswers
  summary:      string | null
  status:       KitStatus
  completed_at: string | null
  updated_at:   string | null
}

export interface UpsertKitRequest {
  answers: KitAnswers
}
```

---

## Status Derivation Logic

Computed by the backend on every upsert — never supplied by the client.

| Condition | Status |
|---|---|
| `tone IS NULL AND audience IS NULL AND colors = []` | `not_started` |
| At least one field has a value, but `tone`, `audience`, or `colors` is missing/empty | `in_progress` |
| `tone IS NOT NULL AND audience IS NOT NULL AND len(colors) >= 1` | `complete` |

`completed_at` is set to `now()` when transitioning to `complete`; set to `NULL` when reverting.

---

## Summary Derivation Template

Computed by `backend/app/services/kit_summary.py`. Called on every upsert.

```text
Brand: {brand_name}
Tagline: {tagline or "None specified"}
Tone: {tone or "None specified"}
Audience: {audience or "None specified"}
Colors: {", ".join(colors) or "None specified"}
Avoid: {avoid_words or "None specified"}
```

Returns `None` (not persisted) when status is `not_started`. Returns the derived string for `in_progress` and `complete` (partial summary is still useful for the UI).

---

## Entity Relationships

```text
brands (1) ─────────────── (1) brand_kits
  id ◄────────────────────── brand_id (PK + FK)
  name ──── read for summary
  owner_user_id ─── RLS / ownership check
```

No new tables. No new storage buckets. No Vault involvement.
