# Tasks: End-to-End Browser QA Engine (`@playwright/test`) & Parallel Bug Bash Sprint

**Input**: Design documents from `/specs/015-e2e-playwright-and-bug-bash/`  
**Prerequisites**: `plan.md` (required), `spec.md` (required), `research.md`, `data-model.md`, `contracts/e2e-and-bug-bash.md`

**Tests**: Included as required by `docs/implementation-plan-detailed.md` Phase 13 (`tests/unit/e2e-authoring-guard.test.ts`, `tests/unit/e2e-cache-replay.test.ts`, `tests/unit/e2e-explore.test.ts`, `tests/unit/bug-bash.test.ts`).

**Organization**: Tasks are grouped by user story and mapped directly to Phase 13 Tasks 13.1–13.4 in `docs/implementation-plan-detailed.md`.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (`[US1]`, `[US2]`, `[US3]`, `[US4]`)
- Include exact file paths in descriptions

---

## Phase 1: User Story 1 - Semantic Locator Guard & Deterministic vs. Intent Assertion Split (Priority: P1 — Master Plan Task 13.1)

**Goal**: Implement `evaluateE2eAuthoringGuard` (`src/orchestrator/e2e/authoring-guard.ts`) enforcing semantic Playwright locators, detecting financial/billing/tax scope via 3 deterministic triggers, and fail-closing `RELAY_DETERMINISTIC_LINTER_FAILED` when scoped tests lack deterministic `expect(...)`. Implement `IntentRuntime` (`src/orchestrator/e2e/intent-runtime.ts`) routing `agent.act/assert/waitFor/extract` exclusively through internal `LiteLLMClient`, enforcing preview-origin lock-on and `<untrusted_browser_observation>` wrapping.

**Independent Test**: Run `pnpm vitest run tests/unit/e2e-authoring-guard.test.ts` to verify selector hygiene, financial scope detection, and Anti-Self-Grading enforcement.

### Implementation & Tests for User Story 1 (Master Plan Task 13.1)

- [x] T001 [P] [US1] Implement `evaluateE2eAuthoringGuard`, `evaluateFinancialScope`, and `enforceNoLlmSelfGrading` in `src/orchestrator/e2e/authoring-guard.ts` accepting semantic Playwright locators (`getByRole`, `getByLabel`, `getByPlaceholder`, `getByText`, `getByTestId`), rejecting raw XPath/CSS class chains and `:nth-child`/`:nth-of-type` selectors, performing 3-signal financial scope detection (`FINANCIAL_SCOPE_TAGS`, `FINANCIAL_FILE_REGEX`, `CURRENCY_EXPECT_REGEX`), and throwing `GraywolfAppError('RELAY_DETERMINISTIC_LINTER_FAILED')` for scoped tasks lacking deterministic `expect(...)`
- [x] T002 [US1] Create unit test suite in `tests/unit/e2e-authoring-guard.test.ts` testing semantic locator acceptance, all 3 financial scope detection signals independently and combined, deterministic `expect(...)` enforcement, and the failing-closed `RELAY_DETERMINISTIC_LINTER_FAILED` contract on financial-scope tasks with `agent.assert(...)` only
- [x] T003 [P] [US1] Implement `IntentRuntime` class in `src/orchestrator/e2e/intent-runtime.ts` exporting `agentAct`, `agentAssert`, `agentWaitFor`, `agentExtract` routing exclusively through `LiteLLMClient` (alias `'agent-e2e-intent'`), enforcing preview-origin lock-on, and wrapping every browser observation through `wrapUntrustedBrowserObservation` per ADR-038

**Checkpoint**: User Story 1 (Task 13.1) is complete and independently verified via `tests/unit/e2e-authoring-guard.test.ts`.

---

## Phase 2: User Story 2 - Zero-Token Deterministic Cache-Replay Lifecycle & Merge Promotion (Priority: P1 — Master Plan Task 13.2)

**Goal**: Implement `E2eCacheReplayEngine` (`src/orchestrator/e2e/cache-replay.ts`) hashing `stepKey = SHA-256(normalizedRoute + '|' + action + '|' + sanitize(intent))`, replaying matching cached `agent.act` steps with `0` LLM tokens, falling back to live `IntentRuntime` on DOM drift without mutating `.agents/cache/e2e/`, and promoting verified task cache to `.agents/cache/e2e/` upon task `MERGED`.

