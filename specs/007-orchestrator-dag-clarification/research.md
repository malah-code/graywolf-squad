# Phase 0 Research: 007-orchestrator-dag-clarification

**Feature Branch**: `007-orchestrator-dag-clarification`  
**Date**: 2026-10-18  
**Status**: Complete (0 unknowns remaining)

## 1. Canonical 16-State Task Lifecycle State Machine (`src/orchestrator/services/state-machine.ts`)

- **Decision**:
  - Encode an explicit, immutable transition adjacency map `LEGAL_TASK_STATE_TRANSITIONS: Record<TaskStatus, readonly TaskStatus[]>` covering all 16 canonical states from `specs/001-multi-agent-platform/data-model.md` §3 and `src/orchestrator/schemas/task.ts`:
    - `BACKLOG`: `['QUEUED', 'BLOCKED', 'CANCELLED']`
    - `QUEUED`: `['IN_PROGRESS', 'BLOCKED', 'UPDATED', 'CANCELLED']`
    - `IN_PROGRESS`: `['INTERNAL_REVIEW', 'BLOCKED', 'AWAITING_CLARIFICATION', 'ESCALATED', 'UPDATED', 'CANCELLED']`
    - `BLOCKED`: `['QUEUED', 'IN_PROGRESS', 'AWAITING_CLARIFICATION', 'UPDATED', 'CANCELLED']`
    - `AWAITING_CLARIFICATION`: `['IN_PROGRESS', 'QUEUED', 'ESCALATED', 'UPDATED', 'CANCELLED']`
    - `INTERNAL_REVIEW`: `['GUARD_VERIFYING', 'IN_PROGRESS', 'INTERNAL_REVIEW_FAILED', 'ESCALATED', 'UPDATED', 'CANCELLED']`
    - `INTERNAL_REVIEW_FAILED`: `['HUMAN_REVIEW_GATE', 'IN_PROGRESS', 'ESCALATED', 'CANCELLED']`
    - `GUARD_VERIFYING`: `['HUMAN_REVIEW_GATE', 'QA_FIXING', 'VERIFICATION_FAILED', 'ESCALATED', 'CANCELLED']`
    - `QA_FIXING`: `['GUARD_VERIFYING', 'INTERNAL_REVIEW', 'VERIFICATION_FAILED', 'ESCALATED', 'UPDATED', 'CANCELLED']`
    - `VERIFICATION_FAILED`: `['HUMAN_REVIEW_GATE', 'QA_FIXING', 'IN_PROGRESS', 'ESCALATED', 'CANCELLED']`
    - `HUMAN_REVIEW_GATE`: `['MERGED', 'REJECTED', 'IN_PROGRESS', 'QUEUED', 'CANCELLED']`
    - `ESCALATED`: `['HUMAN_REVIEW_GATE', 'IN_PROGRESS', 'QUEUED', 'REJECTED', 'CANCELLED']`
    - `UPDATED`: `['QUEUED', 'BACKLOG', 'CANCELLED']`
    - `REJECTED`: `['BACKLOG', 'QUEUED', 'CANCELLED']`
    - `MERGED`: `[]` (Terminal)
    - `CANCELLED`: `['BACKLOG', 'QUEUED']` (Terminal for current execution; may be re-queued only by explicit human reset) or terminal `[]` — we allow `canTransitionTaskState(from, to)` and `assertValidTaskTransition(from, to)` throwing `GraywolfAppError('TASK_INVALID_STATE_TRANSITION')` (HTTP 409) for any disallowed transition (such as `BACKLOG -> MERGED`, `MERGED -> IN_PROGRESS`, `CANCELLED -> IN_PROGRESS`, `IN_PROGRESS -> MERGED`).
- **Rationale**: Centralizes state transition validation so REST routes, BullMQ workers, and ARP handlers enforce the exact same lifecycle invariants.
- **Alternatives Considered**:
  - Ad-hoc status checks inside route handlers (rejected: error-prone and violates single source of truth).

## 2. DAG Topological Scheduler & Pre-Dispatch Scope Overlap Checker (`src/orchestrator/services/dag.ts`)

