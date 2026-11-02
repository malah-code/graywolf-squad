# Contracts: Production Release Packaging, Compose & Installer (`018-production-release-and-compose`)

## 1. Production Orchestrator Dockerfile Contract (`docker/orchestrator/Dockerfile.prod`)

- **Base Images**: `node:20-alpine AS builder` $\rightarrow$ `node:20-alpine AS runner` (multi-arch `linux/amd64`, `linux/arm64`).
- **Non-Root Runtime User**:
  - Group `graywolf` (`gid: 1001`) and User `graywolf` (`uid: 1001`).
  - Pre-creates `/home/graywolf/.graywolf` (`0700`) and `/app/storage/tasks` owned by `graywolf:graywolf`.
  - Runs with `USER graywolf`.
- **Included Runtime Artifacts**:
  - `/app/dist` (compiled TypeScript output)
  - `/app/migrations` (database schema migrations for `node-pg-migrate`)
  - `/app/src/relay` (`relay.mjs`, `blast-radius-guard.mjs`, `git-guard.sh`, `lanes.mjs`)
  - `/app/scripts/db-migrate-init.sh` (executable `0755`)
- **Exposed Ports**: `EXPOSE 3000 3001`
- **Entrypoint / Command**: `CMD ["node", "dist/orchestrator/index.js"]`

---

## 2. Production Dashboard Dockerfile & Nginx Contract (`docker/dashboard/Dockerfile.prod` & `docker/dashboard/nginx.conf`)

- **Base Images**: `node:20-alpine AS builder` $\rightarrow$ `nginx:1.27-alpine AS runner`.
- **Nginx Configuration (`docker/dashboard/nginx.conf`)**:
  - Listens on port `80`.
  - SPA Fallback: `location / { try_files $uri $uri/ /index.html; }`
  - Required Security Headers:
    - `add_header X-Frame-Options "DENY" always;`
    - `add_header X-Content-Type-Options "nosniff" always;`
    - `add_header Referrer-Policy "strict-origin-when-cross-origin" always;`
    - `add_header Content-Security-Policy "default-src 'self'; connect-src 'self' http: https: ws: wss:; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-eval' blob:; worker-src 'self' blob:;" always;`
  - Healthcheck endpoint: `location = /healthz { access_log off; return 200 "ok\n"; }`

---

## 3. Database Migration Runner Contract (`scripts/db-migrate-init.sh`)

- **CLI Usage**: `sh scripts/db-migrate-init.sh [--dry-run]`
- **Behavior**:
  1. Verifies `DATABASE_URL` is non-empty (exits `1` if unset).
  2. In `--dry-run` mode: validates migration directory presence (`migrations/`) and exits `0`.
  3. In live mode: polls PostgreSQL readiness up to `MAX_RETRIES` (default `15`, `2s` interval), then runs `npx node-pg-migrate up -m migrations` (or `pnpm migrate:up`).
  4. Exits `0` on idempotent migration completion; exits non-zero immediately on migration error so Docker Compose halts `orchestrator` boot.

---

## 4. Bootstrap Installer Contract (`scripts/install.sh`)

- **CLI Usage**:
  ```bash
  sh scripts/install.sh [--dry-run] [--target-dir <path>] [--ram-mb <integer>] [--arch <amd64|arm64>]
  ```
- **Exit Codes**:
  - `0`: Bootstrap initialization (and optional dry-run verification) succeeded.
  - `1`: Prerequisite missing (`docker` or `docker compose` unavailable in non-dry-run mode) or invalid arguments.
- **Idempotency & Security Guarantees**:
  1. If `<target-dir>/.env.production` does **not** exist, generates it from `.env.production.example` with unique 64-character hex secrets for `POSTGRES_PASSWORD` and `LITELLM_MASTER_KEY`, plus hardware profile values (`MAX_CONCURRENT_CONTAINERS=1` and `VALKEY_MAXMEMORY=256mb` if `ram_mb <= 8192`, else `3` and `512mb`).
  2. If `<target-dir>/.env.production` **already exists**, leaves it untouched (0 bytes overwritten).
  3. If `<target-dir>/.graywolf/master.key` does **not** exist, creates `<target-dir>/.graywolf` (`0700`) and generates a 32-byte cryptographically random key at `<target-dir>/.graywolf/master.key` with `chmod 0600`.
  4. If `<target-dir>/.graywolf/master.key` **already exists**, preserves the file byte-for-byte and enforces `0600` permissions.

