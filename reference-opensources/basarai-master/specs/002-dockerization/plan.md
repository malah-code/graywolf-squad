# Implementation Plan: Application Containerization

**Branch**: `002-dockerization` | **Date**: 2026-02-22 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/002-dockerization/spec.md`

## Summary

Containerize the Basar AI application (Next.js 14 frontend + FastAPI backend) into a single Docker image for deployment to Bunny Magic. Uses a three-stage Docker build (frontend builder, backend builder, runtime), a bash entrypoint script with tini for process management, and backend-first startup ordering with env var validation. The image exposes only port 3000 (frontend); the backend is internal-only on localhost:8000.

## Technical Context

**Language/Version**: Dockerfile, Bash (entrypoint); modifies Python 3.13 backend + TypeScript/Next.js 14 frontend configs
**Primary Dependencies**: Docker (multi-stage build), tini (PID 1 init), Node.js 20, Python 3.13, uvicorn
**Storage**: N/A (no database changes)
**Testing**: Manual validation — `docker build` + `docker run` + health check verification
**Target Platform**: Linux container (Debian bookworm-based) → Bunny Magic container hosting
**Project Type**: DevOps / infrastructure (container packaging for existing web-service)
**Performance Goals**: Image build completes; container starts and serves first request within 30 seconds; graceful shutdown within 10 seconds
**Constraints**: Single container image < 1 GB; no secrets baked into image layers; non-root runtime user
**Scale/Scope**: 4 new files (Dockerfile, .dockerignore, entrypoint script, docs), 1 modified file (next.config.mjs)

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Product Truth (brand tenancy, BYOK) | N/A | No application logic changes |
| II. Non-Negotiables | PASS | **Key Secrecy**: FR-010 ensures no secrets baked into image. **Brand Isolation / Hard Delete / PNG Only / Official Endpoints**: Not affected by containerization |
| III. Tech Constraints | PASS | Uses mandated stack: Next.js 14 + FastAPI + Supabase + Bunny Magic Containers |
| IV. Data Rules | N/A | No database changes |
| V. UX Rules | N/A | No UI changes |
| VI. Security Rules | PASS | Backend internal-only (FR-006); secrets via runtime env vars only (FR-010); no key exposure in image layers (SC-006) |
| VII. Definition of Done | PARTIAL | Some DoD items (provider testing, RLS, brand kit) don't apply to infrastructure. Container-specific DoD: auth works in container, health check works in container |

**Gate result**: PASS — no violations.

### Post-Design Re-check

| Principle | Status | Notes |
|-----------|--------|-------|
| III. Tech Constraints | PASS | Runtime image uses Python 3.13-slim + Node.js 20 (NodeSource) — matches mandated stack |
| VI. Security Rules | PASS | Non-root user (FR-003); backend on 127.0.0.1 only; no secrets in build args or image layers |

**Gate result**: PASS — no violations after design.

## Project Structure

### Documentation (this feature)

```text
specs/002-dockerization/
├── plan.md              # This file
├── research.md          # Phase 0 output — 7 technical decisions
├── data-model.md        # Phase 1 output — configuration entities
├── quickstart.md        # Phase 1 output — build/run/verify commands
└── tasks.md             # Phase 2 output (via /speckit.tasks)
```

### Source Code (repository root)

```text
/                                    # Repository root
├── Dockerfile                       # NEW — Multi-stage build (3 stages)
├── .dockerignore                    # NEW — Build context exclusions
├── scripts/
│   └── container-entrypoint.sh      # NEW — Process supervisor script
├── docs/
│   └── docker.md                    # NEW — Bunny Magic deployment runbook
├── frontend/
│   └── next.config.mjs              # MODIFIED — Add output: 'standalone'
├── backend/                         # UNCHANGED
│   └── app/
│       ├── main.py
│       ├── config.py
│       └── routers/health.py
└── supabase/                        # UNCHANGED
```

**Structure Decision**: This feature adds root-level infrastructure files (`Dockerfile`, `.dockerignore`, `scripts/`) alongside the existing `frontend/` and `backend/` directories. No changes to the application source structure.

## Design Details

### Dockerfile Architecture

Three-stage multi-stage build:

```text
┌─────────────────────────────────────────────┐
│ Stage 1: frontend-builder                   │
│ Base: node:20-slim                          │
│ - npm ci (cached layer)                     │
│ - ARG NEXT_PUBLIC_SUPABASE_URL              │
│ - ARG NEXT_PUBLIC_SUPABASE_ANON_KEY         │
│ - npm run build (standalone output)         │
│ Output: .next/standalone/, .next/static/,   │
│         public/                              │
└─────────────────────────────────────────────┘
                     │
┌─────────────────────────────────────────────┐
│ Stage 2: backend-builder                    │
│ Base: python:3.13-slim                      │
│ - pip install (cached layer)                │
│ Output: installed packages in site-packages │
└─────────────────────────────────────────────┘
                     │
┌─────────────────────────────────────────────┐
│ Stage 3: runtime                            │
│ Base: python:3.13-slim                      │
│ - Install Node.js 20 (NodeSource apt repo)  │
│ - Install tini                              │
│ - Create non-root user (appuser)            │
│ - COPY backend deps from stage 2            │
│ - COPY backend source                       │
│ - COPY frontend standalone from stage 1     │
│ - COPY entrypoint script                    │
│ - EXPOSE 3000                               │
│ - HEALTHCHECK (Python urllib, both services) │
│ - ENTRYPOINT ["tini", "--"]                 │
│ - CMD ["./scripts/container-entrypoint.sh"] │
└─────────────────────────────────────────────┘
```

### Entrypoint Script Flow

```text
1. Validate required env vars (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
   SUPABASE_ANON_KEY, SUPABASE_JWT_SECRET)
   → Missing? Print descriptive error, exit 1

2. Set trap for SIGTERM/SIGINT → cleanup function

3. Start backend: uvicorn app.main:app --host 127.0.0.1 --port 8000
   → Background, capture PID

4. Poll http://127.0.0.1:8000/health every 1s, timeout after 30s
   → Not healthy? Kill backend, exit 1

5. Start frontend: HOSTNAME=0.0.0.0 PORT=3000 node server.js
   → Background, capture PID

6. wait -n (exit when either process dies)
   → Kill surviving process, exit with failed process's exit code

cleanup():
   → kill -TERM both PIDs
   → wait for both to exit
```

### next.config.mjs Change

Add `output: 'standalone'` to enable containerized production builds:

```javascript
const nextConfig = {
  output: 'standalone',
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: 'http://127.0.0.1:8000/:path*',
      },
    ];
  },
};
```

The `rewrites` configuration continues to work in standalone mode — the standalone server supports rewrites.

### .dockerignore Contents

Excludes from build context:

```text
.git
.gitignore
node_modules
.next
__pycache__
*.pyc
venv
.venv
.env
.env.*
!.env.example
.idea
.vscode
.claude
.opencode
.specify
specs
docs
*.md
!frontend/README.md
.DS_Store
coverage
.pytest_cache
.ruff_cache
.mypy_cache
supabase/.branches
supabase/.temp
```

### Health Check Configuration

```dockerfile
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD python3 -c "import urllib.request,sys;r1=urllib.request.urlopen('http://localhost:8000/health');r2=urllib.request.urlopen('http://localhost:3000');sys.exit(0 if r1.status==200 and r2.status==200 else 1)"
```

- `--start-period=40s`: Grace period for both services to boot
- `--interval=30s`: Check every 30 seconds after start period
- `--retries=3`: 3 consecutive failures = unhealthy

## Complexity Tracking

No constitution violations — this section is intentionally empty.
