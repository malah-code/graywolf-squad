import type { ExploreFinding, NoReproAttributionResult } from '../e2e/explore-smoke';

/**
 * Parallel Bug Bash Sprint Pattern (Task 13.4, ADR-078, FR-006).
 *
 * Rules:
 * 1. Fans out `qa-explore-<area>` tasks across `areas × personas`.
 * 2. Hardware profile caps: `maxExplorers: 8` (Standard/Enterprise) or `1` (Constrained).
 * 3. Priority scheduling: uses PageRank centrality + risk criticality (auth/billing).
 * 4. Aggregate budget governor: ceiling = `effectiveExplorers * $0.50`.
 * 5. "No Repro, No Bug": finding transitions to CONFIRMED + auto-creates fix:<issue> backlog task
 *    ONLY when qa-repro-<issue> fails as reported. Unconfirmed/unattributed findings downgrade to P2 advisory.
 */

export type HardwareProfile = 'constrained' | 'standard' | 'enterprise';

export interface BugBashSprintPlan {
  parentTaskId: string;
  areas: string[];
  personas: string[];
  profile: HardwareProfile;
  maxExplorers: 1 | 8;
  effectiveExplorers: number;
  budgetCapUsd: number;
  explorerTasks: Array<{
    explorerTaskId: string;
    area: string;
    persona: string;
    priority: number;
  }>;
  deferredExplorers: Array<{
    area: string;
    persona: string;
    reason: string;
  }>;
  plannedAt: string;
}

export interface BugBashIssueResolution {
  findingId: string;
  status: 'CANDIDATE' | 'CONFIRMED' | 'UNCONFIRMED';
  effectiveSeverity: 'P0' | 'P1' | 'P2';
  reproTestTaskId: string | null;
  reproFailedAsExpected: boolean;
  spawnedFixTask: { taskId: string; blockedBy: string[] } | null;
  resolvedAt: string;
}

export interface BudgetGovernorEvent {
  event: 'budget.cap_hit';
  parentTaskId: string;
  aggregateSpendUsd: number;
  capUsd: number;
  cancelledRemaining: number;
  emittedAt: string;
}

export interface SpendLedgerLike {
  getAggregatedSpend(parentTaskId: string): Promise<number>;
}

const CRITICAL_RISK_REGEX = /(auth|login|security|billing|tax|payment|checkout|pricing|cart)/i;

/**
 * Plans a Bug Bash sprint with profile-based explorer caps and PageRank/risk prioritization.
 */
export function planBugBashSprint(input: {
  parentTaskId: string;
  areas: string[];
  personas: string[];
  profile: HardwareProfile;
  pageRankByArea?: Record<string, number>;
  riskSignalsByArea?: Record<string, number>;
}): BugBashSprintPlan {
  const maxExplorers: 1 | 8 = input.profile === 'constrained' ? 1 : 8;

  const candidatePairs: Array<{
    area: string;
    persona: string;
    priority: number;
  }> = [];

  for (const area of input.areas) {
    const pageRank = input.pageRankByArea?.[area] ?? 1.0;
    const explicitRisk = input.riskSignalsByArea?.[area] ?? 0;
    const regexRisk = CRITICAL_RISK_REGEX.test(area) ? 10.0 : 0.0;
    const areaRiskScore = pageRank + explicitRisk + regexRisk;

    for (let pIdx = 0; pIdx < input.personas.length; pIdx++) {
      const persona = input.personas[pIdx];
      // Slightly prioritize first personas in list
      const personaWeight = Math.max(0.1, 1.0 - pIdx * 0.1);
      const compositePriority = Number((areaRiskScore * personaWeight).toFixed(4));

      candidatePairs.push({
        area,
        persona,
        priority: compositePriority,
      });
    }
  }

  // Sort descending by priority
  candidatePairs.sort((a, b) => b.priority - a.priority);

  const selectedPairs = candidatePairs.slice(0, maxExplorers);
  const deferredPairs = candidatePairs.slice(maxExplorers);

  const effectiveExplorers = selectedPairs.length;
  const budgetCapUsd = Number((effectiveExplorers * 0.50).toFixed(2));

  const explorerTasks = selectedPairs.map((pair, idx) => {
    const cleanArea = pair.area.toLowerCase().replace(/[^a-z0-9_-]+/g, '-');
    const cleanPersona = pair.persona.toLowerCase().replace(/[^a-z0-9_-]+/g, '-');
    return {
      explorerTaskId: `qa-explore-${cleanArea}-${cleanPersona}-${idx + 1}`,
      area: pair.area,
      persona: pair.persona,
      priority: pair.priority,
    };
  });

  const deferredExplorers = deferredPairs.map((pair) => ({
    area: pair.area,
    persona: pair.persona,
    reason: `Exceeded maxExplorers cap (${maxExplorers}) on ${input.profile} profile (priority: ${pair.priority})`,
  }));

  return {
    parentTaskId: input.parentTaskId,
    areas: input.areas,
    personas: input.personas,
    profile: input.profile,
    maxExplorers,
    effectiveExplorers,
    budgetCapUsd,
    explorerTasks,
    deferredExplorers,
    plannedAt: new Date().toISOString(),
  };
}

