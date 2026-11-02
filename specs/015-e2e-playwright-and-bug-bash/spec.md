# Feature Specification: End-to-End Browser QA Engine (`@playwright/test`) & Parallel Bug Bash Sprint

**Feature Branch**: `015-e2e-playwright-and-bug-bash`

**Created**: 2026-10-25

**Status**: Draft

**Input**: User description: "Phase 13 End-to-End Browser QA Engine (@playwright/test) & Parallel Bug Bash Sprint: Implement the Hybrid Intent / Deterministic Playwright QA engine with zero-token cache replay (ADR-075), Visual Review Packets (ADR-077), Dev-Level-2 Fourth Pass e2e explore smoke gate (ADR-076), and the Parallel Bug Bash Sprint pattern (ADR-078)."

## Clarifications

### Session 2026-10-25

- Q: How should the deterministic cache-replay engine compute the unique stepKey for serialized agent.act steps to prevent collisions across different pages or views? (FR-003) → A: SHA-256 hash of normalized parameterized route path, action type, and normalized intent text (`SHA-256(normalizedRoute + action + intent)`).
- Q: What pixel-diff threshold and masking strategy should VisualReviewPacket use to classify screenshot comparisons as visual regressions? (FR-004) → A: 0.1% mismatched pixel ratio ceiling (`diffPixels / totalPixels > 0.001`) using `pixelmatch` threshold `0.1`, with automatic masking of dynamic selectors (`[data-testid*="timestamp"]`, `[data-dynamic]`, avatars, and animations).
- Q: How should planBugBashSprint prioritize and schedule area-persona pairs when requested combinations exceed the maxExplorers cap (8 on Standard, 1 on Constrained)? (FR-006) → A: PageRank/risk-sorted priority (code graph centrality and security/financial criticality), selecting the top `maxExplorers` (`8` Standard, `1` Constrained) within budget ceiling (`effectiveExplorers * $0.50`), and recording excess pairs in `deferredExplorers`.
- Q: How should evaluateE2eAuthoringGuard detect whether a task or test file is within financial/billing scope to enforce the Anti-Self-Grading rule? (FR-001) → A: Multi-signal detection across 3 deterministic triggers: (1) Task tags or brief contain `['financial', 'billing', 'tax', 'payment', 'pricing', 'ledger', 'invoice', 'calculation']`; (2) Any file in `touchedFiles`/`changes.patch` matches `/(billing|tax|invoice|payment|ledger|pricing|checkout|currency|discount|vat|payroll)/i`; (3) Test diff asserts on currency symbols or monetary testIds (`/[$€£¥]|total|subtotal|tax|vat|invoice|balance/i`). If any trigger fires, test diff must contain >=1 deterministic Playwright `expect(...).to...` assertion; relying solely on `agent.assert(...)` fails closed with `RELAY_DETERMINISTIC_LINTER_FAILED`.
- Q: How should explore-smoke.ts deterministically verify that a P0/P1 repro test failure is attributable to changes.patch to qualify as a Strike? (FR-005) → A: Stack trace & touched file intersection: the repro failure error stack trace or failed route must intersect files in `changes.patch`; failures in untouched code are classified as pre-existing defects (`0` strikes against Dev-Level-3, logged as P2 advisory).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Semantic Locator Guard & Deterministic vs. Intent Assertion Split (Priority: P1)

As a quality engineering lead enforcing ADR-075, I need an authoring guard (`src/orchestrator/e2e/authoring-guard.ts`) and local intent runtime (`src/orchestrator/e2e/intent-runtime.ts`) that enforce semantic Playwright locators (`getByRole`, `getByLabel`, `getByTestId`), reject brittle CSS/XPath selectors in Dev-Level-3 test diffs, route `agent.act`, `agent.assert`, `agent.waitFor`, and `agent.extract` exclusively through the internal LiteLLM gateway (`http://litellm-proxy:4000` with zero external SaaS sync), and require deterministic Playwright `expect()` assertions on all financial, billing, calculation, or tax tasks (Anti-Self-Grading rule).

