---
description: "Task list for Phase 17 — Production Release Packaging, Multi-Arch Compose & Cold-Boot Smoke Verification (v0.1.0-p0)"
---

# Tasks: Production Release Packaging, Multi-Arch Compose & Cold-Boot Smoke Verification (`v0.1.0-p0`)

**Input**: Design documents from `/specs/018-production-release-and-compose/`

**Prerequisites**: `plan.md` (required), `spec.md` (required for user stories), `research.md`, `data-model.md`, `contracts/production-release-contracts.md`, `quickstart.md`

**Tests**: Automated unit, integration, and end-to-end smoke test tasks are explicitly included per `FR-008` and `SC-004`.

**Organization**: Tasks are grouped by user story (`US1` Hardened Production Images, `US2` Turnkey Compose & Auto-Migration, `US3` Bootstrap Installer & Cold-Boot Smoke Verification) to enable independent implementation and verification.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (`[US1]`, `[US2]`, `[US3]`)
- Exact file paths and verbatim constraints are included in every task description

---

## Phase 1: Setup & Build Context Hygiene (Task 17.1a)

**Purpose**: Establish repository build-context hygiene so production container builds exclude local development state, secrets, and heavy caches.

- [x] T001 Create repository `.dockerignore` at `.dockerignore` excluding `node_modules`, `src/dashboard/node_modules`, `.git`, `.env`, `.env.*` (except `.env.example` and `.env.production.example`), `storage`, `.agents/dataset`, `coverage`, `temp`, and `*.log` (`FR-001`, `SC-001`)

---

## Phase 2: User Story 1 - Hardened Multi-Stage Production Images & SPA Serving (Priority: P1) 🎯 MVP (Task 17.1b)

**Goal**: Package both the Control Plane Orchestrator and the Web Dashboard SPA into hardened multi-stage production Dockerfiles (`linux/amd64` and `linux/arm64`) running as non-root (`uid: 1001`) for the Orchestrator and serving the Dashboard with SPA history fallback and strict security headers.

**Independent Test**: `pnpm test tests/unit/production-dockerfiles.test.ts`

### Implementation for User Story 1

- [x] T002 [P] [US1] Create hardened multi-stage production Orchestrator Dockerfile in `docker/orchestrator/Dockerfile.prod` using `node:20-alpine AS builder` (`pnpm build`) and `node:20-alpine AS runner` (`NODE_ENV=production`, `PORT_CONTROL=3000`, `PORT_ARP=3001`, `pnpm install --prod --frozen-lockfile`), creating group/user `graywolf` (`uid: 1001`, `gid: 1001`), copying `/app/dist`, `/app/migrations`, `/app/src/relay`, and `/app/scripts/db-migrate-init.sh`, pre-creating `/home/graywolf/.graywolf` (`0700`) and `/app/storage/tasks`, setting `USER graywolf`, exposing ports `3000 3001`, and running `CMD ["node", "dist/orchestrator/index.js"]` (`FR-001`, `FR-002`, `SC-001`)
- [x] T003 [P] [US1] Create hardened Nginx SPA configuration in `docker/dashboard/nginx.conf` listening on port `80` with SPA fallback routing (`try_files $uri $uri/ /index.html;`), `/healthz` readiness probe (`return 200 "ok\n";`), gzip compression, immutable `/assets/` caching, and required security headers (`X-Frame-Options "DENY"`, `X-Content-Type-Options "nosniff"`, `Referrer-Policy "strict-origin-when-cross-origin"`, and `Content-Security-Policy`) (`FR-003`)
- [x] T004 [US1] Create multi-stage production Dashboard Dockerfile in `docker/dashboard/Dockerfile.prod` using `node:20-alpine AS builder` (`pnpm --filter graywolf-dashboard build`) and `nginx:1.27-alpine AS runner`, copying `/app/src/dashboard/dist` to `/usr/share/nginx/html` and `docker/dashboard/nginx.conf` to `/etc/nginx/conf.d/default.conf`, exposing port `80`, and configuring a `HEALTHCHECK` against `http://localhost:80/healthz` (`FR-001`, `FR-003`)
- [x] T005 [US1] Create unit test suite in `tests/unit/production-dockerfiles.test.ts` verifying `.dockerignore` exclusion rules, `docker/orchestrator/Dockerfile.prod` multi-stage structure + `uid: 1001` `USER graywolf` + runtime asset copies (`dist`, `migrations`, `src/relay`), and `docker/dashboard/Dockerfile.prod` + `docker/dashboard/nginx.conf` SPA `try_files` fallback and CSP/security headers (`FR-001`, `FR-002`, `FR-003`, `FR-008`, `SC-001`)

