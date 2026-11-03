# Graywolf Squad — Master Phased Implementation Plan (Deep-Reviewed Edition)

**Status**: Authoritative Master Implementation Plan (Aligned with `docs/PRD.md` Rev 15, `docs/decisions.md` ADR-001..083, `specs/001-multi-agent-platform/data-model.md`, and `specs/001-multi-agent-platform/contracts/openapi.yaml`)  
**Target Executor**: Low-cost / high-throughput coding models (`agent-coder`, Haiku, DeepSeek-V3, local Qwen-Coder) guided via Spec Kit phase slices.  
**Operating Principle**: Every phase is first refined via **Spec Kit** (`spec.md` ➔ `plan.md` ➔ `tasks.md` ➔ `/speckit-analyze`), reviewed by the human lead, and only then executed micro-task by micro-task (`/speckit-implement`).

---

## 0. How To Use Spec Kit For Phase-by-Phase Implementation

Per `AGENTS.md`, we **never** jump straight into writing all application code at once. Instead, each phase (`P0` through `P16`) is executed using a strict **2-Stage Loop (Refine Plan ➔ Execute Phase)** powered by the repository's built-in Spec Kit skills (`.agents/skills/speckit-*`):

### The 2-Stage Loop For Every Phase

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ STAGE A: PHASE REVIEW & SPEC KIT REFINEMENT (No Application Code Written)    │
│                                                                              │
│  Step 1: Review the target Phase in `docs/implementation-plan-detailed.md`   │
│  Step 2: Run `/speckit-specify` to create `specs/<NNN>-<phase-slug>/spec.md` │
│  Step 3: Run `/speckit-clarify` (optional) to resolve any edge-case gaps     │
│  Step 4: Run `/speckit-plan` to generate `specs/<NNN>-<phase-slug>/plan.md`  │
│          (exact files, TypeBox schemas, SQL, function signatures)            │
│  Step 5: Run `/speckit-tasks` to generate `specs/<NNN>-<phase-slug>/tasks.md`│
│          (atomic, dependency-ordered `[ ] T001 ...` micro-tasks)             │
│  Step 6: Run `/speckit-analyze` to verify 100% consistency across            │
│          `spec.md`, `plan.md`, `tasks.md`, and `.specify/memory/constitution`│
│  Step 7: Human Lead reviews & approves `tasks.md`                            │
└──────────────────────────────────────┬───────────────────────────────────────┘
                                       │ (Separate Explicit Step)
                                       ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│ STAGE B: PHASE IMPLEMENTATION (Cheap AI Executes Micro-Tasks)                │
│                                                                              │
│  Step 8: Run `/speckit-implement` on `specs/<NNN>-<phase-slug>/tasks.md`     │
│          - Executes ONE task `[ ] Txxx` at a time                            │
│          - Runs the task's `Verify` command + `pnpm typecheck && pnpm lint`  │
│          - Marks `[x] Txxx` in `tasks.md` and in this master plan            │
│  Step 9: If gaps are found after execution, run `/speckit-converge`          │
└──────────────────────────────────────────────────────────────────────────────┘
```

### Existing Feature Specs in `specs/`

Before creating a new spec folder, note what already exists in `specs/`:
- `specs/001-platform-foundation/` — Thin vertical slice PoC (Fastify + Postgres + ARP port 3001 + Dockerode dummy `relay.mjs`). Partially scaffolded in `src/orchestrator/` and `migrations/`.
- `specs/001-multi-agent-platform/` — Full architecture data model (`data-model.md`) and OpenAPI 3.1 contract (`contracts/openapi.yaml`) + `contracts/relay-result.json`.
- `specs/002-addon-sdk/` — TypeBox contract stubs (`addon-interfaces.ts`) for `@graywolf/addon-sdk` (ADR-080).

### Recommended Spec Kit Feature Mapping Per Phase

| Phase | Spec Folder to Create / Use | Command to Start Refinement |
|---|---|---|
| **P0** | `specs/001-platform-foundation/` (converge & align) | `/speckit-converge` on `001-platform-foundation` |
| **P1** | `specs/003-canonical-data-model/` | `/speckit-specify` for Phase 1 Canonical Data Model & RLS |
| **P2** | `specs/004-auth-rbac-tgt/` | `/speckit-specify` for Phase 2 Better-Auth, Casbin RBAC & WS TGT |
| **P3** | `specs/005-control-plane-api-aci/` | `/speckit-specify` for Phase 3 OpenAPI v1 Routes & ACI Validation |
| **P4** | `specs/006-worktrees-locks-sandbox-db/` | `/speckit-specify` for Phase 4 Task Store, Worktrees, Locks & 3-Tier DB |
| **P5** | `specs/007-orchestrator-dag-clarification/` | `/speckit-specify` for Phase 5 BullMQ Orchestrator, DAG & Clarification |
| **P6** | `specs/008-sandbox-runner-hardening/` | `/speckit-specify` for Phase 6 Dockerode Runner, Seccomp & Egress |
| **P7** | `specs/009-arp-and-relay-harness/` | `/speckit-specify` for Phase 7 ARP Port 3001 & `relay.mjs` Harness |
| **P8** | `specs/010-litellm-gateway-and-spend/` | `/speckit-specify` for Phase 8 LiteLLM Routing, Circuit Breaker & Ledger |
| **P9** | `specs/011-recon-context-and-dev-tiers/` | `/speckit-specify` for Phase 9 Brownfield Recon, Context Bundle & Dev Tiers |
| **P10** | `specs/012-guards-and-decision-gate/` | `/speckit-specify` for Phase 10 Reactive Guards, Evidence & DecisionGate |
| **P11** | `specs/013-review-packet-and-vcs-delivery/` | `/speckit-specify` for Phase 11 `repo-sdk`, 60s Review Packet & Mandatory Gates |
| **P12** | `specs/014-cockpit-and-kanban-ui/` | `/speckit-specify` for Phase 12 React Cockpit, Kanban/DAG, BiDi & GRILL Mode |
| **P13** | `specs/015-e2e-playwright-and-bug-bash/` | `/speckit-specify` for Phase 13 Playwright E2E, Cache Replay & Bug Bash |
| **P14** | `specs/016-continuous-learning-engine/` | `/speckit-specify` for Phase 14 Reflection, Skill Curator, Stall & Compression |
| **P15** | `specs/002-addon-sdk/` (expand & implement) | `/speckit-specify` for Phase 15 `@graywolf/addon-sdk` & Shadow Mode |
| **P16** | `specs/017-secrets-cache-and-p0-exit/` | `/speckit-specify` for Phase 16 Secrets Proxy, Sub-2s Cache & P0 Exit |
| **P17** | `specs/018-production-release-and-compose/` | `/speckit-specify` for Phase 17 Production Dockerfiles, Compose Packaging & Smoke Test |
| **P18** | `specs/019-slack-and-discord-addons/` | `/speckit-specify` for Phase 18 `@graywolf/addon-slack-cockpit`, `@graywolf/addon-discord-signal` & `@graywolf/addon-msteams-cockpit` |
| **P19** | `specs/020-trajectory-compression-and-dataset/` | `/speckit-specify` for Phase 19 ADR-064 Trajectory Compression Harvester & Local SFT Dataset |

---

## 1. Golden Rules for Cheap-AI Execution (Non-Negotiable)

1. **One task = one small diff.** Touch only the files listed in the active task.
2. **Preserve existing infrastructure contracts:**
   - Do **NOT** flatten `docker-compose.yml`. Preserve its 4-network segmentation (`edge-net`, `control-net`, `daemon-net`, `runner-net`) and `tecnativa/docker-socket-proxy` (`tcp://docker-proxy:2375`).
   - Preserve the dual-port split: **Port 3000** (`PORT_CONTROL`) serves REST `/api/v1/*` and Dashboard WS; **Port 3001** (`PORT_ARP`) serves the dedicated Agent Relay Protocol (`ws://orchestrator:3001/relay`) on `runner-net`.
   - Preserve `src/orchestrator/runner/IRunnerProvider.ts` (ADR-040) as the runner abstraction.
3. **Strict Schema & Error Discipline:**
   - Use **TypeBox (`@sinclair/typebox`)** for all Fastify route schemas, ACI tool-call validation, and ARP message envelopes.
   - Every error across REST, WebSocket, and `relay.mjs` MUST use the canonical ADR-042 wire format and exact error codes from `docs/architecture/error-taxonomy-and-structured-codes.md`:
     ```json
     {
       "code": "RBAC_MERGE_NOT_AUTHORIZED",
       "message": "Non-lead/owner attempting to approve review gate or trigger VCS PR merge.",
       "details": {},
       "retryable": false,
       "timestamp": "2026-10-17T00:00:00.000Z"
     }
     ```
4. **Security & Sovereignty Invariants:**
   - `relay.mjs` NEVER executes `git commit`, `git push`, `git merge`, or `git reset --hard`.
   - Every tenant-scoped PostgreSQL table MUST have `ENABLE ROW LEVEL SECURITY` and `FORCE ROW LEVEL SECURITY` using `current_setting('app.current_workspace_id')::UUID` (and `current_setting('app.current_org_id')::UUID` for org-wide lessons).
   - No real LLM API keys or Git PATs are ever injected as container env vars. Containers receive only `OPENAI_BASE_URL=http://litellm-proxy:4000`, `OPENAI_API_KEY=sk-graywolf-internal-proxy-token`, and `RELAY_AUTH_TOKEN`.
   - System prompts are assembled **once** at container boot and remain byte-for-byte identical for the session lifetime (ADR-061 Prompt Cache Stability).

---

## 2. Canonical Repository Target Layout

This layout reconciles the existing `src/orchestrator/` files, `docker-compose.yml`, and `specs/` contracts:

```text
GraywolfSquad/
├── docker/
│   ├── orchestrator/Dockerfile
│   ├── dashboard/Dockerfile
│   ├── runner/Dockerfile
│   ├── litellm/config.yaml
│   └── postgres/init/00-extensions.sql
├── config/
│   ├── seccomp.json
│   └── rbac/
│       ├── model.conf
│       └── policy.csv
├── migrations/                          # node-pg-migrate SQL/JS migrations
├── src/
│   ├── orchestrator/
│   │   ├── index.ts                     # Dual-port bootstrap (Port 3000 Control + Port 3001 ARP)
│   │   ├── app.ts                       # Fastify Control Plane factory (/api/v1/*)
│   │   ├── config/
│   │   │   └── env.ts                   # Zod-validated environment config
│   │   ├── errors/
│   │   │   ├── taxonomy.ts              # ADR-042 canonical error codes & HTTP/WS mapping
│   │   │   └── error-handler.ts         # Fastify global setErrorHandler
│   │   ├── db/
│   │   │   ├── index.ts                 # pg Pool + withTenantContext(workspaceId, orgId, fn)
│   │   │   └── sandbox-db.ts            # 3-Tier DB isolation (Tier 0 Mock, Tier 1 Schema, Tier 2 Template Clone)
│   │   ├── schemas/
│   │   │   ├── common.ts
│   │   │   ├── task.ts                  # BriefFrontmatter & Task status enum
│   │   │   ├── project-config.ts        # project.config.json TypeBox schema
│   │   │   ├── relay-result.ts          # delegate-relay.result.v1 schema
│   │   │   ├── arp-envelope.ts          # RelayEnvelope (c2e / e2c frames)
│   │   │   └── review.ts                # findings.v1, debate.v1, final.v1
│   │   ├── auth/
│   │   │   ├── better-auth.ts           # Better-Auth setup + Valkey session cache
│   │   │   ├── rbac.ts                  # Node-Casbin enforcer + Fastify preHandler
│   │   │   ├── invites.ts               # Cryptographic 32-byte SHA-256 workspace invites
│   │   │   └── tgt.ts                   # Single-use GETDEL WebSocket Ticket-Granting Tokens
│   │   ├── aci/
│   │   │   ├── tool-schemas.ts          # TypeBox schemas for Cockpit tools
│   │   │   └── validate.ts              # Generation-time ACI validator + structured error feedback
│   │   ├── routes/
│   │   │   ├── health.ts                # GET /health & GET /api/v1/healthz
│   │   │   ├── auth.ts                  # GET /api/v1/auth/session, POST /api/v1/auth/logout
│   │   │   ├── workspaces.ts            # GET /api/v1/workspaces, invites, redeem
│   │   │   ├── projects.ts              # GET/POST /api/v1/projects, POST /:projectId/recon
│   │   │   ├── tasks.ts                 # GET/POST /api/v1/tasks, dispatch, clarification, review-gate/approve
│   │   │   ├── chat.ts                  # POST /api/v1/chat/turn, POST /api/v1/chat/stream (Vercel AI SDK + GRILL mode)
│   │   │   ├── telemetry.ts             # POST /api/v1/telemetry/ws-ticket, WS /stream
│   │   │   └── webhooks-vcs.ts          # POST /api/v1/webhooks/:provider
│   │   ├── arp/
│   │   │   ├── server.ts                # Port 3001 ARP WebSocket server (handshake, seq/ack, fsync staging)
│   │   │   └── manifest-lock.ts         # F14 distributed Valkey mutex for package manifests
│   │   ├── runner/
│   │   │   ├── IRunnerProvider.ts       # Agnostic runner interface (ADR-040)
│   │   │   ├── docker.ts                # Dockerode via tcp://docker-proxy:2375 + seccomp + mounts
│   │   │   ├── worktree.ts              # Relative-path git worktrees + safe.directory
│   │   │   ├── lock.ts                  # proper-lockfile + 15s heartbeat + 60s boot GC
│   │   │   ├── cache.ts                 # Tier 1 pkg-cache volume & Tier 2 prebake worker
│   │   │   └── admission.ts             # Hardware profiler + weighted token bucket
│   │   ├── recon/
│   │   │   ├── pipeline.ts              # 5-Phase Brownfield Reconnaissance pipeline
│   │   │   ├── fingerprint.ts           # Phase 1: Manifest & CI/CD deterministic scanner
│   │   │   ├── ast-indexer.ts           # Phase 2: Tree-sitter symbol & reference extractor
│   │   │   ├── pagerank.ts              # Phase 3: Import graph & PageRank centrality
│   │   │   ├── blast-radius.ts          # Phase 4: Algorithmic Writable/ReadOnly/Forbidden proposer
│   │   │   └── constitution-loader.ts   # Phase 5: AGENTS.md / CLAUDE.md / .cursorrules cascade
│   │   ├── context/
│   │   │   ├── repo-map.ts              # Layer 1: ~1,500-token PageRank repo map
│   │   │   ├── symbol-graph.ts          # Layer 2: find_symbol_definition / references
│   │   │   ├── hybrid-search.ts         # Layer 3: ripgrep + pgvector RRF (k=60)
│   │   │   ├── surgical-slice.ts        # Layer 4: view_file_range / replace_file_content
│   │   │   └── bundle.ts                # Immutable boot-time ContextBundle assembler (ADR-061)
│   │   ├── gateway/
│   │   │   ├── litellm-client.ts        # Virtual aliases, fallback routing
│   │   │   ├── circuit-breaker.ts       # 3-failure trip -> 2s fallback switch
│   │   │   ├── spend-ledger.ts          # ACID llm_calls writer + task/daily budget valves
│   │   │   └── cli-sub-bridge.ts        # Topology A CLI Subscription Auth Bridge (ADR-081)
│   │   ├── tiers/
│   │   │   ├── planner.ts               # Dev-Level-1 (plan.md, clarification-request.md)
│   │   │   ├── implementer.ts           # Dev-Level-3 (delegate-fleet.v1 lanes, 2-strike session reuse)
│   │   │   ├── reviewer.ts              # Dev-Level-2 (3-pass adversarial debate + 4th pass e2e explore)
│   │   │   └── arbiter.ts               # Neutral Arbiter (escalation-memo.md on 2-strike)
│   │   ├── guards/
│   │   │   ├── clean-code-guard.ts      # ast-grep rules (empty catch, zombie code, unresolved imports)
│   │   │   ├── test-guard.ts            # Mock boundary check, 0-assertion vacuity check
│   │   │   ├── doc-guard.ts             # AST symbol verification against changes.patch (ADR-083)
│   │   │   └── evidence-ledger.ts       # Passive SQLite .agent_evidence.db + Postgres verifier (ADR-062)
│   │   ├── decision-gate/
│   │   │   └── service.ts               # System-One DecisionGate (Gates 1..4, confidence fallback, ADR-079)
│   │   ├── delivery/
│   │   │   ├── repo-sdk.ts              # Multi-provider Git abstraction (GitHub/GitLab/Bitbucket/Azure/Gitea)
│   │   │   ├── review-packet.ts         # 60-Second Executive Review Packet builder
│   │   │   ├── mandatory-gates.ts       # 6 Non-Negotiable Human Approval Gates
│   │   │   └── bug-bash.ts              # Parallel Bug Bash Sprint & "No Repro, No Bug" (ADR-078)
│   │   ├── learning/
│   │   │   ├── reflection-worker.ts     # 3-axis Hermes Background Reflection (ADR-057, ADR-083)
│   │   │   ├── human-gate-diff.ts       # agent_output vs final_merged_code lesson extractor
│   │   │   ├── skill-curator.ts         # Weekly cron lifecycle (active -> stale -> archived -> deleted)
│   │   │   ├── stall-detector.ts        # Exact-failure streak, cycle & >50 cmd turn caps (ADR-058)
│   │   │   ├── compression.ts           # 80% context window auxiliary compressor (ADR-060)
│   │   │   └── trajectory-export.ts     # Opt-in fine-tuning JSONL compressor & redactor (ADR-064)
│   │   ├── addons/
│   │   │   ├── sdk.ts                   # Re-exports & runtime guards for specs/002-addon-sdk
│   │   │   ├── registry.ts              # Tier 1 signature & Tier 2 SHA-256 fail-closed loader
│   │   │   └── shadow-lifecycle.ts      # Shadow -> Graduated (20 runs, <10% discard) -> Deprecated
│   │   └── security/
│   │       ├── kek-vault.ts             # ~/.graywolf/master.key (0600) + pgcrypto AES-256 envelope encryption
│   │       ├── secrets-proxy.ts         # Unix socket Git credential helper & Secrets Broker sidecar
│   │       ├── mcp-redaction.ts         # REDACTED_MCP_SECRET_VALUE ("**********") & server-side probe merge
│   │       └── secret-scrubber.ts       # Real-time stdout/stderr regex sanitizer
│   ├── relay/
│   │   ├── relay.mjs                    # In-container PID 1 harness (ARP client, BlastRadiusGuard, git barrier)
│   │   ├── blast-radius-guard.mjs       # Synchronous file write interceptor + Rule 0 forbidden paths
│   │   ├── git-guard.sh                 # Wrapper blocking git commit / push / merge
│   │   └── lanes.mjs                    # delegate-fleet.v1 CLI adapter (claude, codex, opencode, agy)
│   └── dashboard/                       # React 18 + Vite + Tailwind + Shadcn + assistant-ui + React Flow
├── prompts/                             # Typed prompt modules + DSPy-style evaluation suites (ADR-068)
├── scripts/
│   ├── prompts-compile.ts
│   └── egress-rules.sh
└── tests/
```

---

# PHASE 0 — Bootstrap, Dual-Port Skeleton & Docker Topology Alignment

**Goal:** Align `package.json`, `tsconfig.json`, and `src/orchestrator/` with the existing 4-network `docker-compose.yml` (`PORT_CONTROL=3000`, `PORT_ARP=3001`, `DOCKER_HOST=tcp://docker-proxy:2375`).  
**Exit Criteria:** `pnpm typecheck && pnpm test` pass; `GET /health` on port 3000 returns `200`; port 3001 ARP WebSocket listener boots cleanly.

- [x] **Task 0.1 — Reconcile `package.json` & workspace scripts**
  - **Files:** `package.json`
  - **Steps:**
    1. Keep existing dependencies (`fastify`, `@fastify/websocket`, `dockerode`, `node-pg-migrate`, `pg`, `pino`) and add required core packages: `@fastify/cors`, `@fastify/helmet`, `@fastify/cookie`, `@sinclair/typebox`, `zod`, `ioredis`, `bullmq`, `proper-lockfile`, `gray-matter`, `casbin`, `picomatch`, `ws`.
    2. Add devDependencies: `vitest`, `eslint`, `@types/proper-lockfile`, `@types/ws`.
    3. Define scripts:
       - `"dev": "tsx watch src/orchestrator/index.ts"`
       - `"build": "tsc -p tsconfig.json"`
       - `"typecheck": "tsc -p tsconfig.json --noEmit"`
       - `"lint": "eslint src tests --ext .ts"`
       - `"test": "vitest run"`
       - `"migrate:up": "node-pg-migrate up"`
       - `"migrate:down": "node-pg-migrate down"`
       - `"prompts:compile": "tsx scripts/prompts-compile.ts"`
  - **Verify:** `pnpm install && pnpm typecheck`

- [x] **Task 0.2 — Environment configuration (`env.ts`) matching `docker-compose.yml`**
  - **Files:** `src/orchestrator/config/env.ts`, `.env.example`
  - **Steps:**
    1. Parse with `zod` using exact env names from `docker-compose.yml`:
       - `NODE_ENV` (`development` | `production` | `test`, default `development`)
       - `PORT_CONTROL` (default `3000`)
       - `PORT_ARP` (default `3001`)
       - `DOCKER_HOST` (default `tcp://localhost:2375` or `/var/run/docker.sock` in local fallback)
       - `DATABASE_URL` (default `postgresql://graywolf:graywolf_dev_secret@localhost:5432/graywolf_db`)
       - `VALKEY_URL` (default `redis://localhost:6379`)
       - `LITELLM_URL` (default `http://localhost:4000`)
       - `RUNNER_DOCKER_NETWORK` (default `graywolf-squad_runner-net`)
       - `STORAGE_ROOT` (default `./.agents`)
       - `RELAY_JWT_SECRET` (default dev secret in `development`/`test`, required 32+ chars in `production`)
  - **Verify:** Unit test in `tests/unit/env.test.ts` validating defaults and production requirements.

- [x] **Task 0.3 — Canonical ADR-042 Error Taxonomy & Fastify Error Handler**
  - **Files:** `src/orchestrator/errors/taxonomy.ts`, `src/orchestrator/errors/error-handler.ts`
  - **Steps:**
    1. Define `ErrorCode` union with all exact codes from `docs/architecture/error-taxonomy-and-structured-codes.md` (`AUTH_*`, `RBAC_*`, `TASK_*`, `SANDBOX_*`, `RELAY_*`, `LLM_*`, `GIT_*`, `ADDON_*`, `GATE_*`, `ACI_VALIDATION_FAILED`, `INTERNAL_SERVER_ERROR`).
    2. Map each `ErrorCode` deterministically to `{ httpStatus, retryable, wsCloseCode? }`.
    3. Export `GraywolfAppError` class and `ErrorResponseSchema` (TypeBox).
    4. Register Fastify `setErrorHandler` so both `GraywolfAppError` and schema validation errors emit `{ code, message, details, retryable, timestamp }`.
  - **Verify:** `tests/unit/error-taxonomy.test.ts` verifying every error code's HTTP status and wire format.

- [x] **Task 0.4 — Dual-Port Fastify Control Plane (3000) & ARP Server Stub (3001)**
  - **Files:** `src/orchestrator/app.ts`, `src/orchestrator/routes/health.ts`, `src/orchestrator/arp/server.ts`, `src/orchestrator/index.ts`
  - **Steps:**
    1. `health.ts`: expose `GET /health` (used by `docker-compose.yml` healthcheck) and `GET /api/v1/healthz` returning `{ ok: true, timestamp }`.
    2. `app.ts`: build Control Plane Fastify instance with `@fastify/helmet`, `@fastify/cors`, `@fastify/cookie`, `@fastify/websocket`, and `setErrorHandler`.
    3. `arp/server.ts`: build separate Fastify/WS server listening on `PORT_ARP` (3001) at `/relay`.
    4. `index.ts`: start both servers and register graceful `SIGINT`/`SIGTERM` shutdown.
  - **Verify:** `tests/integration/bootstrap.test.ts` testing `GET /health` -> 200 and ARP port 3001 boot.

- [x] **Task 0.5 — Dockerfiles for Orchestrator, Dashboard Stub & LiteLLM Config**
  - **Files:** `docker/orchestrator/Dockerfile`, `docker/litellm/config.yaml`, `docker/postgres/init/00-extensions.sql`
  - **Steps:**
    1. Create files referenced by `docker-compose.yml` so `docker compose config` and `docker compose build orchestrator` succeed.
    2. `00-extensions.sql`: `CREATE EXTENSION IF NOT EXISTS vector; CREATE EXTENSION IF NOT EXISTS pgcrypto;`
    3. `docker/litellm/config.yaml`: define virtual model aliases `agent-planner`, `agent-coder`, `agent-reviewer`, `agent-arbiter`.
  - **Verify:** `docker compose config -q` exits 0.

---

# PHASE 1 — Canonical Data Model, PostgreSQL RLS & Core Schemas

**Goal:** Implement the complete PostgreSQL 16 + `pgvector` relational schema from `specs/001-multi-agent-platform/data-model.md` §2 with mandatory Row-Level Security (RLS), plus TypeBox schemas for all file/JSON contracts.  
**Exit Criteria:** Migrations run cleanly up and down; cross-tenant queries are physically blocked by PostgreSQL RLS; all TypeBox contracts pass unit tests.

- [x] **Task 1.1 — Tenant-Aware Database Pool & RLS Transaction Helper**
  - **Files:** `src/orchestrator/db/index.ts`
  - **Steps:**
    1. Connect `Pool` via `env.DATABASE_URL`.
    2. Implement `withTenantContext<T>(ctx: { workspaceId: string; orgId?: string }, fn: (client: PoolClient) => Promise<T>): Promise<T>` which begins a transaction, executes `SELECT set_config('app.current_workspace_id', $1, true), set_config('app.current_org_id', $2, true)`, runs `fn(client)`, and commits/rolls back.
  - **Verify:** Unit test verifying `current_setting('app.current_workspace_id', true)` inside transaction.

