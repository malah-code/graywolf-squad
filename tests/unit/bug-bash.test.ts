import { describe, it, expect, vi } from 'vitest';
import {
  planBugBashSprint,
  confirmBugBashFinding,
  attachBugBashBudgetGovernor,
  type BudgetGovernorEvent,
  type SpendLedgerLike,
} from '../../src/orchestrator/delivery/bug-bash';
import type { ExploreFinding, NoReproAttributionResult } from '../../src/orchestrator/e2e/explore-smoke';

describe('Parallel Bug Bash Sprint Engine (Task 13.4, ADR-078)', () => {
  describe('Profile Caps & PageRank/Risk Scheduling', () => {
    const areas = ['checkout', 'auth', 'settings', 'about'];
    const personas = ['first-time buyer', 'returning customer', 'guest'];

    it('enforces Standard Profile cap: maxExplorers = 8, cap = $4.00, excess in deferredExplorers', () => {
      // 4 areas * 3 personas = 12 combinations
      const plan = planBugBashSprint({
        parentTaskId: 'TASK-BB-1',
        areas,
        personas,
        profile: 'standard',
        pageRankByArea: {
          checkout: 5.2,
          auth: 4.8,
          settings: 1.2,
          about: 0.5,
        },
      });

      expect(plan.maxExplorers).toBe(8);
      expect(plan.effectiveExplorers).toBe(8);
      expect(plan.budgetCapUsd).toBe(4.00); // 8 * 0.50
      expect(plan.explorerTasks).toHaveLength(8);
      expect(plan.deferredExplorers).toHaveLength(4); // 12 - 8 = 4

      // Critical areas (checkout and auth) should be in the top active explorer tasks
      const activeAreas = plan.explorerTasks.map((t) => t.area);
      expect(activeAreas).toContain('checkout');
      expect(activeAreas).toContain('auth');

      // Deferred explorers should contain the lower-priority combinations
      expect(plan.deferredExplorers[0].reason).toContain('Exceeded maxExplorers cap (8)');
    });

    it('enforces Constrained Profile cap (Topology A): maxExplorers = 1, cap = $0.50', () => {
      const plan = planBugBashSprint({
        parentTaskId: 'TASK-BB-2',
        areas: ['checkout', 'auth'],
        personas: ['buyer', 'admin'],
        profile: 'constrained',
        pageRankByArea: {
          checkout: 8.0,
          auth: 2.0,
        },
      });

      expect(plan.maxExplorers).toBe(1);
      expect(plan.effectiveExplorers).toBe(1);
      expect(plan.budgetCapUsd).toBe(0.50);
      expect(plan.explorerTasks).toHaveLength(1);
      expect(plan.explorerTasks[0].area).toBe('checkout'); // highest risk/pagerank
      expect(plan.deferredExplorers).toHaveLength(3);
      expect(plan.deferredExplorers[0].reason).toContain('Exceeded maxExplorers cap (1)');
    });
  });

  describe('Confirmation Protocol ("No Repro, No Bug")', () => {
    const finding: ExploreFinding = {
      id: 'finding-101',
      taskId: 'qa-explore-checkout-buyer-1',
      pageRoute: '/checkout',
      severity: 'P0',
      expected: 'Discount code applied successfully',
      observed: 'Discount input disabled or missing',
      reproSteps: ['Navigate to /checkout', 'Observe discount input'],
      discoveredAtTurn: 2,
      evidenceEventId: 'ev-101',
    };

    it('promotes finding to CONFIRMED and spawns fix:<issue> backlog task when repro test fails as reported', async () => {
      const attribution: NoReproAttributionResult = {
        findingId: finding.id,
        status: 'CONFIRMED',
        effectiveSeverity: 'P0',
        reproFailedAsExpected: true,
        attributionIntersectsPatch: true,
        attributionOverlapFiles: ['src/modules/discount/calculator.ts'],
        preExistingDefects: [],
        strikeAdded: true,
      };

      const mockCreateBacklog = vi.fn().mockResolvedValue({
        taskId: 'TASK-FIX-901',
      });

      const resolution = await confirmBugBashFinding({
        parentTaskId: 'TASK-BB-1',
        finding,
        reproTestTaskId: 'qa-repro-discount-input',
        reproFailedAsExpected: true,
        attribution,
        createBacklogTask: mockCreateBacklog,
      });

      expect(resolution.status).toBe('CONFIRMED');
      expect(resolution.effectiveSeverity).toBe('P0');
      expect(resolution.spawnedFixTask).not.toBeNull();
      expect(resolution.spawnedFixTask?.taskId).toBe('TASK-FIX-901');
      expect(resolution.spawnedFixTask?.blockedBy).toEqual(['qa-repro-discount-input']);
      expect(mockCreateBacklog).toHaveBeenCalledWith(
        expect.stringContaining('fix:checkout-'),
        expect.objectContaining({
          blockedBy: ['qa-repro-discount-input'],
          severity: 'P0',
        })
      );
    });

    it('downgrades finding to UNCONFIRMED + P2 advisory when repro test does not fail', async () => {
      const attribution: NoReproAttributionResult = {
        findingId: finding.id,
        status: 'UNCONFIRMED',
        effectiveSeverity: 'P2',
        reproFailedAsExpected: false,
        attributionIntersectsPatch: false,
        attributionOverlapFiles: [],
        preExistingDefects: [finding.id],
        strikeAdded: false,
      };

      const mockCreateBacklog = vi.fn();

      const resolution = await confirmBugBashFinding({
        parentTaskId: 'TASK-BB-1',
        finding,
        reproTestTaskId: 'qa-repro-flaky-test',
        reproFailedAsExpected: false, // Repro test passed!
        attribution,
        createBacklogTask: mockCreateBacklog,
      });

      expect(resolution.status).toBe('UNCONFIRMED');
      expect(resolution.effectiveSeverity).toBe('P2');
      expect(resolution.spawnedFixTask).toBeNull();
      expect(mockCreateBacklog).not.toHaveBeenCalled();
    });

    it('downgrades finding to UNCONFIRMED + P2 when failure is in untouched code (pre-existing defect)', async () => {
      const attribution: NoReproAttributionResult = {
        findingId: finding.id,
        status: 'UNCONFIRMED',
        effectiveSeverity: 'P2',
        reproFailedAsExpected: true,
        attributionIntersectsPatch: false, // Stack trace did NOT intersect changes.patch
        attributionOverlapFiles: [],
        preExistingDefects: [finding.id],
        strikeAdded: false,
      };

      const mockCreateBacklog = vi.fn();

      const resolution = await confirmBugBashFinding({
        parentTaskId: 'TASK-BB-1',
        finding,
        reproTestTaskId: 'qa-repro-untouched-code',
        reproFailedAsExpected: true,
        attribution,
        createBacklogTask: mockCreateBacklog,
      });

      expect(resolution.status).toBe('UNCONFIRMED');
      expect(resolution.effectiveSeverity).toBe('P2');
      expect(resolution.spawnedFixTask).toBeNull();
      expect(mockCreateBacklog).not.toHaveBeenCalled();
    });
  });

  describe('Budget Governor Watcher', () => {
    it('triggers cap hit event when aggregate spend reaches sprint budget cap', async () => {
      let currentSpend = 3.50;
      const mockSpendLedger: SpendLedgerLike = {
        getAggregatedSpend: vi.fn().mockImplementation(async () => currentSpend),
      };

      let capHitEvent: BudgetGovernorEvent | null = null;
      const onCapHit = vi.fn().mockImplementation(async (event: BudgetGovernorEvent) => {
        capHitEvent = event;
      });

      const governor = attachBugBashBudgetGovernor({
        parentTaskId: 'TASK-BB-1',
        capUsd: 4.00,
        spendLedger: mockSpendLedger,
        onCapHit,
        pollIntervalMs: 50,
      });

      // 1. Initial check below cap ($3.50 < $4.00)
      const hit1 = await governor.checkSpendNow();
      expect(hit1).toBe(false);
      expect(onCapHit).not.toHaveBeenCalled();

      // 2. Spend increases to cap ($4.10 >= $4.00)
      currentSpend = 4.10;
      const hit2 = await governor.checkSpendNow();
      expect(hit2).toBe(true);
      expect(capHitEvent).not.toBeNull();
      const recordedEvent = capHitEvent as unknown as BudgetGovernorEvent;
      expect(recordedEvent.event).toBe('budget.cap_hit');
      expect(recordedEvent.capUsd).toBe(4.00);
      expect(recordedEvent.aggregateSpendUsd).toBe(4.10);

      governor.stop();
    });
  });
});
