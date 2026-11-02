# Implementation Plan: Brand Management

**Branch**: `003-brand-crud` | **Date**: 2026-03-07 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/003-brand-crud/spec.md`

## Summary

This feature adds complete brand CRUD operations to Basar AI. Users can create brands (with name validation and case-insensitive uniqueness), view and switch between brands, upload/remove/replace logos (resized to 512x512 on upload), rename brands, and permanently delete brands with full cascade cleanup of all associated storage files, Vault secrets, and database rows. The backend exposes 7 REST endpoints via FastAPI; the frontend provides a brand list page, brand selector in navigation, settings page, and modal dialogs for creation and deletion confirmation.

## Technical Context

**Language/Version**: Python 3.13 (backend), TypeScript 5.x (frontend)
**Primary Dependencies**: FastAPI 0.109+, Pydantic 2.x, Pillow 10+ (new — for logo resize), supabase-py 2.3+, Next.js 14 (App Router), @supabase/ssr, shadcn/ui, Tailwind CSS, zod, react-hook-form
**Storage**: Supabase (PostgreSQL) for data, Supabase Storage (`brand-assets` bucket) for logos
**Testing**: pytest with FastAPI TestClient (backend), manual testing (frontend)
**Target Platform**: Docker container (Bunny Magic), serves both frontend and backend
**Project Type**: Web application (FastAPI backend + Next.js frontend)
**Performance Goals**: Brand list in <2s, logo upload in <5s, brand delete in <10s (per spec SC-001 through SC-005)
**Constraints**: Hard delete only (no soft delete), brand isolation via RLS + app-level checks, logos max 512x512 px, SVG excluded (security risk)
**Scale/Scope**: Up to 50 brands per user, 7 API endpoints, ~12 frontend files to create/modify

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Product Truth — Brand-based tenancy | PASS | Every endpoint scopes data to the brand owned by the current user. |
| I. Product Truth — Owner role only | PASS | Single owner per brand. No sharing. |
| II. Hard Delete | PASS | `DELETE /brands/{id}` removes DB rows (cascade) + storage files + Vault secrets. No soft delete. |
| II. Brand Isolation | PASS | RLS on DB. Ownership check in backend. 404 response for unauthorized access (no info leakage). |
| II. Key Secrecy | PASS | During brand delete, Vault secret IDs are used to delete secrets. Raw keys never logged or returned. |
| III. Tech Constraints — Stack | PASS | FastAPI backend, Next.js 14 frontend, Supabase for DB/storage/auth. No deviations. |
| IV. Data Rules — Provider Keys | PASS | Brand delete cascade removes `provider_keys` rows. Vault secrets deleted explicitly before cascade. |
| V. UX Rules | PASS | Not directly applicable to brand CRUD (UX rules focus on generation and brand kit). |
| VI. Security — RLS enabled | PASS | RLS already enabled on `brands` table (migration 00008). |
| VI. Security — Server-side brand ID verification | PASS | All endpoints verify `owner_user_id = current_user.id` before any operation. |
| VI. Security — No keys/PII in logs | PASS | Only request IDs and brand IDs logged. No user data or keys. |
| VII. Definition of Done — Brand kit 0 answers | PASS | Brand CRUD works independently of brand kit. `kit_status` defaults to `"not_started"`. |
| VII. Definition of Done — RLS tested | WILL VERIFY | Backend tests will include ownership verification scenarios. |
| VII. Definition of Done — Hard delete verified | WILL VERIFY | Tests will confirm DB rows and storage files are removed after delete. |

**Gate result: PASS** — No violations. Two items flagged for verification during implementation.

## Project Structure

### Documentation (this feature)

```text
specs/003-brand-crud/
├── plan.md              # This file
├── spec.md              # Feature specification
├── research.md          # Research decisions
├── data-model.md        # Data model documentation
├── quickstart.md        # Developer quickstart guide
├── contracts/
│   └── api.md           # API endpoint contracts
├── checklists/
│   └── requirements.md  # Spec quality checklist
└── tasks.md             # Task list (created by /speckit.tasks)
```

### Source Code (repository root)

```text
supabase/
└── migrations/
    └── 00011_remove_svg_from_storage_bucket.sql  # NEW: remove SVG from allowed MIME types

backend/
├── app/
│   ├── main.py              # MODIFY: add brands router
│   ├── config.py             # NO CHANGE
│   ├── core/
│   │   ├── auth.py           # NO CHANGE (use get_current_user)
│   │   └── supabase.py       # NO CHANGE (use get_service_client)
│   ├── models/
│   │   ├── profile.py        # NO CHANGE
│   │   └── brand.py          # NEW: Brand Pydantic models
│   └── routers/
│       ├── health.py         # NO CHANGE
│       ├── me.py             # NO CHANGE
│       └── brands.py         # NEW: Brand CRUD endpoints (7 routes)
├── requirements.txt          # MODIFY: add Pillow>=10.0.0
└── tests/
    ├── conftest.py           # NO CHANGE
    └── test_brands.py        # NEW: Brand endpoint tests

frontend/
├── app/
│   ├── (dashboard)/
│   │   ├── layout.tsx                # MODIFY: add brand selector to nav
│   │   ├── brands/
│   │   │   └── page.tsx              # MODIFY: replace placeholder with real brand list
│   │   └── [brandId]/
│   │       ├── layout.tsx            # NEW: brand-specific layout
│   │       ├── page.tsx              # NEW: brand main view (placeholder for generator)
│   │       └── settings/
│   │           └── page.tsx          # NEW: brand settings (rename, logo, delete)
├── components/
│   ├── brand-selector.tsx            # NEW: dropdown brand switcher in nav
│   └── brand/
│       ├── brand-card.tsx            # NEW: brand card for list page
│       ├── create-brand-modal.tsx    # NEW: create brand modal dialog
│       └── delete-brand-dialog.tsx   # NEW: delete confirmation (type name)
├── hooks/
│   ├── use-brands.ts                # NEW: fetch brand list
│   └── use-brand.ts                 # NEW: fetch/rename/delete single brand
└── types/
    └── index.ts                     # MODIFY: add Brand types
```

**Structure Decision**: Web application with separate backend and frontend directories (existing convention from Phase 1). No new directories at root level. New files follow existing naming conventions (`kebab-case` for files, router modules in `backend/app/routers/`, Pydantic models in `backend/app/models/`).

## Complexity Tracking

No constitution violations to justify. All complexity is within normal bounds for a CRUD feature.
