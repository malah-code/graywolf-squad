# Data Model: End-to-End Browser QA Engine (`@playwright/test`) & Parallel Bug Bash Sprint (Phase 13)

**Feature**: `015-e2e-playwright-and-bug-bash`  
**Date**: 2026-10-25  
**Canonical Schema Reference**: `specs/001-multi-agent-platform/data-model.md` §1.3 (`verification.md`), §1.5 (`project.config.json`), `src/orchestrator/guards/evidence-ledger.ts`, `src/orchestrator/services/clarification.ts`

---

## 1. E2E Authoring Guard Domain (`authoring-guard.ts`)

### 1.1 `E2eAuthoringGuardResult`
```ts
export type E2eAuthoringGuardViolation =
  | { type: 'BRITTLE_SELECTOR'; detail: string }                       // e.g., 'xpath=//div[3]'
  | { type: 'MISSING_DETERMINISTIC_EXPECT'; scope: 'financial'|'billing'|'tax'|'payment'|'pricing'|'calculation' }
  | { type: 'NON_SEMANTIC_GET_BY_TEXT'; reason: string }
  | { type: 'POSITIVISTIC_AGENT_ASSERT_ONLY'; tool: string };

export interface E2eAuthoringGuardResult {
  passed: boolean;                       // True iff no violations
  isFinancialOrCalculationScope: boolean; // Detected scope flag
  hasDeterministicExpect: boolean;       // Found any expect(...).to... or toHaveText/toContain/...
  violations: E2eAuthoringGuardViolation[];
  evaluatedAt: string;                   // ISO timestamp
}
```

### 1.2 Scope Detection Regex Sets
```ts
export const FINANCIAL_SCOPE_TAGS = ['financial', 'billing', 'tax', 'payment', 'pricing', 'ledger', 'invoice', 'calculation'];

export const FINANCIAL_FILE_REGEX = /(billing|tax|invoice|payment|ledger|pricing|checkout|currency|discount|vat|payroll)/i;

export const CURRENCY_EXPECT_REGEX = /[$€£¥]|total|subtotal|tax|vat|invoice|balance/i;
```

---

## 2. Hybrid Intent Runtime Domain (`intent-runtime.ts`)

### 2.1 `IntentStepKind` & `IntentStepResult`
```ts
export type IntentStepKind = 'act' | 'assert' | 'waitFor' | 'extract';

export interface IntentRuntimeCall {
  taskId: string;
  kind: IntentStepKind;
  intent: string;
  pageUrl: string;
  locale?: 'ar' | 'en' | 'fr' | 'tr';
}

export interface IntentStepResult {
  taskId: string;
  kind: IntentStepKind;
  resolvedLocator: string | null;     // semantic locator (getByRole/getByTestId/...)
  resolvedValue: string | null;       // for assert/extract
  ariaSnapshotHash: string;           // sha256 of current page snapshot
  tokensUsed: number;                  // always >= 1 (LiteLLM call)
  finished: boolean;
}
```

### 2.2 Origin Restriction & Untrusted Tagging
- All `page.navigate` calls validated against allowlist (preview origin only, e.g., `http://localhost:<preview_port>`).
- Every observation wrapped via `wrapUntrustedBrowserObservation(snapshot, { source: 'intent-runtime', taskId })`.

---

## 3. Cache-Replay Domain (`cache-replay.ts`)

### 3.1 `CachedIntentStep`
```ts
export interface CachedIntentStep {
  stepKey: string;                    // sha256(normalizedRoute + '|' + action + '|' + sanitize(intent))
  normalizedRoute: string;             // e.g., '/billing/invoices/:invoiceId'
  action: 'click' | 'fill' | 'navigate' | 'select' | 'extract' | 'assert';
  intent: string;
  resolvedLocator: string;             // semantic Playwright locator resolved at write time
  resolvedValue?: string;
  ariaSnapshotHash: string;            // sha256 of page snapshot at resolution time
  createdAt: string;
  taskId: string;                      // task scope at write time
}
```

### 3.2 Cache Directory Layout
- `.agents/tasks/<TASK_ID>/e2e-cache/<stepKey>.json` — task-scoped (writable in interactive iterations).
- `.agents/cache/e2e/<sorted-route-hash>/<stepKey>.json` — project baseline (read-only in CI).

### 3.3 `replayOrExecuteStep` Result & Fallback Rules
```ts
export type CacheReplayMode = 'cached' | 'live';

export interface ReplayOrExecuteResult {
  stepKey: string;
  mode: CacheReplayMode;
  tokensUsed: number;                  // 0 if 'cached', >0 if 'live'
  fallbackTriggered?: boolean;
  cacheMissReason?: 'NO_CACHE_FILE' | 'DOM_DRIFT' | 'ROUTE_NOT_FOUND';
  resolvedLocator: string | null;
  resolvedValue?: string | null;
  durationMs: number;
}
```

