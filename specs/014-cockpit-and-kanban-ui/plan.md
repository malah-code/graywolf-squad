# Implementation Plan: Conversational Cockpit, Multi-Tab Right Panel & Kanban/DAG Dashboard

**Branch**: `014-cockpit-and-kanban-ui` | **Date**: 2026-10-25 | **Spec**: [spec.md](./spec.md)  
**Input**: Feature specification from `/specs/014-cockpit-and-kanban-ui/spec.md`

## Summary

Implement Phase 12 of the Graywolf Squad master plan (`docs/implementation-plan-detailed.md` Tasks 12.1–12.5):
1. **Dashboard Scaffold, Auth Context & BiDi Isolation Primitives (Task 12.1, FR-001)**:
   - Scaffold `src/dashboard/package.json`, `src/dashboard/vite.config.ts`, `src/dashboard/src/App.tsx`, and update `docker/dashboard/Dockerfile`.
   - Implement `<BidiProse dir="auto">`, `<CodeIsolate dir="ltr" className="[unicode-bidi:isolate]">`, and `postProcessBidiDocument` in `src/dashboard/src/lib/bidi.tsx` keeping code identifiers, file paths, AST symbols, CLI commands/flags, keyboard shortcuts, and numeric values strictly LTR across `ar`, `en`, `fr`, and `tr` locales (ADR-081 Pattern 1, WCAG 2.1 SC 1.3.4).
2. **Backend Chat Streaming (`POST /api/v1/chat/stream`) & Socratic Grilling Mode (`GRILL`, ADR-083) (Task 12.2, FR-002)**:
   - Implement `src/orchestrator/routes/chat.ts` (and register in `src/orchestrator/app.ts`) using Vercel AI SDK Data Stream framing (`streamText()` + `toDataStreamResponse()`) over LiteLLM.
   - Enforce Casbin `chat_turn` RBAC (`developer`/`lead_dev`/`owner`) and `change_access_mode_pill` RBAC for `accessModeOverride`, route all tool calls through `executeAuthorizedToolCall` (Phase 3.3), accept `@current_file` Bi-Directional Viewport Sync markers (§12.1), and implement `cockpitMode: 'STANDARD' | 'GRILL'` (asking up to 5 probing questions referencing codebase & `constitution.md`, honoring `--skip-grill` bypass, drafting into `docs/PRD.md` or `brief.md`, and requiring explicit confirmation before queuing).
3. **Chat Cockpit (`assistant-ui`), Access Mode Pill, Panic Button & Live Spend Ticker (Task 12.3, FR-003, FR-004)**:
   - Implement `ChatCockpit.tsx`, `AccessModePill.tsx` (`'plan-read-only' | 'plan-gate' | 'full-factory'`, editable for `developer`/`lead_dev`/`owner`, read-only for `viewer`), Panic Button (`POST /api/v1/tasks/:taskId/cancel`), and `SpendTicker.tsx` (updating in real time from WebSocket `cost.delta` events).
4. **Split-Pane Multi-Tab Right Panel with Lazy-Loaded Tabs (Task 12.4, FR-005)**:
   - Implement `RightPanel.tsx` persisting width and active tab per conversation in `localStorage` (with open/closed state session-only) and lazy-loading all 6 tabs via `React.lazy()` (`FilesTab.tsx`, `CommitsTab.tsx`, `PlannerTab.tsx`, `TerminalTab.tsx`, `BrowserTab.tsx`, `UsageTab.tsx`) so Monaco DiffEditor and XTerm.js are isolated into separate async chunks (`0` bytes in the eager bundle).
5. **Kanban Board, React Flow DAG, Time-Travel Inspector & Maker/Developer/Viewer Personas (Task 12.5, FR-006, FR-007)**:
   - Implement `KanbanBoard.tsx` supporting **Developer View** (8 columns mapping all 16 `TaskStatus` states), **Maker View** (5 columns + collapsed `files`/`commits`/`terminal` tabs + hidden AST diffs toggle), and **Viewer/Client Stakeholder Dashboard** (Goal, Progress Bar, Playwright Video/Screenshots, Spend).
   - Implement `DagGraph.tsx` (React Flow dependency edge creation for DAG Branch Stacking with cycle rejection via `assertNoDependencyCycle`) and `TimeTravelSlider.tsx` (scrubbing `file.mutation` and `event.stream` snapshots with **Surface A Narrative Timeline** and expandable **Surface B Terminal Drawers**).

## Technical Context

