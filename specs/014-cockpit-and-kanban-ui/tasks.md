# Tasks: Conversational Cockpit, Multi-Tab Right Panel & Kanban/DAG Dashboard

**Input**: Design documents from `/specs/014-cockpit-and-kanban-ui/`  
**Prerequisites**: `plan.md` (required), `spec.md` (required), `research.md`, `data-model.md`, `contracts/cockpit-and-kanban.md`

**Tests**: Included as required by `docs/implementation-plan-detailed.md` Phase 12 (`tests/integration/chat-grill.test.ts` and `src/dashboard/tests/cockpit.test.tsx` + `pnpm --dir src/dashboard build`).

**Organization**: Tasks are grouped by user story and mapped directly to Phase 12 Tasks 12.1–12.5 in `docs/implementation-plan-detailed.md`.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (`[US1]`, `[US2]`, `[US3]`, `[US4]`, `[US5]`)
- Include exact file paths in descriptions

---

## Phase 1: User Story 2 - Dashboard Vite Scaffold, Auth Context & BiDi Isolation Primitives (Priority: P1 — Master Plan Task 12.1)

**Goal**: Scaffold the React + Vite + Tailwind + Shadcn dashboard in `src/dashboard/` and implement `<BidiProse dir="auto">`, `<CodeIsolate dir="ltr" className="[unicode-bidi:isolate]">`, and the markdown document post-processor (`postProcessBidiDocument`) keeping code identifiers, file paths, AST symbols, CLI commands/flags, keyboard shortcuts, and numeric values strictly LTR across `ar`, `en`, `fr`, and `tr` locales (ADR-081 Pattern 1, WCAG 2.1 SC 1.3.4).

**Independent Test**: Run `pnpm --dir src/dashboard build` and BiDi post-processor unit tests in `src/dashboard/tests/cockpit.test.tsx`.

### Implementation for User Story 2 (Master Plan Task 12.1)

- [X] T001 [P] [US2] Register `src/dashboard` as a pnpm workspace package by adding `packages: ['src/dashboard']` to `pnpm-workspace.yaml`; create `src/dashboard/package.json` (`"name": "graywolf-dashboard"`, `"private": true`) with frontend dependencies (`react ^18`, `react-dom ^18`, `@tanstack/react-query ^5`, `@assistant-ui/react ^0.5`, `reactflow ^11`, `@monaco-editor/react ^4`, `@xterm/xterm ^5`, `@xterm/addon-fit ^0.10`, `vite ^5`, `@vitejs/plugin-react ^4`, `tailwindcss ^3`, `@shadcn/ui`, `typescript ^5`, `vitest ^3`, `@testing-library/react ^16`); create `src/dashboard/vite.config.ts` with `manualChunks` splitting each lazy tab into its own async chunk; create `src/dashboard/src/lib/jsx-runtime.ts` exporting `type VNode = React.ReactElement | null`; create `docker/dashboard/Dockerfile` (multi-stage Vite build + Nginx container); update root `tsconfig.json` `include` to cover `src/dashboard/**/*.tsx` so that `pnpm --dir src/dashboard build` emits the eager entry bundle (`< 300 kB gzip`) and segregated async chunks
- [X] T002 [P] [US2] Implement `<BidiProse dir="auto">`, `<CodeIsolate dir="ltr" className="[unicode-bidi:isolate]">`, `postProcessBidiDocument`, and `verifyBidiCompliance` in `src/dashboard/src/lib/bidi.tsx` enforcing strict LTR isolation on code spans, file paths, AST symbols, CLI flags, keyboard shortcuts, and numeric badges across `ar`, `en`, `fr`, and `tr` locales (WCAG 2.1 SC 1.3.4)
- [X] T003 [US2] Implement `src/dashboard/src/App.tsx` providing the dashboard shell, authentication/session context (`userId`, `workspaceId`, `role`), project persona context (`'maker' | 'developer'`), and locale context (`'ar' | 'en' | 'fr' | 'tr'`)

**Checkpoint**: Dashboard scaffold and BiDi primitives (Task 12.1) are in place and build cleanly.

---