- [x] **Task 1.2 — Full Canonical Migration (`0002_canonical_schema.js`)**
  - **Files:** `migrations/1789444040216_create-tasks-table.js` (update or supersede cleanly with `migrations/1789444050000_canonical_schema.sql` via `node-pg-migrate`)
  - **Steps:**
    1. Create all tables exactly as defined in `specs/001-multi-agent-platform/data-model.md` §2:
       - Tenancy: `organizations`, `workspaces`, `users`, `workspace_members`, `workspace_invites`, `workspace_member_identities`, `sessions`
       - Core: `projects`, `tasks` (`id VARCHAR(64) PK`, `type CHECK (type IN ('feature','bug','refactor','bug-bash-sprint'))`), `task_dependencies`, `task_artifacts` (`embedding vector(768)`), `escalations`, `task_locks`
       - Observability & Gates: `llm_calls`, `task_gate_decisions`, `review_evidence`
       - Security & Calibration: `secret_vault` (`encrypted_value BYTEA`, `encrypted_dek BYTEA`), `mcp_servers`, `confidence_calibration`
       - Learning & Context: `project_lessons` (`is_org_wide`, `embedding vector(768)`), `code_symbols`, `code_references`, `skills`, `addon_registry`
    2. Enable & force RLS (`ALTER TABLE ... ENABLE ROW LEVEL SECURITY; ALTER TABLE ... FORCE ROW LEVEL SECURITY;`) on `tasks`, `task_artifacts`, `llm_calls`, `task_gate_decisions`, `secret_vault`, `code_symbols`, `code_references`, `confidence_calibration`, `project_lessons` (with org-wide policy), and `escalations`.
    3. Create all indexes from `data-model.md` §2.
  - **Verify:** `pnpm migrate:up && pnpm migrate:down && pnpm migrate:up` + RLS isolation integration test (Workspace A cannot read Workspace B's tasks).

- [x] **Task 1.3 — Task Frontmatter (`brief.md`), `plan.md`, `review-signoff.md` & `escalation-request.md` Schemas**
  - **Files:** `src/orchestrator/schemas/task.ts`
  - **Steps:**
    1. Define TypeBox schemas matching `data-model.md` §1.1, §1.7, §1.8, §1.9.
    2. Include all canonical states: `BACKLOG`, `QUEUED`, `IN_PROGRESS`, `BLOCKED`, `AWAITING_CLARIFICATION`, `INTERNAL_REVIEW`, `INTERNAL_REVIEW_FAILED`, `GUARD_VERIFYING`, `QA_FIXING`, `VERIFICATION_FAILED`, `HUMAN_REVIEW_GATE`, `MERGED`, `REJECTED`, `ESCALATED`, `UPDATED`, `CANCELLED`.
    3. Implement markdown frontmatter parser/serializer using `gray-matter` + TypeBox validation.
  - **Verify:** `tests/unit/schemas-task.test.ts` validating every example block from `data-model.md`.

- [x] **Task 1.4 — `delegate-relay.result.v1` & `project.config.json` Schemas**
  - **Files:** `src/orchestrator/schemas/relay-result.ts`, `src/orchestrator/schemas/project-config.ts`
  - **Steps:**
    1. `relay-result.ts`: match `specs/001-multi-agent-platform/contracts/relay-result.json` (`version: 'delegate-relay.result.v1'`, `taskId` pattern `^TASK-[0-9A-Z-]+$`, `status: 'completed' | 'failed' | 'timeout' | 'circuit_tripped'`, `exitCode`, `signal`, `metrics`, `touchedFiles`, `agentReport`, `sessionRef`).
    2. `project-config.ts`: match `data-model.md` §1.5 + PRD extensions (`ui.persona: 'maker' | 'developer'`, `locale: 'ar' | 'en' | 'fr' | 'tr'`, `gatePolicy`, `aiReviewer`, `cliSubscriptionAuth`, `addons` referencing `AddonManifest` from `specs/002-addon-sdk/addon-interfaces.ts`).
  - **Verify:** `tests/unit/schemas-contracts.test.ts`.

---

# PHASE 2 — Auth, Zero-Config Solo Seed, Casbin RBAC & WS TGT

**Goal:** Enforce stateful session auth via Better-Auth + Valkey, Zero-Config Solo Mode seeding on first boot, One-Click Team Workspace invites, Casbin RBAC, and single-use `GETDEL` WebSocket Ticket-Granting Tokens.  
**Exit Criteria:** Solo mode works out of the box; role demotion/logout purges Valkey immediately (`AUTH_SESSION_REVOKED`); `viewer` is blocked from mutating endpoints (`RBAC_INSUFFICIENT_ROLE`); TGT replay returns `AUTH_TGT_ALREADY_USED`.

- [x] **Task 2.1 — Zero-Config Solo Mode Seeder & Better-Auth Session Store**
  - **Files:** `src/orchestrator/auth/better-auth.ts`, `src/orchestrator/auth/solo-seed.ts`
  - **Steps:**
    1. On startup, if `organizations` is empty, seed default `personal` organization, default workspace, and local `owner` admin user (PRD §11.2 Zero-Config Solo Mode).
    2. Back session verification with Valkey key `session:{sessionId}` -> `{ userId, email, currentWorkspaceId, currentOrganizationId, role }`.
    3. Implement `revokeUserSessions(userId)` which sets `revoked_at = NOW()` in Postgres and `DEL`s all active Valkey session keys for that user.
  - **Verify:** Integration test verifying first-boot seed and instant Valkey revocation (`AUTH_SESSION_REVOKED`).

- [x] **Task 2.2 — Cryptographic Workspace Invites (`createWorkspaceInvite` & `redeemWorkspaceInvite`)**
  - **Files:** `src/orchestrator/auth/invites.ts`
  - **Steps:**
    1. Generate 32-byte crypto-random hex token; store only its SHA-256 digest in `workspace_invites` with `target_role` (`developer` | `viewer`), `expires_at`, `max_uses`, `uses_count`.
    2. On redeem: verify hash exists (`AUTH_INVITE_INVALID`), not expired (`AUTH_INVITE_EXPIRED`), and `uses_count < max_uses` (`AUTH_INVITE_EXHAUSTED`); insert into `workspace_members`.
  - **Verify:** Unit & integration tests covering valid redeem, expired, and exhausted invite tokens.

- [x] **Task 2.3 — Casbin RBAC Enforcer & Fastify Guard**
  - **Files:** `config/rbac/model.conf`, `config/rbac/policy.csv`, `src/orchestrator/auth/rbac.ts`
  - **Steps:**
    1. Define role hierarchy `owner > lead_dev > developer > viewer`.
    2. Map permissions:
       - `viewer`: read-only (`list_workspaces`, `list_projects`, `list_tasks`, `ws_ticket_read`)
       - `developer`: + `create_task`, `dispatch_task`, `answer_clarification`, `reorder_backlog`, `chat_turn`, `change_access_mode_pill`
       - `lead_dev`: + `create_project`, `trigger_recon`, `modify_blast_radius`, `approve_review_gate`, `create_invite`, `promote_addon`
       - `owner`: + `manage_keys`, `manage_budgets`, `manage_team_roles`
    3. Throw exact taxonomy codes: `RBAC_MERGE_NOT_AUTHORIZED` (403) on `/tasks/:taskId/review-gate/approve`, `RBAC_KEY_MANAGEMENT_DENIED` (403), `RBAC_COCKPIT_TOOL_FORBIDDEN` (403), or `RBAC_INSUFFICIENT_ROLE` (403).
  - **Verify:** `tests/unit/rbac.test.ts` testing all 4 roles against all actions.

- [x] **Task 2.4 — Single-Use WebSocket Ticket-Granting Token (`GETDEL`)**
  - **Files:** `src/orchestrator/auth/tgt.ts`
  - **Steps:**
    1. `mintWsTicket({ userId, workspaceId, streamType, taskId })`: stores `tgt:{uuid}` in Valkey for 15s (10s client TTL + 5s server grace).
    2. `consumeWsTicket(ticket)`: uses atomic Valkey `GETDEL` (or Lua script) and records consumed ticket ID in a 60s tombstone key `tgt_used:{uuid}` so a second attempt returns `AUTH_TGT_ALREADY_USED` (401) and an expired ticket returns `AUTH_TGT_EXPIRED` (401).
  - **Verify:** `tests/unit/tgt.test.ts` testing valid consumption, replay (`AUTH_TGT_ALREADY_USED`), and expiry (`AUTH_TGT_EXPIRED`).

---

# PHASE 3 — Control Plane REST API (`/api/v1`) & ACI Validation

**Goal:** Implement all REST routes specified in `specs/001-multi-agent-platform/contracts/openapi.yaml` under `/api/v1` and enforce TypeBox/Zod ACI validation on all model-generated outputs (ADR-066).  
**Exit Criteria:** Every path in `openapi.yaml` is implemented and schema-validated; malformed LLM tool calls return structured self-correction errors without executing handlers.

- [x] **Task 3.1 — Auth & Workspace Routes (`/api/v1/auth/*`, `/api/v1/workspaces/*`, `/api/v1/invites/redeem`)**
  - **Files:** `src/orchestrator/routes/auth.ts`, `src/orchestrator/routes/workspaces.ts`
  - **Steps:**
    1. Implement `GET /api/v1/auth/session`, `POST /api/v1/auth/logout`.
    2. Implement `GET /api/v1/workspaces`, `POST /api/v1/workspaces/:workspaceId/invites`, `POST /api/v1/invites/redeem` matching `openapi.yaml` schemas.
  - **Verify:** Route injection tests in `tests/integration/routes-auth-workspaces.test.ts`.

- [x] **Task 3.2 — Project & Task Lifecycle Routes (`/api/v1/projects/*`, `/api/v1/tasks/*`, `/api/v1/telemetry/ws-ticket`)**
  - **Files:** `src/orchestrator/routes/projects.ts`, `src/orchestrator/routes/tasks.ts`, `src/orchestrator/routes/telemetry.ts`
  - **Steps:**
    1. Implement `GET /api/v1/projects`, `POST /api/v1/projects`, `POST /api/v1/projects/:projectId/recon` (202 queued).
    2. Implement `GET /api/v1/tasks`, `POST /api/v1/tasks`, `POST /api/v1/tasks/:taskId/dispatch`, `POST /api/v1/tasks/:taskId/clarification`, `POST /api/v1/tasks/:taskId/review-gate/approve`, `POST /api/v1/tasks/:taskId/cancel` (Panic Button endpoint).
    3. Implement `POST /api/v1/telemetry/ws-ticket`.
  - **Verify:** Route injection tests in `tests/integration/routes-projects-tasks.test.ts`.

- [x] **Task 3.3 — Agent-Computer Interface (ACI) Validation Gateway (ADR-066)**
  - **Files:** `src/orchestrator/aci/tool-schemas.ts`, `src/orchestrator/aci/validate.ts`
  - **Steps:**
    1. Define strict TypeBox schemas for all Cockpit & Agent tools: `create_task`, `reorder_backlog`, `update_blocked_by`, `pause_container`, `cancel_task`, `approve_pr_merge`, `modify_blast_radius`.
    2. `executeAuthorizedToolCall(userContext, toolName, rawArgs)`:
       - First validates `rawArgs` against TypeBox schema; if invalid, returns structured self-correction payload `{ executed: false, authorized: true, error: "ACI_VALIDATION_FAILED: ..." }`.
       - Second evaluates Casbin RBAC (`RBAC_COCKPIT_TOOL_FORBIDDEN`); if denied, logs audit event and returns `{ executed: false, authorized: false, error: "RBAC_COCKPIT_TOOL_FORBIDDEN" }`.
       - Third executes handler inside `withTenantContext`.
  - **Verify:** `tests/unit/aci-gateway.test.ts` testing invalid args, unauthorized role, and valid execution.

---

# PHASE 4 — Task Filesystem Store, Git Worktrees, Atomic Locks & 3-Tier Sandbox DB

**Goal:** Manage `.agents/tasks/<TASK_ID>/` artifacts, bi-directional Chokidar filesystem watching, relative-path Git worktrees, `proper-lockfile` directory locks, and the 3-Tier Adaptive Database Isolation Engine (PRD §5.2–5.4).  
**Exit Criteria:** Editing `brief.md` syncs to Postgres; worktrees use relative `.git` pointers; stale locks (>60s) are garbage-collected on boot; Tier 2 template DB clones in <300ms.

- [x] **Task 4.1 — Task Directory Manager & Chokidar Watcher**
  - **Files:** `src/orchestrator/runner/task-store.ts`, `src/orchestrator/runner/task-watcher.ts`
  - **Steps:**
    1. Manage `.agents/tasks/<TASK_ID>/` files (`brief.md`, `plan.md`, `changes.patch`, `result.json`, `verification.md`, `review-signoff.md`, `escalation-request.md`, `escalation-memo.md`, `clarification-request.md`, `e2e-cache/`, `review/`).
    2. Compute SHA-256 `content_hash` and sync metadata to `task_artifacts` table.
    3. Watch `.agents/tasks/**/brief.md` via `chokidar` (debounced 200ms) so developer disk edits trigger mid-flight minor injection (`task.inject`) or major pivot (`UPDATED` + worktree snapshot).
  - **Verify:** `tests/integration/task-store.test.ts`.

- [x] **Task 4.2 — Relative-Path Git Worktree Manager**
  - **Files:** `src/orchestrator/runner/worktree.ts`
  - **Steps:**
    1. Provision isolated worktree via `git worktree add` for branch `worktree-<taskId>` (or parent task's branch when DAG Branch Stacking §12.2 is active).
    2. Rewrite `.git` file inside the worktree to use a **relative pointer** (`gitdir: ../../.git/worktrees/...`) so paths resolve identically on host and inside Docker containers.
    3. Support `snapshotWorktree(taskId)` (used before major requirement pivots) and `restoreWorktree(taskId)` (`git restore . && git clean -fd`, used by Panic Button).
  - **Verify:** `tests/integration/worktree.test.ts` creating a worktree, verifying relative `gitdir:`, and cleaning up.

- [x] **Task 4.3 — Atomic Directory Locking (`proper-lockfile`) & Startup GC**
  - **Files:** `src/orchestrator/runner/lock.ts`
  - **Steps:**
    1. Acquire directory lock at `.agents/locks/<TASK_ID>.lock` using `proper-lockfile` and write `metadata.json` (`taskId`, `pid`, `containerId`, `acquiredAt`, `lastHeartbeat`, `staleTimeoutMs: 30000`).
    2. Emit heartbeat every 15s updating `lastHeartbeat` in `metadata.json` and `task_locks`.
    3. Implement `pruneStaleResourcesOnBoot()` (Constitution Principle 8): garbage-collect locks older than 60s, prune orphan worktrees, and teardown dangling `gw-task-*` containers.
  - **Verify:** `tests/unit/lock.test.ts` testing lock contention (`TASK_LOCK_CONTENTION`) and 60s stale lock recovery.

- [x] **Task 4.4 — 3-Tier Adaptive Database Isolation Engine (PRD §5.4)**
  - **Files:** `src/orchestrator/db/sandbox-db.ts`
  - **Steps:**
    1. Implement tier resolution hierarchy: Human Task Override > Pre-flight File Pattern Analyzer (`**/migrations/**`, `*.sql`, `schema.prisma`, `alembic`) > Dev-Level-1 `plan.md` declaration > Global Config Default.
    2. **Tier 0 (`tier-0-mock`)**: returns no DB connection string.
    3. **Tier 1 (`tier-1-shared-db`)**: creates isolated schema `CREATE SCHEMA IF NOT EXISTS task_<sanitized_id>` in shared dev DB and returns connection string with `?options=-c%20search_path%3Dtask_<id>,public`.
    4. **Tier 2 (`tier-2-isolated-db`)**: executes `CREATE DATABASE task_<id> TEMPLATE graywolf_template` (<300ms copy-on-write clone), optionally seeds synthetic Faker fixtures from `constitution.md` (§12.2), and drops the database on task teardown.
  - **Verify:** `tests/integration/sandbox-db.test.ts` verifying Tier 0, Tier 1 schema isolation, and Tier 2 template clone + teardown.

---

# PHASE 5 — Orchestrator State Machine, BullMQ DAG Engine & Clarification Protocol

**Goal:** Implement the canonical task state machine (`data-model.md` §3), topological `blockedBy` DAG scheduling, Pre-Dispatch Scope Overlap checking (ADR-031), and the Clarification Subtask Protocol (PRD §4.3).  
**Exit Criteria:** Tasks with unresolved `blockedBy` or overlapping `writableScope` wait in queue; ambiguity spawns a blocking child subtask and resumes the parent on resolution.

- [x] **Task 5.1 — Canonical Task State Machine**
  - **Files:** `src/orchestrator/services/state-machine.ts`
  - **Steps:**
    1. Encode exact legal transitions from `data-model.md` §3 (`BACKLOG` ➔ `QUEUED` ➔ `IN_PROGRESS` ➔ `INTERNAL_REVIEW` ➔ `GUARD_VERIFYING` ➔ `HUMAN_REVIEW_GATE` ➔ `MERGED`/`REJECTED`, plus branches for `BLOCKED`/`AWAITING_CLARIFICATION`, `INTERNAL_REVIEW_FAILED`, `QA_FIXING`, `VERIFICATION_FAILED`, `ESCALATED`, `UPDATED`, `CANCELLED`).
    2. Throw `TASK_INVALID_STATE_TRANSITION` (409) on illegal transitions.
  - **Verify:** `tests/unit/state-machine.test.ts` testing every valid and invalid state transition.

- [x] **Task 5.2 — DAG Topological Scheduler & Pre-Dispatch Scope Overlap Checker**
  - **Files:** `src/orchestrator/services/dag.ts`
  - **Steps:**
    1. Detect dependency cycles on task creation/update (`TASK_INVALID_STATE_TRANSITION` / cycle error).
    2. Check `isTaskReady(task)`: all `blockedBy` tasks must be `MERGED` (or have a completed parent branch when DAG Branch Stacking is enabled).
    3. Check `hasWritableScopeOverlap(candidateTask, activeTasks)`: using `picomatch`, ensure two tasks with overlapping `writableScope` globs (or shared package manifests per F14) never execute concurrently.
  - **Verify:** `tests/unit/dag.test.ts` covering cycle detection, `blockedBy` gating, and glob overlap serialization.

- [x] **Task 5.3 — Clarification Question Protocol & Blocking Child Subtasks (PRD §4.3)**
  - **Files:** `src/orchestrator/services/clarification.ts`
  - **Steps:**
    1. Enforce `maxClarificationQuestions: 5` per round and `maxClarificationRounds: 2` (`TASK_CLARIFICATION_LIMIT_REACHED`).
    2. On `clarification.request`: write `clarification-request.md`, transition parent to `AWAITING_CLARIFICATION`, create child task `<TASK_ID>.1: [CLARIFICATION REQUIRED] <topic>` assigned to human, and broadcast Cockpit notification.
    3. On `POST /api/v1/tasks/:taskId/clarification`: mark child `MERGED`, append answers to `plan.md`, send ARP `clarification.response` to active container, and transition parent back to `IN_PROGRESS`.
  - **Verify:** `tests/unit/clarification.test.ts`.

- [x] **Task 5.4 — BullMQ Orchestrator Worker & Panic Button Teardown (PRD §12.1)**
  - **Files:** `src/orchestrator/workers/orchestrator.ts`
  - **Steps:**
    1. BullMQ worker on `task-dispatch` queue checking Admission Control capacity + DAG readiness + Scope Overlap before calling `IRunnerProvider.startSandbox`.
    2. Implement `cancelTaskExecution(taskId, reason)` ("Panic Button"): sends ARP `task.cancel`, kills container process group via `teardownSandbox`, aborts in-flight LiteLLM requests, drops ephemeral Tier 1/2 sandbox DB, restores git worktree (`git restore .`), releases lock, and transitions task to `CANCELLED`.
  - **Verify:** `tests/integration/orchestrator-cancel.test.ts`.

---

# PHASE 6 — Hardened Docker Sandbox Runner & Resource Admission

**Goal:** Implement `DockerRunnerProvider` (`IRunnerProvider`) communicating through `tcp://docker-proxy:2375` with full OS hardening (UID 10001, `--read-only`, `--cap-drop=ALL`, seccomp, default-deny egress) and host hardware profiling (PRD §13.3, §15).  
**Exit Criteria:** Containers run as `10001:10001` with read-only rootfs and seccomp; Constrained Profile (≤8GB RAM) caps concurrency to 1 and container RAM to 2GB.

- [x] **Task 6.1 — Seccomp Profile & Hardened `DockerRunnerProvider`**
  - **Files:** `config/seccomp.json`, `src/orchestrator/runner/docker.ts`
  - **Steps:**
    1. Author `config/seccomp.json` blocking `ptrace`, `bpf`, `chroot`, `mount`, `umount2`, `unshare`, `setns`, `kexec_load`, `init_module`.
    2. Implement `DockerRunnerProvider implements IRunnerProvider` using `dockerode` pointed at `env.DOCKER_HOST`:
       - User: `'10001:10001'`
       - `HostConfig`: `ReadonlyRootfs: true`, `CapDrop: ['ALL']`, `SecurityOpt: ['no-new-privileges:true', ...seccomp]`, `NetworkMode: env.RUNNER_DOCKER_NETWORK` (`runner-net`).
       - `Tmpfs`: `/tmp:rw,noexec,nosuid,size=512m`, `/scratch/spill:rw,noexec,nodev,size=2g`.
       - Bind mounts: worktree -> `/workspace:rw`, parent `.git` -> `:ro`, `pkg-cache-<projectId>` -> `/home/graywolf/.npm:rw`, `src/relay` -> `/relay:ro`.
       - Detect exit code `137` and map to `SANDBOX_OOM_KILLED`.
  - **Verify:** `tests/unit/docker-runner.test.ts` inspecting generated Dockerode `CreateContainerOptions`.

- [x] **Task 6.2 — Hardware Profiler & Weighted Admission Token Bucket (PRD §15)**
  - **Files:** `src/orchestrator/runner/admission.ts`
  - **Steps:**
    1. Profile host via `os.totalmem()` and `os.cpus()`.
    2. If RAM ≤ 8GB (`Constrained Profile`, e.g. Raspberry Pi 5): cap `maxConcurrentContainers = 1`, container memory `--memory=2g`, and Playwright flags `--single-process --disable-gpu`.
    3. If RAM ≥ 16GB (`Standard Profile`): default `maxConcurrentContainers = 3`, container memory `--memory=4g`.
    4. Implement weighted token bucket: Tier 0 = `1.0`, Tier 1 = `2.0`, Tier 2 = `3.0`, + `0.5` for E2E browser tasks (Tier 2 + E2E = `3.5` tokens).
  - **Verify:** `tests/unit/admission.test.ts` testing 8GB vs 16GB profiles and token bucket queueing.

- [x] **Task 6.3 — Sandbox Network Egress Firewall Script (PRD §13.3)**
  - **Files:** `scripts/egress-rules.sh`, `docker/runner/Dockerfile`
  - **Steps:**
    1. `docker/runner/Dockerfile`: Node 20 + Git + `ripgrep` + `ast-grep` + `gitleaks` + `osv-scanner` + Playwright Chromium + non-root user `graywolf` (`10001:10001`).
    2. `scripts/egress-rules.sh`: configure `DOCKER-USER` iptables rules for `runner-net` allowing only `orchestrator:3001` (ARP), `litellm-proxy:4000`, local secrets proxy socket, and allowlisted package registries / Git remotes, dropping all other outbound traffic (including `orchestrator:3000`, Postgres, and Valkey).
  - **Verify:** `bash -n scripts/egress-rules.sh` syntax check + unit test of rule generator.

---

# PHASE 7 — Agent Relay Protocol (ARP Port 3001) & `relay.mjs` Harness

**Goal:** Implement the complete ARP WebSocket protocol (`docs/architecture/relay-protocol-and-websocket-contract.md`) and the in-container `relay.mjs` harness (`docs/architecture/relay-mjs-contract.md`).  
**Exit Criteria:** Handshake, 15s heartbeats, `seq`/`ack` with `fsync`-before-ack crash reconstruction, F14 manifest mutex, synchronous `BlastRadiusGuard`, and Git barrier (`git-guard.sh`) all pass integration tests.

- [x] **Task 7.1 — ARP Envelope Schema & Port 3001 Server (`arp/server.ts`)**
  - **Files:** `src/orchestrator/schemas/arp-envelope.ts`, `src/orchestrator/arp/server.ts`, `src/orchestrator/arp/manifest-lock.ts`
  - **Steps:**
    1. Define TypeBox schemas for `RelayEnvelope` and all `c2e` (`task.dispatch`, `task.cancel`, `task.inject`, `clarification.response`, `review.feedback`, `budget.warning`, `budget.exceeded`, `manifest.lock.granted`, `manifest.lock.rejected`, `heartbeat.ping`) and `e2c` (`status.update`, `event.stream`, `terminal.chunk`, `cost.delta`, `file.mutation`, `manifest.lock.acquire`, `manifest.lock.release`, `clarification.request`, `escalation.emit`, `artifact.ready`, `result.final`, `heartbeat.pong`) messages.
    2. Authenticate `ws://orchestrator:3001/relay?taskId=...&token=...` using ephemeral 5-min JWT (`RELAY_AUTH_TOKEN`); close with `4001` if invalid or `4004` if task not found.
    3. Implement idempotent ingestion by `(taskId, seq)` for `file.mutation`: `fsync` snapshot to staging disk *before* sending `ack`, and track `reconstructionFidelity: 'complete' | 'gapped'` with `missingSequences`.
    4. Implement 15s `heartbeat.ping`/`pong` monitor (3 missed pings -> `SANDBOX_HEARTBEAT_TIMEOUT`).
    5. Implement F14 `manifest-lock.ts`: Valkey mutex `workspace:{workspace_id}:lock:manifest:{hash(manifest_path)}` (60s TTL, 120s wait timeout).
  - **Verify:** `tests/integration/arp-server.test.ts` testing handshake, duplicate `seq` idempotency, `fsync`-before-ack, and F14 manifest lock.

- [x] **Task 7.2 — Synchronous `BlastRadiusGuard` & `git-guard.sh`**
  - **Files:** `src/relay/blast-radius-guard.mjs`, `src/relay/git-guard.sh`
  - **Steps:**
    1. `blast-radius-guard.mjs`: enforce Rule 0 Always-Forbidden paths (`.git/**`, `.agents/project.config.json`, `.agents/constitution.md`, `relay.mjs`), then evaluate `forbiddenGlobs` (hard halt -> `RELAY_BLAST_RADIUS_VIOLATION`, exit code 2), `writableGlobs` (allow), `readonlyGlobs` (escalate), default deny (escalate).
    2. `git-guard.sh`: intercept `git commit`, `git push`, `git merge`, `git rebase`, `git reset --hard` -> exit 2 with `RELAY_GIT_BARRIER_VIOLATION`. Allow `git status`, `git diff`, `git add -N` / `git add -A` (for binary diff staging during Phase 3 teardown).
  - **Verify:** `tests/unit/blast-radius-guard.test.ts` and `tests/unit/git-guard.test.ts`.

- [x] **Task 7.3 — In-Container `relay.mjs` Harness & `delegate-fleet.v1` Lanes**
  - **Files:** `src/relay/relay.mjs`, `src/relay/lanes.mjs`
  - **Steps:**
    1. Connect to `RELAY_ORCHESTRATOR_URL` with `RELAY_AUTH_TOKEN`, receive `task.dispatch`, unpack context bundle, and initialize `SpendAccumulator` (80% `budget.warning`, 100% halt `RELAY_SPEND_CEILING_HIT`).
    2. Maintain ring buffer (1000 msgs / 10MB); drop oldest `terminal.chunk` on backpressure; never drop `file.mutation`, `artifact.ready`, `cost.delta`, `result.final` (spill to `/scratch/spill/`).
    3. Dispatch implementation via `lanes.mjs` (`feature -> claude`, `tests -> codex`, `ui -> opencode`, `complex -> agy`) with JSON-RPC 2.0 ACP stdio streaming and Two-Strike session mapping (Strike 1 fresh `--brief`, Strike 2 incremental `--session <id>`).
    4. On teardown: write `.agent_status.json` (ADR-059), generate `changes.patch` (`git diff --binary --full-index HEAD`), write `result.json` (`delegate-relay.result.v1`), transmit `result.final` with retry-until-ack, and exit 0.
  - **Verify:** `tests/integration/relay-harness.test.ts` running `relay.mjs` against the Port 3001 ARP server.

---

# PHASE 8 — LiteLLM Gateway, Circuit Breaker & Token Spend Governance

**Goal:** Route all model calls through LiteLLM Proxy using virtual aliases, trip circuit breakers to fallback providers on 3 consecutive 429/500s, log every call to `llm_calls`, and enforce task/daily spend caps + CLI Subscription Auth Bridge (PRD §6).  
**Exit Criteria:** 3 failures switch to fallback within 2s; local Ollama calls log `$0.00`; hitting `spendLimitUSD` halts task with `TASK_SPEND_LIMIT_EXCEEDED`.

- [x] **Task 8.1 — LiteLLM Client, Virtual Aliases & Circuit Breaker**
  - **Files:** `src/orchestrator/gateway/litellm-client.ts`, `src/orchestrator/gateway/circuit-breaker.ts`
  - **Steps:**
    1. Route `agent-planner`, `agent-coder`, `agent-reviewer`, `agent-arbiter` via `env.LITELLM_URL`.
    2. Track consecutive HTTP 429/500 errors per provider; at threshold `3`, trip circuit breaker and route to `fallback` alias within 2s (`LLM_PROVIDER_RATE_LIMITED` / `LLM_CIRCUIT_BREAKER_TRIPPED`).
  - **Verify:** `tests/unit/circuit-breaker.test.ts`.

- [x] **Task 8.2 — ACID Token & Cost Ledger (`llm_calls`) + Budget Valves**
  - **Files:** `src/orchestrator/gateway/spend-ledger.ts`, `src/orchestrator/gateway/cli-sub-bridge.ts`
  - **Steps:**
    1. Record every LLM call in `llm_calls` (`task_id`, `workspace_id`, `org_id`, `persona`, `model`, `provider`, `input_tokens`, `output_tokens`, `cache_read_tokens`, `cache_write_tokens`, `cost_usd`, `latency_ms`, `status`).
    2. Local providers (`ollama`, `vllm`, `llamacpp`) record `cost_usd = 0`.
    3. Topology A CLI Subscription Auth Bridge (ADR-081 Pattern 4): when `cliSubscriptionAuth` is active in Topology A, record `cost_usd = 0` and `provider = 'cli-subscription-{provider}'`, enforcing wall-clock and turn-count caps instead of USD caps; silently ignore in Topology B/C.
    4. Atomically increment `tasks.current_spend_usd`; emit `budget.warning` at 80% and `budget.exceeded` (`TASK_SPEND_LIMIT_EXCEEDED`) at 100%; enforce `dailySpendCapUSD` (`LLM_DAILY_BUDGET_EXCEEDED`).
  - **Verify:** `tests/unit/spend-ledger.test.ts`.

---

# PHASE 9 — Brownfield Reconnaissance, 8-Layer Context Engine & Virtual Developer Tiers

**Goal:** Implement the 5-Phase Brownfield Reconnaissance Pipeline (`docs/architecture/brownfield-reconnaissance-and-blast-radius.md`), the 8-Layer Context Bundle (`docs/architecture/context-and-memory.md`), and the Dev-Level-1 ➔ Dev-Level-3 ➔ Dev-Level-2 (3-Pass Adversarial Debate) ➔ Neutral Arbiter pipeline (PRD §2.2, §4).  
**Exit Criteria:** Recon Phasen 1–4 use 0 LLM tokens and output `recon-report.md` + bounded blast radius; Dev-Level-2 runs 3-pass debate (`findings.v1` ➔ `debate.v1` ➔ `final.v1`) where `withdrawn` findings never count as a strike.

- [x] **Task 9.1 — 5-Phase Brownfield Reconnaissance Pipeline & Convention Discovery**
  - **Files:** `src/orchestrator/recon/fingerprint.ts`, `src/orchestrator/recon/ast-indexer.ts`, `src/orchestrator/recon/pagerank.ts`, `src/orchestrator/recon/blast-radius.ts`, `src/orchestrator/recon/constitution-loader.ts`, `src/orchestrator/recon/pipeline.ts`
  - **Steps:**
    1. **Phase 1 (`fingerprint.ts`)**: 0-token detection of frameworks, ORMs, test runners, and CI/CD files (auto-classifying CI/CD into Forbidden Scope).
    2. **Phase 2 (`ast-indexer.ts`)**: Tree-sitter extraction populating `code_symbols` and `code_references`.
    3. **Phase 3 (`pagerank.ts`)**: directed import graph + PageRank centrality score per file.
    4. **Phase 4 (`blast-radius.ts`)**: Rule 0 Forbidden defaults + keyword feature root -> `writableScope` + upstream imports -> `readOnlyScope` + bounded downstream dependents (`depth <= 1`, max `20` files by PageRank) -> `readOnlyScope`.
    5. **Phase 5 (`constitution-loader.ts` & `pipeline.ts`)**: ingest `AGENTS.md`, `CLAUDE.md`, `.cursorrules`, `.windsurfrules` (ADR-038 cascade) and emit `.agents/recon-report.md` + initial `.agents/constitution.md`.
  - **Verify:** `tests/integration/recon-pipeline.test.ts` on a multi-module TypeScript fixture repo.

- [x] **Task 9.2 — 8-Layer Context Bundle & Exploration Engine (Boot-Time Immutable)**
  - **Files:** `src/orchestrator/context/repo-map.ts`, `src/orchestrator/context/symbol-graph.ts`, `src/orchestrator/context/hybrid-search.ts`, `src/orchestrator/context/surgical-slice.ts`, `src/orchestrator/context/bundle.ts`
  - **Steps:**
    1. Layer 1: PageRank-sorted topological repo map capped at ~1,500 tokens.
    2. Layer 2: `find_symbol_definition` and `find_symbol_references` backed by `code_symbols` / `code_references`.
    3. Layer 3: Hybrid lexical (`ripgrep`) + dense (`pgvector` `nomic-embed-text` 768-dim) search fused via Reciprocal Rank Fusion (`RRF`, `k = 60`).
    4. Layer 4: `view_file_range` and `replace_file_content`.
    5. Layers 5–8: Project State Summary, Project Memory & Anti-Patterns (`project_lessons`), Architecture Context (`constitution.md`, `data-model.md`), and gated Internet Search logger.
    6. Assemble once at container boot (`bundle.ts`) to guarantee ADR-061 Prompt Cache Stability.
  - **Verify:** `tests/unit/context-bundle.test.ts`.

- [x] **Task 9.3 — Dev-Level-1 (Planner) & Dev-Level-3 (Implementer + `e2e mcp` Authoring)**
  - **Files:** `src/orchestrator/tiers/planner.ts`, `src/orchestrator/tiers/implementer.ts`
  - **Steps:**
    1. `planner.ts`: honors `simplebugs.skipPlanning` and Access Mode Pill (`Plan / Read-Only`, `Plan-Gate`, `Full Factory`); generates `plan.md` in operator's configured `locale` (`ar|en|fr|tr`, keeping code/paths LTR per ADR-081); validates planned files against `BlastRadiusGuard`.
    2. `implementer.ts`: orchestrates `delegate-fleet.v1` execution; for `ui` or `mandatory-e2e` tasks, exposes in-container Chromium MCP tools (`browser_observe`, `browser_locate`, `browser_act` locked to preview server origin, wrapping output in `<untrusted_browser_observation>` tags per ADR-077).
  - **Verify:** `tests/unit/planner-implementer.test.ts`.

- [x] **Task 9.4 — Dev-Level-2 (3-Pass Adversarial Debate) & Neutral Arbiter (`agent-arbiter`)**
  - **Files:** `src/orchestrator/schemas/review.ts`, `src/orchestrator/tiers/reviewer.ts`, `src/orchestrator/tiers/arbiter.ts`
  - **Steps:**
    1. Implement `findings.v1` (Pass 1 main reviewer, confidence ≥ 0.5), `debate.v1` (Pass 2 independent model family refutes/confirms + gap sweep), and `final.v1` (Pass 3 verdicts: `agreed`, `contested`, `withdrawn`).
    2. Cross-check against `.agent_evidence.db` (ADR-062): any `agreed P0/P1` claiming test failure without a matching failing `test` event in the evidence ledger is auto-downgraded to `P2` advisory.
    3. Strike accounting: `withdrawn` -> 0 strikes; `contested` -> 0 strikes (routes to Escalation Decision Memo); `agreed P0/P1` -> +1 strike.
    4. On 2 consecutive strikes: invoke `arbiter.ts` (`agent-arbiter`) to synthesize `escalation-memo.md` (plain-English dispute summary, Option A/B trade-offs, recommended default) and transition to `INTERNAL_REVIEW_FAILED`.
  - **Verify:** `tests/unit/adversarial-review.test.ts` testing `agreed`, `contested`, `withdrawn`, and evidence-ledger downgrade.

---

# PHASE 10 — Reactive Quality Guards, Passive Evidence Ledger & System-One DecisionGate

**Goal:** Implement the 3 deterministic external QA guards (`Clean-Code`, `Test`, `Doc`), the passive SQLite/Postgres verification evidence ledger (ADR-062), and the Fastify `DecisionGate` service (Gates 1–4, ADR-079).  
**Exit Criteria:** Defective patches (empty catch, mocked internal domain, undocumented symbol drift) trigger `QA_FIXING`; Gate 4 fast-screens confident logic errors in <150ms without burning 3-pass debate tokens.

- [x] **Task 10.1 — Passive Verification Evidence Ledger (ADR-062)**
  - **Files:** `src/orchestrator/guards/evidence-ledger.ts`
  - **Steps:**
    1. Record every in-container `test`, `lint`, `typecheck`, `build`, and `browser-test` command execution to `<worktree>/.agent_evidence.db` (SQLite) and mirror summary rows to `review_evidence` in Postgres.
  - **Verify:** `tests/unit/evidence-ledger.test.ts`.

- [x] **Task 10.2 — Deterministic Clean-Code, Test & Doc Guards (ADR-083)**
  - **Files:** `src/orchestrator/guards/clean-code-guard.ts`, `src/orchestrator/guards/test-guard.ts`, `src/orchestrator/guards/doc-guard.ts`
  - **Steps:**
    1. `clean-code-guard.ts`: `ast-grep` checks for empty catch blocks / swallowed errors, unhandled promise rejections, zombie commented code, and hallucinated/banned imports (verified against orchestrator-side `recon-report.json` per F14).
    2. `test-guard.ts`: checks that mocks target only external infrastructure (never internal domain modules), rejects 0-assertion vacuous tests, and verifies real test execution in `.agent_evidence.db`.
    3. `doc-guard.ts`: Tree-sitter AST symbol check confirming every exported symbol, CLI flag, or config key referenced in PR description / README diff exists in `changes.patch`.
    4. Emit `verification.md` (`data-model.md` §1.3); on failure transition to `QA_FIXING` (up to `qaMaxRetries: 3`, then `VERIFICATION_FAILED`).
  - **Verify:** `tests/unit/guards.test.ts` with synthetic passing and failing patches.

- [x] **Task 10.3 — System-One `DecisionGate` Service (Gates 1–4, ADR-079)**
  - **Files:** `src/orchestrator/decision-gate/service.ts`
  - **Steps:**
    1. **Gate 1 (`sandbox_tier`)**: classifies task into `tier-0-mock`, `tier-1-shared-db`, or `tier-2-isolated-db`.
    2. **Gate 2 (`gate_policy`)**: scores patch risk (`low`, `medium`, `high`, `critical`) and sensitive file touches; `low` + green tests + confidence ≥ 0.90 auto-promotes to `auto`; `high`/`critical` enforces `mandatory-human`.
    3. **Gate 3 (`relay_tool`)**: pre-authorizes `bash_execute` calls against destructive commands (`rm -rf`, `DROP TABLE`, secret exfiltration).
    4. **Gate 4 (`two_strike_prescreen`)**: pre-screens test failures and deterministic guard violations; if logic error confidence ≥ 0.90, dispatches accelerated Strike-1 rework brief skipping the 3-pass debate (Strike-2 always requires full ADR-056 debate).
    5. Confidence fallback: if confidence `< 0.85` (`< 0.90` for security/gate routing) or backend unavailable (`GATE_LOW_CONFIDENCE_FALLBACK`), fall back seamlessly to frontier reasoning. Persist all evaluations to `task_gate_decisions`.
  - **Verify:** `tests/unit/decision-gate.test.ts`.

---

# PHASE 11 — Configurable Gate Policy, 60-Second Review Packet & `repo-sdk` PR Delivery

**Goal:** Deliver verified patches as native Pull/Merge Requests via `repo-sdk` with the 7-part 60-Second Executive Review Packet, AI PM reviewer persona, 6 Non-Negotiable Human Gates, Confidence Calibration (Gap 9), and PR comment webhook loop (PRD §8, §10.1).  
**Exit Criteria:** Orchestrator commits verified `changes.patch` on the task branch, opens a PR containing the 60-second packet, enforces all 6 mandatory human gates, and resumes sandbox on PR review comments.

- [x] **Task 11.1 — Provider-Agnostic Git Abstraction (`repo-sdk`)**
  - **Files:** `src/orchestrator/delivery/repo-sdk.ts`
  - **Steps:**
    1. Wrap `repo-sdk` (with `octokit` and `@gitbeaker/rest` fallbacks) supporting GitHub, GitLab, Bitbucket Cloud, Azure DevOps, and Gitea.
    2. Operations: clone, branch push, create/update PR/MR, post PR comment, merge PR, and register webhooks.
  - **Verify:** `tests/unit/repo-sdk.test.ts` with provider mocks.

- [x] **Task 11.2 — 6 Non-Negotiable Mandatory Human Gates & Configurable Gate Policy (`auto` / `ai-pm` / `human` / `mandatory-human`)**
  - **Files:** `src/orchestrator/delivery/mandatory-gates.ts`
  - **Steps:**
    1. Evaluate the 6 non-negotiable human approval gates (PRD §8.4):
       1) Blast-radius scope escape
       2) Destructive DDL (`DROP TABLE`, `TRUNCATE`)
       3) Security/secret exposure (`gitleaks`, critical CVE via `osv-scanner`, copyleft license)
       4) Merging into protected branches (`main`, `release/*`)
       5) Per-task spend ceiling exceeded
       6) Two-strike internal review rejection
    2. Support `ai-pm` reviewer persona (`aiReviewer` config) with `canEscalateToHuman` and audit logging.
    3. Support Solo Dev `Auto-Merge-if-Green` (§12.2) only when all tests pass and zero mandatory human gates trigger.
  - **Verify:** `tests/unit/mandatory-gates.test.ts`.