- **Decision**:
  - **Cycle Detection (`detectDependencyCycle` / `assertNoDependencyCycle`)**: Uses 3-color DFS (`UNVISITED`, `VISITING`, `VISITED`) across the task dependency map. Self-dependencies (`A -> A`) and multi-hop cycles (`A -> B -> C -> A`) throw `GraywolfAppError('TASK_INVALID_STATE_TRANSITION')` (HTTP 409) with the cycle path in `details.cycle`.
  - **Topological Sort (`topologicalSortTasks`)**: Kahn's / DFS post-order sort returning tasks in legal dependency execution order.
  - **Blocker Readiness (`isTaskReady` / `assertTaskReadyForDispatch`)**: Checks all `blockedBy` task IDs. By default, every blocker must have status `'MERGED'`. When `allowBranchStacking: true` (PRD §12.2 DAG Branch Stacking), a blocker in `'HUMAN_REVIEW_GATE'` or `'MERGED'` with a completed worktree branch satisfies readiness. If `assertTaskReadyForDispatch` is called on a task with unmet blockers, it throws `GraywolfAppError('TASK_BLOCKED_BY_DEPENDENCIES')` (HTTP 409).
  - **Pre-Dispatch Writable Scope Overlap (`hasWritableScopeOverlap`, ADR-031)**: Compares a candidate task's `writableScope` (and `targetFiles`) against all active tasks (`IN_PROGRESS`, `INTERNAL_REVIEW`, `GUARD_VERIFYING`, `QA_FIXING`). Uses `picomatch` bidirectional glob matching, static directory prefix intersection (e.g., `src/auth/**` vs `src/**`), and shared root manifest detection (`package.json`, `pnpm-lock.yaml`, `package-lock.json`, `yarn.lock`, `Cargo.toml`, `go.mod`, `pyproject.toml`).
- **Rationale**: Prevents both deadlocks (cycles) and concurrent file write collisions (ADR-031).
- **Alternatives Considered**:
  - String equality on `writableScope` entries only (rejected: fails to catch `src/**` overlapping `src/auth/login.ts`).

## 3. Clarification Question Protocol & Blocking Child Subtasks (`src/orchestrator/services/clarification.ts`)

- **Decision**:
  - Enforce `maxClarificationQuestions = 5` per request and `maxClarificationRounds = 2` per task. Exceeding either limit throws `GraywolfAppError('TASK_CLARIFICATION_LIMIT_REACHED')` (HTTP 400).
  - On `requestTaskClarification`:
    1. Validate limits (`questions.length <= 5`, `round <= 2`, `questions.length >= 1`).
    2. Write `.agents/tasks/<TASK_ID>/clarification-request.md` via `writeTaskArtifact`.
    3. Transition parent task to `AWAITING_CLARIFICATION` (validated via `assertValidTaskTransition`).
    4. Create blocking child subtask `<TASK_ID>.<round>` with title `[CLARIFICATION REQUIRED] <topic>` and add `<TASK_ID>.<round>` to parent's `blockedBy`.
    5. Invoke optional `onCockpitNotify` callback.
  - On `resolveTaskClarification`:
    1. Mark child subtask `<TASK_ID>.<round>` as `MERGED`.
    2. Append a formatted `## Clarification Round <round> Answers` section to `.agents/tasks/<TASK_ID>/plan.md` via `writeTaskArtifact`.
    3. Invoke optional `onArpClarificationResponse` callback to deliver answers to the active container.
    4. Transition parent task from `AWAITING_CLARIFICATION` back to `IN_PROGRESS`.
- **Rationale**: Matches PRD §4.3 and Phase 5 Task 5.3 step-for-step.
- **Alternatives Considered**:
  - Storing clarifications only in memory (rejected: must write `clarification-request.md` and append answers to `plan.md` so container restarts preserve context).

## 4. BullMQ Orchestrator Dispatch Worker & Panic Button Teardown (`src/orchestrator/workers/orchestrator.ts`)

- **Decision**:
  - Implement `OrchestratorDispatchEngine` (plus BullMQ `Worker` factory for `task-dispatch`) that:
    - Evaluates `isTaskReady`, `hasWritableScopeOverlap`, and optional admission control check before acquiring the task lock (`acquireTaskLock`), provisioning the worktree (`createTaskWorktree`) and sandbox DB (`provisionSandboxDatabase`), starting the container (`runnerProvider.startSandbox`), and transitioning the task to `IN_PROGRESS`.
    - Implements `cancelTaskExecution(taskId, reason)` ("Panic Button", PRD §12.1) executing the 7-step deterministic teardown sequence:
      1. Send ARP `task.cancel` frame to active container (if `sendArpCancel` hook registered).
      2. Kill container process group via `runnerProvider.teardownSandbox(taskId)`.
      3. Abort in-flight LiteLLM requests via `abortLiteLlmRequests(taskId)` hook.
      4. Drop ephemeral Tier 1/2 sandbox DB via `teardownSandboxDatabase`.
      5. Restore Git worktree (`git restore . && git clean -fd`) via `restoreWorktree`.
      6. Release atomic directory lock via `lock.release()`.
      7. Transition task status to `CANCELLED` (persisting via `withTenantContext` when DB sync is enabled).
- **Rationale**: Satisfies PRD §12.1 and Phase 5 Task 5.4 with clean dependency injection so unit/integration tests can verify all 7 teardown steps deterministically.
- **Alternatives Considered**:
  - Coupling teardown directly to Docker socket calls without `IRunnerProvider` (rejected: violates ADR-040 Agnostic Runner API).
