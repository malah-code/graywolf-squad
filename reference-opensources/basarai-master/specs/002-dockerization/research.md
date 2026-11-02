# Research: Application Containerization

**Branch**: `002-dockerization` | **Date**: 2026-02-22

## Decision 1: Multi-Stage Build Strategy

**Decision**: Use three Docker stages — `frontend-builder` (Node.js 20 slim), `backend-builder` (Python 3.13 slim), `runtime` (Python 3.13 slim + Node.js 20 via NodeSource).

**Rationale**:
- Separate build stages allow optimal caching — frontend deps and backend deps are cached independently.
- Python 3.13 slim as runtime base because Python is harder to install correctly into a Node image (virtualenvs, pip, system packages) than Node is to install into a Python image (single apt install).
- `python:3.13-slim` at ~121MB is smaller than `node:20-slim` at ~220MB.
- Node.js 20 is installed via the official NodeSource apt repository — the officially recommended approach for Debian.

**Alternatives considered**:
- `node:20-slim` + apt install python3: Larger base image, less control over Python version.
- `nikolaik/python-nodejs` combo image: Third-party, less control over versions and patches.
- Alpine-based images: Smaller but musl libc causes compatibility issues with some Python packages (supabase, httpx).

## Decision 2: Next.js Standalone Output

**Decision**: Add `output: 'standalone'` to `next.config.mjs` to produce a self-contained production server.

**Rationale**:
- Standalone mode uses `@vercel/nft` to trace only the files needed at runtime, producing a minimal `.next/standalone/` directory with a `server.js` entry point and pruned `node_modules`.
- Eliminates the need for `npm install` in the runtime stage — only file copies are needed.
- Dramatically reduces runtime image size (tens of MB instead of hundreds).
- The standalone `server.js` is run via `node server.js` (not `next start`), with `HOSTNAME` and `PORT` as environment variables.

**Important**: `.next/static/` and `public/` are NOT included in standalone output by default — they must be copied manually into the runtime stage.

**Alternatives considered**:
- Full `node_modules` in runtime: Much larger image, slower startup.
- Static export (`output: 'export'`): Loses SSR, middleware, and API rewrites — incompatible with the auth middleware.

## Decision 3: NEXT_PUBLIC_* Environment Variables

**Decision**: Pass `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` as Docker build args (`--build-arg`). They are inlined into the JavaScript bundle at build time. Also set as `ENV` in the runtime stage for SSR usage.

**Rationale**:
- Next.js 14 App Router inlines `NEXT_PUBLIC_*` values into the client bundle during `next build`. They cannot be changed at runtime for client-side code.
- For server-side rendering, `process.env.NEXT_PUBLIC_*` is read at runtime, so setting them as `ENV` in the Dockerfile covers both cases.
- For an MVP with a single deployment target (Bunny Magic), building per-environment is acceptable and avoids the complexity of runtime injection.

**Alternatives considered**:
- Runtime injection via `window.__ENV` script tag: True build-once-deploy-many, but requires code changes (global config object, script injection).
- `next-runtime-env` library: Drop-in solution, but adds a dependency for a problem that doesn't exist yet (single deployment target).

## Decision 4: Process Management

**Decision**: Use `tini` as PID 1 + a bash entrypoint script with `trap` and `wait -n`.

**Rationale**:
- `tini` is a tiny (~20KB) init process that handles zombie reaping and basic signal forwarding — the two things PID 1 must do that bash cannot.
- A bash script starts uvicorn (backend) and node (frontend) as background processes, traps SIGTERM/SIGINT, and uses `wait -n` to exit when either process dies.
- This is the lightest approach that correctly handles signals for two well-behaved processes.

**Alternatives considered**:
- Bash script only (no tini): Does not reap zombie processes; SIGTERM handling in bash is fragile.
- s6-overlay: More robust declarative process management, but ~2-3MB overhead and learning curve for only two processes.
- supervisord: Full-featured but heavyweight (~20MB), overkill for two processes.

## Decision 5: Health Check Implementation

**Decision**: Use Python `urllib` in the `HEALTHCHECK` instruction to check both `localhost:8000/health` (backend) and `localhost:3000` (frontend).

**Rationale**:
- The runtime image already has Python 3.13, so no additional tool installation (curl, wget) is needed.
- Python's `urllib` is concise and reliable for HTTP GET checks.
- `--start-period=40s` gives both services time to boot before Docker starts failing health checks.
- Both processes must respond with HTTP 200 for the container to be considered healthy.

**Alternatives considered**:
- Installing curl: Adds ~7MB to the image for a feature already available via Python.
- Node.js `http` module: Also available, but Python syntax is more concise for inline health checks.
- Separate health check script: Cleaner but adds a file; inline is sufficient for two simple checks.

## Decision 6: Backend Binding Address

**Decision**: Backend (uvicorn) binds to `127.0.0.1:8000` — internal only. Frontend (Next.js) binds to `0.0.0.0:3000` — publicly accessible.

**Rationale**:
- FR-006 requires the backend to be internal-only. Binding to `127.0.0.1` ensures it cannot be reached from outside the container even if the port is accidentally exposed.
- Next.js must bind to `0.0.0.0` to be reachable from outside the container.
- The existing `next.config.mjs` rewrites `/api/*` to `http://127.0.0.1:8000/*`, which works inside the container since both processes share the same network namespace.

**Alternatives considered**:
- Backend on `0.0.0.0` with firewall rules: More complex, same result.
- Unix socket for backend: Better performance but Next.js rewrites don't support Unix sockets natively.

## Decision 7: Required Runtime Environment Variables

**Decision**: The entrypoint validates these required runtime env vars before starting any process:

| Variable | Used By | Purpose |
|----------|---------|---------|
| `SUPABASE_URL` | Backend | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Backend | Server-side Supabase access (bypasses RLS) |
| `SUPABASE_ANON_KEY` | Backend | Public Supabase key for client-context operations |
| `SUPABASE_JWT_SECRET` | Backend | JWT token verification |

Optional vars with defaults: `STORAGE_BUCKET` (default: `brand-assets`), `ADMIN_EMAILS` (default: empty), `HOST` (default: `127.0.0.1`), `PORT` (default: `8000`).

`NEXT_PUBLIC_*` vars are baked at build time and do not need runtime validation.

**Rationale**: These four vars have no defaults in `backend/app/config.py` and will cause pydantic `ValidationError` if missing. Validating upfront in the entrypoint gives a clear, actionable error message instead of a Python traceback.