**Language/Version**: TypeScript 5.x (ES2022 + JSX) on Node.js 20+  
**Primary Dependencies**: Fastify 5.x, `@sinclair/typebox`, `src/orchestrator/aci/validate.ts`, `src/orchestrator/auth/rbac.ts`, `src/orchestrator/gateway/litellm-client.ts`, React 18 / Vite / Tailwind / Shadcn / `assistant-ui` / React Flow / Monaco / XTerm component architecture (`src/dashboard/`)  
**Dashboard Package**: `src/dashboard/` is an **independent pnpm workspace package** (`"name": "graywolf-dashboard"`, `"private": true`) with its own `package.json` listing all frontend dependencies (React, Vite, Tailwind, Shadcn, `@assistant-ui/react`, `reactflow`, `@monaco-editor/react`, `@xterm/xterm`). Registered in `pnpm-workspace.yaml` via `packages: ['src/dashboard']`.  
**Chat Streaming Protocol**: The `POST /api/v1/chat/stream` route hand-rolls the **Vercel AI SDK Data Stream Protocol** (frame types `0:`, `9:`, `a:`, `2:`, `d:`) directly on top of `LiteLLMClient.complete()`. The Vercel AI SDK package is **not** installed in the root `package.json`; only the dashboard `package.json` pulls in the client-side `ai` SDK for `useChat` hooks.  
**Storage**: Browser `localStorage` (per-conversation Right Panel width & active tab), PostgreSQL (`tasks`, `llm_calls`, `audit_logs` via existing routes)  
**Testing**: Vitest (`tests/integration/chat-grill.test.ts` and `src/dashboard/tests/cockpit.test.tsx`)  
**Target Platform**: Web SPA (`src/dashboard/`) + Fastify Control Plane API (`src/orchestrator/routes/chat.ts`)  
**Project Type**: Full-stack Conversational Cockpit UI + Backend Streaming Endpoint  
**Performance Goals**: Eager entry bundle `< 300 kB` gzip (`0` bytes of Monaco/XTerm in eager bundle); `< 500ms` time-to-first-token on `/api/v1/chat/stream`; `< 100ms` persona switching  
**Constraints**: Strict BiDi isolation (`dir="auto"` prose, `dir="ltr" unicode-bidi: isolate` code/paths); non-persistent per-message `AccessModePill` override; server-authoritative `executeAuthorizedToolCall` for all cockpit tool calls  
**Scale/Scope**: 1 backend route module (`src/orchestrator/routes/chat.ts`), 16 dashboard modules under `src/dashboard/`, `docker/dashboard/Dockerfile`, and 2 comprehensive test suites (`tests/integration/chat-grill.test.ts`, `src/dashboard/tests/cockpit.test.tsx`)

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **Principle 1 (Human Sovereignty & Non-Committing Relay Contract)**: PASS — Access Mode Pill (`'plan-read-only'`, `'plan-gate'`, `'full-factory'`), `GRILL` mode explicit confirmation before task creation, and Panic Button (`POST /api/v1/tasks/:taskId/cancel`) keep the human operator in full command.
- **Principle 2 (Zero Runtime Lock-In & Permissive Licensing)**: PASS — All UI patterns and libraries (React, Vite, Tailwind, Shadcn, `assistant-ui`, Vercel AI SDK protocol, React Flow, XTerm.js, Monaco) are MIT / Apache-2.0 licensed.
- **Principle 3 (Single ACID Relational & Vector Baseline)**: PASS — Uses existing PostgreSQL / `withTenantContext` state via `executeAuthorizedToolCall`.
- **Principle 4 (Headless Execution & Observability)**: PASS — Streams typed ARP events (`cost.delta`, `terminal.chunk`, `file.mutation`, `event.stream`) and exposes Surface A Narrative Timeline + Surface B Expandable Terminal Drawers + `UsageTab` context/spend gauges.
- **Principle 5 (Dual Operational Mode: Greenfield & Brownfield)**: PASS — Brownfield projects default to `"developer"` persona with full technical oversight; Greenfield projects support both `"maker"` and `"developer"` personas (ADR-081 Pattern 3).
- **Principle 6 (Virtual Developer Tier Handoff Protocol)**: PASS — `PlannerTab` syncs with Dev-Level-1's `plan.md` and surfaces **Approve Plan** / **Request Changes** gates before Dev-Level-3 executes in `'plan-gate'` mode.
- **Principle 7 (Chat as Active Control Plane — Cockpit Rule)**: PASS — `/api/v1/chat/stream` routes every state-modifying tool call through `executeAuthorizedToolCall` (`src/orchestrator/aci/validate.ts`), rejecting unauthorized calls with `RBAC_COCKPIT_TOOL_FORBIDDEN` and requiring explicit confirmation after `GRILL` synthesis before queuing tasks.
- **Principle 8 (Blast-Radius and Dependency Integrity)**: PASS — `DagGraph` validates acyclicity via `assertNoDependencyCycle` before updating `blockedBy` for DAG Branch Stacking, and `FilesTab` badges writable/readonly/forbidden scope tiers.
- **Principle 9 (Zero-Cost Open Source Foundation)**: PASS — 100% open-source stack capable of running offline against local LLM providers via LiteLLM.

