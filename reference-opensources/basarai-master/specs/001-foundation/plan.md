# Implementation Plan: Foundation

**Branch**: `001-foundation` | **Date**: 2026-02-08 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/001-foundation/spec.md`

## Summary

Set up the complete foundation for Basar AI: repository structure (frontend, backend, supabase), full database schema with 5 tables and RLS, FastAPI backend with JWT auth middleware and profile endpoints, Next.js 14 frontend with Supabase auth (sign-up, login, logout, protected routes), and an account settings page for profile management. This phase establishes the scaffolding every subsequent feature builds upon.

## Technical Context

**Language/Version**: Python 3.13 (backend), TypeScript 5.x (frontend)
**Primary Dependencies**: FastAPI 0.109+, Next.js 14 (App Router), @supabase/ssr, @supabase/supabase-js, PyJWT, supabase-py, shadcn/ui, Tailwind CSS
**Storage**: Supabase PostgreSQL (with RLS), Supabase Storage (brand-assets bucket), Supabase Vault (provider key secrets)
**Testing**: pytest + pytest-asyncio (backend), manual verification (frontend Phase 1)
**Target Platform**: Containerized Linux server (Bunny Magic), web browsers
**Project Type**: Web application (frontend + backend + database migrations)
**Performance Goals**: Health endpoint < 2s response, profile operations < 30s user-perceived, auth redirects immediate
**Constraints**: Minimum 30s timeout for any network/API calls, single-container deployment, BYOK model (no billing)
**Scale/Scope**: MVP for single-user brand management, 5 database tables, 3 API endpoints (health, GET /me, PATCH /me), 4 frontend pages (login, signup, dashboard, account settings)

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

The project constitution file is a blank template (not yet configured with project-specific principles). No gates to evaluate. Proceeding with standard best practices.

**Post-Phase 1 re-check**: No violations. The design follows standard patterns:
- Single web application structure (frontend + backend + migrations)
- Direct database access via Supabase client (no unnecessary abstraction layers)
- Minimal dependencies for the scope

## Project Structure

### Documentation (this feature)

```text
specs/001-foundation/
├── plan.md              # This file
├── spec.md              # Feature specification
├── research.md          # Phase 0: technology research decisions
├── data-model.md        # Phase 1: entity definitions and relationships
├── quickstart.md        # Phase 1: local development setup guide
├── contracts/
│   └── api.yaml         # Phase 1: OpenAPI spec for Phase 1 endpoints
├── checklists/
│   └── requirements.md  # Spec quality checklist
└── tasks.md             # Phase 2 output (created by /speckit.tasks)
```

### Source Code (repository root)

```text
backend/
├── app/
│   ├── __init__.py
│   ├── main.py                     # FastAPI app, CORS, lifespan, router registration
│   ├── config.py                   # Pydantic Settings from env vars
│   ├── core/
│   │   ├── __init__.py
│   │   ├── auth.py                 # JWT verification, get_current_user dependency
│   │   └── supabase.py             # Singleton Supabase clients (service-role + user-scoped)
│   ├── models/
│   │   ├── __init__.py
│   │   └── profile.py              # Pydantic models for profile request/response
│   └── routers/
│       ├── __init__.py
│       ├── health.py               # GET /health (no auth)
│       └── me.py                   # GET /me, PATCH /me (auth required)
├── tests/
│   ├── conftest.py
│   └── test_health.py
├── requirements.txt
└── .env.example

frontend/
├── app/
│   ├── layout.tsx                  # Root layout (fonts, globals)
│   ├── page.tsx                    # Landing redirect (→ login or dashboard)
│   ├── (auth)/
│   │   ├── layout.tsx              # Auth layout (no nav)
│   │   ├── login/
│   │   │   └── page.tsx            # Login form
│   │   └── signup/
│   │       └── page.tsx            # Signup form
│   ├── auth/
│   │   └── confirm/
│   │       └── route.ts            # Email verification callback
│   └── (dashboard)/
│       ├── layout.tsx              # Dashboard layout (nav)
│       └── account/
│           └── page.tsx            # Account settings (profile edit)
├── components/
│   ├── ui/                         # shadcn/ui components (button, input, card, form, etc.)
│   └── account/
│       └── profile-form.tsx        # Profile edit form component
├── lib/
│   ├── supabase/
│   │   ├── client.ts               # Browser Supabase client (createBrowserClient)
│   │   └── server.ts               # Server Supabase client (createServerClient)
│   ├── api.ts                      # Fetch wrapper for backend API calls
│   └── utils.ts                    # cn() utility for shadcn/ui
├── hooks/
│   └── use-profile.ts              # Profile data fetching hook
├── types/
│   └── index.ts                    # TypeScript type definitions
├── middleware.ts                   # Auth middleware (route protection, session refresh)
├── next.config.mjs                 # API rewrites to FastAPI backend
├── tailwind.config.ts
├── components.json                 # shadcn/ui config
├── package.json
├── tsconfig.json
└── .env.local.example

