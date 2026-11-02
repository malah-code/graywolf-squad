# Research & Technical Decisions: End-to-End Browser QA Engine (`@playwright/test`) & Parallel Bug Bash Sprint (Phase 13)

**Feature**: `015-e2e-playwright-and-bug-bash`  
**Date**: 2026-10-25  
**References**: `docs/implementation-plan-detailed.md` (Phase 13 Tasks 13.1–13.4), `docs/PRD.md` (§5.5, §8.6, §12.1), `docs/decisions.md` (ADR-075, ADR-076, ADR-077, ADR-078)

---

## Decision 1 — Semantic-Locator Authoring Guard with Financial Anti-Self-Grading Rule (Task 13.1, ADR-075)

- **Decision**:
  - Implement `src/orchestrator/e2e/authoring-guard.ts` exporting `evaluateE2eAuthoringGuard({ diffPatch, touchedFiles, briefMarkdown, taskTags })` that produces an `E2eAuthoringGuardResult` with `passed: boolean`, `isFinancialOrCalculationScope: boolean`, `hasDeterministicExpect: boolean`, and a `violations[]` list.
  - Accept Playwright **semantic** locators: `getByRole`, `getByLabel`, `getByPlaceholder`, `getByText`, `getByTestId`. Reject raw XPath (`xpath=//...`), attribute-only CSS chains (`[class*="..."]`), positional CSS (`nth-child`/`nth-of-type`), and brittle id selectors (`#some-id` when no semantic alternative).
  - Detect **financial/billing/tax scope** using three deterministic signals (any → scope enabled): (1) task tag/brief contains any of `['financial','billing','tax','payment','pricing','ledger','invoice','calculation']` (case-insensitive); (2) any `touchedFiles` path matches `/(billing|tax|invoice|payment|ledger|pricing|checkout|currency|discount|vat|payroll)/i`; (3) test diff contains `expect(...)` referencing `/[$€£¥]|total|subtotal|tax|vat|invoice|balance/i`.
  - For scoped tasks, **fail-closed** if the test diff contains zero deterministic `expect(...).to...` assertions (relying only on `agent.assert(...)`), throwing `GraywolfAppError('RELAY_DETERMINISTIC_LINTER_FAILED')`.
- **Rationale**: Encodes ADR-075's Anti-Self-Grading rule with deterministic, evidence-based scope detection so probabilistic LLM assertions cannot silently grade financial/calculation code.
- **Alternatives Considered**:
  - Tree-sitter Playwright AST parsing: Rejected — overly heavy and brittle for generated diff content.
  - Heuristic regex-only without multi-signal scope detection: Rejected — produces both false positives and silent misses on edge cases.

---

## Decision 2 — Local-Only Hybrid Intent Runtime via LiteLLM (Task 13.1, ADR-075)

- **Decision**:
  - Implement `src/orchestrator/e2e/intent-runtime.ts` exporting `IntentRuntime` with four methods (`agent.act`, `agent.assert`, `agent.waitFor`, `agent.extract`).
  - Each method accepts structured `(intent: string, pageRef?, previousObservation?)` and forces **all** model invocations through `LiteLLMClient.complete({ alias: persona, persona: 'intent-runner' })` — never `child_process`/`fetch(external)`.
  - Wrap every browser-observation return value in `wrapUntrustedBrowserObservation(snapshot, { source: 'intent-runtime' })` (re-exported from `src/orchestrator/tiers/implementer.ts`) per ADR-038.
- **Rationale**: Guarantees ADR-027 data residency compliance and the ADR-077 prompt-injection safeguard in the agent's browser-observation path.
- **Alternatives Considered**:
  - Vision model on every observation: Rejected per ADR-024 — kernel OOM on ≤8 GB hosts and excessive token spend.

---

## Decision 3 — Zero-Token Deterministic Cache-Replay Lifecycle with SHA-256 Step Keys (Task 13.2, ADR-075)

