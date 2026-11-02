# Interface Contracts: Conversational Cockpit, Multi-Tab Right Panel & Kanban/DAG Dashboard (Phase 12)

**Feature**: `014-cockpit-and-kanban-ui`  
**Date**: 2026-10-25

---

## 1. Backend Chat Streaming Route (`src/orchestrator/routes/chat.ts`)

### `POST /api/v1/chat/stream`

- **Authentication & RBAC**:
  - Requires valid session (`verifySession`) and Casbin permission `'chat_turn'` (`developer`, `lead_dev`, `owner`; `viewer` is rejected with `403 RBAC_INSUFFICIENT_ROLE`).
  - If `body.accessModeOverride` is provided, enforces Casbin permission `'change_access_mode_pill'`.
- **Request Body (`ChatStreamRequestSchema`)**:
  ```json
  {
    "projectId": "00000000-0000-4000-8000-000000000001",
    "taskId": "TASK-101",
    "cockpitMode": "GRILL",
    "accessModeOverride": "plan-gate",
    "currentFile": "src/orchestrator/routes/tasks.ts",
    "skipGrill": false,
    "messages": [
      { "role": "user", "content": "Add multi-currency VAT invoice export" }
    ],
    "toolCalls": []
  }
  ```
- **Response Headers**:
  - `Content-Type: text/plain; charset=utf-8`
  - `X-Vercel-AI-Data-Stream: v1`
  - `Cache-Control: no-cache, no-transform`
- **Data Stream Frame Types**:
  - `0:"<text chunk>"\n` — Assistant prose token chunk
  - `9:{"toolCallId":"call_1","toolName":"create_task","args":{...}}\n` — Tool call invocation
  - `a:{"toolCallId":"call_1","result":{"toolName":"create_task","authorized":true,"executed":true,"result":{...}}}\n` — Tool call execution result via `executeAuthorizedToolCall`
  - `2:[{"type":"context_sync","currentFile":"src/orchestrator/routes/tasks.ts","accessMode":"plan-gate","cockpitMode":"GRILL","grillState":{...}}]\n` — Metadata annotation frame
  - `d:{"finishReason":"stop","usage":{"promptTokens":120,"completionTokens":64}}\n` — Finish frame

---

## 2. BiDi Isolation Primitives (`src/dashboard/src/lib/bidi.tsx`)

```ts
export type SupportedLocale = 'ar' | 'en' | 'fr' | 'tr';

/**
 * VNode is the canonical alias for React component return values used
 * throughout src/dashboard. Defined in src/dashboard/src/lib/jsx-runtime.ts
 * as: export type VNode = React.ReactElement | null;
 */
export type VNode = React.ReactElement | null;

export interface BidiProseProps {
  children: unknown;
  locale?: SupportedLocale;
  className?: string;
}

export interface CodeIsolateProps {
  children: unknown;
  as?: 'code' | 'pre' | 'span' | 'kbd';
  className?: string;
}

export function BidiProse(props: BidiProseProps): VNode;
export function CodeIsolate(props: CodeIsolateProps): VNode;
export function postProcessBidiDocument(markdown: string, locale?: SupportedLocale): string;
export function verifyBidiCompliance(renderedHtml: string): {
  compliant: boolean;
  violations: string[];
};
```

---

## 3. Cockpit Components (`src/dashboard/src/components/cockpit/*`)

### 3.1 `AccessModePill.tsx`
```ts
export type AccessModePillValue = 'plan-read-only' | 'plan-gate' | 'full-factory';

export interface AccessModePillOption {
  value: AccessModePillValue;
  label: 'Plan / Read-Only' | 'Plan-Gate' | 'Full Factory';
  icon: '🔍' | '✋' | '⚡';
  readOnlyContainer: boolean;
  requiresPlanApproval: boolean;
}

export function canEditAccessModePill(role: WorkspaceRole): boolean;
export function renderAccessModePill(props: {
  value: AccessModePillValue;
  role: WorkspaceRole;
  onChange?: (next: AccessModePillValue) => void;
}): React.ReactElement | null;
```

### 3.2 `SpendTicker.tsx`
```ts
export interface SpendTickerState {
  taskId?: string;
  taskSpendUsd: number;
  workspaceDailySpendUsd: number;
  dailySpendCapUsd: number;
  totalTokens: number;
  connectionStatus: 'connected' | 'reconnecting' | 'disconnected';
}

export function applyCostDeltaEvent(
  state: SpendTickerState,
  deltaPayload: { costUsdDelta: number; tokensDelta: number; taskId?: string }
): SpendTickerState;
export function renderSpendTicker(state: SpendTickerState): React.ReactElement | null;
```

### 3.3 `ChatCockpit.tsx`
```ts
export interface ChatCockpitProps {
  conversationId: string;
  projectId: string;
  activeTaskId?: string;
  userRole: WorkspaceRole;
  initialCockpitMode?: 'STANDARD' | 'GRILL';
  initialAccessMode?: AccessModePillValue;
  currentFile?: string;
  onCancelTask?: (taskId: string) => Promise<{ status: string }>;
  onSendMessage?: (req: ChatStreamRequest) => Promise<void>;
}
```

---

## 4. Split-Pane Multi-Tab Right Panel (`src/dashboard/src/components/cockpit/RightPanel.tsx`)

```ts
export type RightPanelTabId = 'files' | 'commits' | 'planner' | 'terminal' | 'browser' | 'usage';

export const RIGHT_PANEL_LAZY_TABS: Record<
  RightPanelTabId,
  () => Promise<{ default: (props: Record<string, unknown>) => VNode }>
>;

export function loadPersistedRightPanelState(
  conversationId: string,
  storage?: Pick<Storage, 'getItem'>
): { widthPx: number; activeTab: RightPanelTabId };

export function savePersistedRightPanelState(
  conversationId: string,
  state: { widthPx: number; activeTab: RightPanelTabId },
  storage?: Pick<Storage, 'setItem'>
): void;
```

---

## 5. Kanban Board, DAG Visualizer & Time-Travel Inspector (`src/dashboard/src/components/board/*`)

```ts
export function getKanbanColumnsForView(options: {
  persona: 'maker' | 'developer';
  projectMode: 'greenfield' | 'brownfield';
  userRole: WorkspaceRole;
}): {
  viewMode: 'developer' | 'maker' | 'viewer';
  columns: Array<{ id: string; title: string; statuses: TaskStatus[] }>;
  collapsedTabs: RightPanelTabId[];
  visibleTabs: RightPanelTabId[];
  hideAstDiffsByDefault: boolean;
};

/**
 * Validates that adding a dependency edge from sourceTaskId to targetTaskId
 * does not create a cycle. Returns a discriminated union:
 * - On success: updated node array + new blockedBy list (cycle: false)
 * - On failure: the path of the detected cycle (cycle: true)
 * Must call assertNoDependencyCycle from src/orchestrator/services/dag.ts
 * both client-side (pre-render) and server-side (update_blocked_by ACI tool).
 */
export function connectDagDependencyEdge(
  nodes: DagTaskNode[],
  sourceTaskId: string,
  targetTaskId: string
):
  | { cycle: false; updatedNodes: DagTaskNode[]; targetBlockedBy: string[] }
  | { cycle: true; cyclePath: string[] };

export function selectTrajectorySnapshotAtStep(
  snapshots: TrajectorySnapshot[],
  stepIndex: number
): TrajectorySnapshot | null;
```
