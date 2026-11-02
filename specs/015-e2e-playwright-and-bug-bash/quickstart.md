# Quickstart & Verification Guide: End-to-End Browser QA Engine (`@playwright/test`) & Parallel Bug Bash Sprint (Phase 13)

**Feature**: `015-e2e-playwright-and-bug-bash`  
**Date**: 2026-10-25

---

## Prerequisites

- Phase 8 `LiteLLMClient` (`src/orchestrator/gateway/litellm-client.ts`)
- Phase 9 `wrapUntrustedBrowserObservation` (`src/orchestrator/tiers/implementer.ts`) and `pagerank.ts` (`src/orchestrator/recon/pagerank.ts`)
- Phase 10 `EvidenceLedger` (`src/orchestrator/guards/evidence-ledger.ts`)
- Phase 11 `review-packet.ts` for Section 6 ("Visual Proof Artifacts") overlay
- Phase 12 `src/dashboard/src/components/cockpit/tabs/BrowserTab.tsx`
- Adapter-only `tester-army/e2e` integration (no `@tester-army/cli`)

---

## Verification Scenarios

### 1. Authoring Guard (Task 13.1)

```bash
pnpm vitest run tests/unit/e2e-authoring-guard.test.ts
```

**Expected Outcome**:
- Synthetic diffs containing raw XPath (`xpath=//div[3]`) or brittle CSS `:nth-child` chains are rejected with `hasViolations: true`.
- Diffs that touch a file matching `/(billing|tax|invoice|payment)/i` and rely **solely** on `agent.assert(...)` are rejected with `MISSING_DETERMINISTIC_EXPECT` and throw `GraywolfAppError('RELAY_DETERMINISTIC_LINTER_FAILED')`.
- Diffs that use only semantic locators (`getByRole('button', { name: 'Save' })`) pass cleanly.

### 2. Cache-Replay Lifecycle & Merge Promotion (Task 13.2)

```bash
pnpm vitest run tests/unit/e2e-cache-replay.test.ts
```

**Expected Outcome**:
- First-run cache miss triggers a live `IntentRuntime` step and writes `.agents/tasks/<TASK_ID>/e2e-cache/<stepKey>.json`.
- Subsequent run on identical route/action/intent replays with `tokensUsed: 0`, `mode: 'cached'`.
- Aria snapshot hash mismatch triggers DOM-drift fallback that writes only to `.agents/tasks/<TASK_ID>/e2e-cache/`, never touching `.agents/cache/e2e/`.
- Calling `promoteTaskCacheOnMerge({ taskId, mergeCommitSha })` on a `MERGED` task copies verified entries into `.agents/cache/e2e/<routeHash>/<stepKey>.json`.

### 3. Visual Review Packet & Explore Smoke Gate (Task 13.3)

```bash
pnpm vitest run tests/unit/e2e-explore.test.ts
```

**Expected Outcome**:
- `buildVisualReviewPacket` returns `pages[].isVisualRegression: true` only when `pixelDiffRatio > 0.001`.
- Dynamic regions (`[data-testid*="timestamp"]`, `[data-dynamic]`, `[data-avatar]`, `[data-animated]`) are masked out of the diff area.
- Each page carries a `provenance` flag of `'cached'` or `'live'` reflecting the dominant replay mode.
- `runExploreSmokeGate` halts exploration cleanly at `maxTurns = 6`, `elapsedMs ≤ 180_000`, `spendUsd ≤ $0.50`.
- A P0/P1 finding whose repro test does not fail, or whose failure stack trace does not intersect `changesPatch.touchedFiles`, is downgraded to `effectiveSeverity: 'P2'` with `strikeAdded: false`.

### 4. Bug Bash Sprint Confirmation (Task 13.4)

```bash
pnpm vitest run tests/unit/bug-bash.test.ts
```

**Expected Outcome**:
- `planBugBashSprint({ areas: 6, personas: 2, profile: 'standard' })` caps the parallel `qa-explore` children at `maxExplorers: 8` and budget cap at `$4.00`.
- `planBugBashSprint({ areas: 6, personas: 2, profile: 'constrained' })` caps the children at `maxExplorers: 1` and budget cap at `$0.50`; excess combinations recorded in `deferredExplorers`.
- When the `qa-repro-<issue>` task fails for the reported reason, `confirmBugBashFinding` resolves the issue with `status: 'CONFIRMED'` and spawns a `fix:<issue>` backlog task with `blockedBy: ['qa-repro-<issue>']`.
- When the repro passes, the issue is downgraded to `status: 'UNCONFIRMED'` and `effectiveSeverity: 'P2'` with no backlog task created.
- The budget governor emits `BudgetGovernorEvent` and cancels remaining explorers when `capUsd` is reached.

### 5. Full Typecheck, Lint & Repository Test Suite

```bash
pnpm typecheck && pnpm lint && pnpm test
```
