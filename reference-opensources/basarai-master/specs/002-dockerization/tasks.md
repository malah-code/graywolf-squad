# Tasks: Application Containerization

**Input**: Design documents from `/specs/002-dockerization/`
**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, quickstart.md

**Tests**: No test tasks — the spec does not request automated tests. Validation is manual (docker build + docker run + health check verification).

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

---

## Phase 1: Setup & Foundational (Blocking Prerequisites)

**Purpose**: Modify existing frontend config required before any Docker build can work

**CRITICAL**: The Dockerfile depends on Next.js producing standalone output. This change must be made first.

- [X] T001 Add `output: 'standalone'` to frontend/next.config.mjs — insert `output: 'standalone'` into the nextConfig object (before the `rewrites` function). Keep existing rewrites configuration unchanged. Per research.md Decision 2, standalone mode produces a self-contained `.next/standalone/` directory with `server.js` entry point and pruned `node_modules`. Important: `.next/static/` and `public/` are NOT included in standalone output and must be copied separately in the Dockerfile.

**Checkpoint**: `cd frontend && npm run build` succeeds and produces `.next/standalone/server.js`

---

## Phase 2: US1 + US4 — Build a Deployable Container Image + Optimize Build Context (Priority: P1)

**Goal**: Produce a single container image containing both frontend and backend applications, with optimized build context excluding unnecessary files.

**Independent Test**: Run `docker build --build-arg NEXT_PUBLIC_SUPABASE_URL=https://test.supabase.co --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY=test-key -t basarai:test .` and verify the image is produced, is under 1 GB, runs as non-root, and uses pinned base image versions.

### Implementation

- [X] T002 [P] [US4] Create .dockerignore at project root — exclude: `.git`, `.gitignore`, `node_modules`, `.next`, `__pycache__`, `*.pyc`, `venv`, `.venv`, `.env`, `.env.*` (but not `.env.example`), `.idea`, `.vscode`, `.claude`, `.opencode`, `.specify`, `specs`, `docs`, `*.md` (but not `frontend/README.md`), `.DS_Store`, `coverage`, `.pytest_cache`, `.ruff_cache`, `.mypy_cache`, `supabase/.branches`, `supabase/.temp`. Per plan.md .dockerignore Contents section. Satisfies FR-009.

- [X] T003 [US1] Create Dockerfile at project root — implement 3-stage multi-stage build per plan.md Design Details:
  - **Stage 1 `frontend-builder`**: `FROM node:20-slim AS frontend-builder`. `WORKDIR /app/frontend`. Copy `frontend/package.json` and `frontend/package-lock.json`, run `npm ci`. Copy `frontend/` source. Accept `ARG NEXT_PUBLIC_SUPABASE_URL` and `ARG NEXT_PUBLIC_SUPABASE_ANON_KEY`, set as `ENV`. Run `npm run build`.
  - **Stage 2 `backend-builder`**: `FROM python:3.13-slim AS backend-builder`. `WORKDIR /app/backend`. Copy `backend/requirements.txt`, run `pip install --no-cache-dir -r requirements.txt`.
  - **Stage 3 `runtime`**: `FROM python:3.13-slim AS runtime`. Install Node.js 20 via NodeSource apt repo (`curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && apt-get install -y nodejs`). Install `tini` via apt. Clean up apt cache (`rm -rf /var/lib/apt/lists/*`). Create non-root user `appuser` (`useradd --create-home appuser`). Set `WORKDIR /app`. Copy Python site-packages from backend-builder (`COPY --from=backend-builder /usr/local/lib/python3.13/site-packages /usr/local/lib/python3.13/site-packages` and `COPY --from=backend-builder /usr/local/bin /usr/local/bin`). Copy backend source (`COPY backend/app /app/backend/app`). Copy frontend standalone build: `COPY --from=frontend-builder /app/frontend/.next/standalone /app/frontend`, `COPY --from=frontend-builder /app/frontend/.next/static /app/frontend/.next/static`, `COPY --from=frontend-builder /app/frontend/public /app/frontend/public`. Copy entrypoint: `COPY scripts/container-entrypoint.sh /app/scripts/container-entrypoint.sh` and `chmod +x`. Propagate NEXT_PUBLIC_* as runtime ENV for SSR: `ARG NEXT_PUBLIC_SUPABASE_URL`, `ARG NEXT_PUBLIC_SUPABASE_ANON_KEY`, `ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL`, `ENV NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY`. Switch to `USER appuser`. `EXPOSE 3000`. `ENTRYPOINT ["tini", "--"]`. `CMD ["/app/scripts/container-entrypoint.sh"]`.
  - Satisfies FR-001, FR-002, FR-003, FR-006, FR-010.