- [x] **Task 11.3 — 60-Second Executive Review Packet & Per-Model Confidence Calibration**
  - **Files:** `src/orchestrator/delivery/review-packet.ts`, `src/orchestrator/delivery/confidence-calibration.ts`
  - **Steps:**
    1. Build the 7-section PR body (PRD §8.4):
       1) 10-Second Executive Summary + DecisionGate risk badge + Model Data Residency Badge (Tier 1/2/3, §11.3) + Calibrated Confidence score
       2) Quality Gate Compliance Table
       3) Dual-Axis Review Matrix (**Standards Axis** vs **Spec Axis**, ADR-083)
       4) Docs-Guard AST Symbol Verification Badge
       5) Browser Smoke Test Findings Table (`e2e explore`)
       6) Visual Proof Artifacts (Playwright screenshots/WebM + `cached` vs `live` indicator)
       7) Deterministic AST Semantic Diff summary (§12.1) & Scoped File Diff Breakdown
    2. Implement per-model `confidence_calibration` tracking (`n >= 30` sample gate per `(file_type, model_id, model_version)`, capped at `±0.15`, 90-day half-life).
  - **Verify:** `tests/unit/review-packet.test.ts`.

- [x] **Task 11.4 — PR Review Comment Webhook Feedback Loop & External PM Sync**
  - **Files:** `src/orchestrator/routes/webhooks-vcs.ts`, `src/orchestrator/delivery/pm-sync.ts`
  - **Steps:**
    1. Handle inbound VCS webhooks (debounced via `webhookDebounceMs`); on PR review comments, awaken the task sandbox, send ARP `review.feedback`, apply fixes, re-run guards, and push an updated commit to the PR branch.
    2. Implement optional bidirectional PM sync (`octokit`, `jira.js`, `@linear/sdk`, `@gitbeaker/rest`) where Graywolf owns execution state and external PM owns labels/assignees.
  - **Verify:** `tests/integration/webhook-feedback.test.ts`.

