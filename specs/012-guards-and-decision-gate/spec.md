# Feature Specification: Reactive Quality Guards, Passive Evidence Ledger & System-One DecisionGate

**Feature Branch**: `012-guards-and-decision-gate`

**Created**: 2026-10-25

**Status**: Draft

**Input**: User description: "Phase 10 Reactive Quality Guards, Passive Evidence Ledger & System-One DecisionGate: Implement the 3 deterministic external QA guards (Clean-Code, Test, Doc), the passive SQLite/Postgres verification evidence ledger (ADR-062), and the Fastify DecisionGate service (Gates 1–4, ADR-079)."

## Clarifications

### Session 2026-10-25
- Q: Where does the Clean-Code Guard source allowed package dependencies when validating imports in `changes.patch`? → A: Per F14 (Orchestrator Source of Truth Invariant), `clean-code-guard.ts` MUST read allowed packages and module paths exclusively from the orchestrator-side `.agents/recon-report.json` (or explicit project allowlist), NEVER from the container's mutable `package.json` or `go.mod` on disk.
- Q: How does the Passive Verification Evidence Ledger (`evidence-ledger.ts`, ADR-062) persist records across the worktree and PostgreSQL? → A: Every in-container execution of `test`, `lint`, `typecheck`, `build`, or `browser-test` is appended to `<worktree>/.agent_evidence.db` (deterministic JSONL/SQLite-compatible local ledger file inside the worktree) and mirrored inside `withTenantContext` to the PostgreSQL `review_evidence` table (`task_id`, `workspace_id`, `command_type`, `command`, `exit_code`, `duration_ms`, `stdout_summary`, `stderr_summary`).
- Q: What are the exact confidence thresholds and fallback rules for System-One `DecisionGate` (ADR-079 Gates 1–4)? → A: Gate 1 (`sandbox_tier`) and Gate 4 (`two_strike_prescreen`) require `confidence >= 0.85`; Gate 2 (`gate_policy`) and Gate 3 (`relay_tool`) require `confidence >= 0.90`. If the classifier returns confidence below the gate's threshold or the local System-One runtime is unreachable (`GATE_LOW_CONFIDENCE_FALLBACK`), `DecisionGate` deterministically falls back to the safe frontier/conservative default (`tier-2-isolated-db` for Gate 1, `mandatory-human` for high/critical or `human` for Gate 2, `escalate_frontier` for Gate 3, and full 3-pass debate for Gate 4) and logs every decision to PostgreSQL `task_gate_decisions`.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Passive Verification Evidence Ledger (Priority: P1)

As a review and quality-guard orchestrator enforcing ADR-062, I need every in-container verification command (`test`, `lint`, `typecheck`, `build`, `browser-test`) passively recorded to `<worktree>/.agent_evidence.db` and mirrored to PostgreSQL `review_evidence` under tenant RLS so that both the Dev-Level-2 reviewer and the external Test Guard can verify real command execution rather than trusting agent claims.

**Why this priority**: Both Phase 9's evidence-backed review downgrade and Phase 10's Test Guard depend on an immutable, tamper-evident record of commands actually executed inside the sandbox.

**Independent Test**: Can be tested by recording multiple command executions (`test`, `lint`, `typecheck`, `build`, `browser-test`) through `EvidenceLedger`, verifying `<worktree>/.agent_evidence.db` persistence and querying, and verifying tenant-isolated `INSERT INTO review_evidence` calls.

**Acceptance Scenarios**:

1. **Given** an active task worktree and tenant context, **When** a container executes a `test`, `lint`, `typecheck`, `build`, or `browser-test` command, **Then** `EvidenceLedger` writes the record (`commandType`, `command`, `exitCode`, `durationMs`, `stdoutSummary`, `stderrSummary`, `createdAt`) to `<worktree>/.agent_evidence.db` and mirrors the row into PostgreSQL `review_evidence`.
2. **Given** a populated `<worktree>/.agent_evidence.db`, **When** the Test Guard or Reviewer queries the ledger for passing test runs, **Then** it accurately reports whether at least one `test` command completed with `exitCode === 0` and whether any `test` command failed (`exitCode !== 0`).

---

