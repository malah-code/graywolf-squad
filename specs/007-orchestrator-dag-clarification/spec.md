# Feature Specification: 007-orchestrator-dag-clarification

**Feature Branch**: `007-orchestrator-dag-clarification`  
**Created**: 2026-10-18  
**Status**: Draft  
**Target Phase**: Phase 5 — Orchestrator State Machine, BullMQ DAG Engine & Clarification Protocol (`docs/implementation-plan-detailed.md`)  
**Input**: Master Phased Implementation Plan §Phase 5 (`specs/007-orchestrator-dag-clarification/`); `specs/001-multi-agent-platform/data-model.md` §3; `docs/PRD.md` §4.3, §12.1–§12.2; ADR-031, ADR-042

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Canonical 16-State Task Lifecycle State Machine (Priority: P1)

Every engineering task in Graywolf Squad progresses through a strictly validated 16-state lifecycle (`BACKLOG`, `QUEUED`, `IN_PROGRESS`, `BLOCKED`, `AWAITING_CLARIFICATION`, `INTERNAL_REVIEW`, `INTERNAL_REVIEW_FAILED`, `GUARD_VERIFYING`, `QA_FIXING`, `VERIFICATION_FAILED`, `HUMAN_REVIEW_GATE`, `MERGED`, `REJECTED`, `ESCALATED`, `UPDATED`, `CANCELLED`). The State Machine (`src/orchestrator/services/state-machine.ts`) enforces legal state transitions per `specs/001-multi-agent-platform/data-model.md` §3 and throws `GraywolfAppError('TASK_INVALID_STATE_TRANSITION')` (HTTP 409) whenever an illegal transition is attempted (for example, jumping directly from `BACKLOG` to `MERGED` or transitioning out of a terminal `MERGED`/`CANCELLED` state).

**Why this priority**: Guarantees that no task bypasses internal review, external verification guards, or required human gates (Constitution Principles 1 & 6).

**Independent Test**: Run `tests/unit/state-machine.test.ts` verifying every legal transition path (standard happy path, clarification pause/resume, two-strike internal review failure, QA fixing loop, boundary escalation, major pivot `UPDATED` -> `QUEUED`, and Panic Button `CANCELLED`) and asserting `TASK_INVALID_STATE_TRANSITION` (409) on illegal transitions.

**Acceptance Scenarios**:

1. **Given** a task in `BACKLOG`, **When** `assertValidTaskTransition('BACKLOG', 'QUEUED')` and `assertValidTaskTransition('QUEUED', 'IN_PROGRESS')` are called, **Then** both succeed without error.
2. **Given** a task in `INTERNAL_REVIEW`, **When** the in-container reviewer approves, **Then** it transitions to `GUARD_VERIFYING`; **When** rejected twice (`INTERNAL_REVIEW_FAILED`), **Then** it transitions to `HUMAN_REVIEW_GATE`.
3. **Given** a task in `BACKLOG` or `MERGED`, **When** an illegal transition such as `BACKLOG -> MERGED` or `MERGED -> IN_PROGRESS` is attempted, **Then** `GraywolfAppError('TASK_INVALID_STATE_TRANSITION')` (HTTP 409) is thrown.

---

### User Story 2 - DAG Topological Scheduler, Cycle Detection & Pre-Dispatch Scope Overlap Checker (ADR-031) (Priority: P1)

Before any task is dispatched to a container, the DAG Scheduler (`src/orchestrator/services/dag.ts`) validates dependency integrity:
1. **Cycle Detection**: On task creation or `blockedBy` update, detects circular dependencies (e.g. `TASK-A -> TASK-B -> TASK-A`) using depth-first topological graph traversal and throws `GraywolfAppError('TASK_INVALID_STATE_TRANSITION')` (409).
2. **Blocker Readiness (`isTaskReady`)**: Verifies that every task ID listed in `blockedBy` is in `MERGED` status (or, when DAG Branch Stacking is enabled, has completed `HUMAN_REVIEW_GATE`/`MERGED` with an available parent worktree branch); throws `TASK_BLOCKED_BY_DEPENDENCIES` (409) when forced dispatch is attempted with unresolved blockers.
3. **Pre-Dispatch Writable Scope Overlap (`hasWritableScopeOverlap`, ADR-031)**: Uses `picomatch` to compare a candidate task's `writableScope` globs (and shared root package manifests such as `package.json`, `pnpm-lock.yaml`, `Cargo.toml`, `go.mod`) against all currently executing tasks (`IN_PROGRESS`, `INTERNAL_REVIEW`, `GUARD_VERIFYING`, `QA_FIXING`) so two tasks that can mutate the same files never execute concurrently.

