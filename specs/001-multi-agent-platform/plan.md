# Implementation Plan: Autonomous Multi-Agent Software Engineering Platform

**Branch**: `001-multi-agent-platform` | **Date**: 2026-09-09 | **Spec**: [spec.md](file:///home/tarikelmallah/Projects/GraywolfSquad/specs/001-multi-agent-platform/spec.md)

**Input**: Feature specification from `specs/001-multi-agent-platform/spec.md`

---

## Summary

Build an autonomous multi-agent software engineering framework providing:
1. **Sovereign Developer Control & Non-Committing Relay**: Agents execute inside ephemeral Docker containers bound to isolated Git worktrees and are structurally prohibited from committing to Git.
2. **Reactive Quality Assurance**: Automated 3-tier guard passes (Clean-Code, Test, Documentation) filter synthetic defects before human review.
3. **Filesystem State Architecture**: Markdown task specifications, atomic directory locks (`proper-lockfile`), and WebSocket synchronization to a real-time React/Vite dashboard.
4. **LiteLLM Multi-Model Gateway**: Role-based virtual routing, spend caps, and automatic circuit breaking.

---

## Technical Context

**Language/Version**: TypeScript / Node.js v20+ (Backend Orchestrator & Frontend SPA), Python 3.12 (LiteLLM Proxy & Guard Evaluators)  
**Primary Dependencies**:
- *Backend*: Fastify, `@fastify/websocket`, `chokidar`, `proper-lockfile`, `dockerode`, `zod`
- *Frontend*: React 18+, Vite, Tailwind CSS, Shadcn UI, `@tanstack/react-query`, `@xterm/xterm`
- *Gateway & Guards*: LiteLLM Proxy, Valkey client (`ioredis`)  
**Storage**: Local filesystem (`.agents/tasks/`), PostgreSQL 16+ with `pgvector`, Valkey (BSD-3-Clause)  
**Testing**: Vitest (Unit & Integration), Playwright (E2E), Docker container test harnesses  
**Target Platform**: Linux / WSL2 (Ubuntu 22.04 / 24.04), Docker Engine 24+  
**Project Type**: Web Application & Developer Tooling Platform (Modular Monorepo)  
**Performance Goals**: Sandbox container boot < 3.5s; File sync to UI < 500ms; Gateway proxy overhead < 25ms  
**Constraints**: Zero unverified Git commits; hard memory caps (4GB) per sandbox container; 30s stale lock timeout  
**Scale/Scope**: Up to 10 concurrent active agent lanes per host developer machine  

---

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **Principle 1: Human Sovereignty & Non-Committing Relay**: PASS. All agent runs execute via `relay.mjs` with uncommitted changes trapped in worktrees. No agent has commit or push credentials.
- **Principle 2: Zero Runtime Lock-In & Permissive Licenses**: PASS. Fastify (MIT), React (MIT), Tailwind (MIT), Valkey (BSD-3-Clause), PostgreSQL (PostgreSQL License), Docker (Apache-2.0 / CE). No AGPLv3 core components.
- **Principle 3: Single ACID Relational & Vector Baseline**: PASS. PostgreSQL 16+ with `pgvector` for persistence and vector storage.
- **Principle 4: Headless Execution & Observability**: PASS. OpenTelemetry tracing standards, WebSocket log streaming, structured `delegate-relay.result.v1` schemas.

---

## Project Structure

### Documentation (this feature)

```text
specs/001-multi-agent-platform/
├── spec.md              # Feature specification
├── plan.md              # This technical plan
├── research.md          # Phase 0 research & architectural decisions
├── data-model.md        # Phase 1 data entities & schemas
├── quickstart.md        # Phase 1 developer onboarding guide
├── checklists/
│   └── requirements.md  # Quality validation checklist
└── contracts/
    └── relay-result.json# JSON schema for delegate-relay.result.v1
```

### Source Code (repository root)

```text
packages/
├── orchestrator/           # Node.js / TypeScript Core Backend Daemon
│   ├── src/
│   │   ├── api/            # Fastify REST endpoints & WebSocket handlers
│   │   ├── sandbox/        # Dockerode container lifecycle & worktree manager
│   │   ├── watcher/        # Chokidar filesystem watcher & frontmatter parser
│   │   ├── locking/        # Proper-lockfile coordinator & stale lock recovery
│   │   ├── guards/         # Clean-Code, Test, and Documentation guard runners
│   │   └── index.ts        # Server entrypoint
│   ├── tests/
│   └── package.json
│
├── dashboard/              # React + Vite + Tailwind + Shadcn UI Frontend
│   ├── src/
│   │   ├── components/     # Kanban board, Task cards, Diff viewer, Terminal (Xterm)
│   │   ├── hooks/          # useTaskEvents WebSocket hook, useTasks query
│   │   ├── pages/          # BoardView, TaskDetailView, GatewaySettingsView
│   │   ├── lib/            # Utilities & API client
│   │   └── App.tsx
│   ├── tests/
│   └── package.json
│
├── relay/                  # Isolated Agent Execution Harness
│   ├── relay.mjs           # Zero-dependency relay script mounted into containers
│   └── schema.json         # delegate-relay.result.v1 validator
│
└── gateway/                # LiteLLM Proxy Governance & Routing
    ├── config.yaml         # Virtual model mapping, fallbacks, spend caps
    ├── docker-compose.yml  # LiteLLM + Valkey service composition
    └── guards/             # Python-based AST lint and test guard evaluators

.agents/                    # File-centric runtime state (tracked locally)
├── config.json             # Global platform settings
├── tasks/                  # Task specifications, plans, diffs, execution logs
└── locks/                  # Atomic directory locks
```

**Structure Decision**: Monorepo with three core workspaces (`orchestrator`, `dashboard`, `relay`) and an infrastructure composition (`gateway`). This keeps type sharing simple while completely isolating the agent runtime relay (`relay.mjs`).

---

## Complexity Tracking

| Decision | Why Needed | Simpler Alternative Rejected Because |
| :--- | :--- | :--- |
| **Dual Isolation (Worktree + Docker)** | Prevents dependency conflicts, port collisions, and host filesystem damage. | Worktrees alone allow agents to execute arbitrary shell commands on the host OS; Containers alone without worktrees cause branch collisions. |
| **Atomic `mkdir` Locking (`proper-lockfile`)** | Cross-process and cross-container filesystem atomicity. | Standard `flock` fails across Docker bind-mount boundaries and network filesystems. |
| **LiteLLM Intermediate Gateway** | Centralizes budget caps, circuit breaking, and role-based virtual models. | Hardcoding direct API keys into individual agent configs leads to untracked spending and failure during provider outages. |
