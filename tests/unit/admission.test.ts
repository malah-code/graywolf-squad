import { describe, it, expect } from 'vitest';
import {
  profileHostHardware,
  calculateTaskAdmissionWeight,
  AdmissionController,
  HardwareProfile,
} from '../../src/orchestrator/runner/admission';

describe('Hardware Profiler & Admission Governor', () => {
  describe('profileHostHardware', () => {
    it('returns constrained profile for systems with <= 8GB of RAM', () => {
      const fourGb = 4 * 1024 * 1024 * 1024;
      const eightGb = 8 * 1024 * 1024 * 1024;

      const profile4G = profileHostHardware({ totalMemBytes: fourGb, cpuCount: 2 });
      expect(profile4G.profile).toBe('constrained');
      expect(profile4G.maxConcurrentContainers).toBe(1);
      expect(profile4G.containerMemoryBytes).toBe(2 * 1024 * 1024 * 1024);
      expect(profile4G.maxTokenBudget).toBe(3.5);
      expect(profile4G.playwrightFlags).toEqual(['--single-process', '--disable-gpu']);

      const profile8G = profileHostHardware({ totalMemBytes: eightGb, cpuCount: 4 });
      expect(profile8G.profile).toBe('constrained');
      expect(profile8G.maxConcurrentContainers).toBe(1);
    });

    it('returns standard profile for systems with > 8GB of RAM', () => {
      const sixteenGb = 16 * 1024 * 1024 * 1024;
      const thirtyTwoGb = 32 * 1024 * 1024 * 1024;

      const profile16G = profileHostHardware({ totalMemBytes: sixteenGb, cpuCount: 8 });
      expect(profile16G.profile).toBe('standard');
      expect(profile16G.maxConcurrentContainers).toBe(3);
      expect(profile16G.containerMemoryBytes).toBe(4 * 1024 * 1024 * 1024);
      expect(profile16G.maxTokenBudget).toBe(6.0);
      expect(profile16G.playwrightFlags).toEqual(['--disable-dev-shm-usage']);

      const profile32G = profileHostHardware({ totalMemBytes: thirtyTwoGb, cpuCount: 16 });
      expect(profile32G.profile).toBe('standard');
      expect(profile32G.maxConcurrentContainers).toBe(3);
    });
  });

  describe('calculateTaskAdmissionWeight', () => {
    it('calculates weights according to database tier and E2E requirements', () => {
      // Tier 0 Mock
      expect(calculateTaskAdmissionWeight({ dbTier: 'tier-0-mock' })).toBe(1.0);
      expect(calculateTaskAdmissionWeight({ dbTier: 'tier-0-mock', requiresBrowserE2E: true })).toBe(1.5);

      // Tier 1 Shared DB
      expect(calculateTaskAdmissionWeight({ dbTier: 'tier-1-shared-db' })).toBe(2.0);
      expect(calculateTaskAdmissionWeight({ dbTier: 'tier-1-shared-db', requiresBrowserE2E: true })).toBe(2.5);

      // Tier 2 Isolated DB
      expect(calculateTaskAdmissionWeight({ dbTier: 'tier-2-isolated-db' })).toBe(3.0);
      expect(calculateTaskAdmissionWeight({ dbTier: 'tier-2-isolated-db', requiresBrowserE2E: true })).toBe(3.5);
    });
  });

  describe('AdmissionController', () => {
    it('enforces single container limit on constrained hardware profile', () => {
      const constrained: HardwareProfile = {
        profile: 'constrained',
        totalMemBytes: 8 * 1024 * 1024 * 1024,
        cpuCount: 4,
        maxConcurrentContainers: 1,
        containerMemoryBytes: 2 * 1024 * 1024 * 1024,
        maxTokenBudget: 3.5,
        playwrightFlags: ['--single-process', '--disable-gpu'],
      };

      const controller = new AdmissionController(constrained);

      // Task 1 can be admitted
      const task1 = controller.tryAcquire({
        taskId: 'TASK-1',
        dbTier: 'tier-2-isolated-db',
        requiresBrowserE2E: true,
      });
      expect(task1.admitted).toBe(true);
      expect(task1.weight).toBe(3.5);
      expect(controller.getActiveCount()).toBe(1);
      expect(controller.getConsumedTokens()).toBe(3.5);

      // Idempotency check
      const task1Retry = controller.tryAcquire({
        taskId: 'TASK-1',
        dbTier: 'tier-2-isolated-db',
      });
      expect(task1Retry.admitted).toBe(true);

      // Task 2 must be rejected due to maxConcurrentContainers = 1
      const task2 = controller.tryAcquire({
        taskId: 'TASK-2',
        dbTier: 'tier-0-mock',
      });
      expect(task2.admitted).toBe(false);
      expect(task2.reason).toContain('Max concurrent containers reached');

      // Releasing task 1 permits task 2
      expect(controller.release('TASK-1')).toBe(true);
      expect(controller.getActiveCount()).toBe(0);
      expect(controller.getConsumedTokens()).toBe(0);

      const task2SecondAttempt = controller.tryAcquire({
        taskId: 'TASK-2',
        dbTier: 'tier-0-mock',
      });
      expect(task2SecondAttempt.admitted).toBe(true);
    });

    it('enforces token budget and concurrency limits on standard hardware profile', () => {
      const standard: HardwareProfile = {
        profile: 'standard',
        totalMemBytes: 16 * 1024 * 1024 * 1024,
        cpuCount: 8,
        maxConcurrentContainers: 3,
        containerMemoryBytes: 4 * 1024 * 1024 * 1024,
        maxTokenBudget: 6.0,
        playwrightFlags: ['--disable-dev-shm-usage'],
      };

      const controller = new AdmissionController(standard);

      // Acquire two Tier 2 tasks (3.0 + 3.0 = 6.0 tokens)
      const t1 = controller.tryAcquire({ taskId: 'T-1', dbTier: 'tier-2-isolated-db' });
      expect(t1.admitted).toBe(true);
      expect(t1.weight).toBe(3.0);

      const t2 = controller.tryAcquire({ taskId: 'T-2', dbTier: 'tier-2-isolated-db' });
      expect(t2.admitted).toBe(true);
      expect(t2.weight).toBe(3.0);

      expect(controller.getConsumedTokens()).toBe(6.0);
      expect(controller.getActiveCount()).toBe(2);

      // Third task should be rejected because 6.0 + 1.0 > 6.0 maxTokenBudget
      const t3 = controller.tryAcquire({ taskId: 'T-3', dbTier: 'tier-0-mock' });
      expect(t3.admitted).toBe(false);
      expect(t3.reason).toContain('Token budget exceeded');

      // Release one task -> frees 3.0 tokens
      controller.release('T-1');
      expect(controller.getConsumedTokens()).toBe(3.0);

      // Now T-3 can acquire
      const t3Retry = controller.tryAcquire({ taskId: 'T-3', dbTier: 'tier-0-mock' });
      expect(t3Retry.admitted).toBe(true);
      expect(controller.getConsumedTokens()).toBe(4.0);
      expect(controller.getActiveCount()).toBe(2);

      // Acquire T-4 (Tier 1 = 2.0 tokens -> 4.0 + 2.0 = 6.0 tokens, 3 active containers)
      const t4 = controller.tryAcquire({ taskId: 'T-4', dbTier: 'tier-1-shared-db' });
      expect(t4.admitted).toBe(true);
      expect(controller.getActiveCount()).toBe(3);

      // Max containers reached (3), even if budget had headroom
      const t5 = controller.tryAcquire({ taskId: 'T-5', dbTier: 'tier-0-mock' });
      expect(t5.admitted).toBe(false);
      expect(t5.reason).toContain('Max concurrent containers reached');
    });
  });
});
