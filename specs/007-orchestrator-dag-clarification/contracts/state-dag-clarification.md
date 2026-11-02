# Interface Contracts: 007-orchestrator-dag-clarification

**Feature Branch**: `007-orchestrator-dag-clarification`  
**Date**: 2026-10-18

## 1. Canonical Task State Machine Contract (`src/orchestrator/services/state-machine.ts`)

```typescript
import { TaskStatus } from '../schemas/task';

export const LEGAL_TASK_STATE_TRANSITIONS: Readonly<
  Record<TaskStatus, readonly TaskStatus[]>
>;

export function canTransitionTaskState(
  from: TaskStatus,
  to: TaskStatus
): boolean;

export function assertValidTaskTransition(
  from: TaskStatus,
  to: TaskStatus,
  taskId?: string
): void;

export function getAllowedNextStates(
  from: TaskStatus
): readonly TaskStatus[];
```

## 2. DAG Topological Scheduler & Scope Overlap Contract (`src/orchestrator/services/dag.ts`)

```typescript
export interface DagTaskNode {
  id: string;
  status: TaskStatus;
  blockedBy: string[];
  writableScope: string[];
  targetFiles?: string[];
}

export function detectDependencyCycle(
  tasks: DagTaskNode[]
): string[] | null;

export function assertNoDependencyCycle(
  tasks: DagTaskNode[]
): void;

export function topologicalSortTasks(
  tasks: DagTaskNode[]
): DagTaskNode[];

export function isTaskReady(
  task: DagTaskNode,
  allTasksMap: ReadonlyMap<string, DagTaskNode> | Record<string, DagTaskNode>,
  options?: { allowBranchStacking?: boolean }
): boolean;

export function assertTaskReadyForDispatch(
  task: DagTaskNode,
  allTasksMap: ReadonlyMap<string, DagTaskNode> | Record<string, DagTaskNode>,
  options?: { allowBranchStacking?: boolean }
): void;

export function hasWritableScopeOverlap(
  candidateTask: DagTaskNode,
  activeTasks: DagTaskNode[]
): {
  overlaps: boolean;
  overlappingTaskIds: string[];
  reasons: string[];
};
```

## 3. Clarification Question Protocol Contract (`src/orchestrator/services/clarification.ts`)

```typescript
export interface ClarificationOptions {
  baseDir?: string;
  maxQuestionsPerRound?: number; // defaults to 5
  maxRoundsPerTask?: number;     // defaults to 2
  workspaceId?: string;
  orgId?: string;
  syncToDb?: boolean;
  onCockpitNotify?: (event: {
    parentTaskId: string;
    childTaskId: string;
    title: string;
    round: number;
    questions: string[];
  }) => void | Promise<void>;
  onArpClarificationResponse?: (payload: {
    taskId: string;
    round: number;
    answers: string[];
  }) => void | Promise<void>;
}

export async function requestTaskClarification(
  input: {
    taskId: string;
    topic: string;
    questions: string[];
  },
  options?: ClarificationOptions
): Promise<{
  parentStatus: 'AWAITING_CLARIFICATION';
  childTask: ClarificationSubtask;
  filePath: string;
}>;

export async function resolveTaskClarification(
  input: {
    taskId: string;
    answers: string[];
  },
  options?: ClarificationOptions
): Promise<{
  parentStatus: 'IN_PROGRESS';
  childTask: ClarificationSubtask;
  planFilePath: string;
}>;
```

## 4. Orchestrator Worker & Panic Button Teardown Contract (`src/orchestrator/workers/orchestrator.ts`)

```typescript
export interface CancelTaskExecutionResult {
  taskId: string;
  status: 'CANCELLED';
  reason: string;
  arpCancelSent: boolean;
  sandboxTornDown: boolean;
  llmAborted: boolean;
  sandboxDbDropped: boolean;
  worktreeRestored: boolean;
  lockReleased: boolean;
}

export async function cancelTaskExecution(
  taskId: string,
  reason: string,
  deps: OrchestratorDependencies
): Promise<CancelTaskExecutionResult>;
```