- [X] T004 [US1] Validate docker build — run `docker build --build-arg NEXT_PUBLIC_SUPABASE_URL=https://test.supabase.co --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY=test-key -t basarai:test .`. Verify: (1) build succeeds, (2) `docker image inspect basarai:test` shows non-root user, (3) `docker images basarai:test --format '{{.Size}}'` is under 1 GB, (4) base image tags are pinned (not `latest`), (5) `docker history basarai:test` shows no secret values in layers. Satisfies SC-001, SC-005, SC-006.

**Checkpoint**: `docker build` succeeds. Image is under 1 GB, uses pinned versions, non-root user, no secrets.

---

## Phase 3: US2 — Run the Application from a Single Container (Priority: P1)

**Goal**: Start both frontend and backend from a single container command with ordered startup, env validation, signal handling, and process crash detection.

**Independent Test**: Run `docker run -d --name basarai-test -p 3000:3000 -e SUPABASE_URL=... -e SUPABASE_SERVICE_ROLE_KEY=... -e SUPABASE_ANON_KEY=... -e SUPABASE_JWT_SECRET=... basarai:test` and verify both services respond, then `docker stop basarai-test` for graceful shutdown.

### Implementation

- [X] T005 [US2] Create scripts/container-entrypoint.sh — bash script implementing the entrypoint flow from plan.md:
  1. **Env validation (FR-013)**: Check that `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY`, `SUPABASE_JWT_SECRET` are set. If any are missing, print a descriptive error listing ALL missing variables and exit 1. Per data-model.md Runtime Environment Variables table.
  2. **Signal trap (FR-005)**: Define `cleanup()` function that sends `kill -TERM` to both backend and frontend PIDs, then `wait` for both. Register trap for SIGTERM and SIGINT.
  3. **Start backend (FR-004)**: `cd /app/backend && uvicorn app.main:app --host 127.0.0.1 --port 8000 &` and capture `BACKEND_PID=$!`. Backend binds to 127.0.0.1 only (FR-006).
  4. **Wait for backend ready**: Poll `http://127.0.0.1:8000/health` every 1 second using Python urllib (available in image). Timeout after 30 seconds. If timeout, kill backend PID and exit 1 with error message.
  5. **Start frontend**: `cd /app/frontend && HOSTNAME=0.0.0.0 PORT=3000 node server.js &` and capture `FRONTEND_PID=$!`. Frontend binds to 0.0.0.0 (publicly accessible).
  6. **Process monitoring (FR-011)**: `wait -n "$BACKEND_PID" "$FRONTEND_PID"` to block until either process exits. Capture exit code. Run cleanup to terminate the surviving process. Exit with the captured exit code.
  - Script must start with `#!/usr/bin/env bash` and `set -e`. Mark executable (`chmod +x`).
  - Satisfies FR-004, FR-005, FR-006, FR-011, FR-013.

- [X] T006 [US2] Validate container run — run the container with real or test Supabase credentials:
  1. Test env validation: `docker run --rm basarai:test` (no env vars) — should exit with descriptive error listing all 4 missing vars.
  2. Test partial env: `docker run --rm -e SUPABASE_URL=test basarai:test` — should list the 3 remaining missing vars.
  3. Test successful start: `docker run -d --name basarai-test -p 3000:3000 -e SUPABASE_URL=... -e SUPABASE_SERVICE_ROLE_KEY=... -e SUPABASE_ANON_KEY=... -e SUPABASE_JWT_SECRET=... basarai:test`. Verify `curl http://localhost:3000` responds (frontend). Verify `curl http://localhost:8000/health` from outside container FAILS (backend is internal-only). Verify `docker exec basarai-test python3 -c "import urllib.request; print(urllib.request.urlopen('http://localhost:8000/health').read().decode())"` succeeds (backend healthy internally).
  4. Test graceful shutdown: `docker stop basarai-test` — should complete within 10 seconds (SC-003). Check `docker logs basarai-test` for clean shutdown messages.
  - Satisfies SC-002, SC-003, SC-008.

