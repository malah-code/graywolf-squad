# Implementation Plan: Provider Keys

**Branch**: `004-provider-keys` | **Date**: 2026-03-29 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/004-provider-keys/spec.md`

## Summary

Implement BYOK (Bring Your Own Key) management for AI image generation providers (OpenAI, Gemini). Users can add, list, validate, activate, and delete API keys per brand. Keys are stored in Supabase Vault with only opaque references and masked hints in the application database. The feature includes a FastAPI backend with 5 endpoints and a Next.js frontend with tabbed key management, add-key modal, and key cards with inline actions.

## Technical Context

**Language/Version**: Python 3.13 (backend), TypeScript 5.x (frontend)
**Primary Dependencies**: FastAPI 0.109+, Pydantic 2.x, supabase-py 2.3+, httpx (async HTTP for provider validation), Next.js 14 (App Router), @supabase/ssr, shadcn/ui, Tailwind CSS, zod, react-hook-form
**Storage**: Supabase PostgreSQL (`provider_keys` table, already migrated), Supabase Vault (encrypted key storage via RPC wrappers)
**Testing**: pytest (backend), manual verification (frontend)
**Target Platform**: Bunny Magic Container (single Docker image)
**Project Type**: Web service (SaaS)
**Performance Goals**: Key add < 3s, validation < 15s, list/activate/delete < 2s
**Constraints**: Keys never in logs/responses/client state; vault operations via service_role only
**Scale/Scope**: Single-user per brand, low concurrency; 5 backend endpoints, 1 frontend page with 3 component types

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Product Truth — Brand tenancy | PASS | All key operations scoped to `brand_id` |
| I. Product Truth — Owner only | PASS | Brand ownership verified server-side |
| I. Product Truth — BYOK | PASS | This feature implements the BYOK model |
| II. Non-Negotiable — Brand isolation | PASS | RLS + server-side ownership check |
| II. Non-Negotiable — Hard delete | PASS | Key deletion removes DB row + Vault secret |
| II. Non-Negotiable — Key secrecy | PASS | Vault storage; hint-only in responses; never logged |
| II. Non-Negotiable — Official endpoints | PASS | Validation uses official OpenAI/Gemini endpoints |
| III. Tech Constraints | PASS | FastAPI + Next.js 14 + Supabase Vault stack |
| IV. Data Rules — Provider keys in Vault | PASS | `vault_secret_id` reference only in DB |
| VI. Security — RLS enabled | PASS | `provider_keys_owner_all` policy exists |
| VI. Security — Server-side brand ID check | PASS | `_get_brand_or_404` pattern from brands router |
| VI. Security — Server-only provider calls | PASS | Validation calls from backend only |
| VI. Security — No keys/PII in logs | PASS | Key value never logged; only request IDs |
| VII. DoD — Works with 0 kit answers | PASS | Keys are independent of brand kit |
| VII. DoD — Works with complete kit | PASS | Keys are independent of brand kit |
| VII. DoD — OpenAI provider | PASS | Validation endpoint for OpenAI implemented |
| VII. DoD — Gemini provider | PASS | Validation endpoint for Gemini implemented |
| VII. DoD — RLS tested | PASS | Cross-brand access returns 404 |
| VII. DoD — Hard delete verified | PASS | DB row + Vault secret both removed |

**Post-Phase 1 re-check**: All gates still pass. Vault RPC functions are `SECURITY DEFINER` with access restricted to `service_role`. The `httpx` client for validation uses 30s timeout per CLAUDE.md constraints.

## Project Structure

### Documentation (this feature)

```text
specs/004-provider-keys/
├── plan.md              # This file
├── spec.md              # Feature specification
├── research.md          # Phase 0: Vault, validation, HTTP client research
├── data-model.md        # Phase 1: Entity model and state transitions
├── quickstart.md        # Phase 1: Developer setup guide
├── contracts/
│   └── api.md           # Phase 1: API endpoint contracts
├── checklists/
│   └── requirements.md  # Spec quality checklist
└── tasks.md             # Phase 2: Task breakdown (created by /speckit.tasks)
```

### Source Code (repository root)

```text
backend/
├── app/
│   ├── routers/
│   │   └── keys.py              # NEW: Provider keys API endpoints
│   ├── models/
│   │   └── provider_key.py      # NEW: Pydantic request/response models
│   ├── core/
│   │   ├── vault.py             # NEW: Supabase Vault RPC wrapper
│   │   ├── supabase.py          # EXISTING: Service client
│   │   └── auth.py              # EXISTING: JWT auth
│   └── services/
│       └── provider_validation.py # NEW: OpenAI/Gemini key validation
│   └── main.py                  # MODIFY: Register keys router

frontend/
├── app/
│   └── (dashboard)/
│       └── [brandId]/
│           └── keys/
│               └── page.tsx     # NEW: Keys management page
├── components/
│   └── keys/
│       ├── key-card.tsx         # NEW: Individual key display card
│       ├── add-key-modal.tsx    # NEW: Modal form for adding keys
│       └── provider-tabs.tsx    # NEW: Tabs to switch provider view
├── hooks/
│   └── use-keys.ts             # NEW: Key data fetching hook
└── types/
    └── index.ts                # MODIFY: Add ProviderKey types

supabase/
└── migrations/
    └── 00012_vault_secret_helpers.sql  # NEW: Vault RPC functions
```

**Structure Decision**: Follows the established web application structure (backend/ + frontend/ + supabase/). New files mirror existing patterns: router in `routers/`, models in `models/`, core utilities in `core/`, service logic in `services/`. Frontend follows the existing `(dashboard)/[brandId]/` route pattern.

## Complexity Tracking

> No constitution violations to justify. All gates pass.
