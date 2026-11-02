# Data Model: Conversational Cockpit, Multi-Tab Right Panel & Kanban/DAG Dashboard (Phase 12)

**Feature**: `014-cockpit-and-kanban-ui`  
**Date**: 2026-10-25  
**Canonical Schema Reference**: `specs/001-multi-agent-platform/data-model.md`, `src/orchestrator/schemas/project-config.ts`, `src/orchestrator/schemas/task.ts`, `src/orchestrator/schemas/arp-envelope.ts`

---

## 1. Cockpit Chat & Streaming Models (`src/orchestrator/routes/chat.ts`)

### 1.1 `CockpitMode` & `AccessModePill`
- `CockpitMode`: `'STANDARD' | 'GRILL'` (ADR-083)
- `AccessModePill`: `'plan-read-only' | 'plan-gate' | 'full-factory'` (ADR-081 Pattern 2, matching `src/orchestrator/tiers/planner.ts`)
- `SupportedLocale`: `'ar' | 'en' | 'fr' | 'tr'` (ADR-081 Pattern 1)

### 1.2 `ChatStreamMessage` & `ChatStreamRequest`
```ts
export interface ChatStreamMessage {
  id?: string;
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
}

export interface RequestedToolCall {
  toolCallId?: string;
  toolName: string;
  args: Record<string, unknown>;
}

export interface ChatStreamRequest {
  projectId: string;
  taskId?: string;
  messages: ChatStreamMessage[];
  cockpitMode?: 'STANDARD' | 'GRILL';
  accessModeOverride?: 'plan-read-only' | 'plan-gate' | 'full-factory';
  currentFile?: string; // @current_file Bi-Directional Viewport Sync marker
  skipGrill?: boolean;  // Explicit --skip-grill bypass
  toolCalls?: RequestedToolCall[];
}
```

### 1.3 `GrillInterviewState`
```ts
export interface GrillInterviewState {
  active: boolean;
  bypassed: boolean;
  questionIndex: number; // 1..5
  maxQuestions: 5;
  currentQuestion: string | null;
  referencedArtifacts: string[]; // e.g. ['constitution.md', 'docs/PRD.md', currentFile]
  targetDocument: 'docs/PRD.md' | 'brief.md';
  briefPreviewMarkdown: string | null;
  requiresConfirmation: boolean; // True when brief preview card is ready for "Queue Task"
}
```

---

## 2. Right Panel State & Lazy Tab Models (`src/dashboard/src/components/cockpit/RightPanel.tsx`)

### 2.1 `RightPanelTabId` & Persistence
- `RightPanelTabId`: `'files' | 'commits' | 'planner' | 'terminal' | 'browser' | 'usage'`
- **Persisted in `localStorage`** under key `graywolf:right-panel:${conversationId}`:
  ```ts
  export interface PersistedRightPanelState {
    widthPx: number; // clamped between 320 and 960, default 480
    activeTab: RightPanelTabId;
  }
  ```
- **Session-only state** (never persisted to `localStorage` per ADR-053):
  - `isOpen: boolean`

### 2.2 Tab View Models
- **`FilesTab`**:
  - `files: Array<{ path: string; sizeBytes: number; contentPreview?: string; scope: 'writable' | 'readonly' | 'forbidden' }>`
  - Selecting a file invokes `onSelectFile(path)` which emits `@current_file: <path>` to the Chat Cockpit context.
- **`CommitsTab`**:
  - `diffMode: 'old' | 'diff' | 'new'`
  - `maxHeightPx: 600` (enforced cap per ADR-053)
  - `theme: 'graywolf-dark'`
  - `astSemanticSummary: string[]` (e.g. `['🛠️ Refactored: AuthService.login() - verified by Tree-sitter']`)
  - `fileDiffs: Array<{ filePath: string; additions: number; deletions: number; oldContent: string; newContent: string; patch: string }>`
- **`PlannerTab`**:
  - `planMarkdown: string`
  - `steps: Array<{ id: string; label: string; completed: boolean }>`
  - `accessMode: AccessModePill`
  - `awaitingHumanPlanApproval: boolean` (shows **Approve Plan** and **Request Changes** buttons when `accessMode === 'plan-gate'`)