**Checkpoint**: Container runs, backend starts first, frontend accessible on port 3000, backend internal-only, graceful shutdown works, env validation catches missing vars.

---

## Phase 4: US3 — Verify Container Health (Priority: P2)

**Goal**: Add a Docker HEALTHCHECK that monitors both frontend and backend processes, reporting healthy only when both are responsive.

**Independent Test**: Start the container, verify `docker inspect --format='{{.State.Health.Status}}'` transitions from `starting` to `healthy`. Then crash one process and verify it transitions to `unhealthy`.

### Implementation

- [X] T007 [US3] Add HEALTHCHECK instruction to Dockerfile — insert before `USER appuser` line:
  ```
  HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD python3 -c "import urllib.request,sys;r1=urllib.request.urlopen('http://localhost:8000/health');r2=urllib.request.urlopen('http://localhost:3000');sys.exit(0 if r1.status==200 and r2.status==200 else 1)"
  ```
  Per plan.md Health Check Configuration and research.md Decision 5. Uses Python urllib (no curl/wget install needed). `--start-period=40s` gives services time to boot. Both localhost:8000/health (backend) and localhost:3000 (frontend) must return HTTP 200. Satisfies FR-008.

- [X] T008 [US3] Validate health check — rebuild image (`docker build ...`), start container, then:
  1. Wait 45 seconds (start period), then `docker inspect --format='{{.State.Health.Status}}' basarai-test` — should be `healthy`.
  2. Verify `docker inspect --format='{{json .State.Health}}' basarai-test` shows successful health check log entries.
  - Satisfies SC-004.

**Checkpoint**: Health check reports healthy when both services are up. Docker automatically detects unhealthy state.

---

## Phase 5: US5 — Deployment Documentation (Priority: P3)

**Goal**: Provide a complete deployment runbook so an operator can deploy the container to Bunny Magic without additional guidance.

**Independent Test**: A new team member can follow the documentation to build, run, and verify the container without asking questions.

### Implementation

- [X] T009 [US5] Create docs/docker.md deployment runbook — include the following sections:
  1. **Overview**: Single-container architecture (Next.js frontend + FastAPI backend), Bunny Magic target platform, HTTP-only (platform handles HTTPS).
  2. **Prerequisites**: Docker installed, Supabase project credentials, container registry access.
  3. **Build**: `docker build` command with `--build-arg` for NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY. Note: these are baked into client JS at build time (per research.md Decision 3).
  4. **Run**: `docker run` command with all required `-e` env vars (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY, SUPABASE_JWT_SECRET). Include optional vars (STORAGE_BUCKET, ADMIN_EMAILS) with defaults. Per data-model.md Runtime Environment Variables table.
  5. **Environment Variables Reference**: Table of all build-time and runtime variables with required/optional, defaults, and descriptions. Per quickstart.md.
  6. **Verify**: How to check container health (`docker inspect`), view logs (`docker logs`), test backend internally (`docker exec`).
  7. **Bunny Magic Specific**: How to push to container registry, configure on Bunny Magic platform (port 3000, env vars, health check).
  8. **Troubleshooting**: Common issues — missing env vars (descriptive error), backend fails to start (check logs, Supabase connectivity), frontend build fails (NEXT_PUBLIC_* build args), container marked unhealthy (check both services), graceful shutdown timeout.
  9. **Architecture Notes**: Backend internal-only (127.0.0.1:8000), frontend public (0.0.0.0:3000), API proxy via Next.js rewrites, no secrets in image layers.
  - Satisfies FR-012, SC-007.