/**
 * Confirms an exploratory finding using the "No Repro, No Bug" protocol.
 * Only confirmed findings with passing repro tests trigger fix:<issue> backlog tasks.
 */
export async function confirmBugBashFinding(input: {
  parentTaskId: string;
  finding: ExploreFinding;
  reproTestTaskId: string | null;
  reproFailedAsExpected: boolean;
  attribution: NoReproAttributionResult;
  createBacklogTask: (
    fixTitle: string,
    opts: { blockedBy: string[]; severity: 'P0' | 'P1' }
  ) => Promise<{ taskId: string }>;
}): Promise<BugBashIssueResolution> {
  const isConfirmed =
    input.reproFailedAsExpected &&
    input.attribution.status === 'CONFIRMED' &&
    (input.attribution.effectiveSeverity === 'P0' || input.attribution.effectiveSeverity === 'P1');

  if (isConfirmed && input.reproTestTaskId) {
    const fixTitle = `fix:${input.finding.pageRoute.replace(/\W+/g, '-').replace(/^-|-$/g, '') || 'issue'}-${input.finding.observed.slice(0, 30).trim()}`;
    const spawnedFixTask = await input.createBacklogTask(fixTitle, {
      blockedBy: [input.reproTestTaskId],
      severity: input.attribution.effectiveSeverity as 'P0' | 'P1',
    });

    return {
      findingId: input.finding.id,
      status: 'CONFIRMED',
      effectiveSeverity: input.attribution.effectiveSeverity,
      reproTestTaskId: input.reproTestTaskId,
      reproFailedAsExpected: true,
      spawnedFixTask: {
        taskId: spawnedFixTask.taskId,
        blockedBy: [input.reproTestTaskId],
      },
      resolvedAt: new Date().toISOString(),
    };
  }

  // Not confirmed or failed repro test or pre-existing defect -> Downgrade to P2 advisory
  return {
    findingId: input.finding.id,
    status: 'UNCONFIRMED',
    effectiveSeverity: 'P2',
    reproTestTaskId: input.reproTestTaskId,
    reproFailedAsExpected: input.reproFailedAsExpected,
    spawnedFixTask: null,
    resolvedAt: new Date().toISOString(),
  };
}

/**
 * Attaches a real-time budget governor watcher that emits budget.cap_hit
 * when child explore tasks reach the aggregate sprint budget cap.
 */
export function attachBugBashBudgetGovernor(input: {
  parentTaskId: string;
  capUsd: number;
  spendLedger: SpendLedgerLike;
  onCapHit: (event: BudgetGovernorEvent) => Promise<void>;
  pollIntervalMs?: number;
}): { stop: () => void; checkSpendNow: () => Promise<boolean> } {
  let isStopped = false;
  let hasTriggered = false;

  const checkSpendNow = async (): Promise<boolean> => {
    if (hasTriggered || isStopped) return hasTriggered;

    const currentSpend = await input.spendLedger.getAggregatedSpend(input.parentTaskId);
    if (currentSpend >= input.capUsd) {
      hasTriggered = true;
      const event: BudgetGovernorEvent = {
        event: 'budget.cap_hit',
        parentTaskId: input.parentTaskId,
        aggregateSpendUsd: currentSpend,
        capUsd: input.capUsd,
        cancelledRemaining: 1,
        emittedAt: new Date().toISOString(),
      };
      await input.onCapHit(event);
      return true;
    }

    return false;
  };

  const interval = setInterval(async () => {
    if (isStopped) {
      clearInterval(interval);
      return;
    }
    try {
      const hit = await checkSpendNow();
      if (hit) {
        clearInterval(interval);
      }
    } catch {
      // Ignored in poll interval
    }
  }, input.pollIntervalMs ?? 500);

  return {
    stop: () => {
      isStopped = true;
      clearInterval(interval);
    },
    checkSpendNow,
  };
}
