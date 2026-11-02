# Data Model: 007-orchestrator-dag-clarification

**Feature Branch**: `007-orchestrator-dag-clarification`  
**Date**: 2026-10-18

## 1. Canonical Task State Machine (`src/orchestrator/services/state-machine.ts`)

### 1.1 `LEGAL_TASK_STATE_TRANSITIONS` (`Record<TaskStatus, readonly TaskStatus[]>`)
| From State | Legal Target States |
|---|---|
| `BACKLOG` | `QUEUED`, `BLOCKED`, `CANCELLED` |
| `QUEUED` | `IN_PROGRESS`, `BLOCKED`, `UPDATED`, `CANCELLED` |
| `IN_PROGRESS` | `INTERNAL_REVIEW`, `BLOCKED`, `AWAITING_CLARIFICATION`, `ESCALATED`, `UPDATED`, `CANCELLED` |
| `BLOCKED` | `QUEUED`, `IN_PROGRESS`, `AWAITING_CLARIFICATION`, `UPDATED`, `CANCELLED` |
| `AWAITING_CLARIFICATION` | `IN_PROGRESS`, `QUEUED`, `ESCALATED`, `UPDATED`, `CANCELLED` |
| `INTERNAL_REVIEW` | `GUARD_VERIFYING`, `IN_PROGRESS`, `INTERNAL_REVIEW_FAILED`, `ESCALATED`, `UPDATED`, `CANCELLED` |
| `INTERNAL_REVIEW_FAILED` | `HUMAN_REVIEW_GATE`, `IN_PROGRESS`, `ESCALATED`, `CANCELLED` |
| `GUARD_VERIFYING` | `HUMAN_REVIEW_GATE`, `QA_FIXING`, `VERIFICATION_FAILED`, `ESCALATED`, `CANCELLED` |
| `QA_FIXING` | `GUARD_VERIFYING`, `INTERNAL_REVIEW`, `VERIFICATION_FAILED`, `ESCALATED`, `UPDATED`, `CANCELLED` |
| `VERIFICATION_FAILED` | `HUMAN_REVIEW_GATE`, `QA_FIXING`, `IN_PROGRESS`, `ESCALATED`, `CANCELLED` |
| `HUMAN_REVIEW_GATE` | `MERGED`, `REJECTED`, `IN_PROGRESS`, `QUEUED`, `CANCELLED` |
| `ESCALATED` | `HUMAN_REVIEW_GATE`, `IN_PROGRESS`, `QUEUED`, `REJECTED`, `CANCELLED` |
| `UPDATED` | `QUEUED`, `BACKLOG`, `CANCELLED` |
| `REJECTED` | `BACKLOG`, `QUEUED`, `CANCELLED` |
| `MERGED` | *(none — terminal)* |
| `CANCELLED` | *(none — terminal for active run; only explicit `resetCancelledTask` or `BACKLOG` if allowed)* |

## 2. DAG Node & Scope Overlap Entities (`src/orchestrator/services/dag.ts`)

### 2.1 `DagTaskNode`
| Field | Type | Description |
|---|---|---|
| `id` | `string` | Task ID (`TASK-101`) |
| `status` | `TaskStatus` | Current lifecycle status |
| `blockedBy` | `string[]` | Array of upstream blocker task IDs |
| `writableScope` | `string[]` | Glob patterns permitted for writing |
| `targetFiles` | `string[] \| undefined` | Optional explicit target file paths |

### 2.2 `ScopeOverlapResult`
| Field | Type | Description |
|---|---|---|
| `overlaps` | `boolean` | `true` if candidate task overlaps any active task |
| `overlappingTaskIds` | `string[]` | IDs of active tasks with overlapping scope or shared package manifests |
| `reasons` | `string[]` | Human-readable overlap diagnostic strings |

## 3. Clarification Entities (`src/orchestrator/services/clarification.ts`)

### 3.1 `ClarificationSubtask`
| Field | Type | Description |
|---|---|---|
| `id` | `string` | `<parentTaskId>.<round>` (e.g., `TASK-501.1`) |
| `parentTaskId` | `string` | Parent task ID (`TASK-501`) |
| `round` | `number` | Clarification round (`1` or `2`) |
| `title` | `string` | `[CLARIFICATION REQUIRED] <topic>` |
| `topic` | `string` | Short topic summary |
| `questions` | `string[]` | 1–5 clarification questions |
| `answers` | `string[] \| undefined` | Human-supplied answers |
| `status` | `TaskStatus` | `'QUEUED'` while open, `'MERGED'` when resolved |

## 4. Orchestrator Execution Context (`src/orchestrator/workers/orchestrator.ts`)

### 4.1 `ActiveTaskExecution`
| Field | Type | Description |
|---|---|---|
| `taskId` | `string` | Executing task ID |
| `workspaceId` | `string \| undefined` | Tenant workspace ID |
| `orgId` | `string \| undefined` | Tenant organization ID |
| `containerId` | `string \| null` | Sandbox container ID from `IRunnerProvider.startSandbox` |
| `worktreePath` | `string \| undefined` | Provisioned Git worktree path |
| `dbTier` | `SandboxDbTier` | Provisioned sandbox DB tier |
| `lock` | `AcquiredTaskLock \| undefined` | Held `proper-lockfile` handle |
