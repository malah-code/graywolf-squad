# Interface Contracts: End-to-End Browser QA Engine (`@playwright/test`) & Parallel Bug Bash Sprint (Phase 13)

**Feature**: `015-e2e-playwright-and-bug-bash`  
**Date**: 2026-10-25

---

## 1. E2E Authoring Guard (`src/orchestrator/e2e/authoring-guard.ts`)

```ts
export function evaluateE2eAuthoringGuard(input: {
  diffPatch: string;                                  // Unified diff or source chunks
  touchedFiles: string[];
  briefMarkdown?: string;
  taskTags?: string[];
}): E2eAuthoringGuardResult;

export function evaluateFinancialScope(input: {
  touchedFiles: string[];
  briefMarkdown?: string;
  taskTags?: string[];
}): { isFinancialScope: boolean; matchedSignals: string[] };

export function enforceNoLlmSelfGrading(guardResult: E2eAuthoringGuardResult): void;
// Throws GraywolfAppError('RELAY_DETERMINISTIC_LINTER_FAILED') when
// isFinancialOrCalculationScope && !hasDeterministicExpect.
```

---

## 2. Hybrid Intent Runtime (`src/orchestrator/e2e/intent-runtime.ts`)

```ts
export interface IntentRuntimeOptions {
  litellmAlias?: 'agent-e2e-intent' | 'agent-e2e-explore';
  allowedOriginRegex?: string;        // e.g., '^http://localhost:\\d+$'
  snapshotTokenCap?: number;          // default: 2000
}

export class IntentRuntime {
  constructor(litellm: LiteLLMClient, options?: IntentRuntimeOptions);

  agentAct(call: { taskId: string; intent: string; pageUrl: string; ariaSnapshot: string }): Promise<IntentStepResult>;
  agentAssert(call: { taskId: string; intent: string; pageUrl: string; ariaSnapshot: string }): Promise<IntentStepResult>;
  agentWaitFor(call: { taskId: string; intent: string; pageUrl: string; ariaSnapshot: string }): Promise<IntentStepResult>;
  agentExtract(call: { taskId: string; intent: string; pageUrl: string; ariaSnapshot: string }): Promise<IntentStepResult>;

  // All outputs run through wrapUntrustedBrowserObservation() before returning/serializing.
}
```

---

## 3. Cache-Replay Engine (`src/orchestrator/e2e/cache-replay.ts`)

```ts
export interface E2eCacheReplayEngineOptions {
  projectCacheDir?: string;            // default: '.agents/cache/e2e'
  taskCacheDirResolver?: (taskId: string) => string;
}

export class E2eCacheReplayEngine {
  constructor(options?: E2eCacheReplayEngineOptions);

  // Compute the deterministic stepKey for a unit of intent.
  computeStepKey(input: { route: string; action: string; intent: string }): string;

  // Try to read the cached entry first. If cached, replay with 0 LLM tokens.
  // On DOM drift (resolvedLocator/AriaSnapshotHash mismatch), fall back to live IntentRuntime.
  replayOrExecuteStep(input: {
    taskId: string;
    intent: string;
    action: 'click' | 'fill' | 'navigate' | 'select' | 'extract' | 'assert';
    pageUrl: string;
    ariaSnapshot: string;
    intentRuntime: IntentRuntime;
  }): Promise<ReplayOrExecuteResult>;

  // Persist a verified cached intent step (task-scoped).
  recordStepSuccess(input: { taskId: string; step: CachedIntentStep }): Promise<void>;

  // Atomically promote verified task cache into the project baseline.
  promoteTaskCacheOnMerge(input: { taskId: string; mergeCommitSha: string }): Promise<void>;
}
```

---

## 4. Visual Review Packet (`src/orchestrator/e2e/visual-packet.ts`)

```ts
export function buildVisualReviewPacket(input: {
  taskId: string;
  beforeRun: VisualPageArtifacts[];
  afterRun: VisualPageArtifacts[];
  cacheProvenance: { pageRoute: string; provenance: 'cached' | 'live' }[];
  consoleErrors: ConsoleErrorSummary[];
  webmTraces: WebmTraceSummary[];
  pixelDiffThreshold?: number;         // default: 0.001 (0.1%)
  pixelMatchThreshold?: number;        // default: 0.1
  dynamicMaskSelectors?: string[];     // default: DYNAMIC_MASK_SELECTORS
}): VisualReviewPacket;

export interface VisualPageArtifacts {
  route: string;
  beforePng: string;                   // path
  afterPng: string;                    // path
  screenshotTakenAt: string;
}
```

---

## 5. Explore Smoke Gate (`src/orchestrator/e2e/explore-smoke.ts`)

```ts
export interface ExploreSmokeOptions {
  maxTurns?: number;                   // default: 6
  timeoutMs?: number;                  // default: 180_000
  spendLimitUSD?: number;              // default: 0.50
  decisionGate?: DecisionGateService;  // optional, for sub-150ms classification
}

export async function runExploreSmokeGate(input: {
  taskId: string;
  briefGoal: string;
  touchedFiles: string[];
  changePatch: string;
  intentRuntime: IntentRuntime;
  options?: ExploreSmokeOptions;
}): Promise<ExploreSmokeOutcome>;

export function evaluateNoReproAttribution(input: {
  finding: ExploreFinding;
  changePatch: string;
  touchedFiles: string[];
  reproFailure: { stackTrace: string; failedRoute: string };
}): NoReproAttributionResult;
```

---

## 6. Bug Bash Sprint (`src/orchestrator/delivery/bug-bash.ts`)

```ts
export type HardwareProfile = 'constrained' | 'standard' | 'enterprise';

export function planBugBashSprint(input: {
  parentTaskId: string;
  areas: string[];
  personas: string[];
  profile: HardwareProfile;
  pageRankByArea?: Record<string, number>;       // from pagerank.ts
  riskSignalsByArea?: Record<string, number>;    // e.g., security/financial scope weight
}): BugBashSprintPlan;

export async function confirmBugBashFinding(input: {
  parentTaskId: string;
  finding: ExploreFinding;
  reproTestTaskId: string | null;
  reproFailedAsExpected: boolean;
  attribution: NoReproAttributionResult;
  createBacklogTask: (fixTitle: string, opts: { blockedBy: string[]; severity: 'P0' | 'P1' }) => Promise<{ taskId: string }>;
}): Promise<BugBashIssueResolution>;

export interface SpendLedgerLike {
  getAggregatedSpend(batchId: string): Promise<number>;
}

export function attachBugBashBudgetGovernor(input: {
  parentTaskId: string;
  capUsd: number;
  spendLedger: SpendLedgerLike;
  onCapHit: (event: BudgetGovernorEvent) => Promise<void>;
}): { stop: () => void };                            // returns handle to halt the watcher
```
