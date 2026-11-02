# Implementation Plan: Reactive Quality Guards, Passive Evidence Ledger & System-One DecisionGate

**Branch**: `012-guards-and-decision-gate` | **Date**: 2026-10-25 | **Spec**: [spec.md](./spec.md)  
**Input**: Feature specification from `/specs/012-guards-and-decision-gate/spec.md`

## Summary

Implement Phase 10 of the Graywolf Squad master plan (`docs/implementation-plan-detailed.md` Tasks 10.1–10.3):
1. **Passive Verification Evidence Ledger (`src/orchestrator/guards/evidence-ledger.ts`, ADR-062)**: Append every in-container `test`, `lint`, `typecheck`, `build`, and `browser-test` execution to `<worktree>/.agent_evidence.db` and mirror summary rows inside `withTenantContext` to PostgreSQL `review_evidence`.
2. **Deterministic Clean-Code, Test & Documentation Guards (`src/orchestrator/guards/{clean-code-guard,test-guard,doc-guard}.ts`, ADR-083)**:
   - `clean-code-guard.ts`: Deterministic AST/pattern checks for empty `catch` blocks / swallowed errors, floating promises, zombie commented-out code, and hallucinated/unlisted imports verified against orchestrator-side `recon-report.json` (F14).
   - `test-guard.ts`: Checks that mocks (`vi.mock` / `jest.mock`) target only external infrastructure (never internal domain modules), rejects 0-assertion vacuous tests, and verifies real passing test execution in `.agent_evidence.db`.
   - `doc-guard.ts`: Verifies that every exported symbol, CLI flag, or `process.env.*` key referenced in documentation diffs exists in code/patch and that newly introduced `process.env.*` variables are documented in `.env.example`, emitting `.agents/tasks/<TASK_ID>/verification.md` and driving `GUARD_VERIFYING` ➔ `QA_FIXING` (up to `qaMaxRetries: 3`) ➔ `VERIFICATION_FAILED` or `HUMAN_REVIEW_GATE`.
3. **System-One `DecisionGate` Service (`src/orchestrator/decision-gate/service.ts`, ADR-079)**: Implement Gates 1–4 (`sandbox_tier`, `gate_policy`, `relay_tool`, `two_strike_prescreen`) with `< 150ms` fast evaluation, confidence thresholds (`>= 0.85` for Gates 1/4, `>= 0.90` for Gates 2/3), fail-closed confidence/offline fallback (`GATE_LOW_CONFIDENCE_FALLBACK`), and PostgreSQL `task_gate_decisions` persistence inside `withTenantContext`.

## Technical Context

**Language/Version**: TypeScript 5.x on Node.js 20+  
**Primary Dependencies**: `pg` (`withTenantContext`), `@sinclair/typebox`, `src/orchestrator/errors/taxonomy.ts` (`GUARD_*`, `GATE_LOW_CONFIDENCE_FALLBACK`), `src/orchestrator/services/state-machine.ts`  
**Storage**: `<worktree>/.agent_evidence.db` + PostgreSQL 16 (`review_evidence` and `task_gate_decisions` tables with tenant RLS)  
**Testing**: Vitest (`tests/unit/evidence-ledger.test.ts`, `tests/unit/guards.test.ts`, `tests/unit/decision-gate.test.ts`)  
**Target Platform**: Linux host / Orchestrator & sandbox containers  
**Project Type**: Backend orchestrator quality guards & System-One decision layer (`src/orchestrator/{guards,decision-gate}/*`)  
**Performance Goals**: `< 150ms` Gate 1–4 fast-screen execution; 0 LLM tokens for deterministic guards  
**Constraints**: F14 orchestrator-side `recon-report.json` dependency allowlist; Strike 2 never skips 3-pass debate; fail-closed fallback on confidence `< 0.85` / `< 0.90`  
**Scale/Scope**: 5 source modules (`evidence-ledger.ts`, `clean-code-guard.ts`, `test-guard.ts`, `doc-guard.ts`, `decision-gate/service.ts`) + 3 comprehensive unit test suites

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **Principle 1 (Human Sovereignty & Non-Committing Relay Contract)**: PASS — Guards inspect `changes.patch` and emit `verification.md`; high/critical risk patches in Gate 2 enforce `mandatory-human` approval.
- **Principle 2 (Zero Runtime Lock-In & Permissive Licensing)**: PASS — Uses permissive local AST/pattern analysis and open-weight/deterministic System-One classifiers.
- **Principle 3 (Single ACID Relational & Vector Baseline)**: PASS — Persists evidence and gate decisions to canonical PostgreSQL tables `review_evidence` and `task_gate_decisions` via `withTenantContext`.
- **Principle 4 (Headless Execution & Observability)**: PASS — Every command execution and gate decision is recorded with `duration_ms` / `latency_ms` and `confidence` in append-only audit tables.
- **Principle 5 (Dual Operational Mode: Greenfield & Brownfield)**: PASS — F14 invariant ensures `CleanCodeGuard` validates imports against orchestrator-side `recon-report.json`.
- **Principle 6 (Virtual Developer Tier Handoff Protocol)**: PASS — Guards run only after in-container `review-signoff.md`, and Gate 4 never bypasses Strike-2 3-pass adversarial review.
- **Principle 8 (Blast-Radius and Dependency Integrity)**: PASS — Gate 3 pre-screens `bash_execute` commands against destructive operations (`rm -rf`, `DROP TABLE`, secret exfiltration).
- **Principle 9 (Zero-Cost Open Source Foundation)**: PASS — Deterministic guards consume `0` LLM tokens and `$0.00` license cost.

## Project Structure

### Documentation (this feature)

```text
specs/012-guards-and-decision-gate/
├── spec.md              # Feature specification (FR-001..FR-006, SC-001..SC-003)
├── plan.md              # This technical implementation plan
├── research.md          # Technical decisions for Evidence Ledger, Guards & DecisionGate
├── data-model.md        # Relational schema touchpoints (review_evidence, task_gate_decisions)
├── quickstart.md        # Verification commands and test scenarios
├── checklists/
│   └── requirements.md  # Specification quality checklist (16/16 pass)
└── contracts/
    └── guards-and-decision-gate.md # TypeScript interfaces and behavioral invariants
```

### Source Code (repository root)

```text
src/orchestrator/guards/
├── evidence-ledger.ts   # Task 10.1: Passive .agent_evidence.db & Postgres review_evidence ledger
├── clean-code-guard.ts  # Task 10.2a: Empty catch, floating promise, zombie code & F14 import guard
├── test-guard.ts        # Task 10.2b: Domain-mock ban, 0-assertion detector & evidence ledger check
└── doc-guard.ts         # Task 10.2c: AST symbol/env doc sync + verification.md & QA_FIXING orchestrator

src/orchestrator/decision-gate/
└── service.ts           # Task 10.3: System-One DecisionGate (Gates 1-4, fallback & task_gate_decisions)

tests/unit/
├── evidence-ledger.test.ts # Unit tests for Task 10.1
├── guards.test.ts          # Unit tests for Task 10.2 (Clean-Code, Test, Doc guards & verification.md)
└── decision-gate.test.ts   # Unit tests for Task 10.3 (Gates 1-4, <150ms, confidence fallback)
```

**Structure Decision**: Matches the exact file paths specified in `docs/implementation-plan-detailed.md` §2 Canonical Repository Target Layout and Phase 10 Tasks 10.1–10.3.

## Complexity Tracking

No Constitution violations or complexity exceptions required.
