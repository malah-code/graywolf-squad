# Technical Research: Reactive Quality Guards, Passive Evidence Ledger & System-One DecisionGate

**Feature**: `012-guards-and-decision-gate`  
**Phase**: Phase 10

## 1. Dual-Store Passive Verification Evidence Ledger (Task 10.1, ADR-062)

- **Decision**: Persist every in-container command execution (`test`, `lint`, `typecheck`, `build`, `browser-test`) to `<worktree>/.agent_evidence.db` (structured JSON-lines file inside the task worktree for zero-native-dependency portability and instant file inspection) while mirroring summary records inside `withTenantContext` to PostgreSQL `review_evidence`.
- **Rationale**: Provides fast local inspection inside the worktree for container/host guards while maintaining tenant-isolated ACID audit records in PostgreSQL `review_evidence`.
- **Alternatives Considered**: Relying solely on agent-written markdown test summaries (rejected: agents can hallucinate or fabricate passing test output).

## 2. Deterministic Clean-Code, Test & Doc Guards + F14 Import Validation (Task 10.2, ADR-083)

- **Decision**:
  - `CleanCodeGuard`: Inspect added lines in `changes.patch` / modified files for: (a) empty `catch` blocks (`catch (...) { }` or comment-only catch), (b) floating promises (unawaited `.then(` without `.catch(` or explicit `floatingPromise` patterns), (c) zombie commented-out code blocks (`>= 5` consecutive commented code lines), and (d) hallucinated/banned package imports not listed in the orchestrator-side `recon-report.json` (F14).
  - `TestGuard`: Inspect test files in `changes.patch` for: (a) `vi.mock(...)` / `jest.mock(...)` targeting internal domain paths (e.g. `../services/`, `../domain/`, `../modules/`, `./`) rather than external infrastructure (`pg`, `ioredis`, `node-fetch`, etc.), (b) `it(...)` / `test(...)` blocks containing `0` assertions (`expect(`, `assert`), and (c) verify that `.agent_evidence.db` contains at least one `test` execution with `exitCode === 0` and no unresolved failing `test` run.
  - `DocGuard`: Verify that exported symbols, CLI flags, or `process.env.*` keys referenced in documentation diffs (`README.md`, `docs/**`, `.env.example`, or PR description) exist in `changes.patch` / codebase, and that any newly referenced `process.env.XYZ` in added code is documented in `.env.example` / docs; emit `.agents/tasks/<TASK_ID>/verification.md` and transition `GUARD_VERIFYING` ➔ `QA_FIXING` (up to `qaMaxRetries: 3`, then `VERIFICATION_FAILED`) or `HUMAN_REVIEW_GATE`.
- **Rationale**: Executes in single-digit milliseconds with `0` LLM tokens and 100% determinism.
- **Alternatives Considered**: Running a frontier LLM to check for empty catch blocks or missing assertions (rejected: slow, costly, and non-deterministic).

## 3. System-One `DecisionGate` Service (Task 10.3, ADR-079)

- **Decision**: Implement `DecisionGateService` supporting pluggable local classifier backends (Ollama/System-One model or deterministic fast-path evaluator) across Gates 1–4 (`sandbox_tier`, `gate_policy`, `relay_tool`, `two_strike_prescreen`). Enforce confidence floors (`0.85` for Gates 1 and 4; `0.90` for Gates 2 and 3). When confidence is below the floor or the classifier backend throws/times out, emit `GATE_LOW_CONFIDENCE_FALLBACK` (or return the safe conservative fallback with `usedFallback: true`) and persist every evaluation to `task_gate_decisions`.
- **Rationale**: Achieves `< 150ms` screening for common cases while guaranteeing fail-closed fallback to frontier reasoning or mandatory human review whenever uncertainty is high.
- **Alternatives Considered**: Hardcoding static rules without confidence scoring or `task_gate_decisions` audit logging (rejected: violates ADR-079 observability and calibration requirements).