**Why this priority**: Prevents flaky CSS/XPath E2E suites and ensures high-stakes financial/calculation logic is never self-graded solely by a probabilistic LLM assertion.

**Independent Test**: Can be tested by running `AuthoringGuard` against synthetic test diffs (semantic locators vs. brittle CSS/XPath selectors and financial/tax tasks with `agent.assert` only vs. deterministic `expect()`), and verifying `IntentRuntime` routes `agent.act`/`assert`/`waitFor`/`extract` strictly through `LiteLLMClient`.

**Acceptance Scenarios**:

1. **Given** a Dev-Level-3 test diff touching `*.spec.ts` or `*.e2e.ts`, **When** `evaluateE2eAuthoringGuard` inspects the diff, **Then** it allows semantic locators (`getByRole`, `getByLabel`, `getByPlaceholder`, `getByText`, `getByTestId`) and rejects brittle CSS class chains, raw XPath (`xpath=//...`), or positional `:nth-child` selectors.
2. **Given** a task touching financial, billing, calculation, or tax files (`billing`, `tax`, `invoice`, `payment`, `ledger`, `pricing`), **When** `evaluateE2eAuthoringGuard` inspects the test suite, **Then** it rejects tests that rely solely on `agent.assert(...)` without at least one deterministic Playwright `expect(...)` assertion (Anti-Self-Grading rule).
3. **Given** an E2E test calling `agent.act`, `agent.assert`, `agent.waitFor`, or `agent.extract`, **When** `IntentRuntime` executes the step, **Then** all model requests route exclusively through the internal `LiteLLMClient` with zero external SaaS cloud calls.

---

### User Story 2 - Zero-Token Deterministic Cache-Replay Lifecycle & Merge Promotion (Priority: P1)

As a platform operator minimizing E2E token spend and latency (ADR-075), I need successful `agent.act` DOM resolution steps serialized into `.agents/tasks/<TASK_ID>/e2e-cache/` (`src/orchestrator/e2e/cache-replay.ts`), replayed deterministically with `0` LLM tokens on subsequent runs, self-healed via fallback to a live agent turn on DOM drift without mutating the shared project cache during CI, and promoted to `.agents/cache/e2e/` only when the task transitions to `MERGED`.

**Why this priority**: Reduces repeat E2E execution cost to `$0.00` (0 tokens) while isolating unmerged task cache mutations from the shared baseline cache.

**Independent Test**: Can be tested by executing `E2eCacheReplayEngine` across a cache miss (live resolution + task cache write), cache hit (0 LLM tokens consumed), simulated DOM drift (fallback to live agent turn writing only to `.agents/tasks/<TASK_ID>/e2e-cache/`), and task `MERGED` promotion to `.agents/cache/e2e/`.

**Acceptance Scenarios**:

1. **Given** a cached `agent.act` step in `.agents/cache/e2e/` or `.agents/tasks/<TASK_ID>/e2e-cache/`, **When** `replayOrExecuteStep` runs and the cached semantic locator resolves cleanly on the DOM, **Then** the step executes deterministically consuming `0` LLM tokens (`mode: 'cached'`, `tokensUsed: 0`).
2. **Given** a cached step whose selector fails due to DOM drift during a task or CI run, **When** `replayOrExecuteStep` catches the locator failure, **Then** it falls back to a live `IntentRuntime` turn (`mode: 'live'`), writes the updated step only to `.agents/tasks/<TASK_ID>/e2e-cache/`, and leaves `.agents/cache/e2e/` untouched.
3. **Given** a task with updated entries in `.agents/tasks/<TASK_ID>/e2e-cache/`, **When** the task reaches `MERGED`, **Then** `promoteTaskCacheOnMerge` atomically promotes the verified cache entries into `.agents/cache/e2e/`.

---

### User Story 3 - Visual Review Packets & Dev-Level-2 4th Pass `e2e explore` Smoke Gate (Priority: P1)

