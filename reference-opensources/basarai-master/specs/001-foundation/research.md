# Research: Foundation

**Branch**: `001-foundation` | **Date**: 2026-02-08

## 1. Supabase Auth with Next.js 14 App Router

**Decision**: Use `@supabase/ssr` package with separate browser and server client factories.

**Rationale**: `@supabase/auth-helpers-nextjs` is deprecated. `@supabase/ssr` is the official package for Next.js App Router, providing proper SSR cookie handling and automatic cookie chunking for large JWTs.

**Alternatives considered**:
- `@supabase/auth-helpers-nextjs`: Deprecated, do not use.
- NextAuth.js: More complex, unnecessary when using Supabase Auth directly.
- Manual cookie handling: Error-prone, reinvents existing tooling.

**Key patterns**:
- `createBrowserClient()` in `lib/supabase/client.ts` for client components.
- `createServerClient()` in `lib/supabase/server.ts` with `cookies()` for server components.
- Middleware (`middleware.ts`) refreshes sessions and protects routes. Must use `supabase.auth.getUser()` (not `getSession()`) for server-side validation.
- Auth callback route at `app/auth/confirm/route.ts` handles email verification via `verifyOtp()`.

**Packages**: `@supabase/supabase-js ^2.39.0`, `@supabase/ssr ^0.1.0`

---

## 2. Supabase JWT Verification in FastAPI

**Decision**: Use PyJWT to manually decode and verify JWTs using the Supabase JWT secret (HS256).

**Rationale**: FastAPI is stateless; JWT verification is fast, requires no network calls, and gives full control over auth middleware. The Supabase Python client's `auth.get_user()` makes a network call per request, which is slower and adds a dependency on Supabase API availability.

**Alternatives considered**:
- Supabase Python client `auth.get_user()`: Slower (network call), adds availability dependency.
- python-jose: Works but PyJWT is lighter and sufficient for HS256.
- No verification (trust frontend): Security vulnerability.

**Key patterns**:
- `HTTPBearer` security scheme extracts Bearer token.
- `jwt.decode(token, JWT_SECRET, algorithms=["HS256"], audience="authenticated")` validates the token.
- `get_current_user` FastAPI dependency extracts `sub` (user_id) and `email` from claims.
- Store `access_token` on the User model for user-scoped Supabase client calls.
- `SUPABASE_JWT_SECRET` from Supabase Dashboard > Settings > API.

**Packages**: `PyJWT ^2.8.0`, `fastapi`, `pydantic-settings`

---

## 3. FastAPI Project Structure

**Decision**: Domain/feature-based organization with `routers/`, `models/`, `services/`, and `core/` directories under `app/`.

**Rationale**: Better scalability, clearer separation of concerns by business domain, easier to locate related code. Aligns with the multi-tenant brand architecture.

**Alternatives considered**:
- Flat file-type structure: Harder to navigate for larger apps.
- Monolithic routes file: Does not scale.

**Key patterns**:
- `app/main.py`: FastAPI app with lifespan, CORS, router registration.
- `app/core/auth.py`: JWT verification and `get_current_user` dependency.
- `app/core/supabase.py`: Singleton Supabase clients (service-role and user-scoped).
- `app/routers/`: One file per domain (health, me, brands, kit, keys, generations, admin).
- `app/models/`: Pydantic request/response models per domain.
- `app/services/`: Business logic (storage, vault, providers).

---

## 4. Supabase Client Management in FastAPI

**Decision**: Singleton pattern with shared httpx client. Separate clients for service-role (bypasses RLS) and user-scoped (respects RLS) operations.

**Rationale**: `supabase-py` creates a new httpx client on every `create_client` call, causing performance issues. Reusing the httpx client improves performance. Critical: a user token in the Authorization header overrides the service-role key, re-enabling RLS. Separate clients prevent accidental RLS bypass.

**Alternatives considered**:
- Single global client: Cannot safely handle both service-role and user-scoped operations.
- New client per request: Performance issues from httpx client recreation.

**Key patterns**:
- `get_service_client()` with `@lru_cache()` for service-role operations.
- `get_user_client(access_token)` for user-scoped operations respecting RLS.
- Shared `httpx.Client(timeout=30.0)` across both.