## Project Structure

### Documentation (this feature)

```text
specs/014-cockpit-and-kanban-ui/
├── spec.md              # Feature specification (FR-001..FR-007, SC-001..SC-005)
├── plan.md              # This technical implementation plan
├── research.md          # Technical decisions for BiDi, Vercel AI stream, lazy chunks, Kanban/DAG
├── data-model.md        # Domain models, 16-state Kanban mappings, and trajectory snapshots
├── quickstart.md        # Verification commands and test scenarios
├── checklists/
│   └── requirements.md  # Specification quality checklist (16/16 pass)
└── contracts/
    └── cockpit-and-kanban.md # API and component contracts
```

### Source Code (repository root)

```text
src/orchestrator/routes/
└── chat.ts              # Task 12.2: POST /api/v1/chat/stream (Vercel AI SDK stream, ACI RBAC, GRILL mode, @current_file)

src/dashboard/
├── package.json         # Task 12.1: Dashboard package manifest & build script
├── vite.config.ts       # Task 12.1 & 12.4: Vite config with manualChunks / async tab chunk isolation
├── src/
│   ├── lib/
│   │   ├── jsx-runtime.ts # Lightweight VNode & React.lazy compatible runtime helper
│   │   └── bidi.tsx       # Task 12.1: <BidiProse>, <CodeIsolate>, postProcessBidiDocument (ar/en/fr/tr)
│   ├── App.tsx            # Task 12.1: Root dashboard shell & Auth/Persona context provider
│   ├── components/
│   │   ├── cockpit/
│   │   │   ├── ChatCockpit.tsx    # Task 12.3: assistant-ui stream client, tool cards, GRILL toggle, Panic Button
│   │   │   ├── AccessModePill.tsx # Task 12.3: 3-state Access Mode Pill (plan-read-only, plan-gate, full-factory)
│   │   │   ├── SpendTicker.tsx    # Task 12.3: Live Spend Meter updated via cost.delta frames
│   │   │   ├── RightPanel.tsx     # Task 12.4: Resizable split pane + localStorage persistence + React.lazy() loader
│   │   │   └── tabs/
│   │   │       ├── FilesTab.tsx    # Task 12.4: Workspace explorer emitting @current_file
│   │   │       ├── CommitsTab.tsx  # Task 12.4: AST Semantic Diff header + Monaco DiffEditor (old/diff/new, <=600px)
│   │   │       ├── PlannerTab.tsx  # Task 12.4: Live plan.md checklist + Approve Plan / Request Changes
│   │   │       ├── TerminalTab.tsx # Task 12.4: XTerm.js via single-use WS-TGT (/api/v1/telemetry/ws-ticket)
│   │   │       ├── BrowserTab.tsx  # Task 12.4: Topology A WS-TGT Live HMR iframe vs Playwright QA preview
│   │   │       └── UsageTab.tsx    # Task 12.4: ContextMeter + CompactContextButton + token/USD ledger
│   │   └── board/
│   │       ├── KanbanBoard.tsx      # Task 12.5: Developer (8-col), Maker (5-col), and Viewer/Client dashboards
│   │       ├── DagGraph.tsx         # Task 12.5: React Flow DAG visualizer & branch stacking blockedBy editor
│   │       └── TimeTravelSlider.tsx # Task 12.5: Trajectory scrubber + Surface A Narrative + Surface B Terminal Drawers
└── tests/
    └── cockpit.test.tsx   # Tasks 12.1, 12.3, 12.4, 12.5: Unit/component & bundle chunk inspection tests

docker/dashboard/
└── Dockerfile           # Task 12.1: Multi-stage dashboard build + Nginx container

tests/integration/
└── chat-grill.test.ts   # Task 12.2: Integration tests for /api/v1/chat/stream, ACI tool RBAC, GRILL mode & @current_file
```

**Structure Decision**: Matches the exact file paths specified in `docs/implementation-plan-detailed.md` Phase 12 Tasks 12.1–12.5.

## Complexity Tracking

No Constitution violations or complexity exceptions required.