---

# PHASE 12 — Conversational Cockpit, Multi-Tab Right Panel & Kanban/DAG Dashboard

**Goal:** Build the React + Vite + Tailwind + Shadcn UI featuring `assistant-ui` + Vercel AI SDK streaming, the 6-tab lazy-loaded Right Panel (ADR-053), Kanban + React Flow DAG board, BiDi isolation, Maker/Developer persona views, Access Mode Pill, and Socratic Grilling Mode (`CockpitMode: GRILL`, ADR-083).  
**Exit Criteria:** Streaming chat and tool-call cards work end-to-end; XTerm and Monaco are lazy-loaded; BiDi rules (`dir="auto"` prose, `dir="ltr" unicode-bidi: isolate` code/paths) pass WCAG 2.1 SC 1.3.4 checks.

- [x] **Task 12.1 — Dashboard Vite Scaffold, Auth Context & BiDi Isolation Primitives**
  - **Files:** `src/dashboard/package.json`, `src/dashboard/vite.config.ts`, `src/dashboard/src/lib/bidi.tsx`, `src/dashboard/src/App.tsx`, `docker/dashboard/Dockerfile`
  - **Steps:**
    1. Scaffold React 18 + Vite + Tailwind + Shadcn UI + `@tanstack/react-query`.
    2. Implement `<BidiProse dir="auto">` and `<CodeIsolate dir="ltr" className="[unicode-bidi:isolate]">` components plus document post-processor keeping code identifiers, file paths, AST symbols, and CLI commands LTR inside `ar`/`en`/`fr`/`tr` locales (ADR-081 Pattern 1).
  - **Verify:** `pnpm --dir src/dashboard build` + unit test for BiDi post-processor.