As a Dev-Level-2 reviewer and human lead (ADR-076, ADR-077), I need `src/orchestrator/e2e/visual-packet.ts` to capture HTML reports, console errors, masked screenshots with pixel-diffing, and WebM video traces into `.agents/tasks/<TASK_ID>/review/`, and `src/orchestrator/e2e/explore-smoke.ts` to execute the bounded 4th-pass `e2e explore` smoke gate (`maxTurns: 6`, `timeoutMs: 180_000`, `spendLimitUSD: 0.50`) for `ui`, `api-surface`, and `mandatory-e2e` tasks while enforcing the **"No Repro, No Bug"** rule.

**Why this priority**: Catches runtime visual/console regressions before human review while preventing unverified exploratory complaints from falsely failing tasks.

**Independent Test**: Can be tested by assembling a `VisualReviewPacket` with pixel-diff calculation and `cached` vs. `live` provenance, running `runExploreSmokeGate` under turn/time/budget limits (`6` turns, `180s`, `$0.50`), verifying `browser-test` evidence recording in `.agent_evidence.db`, and verifying that a P0/P1 explore finding only counts as a strike when backed by a failing minimal repro test attributable to `changes.patch`.

**Acceptance Scenarios**:

1. **Given** a completed E2E run, **When** `buildVisualReviewPacket` executes, **Then** it records HTML report paths, console error logs, masked screenshot pixel-diff ratios, and WebM video traces under `.agents/tasks/<TASK_ID>/review/` with explicit `cached` vs. `live` execution indicators.
2. **Given** a task tagged `ui`, `api-surface`, or `mandatory-e2e`, **When** `runExploreSmokeGate` executes the Dev-Level-2 4th pass, **Then** it enforces hard caps of `maxTurns = 6`, `timeoutMs = 180_000`, and `spendLimitUSD = 0.50`, and logs a `browser-test` entry to `.agent_evidence.db`.
3. **Given** a `P0` or `P1` finding discovered during `e2e explore`, **When** "No Repro, No Bug" evaluation runs, **Then** the finding counts as a strike (`countsAsStrike: true`) ONLY if backed by a failing minimal reproduction test (`reproExitCode !== 0`) attributable to files touched in `changes.patch`; otherwise it is downgraded to `P2` advisory (`countsAsStrike: false`).

---

### User Story 4 - Parallel Bug Bash Sprint (`bug-bash-sprint`, ADR-078) (Priority: P2)

As an engineering lead running a pre-release quality sweep, I need `src/orchestrator/delivery/bug-bash.ts` to fan out `qa-explore-<area>` child tasks across `areas × personas` (capped at `maxExplorers: 8` on Standard/Enterprise profiles and `1` on Topology A Constrained Profile) with an aggregate sprint budget governor (`maxExplorers * $0.50`), classify initial findings as `CANDIDATE`, spawn `qa-repro-<issue>` child tasks for Dev-Level-3 to author a minimal failing test, and promote findings to `CONFIRMED` (auto-creating a `fix:<issue>` backlog task) only when the repro test fails as reported.

**Why this priority**: Enables autonomous, high-signal exploratory bug hunting across an application without flooding the backlog with unconfirmed false positives.

**Independent Test**: Can be tested by planning and executing a `BugBashSprint` across Standard (`maxExplorers: 8`) vs. Constrained (`maxExplorers: 1`) profiles, verifying budget capping (`maxExplorers * 0.50`), and testing the `CANDIDATE` ➔ `qa-repro-<issue>` ➔ `CONFIRMED` (+ `fix:<issue>` backlog task) vs. `UNCONFIRMED` (downgraded to `P2` advisory) state machine.

**Acceptance Scenarios**:

1. **Given** a `bug-bash-sprint` request specifying `areas` and `personas`, **When** `planBugBashSprint` runs, **Then** it caps concurrent `qa-explore-<area>` tasks at `8` for Standard/Enterprise profiles and `1` for Constrained Profile, setting the aggregate sprint budget ceiling to `effectiveExplorers * $0.50`.
2. **Given** an initial exploratory finding (`status: 'CANDIDATE'`), **When** the `qa-repro-<issue>` subtask executes, **Then** if the authored reproduction test fails as reported (`reproFailedAsExpected === true`), the finding transitions to `'CONFIRMED'` and spawns a `fix:<issue>` backlog task; if the reproduction test passes or cannot reproduce the issue, the finding transitions to `'UNCONFIRMED'` and is downgraded to `'P2'` advisory with no backlog task created.

