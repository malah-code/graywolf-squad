# Tasks: Foundation

**Input**: Design documents from `/specs/001-foundation/`
**Prerequisites**: plan.md (required), spec.md (required), research.md, data-model.md, contracts/api.yaml

**Tests**: Not explicitly requested in the feature specification. Test tasks are omitted.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3, US4)
- Include exact file paths in descriptions

## Path Conventions

- **Backend**: `backend/app/`
- **Frontend**: `frontend/`
- **Migrations**: `supabase/migrations/`

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization, directory structure, and dependency configuration

- [X] T001 Create root directory structure with `backend/`, `frontend/`, and `supabase/` directories per plan.md
- [X] T002 [P] Initialize FastAPI project: create `backend/requirements.txt` with dependencies (fastapi, uvicorn, pydantic, pydantic-settings, PyJWT, supabase, python-dotenv, httpx) and `backend/.env.example` with all required env vars (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY, SUPABASE_JWT_SECRET, STORAGE_BUCKET, ADMIN_EMAILS, HOST, PORT)
- [X] T003 [P] Initialize Next.js 14 project in `frontend/`: run `npx create-next-app@14` with App Router, TypeScript, Tailwind CSS, and ESLint. Install `@supabase/supabase-js` and `@supabase/ssr`. Create `frontend/.env.local.example` with NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, NEXT_PUBLIC_API_URL, NEXT_SERVER_API_URL
- [X] T004 [P] Initialize shadcn/ui in `frontend/`: run `npx shadcn@latest init` with default style, then add components: button, input, label, card, form, toast, separator. Create `frontend/lib/utils.ts` with cn() utility
- [X] T005 [P] Initialize Supabase project: create `supabase/config.toml` with project configuration
- [X] T006 [P] Create backend app skeleton: `backend/app/__init__.py`, `backend/app/core/__init__.py`, `backend/app/models/__init__.py`, `backend/app/routers/__init__.py`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Database schema, backend framework, and frontend framework that MUST be complete before ANY user story

**Warning**: No user story work can begin until this phase is complete

### Database Schema & Migrations

- [X] T007 Create migration `supabase/migrations/00001_extensions_types_helpers.sql`: enable pgcrypto extension, create all 6 enum types (provider_t, tone_t, logo_mode_t, kit_status_t, generation_status_t, platform_preset_t), create set_updated_at() trigger function, and create all_hex_colors() validation function per data-model.md
- [X] T008 Create migration `supabase/migrations/00002_create_profiles.sql`: create profiles table with user_id PK, full_name, avatar_url, created_at, updated_at per data-model.md
- [X] T009 Create migration `supabase/migrations/00003_create_brands.sql`: create brands table with id, owner_user_id, name, logo_path, timestamps, plus uq_brands_owner_name_ci and idx_brands_owner_created indexes per data-model.md
- [X] T010 Create migration `supabase/migrations/00004_create_brand_kits.sql`: create brand_kits table with all fields, CHECK constraints for status/completion consistency, colors validation per data-model.md
- [X] T011 Create migration `supabase/migrations/00005_create_provider_keys.sql`: create provider_keys table with all fields, partial unique index uq_provider_keys_one_active, and idx_provider_keys_lookup per data-model.md
- [X] T012 Create migration `supabase/migrations/00006_create_generations.sql`: create generations table with all fields, status-dependent CHECK constraints (succeeded/failed/pending/processing), and all 3 indexes per data-model.md
- [X] T013 Create migration `supabase/migrations/00007_add_updated_at_triggers.sql`: add BEFORE UPDATE triggers calling set_updated_at() for all 5 tables (profiles, brands, brand_kits, provider_keys, generations)
- [X] T014 Create migration `supabase/migrations/00008_add_rls_policies.sql`: create is_brand_owner() SECURITY DEFINER function, ENABLE and FORCE RLS on all 5 tables, create all SELECT/INSERT/UPDATE/DELETE policies per data-model.md (profiles uses user_id = auth.uid(), brand-scoped tables use is_brand_owner())
- [X] T015 Create migration `supabase/migrations/00009_create_storage_bucket.sql`: insert brand-assets public bucket with 5MB file size limit and allowed MIME types, create storage RLS policies (public read, owner-only write/update/delete using storage.foldername()) per research.md
- [X] T016 Create migration `supabase/migrations/00010_auto_create_profile_trigger.sql`: create handle_new_user() SECURITY DEFINER function that inserts into profiles on auth.users INSERT, extracting full_name and avatar_url from raw_user_meta_data with ON CONFLICT DO NOTHING per research.md

### Supabase Auth Configuration

