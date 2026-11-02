# Feature Specification: Conversational Cockpit, Multi-Tab Right Panel & Kanban/DAG Dashboard

**Feature Branch**: `014-cockpit-and-kanban-ui`

**Created**: 2026-10-25

**Status**: Draft

**Input**: User description: "Phase 12 Conversational Cockpit, Multi-Tab Right Panel & Kanban/DAG Dashboard: Build the React + Vite + Tailwind + Shadcn UI featuring assistant-ui + Vercel AI SDK streaming, the 6-tab lazy-loaded Right Panel (ADR-053), Kanban + React Flow DAG board, BiDi isolation, Maker/Developer persona views, Access Mode Pill, and Socratic Grilling Mode (CockpitMode: GRILL, ADR-083)."

## Clarifications

### Session 2026-10-25
- Q: Where does the Access Mode Pill state reside, what are its canonical values, and how does it affect persistent configuration? → A: Per ADR-081 Pattern 2 and `src/orchestrator/tiers/planner.ts`, the Access Mode Pill is an ephemeral, per-message UI override stored in React component state using canonical `AccessModePill` values (`'plan-read-only' | 'plan-gate' | 'full-factory'`). It attaches an `accessModeOverride` field to the active chat/task dispatch request without mutating `project.config.json` on disk. The orchestrator enforces `change_access_mode_pill` RBAC permission (`developer`, `lead_dev`, `owner` allowed; `viewer` denied with `RBAC_INSUFFICIENT_ROLE`) and applies the override server-authoritatively for that single task execution.
- Q: How are heavy libraries (Monaco DiffEditor and XTerm.js) bundled to prevent bloating initial page load? → A: Per ADR-053, all 6 Right Panel tabs (`files`, `commits`, `planner`, `terminal`, `browser`, `usage`) are dynamically imported via `React.lazy()`. Monaco and XTerm are segregated into separate asynchronous chunks, ensuring zero bytes of Monaco/XTerm in the eager initial bundle and keeping the eager bundle lightweight (< 300 kB gzip).
- Q: How does Bi-Directional (BiDi) isolation work for multilingual MENA projects? → A: Per ADR-081 Pattern 1 and WCAG 2.1 SC 1.3.4, natural prose uses `<BidiProse dir="auto">` while all code snippets, file paths, CLI flags, AST symbols, keyboard shortcuts, numeric metrics, XTerm terminals, and Monaco diffs are strictly forced to `<CodeIsolate dir="ltr" className="[unicode-bidi:isolate]">` (and Unicode LTR isolates `\u2066...\u2069` / `<code dir="ltr">` in document post-processing), preventing punctuation corruption and path inversions across `ar`, `en`, `fr`, and `tr` locales.
- Q: How should Socratic Grilling Mode (`CockpitMode: GRILL`, ADR-083) conduct its interview, reference repository context, and allow operator bypass? → A: Progressive Socratic Turn Loop: The agent asks 1 targeted probing question per assistant turn (up to 5 turns maximum) challenging edge cases, failure branches, data model mutations, and blast-radius boundaries while referencing the codebase and `constitution.md`. Operators may bypass remaining questions at any time via `--skip-grill`, the "Skip & Synthesize" action, or the Access Mode Pill. Upon completion or skip, the agent drafts the synthesized requirements into `docs/PRD.md` or a `brief.md` preview card and requires explicit developer confirmation ("Queue Task") before invoking `create_task`.
- Q: How should the Right Panel `browser` tab behave across topologies, and how do the 16 canonical `TaskStatus` states map into Developer View, Maker View, and Viewer/Client Role dashboards? → A: For the `browser` tab: in Topology A (`DEPLOYMENT_TOPOLOGY === 'solo'`) with an active dev server, it embeds the WS-TGT authenticated live HMR iframe; otherwise (Topology B/C or no active dev server), it renders the Playwright QA inspection surface (screenshots, WebM video replays, DOM locator breadcrumbs). For Kanban views: **Developer View** displays 8 columns (`Backlog` [`BACKLOG`, `UPDATED`], `Queued / Ready` [`QUEUED`, `BLOCKED`], `In Progress` [`IN_PROGRESS`], `Internal Review` [`INTERNAL_REVIEW`, `INTERNAL_REVIEW_FAILED`], `QA Guard Verifying` [`GUARD_VERIFYING`, `QA_FIXING`, `VERIFICATION_FAILED`], `Awaiting Clarification` [`AWAITING_CLARIFICATION`, `ESCALATED`], `Review Gate` [`HUMAN_REVIEW_GATE`, `REJECTED`], `Merged / Done` [`MERGED`, `CANCELLED`]); **Maker View** maps those states into 5 simplified columns (`Ideas`, `Planning`, `Building`, `Ready to Review`, `Live`) while keeping `browser` and `planner` visible and collapsing `files`, `commits`, and `terminal` by default; **Viewer/Client Role Dashboard** strips out AST diffs, terminal traces, and internal configs to show only Goal, Progress Bar, Playwright Video Demos/Screenshots, and Spend.
- Q: How should the React Flow DAG board handle dependency edge creation and cycle prevention when an operator connects two tasks? → A: Four-step validation and synchronization pipeline: (1) Edge Direction: Drawing Task A ➔ Task B adds Task A (`sourceTaskId`) to Task B's `blockedBy` array (deduplicated idempotently); (2) Client-Side Cycle Detection: Before committing to state, `connectDagDependencyEdge` runs 3-color DFS cycle detector (`assertNoDependencyCycle`), rejecting self-loops (`A ➔ A`) and transitive cycles (`A ➔ B ➔ C ➔ A`) immediately with an explanatory path toast; (3) Server Persistence & RBAC: Issues `update_blocked_by` through `executeAuthorizedToolCall` enforcing Casbin `'reorder_backlog'` permission (`developer`, `lead_dev`, `owner` allowed; `viewer` is read-only), where the server re-runs `assertNoDependencyCycle` and returns 409 `TASK_INVALID_STATE_TRANSITION` on conflict; (4) Branch Stacking Lineage: Once unblocked, the orchestrator boots child tasks using the parent task's branch.