---

### Edge Cases

- **Financial/billing task uses `agent.assert('total is correct')` with zero deterministic `expect()` calls**: `AuthoringGuard` rejects the test file with `RELAY_DETERMINISTIC_LINTER_FAILED` under the Anti-Self-Grading rule.
- **DOM drift during CI replay**: `E2eCacheReplayEngine` falls back to live resolution and writes the healed step only to `.agents/tasks/<TASK_ID>/e2e-cache/`, never mutating `.agents/cache/e2e/` until merge.
- **`e2e explore` exceeds 6 turns or `$0.50` budget**: `runExploreSmokeGate` halts exploration cleanly at the cap and evaluates collected findings without failing the container for budget overflow.
- **Bug Bash request with 12 area×persona combinations on Standard vs. Constrained profile**: Capped deterministically to `8` explorers (`$4.00` cap) on Standard and `1` explorer (`$0.50` cap) on Constrained.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001 (Semantic Locator & Anti-Self-Grading Authoring Guard — Task 13.1a)**: System MUST implement `src/orchestrator/e2e/authoring-guard.ts` enforcing semantic Playwright locators (`getByRole`, `getByLabel`, `getByPlaceholder`, `getByText`, `getByTestId`), rejecting brittle CSS/XPath selectors, and requiring deterministic `expect(...).to...` assertions on all financial, billing, calculation, or tax scopes identified by 3 deterministic triggers: (1) task tags/brief containing financial/billing keywords, (2) touched files matching `/(billing|tax|invoice|payment|ledger|pricing|checkout|currency|discount|vat|payroll)/i`, or (3) test diff assertions targeting currency or monetary testIds; failing closed with `RELAY_DETERMINISTIC_LINTER_FAILED` if a scoped test relies solely on `agent.assert(...)`.
- **FR-002 (Local-Only Hybrid Intent Runtime — Task 13.1b)**: System MUST implement `src/orchestrator/e2e/intent-runtime.ts` providing `agent.act`, `agent.assert`, `agent.waitFor`, and `agent.extract` routed exclusively through internal `LiteLLMClient` with zero external SaaS calls and wrapping page snapshots in `<untrusted_browser_observation>` tags.
- **FR-003 (Zero-Token Cache-Replay Lifecycle & Merge Promotion — Task 13.2)**: System MUST implement `src/orchestrator/e2e/cache-replay.ts` serializing resolved `agent.act` steps into `.agents/tasks/<TASK_ID>/e2e-cache/` using deterministic `stepKey` computed as `SHA-256(normalizedRoute + action + intent)` (with parameterized route patterns to avoid dynamic ID churn), replaying cached steps with `0` LLM tokens, falling back to live agent resolution on DOM drift without mutating `.agents/cache/e2e/`, and promoting task cache entries to `.agents/cache/e2e/` upon `MERGED`.
- **FR-004 (Visual Review Packets & Pixel Diffing — Task 13.3a)**: System MUST implement `src/orchestrator/e2e/visual-packet.ts` capturing HTML reports, console errors, masked screenshot pixel-diff scores (enforcing a 0.1% mismatched pixel ratio ceiling with automatic masking of dynamic elements matching `[data-testid*="timestamp"]`, `[data-dynamic]`, avatars, and animations), and WebM video metadata into `.agents/tasks/<TASK_ID>/review/` with `cached` vs. `live` indicators.
- **FR-005 (Dev-Level-2 4th Pass `e2e explore` Smoke Gate & "No Repro, No Bug" — Task 13.3b)**: System MUST implement `src/orchestrator/e2e/explore-smoke.ts` executing the 4th-pass exploratory smoke gate for `ui`, `api-surface`, and `mandatory-e2e` tasks under hard caps (`maxTurns: 6`, `timeoutMs: 180_000`, `spendLimitUSD: 0.50`), recording `browser-test` evidence in `.agent_evidence.db`, and enforcing "No Repro, No Bug" where P0/P1 findings only count as a strike against Dev-Level-3 if backed by a minimal failing repro test whose error stack trace or failed route directly intersects files modified in `changes.patch` (failures in untouched code are classified as pre-existing defects with 0 strikes and logged as P2 advisory).
- **FR-006 (Parallel Bug Bash Sprint — Task 13.4)**: System MUST implement `src/orchestrator/delivery/bug-bash.ts` fanning out `qa-explore-<area>` tasks (`maxExplorers: 8` Standard/Enterprise, `1` Constrained; budget `effectiveExplorers * $0.50`), prioritizing area × persona pairs via PageRank/risk-sorted centrality and recording excess combinations in `deferredExplorers`, classifying initial findings as `CANDIDATE`, spawning `qa-repro-<issue>` subtasks, and promoting to `CONFIRMED` + `fix:<issue>` backlog task only when the repro test fails as reported (`UNCONFIRMED` + `P2` advisory otherwise).

