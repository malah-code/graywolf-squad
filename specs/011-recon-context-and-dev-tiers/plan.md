# Implementation Plan: Brownfield Reconnaissance, 8-Layer Context Engine & Virtual Developer Tiers

**Branch**: `011-recon-context-and-dev-tiers` | **Date**: 2026-10-25 | **Spec**: [spec.md](./spec.md)  
**Input**: Feature specification from `/specs/011-recon-context-and-dev-tiers/spec.md`

## Summary

Implement Phase 9 of the Graywolf Squad master plan (`docs/implementation-plan-detailed.md` Tasks 9.1–9.4):
1. **5-Phase Brownfield Reconnaissance Pipeline (`src/orchestrator/recon/*`)**:
   - Phase 1 (`fingerprint.ts`): 0-token detection of frameworks, ORMs, test runners, and CI/CD files.
   - Phase 2 (`ast-indexer.ts`): AST symbol and import/reference extraction (`code_symbols`, `code_references`) with SHA-256 file hashes and route literal normalization.
   - Phase 3 (`pagerank.ts`): Directed dependency graph and iterative PageRank centrality scoring (`damping = 0.85`).
   - Phase 4 (`blast-radius.ts`): Rule 0 Forbidden defaults, keyword feature root -> `writableScope`, transitive upstream imports -> `readOnlyScope`, and bounded downstream dependents (`depth <= 1`, max `20` files by PageRank) -> `readOnlyScope` + Downstream Regression Watchlist.
   - Phase 5 (`constitution-loader.ts` & `pipeline.ts`): ADR-038 instruction cascade (`AGENTS.md`, `CLAUDE.md`, `.cursorrules`, `.windsurfrules`) and emission of `.agents/recon-report.md`, `.agents/recon-report.json` (F14 orchestrator source of truth), and `.agents/constitution.md`.
2. **8-Layer Context Bundle & Exploration Engine (`src/orchestrator/context/*`)**:
   - Layer 1 (`repo-map.ts`): PageRank-ordered topological repository map capped at `~1,500` tokens.
   - Layer 2 (`symbol-graph.ts`): `findSymbolDefinition` and `findSymbolReferences` with SHA-256 hash-verified on-demand re-indexing.
   - Layer 3 (`hybrid-search.ts`): Lexical (`ripgrep`) + dense (`pgvector` 768-dim) search fused via Reciprocal Rank Fusion (`RRF`, `k = 60`).
   - Layer 4 (`surgical-slice.ts`): `viewFileRange` and `replaceFileContent`.
   - Layers 5–8 & Boot Freeze (`bundle.ts`): Project State Summary, `project_lessons` Anti-Patterns, Architecture Context, gated Internet Search logger, and `Object.freeze` boot-time prefix immutability (ADR-061).
3. **Virtual Developer Tiers & 3-Pass Adversarial Review (`src/orchestrator/tiers/*`, `src/orchestrator/schemas/review.ts`)**:
   - Dev-Level-1 (`planner.ts`): Honors `simplebugs.skipPlanning` and Access Mode (`Plan / Read-Only`, `Plan-Gate`, `Full Factory`), generates `plan.md` in configured `locale` (`ar|en|fr|tr` with LTR code/paths per ADR-081), and validates planned files against `BlastRadiusGuard`.
   - Dev-Level-3 (`implementer.ts`): Orchestrates `delegate-fleet.v1` execution and exposes origin-locked Chromium MCP tools (`browser_observe`, `browser_locate`, `browser_act`) wrapped in `<untrusted_browser_observation>` tags (ADR-077).
   - Dev-Level-2 (`reviewer.ts`, `schemas/review.ts`) & Neutral Arbiter (`arbiter.ts`): Implements `findings.v1` (Pass 1, `confidence >= 0.5`), `debate.v1` (Pass 2), and `final.v1` (Pass 3 verdicts: `agreed`, `contested`, `withdrawn`), auto-downgrades unverified `agreed P0/P1` test-failure claims against the evidence ledger (ADR-062) to `P2`, counts `0` strikes for `withdrawn`/`contested`, and escalates on `2` consecutive strikes via `agent-arbiter` (`escalation-memo.md` + `INTERNAL_REVIEW_FAILED`).

## Technical Context