## Phase 2: User Story 1 - Backend Chat Streaming (`/api/v1/chat/stream`) & Socratic Grilling Mode (`GRILL`, ADR-083) (Priority: P1 🎯 MVP — Master Plan Task 12.2)

**Goal**: Implement `POST /api/v1/chat/stream` (`src/orchestrator/routes/chat.ts`) using Vercel AI SDK Data Stream framing (`streamText()` + `toDataStreamResponse()`) over LiteLLM, routing tool calls through `executeAuthorizedToolCall` (Phase 3.3), enforcing Casbin `chat_turn` and `change_access_mode_pill` RBAC, accepting `@current_file` Bi-Directional Viewport Sync markers, and supporting `cockpitMode: 'STANDARD' | 'GRILL'` (up to 5 probing questions referencing codebase & `constitution.md`, `--skip-grill` bypass, drafting into `docs/PRD.md` or `brief.md`, and requiring explicit confirmation before queuing).

**Independent Test**: Run `pnpm vitest run tests/integration/chat-grill.test.ts` to verify streaming frames, ACI tool authorization, `@current_file` context sync, and Socratic `GRILL` mode.

### Implementation & Tests for User Story 1 (Master Plan Task 12.2)

- [X] T004 [US1] Implement the `POST /api/v1/chat/stream` Fastify route in `src/orchestrator/routes/chat.ts` (registered in `src/orchestrator/app.ts` as `chatRoutes` with prefix `/api/v1`). **Vercel AI SDK Data Stream framing must be hand-rolled** on top of `LiteLLMClient.complete()` (which already calls the LiteLLM OpenAI-compatible `/v1/chat/completions` endpoint): the route sets `Content-Type: text/plain; charset=utf-8` + `X-Vercel-AI-Data-Stream: v1`, uses chunked transfer encoding, and emits `0:`, `9:`, `a:`, `2:`, `d:` frame lines as the conversation progresses. Enforce `requirePermission('chat_turn')` (Casbin: `developer`/`lead_dev`/`owner`; `viewer` → `403 RBAC_INSUFFICIENT_ROLE`); if `body.accessModeOverride` is set, additionally enforce `change_access_mode_pill` permission; route all 7 cockpit tools (`create_task`, `reorder_backlog`, `update_blocked_by`, `pause_container`, `cancel_task`, `approve_pr_merge`, `modify_blast_radius`) through `executeAuthorizedToolCall`; inject `@current_file` viewport sync markers into the system context; implement `buildGrillSystemPrompt` and `evaluateGrillTurn` for `cockpitMode: 'STANDARD' | 'GRILL'` (up to 5 probing questions, `--skip-grill` / `skipGrill: true` bypass, `briefPreviewMarkdown` synthesis, `requiresConfirmation: true` gate before `create_task`)
- [X] T005 [US1] Create integration test suite in `tests/integration/chat-grill.test.ts` testing `POST /api/v1/chat/stream` Vercel AI SDK stream framing, authorized vs unauthorized (`RBAC_COCKPIT_TOOL_FORBIDDEN`) tool calls, `viewer` role rejection (`403 RBAC_INSUFFICIENT_ROLE`), `@current_file` viewport sync injection, and 5-turn Socratic Grilling (`GRILL` mode probing questions, `--skip-grill` bypass, and explicit confirmation gate before `create_task`)

**Checkpoint**: Backend chat streaming & Socratic Grilling (Task 12.2) is complete and verified via `tests/integration/chat-grill.test.ts`.

---

## Phase 3: User Story 1 & User Story 3 - Chat Cockpit (`assistant-ui`), Access Mode Pill, Panic Button & Live Spend Ticker (Priority: P1 — Master Plan Task 12.3)

**Goal**: Implement `ChatCockpit.tsx`, `AccessModePill.tsx` (`'plan-read-only' | 'plan-gate' | 'full-factory'`), Panic Button (`POST /api/v1/tasks/:taskId/cancel`), and `SpendTicker.tsx` (`cost.delta` WebSocket ticker).

**Independent Test**: Run `pnpm vitest run src/dashboard/tests/cockpit.test.tsx` to verify `ChatCockpit`, `AccessModePill` RBAC & overrides, Panic Button cancellation, and `SpendTicker` real-time updates.

### Implementation for User Stories 1 & 3 (Master Plan Task 12.3)