---

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Active Conversational Cockpit with Streaming, ACI Tool Calls & Socratic Grilling (Priority: P1) 🎯 MVP

As an engineering lead or developer chatting with the AI squad, I need a high-performance conversational interface (`src/dashboard/src/components/cockpit/ChatCockpit.tsx` backed by `POST /api/v1/chat/stream` in `src/orchestrator/routes/chat.ts`) featuring real-time token streaming via `assistant-ui` and Vercel AI SDK (`streamText()` + `toDataStreamResponse()`), server-authorized ACI tool-call execution cards, `@current_file` viewport sync, a prominent Panic/Cancel button, live spend meters, and Socratic Grilling Mode (`CockpitMode: 'STANDARD' | 'GRILL'`, ADR-083) so I can guide, stress-test, and oversee task execution interactively.

**Why this priority**: Chat is the primary active control plane (Constitution Principle 7) through which developers command and collaborate with virtual developer tiers.

**Independent Test**: Can be tested by streaming chat turns from `POST /api/v1/chat/stream`, verifying `chat_turn` RBAC enforcement, toggling `GRILL` mode (or passing `/grill-me` / `--skip-grill`) to receive structured probing questions referencing codebase/`constitution.md`, dispatching server-authorized tool calls (`create_task`, `reorder_backlog`, `update_blocked_by`, `pause_container`, `cancel_task`, `approve_pr_merge`, `modify_blast_radius`) through `executeAuthorizedToolCall`, verifying real-time `cost.delta` spend updates, and triggering task cancellation via the Panic Button.

**Acceptance Scenarios**:

1. **Given** an authenticated user with `chat_turn` permission (`developer`, `lead_dev`, or `owner`) in the Chat Cockpit, **When** they submit a natural language prompt (optionally with an `@current_file` viewport sync marker), **Then** `POST /api/v1/chat/stream` streams tokens in real time via Vercel AI SDK over LiteLLM, rendering markdown prose and routing any requested tool calls through `executeAuthorizedToolCall` (Phase 3.3) with structured tool-call result cards (or returning a human-readable `RBAC_COCKPIT_TOOL_FORBIDDEN` rejection card if unauthorized).
2. **Given** the user activates `CockpitMode: 'GRILL'` (via UI toggle or `/grill-me`), **When** they propose a feature or architectural change, **Then** the agent executes the Socratic stress-testing prompt: asking 1 targeted probing question per turn (up to 5 maximum) challenging edge cases, failure branches, and dependency boundaries with references to the codebase and `constitution.md`, allowing immediate bypass via `--skip-grill` or Access Mode Pill, and synthesizing decisions into `docs/PRD.md` or a `brief.md` preview card that requires explicit "Queue Task" confirmation before `create_task` executes.
3. **Given** an active task in progress, **When** the user clicks the prominent Panic Button (Cancel), **Then** the frontend calls `POST /api/v1/tasks/:taskId/cancel`, initiating the 7-step graceful teardown and immediately reflecting the `CANCELLED` state in the cockpit.
4. **Given** container execution underway, **When** ARP `cost.delta` events stream over WebSocket, **Then** the `SpendTicker` (`Live Spend Meter`) immediately updates the running task and workspace USD/token expenditure counter.

---

### User Story 2 - Bi-Directional (BiDi) RTL/LTR Text & Code Isolation (Priority: P1)

As a developer or maker reading Arabic, English, French, or Turkish prose alongside code, I need BiDi isolation primitives (`<BidiProse dir="auto">` and `<CodeIsolate dir="ltr" className="[unicode-bidi:isolate]">`) and a document post-processor (`src/dashboard/src/lib/bidi.tsx`) so mixed RTL/LTR content never suffers from inverted file paths, scrambled punctuation, or corrupted terminal/diff displays.

**Why this priority**: Required by ADR-081 Pattern 1 and WCAG 2.1 SC 1.3.4 for Egyptian and MENA cross-locale developer workflows (`ar`, `en`, `fr`, `tr`).

**Independent Test**: Can be tested by rendering mixed Arabic prose and English file paths/AST symbols/CLI commands (`src/auth.ts`, `AuthService.login()`, `pnpm vitest run`, `--max-retries=3`) through `<BidiProse>`, `<CodeIsolate>`, and the markdown document post-processor, verifying that prose paragraphs use `dir="auto"` while code spans, file paths, CLI flags, keyboard shortcuts, and numeric values are strictly wrapped in `dir="ltr"` with `unicode-bidi: isolate`.

**Acceptance Scenarios**:

1. **Given** an Arabic-locale (`ar`) chat turn or review summary containing English file paths, AST symbols, or CLI commands, **When** rendered in the dashboard via `<BidiProse>` and `<CodeIsolate>`, **Then** the prose paragraph uses `dir="auto"` while all inline `<code>`, file-path badges (e.g., `src/modules/billing/service.ts`), CLI command blocks, keyboard shortcuts, and numeric badges render with `dir="ltr"` and `unicode-bidi: isolate`, preventing path or punctuation inversion.
2. **Given** a generated markdown document (`plan.md`, `brief.md`, `escalation-memo.md`, or Executive Review Packet) in any supported locale (`ar`, `en`, `fr`, `tr`), **When** processed by the BiDi document post-processor, **Then** all inline backticked code tokens, fenced code blocks, file paths, and CLI flags are deterministically wrapped in `<code dir="ltr" class="bidi-isolate">` (or Unicode LTR isolate markers) preserving strict LTR layout.

---

### User Story 3 - In-Chat 3-State Access Mode Pill (Priority: P1)

As a team lead or developer, I need a 3-State Access Mode Pill (`src/dashboard/src/components/cockpit/AccessModePill.tsx`) in the chat input bar (`Plan / Read-Only` ➔ `'plan-read-only'`, `Plan-Gate` ➔ `'plan-gate'`, `Full Factory` ➔ `'full-factory'`) so I can dynamically override agent autonomy for the current message/task without editing persistent configuration files.

**Why this priority**: Enforces Human Sovereignty (Constitution Principle 1) and enables frictionless per-turn switching between risk-free exploration, gated planning, and full execution per ADR-081 Pattern 2.

**Independent Test**: Can be tested by switching between the 3 pill states (`'plan-read-only'`, `'plan-gate'`, `'full-factory'`), verifying the attached `accessModeOverride` in the request payload, confirming server-side RBAC enforcement (`change_access_mode_pill` permitted for `developer`/`lead_dev`/`owner` and denied for `viewer`), and confirming execution behavior (read-only container in `plan-read-only`, pausing at `plan.md` in `plan-gate`).

