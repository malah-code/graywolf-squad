import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as lockfile from 'proper-lockfile';
import { GraywolfAppError } from '../errors/taxonomy';
import { withTenantContext } from '../db';

const execFileAsync = promisify(execFile);

export interface AcquireLockOptions {
  locksDir?: string; // defaults to path.resolve(process.cwd(), '.agents/locks')
  workspaceId?: string;
  orgId?: string;
  containerId?: string | null;
  heartbeatIntervalMs?: number; // defaults to 15000 (15s)
  staleTimeoutMs?: number; // defaults to 30000 (30s)
  syncToDb?: boolean;
}

export interface TaskLockMetadata {
  taskId: string;
  workspaceId?: string;
  pid: number;
  containerId?: string | null;
  acquiredAt: number;
  lastHeartbeat: number;
  staleTimeoutMs: number;
}

export interface AcquiredTaskLock {
  taskId: string;
  lockDir: string;
  metadata: TaskLockMetadata;
  release(): Promise<void>;
}

export interface PruneResourcesOptions {
  locksDir?: string;
  repoRoot?: string;
  staleThresholdMs?: number; // defaults to 60000 (60s)
  workspaceId?: string;
  orgId?: string;
  syncToDb?: boolean;
  teardownDanglingContainers?: () => Promise<string[]>;
}

export interface PruneResourcesResult {
  reclaimedLocks: string[];
  prunedWorktrees: boolean;
  removedContainers: string[];
}

/**
 * Acquires an atomic directory lock for the task using proper-lockfile,
 * emits periodic heartbeats, and optionally synchronizes state to PostgreSQL.
 */
export async function acquireTaskLock(
  taskId: string,
  options?: AcquireLockOptions
): Promise<AcquiredTaskLock> {
  if (!/^[A-Za-z0-9._-]+$/.test(taskId) || taskId === '.' || taskId === '..') {
    throw new GraywolfAppError(
      'ACI_VALIDATION_FAILED',
      `Invalid taskId for lock directory: "${taskId}"`,
      { taskId }
    );
  }
  const locksBase = options?.locksDir
    ? path.resolve(options.locksDir)
    : path.resolve(process.cwd(), '.agents/locks');

  await fs.mkdir(locksBase, { recursive: true });

  const lockDir = path.join(locksBase, `${taskId}.lock`);
  await fs.mkdir(lockDir, { recursive: true });

  const staleTimeoutMs = options?.staleTimeoutMs ?? 30000;
  const heartbeatIntervalMs = options?.heartbeatIntervalMs ?? 15000;

  let releaseLockfile: () => Promise<void>;
  try {
    releaseLockfile = await lockfile.lock(lockDir, {
      stale: staleTimeoutMs,
      retries: 0,
      realpath: false,
    });
  } catch {
    throw new GraywolfAppError(
      'TASK_LOCK_CONTENTION',
      `Task ${taskId} is currently locked by another runner process`,
      { taskId, lockDir }
    );
  }

  const now = Date.now();
  const metadata: TaskLockMetadata = {
    taskId,
    workspaceId: options?.workspaceId,
    pid: process.pid,
    containerId: options?.containerId ?? null,
    acquiredAt: now,
    lastHeartbeat: now,
    staleTimeoutMs,
  };

  const metadataPath = path.join(lockDir, 'metadata.json');
  await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2), 'utf8');

  // Synchronize initial lock acquisition to PostgreSQL task_locks table if enabled
  if (options?.syncToDb && options.workspaceId) {
    await withTenantContext(
      { workspaceId: options.workspaceId, orgId: options.orgId },
      async (client) => {
        await client.query(
          `INSERT INTO task_locks (task_id, workspace_id, pid, container_id, acquired_at, last_heartbeat, stale_timeout_ms)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (task_id) DO UPDATE SET
             workspace_id = EXCLUDED.workspace_id,
             pid = EXCLUDED.pid,
             container_id = EXCLUDED.container_id,
             acquired_at = EXCLUDED.acquired_at,
             last_heartbeat = EXCLUDED.last_heartbeat,
             stale_timeout_ms = EXCLUDED.stale_timeout_ms`,
          [
            taskId,
            options.workspaceId,
            metadata.pid,
            metadata.containerId,
            metadata.acquiredAt,
            metadata.lastHeartbeat,
            metadata.staleTimeoutMs,
          ]
        );
      }
    );
  }

  // Heartbeat loop
  const heartbeatTimer = setInterval(() => {
    metadata.lastHeartbeat = Date.now();
    void (async () => {
      try {
        await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2), 'utf8');
        if (options?.syncToDb && options.workspaceId) {
          await withTenantContext(
            { workspaceId: options.workspaceId, orgId: options.orgId },
            async (client) => {
              await client.query(
                `UPDATE task_locks SET last_heartbeat = $1 WHERE task_id = $2`,
                [metadata.lastHeartbeat, taskId]
              );
            }
          );
        }
      } catch {
        // Heartbeat failure logged or ignored if shutting down
      }
    })();
  }, heartbeatIntervalMs);
  heartbeatTimer.unref();

  let released = false;

  const release = async (): Promise<void> => {
    if (released) return;
    released = true;

    clearInterval(heartbeatTimer);

    if (options?.syncToDb && options.workspaceId) {
      try {
        await withTenantContext(
          { workspaceId: options.workspaceId, orgId: options.orgId },
          async (client) => {
            await client.query(`DELETE FROM task_locks WHERE task_id = $1`, [taskId]);
          }
        );
      } catch {
        // Ignore DB error during release
      }
    }

    try {
      await releaseLockfile();
    } catch {
      // Ignore unlock error
    }

    try {
      await fs.rm(lockDir, { recursive: true, force: true });
    } catch {
      // Ignore removal error
    }
  };

  return {
    taskId,
    lockDir,
    metadata,
    release,
  };
}