- [x] **Task 12.2 — Backend Chat Streaming (`/api/v1/chat/stream`) & Socratic Grilling Mode (`GRILL`, ADR-083)**
  - **Files:** `src/orchestrator/routes/chat.ts`
  - **Steps:**
    1. Use Vercel AI SDK `streamText()` + `toDataStreamResponse()` over the LiteLLM OpenAI-compatible endpoint.
    2. Route all tool calls through `executeAuthorizedToolCall` (Phase 3.3).
    3. Support `cockpitMode: 'STANDARD' | 'GRILL'`: in `GRILL` mode, inject the Socratic stress-testing system prompt (asks up to 5 structured probing questions challenging edge cases/failure branches, references codebase & `constitution.md`, drafts into `docs/PRD.md` or `brief.md`, and requires explicit confirmation before queuing).
    4. Accept `@current_file` Bi-Directional Viewport Sync marker (§12.1).
  - **Verify:** `tests/integration/chat-grill.test.ts`.

- [x] **Task 12.3 — Chat Cockpit (`assistant-ui`), Access Mode Pill, Panic Button & Live Spend Ticker**
  - **Files:** `src/dashboard/src/components/cockpit/ChatCockpit.tsx`, `src/dashboard/src/components/cockpit/AccessModePill.tsx`, `src/dashboard/src/components/cockpit/SpendTicker.tsx`
  - **Steps:**
    1. Wire `assistant-ui` to `/api/v1/chat/stream` with tool-call cards and `GRILL` mode toggle.
    2. Implement 3-state **Access Mode Pill** (`Plan / Read-Only`, `Plan-Gate`, `Full Factory`) overriding autonomy for the current task; editable by `developer`/`lead_dev`/`owner`, display-only for `viewer`.
    3. Add prominent **Panic Button (Cancel)** calling `POST /api/v1/tasks/:taskId/cancel` and **Live Spend Meter** updating via WebSocket `cost.delta` frames.
  - **Verify:** Component tests in `src/dashboard/tests/cockpit.test.tsx`.

- [x] **Task 12.4 — Split-Pane Multi-Tab Right Panel (Lazy-Loaded `files`, `commits`, `planner`, `terminal`, `browser`, `usage`)**
  - **Files:** `src/dashboard/src/components/cockpit/RightPanel.tsx`, `src/dashboard/src/components/cockpit/tabs/{FilesTab,CommitsTab,PlannerTab,TerminalTab,BrowserTab,UsageTab}.tsx`
  - **Steps:**
    1. Resizable split pane persisting width and active tab per conversation in `localStorage` (panel open/closed state is session-only).
    2. Lazy-load all 6 tabs via `React.lazy()` so Monaco and XTerm are excluded from the eager bundle:
       - `files`: read-only workspace explorer emitting `@current_file` viewport sync.
       - `commits`: Monaco `DiffEditor` (`old` / `diff` / `new`, max height 600px, custom dark theme) + Deterministic AST Semantic Diff header.
       - `planner`: live checklist synced with `plan.md` + **Approve Plan** / **Request Changes** buttons in `Plan-Gate` mode.
       - `terminal`: XTerm.js streaming via single-use WS TGT (`/api/v1/telemetry/ws-ticket`).
       - `browser`: Playwright preview viewport + Topology A WS-TGT Live HMR iframe (§12.2).
       - `usage`: `ContextMeter` (% fill gauge) + `CompactContextButton` (triggers manual context compression) + token/USD ledger.
  - **Verify:** Bundle chunk inspection test confirming Monaco/XTerm are in async chunks.

- [x] **Task 12.5 — Kanban Board, React Flow DAG, Time-Travel Inspector & Maker/Developer Personas**
  - **Files:** `src/dashboard/src/components/board/KanbanBoard.tsx`, `src/dashboard/src/components/board/DagGraph.tsx`, `src/dashboard/src/components/board/TimeTravelSlider.tsx`
  - **Steps:**
    1. Developer View columns (`Backlog`, `Queued / Ready`, `In Progress`, `Internal Review`, `QA Guard Verifying`, `Awaiting Clarification`, `Review Gate`, `Merged / Done`) vs Maker View columns (`Ideas → Planning → Building → Ready to Review → Live`, collapsing technical tabs and hiding AST diffs behind "Show Technical Details").
    2. React Flow DAG visualizer allowing dependency arrow drawing for DAG Branch Stacking (§12.2).
    3. Time-Travel Trajectory Inspector slider scrubbing through recorded `file.mutation` and `event.stream` snapshots + Surface A Narrative Timeline with expandable Surface B Terminal Drawers.
  - **Verify:** Component tests for Developer View, Maker View, and Viewer/Client stakeholder dashboard.

---

# PHASE 13 — End-to-End Browser QA Engine (`@playwright/test`) & Parallel Bug Bash Sprint

**Goal:** Implement the Hybrid Intent / Deterministic Playwright QA engine with zero-token cache replay (ADR-075), Visual Review Packets (ADR-077), Dev-Level-2 Fourth Pass `e2e explore` smoke gate (ADR-076), and the Parallel Bug Bash Sprint pattern (ADR-078).  
**Exit Criteria:** Cached `agent.act` steps replay with 0 LLM tokens; financial/billing/tax assertions enforce deterministic `expect()`; Bug Bash findings require a failing `qa-repro-<issue>` test before promotion to `CONFIRMED`.

- [x] **Task 13.1 — Semantic Locator Guard & Deterministic vs Intent Assertion Split (ADR-075)**
  - **Files:** `src/orchestrator/e2e/authoring-guard.ts`, `src/orchestrator/e2e/intent-runtime.ts`
  - **Steps:**
    1. Enforce semantic locators (`getByRole`, `getByLabel`, `getByTestId`) and reject brittle CSS/XPath selectors in Dev-Level-3 test diffs.
    2. Implement `agent.act`, `agent.assert`, `agent.waitFor`, `agent.extract` routing strictly through internal LiteLLM (`http://litellm-proxy:4000`, zero external SaaS sync).
    3. Enforce Anti-Self-Grading rule: tasks touching financial, billing, calculation, or tax scopes MUST have deterministic Playwright `expect()` assertions to pass the merge gate.
  - **Verify:** `tests/unit/e2e-authoring-guard.test.ts`.

- [x] **Task 13.2 — Deterministic Cache-Replay Lifecycle & Merge Promotion**
  - **Files:** `src/orchestrator/e2e/cache-replay.ts`
  - **Steps:**
    1. Serialize successful `agent.act` DOM resolution steps into `.agents/tasks/<TASK_ID>/e2e-cache/`.
    2. Replay cached steps with 0 LLM tokens; on DOM drift, catch and fall back to a live agent turn (persisting only to the task-scoped cache, never mutating the read-only project cache during CI).
    3. On task merge (`MERGED`), promote task cache to `.agents/cache/e2e/`.
  - **Verify:** `tests/unit/e2e-cache-replay.test.ts`.

- [x] **Task 13.3 — Visual Review Packets & Dev-Level-2 4th Pass `e2e explore` Smoke Gate (ADR-076, ADR-077)**
  - **Files:** `src/orchestrator/e2e/visual-packet.ts`, `src/orchestrator/e2e/explore-smoke.ts`
  - **Steps:**
    1. Capture HTML reports, console error logs, masked screenshots (`pixelmatch` visual diffing), and WebM video traces into `.agents/tasks/<TASK_ID>/review/`.
    2. Implement `e2e explore` 4th pass for `ui`, `api-surface`, and `mandatory-e2e` tasks under hard caps (`maxTurns: 6`, `timeout: 180s`, `spendLimitUSD: 0.50`).
    3. Record findings as `browser-test` events in `.agent_evidence.db`; enforce "No Repro, No Bug" (a P0/P1 explore finding only counts as a Strike against Dev-Level-3 if backed by a minimal failing repro test attributable to `changes.patch`).
  - **Verify:** `tests/unit/e2e-explore.test.ts`.

- [x] **Task 13.4 — Parallel Bug Bash Sprint (`bug-bash-sprint`, ADR-078)**
  - **Files:** `src/orchestrator/delivery/bug-bash.ts`
  - **Steps:**
    1. Fan out `qa-explore-<area>` child tasks across `areas × personas` (capped at `maxExplorers: 8` on Standard/Enterprise, `1` on Topology A Constrained Profile) with aggregate sprint budget governor (`maxExplorers * $0.50`).
    2. Classify initial findings as `CANDIDATE` and spawn `qa-repro-<issue>` child subtask for Dev-Level-3 to author a minimal failing test.
    3. If repro test fails as reported -> promote to `CONFIRMED` and auto-create `fix:<issue>` backlog task; otherwise mark `UNCONFIRMED` and downgrade to P2 advisory.
  - **Verify:** `tests/unit/bug-bash.test.ts`.

---

# PHASE 14 — Continuous Learning Engine, Stall Guardrails & Context Compression

**Goal:** Implement the Hermes-inspired 3-Tier Continuous Learning Loop (`docs/PRD.md` §9): Background Reflection Job, Human Gate Learning, Skill Curator, Stall Detection Guardrails, Terminal-State Protocol Contract, 80% Context Compression, Prompt Compilation Harness, and Opt-In Trajectory Export.  
**Exit Criteria:** Completed/failed tasks queue low-priority reflection; human diff corrections are stored in `project_lessons`; loops halt at 5× streak/laps; >80% context compresses middle turns while preserving head (system+brief+first 2 turns) and tail (last 8 turns).

- [x] **Task 14.1 — 3-Axis Background Reflection Worker & Human Gate Diff Learner (ADR-057, ADR-083)**
  - **Files:** `src/orchestrator/learning/reflection-worker.ts`, `src/orchestrator/learning/human-gate-diff.ts`
  - **Steps:**
    1. Trigger low-priority BullMQ job on terminal task states evaluating the 3 axes: **Project Memory**, **Skill Library** (`.agents/skills/` following `agentskills.io` Hermes-strict format: `name` ≤64 chars, one-sentence `description` ≤60 chars ending in `.`, `version: 0.1.0`, mandatory section order, excluding env failures / negative tool claims / unresolved dead ends), and **Anti-Pattern Registry** (from Gate 4 guard failures and ADR-056 debate rejections).
    2. `human-gate-diff.ts`: diff `agent_output` (`changes.patch`) vs `final_merged_code` when a human edits before merging, classify correction type, embed via `nomic-embed-text` (768-dim), and store in `project_lessons`.
  - **Verify:** `tests/unit/reflection-and-human-diff.test.ts`.

- [x] **Task 14.2 — Weekly Skill Curator Job (ADR-063)**
  - **Files:** `src/orchestrator/learning/skill-curator.ts`
  - **Steps:**
    1. Weekly BullMQ repeatable job operating only on `agent-created` skills (`user-created` never auto-patched; `pinned` never archived):
       - `active -> stale` (unused 14 days)
       - `stale -> archived` (unused 30 days, moved to `.archive/`)
       - `archived -> deleted` (90+ days, requires operator approval)
    2. Support opt-in `curator.consolidate = true` generating a human-gated markdown consolidation diff.
  - **Verify:** `tests/unit/skill-curator.test.ts`.