**Acceptance Scenarios**:

1. **Given** an authorized user selects `Plan / Read-Only` (`'plan-read-only'`, 🔍), **When** a prompt/task is dispatched, **Then** the orchestrator enforces `--read-only: true` on the dispatch lane so Dev-Level-1 can inspect the repo map and draft `plan.md` / `brief.md` with zero worktree file modifications, while leaving `project.config.json` untouched on disk.
2. **Given** an authorized user selects `Plan-Gate` (`'plan-gate'`, ✋), **When** Dev-Level-1 finishes drafting `plan.md`, **Then** execution pauses (`awaitingHumanPlanApproval: true`) and surfaces `plan.md` in the Right Panel `planner` tab with one-click **Approve Plan** and **Request Changes** buttons, advancing to Dev-Level-3 only after explicit human approval.
3. **Given** an authorized user selects `Full Factory` (`'full-factory'`, ⚡), **When** a task is dispatched, **Then** the squad executes the full Dev-Level-1 ➔ Dev-Level-3 ➔ Dev-Level-2 pipeline autonomously up to the configured PR Review Gate.
4. **Given** a user with the `viewer` role, **When** they view the Chat Cockpit or attempt to submit an `accessModeOverride`, **Then** the Access Mode Pill is rendered as read-only display (`disabled`) in the UI and any server request attempting to override access mode is rejected via Casbin `change_access_mode_pill` (`RBAC_INSUFFICIENT_ROLE`).

---

### User Story 4 - Split-Pane Multi-Tab Right Panel with Lazy-Loaded Surfaces (Priority: P1)

As an engineer inspecting ongoing agent work, I need a resizable split-pane Right Panel (`src/dashboard/src/components/cockpit/RightPanel.tsx`) with 6 dedicated lazy-loaded tabs (`files`, `commits`, `planner`, `terminal`, `browser`, `usage`) where heavy dependencies (Monaco DiffEditor, XTerm.js) are isolated into asynchronous chunks so I have complete real-time visibility without degrading initial page load.

**Why this priority**: ADR-053 Cockpit Architecture provides a zero-context-switch workspace for live terminal streaming, AST semantic diff verification, task planning, browser preview, and context window management.

**Independent Test**: Can be tested by resizing the split pane (verifying per-conversation width and active tab persistence in `localStorage` while open/closed drawer state remains session-only), inspecting build output/imports to verify `React.lazy()` isolation of all 6 tabs, streaming `terminal.chunk` over single-use WS-TGT, emitting `@current_file` from `FilesTab`, reviewing diffs in `CommitsTab`, approving plans in `PlannerTab`, switching `BrowserTab` between Topology A HMR iframe and Playwright artifacts, and triggering context compaction in `UsageTab`.

**Acceptance Scenarios**:

1. **Given** the cockpit split-pane view, **When** the user drags the resize handle or switches tabs, **Then** the pane width and selected tab ID (`'files' | 'commits' | 'planner' | 'terminal' | 'browser' | 'usage'`) are persisted per conversation in `localStorage`, whereas the panel open/closed toggle state is kept strictly in session memory (never auto-expanding a closed drawer across reloads per ADR-053).
2. **Given** the dashboard build and module graph, **When** the initial route loads, **Then** all 6 tab components (`FilesTab`, `CommitsTab`, `PlannerTab`, `TerminalTab`, `BrowserTab`, `UsageTab`) are loaded via `React.lazy()` so Monaco DiffEditor and XTerm.js are excluded from the eager initial bundle.
3. **Given** the `commits` tab (`CommitsTab.tsx`) is opened, **When** inspecting task changes, **Then** it renders the **Deterministic AST Semantic Diff** summary header (e.g., `🛠️ Refactored: AuthService.login() - verified by Tree-sitter` per PRD §12.1) above per-file accordion rows and a Monaco `DiffEditor` (`dir="ltr"`, custom dark theme, max height `600px`) with a 3-mode toggle (`old` / `diff` / `new`).
4. **Given** the `terminal` tab (`TerminalTab.tsx`) is opened, **When** container commands execute, **Then** XTerm.js (`dir="ltr"`) exchanges a single-use WS-TGT ticket via `POST /api/v1/telemetry/ws-ticket` and streams `terminal.chunk` stdout/stderr events in real time.
5. **Given** the `browser` tab (`BrowserTab.tsx`) is opened, **When** evaluating the runtime environment, **Then** if running in Topology A (`solo`) with an active dev server, it embeds the WS-TGT authenticated live HMR preview iframe (PRD §12.2); otherwise (Topology B/C or non-HMR tasks), it renders the Playwright QA viewport displaying screenshots, recorded WebM video demos, and semantic DOM locator breadcrumbs.
6. **Given** the `files` tab (`FilesTab.tsx`) or `planner` tab (`PlannerTab.tsx`) or `usage` tab (`UsageTab.tsx`) is opened, **When** the user interacts with them, **Then**:
   - `files`: clicking a file previews its contents (`dir="ltr"`) and emits an `@current_file` Bi-Directional Viewport Sync marker to the chat context;
   - `planner`: displays the live checklist synchronized with Dev-Level-1's `plan.md` plus **Approve Plan** and **Request Changes** action buttons when in `Plan-Gate` mode;
   - `usage`: renders `ContextMeter` (% of context window filled), `CompactContextButton` (triggering manual context window condensation), and the live token/USD ledger.

---

### User Story 5 - Dual-Persona Kanban Board, Viewer/Client Dashboard, React Flow DAG & Time-Travel Inspector (Priority: P2)

As a product maker, technical lead, or client stakeholder, I need a persona-aware Kanban Board (`KanbanBoard.tsx`), an interactive React Flow DAG Visualizer (`DagGraph.tsx`), and a Time-Travel Trajectory Inspector with Surface A/B timeline drawers (`TimeTravelSlider.tsx`) so non-technical founders see simplified progress (**Maker View**), client stakeholders see a clean read-only executive view (**Viewer/Client Role Dashboard**), and developers can manage the full 8-column lifecycle, draw DAG dependency arrows for branch stacking, and scrub through historical execution snapshots.

**Why this priority**: Required by PRD §12.1, §12.2 and ADR-081 Pattern 3 to unify technical engineers, non-technical makers, and external client viewers on a single platform.

**Independent Test**: Can be tested by rendering `KanbanBoard` across **Developer View** (8 columns), **Maker View** (5 columns + collapsed technical surfaces), and **Viewer/Client Role Dashboard** (Goal, Progress Bar, Playwright Video/Screenshots, Spend only), drawing a dependency edge in `DagGraph` to update `blockedBy` (and verifying cycle rejection), and scrubbing `TimeTravelSlider` through recorded `file.mutation` and `event.stream` snapshots while expanding Surface B terminal drawers from Surface A narrative timeline items.

**Acceptance Scenarios**:

1. **Given** a project configured with `"ui": { "persona": "developer" }` (or any Brownfield project, which defaults to `"developer"` per ADR-081), **When** `KanbanBoard` renders, **Then** it displays the 8 canonical columns (`Backlog`, `Queued / Ready`, `In Progress`, `Internal Review`, `QA Guard Verifying`, `Awaiting Clarification`, `Review Gate`, `Merged / Done`) with full technical tabs enabled.
2. **Given** a Greenfield project configured with `"ui": { "persona": "maker" }`, **When** the dashboard renders, **Then** `KanbanBoard` displays the 5 simplified columns (`Ideas → Planning → Building → Ready to Review → Live`), the Cockpit defaults to showing Chat + `browser` (Live Preview) + `planner` (Progress Checklist) while collapsing technical tabs (`files`, `commits`, `terminal`) by default, and AST diffs/stack traces are hidden behind a "Show Technical Details" toggle.
3. **Given** an authenticated user with the `viewer` (Client/Stakeholder) role, **When** they open the dashboard, **Then** the **Viewer/Client Role Dashboard** (PRD §12.1) strips out AST diffs, terminal traces, and internal configuration controls, displaying only: **Goal**, **Progress Bar**, **Playwright Video Demos/Screenshots**, and **Spend**.
4. **Given** the `DagGraph` React Flow visualizer, **When** a developer draws a dependency arrow from Task A to Task B, **Then** the graph validates acyclicity via `assertNoDependencyCycle` / `update_blocked_by`, updates Task B's `blockedBy` array to include Task A for DAG Branch Stacking (PRD §12.2), and rejects circular edges with an error toast.
5. **Given** the `TimeTravelSlider` and Cockpit timeline for an active or completed task, **When** the developer views or scrubs the slider across recorded `event.stream` and `file.mutation` milestones, **Then** **Surface A (High-Level Narrative Timeline)** displays human-readable milestones (e.g., `"Dev-Level-1 drafted plan"`, `"Implementer edited auth.ts"`, `"Reviewer executed Playwright suite"`) with on-demand expandable **Surface B (Terminal Drawers)** showing the raw stdout/stderr and file snapshot at that exact timestamp.