### User Story 2 - Deterministic Clean-Code, Test & Documentation Guards (Priority: P1)

As a lead engineer enforcing Constitution Principle 1 and ADR-083, I need every task that passes internal review (`review-signoff.md`) to be inspected by 3 deterministic, 0-token external QA guards (`Clean-Code Guard`, `Test Guard`, and `Documentation Guard`) that emit `verification.md` and transition defective patches to `QA_FIXING` (up to `qaMaxRetries: 3`, then `VERIFICATION_FAILED`).

**Why this priority**: Deterministic AST/diff guards catch swallowed errors, hallucinated imports, mocked internal domain modules, vacuous 0-assertion tests, and undocumented symbol drift in milliseconds with zero LLM hallucination risk.

**Independent Test**: Can be tested by feeding synthetic passing and defective patches into `clean-code-guard.ts`, `test-guard.ts`, and `doc-guard.ts` and verifying violation detection, `verification.md` formatting (`specs/001-multi-agent-platform/data-model.md` §1.3), and state machine transitions (`GUARD_VERIFYING` ➔ `QA_FIXING` up to 3 retries ➔ `VERIFICATION_FAILED`, or `HUMAN_REVIEW_GATE` on pass).

**Acceptance Scenarios**:

1. **Given** a task patch (`changes.patch`) and orchestrator-side `recon-report.json`, **When** `CleanCodeGuard` evaluates the patch, **Then** it rejects empty `catch` blocks / swallowed errors, unhandled floating promises, zombie commented-out code blocks, and hallucinated/unlisted package imports not present in the orchestrator's `recon-report.json` allowlist (F14).
2. **Given** a task patch containing test files and `<worktree>/.agent_evidence.db`, **When** `TestGuard` evaluates the patch, **Then** it rejects mocks targeting internal domain modules (allowing mocks only for external infrastructure like DB/Valkey/HTTP), rejects vacuous test blocks with 0 assertions (`expect(` / `assert`), and rejects tasks with no passing (`exitCode === 0`) `test` execution in the evidence ledger.
3. **Given** a task patch that exports new or modified public symbols, CLI flags, or `.env` keys alongside README/API documentation updates, **When** `DocGuard` evaluates the patch, **Then** it verifies that every exported symbol, CLI flag, or environment variable referenced in the documentation diff exists in the code/patch and flags undocumented breaking signature drift.
4. **Given** the results of all 3 guards, **When** the guard suite completes, **Then** it writes `.agents/tasks/<TASK_ID>/verification.md` matching the canonical schema (`data-model.md` §1.3); if any guard fails and `qaAttempts < qaMaxRetries` (default `3`), it transitions the task from `GUARD_VERIFYING` to `QA_FIXING` (`GUARD_CLEAN_CODE_FAILED` / `GUARD_TEST_FAILED` / `GUARD_DOC_FAILED`), and when `qaAttempts >= qaMaxRetries` it transitions the task to `VERIFICATION_FAILED`.

---

### User Story 3 - System-One `DecisionGate` Service (Gates 1–4, ADR-079) (Priority: P1)

As a platform architect optimizing latency and token spend, I need a sub-150ms System-One `DecisionGate` service implementing Gates 1–4 (`sandbox_tier`, `gate_policy`, `relay_tool`, `two_strike_prescreen`) with strict confidence thresholds (`0.85` / `0.90`), seamless frontier fallback (`GATE_LOW_CONFIDENCE_FALLBACK`), and full audit persistence in `task_gate_decisions`.

**Why this priority**: Eliminates slow, expensive frontier LLM calls for routine routing and pre-screening decisions while guaranteeing fail-closed safety when confidence is below threshold.

**Independent Test**: Can be tested by evaluating Gates 1–4 across high-confidence, low-confidence (`< 0.85` / `< 0.90`), destructive-command, and offline-backend scenarios and verifying classification outputs, `< 150ms` execution, fallback behavior (`GATE_LOW_CONFIDENCE_FALLBACK`), and `task_gate_decisions` persistence.

**Acceptance Scenarios**:

1. **Given** a task brief and target file list, **When** Gate 1 (`sandbox_tier`) evaluates database isolation needs with `confidence >= 0.85`, **Then** it classifies the task into `'tier-0-mock'`, `'tier-1-shared-db'`, or `'tier-2-isolated-db'`.
2. **Given** a verified patch, test status, and touched file list, **When** Gate 2 (`gate_policy`) evaluates risk (`low`, `medium`, `high`, `critical`), **Then** `low` risk + green tests + `confidence >= 0.90` promotes the gate policy to `'auto'`, whereas `high`/`critical` risk or sensitive file touches enforce `'mandatory-human'`.
3. **Given** an in-container `bash_execute` command request, **When** Gate 3 (`relay_tool`) pre-screens the command, **Then** destructive or exfiltration patterns (`rm -rf /`, `DROP TABLE`, `TRUNCATE`, `curl`/`wget` secret exfiltration) are immediately blocked (`allowed: false`, `risk: 'critical'`).
4. **Given** a test failure or deterministic guard violation after implementation, **When** Gate 4 (`two_strike_prescreen`) evaluates Strike 1 with `confidence >= 0.85` (or `>= 0.90` for fast-screen logic errors), **Then** it dispatches an accelerated Strike-1 rework brief skipping the 3-pass debate, while Strike 2 ALWAYS requires the full ADR-056 3-pass adversarial debate.
5. **Given** any Gate 1–4 evaluation where confidence is below the gate's threshold (`< 0.85` for Gates 1/4 or `< 0.90` for Gates 2/3) or the local classifier is unavailable, **Then** `DecisionGate` triggers `GATE_LOW_CONFIDENCE_FALLBACK`, returns the safe conservative fallback decision, and persists the audit row to `task_gate_decisions`.

---

### Edge Cases

- **Agent mutates container `package.json` to smuggle a banned package (F14)**: `CleanCodeGuard` ignores the container's `package.json` and validates imports strictly against the orchestrator-side `recon-report.json` dependency list.
- **Test file contains `it('works', () => { service.run(); })` with zero assertions**: `TestGuard` detects `0` assertions in the test block and fails the guard with `GUARD_TEST_FAILED`.
- **Gate 4 invoked on Strike 2**: Even if the System-One classifier reports `confidence = 0.99` on Strike 2, Gate 4 refuses to skip the 3-pass debate because Strike 2 mandatory adversarial review is non-negotiable per ADR-079.
- **QA retry exhaustion (`qaAttempts === 3`)**: On the 3rd consecutive guard failure, the orchestrator transitions the task to `VERIFICATION_FAILED` rather than looping back to `QA_FIXING`.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001 (Passive Verification Evidence Ledger — ADR-062)**: System MUST implement `src/orchestrator/guards/evidence-ledger.ts` recording every `test`, `lint`, `typecheck`, `build`, and `browser-test` execution to `<worktree>/.agent_evidence.db` and mirroring summary rows inside `withTenantContext` to PostgreSQL `review_evidence`.
- **FR-002 (Deterministic Clean-Code Guard — ADR-083 & F14)**: System MUST implement `src/orchestrator/guards/clean-code-guard.ts` inspecting `changes.patch` / modified source files for empty `catch` blocks / swallowed errors, unhandled floating promises, zombie commented-out code blocks (`>= 5` consecutive commented code lines), and hallucinated/unlisted third-party imports verified strictly against orchestrator-side `recon-report.json` (F14).
- **FR-003 (Deterministic Test Guard — ADR-083 & ADR-062)**: System MUST implement `src/orchestrator/guards/test-guard.ts` rejecting mocks that target internal domain modules (`vi.mock` / `jest.mock` on internal relative paths outside allowed infrastructure adapters), rejecting vacuous test blocks with `0` assertions, and requiring at least one passing (`exitCode === 0`) and zero unrecovered failing `test` executions in `.agent_evidence.db`.
- **FR-004 (Deterministic Documentation Guard — ADR-083)**: System MUST implement `src/orchestrator/guards/doc-guard.ts` verifying that every exported symbol, CLI flag, or environment variable (`process.env.*`) referenced in modified documentation (`README.md`, `docs/**`, `.env.example`, or PR description) exists in the codebase/patch and that newly added `process.env.*` keys in code are documented in `.env.example`.
- **FR-005 (`verification.md` Emission & `QA_FIXING` / `VERIFICATION_FAILED` State Transitions)**: System MUST emit `.agents/tasks/<TASK_ID>/verification.md` matching `specs/001-multi-agent-platform/data-model.md` §1.3; when all 3 guards pass, transition `GUARD_VERIFYING` ➔ `HUMAN_REVIEW_GATE`; when any guard fails, transition `GUARD_VERIFYING` ➔ `QA_FIXING` up to `qaMaxRetries` (default `3`) and then `GUARD_VERIFYING` ➔ `VERIFICATION_FAILED`.
- **FR-006 (System-One `DecisionGate` Gates 1–4 & Persistence — ADR-079)**: System MUST implement `src/orchestrator/decision-gate/service.ts` supporting Gate 1 (`sandbox_tier`), Gate 2 (`gate_policy`), Gate 3 (`relay_tool`), and Gate 4 (`two_strike_prescreen` — Strike 1 only, never Strike 2), enforcing confidence thresholds (`>= 0.85` for Gates 1/4, `>= 0.90` for Gates 2/3), falling back safely on low confidence or backend unavailability (`GATE_LOW_CONFIDENCE_FALLBACK`), and persisting every decision to PostgreSQL `task_gate_decisions` inside `withTenantContext`.