- **Decision**:
  - Implement `src/orchestrator/e2e/cache-replay.ts` exporting `E2eCacheReplayEngine` with `replayOrExecuteStep({ taskId, intent, action, pageUrl, currentAriaSnapshot })`, `recordStepSuccess(...)`, `fallbackToLiveResolution(...)`, and `promoteTaskCacheOnMerge({ taskId })`.
  - Cache directory structure:
    - `.agents/tasks/<TASK_ID>/e2e-cache/` — task-scoped (writable during interactive iteration; never reads baseline).
    - `.agents/cache/e2e/` — project baseline (read-only in CI; write-on-merge).
  - Compute deterministic `stepKey` as `SHA-256(normalizedRoute + '|' + action + '|' + sanitize(intent))`. `normalizedRoute` is the parameterized URL pattern (`/users/:id`, `/billing/invoices/:invoiceId`), normalized via the project's AST Symbol Graph (`find_route_normalized`) so dynamic IDs do not collide.
  - Cache hit: replay deterministic step with `tokensUsed: 0`, `mode: 'cached'`, returning the previously resolved `(locator, value)`.
  - Cache miss / DOM drift: catch `PlaywrightError`, log `e2e.cache.miss` event, fall back to live `IntentRuntime` turn, and **only** write to `.agents/tasks/<TASK_ID>/e2e-cache/`.
  - Promotion: on task `MERGED`, atomically copy verified `.agents/tasks/<TASK_ID>/e2e-cache/` → `.agents/cache/e2e/` (using rsync-style copy then fsync the parent directory).
- **Rationale**: Maximizes cache hit rate (parameterized routes avoid dynamic ID churn), enforces CI cache read-only invariant, and aligns with the 5-phase Brief ➔ Plan ➔ Implement ➔ Cache ➔ Review pipeline.
- **Alternatives Considered**:
  - URL-pattern keying with full query strings: Rejected — high collision rate, lower hit ratio on benign back-button navigation.
  - Cache promotion on every successful step (not just `MERGED`): Rejected — violates the CI read-only invariant and produces copy-on-write fan-out.

---

## Decision 4 — Visual Review Packets with `pixelmatch` 0.1% Mismatch Ceiling & Dynamic Masking (Task 13.3, ADR-077)

- **Decision**:
  - Implement `src/orchestrator/e2e/visual-packet.ts` exporting `buildVisualReviewPacket({ taskId, beforeRun, afterRun }): VisualReviewPacket`.
  - For each UI page captured during the E2E run, compute:
    - **Masked screenshot diff** via `pixelmatch(beforePng, afterPng, diffPng, width, height, { threshold: 0.1 })`, with dynamic masking selectors `[data-testid*="timestamp"]`, `[data-dynamic]`, `[data-avatar]`, and `[data-animated]` excluded from the diff via per-region alpha=0 masks.
    - **Pixel-diff ratio** = `diffPixels / totalPixels`; classify `isVisualRegression` ⇔ `diffPixels / totalPixels > 0.001` (0.1% ceiling).
  - Capture **HTML reports** (`<page>.html`), **console error logs** (`console.log.warn|error` events from Playwright `page.on('console')`), and **WebM video trace metadata** (`videoRefPath`, `durationMs`, `frameCount`).
  - Stamp each artifact with `cached | live` provenance from the most recent `replayOrExecuteStep` call so Reviewers can distinguish replayed from live-explored flows.
- **Rationale**: Aligns with ADR-077 deterministic pixel-diff thresholding and dynamic masking; preserves visual regression evidence for the 60-Second Executive Review Packet.
- **Alternatives Considered**:
  - Perceptual diffing (SSIM): Rejected — out of scope for Phase 13 spike; deterministic `pixelmatch` is adequate.
  - Vision model Auto-graded regression: Rejected per ADR-075 — vision models must not be allowed to grade visual regressions on financial pages.

---

## Decision 5 — Bounded `e2e explore` Smoke Gate with "No Repro, No Bug" Attribution Rule (Task 13.3, ADR-076)

- **Decision**:
  - Implement `src/orchestrator/e2e/explore-smoke.ts` exporting `runExploreSmokeGate({ taskId, briefGoal, touchedFiles, changePatch })` that runs **only** for tasks tagged `ui`, `api-surface`, or `mandatory-e2e`.
  - Hard caps: `maxTurns = 6`, `timeoutMs = 180_000`, `spendLimitUSD = 0.50`; emit `browser-test` events (action, AXTree node, HTTP status, console errors, screenshot path, severity) to `EvidenceLedger` (`.agent_evidence.db`).
  - On each `P0` or `P1` finding, run **"No Repro, No Bug" attribution** (`evaluateNoReproAttribution`):
    - Demand a `qa-repro-<issue>` minimal failing test be created and executed.
    - Compute `reproFailureAttribution`: intersection of `reproTestFailure.stackTrace` ∪ `reproTestFailure.failedRoute` with `changesPatch.touchedFiles`.
    - **Strike attribution rules**:
      - `reproFailedAsExpected === true && attributionIntersectsPatch === true` → `'CONFIRMED'` → counts as a strike (`countsAsStrike: true`).
      - Otherwise → `'PRE_EXISTING_OR_UNCONFIRMED'` → downgraded to `P2` advisory, `countsAsStrike: false`, logged to `.agent_evidence.db` as `severity: 'P2', preExistingOrUnconfirmed: true`.
  - The aggregate `'No Repro, No Bug'` verdict is appended to `.agents/tasks/<TASK_ID>/review/explore-report.md`.