**Independent Test**: Run `pnpm vitest run tests/unit/e2e-cache-replay.test.ts` to verify cache miss/hit replay with `$0.00` spend, DOM drift fallback, CI cache read-only invariant, and merge promotion.

### Implementation & Tests for User Story 2 (Master Plan Task 13.2)

- [x] T004 [P] [US2] Implement `E2eCacheReplayEngine` in `src/orchestrator/e2e/cache-replay.ts` with `computeStepKey({ route, action, intent })`, `replayOrExecuteStep` (cache hit/miss/dom-drift), `recordStepSuccess`, and `promoteTaskCacheOnMerge` enforcing task-scoped cache writes (`.agents/tasks/<TASK_ID>/e2e-cache/`) without mutating project baseline (`.agents/cache/e2e/`) until `MERGED`
- [x] T005 [US2] Create unit test suite in `tests/unit/e2e-cache-replay.test.ts` testing `computeStepKey` determinism (route + action + intent SHA-256), cache miss live resolution + task cache write, cache hit replay with `tokensUsed: 0` and `mode: 'cached'`, simulated DOM drift fallback (`ariaSnapshotHash` mismatch) writing only to task-scoped cache, and atomic `promoteTaskCacheOnMerge` after `MERGED`

**Checkpoint**: User Story 2 (Task 13.2) is complete and independently verified via `tests/unit/e2e-cache-replay.test.ts`.

---

## Phase 3: User Story 3 - Visual Review Packets & Dev-Level-2 4th Pass `e2e explore` Smoke Gate (Priority: P1 — Master Plan Task 13.3)

**Goal**: Implement `buildVisualReviewPacket` (`src/orchestrator/e2e/visual-packet.ts`) capturing HTML reports, console errors, masked `pixelmatch` screenshot diffs (`> 0.1%` ratio), and WebM video traces; implement `runExploreSmokeGate` (`src/orchestrator/e2e/explore-smoke.ts`) executing the bounded 4th pass (`maxTurns: 6`, `timeoutMs: 180_000`, `spendLimitUSD: $0.50`), recording `browser-test` evidence, and enforcing "No Repro, No Bug" attribution (stack trace ∩ `changes.patch`).

**Independent Test**: Run `pnpm vitest run tests/unit/e2e-explore.test.ts` to verify pixel-diff 0.1% threshold, dynamic-mask exclusion, capped explore execution, and "No Repro, No Bug" strike-attribution rules.

### Implementation & Tests for User Story 3 (Master Plan Task 13.3)

- [x] T006 [P] [US3] Implement `buildVisualReviewPacket`、`ConsoleErrorSummary`、`WebmTraceSummary` in `src/orchestrator/e2e/visual-packet.ts` capturing HTML reports, console errors, masked `pixelmatch` screenshot diffs (default threshold `0.1`, regression ceiling `pixelDiffRatio > 0.001`), WebM video trace metadata, dynamic masking for `[data-testid*="timestamp"]`, `[data-dynamic]`, `[data-avatar]`, `[data-animated]`, and `cached | live` provenance stamp tied to dominant replay mode
- [x] T007 [P] [US3] Implement `runExploreSmokeGate` and `evaluateNoReproAttribution` in `src/orchestrator/e2e/explore-smoke.ts` enforcing hard caps (`maxTurns: 6`, `timeoutMs: 180_000`, `spendLimitUSD: 0.50`), recording `browser-test` evidence to `EvidenceLedger`, computing repro-failure attribution (`stackTrace ∪ failedRoute ∩ touchesFiles`), and downgrading unattributed P0/P1 findings to `effectiveSeverity: 'P2'` with `strikeAdded: false`
- [x] T008 [US3] Create comprehensive unit test suite in `tests/unit/e2e-explore.test.ts` testing `pixelmatch` 0.1% ceiling, dynamic mask exclusion (`[data-dynamic]` ignored from diff area), console error capture, WebM metadata persistence, explore smoke hard caps (`turnsUsed ≤ 6`, `elapsedMs ≤ 180_000`, `spendUsd ≤ $0.50`), `browser-test` event recording in `.agent_evidence.db`, and "No Repro, No Bug" strike occurrence when stack trace intersects `changes.patch`

**Checkpoint**: User Story 3 (Task 13.3) is complete and independently verified via `tests/unit/e2e-explore.test.ts`.

---

## Phase 4: User Story 4 - Parallel Bug Bash Sprint (`bug-bash-sprint`, ADR-078) (Priority: P2 — Master Plan Task 13.4)