**Checkpoint**: User Story 1 (`Task 17.1`) is independently complete and verified via `tests/unit/production-dockerfiles.test.ts`.

---

## Phase 3: User Story 2 - Turnkey Production Stack Topology & Automated Schema Migration (Priority: P1) (Task 17.2)

**Goal**: Provide a turnkey `docker-compose.prod.yml` preserving the 4-network physical isolation architecture, gating `orchestrator` startup behind an idempotent `db-migrate` one-shot container, mounting `graywolf_keys` (`0600` KEK volume), and documenting all production settings in `.env.production.example`.

**Independent Test**: `pnpm test tests/integration/compose-prod-topology.test.ts`

### Implementation for User Story 2

- [x] T006 [P] [US2] Create idempotent pre-boot database migration runner script in `scripts/db-migrate-init.sh` (`chmod +x`) supporting `--dry-run`, validating `DATABASE_URL` presence, polling PostgreSQL readiness (`MAX_RETRIES=${DB_MIGRATE_RETRIES:-15}`), executing `pnpm migrate:up` (or `npx node-pg-migrate up`), and returning non-zero exit code on migration failure (`FR-005`)
- [x] T007 [P] [US2] Create production environment template in `.env.production.example` documenting `NODE_ENV=production`, `DEPLOYMENT_TOPOLOGY=solo`, `PORT_CONTROL=3000`, `PORT_ARP=3001`, `DASHBOARD_PORT=8080`, `POSTGRES_USER=graywolf`, `POSTGRES_PASSWORD=CHANGE_ME_GENERATED_BY_INSTALLER`, `POSTGRES_DB=graywolf_db`, `VALKEY_MAXMEMORY=512mb`, `MAX_CONCURRENT_CONTAINERS=3`, `CONTAINER_MEMORY_LIMIT=2g`, `GRAYWOLF_KEK_PATH=/home/graywolf/.graywolf/master.key`, `LITELLM_MASTER_KEY=sk-graywolf-CHANGE_ME`, `OTEL_ENABLED=false`, and `OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT=false` with zero hardcoded live secrets (`FR-006`)
- [x] T008 [US2] Create turnkey production compose specification in `docker-compose.prod.yml` defining `docker-proxy` (`EXEC=0`, `VOLUMES=0`, `CONTAINERS=1`, `POST=1`, `NETWORKS=1`, `IMAGES=1` on `daemon-net`), `postgres-shared` (`pgvector/pgvector:pg16` on `control-net`), `valkey` (`valkey/valkey:7.2-alpine` with `--maxmemory ${VALKEY_MAXMEMORY:-512mb} --maxmemory-policy noeviction` on `control-net`), `db-migrate` (`docker/orchestrator/Dockerfile.prod` running `sh /app/scripts/db-migrate-init.sh` with `restart: "no"` on `control-net`), `litellm-proxy` (on `control-net`), `orchestrator` (`docker/orchestrator/Dockerfile.prod` depending on `db-migrate: { condition: service_completed_successfully }` and mounting `graywolf_keys:/home/graywolf/.graywolf` across `edge-net`, `control-net`, `daemon-net`, `runner-net`), `dashboard` (`docker/dashboard/Dockerfile.prod` on `edge-net`), all 4 segmented networks (`control-net` and `daemon-net` marked `internal: true`), and all 6 persistent named volumes (`FR-004`, `FR-005`, `SC-002`)
- [x] T009 [US2] Create integration test suite in `tests/integration/compose-prod-topology.test.ts` validating `docker-compose.prod.yml` 4-network physical isolation (`control-net` & `daemon-net` internal), `docker-proxy` read-only socket & `EXEC=0`/`VOLUMES=0` flags, `db-migrate` `service_completed_successfully` dependency gating on `orchestrator`, persistent named volume mounts (`graywolf_keys`, `graywolf_pgdata`, `graywolf_valkeydata`), and `.env.production.example` variable parity (`FR-004`, `FR-005`, `FR-006`, `FR-008`, `SC-002`)

