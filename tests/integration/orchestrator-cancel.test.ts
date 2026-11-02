import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  dispatchTaskIfReady,
  cancelTaskExecution,
  clearActiveExecutions,
  registerActiveExecution,
  ActiveTaskExecution,
} from '../../src/orchestrator/workers/orchestrator';
import { acquireTaskLock } from '../../src/orchestrator/runner/lock';
import { createTaskWorktree } from '../../src/orchestrator/runner/worktree';
import { GraywolfAppError } from '../../src/orchestrator/errors/taxonomy';
import { DagTaskNode } from '../../src/orchestrator/services/dag';
import { AdmissionController } from '../../src/orchestrator/runner/admission';

const execFileAsync = promisify(execFile);

describe('Orchestrator Worker & Panic Button Teardown Integration Tests (US4)', () => {
  let testRepoRoot: string;
  let testLocksDir: string;

  beforeEach(async () => {
    clearActiveExecutions();

    testRepoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'gw-orch-repo-'));
    testLocksDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gw-orch-locks-'));

    // Initialize temporary Git repository
    await execFileAsync('git', ['init', '-b', 'main'], { cwd: testRepoRoot });
    await execFileAsync('git', ['config', 'user.name', 'Graywolf Orchestrator'], {
      cwd: testRepoRoot,
    });
    await execFileAsync('git', ['config', 'user.email', 'orch@graywolf.ai'], {
      cwd: testRepoRoot,
    });

    const readmePath = path.join(testRepoRoot, 'README.md');
    await fs.writeFile(readmePath, '# Test Base Repo\n', 'utf8');
    await execFileAsync('git', ['add', 'README.md'], { cwd: testRepoRoot });
    await execFileAsync('git', ['commit', '-m', 'chore: initial commit'], { cwd: testRepoRoot });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    clearActiveExecutions();
    try {
      await fs.rm(testRepoRoot, { recursive: true, force: true });
    } catch {
      // Ignore
    }
    try {
      await fs.rm(testLocksDir, { recursive: true, force: true });
    } catch {
      // Ignore
    }
  });

  describe('Pre-flight Dispatch Gating (dispatchTaskIfReady)', () => {
    it('rejects dispatch if task is blocked by unmet dependencies', async () => {
      const task: DagTaskNode = {
        id: 'TASK-BLOCKED',
        status: 'QUEUED',
        blockedBy: ['TASK-BLOCKER-1'],
        writableScope: ['src/feature'],
      };

      const taskMap = new Map<string, DagTaskNode>([
        ['TASK-BLOCKED', task],
        [
          'TASK-BLOCKER-1',
          { id: 'TASK-BLOCKER-1', status: 'IN_PROGRESS', blockedBy: [], writableScope: ['src/dep'] },
        ],
      ]);

      await expect(
        dispatchTaskIfReady('TASK-BLOCKED', {
          getTaskById: () => task,
          getAllTasksMap: () => taskMap,
        })
      ).rejects.toThrowError(GraywolfAppError);
    });

    it('rejects dispatch if candidate task overlaps writable scope with active task', async () => {
      const task: DagTaskNode = {
        id: 'TASK-OVERLAP',
        status: 'QUEUED',
        blockedBy: [],
        writableScope: ['src/services/**'],
      };

      const activeTask: DagTaskNode = {
        id: 'TASK-ACTIVE',
        status: 'IN_PROGRESS',
        blockedBy: [],
        writableScope: ['src/services/auth.ts'],
      };

      await expect(
        dispatchTaskIfReady('TASK-OVERLAP', {
          getTaskById: () => task,
          getActiveTasks: () => [activeTask],
        })
      ).rejects.toThrowError(GraywolfAppError);

      try {
        await dispatchTaskIfReady('TASK-OVERLAP', {
          getTaskById: () => task,
          getActiveTasks: () => [activeTask],
        });
      } catch (err: unknown) {
        const appErr = err as GraywolfAppError;
        expect(appErr.code).toBe('TASK_BLOCKED_BY_DEPENDENCIES');
        expect(appErr.details?.overlappingTaskIds).toContain('TASK-ACTIVE');
      }
    });

    it('dispatches task when ready, acquiring lock and starting sandbox container', async () => {
      const taskId = 'TASK-DISPATCH-OK';
      const task: DagTaskNode = {
        id: taskId,
        status: 'QUEUED',
        blockedBy: [],
        writableScope: ['src/new-feature/**'],
      };

      const startSandboxSpy = vi.fn().mockResolvedValue({ containerId: 'gw-cont-123' });
      const mockRunnerProvider = {
        startSandbox: startSandboxSpy,
        teardownSandbox: vi.fn(),
        waitForExit: vi.fn(),
      };

      let updatedStatus = '';
      const updateStatusSpy = vi.fn((_id: string, st: string) => {
        updatedStatus = st;
      });

      const execution = await dispatchTaskIfReady(taskId, {
        repoRoot: testRepoRoot,
        locksDir: testLocksDir,
        runnerProvider: mockRunnerProvider,
        getTaskById: () => task,
        getActiveTasks: () => [],
        updateTaskStatus: updateStatusSpy,
      });

      expect(execution.taskId).toBe(taskId);
      expect(execution.containerId).toBe('gw-cont-123');
      expect(execution.worktreePath).toBeDefined();
      expect(execution.lock).toBeDefined();
      expect(updatedStatus).toBe('IN_PROGRESS');

      // Release lock for cleanup
      await execution.lock?.release();
    });

    it('resolves sandbox DB tier via 4-level hierarchy and rolls back lock/DB if startSandbox fails', async () => {
      const taskId = 'TASK-ROLLBACK';
      const task: DagTaskNode = {
        id: taskId,
        status: 'QUEUED',
        blockedBy: [],
        writableScope: ['migrations/001_init.sql'],
      };

      const queries: string[] = [];
      const queryExecutor = vi.fn(async (sql: string) => {
        queries.push(sql);
        return {};
      });

      const failingRunnerProvider = {
        startSandbox: vi.fn().mockRejectedValue(new Error('Docker daemon error')),
        teardownSandbox: vi.fn(),
        waitForExit: vi.fn(),
      };

      await expect(
        dispatchTaskIfReady(taskId, {
          locksDir: testLocksDir,
          baseDatabaseUrl: 'postgresql://postgres:secret@localhost:5432/graywolf_core',
          queryExecutor,
          runnerProvider: failingRunnerProvider,
          getTaskById: () => task,
          getActiveTasks: () => [],
        })
      ).rejects.toThrow('Docker daemon error');

      // Verified Tier 2 DB was provisioned (due to migrations/001_init.sql) AND rolled back on failure
      expect(queries[0]).toContain('CREATE DATABASE "task_rollback" TEMPLATE "graywolf_template"');
      expect(queries.some((q) => q.includes('DROP DATABASE IF EXISTS "task_rollback"'))).toBe(true);

      // Verified lock was released during rollback so re-acquiring succeeds immediately
      const reacquired = await acquireTaskLock(taskId, { locksDir: testLocksDir });
      await reacquired.release();
    });

    it('enforces AdmissionController admission limits during dispatchTaskIfReady', async () => {
      const admissionController = new AdmissionController({
        profile: 'constrained',
        totalMemBytes: 8 * 1024 * 1024 * 1024,
        cpuCount: 4,
        maxConcurrentContainers: 1,
        containerMemoryBytes: 2 * 1024 * 1024 * 1024,
        maxTokenBudget: 3.5,
        playwrightFlags: [],
      });

      const task1: DagTaskNode = {
        id: 'TASK-ADM-1',
        status: 'QUEUED',
        blockedBy: [],
        writableScope: ['src/adm1/**'],
        explicitDbTier: 'tier-0-mock',
      };

      const task2: DagTaskNode = {
        id: 'TASK-ADM-2',
        status: 'QUEUED',
        blockedBy: [],
        writableScope: ['src/adm2/**'],
        explicitDbTier: 'tier-0-mock',
      };

      // Dispatch task 1 successfully
      await dispatchTaskIfReady('TASK-ADM-1', {
        repoRoot: testRepoRoot,
        locksDir: testLocksDir,
        admissionController,
        getTaskById: () => task1,
      });

      expect(admissionController.getActiveCount()).toBe(1);

      // Dispatch task 2 rejected because constrained maxConcurrentContainers = 1
      await expect(
        dispatchTaskIfReady('TASK-ADM-2', {
          repoRoot: testRepoRoot,
          locksDir: testLocksDir,
          admissionController,
          getTaskById: () => task2,
        })
      ).rejects.toThrowError(GraywolfAppError);

      // Cancel task 1 releases ticket
      await cancelTaskExecution('TASK-ADM-1', 'Cancelled by test', {
        admissionController,
        getTaskById: () => ({ ...task1, status: 'IN_PROGRESS' }),
      });

      expect(admissionController.getActiveCount()).toBe(0);
    });
  });

  describe('Full 7-Step Panic Button Teardown (cancelTaskExecution)', () => {
    it('executes all 7 teardown steps on an active running task', async () => {
      const taskId = 'TASK-PANIC';

      // 1. Setup real Git worktree and lock
      const worktreeInfo = await createTaskWorktree({
        repoRoot: testRepoRoot,
        taskId,
      });

      // Introduce dirty files in worktree
      const dirtyFile = path.join(worktreeInfo.worktreePath, 'dirty.txt');
      await fs.writeFile(dirtyFile, 'Dirty uncommitted code\n', 'utf8');

      const lock = await acquireTaskLock(taskId, {
        locksDir: testLocksDir,
      });

      const execution: ActiveTaskExecution = {
        taskId,
        containerId: 'gw-panic-cont',
        worktreePath: worktreeInfo.worktreePath,
        dbTier: 'tier-1-shared-db',
        lock,
      };

      registerActiveExecution(execution);

      // Spies for external systems
      const arpCancelSpy = vi.fn().mockResolvedValue(true);
      const teardownSandboxSpy = vi.fn().mockResolvedValue(undefined);
      const abortCallsSpy = vi.fn().mockResolvedValue(true);
      const queryExecutorSpy = vi.fn().mockResolvedValue({});
      let finalStatus = '';

      const teardownResult = await cancelTaskExecution(taskId, 'User pressed Panic Button in Cockpit', {
        runnerProvider: {
          startSandbox: vi.fn(),
          teardownSandbox: teardownSandboxSpy,
          waitForExit: vi.fn(),
        },
        arpGateway: {
          sendTaskCancel: arpCancelSpy,
        },
        llmGateway: {
          abortCallsForTask: abortCallsSpy,
        },
        queryExecutor: queryExecutorSpy,
        getTaskById: () => ({
          id: taskId,
          status: 'IN_PROGRESS',
          blockedBy: [],
          writableScope: [],
        }),
        updateTaskStatus: (_id, st) => {
          finalStatus = st;
        },
      });

      // Assert Step 1: ARP cancel sent
      expect(teardownResult.arpCancelSent).toBe(true);
      expect(arpCancelSpy).toHaveBeenCalledWith(taskId, 'User pressed Panic Button in Cockpit');

      // Assert Step 2: Sandbox container stopped/torn down
      expect(teardownResult.sandboxTornDown).toBe(true);
      expect(teardownSandboxSpy).toHaveBeenCalledWith(taskId);

      // Assert Step 3: LiteLLM aborted
      expect(teardownResult.llmAborted).toBe(true);
      expect(abortCallsSpy).toHaveBeenCalledWith(taskId);

      // Assert Step 4: Sandbox DB dropped
      expect(teardownResult.sandboxDbDropped).toBe(true);
      expect(queryExecutorSpy).toHaveBeenCalledWith(expect.stringContaining('DROP SCHEMA IF EXISTS'));

      // Assert Step 5: Worktree restored (dirty files removed)
      expect(teardownResult.worktreeRestored).toBe(true);
      await expect(fs.stat(dirtyFile)).rejects.toThrow();

      // Assert Step 6: Lock released
      expect(teardownResult.lockReleased).toBe(true);

      // Assert Step 7: Final state CANCELLED
      expect(teardownResult.status).toBe('CANCELLED');
      expect(finalStatus).toBe('CANCELLED');
    });
  });
});