### Key Entities

- **Verification Evidence Entry (`VerificationEvidenceEntry`)**: Immutable record of a single in-container verification command (`id`, `taskId`, `workspaceId`, `commandType`, `command`, `exitCode`, `durationMs`, `stdoutSummary`, `stderrSummary`, `createdAt`) stored in `<worktree>/.agent_evidence.db` and `review_evidence`.
- **Guard Evaluation Report (`GuardSuiteReport` / `verification.md`)**: Combined deterministic verdict (`PASS` | `FAIL`) and per-guard check breakdown for `Clean-Code Guard`, `Test Guard`, and `Documentation Guard`, along with next task state (`HUMAN_REVIEW_GATE`, `QA_FIXING`, or `VERIFICATION_FAILED`).
- **Task Gate Decision (`TaskGateDecision`)**: Recorded evaluation of System-One `DecisionGate` (`gate`: `'sandbox_tier' | 'gate_policy' | 'relay_tool' | 'two_strike_prescreen'`, `question`, `result`, `confidence`, `latencyMs`, `modelBackend`, `usedFallback`) persisted in `task_gate_decisions`.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001 (Evidence Ledger Fidelity)**: 100% of recorded verification commands (`test`, `lint`, `typecheck`, `build`, `browser-test`) persist to `<worktree>/.agent_evidence.db` and mirror to `review_evidence` under tenant RLS isolation.
- **SC-002 (Deterministic Guard Precision)**: 100% of synthetic defective patches containing empty catch blocks, hallucinated imports (absent from `recon-report.json`), mocked internal domain modules, 0-assertion tests, or undocumented `.env` / symbol references are rejected by the guards and transition the task to `QA_FIXING` (or `VERIFICATION_FAILED` on retry exhaustion).
- **SC-003 (DecisionGate Speed & Fail-Closed Fallback)**: 100% of deterministic/local `DecisionGate` evaluations complete in `< 150ms`, 100% of below-threshold (`< 0.85` / `< 0.90`) or offline evaluations trigger `GATE_LOW_CONFIDENCE_FALLBACK` to the safe conservative default, and Strike 2 never bypasses the 3-pass debate.

## Assumptions

- PostgreSQL tables `review_evidence` (Table #16) and `task_gate_decisions` (Table #15) from Phase 1 (`migrations/1789444040216_create-tasks-table.js`) and `withTenantContext` are migrated and available.
- Canonical ADR-042 error codes (`GUARD_CLEAN_CODE_FAILED`, `GUARD_TEST_FAILED`, `GUARD_DOC_FAILED`, `GATE_LOW_CONFIDENCE_FALLBACK`) in `src/orchestrator/errors/taxonomy.ts` and task state transitions (`GUARD_VERIFYING`, `QA_FIXING`, `VERIFICATION_FAILED`, `HUMAN_REVIEW_GATE`) in `src/orchestrator/services/state-machine.ts` are available.
