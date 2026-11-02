# Tasks: Reactive Quality Guards, Passive Evidence Ledger & System-One DecisionGate

**Input**: Design documents from `/specs/012-guards-and-decision-gate/`  
**Prerequisites**: `plan.md` (required), `spec.md` (required), `research.md`, `data-model.md`, `contracts/guards-and-decision-gate.md`

**Tests**: Included as required by `docs/implementation-plan-detailed.md` Phase 10 (`tests/unit/evidence-ledger.test.ts`, `tests/unit/guards.test.ts`, and `tests/unit/decision-gate.test.ts`).

**Organization**: Tasks are grouped by user story and mapped directly to Phase 10 Tasks 10.1–10.3 in the master plan.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (`[US1]`, `[US2]`, `[US3]`)
- Include exact file paths in descriptions

---

## Phase 1: User Story 1 - Passive Verification Evidence Ledger (Priority: P1) 🎯 MVP

**Goal**: Record every in-container `test`, `lint`, `typecheck`, `build`, and `browser-test` command execution to `<worktree>/.agent_evidence.db` and mirror summary rows to `review_evidence` in PostgreSQL inside `withTenantContext` (ADR-062).

**Independent Test**: Run `pnpm vitest run tests/unit/evidence-ledger.test.ts` to verify `.agent_evidence.db` append/read fidelity and `review_evidence` PostgreSQL mirroring.

### Implementation & Tests for User Story 1 (Master Plan Task 10.1)

- [X] T001 [P] [US1] Implement `EvidenceLedger` in `src/orchestrator/guards/evidence-ledger.ts` appending `VerificationEvidenceEntry` records (`command_type VARCHAR(32)` `'test' | 'lint' | 'typecheck' | 'build' | 'browser-test'`, `command TEXT NOT NULL`, `exit_code INT NOT NULL`, `duration_ms INT NOT NULL`, `stdout_summary TEXT`, `stderr_summary TEXT`) to `<worktree>/.agent_evidence.db` and mirroring rows via `withTenantContext` to PostgreSQL `review_evidence`
- [X] T002 [US1] Create unit test suite in `tests/unit/evidence-ledger.test.ts` verifying `<worktree>/.agent_evidence.db` persistence, `withTenantContext` `INSERT INTO review_evidence` mirroring, and `hasPassingTestExecution` queries

**Checkpoint**: User Story 1 (Task 10.1) is complete and independently verified via `tests/unit/evidence-ledger.test.ts`.

---

## Phase 2: User Story 2 - Deterministic Clean-Code, Test & Documentation Guards (Priority: P1)

**Goal**: Implement the 3 deterministic external QA guards (`clean-code-guard.ts`, `test-guard.ts`, `doc-guard.ts`), emit `verification.md` (`data-model.md` §1.3), and transition defective patches to `QA_FIXING` (up to `qaMaxRetries: 3`, then `VERIFICATION_FAILED`) or `HUMAN_REVIEW_GATE` on pass (ADR-083, F14).

**Independent Test**: Run `pnpm vitest run tests/unit/guards.test.ts` with synthetic passing and failing patches.

### Implementation & Tests for User Story 2 (Master Plan Task 10.2)

- [X] T003 [P] [US2] Implement `evaluateCleanCodeGuard` in `src/orchestrator/guards/clean-code-guard.ts` detecting empty `catch` blocks / swallowed errors, unhandled floating promises, zombie commented-out code blocks (`>= 5` lines), and hallucinated/banned imports verified against orchestrator-side `recon-report.json` allowlist (F14)
- [X] T004 [P] [US2] Implement `evaluateTestGuard` in `src/orchestrator/guards/test-guard.ts` rejecting mocks targeting internal domain modules, rejecting 0-assertion vacuous tests, and verifying passing `test` execution (`exitCode === 0`) in `.agent_evidence.db`
- [X] T005 [US2] Implement `evaluateDocGuard` and `runReactiveGuardSuite` in `src/orchestrator/guards/doc-guard.ts` checking exported symbol / CLI flag / `.env.example` documentation parity, emitting `verification.md` (`data-model.md` §1.3), and enforcing `GUARD_VERIFYING` ➔ `QA_FIXING` (`qaMaxRetries: 3`) ➔ `VERIFICATION_FAILED` / `HUMAN_REVIEW_GATE` transitions
- [X] T006 [US2] Create unit test suite in `tests/unit/guards.test.ts` testing synthetic passing and failing patches across `CleanCodeGuard`, `TestGuard`, `DocGuard`, `verification.md` formatting, and `QA_FIXING` / `VERIFICATION_FAILED` retry exhaustion

