# Implementation Plan: 007-orchestrator-dag-clarification

**Branch**: `007-orchestrator-dag-clarification` | **Date**: 2026-10-18 | **Spec**: [specs/007-orchestrator-dag-clarification/spec.md](./spec.md)
**Input**: Feature specification from `/specs/007-orchestrator-dag-clarification/spec.md` and Phase 5 of `docs/implementation-plan-detailed.md`

## Summary

Implement the Phase 5 Canonical Task State Machine, DAG Topological Scheduler & Pre-Dispatch Scope Overlap Checker, Clarification Question Protocol, and BullMQ Orchestrator Worker & Panic Button Teardown:
1. **Canonical Task State Machine (`src/orchestrator/services/state-machine.ts`)**: Encode all legal transitions across the 16 canonical states (`specs/001-multi-agent-platform/data-model.md` §3) and throw `GraywolfAppError('TASK_INVALID_STATE_TRANSITION')` (HTTP 409) on illegal transitions.
2. **DAG Topological Scheduler & Pre-Dispatch Scope Overlap (`src/orchestrator/services/dag.ts`)**: Detect circular dependencies via 3-color DFS (`TASK_INVALID_STATE_TRANSITION` 409), compute topological sort order, verify `isTaskReady(task)` (`blockedBy` tasks `MERGED` or DAG Branch Stacking parent ready), and check `hasWritableScopeOverlap(candidateTask, activeTasks)` using `picomatch` + shared package manifest detection (ADR-031).
3. **Clarification Question Protocol & Blocking Child Subtasks (`src/orchestrator/services/clarification.ts`)**: Enforce `maxClarificationQuestions: 5` per round and `maxClarificationRounds: 2` (`TASK_CLARIFICATION_LIMIT_REACHED` 400); on request write `clarification-request.md`, transition parent to `AWAITING_CLARIFICATION`, create child task `<TASK_ID>.<round>: [CLARIFICATION REQUIRED] <topic>`, and emit Cockpit notification; on resolution mark child `MERGED`, append answers to `plan.md`, send ARP `clarification.response`, and return parent to `IN_PROGRESS`.
4. **BullMQ Orchestrator Worker & Panic Button Teardown (`src/orchestrator/workers/orchestrator.ts`)**: Coordinate pre-flight dispatch checks (admission capacity + DAG readiness + scope non-overlap) before calling `IRunnerProvider.startSandbox`, and implement `cancelTaskExecution(taskId, reason)` ("Panic Button") executing the 7-step teardown sequence (`ARP task.cancel` ➔ `teardownSandbox` ➔ abort LiteLLM ➔ `teardownSandboxDatabase` ➔ `restoreWorktree` ➔ release lock ➔ `CANCELLED`).

## Technical Context

**Language/Version**: TypeScript 5.8+ on Node.js 20+ (`commonjs`)  
**Primary Dependencies**: `bullmq` (`^5.41.6`), `picomatch` (`^4.0.2`), `@sinclair/typebox` (`^0.34.47`), `pg` (`^8.23.0`)  
**Storage**: PostgreSQL 16 (`tasks`, `task_dependencies`, `task_artifacts`, `task_locks` via `withTenantContext`) + `.agents/tasks/<TASK_ID>/` (`clarification-request.md`, `plan.md`)  
**Testing**: Vitest (`tests/unit/state-machine.test.ts`, `tests/unit/dag.test.ts`, `tests/unit/clarification.test.ts`, `tests/integration/orchestrator-cancel.test.ts`)  
**Target Platform**: Linux / Dockerized Host Orchestrator  
**Project Type**: Multi-Agent Orchestrator Backend Service  
**Performance Goals**: Sub-millisecond in-memory DAG cycle/overlap evaluation; deterministic 7-step Panic Button teardown  
**Constraints**: Strict adherence to ADR-042 error codes (`TASK_INVALID_STATE_TRANSITION`, `TASK_BLOCKED_BY_DEPENDENCIES`, `TASK_CLARIFICATION_LIMIT_REACHED`), ADR-031 pre-dispatch scope serialization, and ADR-040 `IRunnerProvider` decoupling  
**Scale/Scope**: Phase 5 of `docs/implementation-plan-detailed.md` (Tasks 5.1–5.4)

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **Principle 1 (Human Sovereignty & Non-Committing Relay Contract)**: ✅ PASS — Enforces `HUMAN_REVIEW_GATE` transitions and gives the human instant Panic Button (`cancelTaskExecution`) authority that restores the Git worktree (`restoreWorktree`) without committing.
- **Principle 2 & 9 (Zero Runtime Lock-In & Permissive Open Source)**: ✅ PASS — Uses `bullmq` (MIT) and `picomatch` (MIT).
- **Principle 6 (Virtual Developer Tier Handoff Protocol)**: ✅ PASS — State machine enforces `IN_PROGRESS` ➔ `INTERNAL_REVIEW` ➔ `GUARD_VERIFYING` ➔ `HUMAN_REVIEW_GATE` and two-strike `INTERNAL_REVIEW_FAILED` escalation.
- **Principle 8 (Blast-Radius and Dependency Integrity)**: ✅ PASS — Directly implements `blockedBy` topological sorting, cycle detection, and pre-dispatch `writableScope` overlap prevention.

## Project Structure

### Documentation (this feature)

```text
specs/007-orchestrator-dag-clarification/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output (/speckit-plan command)
├── data-model.md        # Phase 1 output (/speckit-plan command)
├── quickstart.md        # Phase 1 output (/speckit-plan command)
├── contracts/
│   └── state-dag-clarification.md
└── tasks.md             # Phase 2 output (/speckit-tasks command)
```

### Source Code (repository root)

```text
src/orchestrator/
├── services/
│   ├── state-machine.ts       # Task 5.1: Canonical 16-state task lifecycle state machine
│   ├── dag.ts                 # Task 5.2: DAG topological scheduler & writableScope overlap checker
│   └── clarification.ts       # Task 5.3: Clarification question protocol & blocking child subtasks
└── workers/
    └── orchestrator.ts        # Task 5.4: BullMQ orchestrator worker & Panic Button teardown

tests/
├── unit/
│   ├── state-machine.test.ts  # Task 5.1 verification
│   ├── dag.test.ts            # Task 5.2 verification
│   └── clarification.test.ts  # Task 5.3 verification
└── integration/
    └── orchestrator-cancel.test.ts # Task 5.4 verification
```

**Structure Decision**: Matches the exact file paths and module boundaries specified in `docs/implementation-plan-detailed.md` Phase 5 (Tasks 5.1–5.4).

## Complexity Tracking

No constitution violations or complexity exemptions required.