- [x] **Task 14.3 — Stall Detection Guardrails (ADR-058) & Terminal-State Protocol (ADR-059)**
  - **Files:** `src/orchestrator/learning/stall-detector.ts`, `src/orchestrator/learning/status-protocol.ts`
  - **Steps:**
    1. `stall-detector.ts`: detect exact-failure streak (warn at 3×, hard-interrupt at 5×), multi-call cycle `A->B->A->B` period ≤4 (warn at 3 laps, hard-interrupt at 5 laps), per-turn cap (>50 commands -> hard-cap + nudge), and PRD §6 stuck heuristic (4 identical action-observations or 3 identical diffs). On hard-interrupt: mark `STALL_ESCALATED`, increment Two-Strike counter, attach stall report.
    2. `status-protocol.ts`: verify `.agent_status.json` (`patch_ready | blocked | needs_clarification`) exists when container exits `rc=0`; if missing, issue up to 2 synthetic re-entry nudges before marking `protocol_violation` and escalating.
  - **Verify:** `tests/unit/stall-and-status-protocol.test.ts`.

- [x] **Task 14.4 — Auxiliary Context Compressor (ADR-060), Prompt Compiler (ADR-068) & Trajectory Export (ADR-064)**
  - **Files:** `src/orchestrator/learning/compression.ts`, `scripts/prompts-compile.ts`, `src/orchestrator/learning/trajectory-export.ts`
  - **Steps:**
    1. `compression.ts`: when token estimate exceeds 80% of context window (or operator clicks `CompactContextButton`), keep Protected Head (system prompt + brief + first 2 turns) and Protected Tail (last 8 turns) untouched, and summarize Compressible Middle via auxiliary model (with deterministic fallback: tool call names + 200 chars/turn). Keep uncompressed history in Postgres.
    2. `scripts/prompts-compile.ts`: DSPy-inspired prompt evaluator compiling `prompts/` per target model alias.
    3. `trajectory-export.ts`: opt-in (`dataset.collect = true`) exporter compressing 0-strike successful trajectories, redacting secrets/names, and writing JSONL to `.agents/dataset/trajectories/YYYY-MM/`.
  - **Verify:** `tests/unit/compression-and-trajectory.test.ts`.

---

# PHASE 15 — Software Factory & Pluggable `@graywolf/addon-sdk` (ADR-080)

**Goal:** Productionize `specs/002-addon-sdk/addon-interfaces.ts` into the Fastify plugin boundary supporting `SignalAddon` and `CockpitAddon`, Valkey webhook deduplication (ADR-044), `<untrusted_signal_payload>` sanitization (ADR-025/038), Two-Tier Trust (SHA-256 fail-closed lock), Shadow Mode graduation, and External Identity Binding (PRD §17).  
**Exit Criteria:** Crash storm webhooks deduplicate within 3m cooldown; unlinked Discord/Slack users receive `ADDON_UNLINKED_EXTERNAL_USER` (403); mutated Tier 2 addon hash triggers `ADDON_HASH_MISMATCH` hard fail; Topology A caps slots at `3 Signal + 1 Cockpit`.

- [x] **Task 15.1 — `@graywolf/addon-sdk` Runtime Context, Deduplication & Sanitization**
  - **Files:** `src/orchestrator/addons/sdk.ts`, `src/orchestrator/addons/sanitization.ts`
  - **Steps:**
    1. Implement `GraywolfRelayContext` from `specs/002-addon-sdk/addon-interfaces.ts` enforcing method scoping (`SignalAddon` gets `submitSignal` & `scheduleRepeatableJob`; `CockpitAddon` gets `postTaskBrief`, `postEscalation`, `receiveHumanIntent`; neither gets `executeCommand` or worktree I/O).
    2. Deduplicate inbound signals in `submitSignal` using Valkey key `signal:{workspaceId}:{fingerprintHash}` with configurable cooldown (default 180s, ADR-044).
    3. Wrap all untrusted string fields in `<untrusted_signal_payload>` XML tags and sanitize prompt-injection markers before planner/LLM ingestion.
  - **Verify:** `tests/unit/addon-sdk.test.ts`.

- [x] **Task 15.2 — Two-Tier Addon Registry, Shadow Mode Lifecycle & External Identity Binding**
  - **Files:** `src/orchestrator/addons/registry.ts`, `src/orchestrator/addons/shadow-lifecycle.ts`, `src/orchestrator/addons/identity-binding.ts`
  - **Steps:**
    1. Enforce Topology A slot limits (`maxSignalAddons: 3`, `maxCockpitAddons: 1` -> `ADDON_SLOT_LIMIT_EXCEEDED` 429).
    2. Verify Tier 2 `contentHash` (SHA-256) against `.agents/project.config.json` at boot; throw `ADDON_HASH_MISMATCH` (403 fail-closed) on mismatch.
    3. Enforce Shadow Mode lifecycle: new addons start in `shadow` (audit-log only, no Kanban write); graduate to `graduated` only after `>= 20` runs with `< 10%` discard rate + explicit `lead_dev` promotion click; auto-deprecate on `5+` consecutive post-graduation discards.
    4. Enforce External Identity Binding in `receiveHumanIntent()`: lookup `actorExternalId` in `workspace_member_identities`; if unlinked, reject with `ADDON_UNLINKED_EXTERNAL_USER` (403).
  - **Verify:** `tests/unit/addon-registry-shadow-identity.test.ts`.

- [x] **Task 15.3 — First-Party Reference Addons (`@graywolf/addon-sentry`, `@graywolf/addon-github-issues`, `@graywolf/addon-discord-cockpit`)**
  - **Files:** `src/orchestrator/addons/builtin/sentry-signal.ts`, `src/orchestrator/addons/builtin/github-issues-signal.ts`, `src/orchestrator/addons/builtin/discord-cockpit.ts`
  - **Steps:**
    1. Implement P1 official Tier 1 plugins using TypeBox webhook validation and HMAC verification via `relay.readSecret()` (with zero `@sentry/node` SDK imports and zero `setInterval` timers).
  - **Verify:** `tests/integration/addons-builtin.test.ts`.

---

# PHASE 16 — Secrets Envelope Encryption, Out-of-Band Proxy, Sub-2s Package Cache & P0 Exit Verification

**Goal:** Complete all security hardening (`docs/architecture/security-and-secrets.md`), MCP credential redaction (ADR-055), Tier 1/Tier 2 package cache optimization (`docs/architecture/build-cache-and-performance.md`), optional OTLP export, and automated verification of the 4 P0 Platform Maturity Exit Criteria (PRD §13, §5.6, §16).  
**Exit Criteria:** `~/.graywolf/master.key` envelope encryption active; zero plaintext secrets in container env; container cold start <2s on warmed cache; all 4 P0 exit benchmarks pass.

- [x] **Task 16.1 — Zero-Prompt KEK (`~/.graywolf/master.key`) & Envelope-Encrypted `secret_vault`**
  - **Files:** `src/orchestrator/security/kek-vault.ts`, `src/orchestrator/security/mcp-redaction.ts`
  - **Steps:**
    1. Auto-generate `~/.graywolf/master.key` (`0600`) on first boot (with pluggable KMS interface for Vault/AWS/GCP).
    2. Encrypt per-secret Data Encryption Keys (`encrypted_dek`) with KEK and secret values (`encrypted_value`) with AES-256-GCM / `pgcrypto` in `secret_vault`.
    3. Implement ADR-055 MCP Credential Redaction: return `REDACTED_MCP_SECRET_VALUE = "**********"` to UI, preserve untouched secret leaves on edit, and recursively merge encrypted leaves server-side during connectivity probes.
  - **Verify:** `tests/unit/kek-vault-and-mcp-redaction.test.ts`.

- [x] **Task 16.2 — Out-of-Band Secrets Proxy, Git Credential Socket & Regex Secret Scrubber**
  - **Files:** `src/orchestrator/security/secrets-proxy.ts`, `src/orchestrator/security/secret-scrubber.ts`
  - **Steps:**
    1. Provide short-lived scoped tokens to Git operations via a local Unix socket credential helper and substitute third-party test API keys in-flight via the Secrets Broker proxy.
    2. Scrub all container `stdout`/`stderr` chunks (`terminal.chunk`), logs, and PR packets with high-throughput regex secret filters before persistence or WebSocket broadcast.
  - **Verify:** `tests/unit/secrets-proxy-and-scrubber.test.ts`.

- [x] **Task 16.3 — Sub-2s Package Cache Volume (Tier 1) & Debounced Pre-Bake Worker (Tier 2)**
  - **Files:** `src/orchestrator/runner/cache.ts`, `src/orchestrator/ServiceOtel.ts`
  - **Steps:**
    1. Tier 1: mount persistent content-addressable volume `pkg-cache-{project_id}` into container package stores (`~/.npm`, `~/.cache/pip`, Cargo registry) and trigger background cache warming on branch merge.
    2. Tier 2: watch lockfiles and rebuild cached image layer via BuildKit after 10 minutes of lockfile quiescence.
    3. Implement optional OpenTelemetry (`gen_ai.*`) OTLP trace exporter (`ServiceOtel.ts`, off by default for $0 solo runs).
  - **Verify:** `tests/integration/cache-cold-start.test.ts` asserting <2s container boot.

- [x] **Task 16.4 — P0 Platform Maturity Exit Benchmark Suite (PRD §16)**
  - **Files:** `tests/e2e/p0-maturity-benchmarks.test.ts`
  - **Steps:**
    1. Automated verification harness proving all 4 P0 exit criteria:
       1) **5 Consecutive Brownfield Tasks Completed**: zero container deadlocks, zero boundary escapes, zero git conflicts.
       2) **100% Gate Integrity**: zero unauthorized modifications to protected branches or forbidden scopes.
       3) **Sub-2s Container Cold Start**: verified across repeated task runs using Tier 1 package cache.
       4) **Zero External Token Leaks**: verified 100% offline run using local Ollama (`qwen2.5-coder` + `nomic-embed-text`) with `$0.00` ledger cost and 0 bytes external egress.
  - **Verify:** `pnpm test tests/e2e/p0-maturity-benchmarks.test.ts`.

---

# PHASE 17 — Production Release Packaging, Multi-Arch Docker Compose & Cold-Boot Smoke Test (`v0.1.0-p0`)

**Goal:** Package the complete Graywolf Squad platform into hardened multi-stage production Dockerfiles (`linux/amd64` and `linux/arm64` / Raspberry Pi 5), a turnkey `docker-compose.prod.yml` preserving the 4-network segmentation (`edge-net`, `control-net`, `daemon-net`, `runner-net`) and `tecnativa/docker-socket-proxy`, an automatic PostgreSQL migration init runner, a zero-friction bootstrap installer script, and an automated cold-boot smoke test suite.  
**Exit Criteria:** Multi-stage orchestrator and dashboard Dockerfiles build cleanly with non-root user (`uid: 1001`); `docker-compose.prod.yml` passes full topology and volume validation; bootstrap installer script verifies prerequisites and initializes `.env.production` + `~/.graywolf/master.key` (`0600`); automated smoke test suite passes.

- [x] **Task 17.1 — Multi-Stage Production Dockerfiles (Orchestrator & Dashboard)**
  - **Files:** `docker/orchestrator/Dockerfile.prod`, `docker/dashboard/Dockerfile.prod`, `.dockerignore`
  - **Steps:**
    1. Create multi-stage `docker/orchestrator/Dockerfile.prod` compiling TypeScript (`dist/`), pruning devDependencies, setting non-root user `graywolf` (`uid: 1001`), and exposing dual ports `3000` (Control) and `3001` (ARP).
    2. Upgrade `docker/dashboard/Dockerfile.prod` to compile the Vite React SPA (`src/dashboard/dist`) and serve static assets with strict CSP headers and SPA fallback routing.
  - **Verify:** `tests/unit/production-dockerfiles.test.ts`.

- [x] **Task 17.2 — Turnkey `docker-compose.prod.yml`, Auto-Migration Init & `.env.production.example`**
  - **Files:** `docker-compose.prod.yml`, `scripts/db-migrate-init.sh`, `.env.production.example`
  - **Steps:**
    1. Define `docker-compose.prod.yml` preserving the 4-network architecture (`edge-net`, `control-net`, `daemon-net`, `runner-net`), `tecnativa/docker-socket-proxy`, PostgreSQL 16 + `pgvector`, Valkey 7, LiteLLM Proxy, `db-migrate` init service, `orchestrator`, and `dashboard`.
    2. Create `scripts/db-migrate-init.sh` idempotently applying `migrations/*.sql` in lexical order before `orchestrator` starts.
    3. Provide `.env.production.example` documenting all required production environment variables and Topology A (`arm64` / Raspberry Pi 5) resource profile defaults.
  - **Verify:** `tests/integration/compose-prod-topology.test.ts`.

- [x] **Task 17.3 — Zero-Friction Bootstrap Installer & E2E Cold-Boot Smoke Harness**
  - **Files:** `scripts/install.sh`, `tests/e2e/production-compose-smoke.test.ts`
  - **Steps:**
    1. Build `scripts/install.sh` (POSIX-compliant) verifying Docker & Compose v2 prerequisites, generating random DB/Valkey credentials in `.env.production` if absent, initializing `~/.graywolf/master.key` (`0600`), and supporting `--dry-run` verification.
    2. Build `tests/e2e/production-compose-smoke.test.ts` validating full production stack configuration, migration sequencing, healthcheck probes (`/api/v1/health`), and multi-arch readiness.
  - **Verify:** `pnpm test tests/e2e/production-compose-smoke.test.ts`.

---

# PHASE 18 — Expanded First-Party Addons (`@graywolf/addon-slack-cockpit`, `@graywolf/addon-discord-signal`, `@graywolf/addon-msteams-cockpit`)