**Checkpoint**: Documentation covers build, run, verify, env vars, and troubleshooting. Complete enough for independent deployment.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: End-to-end validation and constitution compliance

- [X] T010 Run end-to-end validation per quickstart.md — follow every command in specs/002-dockerization/quickstart.md sequentially: build image, run container, verify health, view logs, stop container. All commands must succeed. Fix any issues found.

- [X] T011 Verify constitution compliance and success criteria — check all measurable outcomes:
  1. SC-001: Single build command produces working image. ✓/✗
  2. SC-002: Container serves first request within 30 seconds. ✓/✗
  3. SC-003: Graceful shutdown within 10 seconds. ✓/✗
  4. SC-004: Health check detects unhealthy within 15 seconds. ✓/✗
  5. SC-005: Image size under 1 GB. ✓/✗
  6. SC-006: No secrets in image layers (`docker history`). ✓/✗
  7. SC-008: Auth and health work in container. ✓/✗
  8. Constitution VI (Security): Backend on 127.0.0.1 only, no keys in logs/image. ✓/✗
  9. Constitution II (Key Secrecy): No secrets baked into image. ✓/✗

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup & Foundational)**: No dependencies — start immediately
- **Phase 2 (US1 + US4)**: Depends on Phase 1 (standalone output required for Dockerfile)
- **Phase 3 (US2)**: Depends on Phase 2 (needs buildable image to create entrypoint)
- **Phase 4 (US3)**: Depends on Phase 3 (needs running container to test health checks)
- **Phase 5 (US5)**: Can start after Phase 2 (documentation can be written once build works), but benefits from Phase 3-4 being complete
- **Phase 6 (Polish)**: Depends on all previous phases

### User Story Dependencies

- **US1 + US4 (P1)**: Can start after foundational — no dependencies on other stories
- **US2 (P1)**: Depends on US1 (needs the container image to exist before the entrypoint can be tested)
- **US3 (P2)**: Depends on US2 (health check only meaningful when container runs both processes)
- **US5 (P3)**: Weakly depends on US1-US3 (documentation is more accurate after all features work, but can be drafted in parallel)

### Within Each Phase

- Tasks marked [P] can run in parallel (different files)
- T002 and T003 can run in parallel (different files: .dockerignore vs Dockerfile)
- T004 depends on T003 (validates the Dockerfile)
- T006 depends on T005 (validates the entrypoint)
- T008 depends on T007 (validates the health check)

### Parallel Opportunities

```
Phase 2:
  T002 (.dockerignore) ──┐
                          ├──→ T004 (validate build)
  T003 (Dockerfile)  ────┘

Phase 3:
  T005 (entrypoint) ────→ T006 (validate run)

Phase 4:
  T007 (HEALTHCHECK) ───→ T008 (validate health)

Phase 5:
  T009 (docs) ── can start as early as Phase 2 completion
```

---

## Implementation Strategy

### MVP First (US1 + US2 Only)

1. Complete Phase 1: Add standalone output to next.config.mjs
2. Complete Phase 2: Create .dockerignore + Dockerfile, validate build
3. Complete Phase 3: Create entrypoint, validate container runs
4. **STOP and VALIDATE**: Container builds, runs, both services respond, graceful shutdown works
5. This is a deployable MVP — container works end-to-end

### Incremental Delivery

1. Phase 1 → Standalone build works locally
2. Phase 2 (US1 + US4) → Container image builds successfully (MVP build)
3. Phase 3 (US2) → Container runs both services (MVP runtime)
4. Phase 4 (US3) → Health checks enable automated monitoring
5. Phase 5 (US5) → Documentation enables repeatable deployments
6. Phase 6 → Full validation and constitution compliance

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability
- This feature creates 4 new files and modifies 1 existing file — small scope, high impact
- All validation tasks (T004, T006, T008, T010, T011) require Docker to be running locally
- The entrypoint script (T005) is the most complex artifact — reference plan.md Entrypoint Script Flow and data-model.md State Diagram
- Commit after each phase checkpoint, not after each individual task
