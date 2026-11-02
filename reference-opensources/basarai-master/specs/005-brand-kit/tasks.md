---
description: "Task list for Brand Kit Interview implementation"
---

# Tasks: Brand Kit Interview

**Input**: Design documents from `/specs/005-brand-kit/`
**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/kit-api.md](./contracts/kit-api.md), [quickstart.md](./quickstart.md)

**Organization**: Tasks are grouped by user story to enable phase-by-phase review.

---

## Phase Execution Rules (READ FIRST)

- Complete phases strictly in order: Phase 1 → Phase 2 → Phase 3 → Phase 4 → Phase 5 → Phase 6
- **STOP at each "PHASE REVIEW CHECKPOINT"** and wait for review before starting the next phase
- Each task gives you the full context you need: exact file path, code shape, patterns to copy from existing files
- When copying patterns from existing files, read them first with the Read tool — don't guess
- Use the Edit tool for modifications and Write tool only for NEW files that don't exist yet
- All file paths below are absolute-from-repo-root (e.g., `backend/app/routers/kit.py`)

---

## Phase 1: Setup

**Purpose**: Verify the working branch and environment are ready. No code changes.

- [x] T001 Verify you are on branch `005-brand-kit` by running `git branch --show-current`. If not on that branch, STOP and ask the reviewer. Confirm `backend/` and `frontend/` directories exist at repo root. Read `backend/app/routers/brands.py` and `frontend/app/(dashboard)/[brandId]/layout.tsx` fully to understand the existing patterns you will mirror.

### 🛑 PHASE 1 REVIEW CHECKPOINT

Report: "Phase 1 complete — branch verified, patterns read." Then STOP for review.

---

## Phase 2: Foundational (Backend API)

**Purpose**: Build the entire backend API for brand kits. Every user story depends on this phase. This phase delivers a fully working `GET` and `PUT /brands/{id}/kit` endpoint with tests.

**⚠️ CRITICAL**: No frontend work may begin until this phase is complete and reviewed.

### T002 — Create kit summary service

- [x] T002 Create NEW file `backend/app/services/kit_summary.py` containing two pure functions and one enum. No FastAPI, no DB imports — this is a pure utility module. Requirements:

  **Imports (exact):**
  ```python
  from enum import Enum
  ```

  **Enum:**
  ```python
  class KitStatusEnum(str, Enum):
      not_started = "not_started"
      in_progress = "in_progress"
      complete    = "complete"
  ```

  **Function `derive_status`** — signature and body exactly as below:
  ```python
  def derive_status(
      tagline: str | None,
      tone: str | None,
      audience: str | None,
      colors: list[str],
      avoid_words: str | None,
  ) -> KitStatusEnum:
      if tone is not None and audience is not None and len(colors) >= 1:
          return KitStatusEnum.complete
      if (
          tagline is None
          and tone is None
          and audience is None
          and len(colors) == 0
          and avoid_words is None
      ):
          return KitStatusEnum.not_started
      return KitStatusEnum.in_progress
  ```

  **Function `derive_summary`** — signature and body exactly as below. Note the leading early-return uses the same 5-field "all empty" check as `derive_status`; do NOT call `derive_status` from inside `derive_summary` (they stay independent):
  ```python
  def derive_summary(
      brand_name: str,
      tagline: str | None,
      tone: str | None,
      audience: str | None,
      colors: list[str],
      avoid_words: str | None,
  ) -> str | None:
      if (
          tagline is None
          and tone is None
          and audience is None
          and len(colors) == 0
          and avoid_words is None
      ):
          return None
      lines = [
          f"Brand: {brand_name}",
          f"Tagline: {tagline or 'None specified'}",
          f"Tone: {tone or 'None specified'}",
          f"Audience: {audience or 'None specified'}",
          f"Colors: {', '.join(colors) if colors else 'None specified'}",
          f"Avoid: {avoid_words or 'None specified'}",
      ]
      return "\n".join(lines)
  ```

  > **DO NOT** invent alternative signatures, different field orderings, or additional parameters. The signatures above are load-bearing: T003, T004, T006, and T007 all reference this exact shape.

### T003 — Create kit Pydantic models

- [x] T003 Create NEW file `backend/app/models/kit.py`. Follow the style of `backend/app/models/provider_key.py` (read it first). Requirements:
  - Imports: `from datetime import datetime`, `from enum import Enum`, `from pydantic import BaseModel, field_validator`, `import re`.
  - Define `class ToneEnum(str, Enum)` with members: `formal = "formal"`, `casual = "casual"`, `playful = "playful"`, `professional = "professional"`, `friendly = "friendly"`.
  - Re-export `KitStatusEnum` from `app.services.kit_summary` with `from app.services.kit_summary import KitStatusEnum` so this module is the single import point for API consumers.
  - Define `class KitAnswers(BaseModel)`:
    - `tagline: str | None = None`
    - `tone: ToneEnum | None = None`
    - `audience: str | None = None`
    - `colors: list[str] = []`
    - `avoid_words: str | None = None`
    - Add `@field_validator("tagline")` → strip whitespace; if empty after strip return `None`; if `len > 160` raise `ValueError("Tagline must be 160 characters or less")`.
    - Add `@field_validator("audience")` → strip whitespace; if empty after strip return `None`; if provided and `len < 2` raise `ValueError("Audience must be at least 2 characters")`; if `len > 500` raise `ValueError("Audience must be 500 characters or less")`.
    - Add `@field_validator("colors")` → if `len(v) > 3` raise `ValueError("At most 3 colors are allowed")`; for each item, if not matching the regex `^#[0-9A-Fa-f]{6}$` raise `ValueError(f"Invalid hex color: {item}")`; return the list with each item uppercased (e.g., `#ff5733` → `#FF5733`) for consistency with DB constraint.
    - Add `@field_validator("avoid_words")` → strip whitespace; if empty after strip return `None`; if `len > 500` raise `ValueError("Avoid words must be 500 characters or less")`.
  - Define `class UpsertKitRequest(BaseModel)` with one field: `answers: KitAnswers`.
  - Define `class KitResponse(BaseModel)`:
    - `brand_id: str`
    - `brand_name: str`
    - `answers: KitAnswers`
    - `summary: str | None = None`
    - `status: KitStatusEnum`
    - `completed_at: datetime | None = None`
    - `updated_at: datetime | None = None`

