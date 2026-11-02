# Quickstart & Verification Guide: Phase 17 Production Release (`v0.1.0-p0`)

## Prerequisites

- Node.js 20+ and `pnpm` installed
- POSIX shell (`sh` / `bash`) and `openssl` (or `/dev/urandom`)

## 1. Run Unit Verification (Production Dockerfiles, `.dockerignore` & Nginx Security Headers)

```bash
pnpm test tests/unit/production-dockerfiles.test.ts
```

**Expected Outcome**: Verifies multi-stage build structure, non-root `USER graywolf` (`uid: 1001`), runtime relay & migration asset inclusion, Nginx SPA `try_files` fallback, CSP/security headers, and `.dockerignore` exclusions.

## 2. Run Integration Verification (`docker-compose.prod.yml` Topology & `db-migrate` Ordering)

```bash
pnpm test tests/integration/compose-prod-topology.test.ts
```

**Expected Outcome**: Verifies 4-network segmentation (`edge-net`, internal `control-net`, internal `daemon-net`, `runner-net`), `docker-proxy` socket restrictions (`EXEC=0`, `VOLUMES=0`), `db-migrate` `service_completed_successfully` dependency gating, persistent named volumes (`graywolf_keys`, `graywolf_pgdata`, `graywolf_valkeydata`), and `.env.production.example` variable parity.

## 3. Run End-to-End Smoke Verification (Bootstrap Installer, Constrained Profile & Health Probe)

```bash
pnpm test tests/e2e/production-compose-smoke.test.ts
```

**Expected Outcome**: Executes `scripts/install.sh --dry-run` across both Standard (`16384` MB `amd64`) and Constrained (`8192` MB `arm64` Raspberry Pi 5) profiles, verifies `0600` master key permissions, confirms idempotent re-run preservation of `.env.production` and `master.key`, tests `scripts/db-migrate-init.sh --dry-run` and failure handling, and validates the live Fastify `/health` probe.