supabase/
├── migrations/
│   ├── 00001_extensions_types_helpers.sql    # pgcrypto, enums, set_updated_at(), all_hex_colors()
│   ├── 00002_create_profiles.sql             # profiles table
│   ├── 00003_create_brands.sql               # brands table + indexes
│   ├── 00004_create_brand_kits.sql           # brand_kits table + constraints
│   ├── 00005_create_provider_keys.sql        # provider_keys table + partial unique index
│   ├── 00006_create_generations.sql          # generations table + status constraints + indexes
│   ├── 00007_add_updated_at_triggers.sql     # updated_at triggers for all 5 tables
│   ├── 00008_add_rls_policies.sql            # is_brand_owner(), RLS enable/force, all policies
│   ├── 00009_create_storage_bucket.sql       # brand-assets bucket + storage RLS policies
│   └── 00010_auto_create_profile_trigger.sql # handle_new_user() trigger on auth.users INSERT
└── config.toml
```

**Structure Decision**: Web application with `backend/`, `frontend/`, and `supabase/` directories at the repository root. This matches the implementation plan's architecture (FastAPI + Next.js + Supabase). The backend uses a domain-based layout under `app/` with `core/`, `models/`, and `routers/` subdirectories. Services (`storage.py`, `vault.py`, `providers/`) are defined in the plan but created in later phases when needed.

## Key Design Decisions

### Authentication Flow

1. **Frontend**: Supabase Auth via `@supabase/ssr`. Login/signup pages use `signInWithPassword()` / `signUp()`.
2. **Email verification**: Supabase sends confirmation email. User clicks link → `app/auth/confirm/route.ts` exchanges code for session via `verifyOtp()`.
3. **Session management**: Cookie-based via `@supabase/ssr`. Middleware refreshes tokens on every request using `getUser()` (not `getSession()`).
4. **Backend auth**: FastAPI receives JWT in `Authorization: Bearer <token>` header. `PyJWT` decodes using `SUPABASE_JWT_SECRET` (HS256). No network call needed.
5. **Profile auto-creation**: Database trigger on `auth.users` INSERT creates `profiles` row via `SECURITY DEFINER` function.

### API Proxy

Next.js `rewrites` in `next.config.mjs` proxies `/api/*` to `http://127.0.0.1:8000/*`. From the browser's perspective, all requests are same-origin. CORS is configured as fallback for development scenarios.

### Supabase Client Strategy (Backend)

- **Service-role client** (`get_service_client()`): Singleton, bypasses RLS. Used for operations requiring full access (e.g., admin queries, profile creation fallback).
- **User-scoped client** (`get_user_client(access_token)`): Created per-request with user's JWT. Respects RLS. Used for user-initiated operations.
- Both share a single `httpx.Client` instance for connection pooling.

### Database Migration Order

Migrations are numbered sequentially and must run in order:
1. Extensions and types first (required by all tables)
2. Tables in dependency order (profiles → brands → brand_kits/provider_keys/generations)
3. Triggers after tables
4. RLS policies after triggers (depends on `is_brand_owner` function)
5. Storage bucket and profile trigger last

## Complexity Tracking

No constitution violations to justify. The design uses standard patterns with minimal complexity.

## Phase 1 Artifacts

| Artifact | Path | Description |
|----------|------|-------------|
| research.md | `specs/001-foundation/research.md` | 10 technology decisions with rationale |
| data-model.md | `specs/001-foundation/data-model.md` | 5 entities, relationships, RLS policies |
| api.yaml | `specs/001-foundation/contracts/api.yaml` | OpenAPI spec for 3 endpoints |
| quickstart.md | `specs/001-foundation/quickstart.md` | Local development setup guide |
