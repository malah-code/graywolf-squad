---

description: "Task list for Phase 5 — Orchestrator State Machine, BullMQ DAG Engine & Clarification Protocol"
---

# Tasks: 007-orchestrator-dag-clarification

**Input**: Design documents from `/specs/007-orchestrator-dag-clarification/`

**Prerequisites**: `plan.md`, `spec.md`, `research.md`, `data-model.md`, `contracts/state-dag-clarification.md`, `quickstart.md`

**Tests**: Included per `spec.md` (`SC-001`–`SC-005`) and `docs/implementation-plan-detailed.md` Phase 5 verification requirements (`tests/unit/state-machine.test.ts`, `tests/unit/dag.test.ts`, `tests/unit/clarification.test.ts`, `tests/integration/orchestrator-cancel.test.ts`).

**Organization**: Tasks are grouped by user story (`US1`–`US4`) to enable independent implementation and verification of each capability.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: Which user story this task belongs to (`[US1]`, `[US2]`, `[US3]`, `[US4]`)
- Include exact file paths in descriptions

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Ensure `src/orchestrator/services/` and `src/orchestrator/workers/` directories are ready for Phase 5 modules.

- [x] T001 Ensure `src/orchestrator/services/` and `src/orchestrator/workers/` directories exist for Phase 5 modules

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Canonical 16-state transition map and validation helpers required by all downstream Phase 5 services (`dag.ts`, `clarification.ts`, `orchestrator.ts`).

**⚠️ CRITICAL**: Complete before starting User Story 3 and User Story 4.

- [x] T002 [US1] Implement `LEGAL_TASK_STATE_TRANSITIONS`, `canTransitionTaskState`, `assertValidTaskTransition` (throwing `TASK_INVALID_STATE_TRANSITION` 409), and `getAllowedNextStates` in `src/orchestrator/services/state-machine.ts`

**Checkpoint**: Canonical State Machine foundation ready.

---

## Phase 3: User Story 1 - Canonical 16-State Task Lifecycle State Machine (Priority: P1) 🎯 MVP

**Goal**: Encode every legal state transition from `specs/001-multi-agent-platform/data-model.md` §3 across all 16 canonical states (`BACKLOG`, `QUEUED`, `IN_PROGRESS`, `BLOCKED`, `AWAITING_CLARIFICATION`, `INTERNAL_REVIEW`, `INTERNAL_REVIEW_FAILED`, `GUARD_VERIFYING`, `QA_FIXING`, `VERIFICATION_FAILED`, `HUMAN_REVIEW_GATE`, `MERGED`, `REJECTED`, `ESCALATED`, `UPDATED`, `CANCELLED`) and reject illegal transitions with `TASK_INVALID_STATE_TRANSITION` (HTTP 409).

**Independent Test**: Run `pnpm test tests/unit/state-machine.test.ts` verifying every legal transition path and asserting `TASK_INVALID_STATE_TRANSITION` (409) on illegal transitions.

### Implementation for User Story 1

- [x] T003 [US1] Create unit test suite in `tests/unit/state-machine.test.ts` testing all valid transitions (happy path, clarification pause/resume, 2-strike internal review failure, QA fixing loop, escalation, major pivot `UPDATED -> QUEUED`, Panic Button `CANCELLED`) and illegal transitions (`TASK_INVALID_STATE_TRANSITION` 409)

**Checkpoint**: User Story 1 is complete and independently verified by `tests/unit/state-machine.test.ts`.

---

## Phase 4: User Story 2 - DAG Topological Scheduler, Cycle Detection & Pre-Dispatch Scope Overlap Checker (ADR-031) (Priority: P1)

**Goal**: Detect circular dependencies (`TASK_INVALID_STATE_TRANSITION` 409), topologically sort tasks, check `isTaskReady(task)` (`blockedBy` tasks `MERGED` or DAG Branch Stacking parent ready), and check `hasWritableScopeOverlap(candidateTask, activeTasks)` using `picomatch` and shared package manifest detection (`package.json`, `pnpm-lock.yaml`, `Cargo.toml`, `go.mod`, etc.).

**Independent Test**: Run `pnpm test tests/unit/dag.test.ts` verifying cycle detection, topological sort, `isTaskReady` gating (standard vs branch stacking), and `hasWritableScopeOverlap` glob/manifest overlap serialization.

### Implementation for User Story 2

- [x] T004 [P] [US2] Implement `detectDependencyCycle`, `assertNoDependencyCycle`, `topologicalSortTasks`, `isTaskReady`, and `assertTaskReadyForDispatch` (throwing `TASK_BLOCKED_BY_DEPENDENCIES` 409) in `src/orchestrator/services/dag.ts`
- [x] T005 [US2] Implement `hasWritableScopeOverlap(candidateTask, activeTasks)` using `picomatch`, prefix intersection, and shared package manifest detection (ADR-031) in `src/orchestrator/services/dag.ts`
- [x] T006 [US2] Create unit test suite in `tests/unit/dag.test.ts` covering self-cycles, multi-node cycles, topological sort, `blockedBy` readiness gating, DAG branch stacking readiness, and `writableScope` / manifest overlap detection

**Checkpoint**: User Story 2 is complete and independently verified by `tests/unit/dag.test.ts`.

---

## Phase 5: User Story 3 - Clarification Question Protocol & Blocking Child Subtasks (PRD §4.3) (Priority: P1)

**Goal**: Enforce `maxClarificationQuestions: 5` per round and `maxClarificationRounds: 2` (`TASK_CLARIFICATION_LIMIT_REACHED` 400); on `requestTaskClarification` write `clarification-request.md`, transition parent to `AWAITING_CLARIFICATION`, create child task `<TASK_ID>.<round>: [CLARIFICATION REQUIRED] <topic>`, and emit Cockpit notification; on `resolveTaskClarification` mark child `MERGED`, append answers to `plan.md`, send ARP `clarification.response`, and return parent to `IN_PROGRESS`.

