import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  E2eCacheReplayEngine,
  normalizeRoutePattern,
} from '../../src/orchestrator/e2e/cache-replay';
import { GraywolfAppError } from '../../src/orchestrator/errors/taxonomy';
import type { IntentRuntime, IntentStepResult } from '../../src/orchestrator/e2e/intent-runtime';

describe('Deterministic Cache-Replay Engine (Task 13.2, ADR-075)', () => {
  let tempBaseDir: string;
  let projectCacheDir: string;
  let taskCacheDir: string;

  beforeEach(async () => {
    tempBaseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'graywolf-e2e-cache-test-'));
    projectCacheDir = path.join(tempBaseDir, 'project-cache');
    taskCacheDir = path.join(tempBaseDir, 'task-cache');
  });

  afterEach(async () => {
    await fs.rm(tempBaseDir, { recursive: true, force: true });
  });

  describe('Route Normalization & StepKey Computation', () => {
    it('normalizes dynamic UUIDs and numeric IDs to prevent route churn', () => {
      const route1 = '/orgs/123e4567-e89b-12d3-a456-426614174000/invoices/987';
      const route2 = '/orgs/999e4567-e89b-12d3-a456-426614174999/invoices/123';

      const norm1 = normalizeRoutePattern(route1);
      const norm2 = normalizeRoutePattern(route2);

      expect(norm1).toBe('/orgs/:id/invoices/:id');
      expect(norm2).toBe('/orgs/:id/invoices/:id');
      expect(norm1).toBe(norm2);
    });

    it('produces deterministic SHA-256 stepKey regardless of spacing and casing', () => {
      const engine = new E2eCacheReplayEngine({ projectCacheDir });

      const key1 = engine.computeStepKey({
        route: '/billing/checkout',
        action: 'click',
        intent: 'Click the Save Button',
      });

      const key2 = engine.computeStepKey({
        route: '/billing/checkout/',
        action: 'CLICK ',
        intent: 'click the   save button',
      });

      expect(key1).toBe(key2);
      expect(key1).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  describe('Replay Lifecycle: Miss ➔ Hit ➔ Drift Fallback', () => {
    it('handles cache miss by calling IntentRuntime live and persisting to task cache', async () => {
      const engine = new E2eCacheReplayEngine({
        projectCacheDir,
        taskCacheDirResolver: () => taskCacheDir,
      });

      const mockLiveResult: IntentStepResult = {
        taskId: 'TASK-101',
        kind: 'act',
        resolvedLocator: "getByRole('button', { name: 'Confirm' })",
        resolvedValue: null,
        ariaSnapshotHash: 'dummy_hash_1',
        tokensUsed: 125,
        finished: true,
        wrappedObservation: '...',
      };

      const mockIntentRuntime = {
        agentAct: vi.fn().mockResolvedValue(mockLiveResult),
      } as unknown as IntentRuntime;

      const result = await engine.replayOrExecuteStep({
        taskId: 'TASK-101',
        intent: 'Confirm order',
        action: 'click',
        pageUrl: 'http://localhost:3000/checkout',
        ariaSnapshot: 'snapshot_content_v1',
        intentRuntime: mockIntentRuntime,
      });

      expect(result.mode).toBe('live');
      expect(result.tokensUsed).toBe(125);
      expect(result.cacheMissReason).toBe('NO_CACHE_FILE');
      expect(result.resolvedLocator).toBe("getByRole('button', { name: 'Confirm' })");
      expect(mockIntentRuntime.agentAct).toHaveBeenCalledTimes(1);

      // Verify task cache file was written
      const cachedFile = path.join(taskCacheDir, `${result.stepKey}.json`);
      const fileData = await fs.readFile(cachedFile, 'utf8');
      const parsed = JSON.parse(fileData);
      expect(parsed.stepKey).toBe(result.stepKey);
      expect(parsed.resolvedLocator).toBe("getByRole('button', { name: 'Confirm' })");
    });

    it('replays with 0 LLM tokens on cache hit (zero-token replay)', async () => {
      const engine = new E2eCacheReplayEngine({
        projectCacheDir,
        taskCacheDirResolver: () => taskCacheDir,
      });

      const ariaSnapshot = 'exact_identical_dom_snapshot';
      const mockIntentRuntime = {
        agentAct: vi.fn(),
      } as unknown as IntentRuntime;

      // 1. Prime the cache
      const stepKey = engine.computeStepKey({
        route: '/checkout',
        action: 'click',
        intent: 'Confirm order',
      });

      await engine.recordStepSuccess({
        taskId: 'TASK-101',
        step: {
          stepKey,
          normalizedRoute: '/checkout',
          action: 'click',
          intent: 'Confirm order',
          resolvedLocator: "getByRole('button', { name: 'Confirm' })",
          ariaSnapshotHash: engine.computeStepKey({ route: '', action: '', intent: ariaSnapshot }), // hash matching logic
          createdAt: new Date().toISOString(),
          taskId: 'TASK-101',
        },
      });

      // Update the hash to match the crypto hash of ariaSnapshot
      const crypto = await import('node:crypto');
      const exactHash = crypto.createHash('sha256').update(ariaSnapshot, 'utf8').digest('hex');

      await engine.recordStepSuccess({
        taskId: 'TASK-101',
        step: {
          stepKey,
          normalizedRoute: '/checkout',
          action: 'click',
          intent: 'Confirm order',
          resolvedLocator: "getByRole('button', { name: 'Confirm' })",
          ariaSnapshotHash: exactHash,
          createdAt: new Date().toISOString(),
          taskId: 'TASK-101',
        },
      });

      // 2. Replay step
      const replayResult = await engine.replayOrExecuteStep({
        taskId: 'TASK-101',
        intent: 'Confirm order',
        action: 'click',
        pageUrl: 'http://localhost:3000/checkout',
        ariaSnapshot,
        intentRuntime: mockIntentRuntime,
      });

      expect(replayResult.mode).toBe('cached');
      expect(replayResult.tokensUsed).toBe(0);
      expect(replayResult.resolvedLocator).toBe("getByRole('button', { name: 'Confirm' })");
      expect(mockIntentRuntime.agentAct).not.toHaveBeenCalled();
    });

    it('falls back to live turn on DOM drift without mutating project cache', async () => {
      const engine = new E2eCacheReplayEngine({
        projectCacheDir,
        taskCacheDirResolver: () => taskCacheDir,
        isCiRun: true,
      });

      // Prime cache with old DOM snapshot hash
      const stepKey = engine.computeStepKey({
        route: '/checkout',
        action: 'click',
        intent: 'Confirm order',
      });

      await engine.recordStepSuccess({
        taskId: 'TASK-101',
        step: {
          stepKey,
          normalizedRoute: '/checkout',
          action: 'click',
          intent: 'Confirm order',
          resolvedLocator: "getByRole('button', { name: 'Old Confirm' })",
          ariaSnapshotHash: 'stale_hash_from_old_ui',
          createdAt: new Date().toISOString(),
          taskId: 'TASK-101',
        },
      });

      const updatedLiveResult: IntentStepResult = {
        taskId: 'TASK-101',
        kind: 'act',
        resolvedLocator: "getByRole('button', { name: 'New Healed Button' })",
        resolvedValue: null,
        ariaSnapshotHash: 'drifted_new_snapshot_hash',
        tokensUsed: 140,
        finished: true,
        wrappedObservation: '...',
      };

      const mockIntentRuntime = {
        agentAct: vi.fn().mockResolvedValue(updatedLiveResult),
      } as unknown as IntentRuntime;

      const result = await engine.replayOrExecuteStep({
        taskId: 'TASK-101',
        intent: 'Confirm order',
        action: 'click',
        pageUrl: 'http://localhost:3000/checkout',
        ariaSnapshot: 'new_drifted_dom_structure',
        intentRuntime: mockIntentRuntime,
      });

      expect(result.mode).toBe('live');
      expect(result.fallbackTriggered).toBe(true);
      expect(result.cacheMissReason).toBe('DOM_DRIFT');
      expect(result.resolvedLocator).toBe("getByRole('button', { name: 'New Healed Button' })");
      expect(result.tokensUsed).toBe(140);
      expect(mockIntentRuntime.agentAct).toHaveBeenCalledTimes(1);

      // Verify task cache was updated with the new locator
      const taskCacheFile = path.join(taskCacheDir, `${stepKey}.json`);
      const fileData = JSON.parse(await fs.readFile(taskCacheFile, 'utf8'));
      expect(fileData.resolvedLocator).toBe("getByRole('button', { name: 'New Healed Button' })");

      // Verify project cache directory was NOT touched/created in CI run
      let projectCacheExists = false;
      try {
        await fs.access(projectCacheDir);
        projectCacheExists = true;
      } catch {
        projectCacheExists = false;
      }
      expect(projectCacheExists).toBe(false);
    });
  });

  describe('Merge Promotion (promoteTaskCacheOnMerge)', () => {
    it('promotes task cache files to project cache on task MERGED', async () => {
      const engine = new E2eCacheReplayEngine({
        projectCacheDir,
        taskCacheDirResolver: () => taskCacheDir,
      });

      // Write two verified task cache files
      await engine.recordStepSuccess({
        taskId: 'TASK-101',
        step: {
          stepKey: 'step_alpha_123',
          normalizedRoute: '/dashboard',
          action: 'click',
          intent: 'Open settings',
          resolvedLocator: "getByRole('link', { name: 'Settings' })",
          ariaSnapshotHash: 'hash_a',
          createdAt: new Date().toISOString(),
          taskId: 'TASK-101',
        },
      });

      await engine.recordStepSuccess({
        taskId: 'TASK-101',
        step: {
          stepKey: 'step_beta_456',
          normalizedRoute: '/settings',
          action: 'fill',
          intent: 'Enter username',
          resolvedLocator: "getByLabel('Username')",
          ariaSnapshotHash: 'hash_b',
          createdAt: new Date().toISOString(),
          taskId: 'TASK-101',
        },
      });

      const { promotedCount } = await engine.promoteTaskCacheOnMerge({
        taskId: 'TASK-101',
        mergeCommitSha: 'commit_sha_abcdef',
      });

      expect(promotedCount).toBe(2);

      // Verify files now exist in project cache
      const projFile1 = await fs.readFile(path.join(projectCacheDir, 'step_alpha_123.json'), 'utf8');
      const projFile2 = await fs.readFile(path.join(projectCacheDir, 'step_beta_456.json'), 'utf8');

      const parsed1 = JSON.parse(projFile1);
      const parsed2 = JSON.parse(projFile2);

      expect(parsed1.resolvedLocator).toBe("getByRole('link', { name: 'Settings' })");
      expect(parsed2.resolvedLocator).toBe("getByLabel('Username')");

      // ISSUE-2 fix verification: mergeCommitSha must be embedded in promoted files
      expect(parsed1.promotedByCommit).toBe('commit_sha_abcdef');
      expect(parsed2.promotedByCommit).toBe('commit_sha_abcdef');
    });

    it('throws RELAY_BLAST_RADIUS_VIOLATION when called during a CI run (ISSUE-1 fix)', async () => {
      const engine = new E2eCacheReplayEngine({
        projectCacheDir,
        taskCacheDirResolver: () => taskCacheDir,
        isCiRun: true, // simulate CI environment
      });

      let thrownError: unknown = null;
      try {
        await engine.promoteTaskCacheOnMerge({ taskId: 'TASK-CI-999' });
      } catch (err) {
        thrownError = err;
      }

      expect(thrownError).toBeInstanceOf(GraywolfAppError);
      expect((thrownError as GraywolfAppError).code).toBe('RELAY_BLAST_RADIUS_VIOLATION');
      expect((thrownError as GraywolfAppError).message).toContain('read-only in CI');
    });
  });
});
