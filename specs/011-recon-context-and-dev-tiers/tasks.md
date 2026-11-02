# Tasks: Brownfield Reconnaissance, 8-Layer Context Engine & Virtual Developer Tiers

**Input**: Design documents from `/specs/011-recon-context-and-dev-tiers/`  
**Prerequisites**: `plan.md` (required), `spec.md` (required), `research.md`, `data-model.md`, `contracts/recon-context-tiers.md`

**Tests**: Included as required by `docs/implementation-plan-detailed.md` Phase 9 (`tests/integration/recon-pipeline.test.ts`, `tests/unit/context-bundle.test.ts`, `tests/unit/planner-implementer.test.ts`, and `tests/unit/adversarial-review.test.ts`).

**Organization**: Tasks are grouped by user story and mapped directly to Phase 9 Tasks 9.1–9.4 in the master plan.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (`[US1]`, `[US2]`, `[US3]`)
- Include exact file paths in descriptions

---

## Phase 1: Setup & Shared Review Contracts

**Purpose**: Establish TypeBox schemas for 3-pass adversarial review and escalation memos used by the cognitive tiers.

- [X] T001 [P] Create `src/orchestrator/schemas/review.ts` defining TypeBox schemas and validators for `FindingsV1` (`schemaVersion: 'findings.v1'`, `confidence >= 0.5`, `severity: 'P0' | 'P1' | 'P2'`, `axis: 'standards' | 'spec'`), `DebateV1` (`schemaVersion: 'debate.v1'`, `stance: 'confirm' | 'refute'`, `newGaps`), `FinalV1` (`schemaVersion: 'final.v1'`, `verdict: 'agreed' | 'contested' | 'withdrawn'`, `effectiveSeverity`, `downgradedByEvidenceLedger`, `strikeIncrement: 0 | 1`), and `EscalationMemo`

---

## Phase 2: User Story 1 - 5-Phase Brownfield Reconnaissance & Algorithmic Blast-Radius Proposal (Priority: P1) 🎯 MVP

**Goal**: Implement the 5-phase brownfield reconnaissance pipeline (`fingerprint.ts`, `ast-indexer.ts`, `pagerank.ts`, `blast-radius.ts`, `constitution-loader.ts`, `pipeline.ts`) where Phases 1–4 use 0 LLM tokens, classify CI/CD and platform control files into Rule 0 `forbiddenScope`, bound downstream `readOnlyScope` to `depth <= 1` and `<= 20` files by PageRank, and emit `.agents/recon-report.md`, `.agents/recon-report.json`, and `.agents/constitution.md`.

**Independent Test**: Run `pnpm vitest run tests/integration/recon-pipeline.test.ts` on a multi-module TypeScript fixture repository.

### Implementation & Tests for User Story 1 (Master Plan Task 9.1)

- [X] T002 [P] [US1] Implement Phase 1 repository detector in `src/orchestrator/recon/fingerprint.ts` (0-token detection of frameworks, ORMs, test runners, package managers, and CI/CD files) and Phase 2 symbol/reference extractor in `src/orchestrator/recon/ast-indexer.ts` (`name VARCHAR(255)`, `kind VARCHAR(32)`, `lineStart`, `lineEnd`, `exported`, `signature`, `hash VARCHAR(64)` SHA-256, `reference_type VARCHAR(16)`, and API route literal normalization `:id`/`{id}`/`<id>` -> `:id`)
- [X] T003 [US1] Implement Phase 3 directed dependency graph and PageRank centrality scorer (`damping = 0.85`) in `src/orchestrator/recon/pagerank.ts` and Phase 4 blast-radius boundary algorithm in `src/orchestrator/recon/blast-radius.ts` (Rule 0 `forbiddenScope` defaults, keyword feature root -> `writableScope`, transitive upstream imports -> `readOnlyScope`, and bounded downstream dependents `depth <= 1`, max `20` files by PageRank -> `readOnlyScope` + `downstreamWatchlist`)
- [X] T004 [US1] Implement Phase 5 convention cascade loader (`AGENTS.md`, `CLAUDE.md`, `.cursorrules`, `.windsurfrules` per ADR-038) in `src/orchestrator/recon/constitution-loader.ts` and end-to-end 5-phase orchestrator in `src/orchestrator/recon/pipeline.ts` emitting `.agents/recon-report.md`, `.agents/recon-report.json` (F14 source of truth), and `.agents/constitution.md`
- [X] T005 [US1] Create integration test suite in `tests/integration/recon-pipeline.test.ts` verifying 0-token Phases 1–4 execution, AST symbol & route extraction, PageRank ordering, Rule 0 `forbiddenScope`, bounded downstream `readOnlyScope` (`<= 20` files, `depth <= 1`), and `.agents/recon-report.md` + `.agents/constitution.md` generation on a multi-module TypeScript fixture repository