/**
 * Recovers stale locks, prunes abandoned worktrees, and cleans dangling runner containers on boot.
 */
export async function pruneStaleResourcesOnBoot(
  options?: PruneResourcesOptions
): Promise<PruneResourcesResult> {
  const locksBase = options?.locksDir
    ? path.resolve(options.locksDir)
    : path.resolve(process.cwd(), '.agents/locks');

  const staleThresholdMs = options?.staleThresholdMs ?? 60000;
  const now = Date.now();
  const reclaimedLocks: string[] = [];

  try {
    const entries = await fs.readdir(locksBase, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() && entry.name.endsWith('.lock')) {
        const lockDir = path.join(locksBase, entry.name);
        const taskId = entry.name.slice(0, -5); // strip .lock
        const metadataPath = path.join(lockDir, 'metadata.json');

        let isStale = false;
        let metaWorkspaceId: string | undefined;
        try {
          const raw = await fs.readFile(metadataPath, 'utf8');
          const meta = JSON.parse(raw) as TaskLockMetadata;
          metaWorkspaceId = meta.workspaceId;
          if (now - meta.lastHeartbeat > staleThresholdMs) {
            isStale = true;
          }
        } catch {
          // If metadata is unreadable or missing, check folder age
          try {
            const stat = await fs.stat(lockDir);
            if (now - stat.mtimeMs > staleThresholdMs) {
              isStale = true;
            }
          } catch {
            // Directory disappeared
          }
        }

        if (isStale) {
          try {
            await lockfile.unlock(lockDir, { realpath: false });
          } catch {
            // Already unlocked or non-standard
          }

          try {
            await fs.rm(lockDir, { recursive: true, force: true });
            reclaimedLocks.push(taskId);
          } catch {
            // Failed to remove directory
          }

            const pruneWorkspaceId = metaWorkspaceId ?? options?.workspaceId;
            if (options?.syncToDb && pruneWorkspaceId) {
              try {
                await withTenantContext(
                  { workspaceId: pruneWorkspaceId, orgId: options.orgId },
                  async (client) => {
                    await client.query(`DELETE FROM task_locks WHERE task_id = $1`, [taskId]);
                  }
                );
              } catch {
                // Ignore DB cleanup error
              }
            }
        }
      }
    }
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      // Ignore if locks directory doesn't exist
    }
  }

  let prunedWorktrees = false;
  if (options?.repoRoot) {
    try {
      await execFileAsync('git', ['worktree', 'prune'], { cwd: options.repoRoot });
      prunedWorktrees = true;
    } catch {
      prunedWorktrees = false;
    }
  }

  let removedContainers: string[] = [];
  if (options?.teardownDanglingContainers) {
    try {
      removedContainers = await options.teardownDanglingContainers();
    } catch {
      removedContainers = [];
    }
  }

  return {
    reclaimedLocks,
    prunedWorktrees,
    removedContainers,
  };
}