### T004 — Create kit router

- [x] T004 Create NEW file `backend/app/routers/kit.py`. Read `backend/app/routers/keys.py` first and copy its pattern exactly for imports, error helpers, and ownership checks. Requirements:
  - Imports: `from datetime import datetime, timezone`, `from uuid import UUID, uuid4`, `from fastapi import APIRouter, Depends, HTTPException, status`, `from app.core.auth import User, get_current_user`, `from app.core.supabase import get_service_client`, `from app.models.kit import KitAnswers, UpsertKitRequest, KitResponse, KitStatusEnum, ToneEnum`, `from app.services.kit_summary import derive_status, derive_summary`.
  - Create router: `router = APIRouter(prefix="/brands/{brand_id}/kit", tags=["brand-kit"])`.
  - Copy the `_error_response(status_code, code, message)` helper EXACTLY from `keys.py` (returns an `HTTPException` with structured detail).
  - Copy the `_get_brand_or_404(brand_id, user_id)` helper EXACTLY from `keys.py` (queries `brands` table, raises 404 with code `BRAND_NOT_FOUND`).
  - Add helper `_empty_answers() -> KitAnswers` that returns `KitAnswers(tagline=None, tone=None, audience=None, colors=[], avoid_words=None)`.
  - Add helper `_row_to_response(brand: dict, row: dict | None) -> KitResponse`:
    - If `row is None`: return `KitResponse(brand_id=brand["id"], brand_name=brand["name"], answers=_empty_answers(), summary=None, status=KitStatusEnum.not_started, completed_at=None, updated_at=None)`.
    - Otherwise build `KitAnswers` from the row (colors must default to `[]` if `None`) and return a `KitResponse` with all fields populated from the row.

  **GET endpoint**:
  ```python
  @router.get("", response_model=KitResponse)
  async def get_kit(brand_id: UUID, current_user: User = Depends(get_current_user)):
      brand = _get_brand_or_404(brand_id, current_user.id)
      client = get_service_client()
      result = (
          client.table("brand_kits")
          .select("*")
          .eq("brand_id", str(brand_id))
          .maybe_single()
          .execute()
      )
      row = result.data if result is not None else None
      return _row_to_response(brand, row)
  ```

  **PUT endpoint**:
  ```python
  @router.put("", response_model=KitResponse)
  async def upsert_kit(
      brand_id: UUID,
      body: UpsertKitRequest,
      current_user: User = Depends(get_current_user),
  ):
      brand = _get_brand_or_404(brand_id, current_user.id)
      a = body.answers
      new_status = derive_status(
          tagline=a.tagline,
          tone=a.tone.value if a.tone else None,
          audience=a.audience,
          colors=a.colors,
          avoid_words=a.avoid_words,
      )
      summary = derive_summary(
          brand_name=brand["name"],
          tagline=a.tagline,
          tone=a.tone.value if a.tone else None,
          audience=a.audience,
          colors=a.colors,
          avoid_words=a.avoid_words,
      )
      now = datetime.now(timezone.utc)
      completed_at = now.isoformat() if new_status == KitStatusEnum.complete else None

      payload = {
          "brand_id": str(brand_id),
          "tagline": a.tagline,
          "tone": a.tone.value if a.tone else None,
          "audience": a.audience,
          "colors": a.colors,
          "avoid_words": a.avoid_words,
          "summary": summary,
          "status": new_status.value,
          "completed_at": completed_at,
      }

      client = get_service_client()
      result = (
          client.table("brand_kits")
          .upsert(payload, on_conflict="brand_id")
          .execute()
      )
      row = result.data[0] if result.data else None
      return _row_to_response(brand, row)
  ```

  - Do NOT add any other endpoints.

### T005 — Register kit router in main.py

- [x] T005 Modify `backend/app/main.py`: (1) on line 9, change `from app.routers import brands, health, keys, me` to `from app.routers import brands, health, keys, kit, me`. (2) Add `app.include_router(kit.router)` immediately after the existing `app.include_router(keys.router)` line. Do not change anything else in the file.

### T006 — Unit tests for kit_summary service

