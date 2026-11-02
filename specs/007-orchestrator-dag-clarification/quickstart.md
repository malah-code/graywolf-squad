# Quickstart & Validation Guide: 007-orchestrator-dag-clarification

**Feature Branch**: `007-orchestrator-dag-clarification`  
**Date**: 2026-10-18

## Prerequisites

- Node.js 20+ and `pnpm`
- Git CLI installed and available on `PATH`

## Validation Commands

1. **Canonical Task State Machine Unit Tests**:
   ```bash
   pnpm test tests/unit/state-machine.test.ts
   ```
   - Verifies all legal transitions across the 16 canonical states (`data-model.md` §3) and asserts `TASK_INVALID_STATE_TRANSITION` (HTTP 409) on illegal transitions.

2. **DAG Topological Scheduler & Scope Overlap Unit Tests**:
   ```bash
   pnpm test tests/unit/dag.test.ts
   ```
   - Verifies cycle detection (`TASK_INVALID_STATE_TRANSITION` 409), topological sorting, `isTaskReady` gating on `blockedBy` (standard `MERGED` and DAG Branch Stacking), and `hasWritableScopeOverlap` glob intersection + shared package manifest serialization.

3. **Clarification Question Protocol Unit Tests**:
   ```bash
   pnpm test tests/unit/clarification.test.ts
   ```
   - Verifies `maxClarificationQuestions: 5` and `maxClarificationRounds: 2` (`TASK_CLARIFICATION_LIMIT_REACHED` 400), `clarification-request.md` persistence, child subtask `<TASK_ID>.1` creation, parent `AWAITING_CLARIFICATION` transition, and resolution (`plan.md` append, child `MERGED`, ARP `clarification.response`, parent `IN_PROGRESS`).

4. **BullMQ Orchestrator Worker & Panic Button Integration Tests**:
   ```bash
   pnpm test tests/integration/orchestrator-cancel.test.ts
   ```
   - Verifies pre-flight dispatch gating (DAG readiness + scope overlap + lock acquisition + sandbox start) and full 7-step Panic Button teardown (`cancelTaskExecution`).

5. **Full Build, Lint, and Typecheck Verification**:
   ```bash
   pnpm typecheck
   pnpm lint
   pnpm build
   pnpm test
   ```