**Checkpoint**: User Story 2 (Task 10.2) is complete and independently verified via `tests/unit/guards.test.ts`.

---

## Phase 3: User Story 3 - System-One `DecisionGate` Service (Gates 1–4, ADR-079) (Priority: P1)

**Goal**: Implement `DecisionGateService` (`src/orchestrator/decision-gate/service.ts`) for Gate 1 (`sandbox_tier`), Gate 2 (`gate_policy`), Gate 3 (`relay_tool`), and Gate 4 (`two_strike_prescreen`), enforcing `< 150ms` fast evaluation, confidence thresholds (`>= 0.85` for Gates 1/4, `>= 0.90` for Gates 2/3), `GATE_LOW_CONFIDENCE_FALLBACK` on low confidence or unavailable backend, and persistence to PostgreSQL `task_gate_decisions`.

**Independent Test**: Run `pnpm vitest run tests/unit/decision-gate.test.ts` to verify Gates 1–4, `< 150ms` latency, Strike-2 debate protection, confidence fallback, and `task_gate_decisions` persistence.

### Implementation & Tests for User Story 3 (Master Plan Task 10.3)

- [X] T007 [P] [US3] Implement `DecisionGateService` in `src/orchestrator/decision-gate/service.ts` supporting Gates 1–4 (`gate VARCHAR(32)` `'sandbox_tier' | 'gate_policy' | 'relay_tool' | 'two_strike_prescreen'`, `question TEXT NOT NULL`, `result JSONB NOT NULL`, `confidence NUMERIC(4, 3) NOT NULL`, `latency_ms INT NOT NULL`, `model_backend VARCHAR(64) NOT NULL`), confidence floors (`0.85` / `0.90`), `GATE_LOW_CONFIDENCE_FALLBACK`, and `withTenantContext` persistence to `task_gate_decisions`
- [X] T008 [US3] Create unit test suite in `tests/unit/decision-gate.test.ts` verifying Gate 1 (`sandbox_tier`), Gate 2 (`gate_policy` auto-promotion vs `mandatory-human`), Gate 3 (`relay_tool` destructive command blocking), Gate 4 (`two_strike_prescreen` `< 150ms` Strike-1 fast rework vs mandatory Strike-2 3-pass debate), `GATE_LOW_CONFIDENCE_FALLBACK`, and `task_gate_decisions` DB logging

**Checkpoint**: User Story 3 (Task 10.3) is complete and independently verified via `tests/unit/decision-gate.test.ts`.

---

## Phase 4: Polish & Cross-Cutting Concerns

**Purpose**: Full repository typecheck, lint, and regression suite verification.

- [X] T009 Run `pnpm typecheck`, `pnpm lint`, and `pnpm test` across all suites and mark Tasks 10.1, 10.2, and 10.3 `[x]` in `docs/implementation-plan-detailed.md`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (`T001`–`T002`, US1 Evidence Ledger)**: No dependencies — starts immediately.
- **Phase 2 (`T003`–`T006`, US2 Guards)**: `T003` and `T004` can start immediately (`T004` uses `VerificationEvidenceEntry` from `T001`).
- **Phase 3 (`T007`–`T008`, US3 DecisionGate)**: Independent of Phases 1–2 — can run in parallel.
- **Phase 4 (`T009`)**: Depends on `T001`–`T008`.

### Parallel Opportunities

- `T001` (`evidence-ledger.ts`), `T003` (`clean-code-guard.ts`), `T004` (`test-guard.ts`), and `T007` (`decision-gate/service.ts`) touch separate files and can be developed in parallel.