**Goal:** Complete the PRD §17.8 First-Party Addon Roadmap by implementing the remaining P2 and P3 official Tier 1 plugins conforming strictly to `@graywolf/addon-sdk` (ADR-080): `@graywolf/addon-slack-cockpit` (Slack Block Kit HITL triage & interactive intents), `@graywolf/addon-discord-signal` (Discord community bug/crash signal ingestion), and `@graywolf/addon-msteams-cockpit` (Microsoft Teams Adaptive Cards HITL triage).  
**Exit Criteria:** All 3 addons pass TypeBox schema validation, constant-time HMAC/signature verification, `<untrusted_signal_payload>` sanitization, Valkey crash-storm deduplication, and `workspace_member_identities` RBAC enforcement; zero banned timers or SDKs.

- [x] **Task 18.1 — `@graywolf/addon-slack-cockpit` (Block Kit Triage, Interactive Actions & Signature Verification)**
  - **Files:** `src/orchestrator/addons/builtin/slack-cockpit.ts`
  - **Steps:**
    1. Verify Slack request signatures (`x-slack-signature: v0=<hmac_sha256>` and `x-slack-request-timestamp` within 300s replay window) using `relay.readSecret('SLACK_SIGNING_SECRET')`.
    2. Format Task Briefs, Escalations, and 60-Second Executive Review Packets as Slack Block Kit payloads (`section`, `actions` buttons for Approve / Request Revisions / Escalate) and translate interactive actions into `executeVerifiedHumanIntent()` enforcing `workspace_member_identities`.
  - **Verify:** `tests/unit/addon-slack-cockpit.test.ts`.

- [x] **Task 18.2 — `@graywolf/addon-discord-signal` (Community Bug/Issue Channel Monitor)**
  - **Files:** `src/orchestrator/addons/builtin/discord-signal.ts`
  - **Steps:**
    1. Implement `SignalAddon` receiving Discord channel message/thread webhooks, verifying `x-discord-signature-sha256` HMAC via `relay.readSecret('DISCORD_SIGNAL_SECRET')`.
    2. Normalize bug reports and crash snippets into `GraywolfSignalEnvelope` wrapped in `<untrusted_signal_payload>` XML tags (ADR-025/038) and deduplicate via Valkey (`signal:{workspaceId}:{fingerprint}`, 180s TTL).
  - **Verify:** `tests/unit/addon-discord-signal.test.ts`.

- [x] **Task 18.3 — `@graywolf/addon-msteams-cockpit` (Adaptive Cards v1.5 Triage & Action.Submit)**
  - **Files:** `src/orchestrator/addons/builtin/msteams-cockpit.ts`
  - **Steps:**
    1. Verify Microsoft Teams outbound webhook HMAC (`authorization: HMAC <base64_sha256>`) using `relay.readSecret('MSTEAMS_WEBHOOK_SECRET')`.
    2. Render Task Briefs, Escalations, and Executive Review Packets as Adaptive Cards v1.5 (`Action.Submit` intents for `approve`, `reject`, `escalate`) and enforce `workspace_member_identities` lookup for Azure AD / Teams user IDs.
  - **Verify:** `tests/integration/addons-track-b.test.ts`.

---

# PHASE 19 — Trajectory Compression Harvester, Privacy Redactor & Local SFT Dataset Pipeline (ADR-064 & ADR-079)

**Goal:** Implement the complete Phase 3 Hermes-pattern Trajectory Compression and Supervised Fine-Tuning (SFT) dataset pipeline (ADR-064) alongside an offline System-One SLM evaluation harness (ADR-079), enabling operators to harvest high-quality completed tasks into privacy-scrubbed OpenAI/ShareGPT-compatible JSONL training sets in `.agents/dataset/trajectories/YYYY-MM/`.  
**Exit Criteria:** Only eligible trajectories (completed tasks with 0 agreed P0/P1 findings) are harvested when `dataset.collect = true`; Protect-Head / Protect-Tail / Summarize-Middle compression bounds token counts while preserving tool-call validity; deterministic privacy gate scrubs paths, secrets, and custom sensitive identifiers; CLI export & stats commands verified.

- [x] **Task 19.1 — Eligible Trajectory Harvester & Hermes Protect-Head / Tail / Summarize-Middle Compressor**
  - **Files:** `src/orchestrator/learning/trajectory-harvester.ts`, `src/orchestrator/learning/trajectory-compressor.ts`
  - **Steps:**
    1. Filter task trajectories from `.agent_evidence.db` and `llm_calls` / `task_artifacts`: harvest strictly tasks with terminal state `COMPLETED` and `0` agreed `P0`/`P1` findings in Dev-Level-2 adversarial review, gated by `dataset.collect === true`.
    2. Implement Hermes-faithful trajectory compression: protect head (system prompt + initial task brief + first assistant turn), protect tail (configurable `protectTailTurns`, default last 4 turns), and compress middle tool-call sequences into compact semantic narrations.
  - **Verify:** `tests/unit/trajectory-compressor.test.ts`.

- [x] **Task 19.2 — Privacy Redaction Gate, Monthly JSONL Rotation & Dataset CLI / API**
  - **Files:** `src/orchestrator/learning/dataset-manager.ts`, `src/orchestrator/routes/dataset.ts`
  - **Steps:**
    1. Run multi-layer privacy redaction stripping absolute workspace paths, credentials/tokens, git remote URLs, and project-configured `sensitiveIdentifiers` before dataset serialization.
    2. Persist OpenAI-compatible multi-turn tool-calling JSONL files under `.agents/dataset/trajectories/YYYY-MM/<task-id>.jsonl` with monthly rotation, retention pruning, and REST/CLI dataset stats & export endpoints (`/api/v1/projects/:id/dataset/stats`, `/api/v1/projects/:id/dataset/export`).
  - **Verify:** `tests/integration/trajectory-dataset-pipeline.test.ts`.

---

# PHASE 20 — Attention Firewall: Two-Stage Signal Admission, Versioned Policy, Task Mandates & "Needs You" Proposals (`specs/021-attention-firewall`)

**Goal:** Implement the Phase 20 Attention Firewall inspired by DeepSeek's `dsh-superagent-prototype` core engine, protecting human cognitive attention and container compute from signal overload. Incorporates zero-token deterministic gate filtering, bounded LLM context-window evaluation (`admission-context`), immutable cryptographically-versioned `Mandate` grants, and a non-disruptive `observe` mode with a "Needs You" dashboard review card.  
**Exit Criteria:** Signal policies versioned via SHA-256 hash; deterministic matrix handles unambiguous triggers with zero LLM tokens; Gate 5 Assessor evaluates bounded trigger contexts with strict schema validation; mandates attached to created tasks; policy diffs trigger live task notifications; 100% test coverage with zero unhandled edge cases.

- [ ] **Task 20.1 — Deterministic Gate Matrix, Admission Context Window Builder & Assessor Engine**
  - **Files:** `packages/agent-runtime/src/admission/model.ts`, `packages/agent-runtime/src/admission/ports.ts`, `packages/agent-runtime/src/admission/matrix.ts`, `packages/agent-runtime/src/admission/evals.ts`, `src/control-plane/admission/context-builder.ts`, `src/control-plane/prompts/admission-assessor.md`
  - **Steps:**
    1. Port pure domain contracts (`Trigger`, `ThreadRef`, `Evaluation`, `Decision`, `TriggerDisposition`, `Mandate`, `Strength`) and admission matrix (`listedUnaddressed`, `unlistedAddressed`, `unlistedUnaddressed`) from `reference-opensources/dsh-superagent-prototype-main/src/core/`.
    2. Build bounded context window extractor (first 5 root messages + ±5 around trigger) and LiteLLM Assessor pipeline with 2× timeout requeue, pause deadline shifting, and `unavailable` fallback.
  - **Verify:** `tests/unit/admission-engine.test.ts`.

- [ ] **Task 20.2 — Versioned Policy Engine, Task Mandates, Live Diffing (`policyEffects`) & Control Plane REST APIs**
  - **Files:** `packages/agent-runtime/src/admission/policy.ts`, `migrations/021_attention_firewall.sql`, `src/orchestrator/routes/admission.ts`, `src/control-plane/admission/views.ts`, `src/control-plane/admission/effects.ts`
  - **Steps:**
    1. Implement PostgreSQL migration for `signal_policies`, `signal_threads`, `signal_triggers`, `signal_decisions` and add `mandate` JSONB column to `tasks` with RLS.
    2. Implement `policyVersion()` SHA-256 calculation, `revalidate(mandate)` on task resume, and `policyEffects()` live diffing issuing `task.inject` notices to active containers.
    3. Expose Fastify REST APIs for policy CRUD, overview dashboard stats, and observed proposal triage (`promote` / `dismiss` / `pause`).
  - **Verify:** `tests/integration/attention-firewall-api.test.ts`.

---

# PHASE 21 — Capacity Management, Reserved Human Slot & Durable Thread Subscriptions (`specs/022-capacity-and-threads`)

**Goal:** Prevent automated agent workloads from blocking human developer interaction and route multi-turn thread discussions cleanly without redundant re-triage or token waste.  
**Exit Criteria:** `AdmissionController` enforces `maxWorkers + 1` reserved interactive slot; thread subscriptions accurately differentiate `owner` from read-only `context`; worker `handback()` cleanly rejects out-of-scope follow-ups back to the firewall without task failure.

- [ ] **Task 21.1 — Reserved Human Concurrency Slot (`maxWorkers + 1`) & Soft Pause Gate**
  - **Files:** `src/orchestrator/services/admission-controller.ts`, `src/orchestrator/queue/task-orchestrator.ts`
  - **Steps:**
    1. Update concurrency controller with hard capacity `N + 1` reserving the extra slot strictly for human explicit messages or active task status wakes.
    2. Implement soft pause gate preserving running tasks while halting new intake and shifting evaluation deadlines.
  - **Verify:** `tests/unit/capacity-concurrency.test.ts`.

- [ ] **Task 21.2 — Durable Thread Subscriptions, Pass-Through Routing & Worker Mandate `handback()` Tool**
  - **Files:** `migrations/022_thread_subscriptions.sql`, `src/orchestrator/services/thread-subscription-service.ts`, `src/relay/relay.mjs`
  - **Steps:**
    1. Add `thread_subscriptions` table with `owner` and `context` modes, routing incoming comments directly to active worker sessions.
    2. Add `handback` tool to worker container runtime: when a follow-up exceeds `task.mandate.scope`, worker yields cleanly with reason `exceeds_mandate_scope` and routes trigger to firewall.
  - **Verify:** `tests/integration/thread-subscriptions.test.ts`.

---

# PHASE 22 — Relay Ergonomics: 5-Second Auto-Backgrounding Shell & Spill-at-Write Context Pointers (`specs/023-relay-ergonomics`)

**Goal:** Upgrade container execution ergonomics in `src/relay/relay.mjs` by eliminating shell timeouts on build/server commands and preserving ADR-061 prompt cache prefix immutability against large tool outputs.  
**Exit Criteria:** Foreground `bash_execute` detaches to `bgJobs` after 5,000ms with job handle and preview; tool outputs >1,000 tokens are spilled at write to `/scratch/spill/` with head/tail summary and `recall_context` pointer; zero KV-cache invalidation.

- [ ] **Task 22.1 — 5-Second Auto-Backgrounding Child Process State Machine & Background Job Tools in `relay.mjs`**
  - **Files:** `src/relay/relay.mjs`, `packages/agent-runtime/src/relay/types.ts`
  - **Steps:**
    1. Implement 5,000ms foreground race on `bash_execute`: if running after 5s, detach child process into `bgJobs` map, assign UUID, return immediate status with stdout preview.
    2. Implement `check_bg_job(job_id)` and `kill_bg_job(job_id)` tools with 30-min max TTL watchdog and 10s shutdown drain.
  - **Verify:** `tests/unit/relay-auto-backgrounding.test.ts`.

- [ ] **Task 22.2 — Spill-at-Write Context Pointers (`recall_<uuid>.log`) & Cache-Stable Recall Tool**
  - **Files:** `src/relay/relay.mjs`, `src/orchestrator/services/context-engine.ts`
  - **Steps:**
    1. Implement spill-at-write check in `relay.mjs`: when stdout/stderr exceeds 4,000 characters, persist full output to `/scratch/spill/recall_<uuid>.log` and return head/tail preview stub.
    2. Expose `recall_context(recall_id, start_line, end_line)` tool allowing agents to page through spilled logs on demand without polluting prompt history.
  - **Verify:** `tests/unit/spill-recall-pointers.test.ts`.

---

# PHASE 23 — Semantic Progress Watchdog & Out-of-Band Agent Stalling Prevention (`specs/024-semantic-watchdog`)

**Goal:** Implement an out-of-band progress monitor that detects semantic deadlocks (e.g. repeated edits failing the same test suite) before container budgets are exhausted.  
**Exit Criteria:** BullMQ Watchdog worker monitors active tasks out-of-band; deterministic heuristic triggers analytical LLM evaluation; agent receives `watchdog.nudge` or is safely halted for Dev-Level-1 escalation.

- [ ] **Task 23.1 — BullMQ Out-of-Band Watchdog Worker & Multi-Turn Test Progression Heuristics**
  - **Files:** `src/orchestrator/queue/watchdog-worker.ts`, `src/orchestrator/services/evidence-ledger-service.ts`
  - **Steps:**
    1. Create BullMQ `WatchdogWorker` polling active tasks every 60s.
    2. Track consecutive test failure counts and cost/time spend plateaus in `.agent_evidence.db`.
  - **Verify:** `tests/unit/watchdog-worker.test.ts`.

- [ ] **Task 23.2 — LiteLLM Analytical Loop Evaluator & ARP `watchdog.nudge` / Halt Interventions**
  - **Files:** `src/orchestrator/services/watchdog-evaluator.ts`, `src/orchestrator/services/task-orchestrator.ts`
  - **Steps:**
    1. When heuristic flags a stall, query LiteLLM with diff and test history to evaluate if agent is in a semantic loop.
    2. Issue ARP `watchdog.nudge` message or trigger level-1 escalation halt with checkpointed state.
  - **Verify:** `tests/integration/semantic-watchdog.test.ts`.