---

## Edge Cases

- **Rapid prompt submission while chat streaming is active**: Chat input submit button is disabled (replaced by a "Stop Generation" action) while streaming is in progress, preventing duplicate concurrent turns.
- **Network disconnect during WebSocket telemetry streaming**: The terminal and spend ticker display a reconnecting state and automatically request a fresh single-use WS-TGT ticket (`/api/v1/telemetry/ws-ticket`) upon reconnect.
- **BiDi mixed language in commit messages, branch names, and inline paths**: Punctuation, slashes, and flags inside `git` identifiers and file paths (`src/api/v1/tasks.ts`, `--skip-grill`) remain strictly `dir="ltr"` with `unicode-bidi: isolate` inside Arabic (`ar`) paragraphs.
- **Very large diff (> 5,000 lines) in Commits tab**: Diff view renders collapsed per-file accordions capped at `600px` panel height with the Deterministic AST Semantic Diff header so browser memory is never exhausted.
- **DAG cycle creation attempt in React Flow**: Drawing an edge that creates a cycle (`A → B → A`) is intercepted before persistence and surfaces an error notification (`"Cyclic dependency detected; DAG must remain acyclic"`).
- **Operator bypasses Socratic Grilling mid-interview**: Clicking "Skip & Synthesize", passing `--skip-grill`, or switching the Access Mode Pill immediately exits the remaining `GRILL` questions and synthesizes the current context into the `brief.md` preview card without deadlocking the chat.