- [X] T006 [P] [US3] Implement 3-state `AccessModePill` (`'plan-read-only'`, `'plan-gate'`, `'full-factory'`) in `src/dashboard/src/components/cockpit/AccessModePill.tsx` storing ephemeral per-message override state, allowing edits for `developer`/`lead_dev`/`owner`, and locking to read-only display for `viewer`
- [X] T007 [P] [US1] Implement `SpendTicker` in `src/dashboard/src/components/cockpit/SpendTicker.tsx` consuming WebSocket `cost.delta` events to update active task USD, workspace daily USD, token count, and WS-TGT reconnect status in real time
- [X] T008 [US1] Implement `ChatCockpit` in `src/dashboard/src/components/cockpit/ChatCockpit.tsx` wiring `assistant-ui` message streaming to `/api/v1/chat/stream`, rendering tool-call execution cards, `GRILL` mode toggle + `brief.md` confirmation card ("Queue Task"), `AccessModePill`, `SpendTicker`, and the prominent **Panic Button (Cancel)** calling `POST /api/v1/tasks/:taskId/cancel`

**Checkpoint**: Chat Cockpit, Access Mode Pill, Panic Button, and Spend Ticker (Task 12.3) are complete.

---

## Phase 4: User Story 4 - Split-Pane Multi-Tab Right Panel with Lazy-Loaded Surfaces (Priority: P1 — Master Plan Task 12.4)

**Goal**: Implement resizable `RightPanel.tsx` persisting width and selected tab per conversation in `localStorage` (while keeping open/closed state session-only) and lazy-loading all 6 tabs via `React.lazy()` (`FilesTab`, `CommitsTab`, `PlannerTab`, `TerminalTab`, `BrowserTab`, `UsageTab`) so Monaco DiffEditor and XTerm.js are excluded from the eager bundle.

**Independent Test**: Run `pnpm --dir src/dashboard build` and `pnpm vitest run src/dashboard/tests/cockpit.test.tsx` to verify `localStorage` persistence, session-only drawer state, and async chunk isolation of Monaco and XTerm.

### Implementation for User Story 4 (Master Plan Task 12.4)

- [X] T009 [P] [US4] Implement `FilesTab` (`src/dashboard/src/components/cockpit/tabs/FilesTab.tsx`, read-only workspace explorer emitting `@current_file` viewport sync), `PlannerTab` (`src/dashboard/src/components/cockpit/tabs/PlannerTab.tsx`, live `plan.md` checklist + **Approve Plan** / **Request Changes** buttons in `'plan-gate'` mode), and `UsageTab` (`src/dashboard/src/components/cockpit/tabs/UsageTab.tsx`, `ContextMeter` % fill gauge + `CompactContextButton` + token/USD ledger)
- [X] T010 [P] [US4] Implement `CommitsTab` (`src/dashboard/src/components/cockpit/tabs/CommitsTab.tsx`, Deterministic AST Semantic Diff header + per-file accordions + Monaco `DiffEditor` with `'old' | 'diff' | 'new'` toggle, custom dark theme, max height `600px`, `dir="ltr"`), `TerminalTab` (`src/dashboard/src/components/cockpit/tabs/TerminalTab.tsx`, XTerm.js `dir="ltr"` streaming `terminal.chunk` via single-use WS-TGT `/api/v1/telemetry/ws-ticket`), and `BrowserTab` (`src/dashboard/src/components/cockpit/tabs/BrowserTab.tsx`, Topology A WS-TGT Live HMR iframe vs Playwright QA preview viewport)
- [X] T011 [US4] Implement `RightPanel` in `src/dashboard/src/components/cockpit/RightPanel.tsx` with resizable split pane, per-conversation `localStorage` persistence of `widthPx` and `activeTab` (keeping `isOpen` session-only), and `React.lazy()` dynamic imports for all 6 tab modules

**Checkpoint**: Split-Pane 6-Tab Right Panel (Task 12.4) is complete with Monaco and XTerm isolated into async chunks.

---

## Phase 5: User Story 5 - Kanban Board, React Flow DAG, Time-Travel Inspector & Maker/Developer/Viewer Personas (Priority: P2 — Master Plan Task 12.5)

