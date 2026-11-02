# Phase 0 Research: Production Release Packaging, Multi-Arch Compose & Cold-Boot Smoke Verification (`v0.1.0-p0`)

## R1: Multi-Stage Orchestrator Production Image (`docker/orchestrator/Dockerfile.prod`)

- **Decision**: Build a 2-stage `node:20-alpine` Dockerfile (`builder` and `runner`) that compiles TypeScript via `pnpm build`, prunes development dependencies (`pnpm install --prod --frozen-lockfile`), copies `dist/`, `migrations/`, `src/relay/` (needed for `relay.mjs`, `blast-radius-guard.mjs`, `git-guard.sh`, and `lanes.mjs`), creates a dedicated non-root group and user `graywolf` (`uid: 1001`, `gid: 1001`), sets ownership of `/app` and `/home/graywolf/.graywolf`, and runs `USER graywolf` on ports `3000` and `3001`.
- **Rationale**: Running the Control Plane as root inside a container violates defense-in-depth; copying `migrations/` and `src/relay/` ensures both the `db-migrate` init service and container relay injection have all runtime scripts available without shipping TypeScript sources or `devDependencies`.
- **Alternatives Considered**:
  - *Single-stage Dockerfile with `tsx`*: Rejected — retains ~300MB of devDependencies and TypeScript compiler overhead on 8GB RAM hosts.
  - *Distroless image without shell*: Rejected — `db-migrate-init.sh` and healthcheck scripts require POSIX `/bin/sh`.

## R2: Hardened Dashboard SPA Image & Nginx Configuration (`docker/dashboard/Dockerfile.prod` & `nginx.conf`)

- **Decision**: Use a 2-stage Dockerfile (`node:20-alpine` builder compiling `src/dashboard/dist` via `pnpm --filter graywolf-dashboard build` $\rightarrow$ `nginx:1.27-alpine` runtime) paired with `docker/dashboard/nginx.conf` enforcing `try_files $uri $uri/ /index.html;`, gzip compression, immutable `/assets/` cache headers, and security headers (`X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, and `Content-Security-Policy`).
- **Rationale**: Static SPA serving through Nginx Alpine uses `< 15MB` RAM, handles client-side history routing cleanly on browser refresh, and enforces strict browser security headers at the edge.
- **Alternatives Considered**:
  - *Serving Vite preview server in production*: Rejected — `vite preview` is strictly for local development and not hardened for production traffic.

## R3: Pre-Boot Database Migration Init Service (`db-migrate` & `scripts/db-migrate-init.sh`)

- **Decision**: Define a dedicated `db-migrate` service in `docker-compose.prod.yml` using the production orchestrator image (`command: ["sh", "/app/scripts/db-migrate-init.sh"]`, `restart: "no"`), depending on `postgres-shared: { condition: service_healthy }`, while `orchestrator` depends on `db-migrate: { condition: service_completed_successfully }`.
- **Rationale**: Guarantees that schema migrations (`migrations/1789444040216_create-tasks-table.js` via `pnpm migrate:up`) complete atomically before Fastify binds ports `3000` and `3001`, avoiding race conditions or partial schema boots.
- **Alternatives Considered**:
  - *Running migrations inside `startServers()` on every boot*: Rejected — couples schema DDL privileges and migration CLI tooling into the hot application startup path.

## R4: Zero-Friction POSIX Bootstrap Installer (`scripts/install.sh`)

- **Decision**: Implement a POSIX-compliant `scripts/install.sh` supporting `--dry-run`, `--target-dir <dir>`, and `--ram-mb <mb>` (for deterministic testing of constrained vs. standard host detection). It verifies `docker` and `docker compose` availability, generates 32-byte hex secrets via `openssl rand -hex 32` (or `/dev/urandom` fallback) into `.env.production` if missing, creates `.graywolf/master.key` with `chmod 0600` if missing, and auto-configures `MAX_CONCURRENT_CONTAINERS=1` / `VALKEY_MAXMEMORY=256mb` when detected RAM is $\le 8192$ MB.
- **Rationale**: Enables 1-command installation on both Ubuntu/Debian x86_64 servers and Raspberry Pi 5 (8GB ARM64) devices while guaranteeing zero credential overwrites on upgrades.
- **Alternatives Considered**:
  - *Interactive prompt wizard*: Rejected — breaks unattended CI/CD and `curl -fsSL ... | sh` execution.