---

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001 (Dashboard Vite Scaffold, Auth Context & BiDi Isolation Primitives — Task 12.1)**: System MUST provide a React 18 + Vite + Tailwind + Shadcn UI + `@tanstack/react-query` application in `src/dashboard/` (`package.json`, `vite.config.ts`, `src/App.tsx`, `docker/dashboard/Dockerfile`) and implement `<BidiProse dir="auto">`, `<CodeIsolate dir="ltr" className="[unicode-bidi:isolate]">`, and a markdown document post-processor in `src/dashboard/src/lib/bidi.tsx` that keeps all code identifiers, file paths, AST symbols, CLI flags, keyboard shortcuts, and numeric values strictly LTR across `ar`, `en`, `fr`, and `tr` locales (ADR-081 Pattern 1, WCAG 2.1 SC 1.3.4).
- **FR-002 (Backend Chat Streaming & Socratic Grilling Mode — Task 12.2)**: System MUST implement `POST /api/v1/chat/stream` in `src/orchestrator/routes/chat.ts` protected by Casbin `chat_turn` RBAC, streaming responses via Vercel AI SDK (`streamText()` + `toDataStreamResponse()`) over LiteLLM, routing all tool calls (`create_task`, `reorder_backlog`, `update_blocked_by`, `pause_container`, `cancel_task`, `approve_pr_merge`, `modify_blast_radius`) through `executeAuthorizedToolCall` (Phase 3.3), accepting `@current_file` Bi-Directional Viewport Sync markers, and supporting `cockpitMode: 'STANDARD' | 'GRILL'` (where `GRILL` injects the Socratic stress-testing system prompt asking up to 5 probing questions referencing codebase & `constitution.md`, supports `--skip-grill` bypass, drafts into `docs/PRD.md` or `brief.md`, and requires explicit human confirmation before queuing a task).
- **FR-003 (Chat Cockpit, Tool Cards & Panic Button — Task 12.3a)**: System MUST implement `src/dashboard/src/components/cockpit/ChatCockpit.tsx` wired to `/api/v1/chat/stream` with `assistant-ui` streaming semantics, structured tool-call execution cards, a `GRILL` mode toggle, and a prominent **Panic Button (Cancel)** calling `POST /api/v1/tasks/:taskId/cancel`.
- **FR-004 (In-Chat 3-State Access Mode Pill & Live Spend Ticker — Task 12.3b)**: System MUST implement `src/dashboard/src/components/cockpit/AccessModePill.tsx` with canonical states `'plan-read-only'` (`Plan / Read-Only`), `'plan-gate'` (`Plan-Gate`), and `'full-factory'` (`Full Factory`) stored as ephemeral per-message state, editable by `developer`/`lead_dev`/`owner` and display-only for `viewer` (enforced server-side via `change_access_mode_pill`), alongside `src/dashboard/src/components/cockpit/SpendTicker.tsx` updating in real time from WebSocket `cost.delta` frames.
- **FR-005 (Split-Pane Multi-Tab Right Panel — Task 12.4)**: System MUST implement `src/dashboard/src/components/cockpit/RightPanel.tsx` and lazy-loaded tab modules `src/dashboard/src/components/cockpit/tabs/{FilesTab,CommitsTab,PlannerTab,TerminalTab,BrowserTab,UsageTab}.tsx` via `React.lazy()`, persisting split-pane width and selected tab per conversation in `localStorage` (with open/closed drawer state session-only), and delivering:
  - `files`: read-only workspace explorer emitting `@current_file` viewport sync markers;
  - `commits`: Deterministic AST Semantic Diff header + per-file accordions + Monaco `DiffEditor` (`old` / `diff` / `new` toggle, custom dark theme, max height `600px`, `dir="ltr"`);
  - `planner`: live checklist synced with `plan.md` + **Approve Plan** / **Request Changes** buttons in `Plan-Gate` mode;
  - `terminal`: XTerm.js (`dir="ltr"`) streaming `terminal.chunk` via single-use WS-TGT (`/api/v1/telemetry/ws-ticket`);
  - `browser`: Topology A WS-TGT authenticated Live HMR iframe when a local dev server is active, or Playwright preview viewport (screenshots, WebM video, DOM locator breadcrumbs) in Topology B/C or non-HMR runs;
  - `usage`: `ContextMeter` (% context window fill gauge) + `CompactContextButton` (manual context condensation trigger) + live token/USD ledger.
- **FR-006 (Kanban Board, Maker/Developer Personas & Viewer/Client Dashboard — Task 12.5a)**: System MUST implement `src/dashboard/src/components/board/KanbanBoard.tsx` supporting:
  - **Developer View** (`persona: 'developer'` or Brownfield default): 8 canonical columns (`Backlog`, `Queued / Ready`, `In Progress`, `Internal Review`, `QA Guard Verifying`, `Awaiting Clarification`, `Review Gate`, `Merged / Done`) mapping all 16 `TaskStatus` states;
  - **Maker View** (`persona: 'maker'` in Greenfield): 5 simplified columns (`Ideas → Planning → Building → Ready to Review → Live`), collapsing technical tabs (`files`, `commits`, `terminal`) by default while keeping `browser` and `planner` visible, and hiding AST diffs behind a "Show Technical Details" toggle;
  - **Viewer/Client Role Dashboard** (`role === 'viewer'`, PRD §12.1): stakeholder view stripping out AST diffs, terminal traces, and internal configs to show only **Goal**, **Progress Bar**, **Playwright Video Demos/Screenshots**, and **Spend**.
- **FR-007 (React Flow DAG & Time-Travel Trajectory Inspector with Surface A/B Timeline — Task 12.5b)**: System MUST implement `src/dashboard/src/components/board/DagGraph.tsx` allowing interactive dependency arrow drawing (`blockedBy` updates with cycle prevention for DAG Branch Stacking) and `src/dashboard/src/components/board/TimeTravelSlider.tsx` scrubbing through recorded `file.mutation` and `event.stream` snapshots alongside **Surface A (High-Level Narrative Timeline)** items with expandable **Surface B (Terminal Drawers)**.

### Key Entities