- [x] T006 [P] Create NEW file `backend/tests/test_kit_summary.py`. Pure unit tests, no FastAPI test client needed. Import `from app.services.kit_summary import derive_status, derive_summary, KitStatusEnum`. Note: every `derive_status` call MUST pass all 5 keyword arguments (`tagline=..., tone=..., audience=..., colors=..., avoid_words=...`) even when most are `None`. Same for `derive_summary` (plus `brand_name=...`). Write these test functions:
  - `test_derive_status_not_started_when_all_none`: `derive_status(tagline=None, tone=None, audience=None, colors=[], avoid_words=None)` → `KitStatusEnum.not_started`
  - `test_derive_status_complete_when_required_fields_present`: `derive_status(tagline=None, tone="formal", audience="owners", colors=["#FF0000"], avoid_words=None)` → `KitStatusEnum.complete`
  - `test_derive_status_in_progress_when_only_tagline`: `derive_status(tagline="hi", tone=None, audience=None, colors=[], avoid_words=None)` → `KitStatusEnum.in_progress`
  - `test_derive_status_in_progress_when_missing_colors`: `derive_status(tagline=None, tone="formal", audience="aa", colors=[], avoid_words=None)` → `KitStatusEnum.in_progress`
  - `test_derive_status_in_progress_when_only_avoid_words`: `derive_status(tagline=None, tone=None, audience=None, colors=[], avoid_words="neon")` → `KitStatusEnum.in_progress` (edge case — avoid_words alone is enough to escape `not_started`)
  - `test_derive_summary_returns_none_when_not_started`: all answer fields None/empty → `None`
  - `test_derive_summary_contains_brand_name`: brand name `"Acme"` appears in the returned string
  - `test_derive_summary_uses_none_specified_for_missing_optionals`: `tagline=None` → result contains `"Tagline: None specified"`
  - `test_derive_summary_joins_colors_with_comma`: colors `["#FF0000", "#00FF00"]` → result contains `"#FF0000, #00FF00"`
  - `test_derive_summary_is_deterministic` **(covers SC-005)**: call `derive_summary` twice with the same fully-populated inputs (`brand_name="Acme"`, `tagline="Hello"`, `tone="formal"`, `audience="owners"`, `colors=["#FF0000"]`, `avoid_words="cheap"`) and assert both calls return the exact same string via `assert result1 == result2`. Also assert `result1` is not `None`.
  - `test_derive_summary_format_line_order` **(locks the template)**: with the same inputs above, assert the returned string split by `"\n"` has exactly 6 lines and the first line starts with `"Brand: "`, second with `"Tagline: "`, third with `"Tone: "`, fourth with `"Audience: "`, fifth with `"Colors: "`, sixth with `"Avoid: "`. This prevents a future implementer reordering the template fields by accident.

### T007 — Unit tests for kit Pydantic validators

- [x] T007 [P] Create NEW file `backend/tests/test_kit_models.py`. Import `from app.models.kit import KitAnswers, ToneEnum` and `import pytest`. Write these test functions:
  - `test_valid_answers`: a `KitAnswers` with all fields valid should construct without error
  - `test_tagline_too_long`: `KitAnswers(tagline="x" * 161)` should raise `ValueError` (use `pytest.raises`)
  - `test_audience_too_short`: `KitAnswers(audience="x")` should raise `ValueError`
  - `test_audience_too_long`: `KitAnswers(audience="x" * 501)` should raise `ValueError`
  - `test_too_many_colors`: `colors=["#FF0000", "#00FF00", "#0000FF", "#FFFFFF"]` should raise `ValueError`
  - `test_invalid_hex_color`: `colors=["notahex"]` should raise `ValueError`
  - `test_hex_colors_uppercased`: `colors=["#ff5733"]` after validation should be `["#FF5733"]`
  - `test_avoid_words_too_long`: `avoid_words="x" * 501` should raise `ValueError`
  - `test_empty_strings_become_none`: `tagline="   "` (whitespace) should become `None` after validation

### T008 — Run backend tests

- [x] T008 Run `cd backend && source venv/bin/activate && pytest tests/test_kit_summary.py tests/test_kit_models.py -v` and confirm all tests pass. If any fail, fix the corresponding source file (T002 or T003) and re-run until green. Do NOT proceed until all tests pass.

### T009 — Manual backend smoke test

- [x] T009 With the backend running (`uvicorn app.main:app --reload --port 8000`), open the FastAPI auto-docs at `http://127.0.0.1:8000/docs` in a browser and confirm that two new endpoints appear under the `brand-kit` tag: `GET /brands/{brand_id}/kit` and `PUT /brands/{brand_id}/kit`. Do NOT attempt to call them (requires auth + real brand); just verify they are registered. Report whether the endpoints appear in the docs.

### 🛑 PHASE 2 REVIEW CHECKPOINT

Report: "Phase 2 complete — backend API implemented, all unit tests passing, endpoints registered." Then STOP for review.

---

## Phase 3: User Story 1 — Complete the Brand Kit Interview (Priority: P1) 🎯 MVP

**Goal**: User can open a brand's kit page, walk through a 7-screen wizard (1 intro + 5 input + 1 review), save their answers, and see the kit reach "complete" status with a derived summary. This phase also naturally delivers User Story 4 (view the derived summary) since the summary is shown on the final review screen.

**Independent Test**: Log in, navigate to `/{brandId}/kit`, click through all 7 screens filling in the required input fields (tone, audience, at least one color), click Save on the review screen, confirm the kit is marked "complete" and the server-derived summary is displayed.

### T010 — Add TypeScript types for kit

- [x] T010 [US1] Modify `frontend/types/index.ts`. Append the following types at the end of the file (do not modify or remove anything already there):
  ```typescript
  export type ToneOption = 'formal' | 'casual' | 'playful' | 'professional' | 'friendly'
  export type KitStatus = 'not_started' | 'in_progress' | 'complete'

  export interface KitAnswers {
    tagline: string | null
    tone: ToneOption | null
    audience: string | null
    colors: string[]
    avoid_words: string | null
  }

  export interface BrandKit {
    brand_id: string
    brand_name: string
    answers: KitAnswers
    summary: string | null
    status: KitStatus
    completed_at: string | null
    updated_at: string | null
  }

  export interface UpsertKitRequest {
    answers: KitAnswers
  }
  ```

### T011 — Create useKit hook

