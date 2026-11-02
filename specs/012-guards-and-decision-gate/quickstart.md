# Quickstart & Verification Guide: Phase 10 Guards, Evidence & DecisionGate

**Feature**: `012-guards-and-decision-gate`  
**Phase**: Phase 10

## 1. Prerequisites

- Node.js 20+ and `pnpm` installed
- Phase 0–9 modules compiled and passing (`pnpm typecheck`)

## 2. Running the Phase 10 Verification Suites

1. **Task 10.1 — Passive Verification Evidence Ledger (ADR-062)**:
   ```bash
   pnpm vitest run tests/unit/evidence-ledger.test.ts
   ```
   Verifies `.agent_evidence.db` worktree persistence, `review_evidence` PostgreSQL mirroring inside `withTenantContext`, and passing/failing test queries.

2. **Task 10.2 — Deterministic Clean-Code, Test & Doc Guards (ADR-083)**:
   ```bash
   pnpm vitest run tests/unit/guards.test.ts
   ```
   Verifies detection of empty catch blocks, floating promises, zombie commented code, hallucinated imports against `recon-report.json` (F14), mocked internal domain modules, 0-assertion tests, undocumented symbols/env vars, `verification.md` generation, and `QA_FIXING` / `VERIFICATION_FAILED` state transitions.

3. **Task 10.3 — System-One `DecisionGate` Service (Gates 1–4, ADR-079)**:
   ```bash
   pnpm vitest run tests/unit/decision-gate.test.ts
   ```
   Verifies Gates 1–4 (`sandbox_tier`, `gate_policy`, `relay_tool`, `two_strike_prescreen`), `< 150ms` execution, Strike-2 mandatory 3-pass debate enforcement, `GATE_LOW_CONFIDENCE_FALLBACK` on low confidence or unavailable backend, and `task_gate_decisions` persistence.
