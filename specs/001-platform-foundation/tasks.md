# Tasks: 001-platform-foundation

**Branch**: `001-platform-foundation` | **Date**: 2026-10-18 | **Spec**: [specs/001-platform-foundation/spec.md](file:///home/tarikelmallah/Projects/GraywolfSquad/specs/001-platform-foundation/spec.md) | **Plan**: [specs/001-platform-foundation/plan.md](file:///home/tarikelmallah/Projects/GraywolfSquad/specs/001-platform-foundation/plan.md)  
**Target Phase**: Phase 0 — Bootstrap, Dual-Port Skeleton & Docker Topology Alignment (`docs/implementation-plan-detailed.md`)

---

## Phase 1: Setup & Environment Configuration

**Purpose**: Establish Fastify 5.x package dependencies, strict TypeScript/ESLint settings, and Zod environment parsing matching `docker-compose.yml`.

- [x] **T001** Reconcile `package.json` with Fastify 5.x-compatible runtime and dev dependencies (`fastify@^5.x`, `@fastify/websocket@^11.x`, `@fastify/helmet@^13.x`, `@fastify/cors@^11.x`, `@fastify/cookie@^11.x`, `@sinclair/typebox`, `zod`, `pino`, `pino-pretty`, `dockerode`, `node-pg-migrate`, `pg`, `ioredis`, `bullmq`, `proper-lockfile`, `gray-matter`, `casbin`, `picomatch`, `ws`, `vitest`, `eslint`, `@eslint/js`, `typescript-eslint`, `@types/proper-lockfile`, `@types/ws`) and standardize scripts (`dev`, `build`, `typecheck`, `lint`, `test`, `migrate:up`, `migrate:down`, `prompts:compile`).
- [x] **T002** Configure `tsconfig.json` (typechecking `src/**/*` and `tests/**/*` with `--noEmit` and no conflicting `rootDir`), `tsconfig.build.json` (`rootDir: "./src"`, `outDir: "./dist"`), and `eslint.config.mjs` (ESLint v9 flat config for TypeScript across `src/` and `tests/`).
- [x] **T003** Implement Zod-validated environment parser in `src/orchestrator/config/env.ts` matching `docker-compose.yml` variables (`NODE_ENV`, `PORT_CONTROL`, `PORT_ARP`, `DOCKER_HOST`, `DATABASE_URL`, `VALKEY_URL`, `LITELLM_URL`, `RUNNER_DOCKER_NETWORK`, `STORAGE_ROOT`, `RELAY_JWT_SECRET`), update `.env.example`, and write unit tests in `tests/unit/env.test.ts`.

---

## Phase 2: Foundational Error Infrastructure

**Purpose**: Implement canonical machine-readable error codes and global Fastify error serialization adhering strictly to `docs/architecture/error-taxonomy-and-structured-codes.md` (ADR-042).

- [x] **T004** Implement canonical ADR-042 Error Taxonomy in `src/orchestrator/errors/taxonomy.ts` defining the exact `ErrorCode` union and metadata table from `docs/architecture/error-taxonomy-and-structured-codes.md` §2 (`AUTH_SESSION_MISSING`, `AUTH_SESSION_EXPIRED`, `AUTH_SESSION_REVOKED`, `AUTH_INVITE_INVALID`, `AUTH_INVITE_EXPIRED`, `AUTH_INVITE_EXHAUSTED`, `AUTH_TGT_EXPIRED`, `AUTH_TGT_ALREADY_USED`, `RBAC_INSUFFICIENT_ROLE`, `RBAC_MERGE_NOT_AUTHORIZED`, `RBAC_KEY_MANAGEMENT_DENIED`, `RBAC_COCKPIT_TOOL_FORBIDDEN`, `RBAC_CROSS_TENANT_VIOLATION`, `TASK_NOT_FOUND`, `TASK_INVALID_STATE_TRANSITION`, `TASK_BLOCKED_BY_DEPENDENCIES`, `TASK_LOCK_CONTENTION`, `TASK_CLARIFICATION_LIMIT_REACHED`, `TASK_ALREADY_DISPATCHED`, `TASK_SPEND_LIMIT_EXCEEDED`, `SANDBOX_DOCKER_PROXY_UNREACHABLE`, `SANDBOX_PROVISIONING_FAILED`, `SANDBOX_OOM_KILLED`, `SANDBOX_STARTUP_TIMEOUT`, `SANDBOX_HEARTBEAT_TIMEOUT`, `SANDBOX_IMAGE_PULL_FORBIDDEN`, `RELAY_BLAST_RADIUS_VIOLATION`, `RELAY_GIT_BARRIER_VIOLATION`, `RELAY_SPEND_CEILING_HIT`, `RELAY_INTERNAL_REVIEW_TWO_STRIKES`, `RELAY_DETERMINISTIC_LINTER_FAILED`, `RELAY_UNRECOVERABLE_EXCEPTION`, `LLM_PROVIDER_RATE_LIMITED`, `LLM_CIRCUIT_BREAKER_TRIPPED`, `LLM_CONTEXT_WINDOW_EXCEEDED`, `LLM_DAILY_BUDGET_EXCEEDED`, `LLM_LOCAL_MODEL_OFFLINE`, `GIT_REMOTE_AUTH_FAILED`, `GIT_WORKTREE_COLLISION`, `GIT_AUTO_REBASE_CONFLICT`, `GIT_PATCH_APPLICATION_FAILED`, `ADDON_HASH_MISMATCH`, `ADDON_SLOT_LIMIT_EXCEEDED`, `ADDON_UNLINKED_EXTERNAL_USER`, `GATE_LOW_CONFIDENCE_FALLBACK`, `GATE_BACKEND_UNAVAILABLE`, `ACI_VALIDATION_FAILED`, `INTERNAL_SERVER_ERROR`), `GraywolfAppError` class, and TypeBox `ErrorResponseSchema`.
- [x] **T005** Implement global Fastify error handler in `src/orchestrator/errors/error-handler.ts` to intercept `GraywolfAppError` and schema validation failures (`ACI_VALIDATION_FAILED`), emitting the exact `{ code, message, details, retryable, timestamp }` wire contract. Add unit tests in `tests/unit/error-taxonomy.test.ts` verifying every canonical code's HTTP status and retryable flag.

---

## Phase 3: User Story 1 - Dual-Port Server Lifecycle & Health Observability (Priority: P1) 🎯 MVP

**Goal**: Expose Control Plane REST APIs on Port 3000 and ARP WebSocket server on Port 3001 with graceful shutdown.

**Independent Test**: Start orchestrator, query `GET /health` and `GET /api/v1/healthz` (200 OK), connect WebSocket to `ws://localhost:3001/relay`, and emit `SIGTERM` to verify clean teardown.

- [x] **T006 [US1]** Implement health routes in `src/orchestrator/routes/health.ts` exposing `GET /health` and `GET /api/v1/healthz` returning `{ ok: true, timestamp }`.
- [x] **T007 [US1]** Implement Fastify Control Plane factory in `src/orchestrator/app.ts` registering Helmet, CORS, Cookie, WebSocket, health routes, and global error handler on `PORT_CONTROL` (default 3000).
- [x] **T008 [US1]** Implement dedicated Agent Relay Protocol (ARP) WebSocket server in `src/orchestrator/arp/server.ts` listening on `PORT_ARP` (default 3001) mounted at `/relay`.
- [x] **T009 [US1]** Wire dual-port startup and graceful `SIGINT`/`SIGTERM` shutdown handlers in `src/orchestrator/index.ts`, and author integration test in `tests/integration/bootstrap.test.ts`.

---

## Phase 4: User Story 3 - Multi-Network Docker Alignment (Priority: P2)

**Goal**: Ensure all supporting Dockerfiles and service configurations match `docker-compose.yml` 4-network topology.

**Independent Test**: Execute `docker compose config -q` and verify multi-stage orchestrator Dockerfile syntax.

- [x] **T010 [US3]** Author multi-stage Node.js 20 Alpine Dockerfile for Orchestrator in `docker/orchestrator/Dockerfile` and stub Dockerfile for Dashboard in `docker/dashboard/Dockerfile`.
- [x] **T011 [US3]** Create PostgreSQL extension bootstrapper in `docker/postgres/init/00-extensions.sql` enabling `vector` and `pgcrypto`.
- [x] **T012 [US3]** Create LiteLLM model router configuration in `docker/litellm/config.yaml` with virtual aliases (`agent-planner`, `agent-coder`, `agent-reviewer`, `agent-arbiter`).
- [x] **T013 [US3]** Validate Docker Compose topology with `docker compose config -q` ensuring seamless container networking.

---

## Phase 5: Verification & Static Quality Gate

**Purpose**: Ensure zero compile, lint, or testing regressions before phase exit.

- [x] **T014** Run `pnpm typecheck && pnpm lint` to verify zero TypeScript or ESLint errors.
- [x] **T015** Run `pnpm test` (Vitest) validating 100% pass across all unit and integration tests.

---

## Dependencies & Execution Order

- **Phase 1 (Setup & Env)** must complete before Phase 2 & 3.
- **Phase 2 (Error Taxonomy)** must complete before `app.ts` in Phase 3.
- **Phase 3 (Dual-Port Servers)** integrates Phase 1 & 2.
- **Phase 4 (Docker Alignment)** can run in parallel with Phase 3 or right after.
- **Phase 5 (Verification)** runs as the final quality gate before Step 6 `/speckit-analyze` and Step 7 Human Approval.