- [x] T011 [US1] Create NEW file `frontend/hooks/use-kit.ts`. Read `frontend/hooks/use-brand.ts` first and mirror its pattern. Requirements:
  - `'use client'` at the top
  - Import `useCallback, useEffect, useState` from `'react'`, `apiRequest` from `'@/lib/api'`, and `BrandKit, KitAnswers, UpsertKitRequest` from `'@/types'`
  - Export `useKit(brandId: string)` that returns `{ kit, loading, error, refetch }` by calling `GET /brands/${brandId}/kit`
  - Export a separate async function `saveKit(brandId: string, answers: KitAnswers): Promise<BrandKit>` that calls `PUT /brands/${brandId}/kit` with body `{ answers }` and returns the response. Use `apiRequest<BrandKit>` with `method: 'PUT'` and `body: JSON.stringify({ answers })`.

### T012 — Create ColorSlot component

- [x] T012 [P] [US1] Create NEW file `frontend/components/kit/color-slot.tsx`. Client component. Props: `{ value: string; onChange: (hex: string) => void; onRemove: () => void }`. Requirements:
  - `'use client'` at the top
  - Use Tailwind classes for layout
  - Render a flex container with three children side by side:
    1. `<input type="color">` bound to `value` — its `onChange` must call `onChange(e.target.value.toUpperCase())`
    2. `<input type="text">` bound to `value` with `placeholder="#RRGGBB"`, max length 7 — on change, always call `onChange(e.target.value)`. On blur, if the value does NOT match `/^#[0-9A-Fa-f]{6}$/`, add a red border (`border-red-500`). Always uppercase the submitted value visually.
    3. A remove button `<button type="button" onClick={onRemove}>×</button>` with `aria-label="Remove color"`
  - Do not use any external color picker library.

### T013 — Create wizard step components (screens 1–6, review screen is T014)

- [x] T013 [P] [US1] Create NEW directory `frontend/components/kit/steps/` and NEW files for each screen below. All are client components (`'use client'`). **Use named exports** (e.g., `export function StepName(...)`) — NOT default exports, because `kit-wizard.tsx` imports them by name. Each step receives these props:
  ```typescript
  interface StepProps {
    answers: KitAnswers
    onChange: (partial: Partial<KitAnswers>) => void
    brandName: string
  }
  ```
  Import `KitAnswers` and `ToneOption` from `'@/types'` as needed.

  **File `step-name.tsx`** — named export `StepName`: Read-only display. Render a heading "Screen 1 of 7 — Your Brand" and paragraph text showing `brandName` as read-only (e.g., `<p className="text-lg font-medium">{brandName}</p>`). Include helper text: "This is the brand name you registered. Continue to the next screen."

  **File `step-tagline.tsx`** — named export `StepTagline`: Heading "Screen 2 of 7 — Tagline". Optional field. Render `<input type="text">` bound to `answers.tagline ?? ''`, maxLength 160. On change call `onChange({ tagline: e.target.value || null })`. Show character counter `{answers.tagline?.length ?? 0}/160`. Include helper text: "What is your brand's tagline or slogan? (optional)".

  **File `step-tone.tsx`** — named export `StepTone`: Heading "Screen 3 of 7 — Tone". Required field. Render 5 radio buttons (or styled button cards) for the 5 tone options. Each has a label: `Formal`, `Casual`, `Playful`, `Professional`, `Friendly`. Selected state is determined by `answers.tone === option`. On click call `onChange({ tone: option })`. Include helper text: "What tone should your content have?".

  **File `step-audience.tsx`** — named export `StepAudience`: Heading "Screen 4 of 7 — Audience". Required field. Render `<textarea>` bound to `answers.audience ?? ''`, maxLength 500. On change call `onChange({ audience: e.target.value || null })`. Show character counter `{answers.audience?.length ?? 0}/500`. Include helper text: "Who is your target audience?".

  **File `step-colors.tsx`** — named export `StepColors`: Heading "Screen 5 of 7 — Colors". Required (at least 1). Import `ColorSlot` from `../color-slot`. Render up to 3 `<ColorSlot>` instances using `answers.colors`. Include a `+ Add Color` button (disabled when `answers.colors.length >= 3`) that appends `"#000000"` to the colors array via `onChange({ colors: [...answers.colors, "#000000"] })`. Each slot's `onChange(hex)` updates the color at its index. Each slot's `onRemove()` removes the slot at its index. Include helper text: "Pick up to 3 brand colors.".

  **File `step-avoid-words.tsx`** — named export `StepAvoidWords`: Heading "Screen 6 of 7 — Avoid Words". Optional field. Render `<textarea>` bound to `answers.avoid_words ?? ''`, maxLength 500. On change call `onChange({ avoid_words: e.target.value || null })`. Show character counter `{answers.avoid_words?.length ?? 0}/500`. Include helper text: "Any words or themes to avoid? (optional)".

### T014 — Create review step component