---

## 5. Profile Auto-Creation Trigger

**Decision**: PostgreSQL `SECURITY DEFINER` function triggered on `auth.users` INSERT that creates a corresponding `public.profiles` row.

**Rationale**: Ensures every user automatically gets a profile row, maintaining referential integrity. `SECURITY DEFINER` is required because the trigger fires in the context of the new user who does not yet have insert permissions on `public.profiles`.

**Alternatives considered**:
- Manual profile creation in app code: Race conditions, easy to forget.
- Database view: Cannot store mutable profile data.
- `SECURITY INVOKER`: Would fail due to RLS for new users.

**Key patterns**:
- Function `handle_new_user()` with `SECURITY DEFINER SET search_path = public`.
- Extracts `full_name` and `avatar_url` from `NEW.raw_user_meta_data`.
- Uses `ON CONFLICT (user_id) DO NOTHING` for idempotency.
- Trigger: `AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION handle_new_user()`.

---

## 6. Storage Bucket Setup

**Decision**: Public bucket `brand-assets` created via SQL migration with RLS policies. Public read, authenticated brand-owner write/delete.

**Rationale**: Public bucket with RLS is simpler than private bucket with signed URLs. No need to generate signed URLs for every image. UUIDs in paths provide practical privacy (per implementation plan decision).

**Alternatives considered**:
- Private bucket with signed URLs: More complex, URLs expire, harder to share.
- No RLS (service-role only): Less secure, all validation in app code.
- Separate buckets per brand: Does not scale.

**Key patterns**:
- `storage.foldername(name)` splits path into folder segments for RLS checks.
- SELECT policy: Anyone can read from `brand-assets`.
- INSERT/UPDATE/DELETE policies: Authenticated users where `(storage.foldername(name))[2]` matches a brand they own.
- File size limit: 5MB. Allowed MIME types: `image/png`, `image/jpeg`, `image/webp`, `image/svg+xml`.

---

## 7. CORS Configuration

**Decision**: Explicit origins list with localhost variants for development. Never use `["*"]` in production.

**Rationale**: Next.js on port 3000 calling FastAPI on port 8000 requires CORS (different ports = different origins). Must allow credentials for auth headers.

**Key patterns**:
- Origins: `http://localhost:3000`, `http://127.0.0.1:3000`, `http://localhost`.
- `allow_credentials=True` for Authorization headers.
- In production container: Next.js rewrites proxy `/api/*` to `http://127.0.0.1:8000/*`, making CORS largely unnecessary (same-origin from browser perspective).

---

## 8. Next.js API Proxy

**Decision**: Use Next.js `rewrites` in `next.config.js` to proxy `/api/*` to the internal FastAPI backend.

**Rationale**: Simplest approach for containerized deployment where both services run together. Zero-code, configuration-based. Browser sees same-origin requests, avoiding CORS issues entirely.

**Alternatives considered**:
- API Routes catch-all: More code, needed only if request/response transformation required.
- Direct backend calls: Requires CORS, exposes backend URL to clients.
- Nginx/API gateway: Overengineered for single-container deployment.

**Key pattern**:
```javascript
// next.config.js
rewrites() {
  return [{ source: '/api/:path*', destination: 'http://127.0.0.1:8000/:path*' }]
}
```

---

## 9. UI Component Library

**Decision**: shadcn/ui with Tailwind CSS and Radix UI primitives.

**Rationale**: Components are copied into the project (not npm dependency), giving full control. Built on accessible Radix UI primitives. Excellent TypeScript support. CSS variables for theming.

**Alternatives considered**:
- Material-UI: Heavier bundle, more opinionated.
- Chakra UI: Larger runtime overhead.
- Custom from scratch: Significant time investment.

**Setup**: `npx shadcn@latest init` then add components as needed.

---

## 10. Testing Strategy

**Decision**: pytest for backend, manual verification for Phase 1 frontend.

**Rationale**: Phase 1 is foundation setup. Backend endpoints (health, profile CRUD) should have basic tests. Frontend auth flows are best verified manually in this phase; automated E2E tests can be added in later phases.

**Packages**: `pytest`, `pytest-asyncio`, `httpx` (for test client)