**Checkpoint**: User Story 1 (Task 9.1) is complete and independently verified via `tests/integration/recon-pipeline.test.ts`.

---

## Phase 3: User Story 2 - Boot-Time Immutable 8-Layer Context Bundle & Hybrid Exploration Engine (Priority: P1)

**Goal**: Implement the 8-Layer Context Bundle (`repo-map.ts`, `symbol-graph.ts`, `hybrid-search.ts`, `surgical-slice.ts`, `bundle.ts`) with a `<= 1,500`-token PageRank repo map, SHA-256 hash-verified live symbol re-indexing, RRF (`k = 60`) lexical + vector search fusion, surgical file slicing, and boot-time prefix immutability (ADR-061).

**Independent Test**: Run `pnpm vitest run tests/unit/context-bundle.test.ts` to verify Layers 1–8 assembly, token capping, live re-index on file edit, RRF (`k = 60`), and boot-time freeze.

### Implementation & Tests for User Story 2 (Master Plan Task 9.2)

- [X] T006 [P] [US2] Implement Layer 1 PageRank-sorted topological repo map (`maxTokens = 1500`) in `src/orchestrator/context/repo-map.ts` and Layer 2 symbol graph lookup (`findSymbolDefinition`, `findSymbolReferences` with SHA-256 disk hash check and synchronous on-demand re-indexing) in `src/orchestrator/context/symbol-graph.ts`
- [X] T007 [P] [US2] Implement Layer 3 hybrid search RRF (`k = 60`) rank fusion (`ripgrep` lexical + `pgvector` 768-dim dense hits) in `src/orchestrator/context/hybrid-search.ts`, Layer 4 surgical file slicing (`viewFileRange`, `replaceFileContent`) in `src/orchestrator/context/surgical-slice.ts`, and Layers 1–8 boot-time immutable `ContextBundle` assembler (`Object.freeze` + SHA-256 `prefixHash`) in `src/orchestrator/context/bundle.ts`
- [X] T008 [US2] Create unit test suite in `tests/unit/context-bundle.test.ts` verifying Layer 1 `<= 1,500` token cap, Layer 2 SHA-256 mismatch live re-indexing, Layer 3 RRF (`k = 60`) deterministic scoring, Layer 4 `viewFileRange` / `replaceFileContent`, and Layers 1–8 `ContextBundle` deep immutability across turns

**Checkpoint**: User Story 2 (Task 9.2) is complete and independently verified via `tests/unit/context-bundle.test.ts`.

---

## Phase 4: User Story 3 - Virtual Developer Tier Handoff (Dev-Level-1 ➔ Dev-Level-3 ➔ Dev-Level-2 ➔ Neutral Arbiter) (Priority: P1)

**Goal**: Implement `planner.ts` (`Dev-Level-1`), `implementer.ts` (`Dev-Level-3` + origin-locked `<untrusted_browser_observation>` Chromium MCP), `reviewer.ts` (`Dev-Level-2` 3-pass adversarial debate with ADR-062 evidence ledger downgrade), and `arbiter.ts` (2-strike `agent-arbiter` escalation to `INTERNAL_REVIEW_FAILED`).