- [X] T016b Configure Supabase Auth email settings: set Site URL to http://localhost:3000, add http://localhost:3000/auth/confirm to Redirect URLs. For local Supabase, update `supabase/config.toml` with site_url and redirect_urls under [auth]. For remote Supabase, configure via Dashboard > Authentication > URL Configuration. This ensures email confirmation links route correctly per FR-002

### Backend Framework

- [X] T017 Create `backend/app/config.py`: Pydantic Settings class with SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY, SUPABASE_JWT_SECRET, STORAGE_BUCKET, ADMIN_EMAILS, HOST, PORT. Load from .env file
- [X] T018 [P] Create `backend/app/core/supabase.py`: singleton get_service_client() with @lru_cache and shared httpx.Client(timeout=30.0), plus get_user_client(access_token) factory for user-scoped RLS-respecting operations per research.md
- [X] T019 [P] Create `backend/app/core/auth.py`: HTTPBearer security scheme, User pydantic model (id, email, access_token), get_current_user() dependency that decodes JWT with PyJWT using HS256 and audience="authenticated", extracting sub and email claims. Include get_current_admin_user() dependency checking ADMIN_EMAILS per research.md and contracts/api.yaml
- [X] T020 Create `backend/app/main.py`: FastAPI app with lifespan, CORSMiddleware (origins: localhost:3000, 127.0.0.1:3000, localhost; allow_credentials=True), register health and me routers per research.md

### Frontend Framework

