# Graywolf Squad 🐺

**Autonomous Multi-Agent Software House & Embedded Engineering Squad Platform**

Graywolf Squad is a container-isolated, multi-tier AI engineering platform designed to operate either as an autonomous greenfield software house or as an embedded brownfield engineering squad adhering to strict blast-radius controls.

---

## 1. Architectural Vision & Core Principles

Graywolf Squad operates under the governance rules defined in `.specify/memory/constitution.md` and `AGENTS.md`:

1. **Human Sovereignty & Non-Committing Relay Contract**: Agents never commit directly to upstream Git repositories. All work terminates in a verified unified diff (`changes.patch`), deterministic AST analysis, and a structured test review packet.
2. **Ephemeral Isolated Sandboxes**: Every task runs within a dedicated, disposable Docker container. Ephemeral database environments run alongside tasks without polluting persistent shared data.
3. **Three-Tier Virtual Developer Hierarchy**:
   - **Dev-Level-1 (Planner / Frontier Model)**: Deconstructs tasks, verifies blast-radius, and produces `plan.md`.
   - **Dev-Level-3 (Implementer / Fast Code Model)**: Writes edits within an isolated worktree via a strict Agent-Computer Interface (ACI).
   - **Dev-Level-2 (Reviewer / Analytical Model)**: Executes unit and Playwright headless E2E test suites, ensuring changes compile and pass before human review.
4. **Chat as an Active Cockpit**: Natural language interaction with tool-calling authority over tasks, dependencies (`blockedBy`), scheduling, and container execution.
5. **Six Atomic, Non-Bypassable Gates**:
   - Destructive Operations Gate
   - Secrets Exposure Gate
   - Upstream Merge Gate
   - Hard Spend/Budget Ceiling Gate
   - Protected Path / Blast-Radius Gate
   - Two-Strike Failure Escalation Gate

---

## 2. Core Stack Baseline

- **Orchestrator Control Plane**: Node.js 20+, TypeScript, Fastify, Pino
- **Persistent State & Multi-Tenancy**: PostgreSQL 16 + Row Level Security (RLS) + `pgvector`
- **Queueing & Async Jobs**: Valkey + BullMQ
- **Model Gateway**: LiteLLM Proxy
- **Frontend Cockpit**: React + Vite + Tailwind CSS + Shadcn UI + React Flow + Xterm.js
- **Agent Communication & Protocols**: Agent Relay Protocol (ARP) over Fastify WebSockets
- **Sandbox Management**: `IRunnerProvider` abstraction over Dockerode & Testcontainers

---

## 3. Architecture Decision Records (ADRs) Summary

The platform is designed and governed by **46 Architecture Decision Records** (`docs/decisions.md`):

| ADR Range | Domain | Key Decisions |
| :--- | :--- | :--- |
| **ADR-001 – ADR-010** | **Foundation & Runtimes** | Fastify backend, Dockerode container isolation, LiteLLM gateway, PostgreSQL state, BullMQ queues. |
| **ADR-011 – ADR-020** | **Safety & Blast Radius** | Three blast-radius scopes (Writable, Read-Only, Forbidden), non-committing relay contract, two-strike escalation. |
| **ADR-021 – ADR-030** | **Protocols & Secrets** | Agent Relay Protocol (ARP), out-of-band credential proxy, session token signing with ed25519. |
| **ADR-031 – ADR-040** | **Concurrency & Observability** | Scope-overlap detection, deterministic turn snapshotting/replay, OTLP bridge, Agnostic Runner API (`IRunnerProvider`). |
| **ADR-041 – ADR-044** | **Hardening & Resilience** | Docker socket proxy segmentation (`IMAGES=1`), rate-limiting, wallet-draining webhook loop defenses. |
| **ADR-045** | **UX / DX Safeguards** | The "Panic Button" (graceful container process-group kill + DB drop + `git restore .`), Live Spend Meter, AST semantic diffs. |
| **ADR-046** | **Generic Sandbox Provisioning** | Adoption of **Testcontainers** for stack-agnostic sandboxes (MongoDB, Redis, MySQL) alongside PostgreSQL fast-template cloning (`<300ms`). |

---

## 4. Current Status & Implementation Progress

We are executing the **Thin Vertical Slice MVP** under feature branch `001-platform-foundation`. The goal of this slice is to prove the end-to-end execution loop:
$$\text{Dispatch API} \longrightarrow \text{Sandbox Spawn} \longrightarrow \text{ARP WebSocket} \longrightarrow \text{DB Status Transition} \longrightarrow \text{Teardown}$$

### Status Checklist (`specs/001-platform-foundation/tasks.md`):

- [x] **Phase 1: Setup (Shared Infrastructure)**
  - [x] `T001`: Fastify TypeScript project initialized.
  - [x] `T002`: Installed dependencies (`fastify`, `@fastify/websocket`, `dockerode`, `pg`, `pino`, `node-pg-migrate`).
  - [x] `T003`: Scaffolded directory structure (`src/orchestrator`, `src/agents`, `tests/`).
- [x] **Phase 2: Foundational (Database & Runner Abstractions)**
  - [x] `T004`: PostgreSQL connection pool created (`src/orchestrator/db/index.ts`).
  - [x] `T005`: Database migrations created via `node-pg-migrate` (`migrations/*_create-tasks-table.js`) with Row Level Security (RLS) enabled and tenant isolation policy.
  - [x] *Pre-Phase 3 Hardening*: Codified `IRunnerProvider` interface (`src/orchestrator/runner/IRunnerProvider.ts`) to keep Dockerode decoupled from orchestrator routes.
- [ ] **Phase 3: Thin Vertical Slice 🎯 MVP (Upcoming)**
  - [ ] `T006`: Implement dummy agent payload (`src/agents/dummy_relay/relay.mjs`).
  - [ ] `T007`: Implement ARP WebSocket server (`src/orchestrator/arp/server.ts`).
  - [ ] `T008`: Implement Docker runner implementing `IRunnerProvider` (`src/orchestrator/runner/docker.ts`).
  - [ ] `T009`: Implement task dispatch REST endpoint (`POST /tasks/:id/dispatch` in `src/orchestrator/routes/tasks.ts`).
  - [ ] `T010`: Wire Fastify server entrypoint (`src/orchestrator/index.ts`).
- [ ] **Phase 4: Polish & Validation**
  - [ ] `T011`: Execute local verification per `quickstart.md`.
  - [ ] `T012`: Implement integration test suite (`tests/integration/dispatch.test.ts`).

---

## 5. Repository Structure

```text
├── .agents/                    # Agent skills, customizations, and provider plugins
├── .specify/                   # Project memory, constitution, and governance rules
├── docs/                       # Master architectural specifications
│   ├── PRD.md                  # Master Product Requirements Document
│   ├── decisions.md            # Architecture Decision Records (ADRs 001–051)
│   └── architecture/           # 19 in-depth domain architecture specifications
├── migrations/                 # PostgreSQL database migrations (node-pg-migrate)
├── specs/                      # Feature specifications and execution plans
│   └── 001-platform-foundation/# Spec, Plan, Research, Data Model, Quickstart, Tasks
├── src/
│   ├── orchestrator/           # Fastify backend, ARP server, DB pool, and Runner
│   │   ├── db/                 # Postgres connection pool
│   │   ├── runner/             # IRunnerProvider abstraction & Docker runner
│   │   ├── arp/                # WebSocket Agent Relay Protocol server
│   │   └── routes/             # REST API endpoints
│   └── agents/                 # Agent harnesses and relay wrappers
└── tests/                      # Unit and integration test suites
```