- [x] T014 [US1] Create NEW file `frontend/components/kit/steps/step-review.tsx`. Client component. **Named export** `StepReview`. StepReview does NOT import `StepProps` from anywhere — declare a local `StepReviewProps` interface inline (the steps from T013 do not export a shared props type; each step accepts the same shape inline). Use this interface:
  ```typescript
  interface StepReviewProps {
    answers: KitAnswers
    onChange: (partial: Partial<KitAnswers>) => void
    brandName: string
    savedSummary: string | null
    savedStatus: KitStatus
    isDirty: boolean
    onSave: () => void
    saving: boolean
    saveError: string | null
  }
  ```
  Requirements:
  - `'use client'` at the top
  - Imports (exact list):
    ```typescript
    import { KitAnswers, KitStatus } from '@/types'
    ```
  - Heading "Screen 7 of 7 — Review & Save"
  - Display a read-only preview showing each answer as a labeled line. For missing optional fields, show "— not specified —".
  - **Missing-required-fields indicator (covers spec US1 Acceptance Scenario 3 — "user is informed which required fields are missing")**. Before the Save button, compute and render a list of required fields that are still empty based on the *current in-memory* `answers`. Use this exact helper and markup:
    ```typescript
    const missingRequired: string[] = []
    if (!answers.tone) missingRequired.push('Tone')
    if (!answers.audience || answers.audience.trim().length < 2) missingRequired.push('Audience')
    if (!answers.colors || answers.colors.length === 0) missingRequired.push('Colors (at least one)')
    ```
    ```tsx
    {missingRequired.length > 0 && (
      <div
        role="status"
        aria-live="polite"
        className="rounded-md border border-yellow-300 bg-yellow-50 p-3 text-sm text-yellow-900"
      >
        <p className="font-medium">Required fields still missing:</p>
        <ul className="mt-1 list-disc pl-5">
          {missingRequired.map((f) => (
            <li key={f}>{f}</li>
          ))}
        </ul>
        <p className="mt-2">
          You can still save now — your kit will be stored as{' '}
          <span className="font-medium">"In progress"</span> until all required fields are filled.
        </p>
      </div>
    )}
    ```
    This block MUST remain visible **after** a save too (do not clear it on save success) so the user sees post-save confirmation of what is still missing. It disappears only when the user goes back and fills in the missing fields (because `missingRequired` is recomputed on every render from `answers`).
  - **Post-save status banner**. After a successful save (i.e., `!isDirty && saveError === null`), render a status banner above the summary derived from `savedStatus`:
    - `savedStatus === 'complete'` → green banner `"✓ Brand kit saved — status: Complete."`
    - `savedStatus === 'in_progress'` → yellow banner `"Brand kit saved — status: In progress. Fill in the remaining required fields to reach Complete."`
    - `savedStatus === 'not_started'` → no banner (nothing has been saved yet).
    Use `bg-green-50 border-green-300 text-green-900` and `bg-yellow-50 border-yellow-300 text-yellow-900` classes respectively. Wrap in `<div role="status" aria-live="polite">`.
  - **Do NOT re-derive the summary on the client.** Render the server-derived `savedSummary` (passed as a prop) inside a `<pre className="whitespace-pre-wrap rounded bg-gray-50 p-3 text-sm">{savedSummary}</pre>` block with the heading "Brand Context Summary (what the AI will use)". The backend is the single source of truth for the summary template.
  - If `savedSummary` is `null` (kit never saved yet), show placeholder text: "Summary will be generated after you save."
  - If `isDirty` is `true` AND `savedSummary` is not null, show a small italic hint next to the summary: "You have unsaved changes — the summary will update after Save."
  - If `saveError` is not null, render it in red: `<p className="text-red-600 text-sm">{saveError}</p>`.
  - Render a `<button>` labeled "Save Brand Kit" (or "Saving..." when `saving` is true). On click, call `onSave()`. Disable when `saving` is true.

  > **Render order (top → bottom) inside the StepReview root element — implementer MUST use this order exactly:**
  > 1. Heading "Screen 7 of 7 — Review & Save"
  > 2. Read-only preview of each answer
  > 3. Missing-required-fields yellow block (if any)
  > 4. Post-save status banner (if applicable)
  > 5. Brand Context Summary `<pre>` block (with placeholder/hint logic)
  > 6. Save error paragraph (if any)
  > 7. Save button

### T015 — Create kit wizard container

- [x] T015 [US1] Create NEW file `frontend/components/kit/kit-wizard.tsx`. Client component. Props: `{ brandId: string; brandName: string; initialKit: BrandKit }`. Requirements:
  - `'use client'` at the top
  - Imports (exact list — do not omit any):
    ```typescript
    import { useState, useCallback, useEffect } from 'react'
    import { useRouter } from 'next/navigation'
    import { saveKit } from '@/hooks/use-kit'
    import { KitAnswers, BrandKit, KitStatus } from '@/types'
    import { StepName } from './steps/step-name'
    import { StepTagline } from './steps/step-tagline'
    import { StepTone } from './steps/step-tone'
    import { StepAudience } from './steps/step-audience'
    import { StepColors } from './steps/step-colors'
    import { StepAvoidWords } from './steps/step-avoid-words'
    import { StepReview } from './steps/step-review'
    ```
  - State variables (use `const`, in this exact order):
    ```typescript
    const [step, setStep] = useState(0)                                 // 0-6 = 7 screens
    const [answers, setAnswers] = useState<KitAnswers>(initialKit.answers)
    const [savedSummary, setSavedSummary] = useState<string | null>(initialKit.summary)
    const [savedStatus, setSavedStatus] = useState<KitStatus>(initialKit.status)
    const [isDirty, setIsDirty] = useState(false)
    const [saving, setSaving] = useState(false)
    const [saveError, setSaveError] = useState<string | null>(null)
    const router = useRouter()
    ```
  - Handlers (use `const` keyword — these are declarations, not assignments):
    ```typescript
    const handleChange = useCallback((partial: Partial<KitAnswers>) => {
      setAnswers(prev => ({ ...prev, ...partial }))
      setIsDirty(true)
    }, [])

    const handleSave = async () => {
      setSaving(true)
      setSaveError(null)
      try {
        const saved = await saveKit(brandId, answers)
        setSavedSummary(saved.summary)
        setSavedStatus(saved.status)
        setIsDirty(false)
        router.refresh()
      } catch (e) {
        setSaveError(e instanceof Error ? e.message : 'Save failed')
      } finally {
        setSaving(false)
      }
    }
    ```
  - Render a flex-col layout:
    1. Top bar: `"Screen {step + 1} of 7"` with a horizontal progress bar: `<div className="h-1 bg-gray-200"><div className="h-1 bg-blue-600" style={{ width: `${((step + 1) / 7) * 100}%` }} /></div>`
    2. The current step component. Use an if-chain or switch on `step`:
       - 0 → `<StepName answers={answers} onChange={handleChange} brandName={brandName} />`
       - 1 → `<StepTagline ... />`
       - 2 → `<StepTone ... />`
       - 3 → `<StepAudience ... />`
       - 4 → `<StepColors ... />`
       - 5 → `<StepAvoidWords ... />`
       - 6 → `<StepReview answers={answers} onChange={handleChange} brandName={brandName} savedSummary={savedSummary} savedStatus={savedStatus} isDirty={isDirty} onSave={handleSave} saving={saving} saveError={saveError} />`
    3. Bottom nav: Back button (disabled when `step === 0`, calls `setStep(step - 1)`) and Next button (hidden when `step === 6` since review has its own Save button, calls `setStep(step + 1)` otherwise).
  - **Unsaved warning (beforeunload)**: Add this `useEffect` after the handlers:
    ```typescript
    useEffect(() => {
      if (!isDirty) return
      const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }
      window.addEventListener('beforeunload', handler)
      return () => window.removeEventListener('beforeunload', handler)
    }, [isDirty])
    ```
  - Do NOT add the in-app anchor click interceptor in this task (Phase 4 / T018 handles it).
  - Every step component must be imported as a **named export** — make sure step files use `export function StepName(...)` (or `export const StepName = ...`) rather than a default export so the import statements above resolve.

