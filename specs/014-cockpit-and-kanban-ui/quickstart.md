# Quickstart & Verification Guide: Conversational Cockpit, Multi-Tab Right Panel & Kanban/DAG Dashboard (Phase 12)

**Feature**: `014-cockpit-and-kanban-ui`  
**Date**: 2026-10-25

---

## Prerequisites

- Node.js 20+ and `pnpm` installed
- Phases 0–11 modules present in `src/orchestrator/`

---

## Verification Scenarios

### 1. Dashboard Build & Lazy-Loaded Chunk Segregation (Tasks 12.1 & 12.4)

```bash
pnpm --dir src/dashboard build
```

**Expected Outcome**:
- `src/dashboard/dist/` is produced cleanly.
- Eager entry bundle (`dist/assets/index.js`) is `< 300 kB` and contains `0` bytes of Monaco DiffEditor or XTerm.js implementation code.
- Each of the 6 Right Panel tabs (`FilesTab`, `CommitsTab`, `PlannerTab`, `TerminalTab`, `BrowserTab`, `UsageTab`) is emitted as a separate asynchronous chunk in `src/dashboard/dist/assets/`.

### 2. Backend Chat Streaming & Socratic Grilling Integration Test (Task 12.2)

```bash
pnpm vitest run tests/integration/chat-grill.test.ts
```

**Expected Outcome**:
- `POST /api/v1/chat/stream` streams Vercel AI SDK data frames (`0:`, `9:`, `a:`, `2:`, `d:`).
- Tool calls (`create_task`, `reorder_backlog`, `approve_pr_merge`, etc.) route through `executeAuthorizedToolCall` and enforce Casbin RBAC (`RBAC_COCKPIT_TOOL_FORBIDDEN` for unauthorized roles).
- `cockpitMode: 'GRILL'` asks up to 5 structured probing questions referencing codebase & `constitution.md`, honors `--skip-grill` bypass, and emits a `brief.md` preview card requiring confirmation before task creation.
- `@current_file` Bi-Directional Viewport Sync markers are injected into the active prompt context.

### 3. Cockpit, BiDi, Right Panel & Kanban/DAG Component Tests (Tasks 12.1, 12.3, 12.4, 12.5)

```bash
pnpm vitest run src/dashboard/tests/cockpit.test.tsx
```

**Expected Outcome**:
- `<BidiProse dir="auto">` and `<CodeIsolate dir="ltr">` + `postProcessBidiDocument` preserve strict LTR isolation across `ar`, `en`, `fr`, and `tr` locales (WCAG 2.1 SC 1.3.4).
- 3-state Access Mode Pill (`'plan-read-only'`, `'plan-gate'`, `'full-factory'`), Panic Button (`POST /api/v1/tasks/:taskId/cancel`), and Live Spend Ticker (`cost.delta`) function end-to-end and enforce read-only pill state for `viewer`.
- Right Panel persists width and active tab per conversation in `localStorage` while keeping drawer open/closed state session-only, lazy-loads all 6 tabs, caps `CommitsTab` DiffEditor at `600px` with AST Semantic Diff header, and switches `BrowserTab` between Topology A HMR iframe and Playwright artifacts.
- `KanbanBoard` renders 8 columns in Developer View, 5 columns + collapsed technical tabs in Maker View, and simplified Goal/Progress/Demos/Spend in Viewer/Client Stakeholder Dashboard.
- `DagGraph` adds `blockedBy` dependency edges for branch stacking and rejects cyclic edges.
- `TimeTravelSlider` scrubs across `file.mutation` and `event.stream` milestones with Surface A Narrative Timeline and expandable Surface B Terminal Drawers.

### 4. Full Typecheck, Lint & Repository Test Suite

```bash
pnpm typecheck && pnpm lint && pnpm test
```