- **`TerminalTab`**:
  - Connects using single-use ticket from `POST /api/v1/telemetry/ws-ticket`
  - Renders `terminal.chunk` frames inside an LTR-isolated XTerm.js container (`dir="ltr"`).
- **`BrowserTab`**:
  - `topology: 'solo' | 'team' | 'cloud'`
  - `hmrLiveUrl?: string` (only embedded via WS-TGT iframe when `topology === 'solo'` and active dev server exists)
  - `playwrightArtifacts: Array<{ id: string; type: 'screenshot' | 'video'; url: string; locatorBreadcrumb: string; timestamp: string }>`
- **`UsageTab`**:
  - `contextWindowUsedTokens: number`
  - `contextWindowMaxTokens: number`
  - `contextFillPercent: number` (`0..100`)
  - `taskSpendUsd: number`
  - `workspaceDailySpendUsd: number`
  - `dailySpendCapUsd: number`

---

## 3. Kanban Board, Dual Personas, Viewer Dashboard & Trajectory Models (`src/dashboard/src/components/board/*`)

### 3.1 Canonical 16-State `TaskStatus` to Kanban Column Mapping

#### Developer View (8 Columns)
| Column ID | Display Title | Mapped `TaskStatus` States |
|---|---|---|
| `backlog` | `Backlog` | `BACKLOG`, `UPDATED` |
| `queued` | `Queued / Ready` | `QUEUED`, `BLOCKED` |
| `in_progress` | `In Progress` | `IN_PROGRESS` |
| `internal_review` | `Internal Review` | `INTERNAL_REVIEW`, `INTERNAL_REVIEW_FAILED` |
| `qa_guard` | `QA Guard Verifying` | `GUARD_VERIFYING`, `QA_FIXING`, `VERIFICATION_FAILED` |
| `awaiting_clarification` | `Awaiting Clarification` | `AWAITING_CLARIFICATION`, `ESCALATED` |
| `review_gate` | `Review Gate` | `HUMAN_REVIEW_GATE`, `REJECTED` |
| `merged_done` | `Merged / Done` | `MERGED`, `CANCELLED` |

#### Maker View (5 Columns — Greenfield + `ui.persona === 'maker'`)
| Column ID | Display Title | Mapped `TaskStatus` States |
|---|---|---|
| `ideas` | `Ideas` | `BACKLOG`, `UPDATED` |
| `planning` | `Planning` | `QUEUED`, `BLOCKED`, `AWAITING_CLARIFICATION` |
| `building` | `Building` | `IN_PROGRESS`, `INTERNAL_REVIEW`, `INTERNAL_REVIEW_FAILED`, `GUARD_VERIFYING`, `QA_FIXING`, `VERIFICATION_FAILED` |
| `ready_to_review` | `Ready to Review` | `HUMAN_REVIEW_GATE`, `ESCALATED`, `REJECTED` |
| `live` | `Live` | `MERGED`, `CANCELLED` |

> [!NOTE] All 16 canonical `TaskStatus` values from `src/orchestrator/schemas/task.ts` are covered across the 5 Maker View columns.

#### Viewer / Client Stakeholder Dashboard (`role === 'viewer'`, PRD §12.1)
- Hides AST diffs, terminal traces, and internal configuration controls.
- Exposes strictly:
  - `goal: string`
  - `progressPercent: number` (`0..100`)
  - `demos: Array<{ id: string; title: string; type: 'video' | 'screenshot'; url: string }>`
  - `spendUsd: number`

### 3.2 Time-Travel Trajectory Snapshot (`TimeTravelSlider.tsx`)
```ts
export interface TrajectorySnapshot {
  seq: number;
  timestamp: string;
  narrativeAction: string;       // Surface A: e.g. "Implementer edited src/auth.ts"
  actorTier: 'planner' | 'implementer' | 'reviewer' | 'guard' | 'orchestrator';
  fileMutations: Array<{
    filePath: string;
    operation: 'create' | 'modify' | 'delete';
    patchSummary: string;
  }>;
  terminalStdout?: string;       // Surface B: expandable raw stdout/stderr drawer
  terminalStderr?: string;
  thoughtSummary?: string;
}
```