**Why this priority**: Enforces Constitution Principle 8 (Blast-Radius and Dependency Integrity) and prevents merge conflicts or race conditions across parallel agent containers.

**Independent Test**: Run `tests/unit/dag.test.ts` testing cycle detection (2-node and 3-node cycles), topological sorting, `isTaskReady` gating on `blockedBy` statuses (standard vs DAG branch stacking), and `hasWritableScopeOverlap` glob intersection and shared manifest serialization.

**Acceptance Scenarios**:

1. **Given** a task graph where `TASK-1` depends on `TASK-2` and `TASK-2` is updated to depend on `TASK-1`, **When** `detectDependencyCycle` runs, **Then** it detects the cycle and throws `TASK_INVALID_STATE_TRANSITION` (409).
2. **Given** `TASK-2` has `blockedBy: ['TASK-1']`, **When** `TASK-1` is `IN_PROGRESS`, **Then** `isTaskReady` returns `false`; **When** `TASK-1` reaches `MERGED`, **Then** `isTaskReady` returns `true`.
3. **Given** an active task `TASK-1` with `writableScope: ['src/auth/**']`, **When** candidate `TASK-2` has `writableScope: ['src/auth/login.ts']` or both touch `package.json`, **Then** `hasWritableScopeOverlap` returns `true` (`overlappingTaskIds: ['TASK-1']`).

---

### User Story 3 - Clarification Question Protocol & Blocking Child Subtasks (PRD §4.3) (Priority: P1)

When an in-container agent encounters an architectural or requirement ambiguity during `IN_PROGRESS`, the Clarification Service (`src/orchestrator/services/clarification.ts`) enforces:
1. **Guard Limits**: Maximum `5` clarification questions per round (`maxClarificationQuestions: 5`) and maximum `2` clarification rounds per task (`maxClarificationRounds: 2`). Exceeding either limit throws `GraywolfAppError('TASK_CLARIFICATION_LIMIT_REACHED')` (HTTP 400).
2. **Clarification Request Handling (`requestTaskClarification`)**: Writes `.agents/tasks/<TASK_ID>/clarification-request.md`, transitions the parent task to `AWAITING_CLARIFICATION`, spawns a blocking child subtask `<TASK_ID>.<round>` titled `[CLARIFICATION REQUIRED] <topic>` assigned to the human, and emits a Cockpit notification event.
3. **Clarification Resolution (`resolveTaskClarification`)**: Marks the child subtask `MERGED`, appends the human's answers to `.agents/tasks/<TASK_ID>/plan.md`, dispatches an ARP `clarification.response` payload callback to the active container, and transitions the parent task back to `IN_PROGRESS`.

**Why this priority**: Prevents agents from guessing on ambiguous requirements while bounding clarification loops so tasks never stall indefinitely.

**Independent Test**: Run `tests/unit/clarification.test.ts` testing valid clarification request creation (`clarification-request.md` written, parent `AWAITING_CLARIFICATION`, child `<TASK_ID>.1` created), resolution (`plan.md` appended, child `MERGED`, parent `IN_PROGRESS`), and `TASK_CLARIFICATION_LIMIT_REACHED` (400) when >5 questions or >2 rounds are requested.

**Acceptance Scenarios**:

1. **Given** an `IN_PROGRESS` task `TASK-501`, **When** `requestTaskClarification` is called with 2 questions on round 1, **Then** `clarification-request.md` is written, `TASK-501` transitions to `AWAITING_CLARIFICATION`, and child task `TASK-501.1` is created.
2. **Given** `TASK-501` in `AWAITING_CLARIFICATION`, **When** `resolveTaskClarification` is called with human answers, **Then** the answers are appended to `plan.md`, child `TASK-501.1` transitions to `MERGED`, ARP `clarification.response` is emitted, and `TASK-501` returns to `IN_PROGRESS`.
3. **Given** a clarification request with 6 questions or a 3rd round on the same task, **When** `requestTaskClarification` is called, **Then** it throws `GraywolfAppError('TASK_CLARIFICATION_LIMIT_REACHED')` (HTTP 400).

---

### User Story 4 - BullMQ Orchestrator Dispatch Worker & Panic Button Teardown (PRD §12.1) (Priority: P1)

The Orchestrator Worker (`src/orchestrator/workers/orchestrator.ts`) coordinates task execution on the `task-dispatch` queue and implements the emergency **Panic Button** (`cancelTaskExecution(taskId, reason)`):
1. **Pre-Flight Dispatch Check (`dispatchTaskIfReady`)**: Verifies DAG readiness (`isTaskReady`), writable scope non-overlap (`hasWritableScopeOverlap`), and admission capacity before acquiring the task lock, provisioning the worktree + sandbox DB, transitioning the task to `IN_PROGRESS`, and calling `IRunnerProvider.startSandbox`.
2. **Panic Button (`cancelTaskExecution`)**: Immediately sends ARP `task.cancel` to the container (if connected), kills the container process group via `IRunnerProvider.teardownSandbox`, aborts in-flight LiteLLM requests for the task, drops any ephemeral Tier 1/Tier 2 sandbox database via `teardownSandboxDatabase`, resets the Git worktree via `restoreWorktree` (`git restore . && git clean -fd`), releases the task lock, and transitions the task to `CANCELLED`.

**Why this priority**: Gives human operators deterministic, sub-second emergency stop authority over any runaway agent container with full resource cleanup (Constitution Principle 1).

**Independent Test**: Run `tests/integration/orchestrator-cancel.test.ts` testing pre-flight dispatch gating and verifying that `cancelTaskExecution` executes all teardown steps (ARP cancel notification, `teardownSandbox`, LiteLLM abort hook, sandbox DB teardown, `restoreWorktree`, lock release, and `CANCELLED` state transition).

**Acceptance Scenarios**:

1. **Given** a `QUEUED` task whose dependencies are `MERGED` and whose `writableScope` does not overlap active tasks, **When** `dispatchTaskIfReady` runs, **Then** it acquires the lock, starts the sandbox via `IRunnerProvider.startSandbox`, and transitions the task to `IN_PROGRESS`.
2. **Given** an `IN_PROGRESS` task with an active lock, worktree, and sandbox DB, **When** `cancelTaskExecution(taskId, 'User clicked Panic Button')` runs, **Then** ARP `task.cancel` is sent, `teardownSandbox` is called, LiteLLM requests are aborted, sandbox DB is torn down, `restoreWorktree` cleans the worktree, the lock is released, and the task state becomes `CANCELLED`.

---

### Edge Cases