### T016 — Create kit page

- [x] T016 [US1] Create NEW directory and file `frontend/app/(dashboard)/[brandId]/kit/page.tsx`. Client component. Requirements:
  - `'use client'` at the top
  - Imports: `useParams` from `'next/navigation'`, `useKit` from `'@/hooks/use-kit'`, `KitWizard` from `'@/components/kit/kit-wizard'`
  - Get `brandId` from `useParams()` as a string (handle array case the same way the keys page does: `Array.isArray(params.brandId) ? params.brandId[0] : params.brandId ?? ''`)
  - Call `const { kit, loading, error } = useKit(brandId)`
  - If `loading` → return `<p className="text-muted-foreground">Loading...</p>`
  - If `error` or `!kit` → return `<p className="text-red-600">Failed to load brand kit.</p>`
  - Otherwise return `<KitWizard brandId={brandId} brandName={kit.brand_name} initialKit={kit} />`
  - Do not wrap in any extra containers — the parent layout provides page chrome.

### T017 — Frontend manual smoke test (US1)

- [x] T017 [US1] With both backend and frontend running, log in, create (or reuse) a brand, and navigate to the kit page at `/{brandId}/kit`. Run **three passes** and report observations for each.

  **Pass 1 — full-field happy path.** Walk through all 7 screens (intro + 5 input + review), providing: tagline, tone (pick one), audience (30+ chars), 2 colors, avoid words. On the review screen, click Save. Verify:
  1. No errors appear in the browser console or on the page.
  2. The server-derived summary is displayed on the review screen after save.
  3. The post-save status banner shows "Complete" (green).
  4. The missing-required-fields yellow block is NOT rendered.
  5. Reopening the wizard (navigate away then back) shows the previously entered answers pre-populated from the server.

  **Pass 2 — minimum-required path (covers spec edge case "submit with only required fields").** On the same brand (or a fresh one), clear the optional fields in the wizard and save with EXACTLY: tone (pick one), audience (≥2 chars), exactly 1 color, and leave tagline and avoid words blank. Click Save. Verify:
  1. The kit saves successfully without validation errors.
  2. The post-save status banner shows "Complete" (green).
  3. The Brand Context Summary displays `Tagline: None specified` and `Avoid: None specified`.
  4. The missing-required-fields yellow block is NOT rendered.

  **Pass 3 — partial-save feedback (covers spec US1 Acceptance Scenario 3).** On a fresh brand (or after clearing tone in the previous kit), fill in ONLY the tagline field and save. Verify:
  1. The save succeeds.
  2. The post-save status banner shows "In progress" (yellow).
  3. The missing-required-fields yellow block lists exactly: `Tone`, `Audience`, `Colors (at least one)`.
  4. The nav badge shows "In progress".

  Report PASS/FAIL per pass and paste any observed errors.

### 🛑 PHASE 3 REVIEW CHECKPOINT

Report: "Phase 3 complete — MVP wizard flow working end-to-end. User can complete and save a brand kit." Then STOP for review.

---

## Phase 4: User Story 2 — Save Progress Mid-Interview (Priority: P2)

**Goal**: Users navigating within the app (e.g., clicking a nav link) before saving see a confirmation prompt so they don't lose in-progress wizard answers.

**Independent Test**: Start the wizard, fill in the tagline on step 2, then click "Keys" in the nav. Expect a confirmation dialog. Cancel → you stay on the kit page. Confirm → you navigate to keys.

> Note: User Story 2's "save progress" scenario in the spec is partially satisfied by Phase 3 (returning to the kit page reloads saved answers from the DB). This phase adds the **in-app** unsaved-state warning for answers still held in memory that haven't been saved yet.

### T018 — Add in-app navigation warning to wizard

- [x] T018 [US2] Modify `frontend/components/kit/kit-wizard.tsx`. Add the following to the component body (after the existing `useEffect` for `beforeunload`):
  - Add a ref to track dirty state that is readable from within event handlers:
    ```typescript
    const isDirtyRef = useRef(isDirty)
    useEffect(() => { isDirtyRef.current = isDirty }, [isDirty])
    ```
    Add `useRef` to the React import.
  - Add a second `useEffect` that intercepts clicks on anchor tags (for Next.js `<Link>` which render as `<a>`):
    ```typescript
    useEffect(() => {
      const handleClick = (e: MouseEvent) => {
        if (!isDirtyRef.current) return
        const target = (e.target as HTMLElement).closest('a')
        if (!target) return
        const href = target.getAttribute('href')
        if (!href || href.startsWith('#')) return
        const confirmed = window.confirm('You have unsaved changes. Are you sure you want to leave?')
        if (!confirmed) {
          e.preventDefault()
          e.stopPropagation()
        }
      }
      document.addEventListener('click', handleClick, true)
      return () => document.removeEventListener('click', handleClick, true)
    }, [])
    ```
  - Do not change any other code.

