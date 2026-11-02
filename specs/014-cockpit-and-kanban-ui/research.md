# Research & Technical Decisions: Conversational Cockpit, Multi-Tab Right Panel & Kanban/DAG Dashboard (Phase 12)

**Feature**: `014-cockpit-and-kanban-ui`  
**Date**: 2026-10-25  
**References**: `docs/implementation-plan-detailed.md` (Phase 12 Tasks 12.1–12.5), `docs/PRD.md` (§12.1, §12.2), `docs/decisions.md` (ADR-052, ADR-053, ADR-066, ADR-081, ADR-083)

---

## Decision 1: Bi-Directional (BiDi) RTL/LTR Isolation & Document Post-Processing (Task 12.1, ADR-081 Pattern 1)

- **Decision**:
  - Implement `<BidiProse dir="auto">` for all conversational prose paragraphs and markdown text blocks so the browser Unicode Bidirectional Algorithm (UBA) detects paragraph direction (`ar`, `en`, `fr`, `tr`) automatically.
  - Implement `<CodeIsolate dir="ltr" className="[unicode-bidi:isolate]">` for all inline `<code>`, fenced `<pre><code>`, file paths, CLI commands/flags, AST symbol identifiers, keyboard shortcuts, and numeric/currency badges.
  - Implement deterministic `postProcessBidiDocument(markdown, locale)` in `src/dashboard/src/lib/bidi.tsx` that wraps inline backticked code spans, file paths (`src/...`), CLI flags (`--...`), and symbol names in `<code dir="ltr" class="bidi-isolate" style="unicode-bidi: isolate">` and Unicode LTR isolate markers (`\u2066...\u2069`), while keeping XTerm.js and Monaco DiffEditor strictly `dir="ltr"`.
- **Rationale**: Prevents inverted file paths (e.g. `ts.htua/crs` instead of `src/auth.ts`) and scrambled punctuation when Arabic (`ar`) prose is mixed with English code identifiers, satisfying WCAG 2.1 SC 1.3.4.
- **Alternatives Considered**:
  - Global `dir="rtl"` or `dir="ltr"` on the entire page: Rejected because global RTL corrupts code blocks, stack traces, and file paths, while global LTR breaks right-alignment of Arabic prose paragraphs.

---

## Decision 2: Vercel AI SDK Data Stream Protocol & Socratic Grilling Engine (`/api/v1/chat/stream`, Task 12.2, ADR-052 & ADR-083)

- **Decision**:
  - Implement `POST /api/v1/chat/stream` in `src/orchestrator/routes/chat.ts` protected by `requirePermission('chat_turn')` (and `enforcePermission(role, 'change_access_mode_pill')` whenever a non-default `accessModeOverride` is supplied by the caller).
  - Format streaming responses using the canonical Vercel AI SDK Data Stream Protocol (`X-Vercel-AI-Data-Stream: v1`, `Content-Type: text/plain; charset=utf-8`), emitting:
    - `0:"<json-escaped text token>"\n` for streamed assistant text chunks
    - `9:{"toolCallId":"...","toolName":"...","args":{...}}\n` for tool call invocations
    - `a:{"toolCallId":"...","result":{...}}\n` for server-authoritative `executeAuthorizedToolCall` results (including structured `RBAC_COCKPIT_TOOL_FORBIDDEN` or `ACI_VALIDATION_FAILED` outcomes)
    - `2:[{"type":"grill_state",...}]\n` for structured Socratic Grilling metadata (`questionIndex`, `maxQuestions: 5`, `briefPreviewMarkdown`, `requiresConfirmation`)
    - `d:{"finishReason":"stop","usage":{...}}\n` for stream completion.
  - Expose `streamText` and `toDataStreamResponse` helpers compatible with Vercel AI SDK semantics over `LiteLLMClient` (with deterministic offline/test synthesis fallback when LiteLLM proxy is not mocked).
  - Support `cockpitMode: 'STANDARD' | 'GRILL'`:
    - In `'GRILL'` mode, inject the Socratic stress-testing system prompt (referencing codebase context, `@current_file` Bi-Directional Viewport Sync marker, and `constitution.md`), asking 1 targeted probing question per turn up to 5 turns maximum.
    - If the operator passes `--skip-grill` in message content, sets `skipGrill: true`, or reaches turn 5 (or switches the Access Mode Pill to bypass), synthesize a structured `brief.md` / `docs/PRD.md` preview card with `requiresConfirmation: true` ("Queue Task" button) before any `create_task` tool call is executed.
- **Rationale**: Adheres to Constitution Principle 7 (Chat as Active Control Plane), ADR-052 (Vercel AI SDK streaming protocol), ADR-066 (ACI Validation Gateway), and ADR-083 (Socratic Grilling before container dispatch).
- **Alternatives Considered**:
  - Unauthenticated or client-side tool execution: Rejected per Constitution Principle 7; every state-modifying tool call must pass `executeAuthorizedToolCall` server-side.
  - Blocking chat until all 5 `GRILL` questions are answered: Rejected per ADR-083; operators can bypass at any time via `--skip-grill` or the Access Mode Pill.

---

## Decision 3: 3-State Access Mode Pill, Panic Button & Live Spend Ticker (Task 12.3, ADR-081 Pattern 2)