- **Glob Overlap Between Prefix & Wildcard Patterns**: In `hasWritableScopeOverlap`, two globs like `src/auth/**` and `src/**` (neither is a literal file path) must be detected as overlapping by checking both synthetic sample paths/prefix intersections and `picomatch` matching in both directions.
- **Self-Dependency Cycle**: If a task lists its own ID in `blockedBy` (`TASK-1 -> TASK-1`), `detectDependencyCycle` immediately flags a 1-node cycle and throws `TASK_INVALID_STATE_TRANSITION` (409).
- **Idempotent Panic Button on Queued/Blocked Tasks**: If `cancelTaskExecution` is invoked on a task that is `QUEUED` or `AWAITING_CLARIFICATION` (no running container yet), it still safely releases any held lock/DB resources and transitions the task to `CANCELLED` without failing.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST implement the canonical 16-state Task Lifecycle State Machine in `src/orchestrator/services/state-machine.ts` encoding all legal transitions from `specs/001-multi-agent-platform/data-model.md` §3 and throwing `GraywolfAppError('TASK_INVALID_STATE_TRANSITION')` (HTTP 409) on illegal transitions.
- **FR-002**: System MUST implement the DAG Topological Scheduler in `src/orchestrator/services/dag.ts` providing `detectDependencyCycle`, `topologicalSortTasks`, `isTaskReady` (supporting standard `MERGED` blockers and DAG Branch Stacking), and `hasWritableScopeOverlap` (using `picomatch` + shared package manifest detection per ADR-031).
- **FR-003**: System MUST implement the Clarification Question Protocol in `src/orchestrator/services/clarification.ts` enforcing `maxClarificationQuestions: 5` per round and `maxClarificationRounds: 2` (`TASK_CLARIFICATION_LIMIT_REACHED` 400), writing `clarification-request.md`, creating child subtask `<TASK_ID>.<round>: [CLARIFICATION REQUIRED] <topic>`, transitioning parent to `AWAITING_CLARIFICATION`, and on resolution marking child `MERGED`, appending answers to `plan.md`, emitting ARP `clarification.response`, and returning parent to `IN_PROGRESS`.
- **FR-004**: System MUST implement the Orchestrator Dispatch Worker and Panic Button Teardown (`cancelTaskExecution`) in `src/orchestrator/workers/orchestrator.ts` coordinating DAG/scope-overlap/admission checks before `IRunnerProvider.startSandbox` and executing full 7-step teardown on cancel (`ARP task.cancel` ➔ `teardownSandbox` ➔ abort LiteLLM ➔ `teardownSandboxDatabase` ➔ `restoreWorktree` ➔ release lock ➔ transition to `CANCELLED`).

### Key Entities

- **TaskStateTransition**: Legal state transition map `Record<TaskStatus, readonly TaskStatus[]>` in `src/orchestrator/services/state-machine.ts`.
- **DagTaskNode**: `{ id: string; status: TaskStatus; blockedBy: string[]; writableScope: string[]; targetFiles?: string[] }` evaluated by `src/orchestrator/services/dag.ts`.
- **ClarificationRoundRecord**: `{ parentTaskId: string; childTaskId: string; round: number; topic: string; questions: string[]; answers?: string[]; status: 'OPEN' | 'RESOLVED' }` managed by `src/orchestrator/services/clarification.ts`.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: All valid and invalid transitions across the 16 canonical task states are verified in `tests/unit/state-machine.test.ts`, with invalid transitions throwing `TASK_INVALID_STATE_TRANSITION` (409).
- **SC-002**: Circular dependency graphs throw `TASK_INVALID_STATE_TRANSITION` (409), tasks with unmerged `blockedBy` wait in queue, and tasks with overlapping `writableScope` globs or shared package manifests are detected in `tests/unit/dag.test.ts`.
- **SC-003**: Clarification requests write `clarification-request.md`, spawn blocking child subtask `<TASK_ID>.<round>`, enforce the 5-question / 2-round limits (`TASK_CLARIFICATION_LIMIT_REACHED`), and resume the parent task on resolution with answers appended to `plan.md` in `tests/unit/clarification.test.ts`.
- **SC-004**: `cancelTaskExecution` ("Panic Button") executes all teardown steps (ARP cancel, container kill, LiteLLM abort, sandbox DB drop, worktree restore, lock release, and `CANCELLED` state transition) in `tests/integration/orchestrator-cancel.test.ts`.
- **SC-005**: `pnpm typecheck`, `pnpm lint`, `pnpm build`, and `pnpm test` pass with 0 errors and 0 warnings.

## Assumptions

- `bullmq` (`^5.41.6`) and `picomatch` (`^4.0.2`) are already installed in `package.json`.
- Phase 4 modules (`task-store.ts`, `worktree.ts`, `lock.ts`, `sandbox-db.ts`) are available and integrated directly by `clarification.ts` and `orchestrator.ts`.