**Checkpoint**: User Story 2 (`Task 17.2`) is independently complete and verified via `tests/integration/compose-prod-topology.test.ts`.

---

## Phase 4: User Story 3 - Zero-Friction Bootstrap Installer & Cold-Boot Smoke Verification (Priority: P2) (Task 17.3)

**Goal**: Deliver a POSIX-compliant `scripts/install.sh` installer that profiles host hardware ($\le$ 8GB RAM constrained vs. standard 16GB+), generates `.env.production` with cryptographically random secrets and `.graywolf/master.key` (`0600`) without overwriting existing state, and verify the entire release with an automated E2E cold-boot smoke test suite.

**Independent Test**: `pnpm test tests/e2e/production-compose-smoke.test.ts`

### Implementation for User Story 3

- [x] T010 [US3] Create POSIX bootstrap installer script in `scripts/install.sh` (`chmod +x`) supporting `--dry-run`, `--target-dir <path>`, `--ram-mb <int>`, and `--arch <amd64|arm64>`, checking `docker` and `docker compose` prerequisites, auto-detecting host RAM (`<= 8192` MB sets constrained profile `MAX_CONCURRENT_CONTAINERS=1` and `VALKEY_MAXMEMORY=256mb`; `> 8192` MB sets standard profile `MAX_CONCURRENT_CONTAINERS=3` and `VALKEY_MAXMEMORY=512mb`), generating 64-char hex secrets in `.env.production` if absent, initializing `.graywolf/master.key` with `0600` permissions if absent, and preserving existing credentials byte-for-byte on re-runs (`FR-007`, `SC-003`)
- [x] T011 [US3] Create end-to-end production smoke test suite in `tests/e2e/production-compose-smoke.test.ts` testing `scripts/install.sh --dry-run` on both Standard (`16384` MB `amd64`) and Constrained (`8192` MB `arm64` Raspberry Pi 5) profiles, verifying `0600` permissions on `.graywolf/master.key`, proving byte-for-byte idempotency on second installer run, verifying `scripts/db-migrate-init.sh` dry-run and missing-`DATABASE_URL` failure exit codes, and verifying live Fastify Control Plane `/health` HTTP `200` readiness probe (`FR-007`, `FR-008`, `SC-003`, `SC-004`)

**Checkpoint**: User Story 3 (`Task 17.3`) is complete and verified via `tests/e2e/production-compose-smoke.test.ts`.

---

## Phase 5: Polish & Cross-Cutting Release Verification

**Purpose**: Run full repository typecheck, lint, build, and 487+ test suite verification, and mark Tasks 17.1–17.3 complete in `docs/implementation-plan-detailed.md`.

- [x] T012 Run `pnpm typecheck`, `pnpm lint`, `pnpm build`, and `pnpm test` across all repository and dashboard suites, and mark Tasks 17.1–17.3 `[x]` in `docs/implementation-plan-detailed.md` (`SC-004`)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup — `T001`)**: No dependencies — starts immediately.
- **Phase 2 (User Story 1 — `T002`..`T005`)**: Depends on `T001`. `T002` and `T003` can run in parallel (`[P]`).
- **Phase 3 (User Story 2 — `T006`..`T009`)**: Depends on Phase 2 (`Dockerfile.prod` paths). `T006` and `T007` can run in parallel (`[P]`).
- **Phase 4 (User Story 3 — `T010`..`T011`)**: Depends on Phase 3 (`.env.production.example`, `docker-compose.prod.yml`, `scripts/db-migrate-init.sh`).
- **Phase 5 (Polish — `T012`)**: Depends on all previous phases completing cleanly.

### Parallel Opportunities

- `T002` (`docker/orchestrator/Dockerfile.prod`) and `T003` (`docker/dashboard/nginx.conf`) touch distinct directories and can run in parallel.
- `T006` (`scripts/db-migrate-init.sh`) and `T007` (`.env.production.example`) touch distinct files and can run in parallel.

---

## Implementation Strategy

### MVP First (User Story 1 + User Story 2)

1. Complete Phase 1 (`.dockerignore`) and Phase 2 (`Dockerfile.prod` + `nginx.conf` + unit tests).
2. Complete Phase 3 (`docker-compose.prod.yml` + `db-migrate-init.sh` + `.env.production.example` + integration tests).
3. Complete Phase 4 (`scripts/install.sh` + E2E cold-boot smoke test suite) and Phase 5 full verification.