**Independent Test**: Run `pnpm vitest run tests/unit/planner-implementer.test.ts tests/unit/adversarial-review.test.ts` to verify Planner, Implementer, 3-Pass Reviewer, and Neutral Arbiter behavior.

### Implementation & Tests for User Story 3 (Master Plan Tasks 9.3 & 9.4)

- [X] T009 [P] [US3] Implement Dev-Level-1 Planner in `src/orchestrator/tiers/planner.ts` (honoring `simplebugs.skipPlanning`, Access Mode Pill `'plan-read-only' | 'plan-gate' | 'full-factory'`, `locale` `'ar' | 'en' | 'fr' | 'tr'` with LTR code/path preservation per ADR-081, and `BlastRadiusGuard` validation) and Dev-Level-3 Implementer in `src/orchestrator/tiers/implementer.ts` (`delegate-fleet.v1` orchestration + preview-origin-locked `browser_observe` / `browser_locate` / `browser_act` wrapped in `<untrusted_browser_observation>` tags per ADR-077)
- [X] T010 [P] [US3] Implement Dev-Level-2 3-Pass Adversarial Reviewer in `src/orchestrator/tiers/reviewer.ts` (`findings.v1` ➔ `debate.v1` ➔ `final.v1`, ADR-062 evidence ledger auto-downgrade of unbacked `agreed P0/P1` test-failure claims to `P2`, `0` strikes for `withdrawn`/`contested`, `+1` strike for verified `agreed P0/P1`, and `review-signoff.md` generation) and Neutral Arbiter in `src/orchestrator/tiers/arbiter.ts` (`agent-arbiter` 2-strike `escalation-memo.md` synthesis and `INTERNAL_REVIEW_FAILED` state transition)
- [X] T011 [US3] Create unit test suites in `tests/unit/planner-implementer.test.ts` and `tests/unit/adversarial-review.test.ts` testing `skipPlanning`, Access Mode Pills, `locale` LTR preservation, `BlastRadiusGuard` enforcement, `<untrusted_browser_observation>` wrapping & origin lock, 3-pass verdicts (`agreed`, `contested`, `withdrawn`), ADR-062 evidence-ledger downgrade, and 2-strike `agent-arbiter` escalation to `INTERNAL_REVIEW_FAILED`

**Checkpoint**: User Story 3 (Tasks 9.3 & 9.4) is complete and independently verified.

---

## Phase 5: Polish & Cross-Cutting Concerns

**Purpose**: Full repository typecheck, lint, and regression suite verification.

- [X] T012 Run `pnpm typecheck`, `pnpm lint`, and `pnpm test` across all suites and mark Tasks 9.1, 9.2, 9.3, and 9.4 `[x]` in `docs/implementation-plan-detailed.md`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (`T001`)**: No dependencies — starts immediately.
- **Phase 2 (`T002`–`T005`, US1 Recon)**: No dependencies — can run in parallel with Phase 1.
- **Phase 3 (`T006`–`T008`, US2 Context Bundle)**: Depends on `T002`–`T003` (`ast-indexer.ts` and `pagerank.ts`).
- **Phase 4 (`T009`–`T011`, US3 Dev Tiers & Review)**: Depends on `T001` (`schemas/review.ts`).
- **Phase 5 (`T012`)**: Depends on `T001`–`T011`.

### Parallel Opportunities

- `T001` (`schemas/review.ts`) and `T002` (`fingerprint.ts`, `ast-indexer.ts`) can run in parallel.
- `T006` (`repo-map.ts`, `symbol-graph.ts`), `T007` (`hybrid-search.ts`, `surgical-slice.ts`, `bundle.ts`), `T009` (`planner.ts`, `implementer.ts`), and `T010` (`reviewer.ts`, `arbiter.ts`) touch independent files and can be developed in parallel once `T001`–`T003` are complete.