- [X] T021 Create `frontend/lib/supabase/client.ts`: export createClient() using createBrowserClient from @supabase/ssr with NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY per research.md
- [X] T022 [P] Create `frontend/lib/supabase/server.ts`: export async createClient() using createServerClient from @supabase/ssr with cookies() getAll/setAll pattern per research.md
- [X] T023 [P] Create `frontend/lib/api.ts`: fetch wrapper for backend API calls. In client components, obtain the access token via `supabase.auth.getSession()` and pass it as `Authorization: Bearer <token>` header to /api/* endpoints. Handle 401 responses by calling `supabase.auth.signOut()` and redirecting to /login via `window.location.href`
- [X] T024 [P] Create `frontend/types/index.ts`: TypeScript type definitions for Profile (user_id, email, full_name, avatar_url, created_at, updated_at), UpdateProfileRequest (full_name?, avatar_url?), ErrorResponse (error.code, error.message, error.request_id) per contracts/api.yaml
- [X] T025 Configure `frontend/next.config.mjs`: add rewrites() rule proxying `/api/:path*` to `http://127.0.0.1:8000/:path*` per research.md

**Checkpoint**: Foundation ready — database schema applied, backend framework running with CORS and auth middleware, frontend framework initialized with Supabase clients and API proxy. User story implementation can now begin.

---

## Phase 3: User Story 1 + User Story 4 — Sign Up, Log In, and Data Isolation (Priority: P1) MVP

**Goal**: Users can sign up with email/password, verify their email, log in, access the protected dashboard, and log out. Data isolation ensures no cross-user access.

**Independent Test**: Visit the app, create an account, confirm email, log in, see the dashboard. Try accessing dashboard while logged out — get redirected. Create two users and verify neither can see the other's profile data.

### Implementation

- [X] T026 Create `frontend/middleware.ts`: auth middleware using createServerClient from @supabase/ssr that refreshes sessions via getUser() (NOT getSession()), redirects unauthenticated users from dashboard routes (/*) to /login, and redirects authenticated users from /login and /signup to /brands. Use matcher excluding _next/static, _next/image, favicon, and static assets per research.md
- [X] T027 [P] [US1] Create `frontend/app/layout.tsx`: root layout with HTML lang, body with globals.css and font configuration
- [X] T028 [P] [US1] Create `frontend/app/(auth)/layout.tsx`: auth layout without navigation, centered content wrapper for login/signup forms
- [X] T029 [US1] Create `frontend/app/(auth)/login/page.tsx`: client component login form with email and password fields using shadcn/ui Input, Button, Card components. Call supabase.auth.signInWithPassword(), show error messages, redirect to /brands on success via router.push() and router.refresh() per research.md. Include link to signup page
- [X] T030 [P] [US1] Create `frontend/app/(auth)/signup/page.tsx`: client component signup form with email and password fields. Call supabase.auth.signUp() with emailRedirectTo pointing to /auth/confirm. Show success message "Check your email to confirm your account". Include link to login page per research.md
- [X] T031 [US1] Create `frontend/app/auth/confirm/route.ts`: GET route handler that extracts token_hash and type from URL params, creates server Supabase client, calls verifyOtp({ type, token_hash }), and redirects to /brands on success or /login on error per research.md
- [X] T032 [US1] Create `frontend/app/(dashboard)/layout.tsx`: dashboard layout with navigation bar containing app name, account link, and logout button. Logout calls supabase.auth.signOut() and redirects to /login via router.push() and router.refresh()
- [X] T033 [US1] Create `frontend/app/page.tsx`: landing page that checks auth state via server Supabase client getUser() and redirects to /brands (authenticated) or /login (unauthenticated)
- [X] T034 [US4] Verify RLS data isolation by confirming migration 00008 policies are correctly defined: profiles uses user_id = auth.uid() for all operations, brand-scoped tables use is_brand_owner(brand_id). No additional code needed — RLS is enforced at database layer

**Checkpoint**: User Story 1 (Sign Up/Login) and User Story 4 (Data Isolation) are complete. Users can register, verify email, log in, access the dashboard, and log out. RLS prevents cross-user data access at the database layer.

---

## Phase 4: User Story 2 — View and Edit Profile (Priority: P2)

**Goal**: Authenticated users can view their profile (email, full name, avatar URL) on an account settings page and update their full name and avatar URL with validation.

**Independent Test**: Log in, navigate to account settings, see email displayed as read-only, update full name to "Test User", save, reload page, confirm name persists. Try saving a 1-character name — get validation error. Try saving an invalid avatar URL — get validation error.

### Backend Implementation

- [X] T035 [P] [US2] Create `backend/app/models/profile.py`: Pydantic models ProfileResponse (user_id, email, full_name, avatar_url, created_at, updated_at) and UpdateProfileRequest (optional full_name with min 2 / max 120 length, optional avatar_url with HttpUrl or regex ^https?://.+ validation) per contracts/api.yaml
- [X] T036 [US3] Create `backend/app/routers/health.py`: GET /health endpoint returning {"status": "healthy", "timestamp": "..."} with no auth required per contracts/api.yaml. Note: built here alongside US2 backend setup for efficiency; serves US3 (System Health Verification)
- [X] T037 [US2] Create `backend/app/routers/me.py`: GET /me endpoint using get_current_user dependency, querying profiles table via service client filtered by current_user.id. Email comes from the JWT claims (current_user.email already extracted in auth.py) — do NOT join auth.users table. PATCH /me endpoint validating UpdateProfileRequest body, updating profiles row, returning updated ProfileResponse. Return error format {"error": {"code": "...", "message": "...", "request_id": "..."}} for validation failures per contracts/api.yaml
- [X] T038 [US2] Register health and me routers in `backend/app/main.py`: include health.router (no prefix, tags=["health"]) and me.router (no prefix, tags=["account"]). Important: FastAPI routers must NOT use a /api prefix — the Next.js rewrite in next.config.js strips /api/ and forwards to the backend root (e.g., browser calls /api/me → FastAPI receives /me)

### Frontend Implementation

- [X] T039 [P] [US2] Create `frontend/hooks/use-profile.ts`: hook that fetches GET /api/me with auth token, returns profile data, loading state, and error state. Include mutate function for optimistic updates after PATCH
- [X] T040 [US2] Create `frontend/components/account/profile-form.tsx`: form component displaying email as read-only text, full_name and avatar_url as editable Input fields with validation (full_name 2-120 chars, avatar_url must be valid URL or empty). Submit calls PATCH /api/me. Show validation errors inline. Show success toast on save per spec.md acceptance scenarios
- [X] T041 [US2] Create `frontend/app/(dashboard)/account/page.tsx`: account settings page using profile-form component. Page title "Account Settings". Fetch profile data via use-profile hook

**Checkpoint**: User Story 2 (Profile Management) is complete. Users can view and edit their profile. Validation is enforced both client-side and server-side. Backend health endpoint is also operational.

---

## Phase 5: User Story 3 — System Health Verification (Priority: P3)

**Goal**: An operator or monitoring system can verify the backend is running via an unauthenticated health endpoint.

**Independent Test**: Send `curl http://127.0.0.1:8000/health` and verify it returns `{"status": "healthy", "timestamp": "..."}` with HTTP 200.

### Implementation

- [X] T042 [US3] Verify health endpoint works end-to-end: start backend with `uvicorn app.main:app`, send GET /health request, confirm 200 response with healthy status and timestamp. This validates T036 and T038 are correctly implemented (health router was created in Phase 4 as part of backend setup for profile endpoints)

**Checkpoint**: User Story 3 (Health Check) is complete. The health endpoint responds without authentication.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Final verification, cleanup, and edge case handling

- [X] T043 [P] Create `backend/tests/conftest.py` and `backend/tests/test_health.py`: basic pytest test that creates a FastAPI TestClient and verifies GET /health returns 200 with status "healthy"
- [X] T044 [P] Add error handling for duplicate email signup in `frontend/app/(auth)/signup/page.tsx`: detect "User already registered" error from Supabase and show user-friendly message suggesting login instead per spec.md edge cases
- [X] T045 [P] Add session expiry handling in `frontend/middleware.ts`: ensure middleware redirects to /login when getUser() returns no user (expired token) per spec.md edge cases
- [X] T046 Validate end-to-end flow per quickstart.md: start Supabase (local or remote), run migrations, start backend, start frontend, complete signup → email confirm → login → profile edit → logout → redirect cycle. Confirm both services communicate via API proxy

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — can start immediately
- **Foundational (Phase 2)**: Depends on Setup (Phase 1) completion — BLOCKS all user stories
- **User Story 1+4 (Phase 3)**: Depends on Foundational (Phase 2) — P1 priority, MVP target
- **User Story 2 (Phase 4)**: Depends on Foundational (Phase 2) — Can run in parallel with Phase 3 but backend routers share main.py registration
- **User Story 3 (Phase 5)**: Depends on Phase 4 (health endpoint created there) — verification only
- **Polish (Phase 6)**: Depends on all user stories being complete

### User Story Dependencies

- **US1 (Sign Up/Login)**: Depends on Phase 2 only. No dependencies on other stories.
- **US4 (Data Isolation)**: Depends on Phase 2 only (RLS policies in migrations). Verified alongside US1.
- **US2 (Profile)**: Depends on Phase 2 only. Backend endpoints (GET/PATCH /me) and frontend page are independent of auth pages. However, testing requires a logged-in user (US1).
- **US3 (Health)**: Health endpoint is created in US2 phase (same backend setup). Verification depends on US2 backend tasks.

### Within Each User Story

- Backend models before backend routes
- Backend routes before frontend hooks
- Frontend hooks before frontend components
- Frontend components before frontend pages

### Parallel Opportunities

- T002, T003, T004, T005, T006 (Phase 1 Setup) — all independent, different directories
- T018, T019 (Phase 2 backend core) — different files, no dependencies
- T021, T022, T023, T024 (Phase 2 frontend lib) — different files
- T027, T028, T030 (Phase 3 layouts/signup) — different files
- T035, T039 (Phase 4 model + hook) — different files, backend vs frontend
- T043, T044, T045 (Phase 6 polish) — different files

---

## Parallel Example: Phase 1 Setup

```bash
# All can run simultaneously:
Task T002: "Initialize FastAPI project in backend/"
Task T003: "Initialize Next.js 14 project in frontend/"
Task T004: "Initialize shadcn/ui in frontend/"
Task T005: "Initialize Supabase project in supabase/"
Task T006: "Create backend app skeleton"
```

## Parallel Example: Phase 2 Backend Core

```bash
# After T017 (config) completes, these can run simultaneously:
Task T018: "Create Supabase client module in backend/app/core/supabase.py"
Task T019: "Create auth module in backend/app/core/auth.py"
```

## Parallel Example: Phase 2 Frontend Lib

```bash
# After T003 (Next.js init) completes:
Task T021: "Create browser Supabase client in frontend/lib/supabase/client.ts"
Task T022: "Create server Supabase client in frontend/lib/supabase/server.ts"
Task T023: "Create API fetch wrapper in frontend/lib/api.ts"
Task T024: "Create TypeScript types in frontend/types/index.ts"
```

---

## Implementation Strategy

### MVP First (User Stories 1 + 4 Only)

1. Complete Phase 1: Setup (6 tasks)
2. Complete Phase 2: Foundational (19 tasks)
3. Complete Phase 3: User Stories 1 + 4 — Sign Up/Login + Data Isolation (9 tasks)
4. **STOP and VALIDATE**: Test auth flow end-to-end, verify RLS isolation
5. Deploy/demo if ready — users can register, log in, and are data-isolated

### Incremental Delivery

1. Setup + Foundational → Framework ready
2. Add US1 + US4 → Auth works, data isolated → **MVP deployed**
3. Add US2 → Profile management works → Deploy
4. Add US3 → Health endpoint verified → Deploy
5. Polish → Edge cases handled, tests added → Final release

---

## Notes

- [P] tasks = different files, no dependencies on incomplete tasks in current phase
- [Story] label maps task to specific user story for traceability
- US4 (Data Isolation) is implemented via database migrations in Phase 2 and verified in Phase 3 — no separate application code needed
- US3 (Health Check) shares its health endpoint implementation with US2 (created as part of backend router setup) — Phase 5 is verification only
- Migrations T007–T016 must run in order (sequential dependencies)
- Commit after each task or logical group
- Stop at any checkpoint to validate story independently