### Key Entities

- **E2E Authoring Guard Report (`E2eAuthoringGuardResult`)**: Result of inspecting E2E test diffs for brittle selectors and Anti-Self-Grading compliance (`passed`, `isFinancialOrCalculationScope`, `hasDeterministicExpect`, `violations`).
- **Cached Intent Step (`CachedIntentStep`)**: Serialized DOM resolution record (`stepKey`: SHA-256 hash of parameterized route + action + normalized intent, `normalizedRoute`, `intent`, `resolvedLocator`, `action`, `value`, `createdAt`) stored in `.agents/tasks/<TASK_ID>/e2e-cache/` and `.agents/cache/e2e/`.
- **Visual Review Packet (`VisualReviewPacket`)**: Artifact manifest under `.agents/tasks/<TASK_ID>/review/` containing screenshot diffs (`pixelDiffRatio`, `isVisualRegression`: ratio > 0.001, `maskedSelectors`), console error logs, WebM video trace paths, and `cached` vs. `live` indicators.
- **Explore Smoke Gate Outcome (`ExploreSmokeOutcome`)**: Result of the bounded 4th-pass `e2e explore` run (`turnsUsed`, `spendUsd`, `findings`, `strikesAdded`, `attributionVerified`, `preExistingDefects`, `evidenceRecorded`).
- **Bug Bash Sprint Plan & Report (`BugBashSprintPlan`, `BugBashIssueResolution`)**: Fan-out plan (`explorerTasks`, `deferredExplorers`, `budgetCapUsd`, `hardwareProfile`) and issue verification result (`status`: `'CANDIDATE' | 'CONFIRMED' | 'UNCONFIRMED'`, `effectiveSeverity`, `spawnedFixTask`).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001 (Selector Hygiene & Anti-Self-Grading)**: 100% of test diffs containing raw XPath or brittle CSS chains or financial/tax tests lacking deterministic `expect()` assertions are rejected by `AuthoringGuard`.
- **SC-002 (Zero-Token Replay & Cache Isolation)**: 100% of intact cached `agent.act` steps replay with `0` LLM tokens, DOM drift self-healing never mutates `.agents/cache/e2e/` before merge, and `MERGED` tasks promote their cache cleanly.
- **SC-003 (Bounded Explore Smoke & "No Repro, No Bug")**: 100% of `e2e explore` runs enforce `<= 6` turns, `<= 180s`, and `<= $0.50`, and 100% of unbacked `P0`/`P1` exploratory claims are downgraded to `P2` with `0` strikes.
- **SC-004 (Bug Bash Confirmation Precision)**: 100% of Bug Bash sprints enforce profile explorer caps (`8` vs. `1`) and only create `fix:<issue>` backlog tasks for findings whose `qa-repro-<issue>` test fails as reported.

## Assumptions

- `EvidenceLedger` from Phase 10 (`src/orchestrator/guards/evidence-ledger.ts`) is available to record `browser-test` executions into `<worktree>/.agent_evidence.db`.
- `LiteLLMClient` from Phase 8 (`src/orchestrator/gateway/litellm-client.ts`) and `wrapUntrustedBrowserObservation` from Phase 9 (`src/orchestrator/tiers/implementer.ts`) are available.