---

## 4. Visual Review Packet Domain (`visual-packet.ts`)

### 4.1 `VisualReviewPacket`
```ts
export interface VisualReviewPacket {
  taskId: string;
  generatedAt: string;
  cachedFlowCount: number;
  liveFlowCount: number;
  pages: VisualPageReview[];
  consoleErrors: ConsoleErrorSummary[];
  webmTraces: WebmTraceSummary[];
}

export interface VisualPageReview {
  pageRoute: string;                   // normalized
  beforePngPath: string;
  afterPngPath: string;
  pixelDiffRatio: number;              // 0..1; from pixelmatch
  isVisualRegression: boolean;         // pixelDiffRatio > 0.001
  maskedSelectors: string[];
  provenance: 'cached' | 'live';       // dominant source across steps on this page
  diffPngPath: string;
}

export interface ConsoleErrorSummary {
  pageRoute: string;
  errors: Array<{ message: string; count: number; severity: 'error' | 'warning' }>;
}

export interface WebmTraceSummary {
  videoPath: string;
  durationMs: number;
  frameCount: number;
  recordedAt: string;
}
```

### 4.2 Dynamic Masking Selectors
```ts
export const DYNAMIC_MASK_SELECTORS = [
  '[data-testid*="timestamp"]',
  '[data-dynamic]',
  '[data-avatar]',
  '[data-animated]',
];
```

---

## 5. Explore Smoke & "No Repro, No Bug" Domain (`explore-smoke.ts`)

### 5.1 `ExploreFinding`
```ts
export type ExploreFindingSeverity = 'P0' | 'P1' | 'P2';

export interface ExploreFinding {
  id: string;
  taskId: string;
  pageRoute: string;
  severity: ExploreFindingSeverity;
  expected: string;
  observed: string;
  reproSteps: string[];
  screenshotPath?: string;
  discoveredAtTurn: number;            // 1..6
  evidenceEventId: string;             // ties to EvidenceLedger browser-test entry
}
```

### 5.2 `NoReproAttributionResult`
```ts
export interface NoReproAttributionResult {
  findingId: string;
  status: 'CONFIRMED' | 'UNCONFIRMED';
  effectiveSeverity: ExploreFindingSeverity;                 // P2 if unattributed
  reproFailedAsExpected: boolean;
  attributionIntersectsPatch: boolean;                       // Does reproFailure intersect touchFiles?
  attributionOverlapFiles: string[];
  preExistingDefects: string[];                              // Findings downgraded due to non-intersecting failures
  strikeAdded: boolean;                                      // countsAsStrike === effectiveSeverity in 'P0'|'P1' && attribution === true
}
```

### 5.3 `runExploreSmokeGate` Envelope
```ts
export interface ExploreSmokeOutcome {
  taskId: string;
  startedAt: string;
  finishedAt: string;
  turnsUsed: number;
  spendUsd: number;                       // <= $0.50
  elapsedMs: number;                      // <= 180_000
  findings: ExploreFinding[];
  attributionResults: NoReproAttributionResult[];
  evidenceRecorded: boolean;              // browser-test entries exist
  budgetCapHit: boolean;                  // budget cap reached mid-run
}
```

---

## 6. Bug Bash Domain (`bug-bash.ts`)

### 6.1 `BugBashSprintPlan`
```ts
export type HardwareProfile = 'constrained' | 'standard' | 'enterprise';

export interface BugBashSprintPlan {
  parentTaskId: string;
  areas: string[];
  personas: string[];
  profile: HardwareProfile;
  maxExplorers: 1 | 8;
  effectiveExplorers: number;
  budgetCapUsd: number;
  explorerTasks: Array<{ explorerTaskId: string; area: string; persona: string; priority: number }>;
  deferredExplorers: Array<{ area: string; persona: string; reason: string }>;
  plannedAt: string;
}
```

### 6.2 `BugBashIssueResolution` (per finding)
```ts
export interface BugBashIssueResolution {
  findingId: string;
  status: 'CANDIDATE' | 'CONFIRMED' | 'UNCONFIRMED';
  effectiveSeverity: 'P0' | 'P1' | 'P2';
  reproTestTaskId: string | null;        // qa-repro-<issue> item
  reproFailedAsExpected: boolean;
  spawnedFixTask: { taskId: string; blockedBy: string[] } | null;
  resolvedAt: string;
}
```

### 6.3 Budget Governor Event
```ts
export interface BudgetGovernorEvent {
  event: 'budget.cap_hit';
  parentTaskId: string;
  aggregateSpendUsd: number;
  capUsd: number;
  cancelledRemaining: number;
  emittedAt: string;
}
```