- **Cockpit Stream Request (`ChatStreamRequest`)**: Payload sent to `POST /api/v1/chat/stream` (`messages`, `projectId`, `taskId?`, `cockpitMode: 'STANDARD' | 'GRILL'`, `accessModeOverride?: 'plan-read-only' | 'plan-gate' | 'full-factory'`, `currentFile?: string`, `skipGrill?: boolean`).
- **Access Mode Pill (`AccessModePill`)**: Ephemeral per-turn autonomy override (`'plan-read-only' | 'plan-gate' | 'full-factory'`).
- **Cockpit Mode (`CockpitMode`)**: Active conversation strategy (`'STANDARD' | 'GRILL'`).
- **Right Panel Tab (`RightPanelTabId`)**: Active technical surface (`'files' | 'commits' | 'planner' | 'terminal' | 'browser' | 'usage'`).
- **UI Persona & Role View (`UiPersona` / `WorkspaceRole`)**: Presentation filter (`'maker' | 'developer'` in `project.config.json`, plus `'viewer'` stakeholder mode).
- **Trajectory Snapshot (`TrajectorySnapshot`)**: Point-in-time record combining `event.stream` narrative action (Surface A), optional raw `terminal.chunk` stdout/stderr drawer (Surface B), and `file.mutation` diff state for Time-Travel scrubbing.

---

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001 (BiDi Layout Integrity)**: 100% of code identifiers, file paths, CLI commands, AST symbols, keyboard shortcuts, and numeric badges render strictly `dir="ltr"` with `unicode-bidi: isolate` and zero punctuation or path inversion across `ar`, `en`, `fr`, and `tr` locales, passing WCAG 2.1 SC 1.3.4 checks.
- **SC-002 (Bundle Performance & Lazy Loading)**: 100% of the 6 Right Panel tabs (`FilesTab`, `CommitsTab`, `PlannerTab`, `TerminalTab`, `BrowserTab`, `UsageTab`) are dynamically imported via `React.lazy()` so Monaco DiffEditor and XTerm.js are isolated into separate async chunks with 0 bytes in the eager entry chunk.
- **SC-003 (Chat Streaming, ACI RBAC & Grilling Discipline)**: `POST /api/v1/chat/stream` streams tokens via Vercel AI SDK, routes 100% of tool calls through `executeAuthorizedToolCall` (enforcing `RBAC_COCKPIT_TOOL_FORBIDDEN` for unauthorized roles), accepts `@current_file` markers, and in `GRILL` mode asks up to 5 probing questions (with `--skip-grill` bypass) before synthesizing a `brief.md` preview requiring explicit confirmation prior to task creation.
- **SC-004 (Autonomy Pill & Panic Button Enforcement)**: 100% of tasks dispatched with `'plan-read-only'` execute with read-only permissions and zero worktree mutations, 100% of `'plan-gate'` tasks pause at `plan.md` awaiting approval in `PlannerTab`, `viewer` roles cannot alter the Access Mode Pill (`change_access_mode_pill`), and the Panic Button immediately invokes `POST /api/v1/tasks/:taskId/cancel`.
- **SC-005 (Dual-Persona, Viewer Dashboard, DAG & Time-Travel Completeness)**: Switching between **Developer View** (8 columns), **Maker View** (5 columns + collapsed technical surfaces), and **Viewer/Client Role Dashboard** (Goal, Progress Bar, Video/Screenshots, Spend) renders accurately without data loss; drawing DAG edges updates `blockedBy` while blocking cycles; and scrubbing `TimeTravelSlider` accurately reflects recorded `file.mutation` and Surface A/B timeline snapshots.

---

## Assumptions

- Control Plane REST routes (`/api/v1/tasks`, `/api/v1/projects`, `/api/v1/telemetry/ws-ticket`), Casbin RBAC (`requirePermission`, `checkPermission`), and `executeAuthorizedToolCall` from Phases 0–5 are operational.
- LiteLLM Client (`src/orchestrator/gateway/litellm-client.ts`) from Phase 8 and Planner tier `AccessModePill` (`src/orchestrator/tiers/planner.ts`) from Phase 9 are available.
- WebSocket ARP & telemetry events (`cost.delta`, `terminal.chunk`, `file.mutation`, `event.stream`) from Phase 7 are available.
