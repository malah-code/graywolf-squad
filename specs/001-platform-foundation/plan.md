# Implementation Plan: 001-platform-foundation

**Branch**: `001-platform-foundation` | **Date**: 2026-10-18 | **Spec**: [specs/001-platform-foundation/spec.md](file:///home/tarikelmallah/Projects/GraywolfSquad/specs/001-platform-foundation/spec.md)  
**Target Phase**: Phase 0 — Bootstrap, Dual-Port Skeleton & Docker Topology Alignment (`docs/implementation-plan-detailed.md`)

## Summary

Phase 0 establishes the production-grade foundation for the Graywolf Squad orchestrator. It aligns package dependencies, TypeScript compilation targets, environment variable validation, canonical ADR-042 error handling, and the dual-port architecture:
- **Port 3000 (`PORT_CONTROL`)**: Fastify Control Plane handling REST APIs (`/health`, `/api/v1/*`), health checks, and dashboard WebSocket connections.
- **Port 3001 (`PORT_ARP`)**: Dedicated Agent Relay Protocol (ARP) WebSocket server on the isolated `runner-net` for containerized agent communication.
- **Docker Topology**: Aligns Dockerfiles and service configurations (`docker-compose.yml`) with 4-network segmentation and the Docker socket proxy.

## Technical Context

**Language/Version**: TypeScript 5.4+ / Node.js 20+  
**Framework**: Fastify 5.x (`^5.12.4`) with Fastify 5-compatible `@fastify/websocket` (`^11.x`), `@fastify/helmet`, `@fastify/cors`, `@fastify/cookie`  
**Schema & Validation**: `@sinclair/typebox` (Fastify native route schemas and ACI contracts) and `zod` (runtime environment validation)  
**Error Handling**: Canonical ADR-042 Error Taxonomy (`docs/architecture/error-taxonomy-and-structured-codes.md` — `ErrorCode`, `GraywolfAppError`, structured JSON error envelope)  
**Logging**: `pino` structured JSON logging  
**Testing & Linting**: `vitest` (unit and integration tests), `eslint` (flat config `eslint.config.mjs`)  
**Docker**: Alignment with `docker-compose.yml` (`tecnativa/docker-socket-proxy`, `pgvector/pgvector:pg16`, `valkey/valkey:7.2-alpine`, `litellm`, orchestrator & dashboard Dockerfiles)  

## Constitution Check

*GATE: Must pass before Phase 0 tasks generation.*

- [x] **Zero Runtime Lock-In (Principle 2)**: 100% permissively licensed (MIT/Apache-2.0/BSD-3-Clause/PostgreSQL). Fastify, TypeBox, Zod, Vitest, Valkey.
- [x] **Human Sovereignty & Non-Committing Invariant (Principle 1)**: Dual-port separation ensures runner containers communicate exclusively over internal Port 3001 and have zero access to Git upstream remotes.
- [x] **Headless Execution & Observability (Principle 4)**: Health endpoints and structured error envelopes support headless monitoring and OTLP-ready JSON logging.
- [x] **Standard Stack Matrix (Section 2)**: Uses Fastify (TypeScript), TypeBox, Vitest, and Docker Compose 4-network architecture.

## Project Structure & Deliverables

```text
GraywolfSquad/
├── .env.example                         # Canonical environment variable template
├── eslint.config.mjs                    # ESLint v9 flat config for src/ and tests/
├── package.json                         # Workspace scripts & reconciled Fastify 5.x dependencies
├── tsconfig.json                        # TypeScript strict config (typechecking src/ & tests/)
├── tsconfig.build.json                  # TypeScript build config (compiling src/ -> dist/)
├── docker/
│   ├── orchestrator/
│   │   └── Dockerfile                   # Multi-stage production Node.js 20 Alpine Dockerfile
│   ├── dashboard/
│   │   └── Dockerfile                   # Lightweight stub Dockerfile matching docker-compose.yml
│   ├── litellm/
│   │   └── config.yaml                  # Virtual model alias mapping
│   └── postgres/init/
│       └── 00-extensions.sql            # vector & pgcrypto extension bootstrapper
├── src/
│   └── orchestrator/
│       ├── index.ts                     # Dual-port bootstrapper & graceful shutdown
│       ├── app.ts                       # Fastify Control Plane factory (Port 3000)
│       ├── config/
│       │   └── env.ts                   # Zod-validated environment config
│       ├── errors/
│       │   ├── taxonomy.ts              # ADR-042 error codes, status mapping & TypeBox schemas
│       │   └── error-handler.ts         # Fastify global setErrorHandler
│       ├── routes/
│       │   └── health.ts                # GET /health & GET /api/v1/healthz
│       └── arp/
│           └── server.ts                # Fastify/WS ARP server (Port 3001)
└── tests/
    ├── unit/
    │   ├── env.test.ts                  # Environment defaults and production validation
    │   └── error-taxonomy.test.ts       # Error codes, HTTP status mapping, wire schema
    └── integration/
        └── bootstrap.test.ts            # Dual-port lifecycle, health checks, SIGTERM shutdown
```

## Detailed Component Specifications

### 1. `package.json`, `tsconfig.json` & ESLint Configuration

- **Runtime Dependencies (Fastify 5.x aligned)**:
  - `fastify` (`^5.x`), `@fastify/websocket` (`^11.x`), `@fastify/helmet` (`^13.x`), `@fastify/cors` (`^11.x`), `@fastify/cookie` (`^11.x`)
  - `@sinclair/typebox`, `zod`, `pino`, `pino-pretty`
  - `dockerode`, `node-pg-migrate`, `pg`
  - `ioredis`, `bullmq`, `proper-lockfile`, `gray-matter`, `casbin`, `picomatch`, `ws`
- **Development Dependencies**:
  - `typescript`, `tsx`, `vitest`, `eslint`, `@eslint/js`, `typescript-eslint`, `@types/node`, `@types/ws`, `@types/proper-lockfile`, `@types/pg`, `@types/dockerode`
- **TypeScript Configuration**:
  - `tsconfig.json`: `"include": ["src/**/*", "tests/**/*"]` with `"noEmit": true` (no restrictive `"rootDir": "./src"` that breaks `TS6059` when typechecking `tests/`).
  - `tsconfig.build.json`: extends `tsconfig.json` with `"rootDir": "./src"`, `"outDir": "./dist"`, `"noEmit": false`, `"include": ["src/**/*"]`.
- **Standardized Scripts**:
  - `"dev": "tsx watch src/orchestrator/index.ts"`
  - `"build": "tsc -p tsconfig.build.json"`
  - `"typecheck": "tsc -p tsconfig.json --noEmit"`
  - `"lint": "eslint src tests"`
  - `"test": "vitest run"`
  - `"migrate:up": "node-pg-migrate up"`
  - `"migrate:down": "node-pg-migrate down"`
  - `"prompts:compile": "tsx scripts/prompts-compile.ts"`

### 2. Environment Configuration (`src/orchestrator/config/env.ts`)

Zod schema enforcing all variables from `docker-compose.yml`:
- `NODE_ENV`: `'development' | 'production' | 'test'` (default: `'development'`)
- `PORT_CONTROL`: integer (default: `3000`)
- `PORT_ARP`: integer (default: `3001`)
- `DOCKER_HOST`: string (default: `'tcp://localhost:2375'`)
- `DATABASE_URL`: string (default: `'postgresql://graywolf:graywolf_dev_secret@localhost:5432/graywolf_db'`)
- `VALKEY_URL`: string (default: `'redis://localhost:6379'`)
- `LITELLM_URL`: string (default: `'http://localhost:4000'`)
- `RUNNER_DOCKER_NETWORK`: string (default: `'graywolf-squad_runner-net'`)
- `STORAGE_ROOT`: string (default: `'./.agents'`)
- `RELAY_JWT_SECRET`: string (min 32 chars in production; dev fallback in development/test)

### 3. Canonical Error Taxonomy (`src/orchestrator/errors/taxonomy.ts` & `error-handler.ts`)

- **Exact Canonical Domain Codes (from `docs/architecture/error-taxonomy-and-structured-codes.md` §2)**:
  - **`AUTH_*`**:
    - `AUTH_SESSION_MISSING` (401, retryable: false)
    - `AUTH_SESSION_EXPIRED` (401, retryable: false)
    - `AUTH_SESSION_REVOKED` (401, retryable: false)
    - `AUTH_INVITE_INVALID` (400, retryable: false)
    - `AUTH_INVITE_EXPIRED` (400, retryable: false)
    - `AUTH_INVITE_EXHAUSTED` (400, retryable: false)
    - `AUTH_TGT_EXPIRED` (401, retryable: true)
    - `AUTH_TGT_ALREADY_USED` (401, retryable: false)
  - **`RBAC_*`**:
    - `RBAC_INSUFFICIENT_ROLE` (403, retryable: false)
    - `RBAC_MERGE_NOT_AUTHORIZED` (403, retryable: false)
    - `RBAC_KEY_MANAGEMENT_DENIED` (403, retryable: false)
    - `RBAC_COCKPIT_TOOL_FORBIDDEN` (403, retryable: false)
    - `RBAC_CROSS_TENANT_VIOLATION` (403, retryable: false)
  - **`TASK_*`**:
    - `TASK_NOT_FOUND` (404, retryable: false)
    - `TASK_INVALID_STATE_TRANSITION` (409, retryable: false)
    - `TASK_BLOCKED_BY_DEPENDENCIES` (409, retryable: false)
    - `TASK_LOCK_CONTENTION` (423, retryable: true)
    - `TASK_CLARIFICATION_LIMIT_REACHED` (400, retryable: false)
    - `TASK_ALREADY_DISPATCHED` (409, retryable: false)
    - `TASK_SPEND_LIMIT_EXCEEDED` (402, retryable: false)
  - **`SANDBOX_*`**:
    - `SANDBOX_DOCKER_PROXY_UNREACHABLE` (503, retryable: true)
    - `SANDBOX_PROVISIONING_FAILED` (500, retryable: true)
    - `SANDBOX_OOM_KILLED` (500, retryable: false)
    - `SANDBOX_STARTUP_TIMEOUT` (504, retryable: true)
    - `SANDBOX_HEARTBEAT_TIMEOUT` (504, retryable: false)
    - `SANDBOX_IMAGE_PULL_FORBIDDEN` (403, retryable: false)
  - **`RELAY_*`** (mapped to HTTP 422/500 when surfaced via API/WS, plus container exit code metadata):
    - `RELAY_BLAST_RADIUS_VIOLATION` (422, exitCode: 2, retryable: false)
    - `RELAY_GIT_BARRIER_VIOLATION` (422, exitCode: 2, retryable: false)
    - `RELAY_SPEND_CEILING_HIT` (402, exitCode: 0, retryable: false)
    - `RELAY_INTERNAL_REVIEW_TWO_STRIKES` (422, exitCode: 0, retryable: false)
    - `RELAY_DETERMINISTIC_LINTER_FAILED` (422, exitCode: 0, retryable: true)
    - `RELAY_UNRECOVERABLE_EXCEPTION` (500, exitCode: 1, retryable: false)
  - **`LLM_*`**:
    - `LLM_PROVIDER_RATE_LIMITED` (429, retryable: true)
    - `LLM_CIRCUIT_BREAKER_TRIPPED` (503, retryable: true)
    - `LLM_CONTEXT_WINDOW_EXCEEDED` (400, retryable: false)
    - `LLM_DAILY_BUDGET_EXCEEDED` (402, retryable: false)
    - `LLM_LOCAL_MODEL_OFFLINE` (503, retryable: true)
  - **`GIT_*`**:
    - `GIT_REMOTE_AUTH_FAILED` (401, retryable: false)
    - `GIT_WORKTREE_COLLISION` (409, retryable: true)
    - `GIT_AUTO_REBASE_CONFLICT` (409, retryable: false)
    - `GIT_PATCH_APPLICATION_FAILED` (422, retryable: false)
  - **`ADDON_*`**:
    - `ADDON_HASH_MISMATCH` (403, retryable: false)
    - `ADDON_SLOT_LIMIT_EXCEEDED` (429, retryable: false)
    - `ADDON_UNLINKED_EXTERNAL_USER` (403, retryable: false)
  - **`GATE_*`**:
    - `GATE_LOW_CONFIDENCE_FALLBACK` (200, retryable: true)
    - `GATE_BACKEND_UNAVAILABLE` (503, retryable: true)
  - **System / Validation Codes**:
    - `ACI_VALIDATION_FAILED` (400, retryable: true)
    - `INTERNAL_SERVER_ERROR` (500, retryable: false)
- **Wire Contract (TypeBox)**:
  ```typescript
  export const ErrorResponseSchema = Type.Object({
    code: Type.String(),
    message: Type.String(),
    details: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
    retryable: Type.Boolean(),
    timestamp: Type.String({ format: 'date-time' }),
  });
  ```
- **Fastify Error Handler**: Catches both `GraywolfAppError` and Fastify schema validation failures (mapped to `ACI_VALIDATION_FAILED`, HTTP 400), emitting the exact ADR-042 contract.

### 4. Dual-Port Bootstrap (`app.ts`, `arp/server.ts`, `index.ts`)

- **Control Plane (`app.ts`)**:
  - Exposes `GET /health` (lightweight healthcheck for Docker Compose) and `GET /api/v1/healthz` (`{ ok: true, timestamp }`).
  - Registers Helmet, CORS, Cookie, WebSocket, and global error handler.
- **ARP Server (`arp/server.ts`)**:
  - Listens on `PORT_ARP` (3001) at route `/relay`.
  - Dedicated connection pool and heartbeat ping/pong.
- **Entrypoint (`index.ts`)**:
  - Starts Control Plane on `PORT_CONTROL` and ARP server on `PORT_ARP`.
  - Registers graceful shutdown hooks for `SIGINT` and `SIGTERM` with a 5-second drain ceiling.

### 5. Docker Topology Alignment

- `docker/orchestrator/Dockerfile`: Node.js 20 Alpine multi-stage build.
- `docker/dashboard/Dockerfile`: Minimal Nginx/Alpine stub serving a placeholder health/index page on port 80 (until Phase 12 Dashboard UI) so `docker compose config` and `docker compose build` succeed cleanly.
- `docker/litellm/config.yaml`: Model definitions mapping `agent-planner`, `agent-coder`, `agent-reviewer`, `agent-arbiter`.
- `docker/postgres/init/00-extensions.sql`: `CREATE EXTENSION IF NOT EXISTS vector; CREATE EXTENSION IF NOT EXISTS pgcrypto;`.

## Verification & Test Plan

1. **Unit Tests**:
   - `tests/unit/env.test.ts`: Validates environment variables parsing and production rules.
   - `tests/unit/error-taxonomy.test.ts`: Verifies error code mappings and structured serialization.
2. **Integration Tests**:
   - `tests/integration/bootstrap.test.ts`: Boots dual servers, queries `GET /health` (200 OK), establishes ARP WebSocket handshake, and verifies graceful shutdown.
3. **Static Checks**:
   - `pnpm typecheck` (tsc `--noEmit`)
   - `pnpm lint`
   - `docker compose config -q`