**Language/Version**: TypeScript 5.x on Node.js 20+  
**Primary Dependencies**: `@sinclair/typebox`, `pg` (`withTenantContext`), Node `crypto` (SHA-256), `LiteLLMClient` (`src/orchestrator/gateway/litellm-client.ts`), `BlastRadiusGuard` (`src/orchestrator/arp/blast-radius-guard.ts`)  
**Storage**: PostgreSQL 16 (`code_symbols`, `code_references`, `project_lessons`, `review_evidence`, `tasks`) + `.agents/recon-report.{md,json}` & `.agents/constitution.md`  
**Testing**: Vitest (`tests/integration/recon-pipeline.test.ts`, `tests/unit/context-bundle.test.ts`, `tests/unit/planner-implementer.test.ts`, `tests/unit/adversarial-review.test.ts`)  
**Target Platform**: Linux host / Docker orchestrator & sandbox containers  
**Project Type**: Backend orchestrator intelligence, context, and cognitive tier modules (`src/orchestrator/{recon,context,tiers,schemas}/*`)  
**Performance Goals**: Phases 1–4 Recon in `< 5s` using `0` LLM tokens; Layer 1 Repo Map `<= 1,500` tokens; 100% byte-identical context bundle prefix across turns  
**Constraints**: Strict Rule 0 Forbidden Scope enforcement; downstream blast-radius bounded at `depth <= 1` and `<= 20` files; `withdrawn`/`contested` findings never increment strikes; `<untrusted_browser_observation>` prompt-injection barrier  
**Scale/Scope**: 16 source modules across `recon/`, `context/`, `tiers/`, and `schemas/` + 4 comprehensive test suites

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **Principle 1 (Human Sovereignty & Non-Committing Relay Contract)**: PASS — Tiers generate plans, diffs, review verdicts, and escalation memos within the task worktree; no upstream Git commits or pushes occur.
- **Principle 2 (Zero Runtime Lock-In & Permissive Licensing)**: PASS — Uses permissive open-source algorithms (PageRank, RRF `k=60`, TypeBox schemas) and routes model calls strictly through `LiteLLMClient` virtual aliases.
- **Principle 3 (Single ACID Relational & Vector Baseline)**: PASS — Uses PostgreSQL 16 + `pgvector` tables (`code_symbols`, `code_references`, `project_lessons`, `review_evidence`) with tenant RLS isolation.
- **Principle 4 (Headless Execution & Observability)**: PASS — All model invocations route through `LiteLLMClient` (which emits OTel GenAI spans and metrics), and internet search / recon actions produce structured audit records.
- **Principle 5 (Dual Operational Mode: Greenfield & Brownfield)**: PASS — Directly implements the 5-Phase Brownfield Reconnaissance Pipeline, Rule 0 Forbidden Scope defaults, and `BlastRadiusGuard` pre-validation in `planner.ts`.
- **Principle 6 (Virtual Developer Tier Handoff Protocol)**: PASS — Directly implements Dev-Level-1 (`agent-planner`) ➔ Dev-Level-3 (`agent-coder`) ➔ Dev-Level-2 (`agent-reviewer`) ➔ 2-Strike Neutral Arbiter (`agent-arbiter`) and enforces `review-signoff.md` before external QA.
- **Principle 8 (Blast-Radius and Dependency Integrity)**: PASS — Enforces bounded downstream traversal (`depth <= 1`, max `20` files) and F14 orchestrator-side `recon-report.json` immutability.
- **Principle 9 (Zero-Cost Open Source Foundation)**: PASS — Recon Phases 1–4 and Context Layers 1–4 execute with `0` LLM tokens and `$0.00` external license cost.

## Project Structure

### Documentation (this feature)

```text
specs/011-recon-context-and-dev-tiers/
├── spec.md              # Feature specification (FR-001..FR-007, SC-001..SC-004)
├── plan.md              # This technical implementation plan
├── research.md          # Technical decisions for Recon, RRF, 8-Layer Bundle & 3-Pass Debate
├── data-model.md        # Relational schema touchpoints & TypeBox review/recon schemas
├── quickstart.md        # Verification commands and test scenarios
├── checklists/
│   └── requirements.md  # Specification quality checklist (16/16 pass)
└── contracts/
    └── recon-context-tiers.md # TypeScript interfaces and behavioral invariants
```

### Source Code (repository root)

```text
src/orchestrator/recon/
├── fingerprint.ts          # Phase 1: 0-token framework, ORM, test runner & CI/CD detector
├── ast-indexer.ts          # Phase 2: AST symbol & reference extractor + route normalizer
├── pagerank.ts             # Phase 3: Directed import graph & PageRank centrality engine
├── blast-radius.ts         # Phase 4: Rule 0 Forbidden + Writable + bounded Read-Only algorithm
├── constitution-loader.ts  # Phase 5a: ADR-038 instruction file cascade loader
└── pipeline.ts             # Phase 5b: End-to-end 5-phase recon orchestrator & report writer

src/orchestrator/context/
├── repo-map.ts             # Layer 1: PageRank-sorted topological repo map (<= 1,500 tokens)
├── symbol-graph.ts         # Layer 2: Symbol definition/reference lookup + SHA-256 live re-index
├── hybrid-search.ts        # Layer 3: Lexical (ripgrep) + Dense (pgvector) RRF (k=60) fusion
├── surgical-slice.ts       # Layer 4: viewFileRange & replaceFileContent surgical editor
└── bundle.ts               # Layers 1–8 boot-time immutable ContextBundle assembler (ADR-061)

src/orchestrator/schemas/
└── review.ts               # TypeBox schemas for findings.v1, debate.v1, final.v1 & escalation memo

src/orchestrator/tiers/
├── planner.ts              # Dev-Level-1: Access Mode, skipPlanning, locale/LTR plan.md & blast check
├── implementer.ts          # Dev-Level-3: delegate-fleet.v1 & origin-locked browser MCP (<untrusted_browser_observation>)
├── reviewer.ts             # Dev-Level-2: 3-pass adversarial debate, evidence downgrade & strike counter
└── arbiter.ts              # Neutral Arbiter (agent-arbiter): 2-strike escalation-memo.md & INTERNAL_REVIEW_FAILED

tests/
├── integration/
│   └── recon-pipeline.test.ts    # End-to-end test for Task 9.1 on a multi-module TS fixture repo
└── unit/
    ├── context-bundle.test.ts    # Unit tests for Task 9.2 (Layers 1–8, RRF k=60, SHA-256 re-index, freeze)
    ├── planner-implementer.test.ts # Unit tests for Task 9.3 (skipPlanning, Access Mode, LTR, browser MCP)
    └── adversarial-review.test.ts  # Unit tests for Task 9.4 (3-pass debate, evidence downgrade, 2-strike arbiter)
```

**Structure Decision**: Matches the exact file paths specified in `docs/implementation-plan-detailed.md` §2 Canonical Repository Target Layout and Phase 9 Tasks 9.1–9.4.

## Complexity Tracking

No Constitution violations or complexity exceptions required.
