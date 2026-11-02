import crypto from 'node:crypto';
import { getValkeyStore, sha256Hex, ValkeyStoreLike } from '../auth/better-auth';

export interface AcquireManifestLockOptions {
  workspaceId: string;
  manifestPath: string;
  taskId: string;
  leaseTtlMs?: number;
  timeoutMs?: number;
  pollIntervalMs?: number;
  store?: ValkeyStoreLike;
}

export interface AcquireManifestLockResult {
  granted: boolean;
  lockKey: string;
  lockToken?: string;
  leaseTtlMs?: number;
  reason?: string;
}

export interface ReleaseManifestLockOptions {
  workspaceId: string;
  manifestPath: string;
  lockToken: string;
  store?: ValkeyStoreLike;
}

export function getManifestLockKey(workspaceId: string, manifestPath: string): string {
  const normalizedPath = manifestPath.trim().replace(/^\.\//, '');
  return `workspace:${workspaceId}:lock:manifest:${sha256Hex(normalizedPath)}`;
}

export async function acquireManifestLock(
  options: AcquireManifestLockOptions
): Promise<AcquireManifestLockResult> {
  const store = options.store ?? getValkeyStore();
  const lockKey = getManifestLockKey(options.workspaceId, options.manifestPath);
  const lockToken = crypto.randomUUID();
  const leaseTtlMs = options.leaseTtlMs ?? 60000;
  const ttlSeconds = Math.max(1, Math.ceil(leaseTtlMs / 1000));
  const timeoutMs = options.timeoutMs ?? 120000;
  const pollIntervalMs = options.pollIntervalMs ?? 50;

  const start = Date.now();

  while (Date.now() - start <= timeoutMs) {
    const existing = await store.get(lockKey);
    if (!existing) {
      await store.set(
        lockKey,
        JSON.stringify({ taskId: options.taskId, lockToken }),
        'EX',
        ttlSeconds
      );
      return {
        granted: true,
        lockKey,
        lockToken,
        leaseTtlMs,
      };
    }

    if (Date.now() - start + pollIntervalMs > timeoutMs) {
      break;
    }

    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  return {
    granted: false,
    lockKey,
    reason: `Manifest lock timeout after ${timeoutMs}ms for '${options.manifestPath}'`,
  };
}

export async function releaseManifestLock(
  options: ReleaseManifestLockOptions
): Promise<boolean> {
  const store = options.store ?? getValkeyStore();
  const lockKey = getManifestLockKey(options.workspaceId, options.manifestPath);

  const existing = await store.get(lockKey);
  if (!existing) {
    return false;
  }

  try {
    const parsed = JSON.parse(existing) as { lockToken?: string };
    if (parsed.lockToken === options.lockToken) {
      await store.del(lockKey);
      return true;
    }
    return false;
  } catch {
    return false;
  }
}