- **Rationale**: Guarantees that exploratory P0/P1 findings cannot arbitrarily burn strikes against Dev-Level-3, while allowing genuine dynamic runtime regressions to surface as evidence-bound strikes.
- **Alternatives Considered**:
  - Free-form LLM judge deciding strike attribution: Rejected — ADR-056 already established deterministic evidence ledger as the source of truth.
  - Auto-merge on `e2e explore` ≥ 1 finding: Rejected — contradicts ADR-079's mandatory-human gate for blast-radius escape and protected branches.

---

## Decision 6 — Parallel Bug Bash Sprint with PageRank/Risk-Sorted Fan-Out (Task 13.4, ADR-078)

- **Decision**:
  - Implement `src/orchestrator/delivery/bug-bash.ts` exporting `planBugBashSprint({ areas, personas, hardwareProfile })` and `confirmBugBashFinding({ findingId, reproTest })`.
  - Fan-out rules:
    - **Standard / Enterprise Profile (`maxExplorers: 8`)**: schedule up to `8` `qa-explore-<area>` subtasks in parallel through the `qa-explore` fleet lane.
    - **Constrained Profile (Topology A, `maxExplorers: 1`)**: schedule exactly `1` explorer task.
    - **Aggregate budget ceiling** = `effectiveExplorers * $0.50` (e.g., `8 × $0.50 = $4.00`). If `areas.length * personas.length > effectiveExplorers`, prioritize combinations by **PageRank/risk centrality** using `pagerank.ts` (Phase 9) and **scope criticality** (files matching `/(auth|checkout|payment|billing|tax)/i`), then move excess to `deferredExplorers` and proceed top-N.
  - State machine per `finding`: `CANDIDATE` (initial) → `CONFIRMED` (when `qa-repro-<issue>` fails for the reported reason) → spawn `fix:<issue>` backlog task with `blockedBy: ['qa-repro-<issue>']`; otherwise `UNCONFIRMED` (P2 advisory).
  - Enforce the budget governor: real-time aggregate spend tracking across child tasks via `getSpendLedger().getAggregatedSpend(findingBatchId)`; if cap reached, deterministically cancel remaining children and emit `bug_bash.budget_cap_hit` event.
- **Rationale**: Aligns with ADR-078 fan-out semantics, ADR-024 hardware profile caps, and ADR-056 evidence ledger integrity (every confirmed finding carries a `browser-test` artifact).
- **Alternatives Considered**:
  - Linear sequential exploration per area: Rejected — cannot cover `areas × personas` matrix within 3-min budget ceiling per ADR-076.
  - Uncapped explorer fan-out: Rejected — risks unbounded spend on Topology A constrained hardware (ADR-024).

---

## Cross-Cutting Notes

- All four task modules integrate with **existing artifacts from prior phases** without re-implementation:
  - **Phase 8**: `LiteLLMClient` (`src/orchestrator/gateway/litellm-client.ts`) — used by `IntentRuntime` for zero external SaaS routing.
  - **Phase 9**: `wrapUntrustedBrowserObservation` (`src/orchestrator/tiers/implementer.ts`) — wraps `IntentRuntime` outputs in ADR-038 `<untrusted_browser_observation>` tags; `pagerank.ts` (Phase 9) — used for `BugBashSprint` priority ranking.
  - **Phase 10**: `EvidenceLedger` (`src/orchestrator/guards/evidence-ledger.ts`) — records `browser-test` events; `CleanCodeGuard` / `TestGuard` rejection codes (`RELAY_DETERMINISTIC_LINTER_FAILED`) are reused by `AuthoringGuard`.
  - **Phase 11**: `review-packet.ts` 7-section PR packet — `VisualReviewPacket` flows into Section 6 ("Visual Proof Artifacts") with `cached | live` provenance.
  - **Phase 12**: `src/dashboard/src/components/cockpit/tabs/BrowserTab.tsx` — already integrates Topological A Live HMR iframe, which will display the bounded explore smoke runs in Topology A.

- **Hard prohibitions preserved**:
  - ADR-027: zero `@tester-army/cli` external dependency, zero SaaS cloud sync.
  - ADR-075 Anti-Self-Grading: financial/billing scope cannot rely solely on `agent.assert`.
  - ADR-076 Budget: explore smoke ≤6 turns, ≤180s, ≤$0.50.
  - ADR-078 "No Repro, No Bug": P0/P1 strike only on `changes.patch`-attributable failing repro tests.