- **Decision**:
  - Use the canonical `AccessModePill` union (`'plan-read-only' | 'plan-gate' | 'full-factory'`) matching `src/orchestrator/tiers/planner.ts`.
  - Keep pill state in React component state (ephemeral per-message override; never mutates `project.config.json`).
  - Disable pill switching in the UI when `userRole === 'viewer'`, and enforce `change_access_mode_pill` server-side on `POST /api/v1/chat/stream`.
  - Wire the Panic Button in `ChatCockpit.tsx` to `POST /api/v1/tasks/:taskId/cancel`.
  - Wire `SpendTicker.tsx` to accumulate real-time `cost.delta` WebSocket events (`taskSpendUsd`, `workspaceSpendUsd`, `dailySpendCapUsd`, `tokensUsed`).
- **Rationale**: Guarantees seamless consistency between the Phase 9 Planner tier (`runPlannerTier`) and the Phase 12 Cockpit UI.
- **Alternatives Considered**:
  - Persisting the Access Mode Pill in `project.config.json`: Rejected per ADR-081 Pattern 2 because ephemeral brainstorming should not overwrite persistent repository governance.

---

## Decision 4: Resizable 6-Tab Right Panel & Asynchronous Chunk Segregation (Task 12.4, ADR-053)

- **Decision**:
  - Implement `RightPanel.tsx` with 6 tabs (`'files' | 'commits' | 'planner' | 'terminal' | 'browser' | 'usage'`) loaded via `React.lazy()`:
    - `FilesTab.tsx`: Read-only workspace tree + LTR file preview + `@current_file` emitter.
    - `CommitsTab.tsx`: Deterministic AST Semantic Diff header (`🛠️ Refactored: ... - verified by Tree-sitter`) + per-file accordions + Monaco `DiffEditor` wrapper (`old` / `diff` / `new` mode toggle, `maxHeight: 600px`, custom dark theme, `dir="ltr"`).
    - `PlannerTab.tsx`: Live `plan.md` checklist + one-click **Approve Plan** and **Request Changes** buttons when `accessMode === 'plan-gate'`.
    - `TerminalTab.tsx`: XTerm.js (`dir="ltr"`) connecting via single-use WS-TGT (`POST /api/v1/telemetry/ws-ticket`) to stream `terminal.chunk` events.
    - `BrowserTab.tsx`: Topology A (`solo`) WS-TGT authenticated Live HMR iframe when `hmrServerUrl` is active; otherwise Playwright QA preview viewport (screenshots, WebM video demo, DOM locator breadcrumbs).
    - `UsageTab.tsx`: `ContextMeter` (% fill gauge with warning/critical thresholds), `CompactContextButton` (triggers manual context window condensation), and token/USD ledger.
  - Persist `{ widthPx, activeTab }` in `localStorage` keyed by `graywolf:right-panel:${conversationId}`, while keeping `isOpen` strictly in session state (per ADR-053).
  - Configure `src/dashboard/vite.config.ts` and the dashboard build pipeline so each lazy tab (including Monaco and XTerm wrappers) is emitted into its own separate asynchronous chunk (`CommitsTab-*.js`, `TerminalTab-*.js`, etc.) with 0 bytes of Monaco/XTerm in the eager entry bundle (`index.js` < 300 kB gzip).
- **Rationale**: Satisfies ADR-053 and SC-002 while ensuring `pnpm --dir src/dashboard build` works deterministically in offline/sandboxed CI environments.
- **Alternatives Considered**:
  - Eagerly importing all 6 tabs in `RightPanel.tsx`: Rejected because bundling Monaco and XTerm into the entry chunk bloats initial load size beyond 3 MB.

---

## Decision 5: Dual-Persona Kanban, Viewer/Client Dashboard, React Flow DAG & Time-Travel Surface A/B (Task 12.5, PRD §12.1–12.2 & ADR-081 Pattern 3)

- **Decision**:
  - `KanbanBoard.tsx` supports three deterministic presentation modes:
    1. **Developer View** (`persona === 'developer'` or `mode === 'brownfield'`): 8 columns (`Backlog`, `Queued / Ready`, `In Progress`, `Internal Review`, `QA Guard Verifying`, `Awaiting Clarification`, `Review Gate`, `Merged / Done`) mapping all 16 canonical `TaskStatus` states.
    2. **Maker View** (`persona === 'maker'` in `mode === 'greenfield'`): 5 simplified columns (`Ideas`, `Planning`, `Building`, `Ready to Review`, `Live`), collapsing `files`, `commits`, and `terminal` tabs by default while keeping `browser` and `planner` visible, and hiding AST diffs behind a `"Show Technical Details"` toggle.
    3. **Viewer/Client Role Dashboard** (`userRole === 'viewer'`, PRD §12.1): strips out AST diffs, terminal traces, and internal configuration controls, rendering only **Goal**, **Progress Bar**, **Playwright Video Demos/Screenshots**, and **Spend**.
  - `DagGraph.tsx`: Interactive React Flow DAG board rendering task nodes and dependency edges; drawing an edge from `sourceTaskId` to `targetTaskId` validates acyclicity via `assertNoDependencyCycle` before appending `sourceTaskId` to `targetTaskId.blockedBy` for DAG Branch Stacking (PRD §12.2).
  - `TimeTravelSlider.tsx`: Timeline scrubber over recorded `TrajectorySnapshot` milestones (`file.mutation` + `event.stream` + `terminal.chunk`), displaying **Surface A (High-Level Narrative Timeline)** items with on-demand expandable **Surface B (Terminal Drawers)**.
- **Rationale**: Fulfils PRD §12.1, §12.2 and ADR-081 Pattern 3 across technical developers, non-technical makers, and external client stakeholders.
- **Alternatives Considered**:
  - Separate frontend applications for Maker, Developer, and Viewer roles: Rejected per ADR-081 in favor of a single unified dashboard with role/persona-driven view projection.
