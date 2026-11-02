# Implementation Plan: Production Release Packaging, Multi-Arch Compose & Cold-Boot Smoke Verification (`v0.1.0-p0`)

**Branch**: `018-production-release-and-compose` | **Date**: 2026-11-01 | **Spec**: [spec.md](file:///home/tarikelmallah/Projects/GraywolfSquad/specs/018-production-release-and-compose/spec.md)  
**Input**: Feature specification from `/specs/018-production-release-and-compose/spec.md` & `docs/implementation-plan-detailed.md` Phase 17

## Summary

Complete Phase 17 (Track B Initiative B1 — Production Release Engineering & Distribution `v0.1.0-p0`) across 3 core deliverables:
1. **Task 17.1 (`docker/orchestrator/Dockerfile.prod`, `docker/dashboard/Dockerfile.prod`, `docker/dashboard/nginx.conf`, `.dockerignore`)**: Hardened multi-stage production Dockerfiles for `linux/amd64` and `linux/arm64` (Raspberry Pi 5), running the Control Plane Orchestrator as non-root user `graywolf` (`uid: 1001`, `gid: 1001`) with pruned `devDependencies`, bundled `src/relay/` and `migrations/`, and serving the React/Vite Dashboard via Nginx Alpine with SPA history fallback (`try_files $uri $uri/ /index.html`) and strict HTTP security headers (`CSP`, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`).
2. **Task 17.2 (`docker-compose.prod.yml`, `scripts/db-migrate-init.sh`, `.env.production.example`)**: Turnkey production Docker Compose stack preserving the 4-network physical segmentation (`edge-net`, internal `control-net`, internal `daemon-net`, `runner-net`) and `tecnativa/docker-socket-proxy` (`EXEC=0`, `VOLUMES=0`), adding a one-shot `db-migrate` service (`service_completed_successfully`) that runs `scripts/db-migrate-init.sh` before `orchestrator` starts, mounting the persistent `graywolf_keys` volume to `/home/graywolf/.graywolf`, and documenting all production settings in `.env.production.example`.
3. **Task 17.3 (`scripts/install.sh`, `tests/unit/production-dockerfiles.test.ts`, `tests/integration/compose-prod-topology.test.ts`, `tests/e2e/production-compose-smoke.test.ts`)**: Zero-friction POSIX bootstrap installer supporting `--dry-run`, `--target-dir`, and automatic hardware profiling ($\le$ 8GB RAM constrained vs. standard 16GB+), cryptographically random credential generation, idempotent `0600` master key creation, and a 3-layer automated unit/integration/E2E smoke verification suite.

## Technical Context

**Language/Version**: TypeScript 5.x (Node.js 20 Alpine), POSIX Shell (`/bin/sh`), Docker Compose v2, Nginx 1.27 Alpine  
**Primary Dependencies**: `node-pg-migrate`, Fastify 5.x, Vite 6.x, PostgreSQL 16 (`pgvector/pgvector:pg16`), Valkey 7.2 (`valkey/valkey:7.2-alpine`), LiteLLM Proxy, `tecnativa/docker-socket-proxy`  
**Storage**: Named Docker Volumes (`graywolf_pgdata`, `graywolf_valkeydata`, `graywolf_litellm`, `graywolf_task_storage`, `graywolf_cache_npm`, `graywolf_keys`)  
**Testing**: Vitest (`tests/unit/production-dockerfiles.test.ts`, `tests/integration/compose-prod-topology.test.ts`, `tests/e2e/production-compose-smoke.test.ts`)  
**Target Platform**: Multi-arch Linux (`linux/amd64` cloud/workstation and `linux/arm64` Raspberry Pi 5 8GB edge host)  
**Project Type**: Production container packaging, deployment topology, bootstrap installer, and automated smoke test harness  
**Performance Goals**: `< 5s` bootstrap script execution; `< 15MB` Dashboard Nginx idle RAM; constrained profile caps Valkey at `256mb` and containers at `1`  
**Constraints**: Preserve 4-network isolation (`control-net` and `daemon-net` internal); never expose raw `/var/run/docker.sock` to `orchestrator`; never overwrite existing `.env.production` or `master.key` on re-run  
**Scale/Scope**: 7 infrastructure/packaging files + 3 automated test suites

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design.*

1. **Human Sovereignty & Non-Committing Relay Contract**: **PASS** — `Dockerfile.prod` bundles `src/relay/` (`relay.mjs`, `blast-radius-guard.mjs`, `git-guard.sh`) ensuring all sandboxed tasks in production enforce the non-committing relay contract.
2. **Zero Runtime Lock-In & Permissive Licensing First**: **PASS** — All container base images (`node:20-alpine`, `nginx:1.27-alpine`, `pgvector/pgvector:pg16`, `valkey/valkey:7.2-alpine`, `tecnativa/docker-socket-proxy`) are open-source and free of proprietary lock-in.
3. **Single ACID Relational & Vector Baseline**: **PASS** — `postgres-shared` (`pgvector/pgvector:pg16`) and `db-migrate` maintain the unified PostgreSQL + `pgvector` baseline.
4. **Headless Execution & Observability**: **PASS** — `.env.production.example` and `docker-compose.prod.yml` expose opt-in OTLP configuration while defaulting to zero external egress (`OTEL_ENABLED=false`).
5. **Dual Operational Mode (Greenfield & Brownfield)**: **PASS** — Production volumes (`graywolf_task_storage`) and relay scripts support both Greenfield and Brownfield worktree execution.
6. **Virtual Developer Tier Handoff Protocol**: **PASS** — `litellm-proxy` service routes virtual model aliases across Planner, Implementer, and Reviewer tiers in production.
7. **Chat as Active Control Plane (Cockpit Rule)**: **PASS** — `dashboard` Nginx container and `orchestrator` port `3000` serve the active Chat Cockpit and WebSocket telemetry stream.
8. **Blast-Radius and Dependency Integrity**: **PASS** — Preserves the 4-network segmentation (`edge-net`, `control-net`, `daemon-net`, `runner-net`) and `docker-proxy` with `EXEC=0` and `VOLUMES=0`.
9. **Zero-Cost Open Source Foundation ($0 Platform License)**: **PASS** — Entire production distribution is 100% self-hostable at `$0` platform cost on local or edge hardware.

## Project Structure

### Documentation (this feature)

```text
specs/018-production-release-and-compose/
├── spec.md                                  # Feature specification with 5 clarifications encoded
├── plan.md                                  # This file
├── research.md                              # Phase 0 architectural research decisions
├── data-model.md                            # Phase 1 compose service matrix, networks & env model
├── quickstart.md                            # Phase 1 runnable verification guide
├── checklists/
│   └── requirements.md                      # 16/16 passing quality checklist
└── contracts/
    └── production-release-contracts.md      # Dockerfile, Nginx, Compose, Migration & Installer contracts
```

### Source Code & Packaging Artifacts (repository root)

```text
.dockerignore                                # Task 17.1: Build context exclusion rules
.env.production.example                      # Task 17.2: Documented production environment template
docker-compose.prod.yml                      # Task 17.2: Turnkey 4-network production compose stack
docker/
├── orchestrator/
│   └── Dockerfile.prod                      # Task 17.1: Multi-stage non-root (uid: 1001) orchestrator image
└── dashboard/
    ├── Dockerfile.prod                      # Task 17.1: Multi-stage Vite + Nginx Alpine SPA image
    └── nginx.conf                           # Task 17.1: SPA try_files fallback & CSP/security headers
scripts/
├── db-migrate-init.sh                       # Task 17.2: Idempotent pre-boot migration runner
└── install.sh                               # Task 17.3: POSIX bootstrap installer & hardware profiler
tests/
├── unit/
│   └── production-dockerfiles.test.ts       # Task 17.1 unit tests
├── integration/
│   └── compose-prod-topology.test.ts        # Task 17.2 integration tests
└── e2e/
    └── production-compose-smoke.test.ts     # Task 17.3 E2E cold-boot & installer smoke suite
```

**Structure Decision**: Matches the exact file paths and verification suites specified in `docs/implementation-plan-detailed.md` Phase 17 (Tasks 17.1, 17.2, and 17.3).

## Complexity Tracking

No Constitution violations or complexity exceptions required.