**Goal**: Implement `planBugBashSprint` (`src/orchestrator/delivery/bug-bash.ts`) fanning out `qa-explore-<area>` children (`maxExplorers: 8` Standard/Enterprise, `1` Constrained) prioritized by PageRank/risk centrality with budget governor (`maxExplorers * $0.50`); implement `confirmBugBashFinding` enforcing the "No Repro, No Bug" promotion to `CONFIRMED` + `fix:<issue>` backlog task or `UNCONFIRMED` + P2 advisory.

**Independent Test**: Run `pnpm vitest run tests/unit/bug-bash.test.ts` to verify profile-dependent explorer caps, PageRank priority sorting, budget governor cancellation, and the `CANDIDATE` → `qa-repro-<issue>` → `CONFIRMED` (+ `fix:<issue>` backlog) vs `UNCONFIRMED` (+ P2 advisory) state machine.

### Implementation & Tests for User Story 4 (Master Plan Task 13.4)

- [x] T009 [P] [US4] Implement `planBugBashSprint` and `attachBugBashBudgetGovernor` in `src/orchestrator/delivery/bug-bash.ts` enforcing `maxExplorers: 8` (Standard/Enterprise) and `1` (Constrained) per ADR-078 + ADR-024, `effectiveExplorers * $0.50` aggregate budget cap, PageRank/risk-sorted priority (using `pagerank.ts` from Phase 9), recording `deferredExplorers` for excess combinations, and emitting `BudgetGovernorEvent` for cap hits
- [x] T010 [P] [US4] Implement `confirmBugBashFinding` in `src/orchestrator/delivery/bug-bash.ts` (and re-export from the top-level module) enforcing the "No Repro, No Bug" `CANDIDATE` → `qa-repro-<issue>` → `CONFIRMED` (+ `fix:<issue>` backlog task with `blockedBy: ['qa-repro-<issue>']`) vs `UNCONFIRMED` (`effectiveSeverity: 'P2' advisory`) state machine
- [x] T011 [US4] Create unit test suite in `tests/unit/bug-bash.test.ts` testing Standard Profile (`maxExplorers: 8`, cap `$4.00`) vs Constrained Profile (`maxExplorers: 1`, cap `$0.50`) cap enforcement with PageRank/risk-sorted priority + `deferredExplorers` recording, `confirmBugBashFinding` repro pass/fail state transitions, `BudgetGovernorEvent` emission on cap hit with cancellation of remaining explorers, and `fix:<issue>` backlog task creation only on `'CONFIRMED'`

**Checkpoint**: User Story 4 (Task 13.4) is complete and independently verified via `tests/unit/bug-bash.test.ts`.

---

## Phase 5: Polish & Cross-Cutting Concerns

**Purpose**: Full repository typecheck, lint, and regression suite verification.

- [x] T012 Run `pnpm typecheck`, `pnpm lint`, and `pnpm test` across all suites and mark Tasks 13.1, 13.2, 13.3, and 13.4 `[x]` in `docs/implementation-plan-detailed.md`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (`T001`–`T003`, US1 `authoring-guard.ts` & `intent-runtime.ts`)**: No dependencies — starts immediately.
- **Phase 2 (`T004`–`T005`, US2 `cache-replay.ts`)**: Depends on `T003` (uses `IntentRuntime` for live fallback).
- **Phase 3 (`T006`–`T008`, US3 `visual-packet.ts` & `explore-smoke.ts`)**: `T006` is independent; `T007`–`T008` depend on `T003` (uses `IntentRuntime`).
- **Phase 4 (`T009`–`T011`, US4 `bug-bash.ts`)**: Depends on `T007` (depends on `ExploreFinding`, `NoReproAttributionResult`).
- **Phase 5 (`T012`)**: Depends on `T001`–`T011`.

### Parallel Opportunities

- `T001` (`authoring-guard.ts`), `T003` (`intent-runtime.ts`), `T006` (`visual-packet.ts`), and `T009` (`bug-bash.ts` `planBugBashSprint`) touch completely separate files and can be developed in parallel.
- `T004` (`cache-replay.ts`) and `T006` (visual-packet) can be developed in parallel.

### Critical Calibration Rules

- Cache replay MUST be strictly read-only against `.agents/cache/e2e/` during CI runs.
- Explore smoke MUST halt cleanly when `maxTurns: 6` is hit; findings collected so far are evaluated without failing the container.
- Bug Bash `fix:<issue>` backlog tasks MUST include the failing `qa-repro-<issue>` test as `blockedBy` acceptance criterion.
