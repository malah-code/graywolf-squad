import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  acquireTaskLock,
  pruneStaleResourcesOnBoot,
} from '../../src/orchestrator/runner/lock';
import { GraywolfAppError } from '../../src/orchestrator/errors/taxonomy';
import * as dbModule from '../../src/orchestrator/db/index';

describe('Atomic Directory Lock & Boot GC Unit Tests (US3)', () => {
  let tempLocksDir: string;

  beforeEach(async () => {
    tempLocksDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gw-locks-test-'));
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    try {
      await fs.rm(tempLocksDir, { recursive: true, force: true });
    } catch {
      // Ignore
    }
  });

  it('acquires directory lock and writes metadata.json with process details', async () => {
    const taskId = 'TASK-601';
    const lock = await acquireTaskLock(taskId, {
      locksDir: tempLocksDir,
      containerId: 'gw-task-test-cont',
      heartbeatIntervalMs: 50,
      staleTimeoutMs: 1000,
    });

    try {
      expect(lock.taskId).toBe(taskId);
      expect(lock.metadata.pid).toBe(process.pid);
      expect(lock.metadata.containerId).toBe('gw-task-test-cont');

      const metaPath = path.join(lock.lockDir, 'metadata.json');
      const raw = await fs.readFile(metaPath, 'utf8');
      const saved = JSON.parse(raw);
      expect(saved.taskId).toBe(taskId);
      expect(saved.pid).toBe(process.pid);
      expect(saved.containerId).toBe('gw-task-test-cont');
    } finally {
      await lock.release();
    }
  });

  it('emits heartbeat and updates lastHeartbeat timestamp in metadata.json', async () => {
    const taskId = 'TASK-602';
    const lock = await acquireTaskLock(taskId, {
      locksDir: tempLocksDir,
      heartbeatIntervalMs: 30,
      staleTimeoutMs: 1000,
    });

    const initialHeartbeat = lock.metadata.lastHeartbeat;

    // Wait for at least one heartbeat
    await new Promise((resolve) => setTimeout(resolve, 80));

    const metaPath = path.join(lock.lockDir, 'metadata.json');
    const raw = await fs.readFile(metaPath, 'utf8');
    const saved = JSON.parse(raw);

    expect(saved.lastHeartbeat).toBeGreaterThan(initialHeartbeat);

    await lock.release();
  });

  it('throws TASK_LOCK_CONTENTION (423) on concurrent lock attempt', async () => {
    const taskId = 'TASK-603';
    const lock1 = await acquireTaskLock(taskId, {
      locksDir: tempLocksDir,
      heartbeatIntervalMs: 100,
      staleTimeoutMs: 2000,
    });

    try {
      await expect(
        acquireTaskLock(taskId, {
          locksDir: tempLocksDir,
          heartbeatIntervalMs: 100,
          staleTimeoutMs: 2000,
        })
      ).rejects.toThrowError(GraywolfAppError);

      try {
        await acquireTaskLock(taskId, {
          locksDir: tempLocksDir,
          heartbeatIntervalMs: 100,
          staleTimeoutMs: 2000,
        });
      } catch (err: unknown) {
        const appErr = err as GraywolfAppError;
        expect(appErr.code).toBe('TASK_LOCK_CONTENTION');
        expect(appErr.httpStatus).toBe(423);
      }
    } finally {
      await lock1.release();
    }
  });

  it('pruneStaleResourcesOnBoot reclaims locks older than stale threshold and triggers cleanup', async () => {
    const staleTaskId = 'TASK-STALE-OLD';
    const staleLockDir = path.join(tempLocksDir, `${staleTaskId}.lock`);
    await fs.mkdir(staleLockDir, { recursive: true });

    // Seed stale metadata older than 60s
    const pastTimestamp = Date.now() - 75000;
    const staleMetadata = {
      taskId: staleTaskId,
      pid: 99999,
      containerId: 'dangling-container-123',
      acquiredAt: pastTimestamp,
      lastHeartbeat: pastTimestamp,
      staleTimeoutMs: 30000,
    };
    await fs.writeFile(
      path.join(staleLockDir, 'metadata.json'),
      JSON.stringify(staleMetadata),
      'utf8'
    );

    // Active lock that should NOT be pruned
    const activeTaskId = 'TASK-ACTIVE';
    const activeLock = await acquireTaskLock(activeTaskId, {
      locksDir: tempLocksDir,
      heartbeatIntervalMs: 50,
      staleTimeoutMs: 30000,
    });

    let teardownCalled = false;
    const teardownDanglingContainers = async () => {
      teardownCalled = true;
      return ['dangling-container-123'];
    };

    try {
      const pruneResult = await pruneStaleResourcesOnBoot({
        locksDir: tempLocksDir,
        staleThresholdMs: 60000,
        teardownDanglingContainers,
      });

      expect(pruneResult.reclaimedLocks).toContain(staleTaskId);
      expect(pruneResult.reclaimedLocks).not.toContain(activeTaskId);
      expect(teardownCalled).toBe(true);
      expect(pruneResult.removedContainers).toEqual(['dangling-container-123']);

      // Stale lock directory should have been removed
      await expect(fs.stat(staleLockDir)).rejects.toThrow();

      // Active lock directory still exists
      const activeStat = await fs.stat(activeLock.lockDir);
      expect(activeStat.isDirectory()).toBe(true);
    } finally {
      await activeLock.release();
    }
  });

  it('syncs lock and heartbeat to PostgreSQL task_locks table via withTenantContext when enabled', async () => {
    const taskId = 'TASK-605';
    const workspaceId = '00000000-0000-0000-0000-000000000010';
    const queryCalls: { sql: string; params?: unknown[] }[] = [];

    const mockClient = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        queryCalls.push({ sql, params });
        return { rowCount: 1, rows: [] };
      }),
    };

    vi.spyOn(dbModule, 'withTenantContext').mockImplementation(
      async (_ctx, fn) => fn(mockClient as never)
    );

    const lock = await acquireTaskLock(taskId, {
      locksDir: tempLocksDir,
      workspaceId,
      syncToDb: true,
      heartbeatIntervalMs: 30,
      staleTimeoutMs: 1000,
    });

    // Check insert query was recorded
    expect(queryCalls.some((c) => c.sql.includes('INSERT INTO task_locks'))).toBe(true);

    // Wait for at least one heartbeat
    await new Promise((resolve) => setTimeout(resolve, 60));

    expect(queryCalls.some((c) => c.sql.includes('UPDATE task_locks'))).toBe(true);

    await lock.release();

    expect(queryCalls.some((c) => c.sql.includes('DELETE FROM task_locks'))).toBe(true);
  });
});
