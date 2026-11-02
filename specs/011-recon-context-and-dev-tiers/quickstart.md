# Quickstart & Verification Guide: Phase 9 Recon, Context Engine & Dev Tiers

**Feature**: `011-recon-context-and-dev-tiers`  
**Phase**: Phase 9

## 1. Prerequisites

- Node.js 20+ and `pnpm` installed
- Phase 0–8 modules compiled and passing (`pnpm typecheck`)

## 2. Running the Phase 9 Verification Suites

1. **Task 9.1 — 5-Phase Brownfield Reconnaissance Pipeline**:
   ```bash
   pnpm vitest run tests/integration/recon-pipeline.test.ts
   ```
   Verifies 0-token framework/CI fingerprinting, AST symbol & route extraction, PageRank scoring, Rule 0 `forbiddenScope` + bounded `readOnlyScope` (`depth <= 1`, max `20` files), and `.agents/recon-report.md` + `.agents/constitution.md` generation.

2. **Task 9.2 — 8-Layer Context Bundle & Exploration Engine**:
   ```bash
   pnpm vitest run tests/unit/context-bundle.test.ts
   ```
   Verifies Layer 1 repo-map token budget cap (`<= 1,500` tokens), Layer 2 SHA-256 hash-verified live re-indexing, Layer 3 RRF (`k = 60`) rank fusion, Layer 4 surgical file slicing, and boot-time `Object.freeze` prefix immutability.

3. **Task 9.3 — Dev-Level-1 (Planner) & Dev-Level-3 (Implementer + Browser MCP)**:
   ```bash
   pnpm vitest run tests/unit/planner-implementer.test.ts
   ```
   Verifies `simplebugs.skipPlanning`, Access Mode Pill handling, `locale` (`ar|en|fr|tr`) with LTR code/path preservation, `BlastRadiusGuard` target validation, and origin-locked `<untrusted_browser_observation>` wrapping.

4. **Task 9.4 — Dev-Level-2 (3-Pass Adversarial Debate) & Neutral Arbiter**:
   ```bash
   pnpm vitest run tests/unit/adversarial-review.test.ts
   ```
   Verifies `findings.v1` (`confidence >= 0.5`), `debate.v1`, and `final.v1` schemas, passive evidence ledger downgrade of unbacked `agreed P0/P1` test-failure claims to `P2`, `0` strikes for `withdrawn` and `contested` findings, and 2-strike `agent-arbiter` escalation to `INTERNAL_REVIEW_FAILED`.