**Goal**: Implement `KanbanBoard.tsx` (Developer View 8 columns, Maker View 5 columns + collapsed technical tabs + hidden AST diffs toggle, and Viewer/Client Stakeholder Dashboard), `DagGraph.tsx` (React Flow dependency arrow drawing for DAG Branch Stacking with cycle prevention), and `TimeTravelSlider.tsx` (scrubbing `file.mutation` and `event.stream` snapshots with Surface A Narrative Timeline and expandable Surface B Terminal Drawers).

**Independent Test**: Run `pnpm vitest run src/dashboard/tests/cockpit.test.tsx` to verify Developer View, Maker View, Viewer/Client Dashboard, DAG edge creation & cycle rejection, and Time-Travel Surface A/B scrubbing.

### Implementation & Tests for User Story 5 (Master Plan Task 12.5)

- [X] T012 [P] [US5] Implement `KanbanBoard` in `src/dashboard/src/components/board/KanbanBoard.tsx` supporting **Developer View** (8 columns mapping all 16 `TaskStatus` states), **Maker View** (`Ideas → Planning → Building → Ready to Review → Live`, collapsing `files`, `commits`, `terminal` tabs by default while keeping `browser` and `planner` visible, and hiding AST diffs behind `"Show Technical Details"`), and **Viewer/Client Stakeholder Dashboard** (displaying only Goal, Progress Bar, Playwright Video Demos/Screenshots, and Spend)
- [X] T013 [P] [US5] Implement `DagGraph` in `src/dashboard/src/components/board/DagGraph.tsx` (React Flow DAG visualizer supporting dependency edge creation to update `blockedBy` for DAG Branch Stacking and rejecting cycles via `assertNoDependencyCycle`) and `TimeTravelSlider` in `src/dashboard/src/components/board/TimeTravelSlider.tsx` (scrubbing `file.mutation` and `event.stream` snapshots with Surface A Narrative Timeline and expandable Surface B Terminal Drawers)
- [X] T014 [US5] Create comprehensive dashboard component & bundle test suite in `src/dashboard/tests/cockpit.test.tsx` covering BiDi isolation (`ar`/`en`/`fr`/`tr`), `ChatCockpit` + `AccessModePill` + Panic Button + `SpendTicker`, `RightPanel` `localStorage` persistence & `React.lazy()` async chunk inspection (confirming Monaco/XTerm are absent from eager bundle), and `KanbanBoard` (Developer, Maker, and Viewer views) + `DagGraph` + `TimeTravelSlider`

**Checkpoint**: All Phase 12 user stories (Tasks 12.1–12.5) are complete and tested.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Full dashboard build, repository typecheck, lint, and regression suite verification.

- [X] T015 Run `pnpm --dir src/dashboard build`, `pnpm typecheck`, `pnpm lint`, and `pnpm test` across all suites and mark Tasks 12.1, 12.2, 12.3, 12.4, and 12.5 `[x]` in `docs/implementation-plan-detailed.md`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (`T001`–`T003`, Task 12.1 Scaffold & BiDi)**: Foundation for dashboard modules — starts immediately.
- **Phase 2 (`T004`–`T005`, Task 12.2 `/api/v1/chat/stream` & `GRILL`)**: Backend route — can run in parallel with Phase 1.
- **Phase 3 (`T006`–`T008`, Task 12.3 Cockpit, AccessModePill, Panic Button, SpendTicker)**: Depends on `T001`–`T002`.
- **Phase 4 (`T009`–`T011`, Task 12.4 6-Tab Lazy Right Panel)**: Depends on `T001`–`T002`; can run in parallel with Phase 3.
- **Phase 5 (`T012`–`T014`, Task 12.5 Kanban, DAG, Time-Travel & Component Test Suite)**: `T012`–`T013` can run in parallel with Phases 3–4; `T014` verifies all dashboard modules from `T001`–`T013`.
- **Phase 6 (`T015`)**: Final verification after `T001`–`T014`.

### Parallel Opportunities

- `T001`, `T002`, and `T004` touch independent files and can be developed in parallel.
- `T006`, `T007`, `T009`, `T010`, `T012`, and `T013` touch separate component files under `src/dashboard/src/components/` and can be developed in parallel.