**Independent Test**: Run `pnpm test tests/unit/clarification.test.ts` testing clarification request creation, child subtask blocking, answer resolution appending to `plan.md`, ARP response callback, and 5-question / 2-round limit enforcement (`TASK_CLARIFICATION_LIMIT_REACHED` 400).

### Implementation for User Story 3

- [x] T007 [P] [US3] Implement `requestTaskClarification` and `resolveTaskClarification` (integrating `writeTaskArtifact`, `readTaskArtifact`, `assertValidTaskTransition`, and DB/in-memory state sync) in `src/orchestrator/services/clarification.ts`
- [x] T008 [US3] Create unit test suite in `tests/unit/clarification.test.ts` verifying `clarification-request.md` generation, child subtask `<TASK_ID>.1` creation, `plan.md` answer appending, ARP `clarification.response` delivery, and `TASK_CLARIFICATION_LIMIT_REACHED` (400) when >5 questions or >2 rounds are requested

**Checkpoint**: User Story 3 is complete and independently verified by `tests/unit/clarification.test.ts`.

---

## Phase 6: User Story 4 - BullMQ Orchestrator Dispatch Worker & Panic Button Teardown (PRD §12.1) (Priority: P1)

**Goal**: Implement the BullMQ `task-dispatch` worker and `dispatchTaskIfReady` (checking Admission Control capacity + DAG readiness + Scope Overlap before acquiring lock, provisioning worktree/sandbox DB, and calling `IRunnerProvider.startSandbox`) alongside `cancelTaskExecution(taskId, reason)` ("Panic Button") executing the 7-step teardown (`ARP task.cancel` ➔ `teardownSandbox` ➔ abort LiteLLM ➔ `teardownSandboxDatabase` ➔ `restoreWorktree` ➔ release lock ➔ `CANCELLED`).

**Independent Test**: Run `pnpm test tests/integration/orchestrator-cancel.test.ts` verifying pre-flight dispatch gating and full 7-step Panic Button teardown on an active task worktree, lock, container, and sandbox DB.

### Implementation for User Story 4

- [x] T009 [US4] Implement `dispatchTaskIfReady`, `createOrchestratorDispatchWorker` (BullMQ `task-dispatch` worker), and `cancelTaskExecution(taskId, reason)` ("Panic Button" 7-step teardown) in `src/orchestrator/workers/orchestrator.ts`
- [x] T010 [US4] Wire `src/orchestrator/routes/tasks.ts` lifecycle endpoints (`dispatch`, `clarification`, `cancel`) to share state machine validation and clarification/cancel helpers where applicable
- [x] T011 [US4] Create integration test suite in `tests/integration/orchestrator-cancel.test.ts` testing pre-flight dispatch gating (`isTaskReady`, `hasWritableScopeOverlap`, admission check) and full 7-step Panic Button teardown (`cancelTaskExecution`) with real temporary Git worktree and task lock

**Checkpoint**: User Story 4 is complete and independently verified by `tests/integration/orchestrator-cancel.test.ts`.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Full verification of TypeScript build, ESLint rules, Vitest suite, and master implementation plan tracking.

- [x] T012 Run `pnpm typecheck`, `pnpm lint`, `pnpm build`, and `pnpm test` across all suites and mark Tasks 5.1–5.4 complete in `docs/implementation-plan-detailed.md`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1: T001)**: No dependencies — starts immediately.
- **Foundational & US1 (Phases 2–3: T002–T003)**: Depends on T001.
- **User Story 2 (Phase 4: T004–T006)**: Can run in parallel with T002/T003.
- **User Story 3 (Phase 5: T007–T008)**: Depends on T002 (`state-machine.ts`).
- **User Story 4 (Phase 6: T009–T011)**: Depends on T002 (`state-machine.ts`) and T004–T005 (`dag.ts`).
- **Polish (Phase 7: T012)**: Depends on all User Stories (`T001`–`T011`) completing.

### Parallel Opportunities

- `T002` (`src/orchestrator/services/state-machine.ts`), `T004` (`src/orchestrator/services/dag.ts`), and `T007` (`src/orchestrator/services/clarification.ts`) reside in separate module files and can be built concurrently.
- Unit test suites `tests/unit/state-machine.test.ts` (`T003`), `tests/unit/dag.test.ts` (`T006`), `tests/unit/clarification.test.ts` (`T008`), and `tests/integration/orchestrator-cancel.test.ts` (`T011`) are isolated and run in parallel.

---

## Parallel Example: Phase 5 Services

```bash
# Implement disjoint Phase 5 service modules in parallel:
Task T002: "Implement Canonical Task State Machine in src/orchestrator/services/state-machine.ts"
Task T004: "Implement DAG Topological Scheduler & Scope Overlap in src/orchestrator/services/dag.ts"
Task T007: "Implement Clarification Question Protocol in src/orchestrator/services/clarification.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1)

1. Complete Phase 1 (`T001`) and Phases 2–3 (`T002`–`T003`).
2. Validate the 16-state lifecycle transitions via `pnpm test tests/unit/state-machine.test.ts`.

### Incremental Delivery

1. Add DAG Topological Scheduler & Scope Overlap Checker (`T004`–`T006`) → Verify with `tests/unit/dag.test.ts`.
2. Add Clarification Question Protocol (`T007`–`T008`) → Verify with `tests/unit/clarification.test.ts`.
3. Add BullMQ Orchestrator Worker & Panic Button Teardown (`T009`–`T011`) → Verify with `tests/integration/orchestrator-cancel.test.ts`.
4. Run full verification (`T012`).