### T019 — Manual test unsaved warning

- [ ] T019 [US2] With both services running, open the kit wizard, type text in the tagline field (making it dirty), then click "Keys" in the top navigation. Verify a browser confirm dialog appears with the expected message. Click Cancel → verify you remain on the kit page. Click "Keys" again, dirty the field, then click Save on the last step to save. After saving, click "Keys" → verify no dialog appears (state is clean). Report what you observed.

### 🛑 PHASE 4 REVIEW CHECKPOINT

Report: "Phase 4 complete — unsaved-state warning works for in-app navigation." Then STOP for review.

---

## Phase 5: User Story 3 — Kit Status Badge in Navigation (Priority: P3)

**Goal**: The brand navigation bar shows a clickable status badge for the kit (not started / in progress / complete) that updates immediately after saving without a full page reload.

**Independent Test**: Navigate to a brand with an empty kit — the nav should show a grey "Not started" badge next to "Brand Kit". Complete the kit and save — the badge should become a green "Complete" without reloading the page. Click the badge from another page (e.g., Keys) — it should navigate to the kit page.

### T020 — Create KitStatusBadge component

- [x] T020 [P] [US3] Create NEW file `frontend/components/kit/kit-status-badge.tsx`. Server-safe component (no `'use client'` — the component only uses `<Link>` and static rendering). Props: `{ status: KitStatus; brandId: string }`. Requirements:
  - Import `Link` from `'next/link'` and `KitStatus` from `'@/types'`
  - Define a label + color map:
    ```typescript
    const LABELS: Record<KitStatus, string> = {
      not_started: 'Not started',
      in_progress: 'In progress',
      complete: 'Complete',
    }
    const CLASSES: Record<KitStatus, string> = {
      not_started: 'bg-gray-100 text-gray-700',
      in_progress: 'bg-yellow-100 text-yellow-800',
      complete: 'bg-green-100 text-green-800',
    }
    ```
  - Return:
    ```tsx
    <Link
      href={`/${brandId}/kit`}
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${CLASSES[status]}`}
      aria-label={`Brand kit status: ${LABELS[status]}. Click to edit.`}
    >
      {LABELS[status]}
    </Link>
    ```

### T021 — Wire badge into brand layout

- [x] T021 [US3] Modify `frontend/app/(dashboard)/[brandId]/layout.tsx`. Read the full file first. Make these changes:
  1. Change `ensureBrandAccess` to ALSO return the parsed brand JSON. Currently the function returns void. Update it to `async function ensureBrandAccess(brandId: string): Promise<any>` and replace the existing ok-check block so that it parses the JSON and returns it: after `if (!response.ok) throw new Error(...)`, add `return response.json()`. The function should still `redirect('/login')` on 401 and `notFound()` on 404.
  2. In `BrandLayout`, change `await ensureBrandAccess(brandId)` to `const brand = await ensureBrandAccess(brandId)`.
  3. Import the new badge: `import { KitStatusBadge } from '@/components/kit/kit-status-badge'` (add alongside the existing imports).
  4. Find the nav rendering section (currently `navLinks.map(...)`). Replace the map so that the Brand Kit link is rendered with a sibling badge. The simplest approach: keep the existing map, but for the `href` that equals `/${brandId}/kit`, render the link followed by `<KitStatusBadge status={brand.kit_status} brandId={brandId} />` inside the same flex item. Use `React.Fragment` or a wrapping `<div className="flex items-center gap-2">` for the kit link + badge pair. Leave all other nav links unchanged.
  5. Do NOT modify anything else.

### T022 — Manual test kit status badge

- [ ] T022 [US3] With both services running: (1) Navigate to a brand with an empty kit — verify a grey "Not started" badge appears next to "Brand Kit" in the nav. (2) Click the badge — verify it navigates to the kit page. (3) Fill in a partial kit (tagline only) and save — after `router.refresh()` fires, verify the badge changes to yellow "In progress" without a full page reload. (4) Complete and save the full kit — verify the badge becomes green "Complete". (5) Click "Keys" and verify the badge still shows the correct status on that page.

  **(6) SC-003 timing check — REQUIRED.** Open Chrome DevTools → Performance tab (or use a stopwatch). Trigger step (4) again. Visually observe the time between clicking Save and the badge flipping from yellow to green. This MUST be ≤ 1 second to satisfy SC-003. If the observed time exceeds 1 second, report FAIL and include the observed duration; do not mark the feature ready for PR until this passes.

  **(7) Full-page-reload regression check — REQUIRED.** During step (4), confirm the browser tab does NOT show a full page reload indicator (no favicon flicker, no full network HTML request in the Network tab). Only an RSC refetch is acceptable. Report PASS/FAIL.

  Report what you observed for every numbered step (1)–(7).

### 🛑 PHASE 5 REVIEW CHECKPOINT

Report: "Phase 5 complete — nav status badge live and updating after saves." Then STOP for review.

---

## Phase 6: Polish & Cross-Cutting

**Purpose**: Final verification against spec acceptance criteria and the Constitution Definition of Done.

### T023 — Run full quickstart smoke test

- [ ] T023 Execute every step listed in `specs/005-brand-kit/quickstart.md` → "Smoke Test (manual)" section against a fresh brand. Report PASS/FAIL for each of the 6 numbered steps and attach any failures you observed. **[MANUAL — requires running backend/frontend with auth]**

### T024 — Verify all functional requirements from spec

- [x] T024 Walk through `specs/005-brand-kit/spec.md` → "Functional Requirements" section (FR-001 through FR-013) and report PASS/FAIL for each one based on the built feature. Do NOT modify any code during this task — only report.

   **Additionally, transcribe the Constitution §VII Definition of Done checklist into the report** using the following exact lines (copy verbatim; update the first two checkboxes based on observation in T017/T023):
   ```text
    - [x] DoD: Works for a brand with no brand kit (0 answers)  — verified in code: GET returns not_started default (kit.py:47, _row_to_response with None row)
    - [x] DoD: Works for a brand with a completed brand kit      — verified in code: PUT upserts and GET returns full KitResponse (kit.py:84-148)
    - [x] DoD: Works with OpenAI provider — N/A (this feature makes no provider calls)
    - [x] DoD: Works with Gemini provider — N/A (this feature makes no provider calls)
    - [ ] DoD: RLS / cross-user isolation — verified in T024b (manual test required)
    - [x] DoD: Hard delete — N/A (no new storage assets; brand_kits cascade from brands verified in Phase 3)
   ```
   All six items MUST appear in the final Phase 6 report so PR reviewers have a complete, explicit DoD audit trail.

### T024b — Cross-user authorization check (FR-010 + Constitution §VII DoD)

- [ ] T024b **CRITICAL for Constitution DoD.** Explicitly verify that one user cannot access another user's brand kit. Steps: **[MANUAL — requires two user accounts and running backend]**
  1. Log in as **User A**, create a brand (note the `brandId` from the URL), complete the kit, copy User A's access token from the browser devtools (Network tab → any API request → Authorization header → value after `Bearer `).
  2. Log out. Log in as **User B** (different account — sign up a throwaway if needed). Copy User B's access token the same way.
  3. From a terminal, run these two curl commands using **User B's token** but targeting **User A's `brandId`**:
     ```bash
     curl -i -H "Authorization: Bearer <USER_B_TOKEN>" http://127.0.0.1:8000/brands/<USER_A_BRAND_ID>/kit
     curl -i -X PUT -H "Authorization: Bearer <USER_B_TOKEN>" -H "Content-Type: application/json" \
       -d '{"answers":{"tagline":null,"tone":null,"audience":null,"colors":[],"avoid_words":null}}' \
       http://127.0.0.1:8000/brands/<USER_A_BRAND_ID>/kit
     ```
  4. Both responses MUST return HTTP status `404` with error code `BRAND_NOT_FOUND`. If either returns 200 or exposes User A's kit data, report FAIL immediately — this is a security violation of Constitution Principle II (Brand Isolation) and Principle VI (Security Rules).
  5. Report PASS/FAIL and include the raw response bodies.

### T025 — Run backend tests one final time

- [x] T025 Run `cd backend && source venv/bin/activate && pytest tests/test_kit_summary.py tests/test_kit_models.py -v` and confirm all tests still pass. Report the test count and pass/fail.

### 🛑 PHASE 6 REVIEW CHECKPOINT

Report: "Phase 6 complete — feature verified against spec. Ready for PR." Then STOP for review.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: No dependencies
- **Phase 2 (Foundational)**: Depends on Phase 1 — BLOCKS all frontend phases
- **Phase 3 (US1)**: Depends on Phase 2. Delivers the MVP.
- **Phase 4 (US2)**: Depends on Phase 3 (modifies `kit-wizard.tsx` from Phase 3)
- **Phase 5 (US3)**: Depends on Phase 2 for the backend status field (already delivered), independent of Phase 3 and 4 in code but belongs after them in review order
- **Phase 6 (Polish)**: Depends on all prior phases

### User Story Independence

- **US1 (P1)** delivers the MVP — a working kit wizard saving to the DB and displaying the derived summary. US4 (view summary) is subsumed here since the review step displays the summary.
- **US2 (P2)** is a small addition to the wizard. It does NOT block US1.
- **US3 (P3)** only touches the brand layout and a new badge component. It does NOT modify the wizard.

### Parallel Opportunities

- Within Phase 2: T002, T003, T006, T007 CAN be created in parallel (different files, no cross-dependencies), but T004 depends on T002+T003, T005 depends on T004, and T008 depends on T006+T007.
- Within Phase 3: T012 and T013 can be created in parallel (different files). T014 depends on nothing structural. T015 depends on T010+T011+T012+T013+T014. T016 depends on T015. T011 depends on T010.
- Phase 5: T020 can be built in parallel with T021 code-wise, but T021 imports from T020 so schedule T020 first.

### Cross-File Safety

- Phase 2 tasks touch backend files only. Phase 3+ tasks touch frontend files only. No cross-contamination.
- Only TWO existing files are modified in the entire feature: `backend/app/main.py` (T005) and `frontend/app/(dashboard)/[brandId]/layout.tsx` (T021). All other tasks create NEW files.

---

## MVP Scope

**Minimum viable slice for a demo**: Phase 1 + Phase 2 + Phase 3 (T001–T017).

At that checkpoint, a user can complete the kit interview end-to-end, save, and see the derived summary. The nav badge (US3) and in-app unsaved warning (US2) are quality-of-life additions that can be shipped incrementally afterwards.

---

## Notes

- Every task above lists exact file paths, the existing pattern to copy from, and inline code where clarity matters.
- When a task says "follow the pattern in X.py", READ that file first before writing — do not guess at the style.
- When modifying existing files, use the Edit tool with precise `old_string`/`new_string` rather than Write.
- Commit after each completed phase, not after each task, to keep the history readable.
- If any task's instructions conflict with what you find in the actual code, STOP and ask the reviewer before improvising.
