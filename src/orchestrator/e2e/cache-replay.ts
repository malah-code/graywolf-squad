import * as crypto from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { GraywolfAppError } from '../errors/taxonomy';
import type { IntentRuntime, IntentStepResult } from './intent-runtime';

/**
 * Zero-Token Deterministic Cache-Replay Lifecycle & Merge Promotion (Task 13.2, ADR-075, FR-003).
 *
 * Rules:
 * 1. Serializes resolved agent.act steps to task-scoped cache (.agents/tasks/<TASK_ID>/e2e-cache/).
 * 2. Deterministic stepKey = SHA-256(normalizedRoute + '|' + action + '|' + sanitize(intent)).
 * 3. Cache hit replays with 0 LLM tokens (mode: 'cached', tokensUsed: 0).
 * 4. On DOM drift, falls back to live agent turn, writing ONLY to task-scoped cache.
 * 5. CI cache read-only invariant: .agents/cache/e2e/ is never mutated during CI runs.
 * 6. Promotes task cache to project baseline upon task MERGED.
 */

export type CacheReplayAction = 'act' | 'click' | 'fill' | 'navigate' | 'select' | 'extract' | 'assert';

export interface CachedIntentStep {
  stepKey: string;
  normalizedRoute: string;
  action: CacheReplayAction;
  intent: string;
  resolvedLocator: string;
  resolvedValue?: string;
  ariaSnapshotHash: string;
  createdAt: string;
  taskId: string;
}

export type CacheReplayMode = 'cached' | 'live';

export interface ReplayOrExecuteResult {
  stepKey: string;
  mode: CacheReplayMode;
  tokensUsed: number;
  fallbackTriggered?: boolean;
  cacheMissReason?: 'NO_CACHE_FILE' | 'DOM_DRIFT' | 'ROUTE_NOT_FOUND';
  resolvedLocator: string | null;
  resolvedValue?: string | null;
  durationMs: number;
}

export interface E2eCacheReplayEngineOptions {
  projectCacheDir?: string;
  taskCacheDirResolver?: (taskId: string) => string;
  isCiRun?: boolean;
}

/**
 * Helper to normalize parameterized routes, replacing UUIDs and numeric IDs with ':id'
 */
export function normalizeRoutePattern(rawRouteOrUrl: string): string {
  let pathname = rawRouteOrUrl;
  try {
    pathname = new URL(rawRouteOrUrl).pathname;
  } catch {
    // rawRoute is already a path
  }

  // Normalize: remove query/hash, lowercase, replace dynamic IDs
  const clean = pathname.split('?')[0].split('#')[0].trim().replace(/\/+$/, '') || '/';

  return clean
    // Replace standard UUIDs with :id
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ':id')
    // Replace numeric segments with :id
    .replace(/\/\d+(?=\/|$)/g, '/:id')
    .toLowerCase();
}

export class E2eCacheReplayEngine {
  private readonly projectCacheDir: string;
  private readonly taskCacheDirResolver: (taskId: string) => string;
  private readonly isCiRun: boolean;

  constructor(options?: E2eCacheReplayEngineOptions) {
    this.projectCacheDir = options?.projectCacheDir ?? path.join('.agents', 'cache', 'e2e');
    this.taskCacheDirResolver =
      options?.taskCacheDirResolver ??
      ((taskId: string) => path.join('.agents', 'tasks', taskId, 'e2e-cache'));
    this.isCiRun = options?.isCiRun ?? (process.env.CI === 'true' || process.env.CI === '1');
  }

  /**
   * Computes deterministic SHA-256 stepKey
   */
  public computeStepKey(input: { route: string; action: string; intent: string }): string {
    const normalizedRoute = normalizeRoutePattern(input.route);
    const sanitizedAction = input.action.trim().toLowerCase();
    const sanitizedIntent = input.intent.trim().replace(/\s+/g, ' ').toLowerCase();

    return crypto
      .createHash('sha256')
      .update(`${normalizedRoute}|${sanitizedAction}|${sanitizedIntent}`, 'utf8')
      .digest('hex');
  }

  private getTaskCacheDir(taskId: string): string {
    return this.taskCacheDirResolver(taskId);
  }

  private getTaskCachePath(taskId: string, stepKey: string): string {
    return path.join(this.getTaskCacheDir(taskId), `${stepKey}.json`);
  }

  private getProjectCachePath(stepKey: string): string {
    return path.join(this.projectCacheDir, `${stepKey}.json`);
  }

  private async readCachedStep(taskId: string, stepKey: string): Promise<CachedIntentStep | null> {
    // 1. Check task-scoped cache first
    const taskPath = this.getTaskCachePath(taskId, stepKey);
    try {
      const data = await fs.readFile(taskPath, 'utf8');
      return JSON.parse(data) as CachedIntentStep;
    } catch {
      // Not in task cache, fallback to project cache
    }

    // 2. Check project-level baseline cache
    const projectPath = this.getProjectCachePath(stepKey);
    try {
      const data = await fs.readFile(projectPath, 'utf8');
      return JSON.parse(data) as CachedIntentStep;
    } catch {
      return null;
    }
  }

  /**
   * Records a verified step into the task-scoped cache (.agents/tasks/<TASK_ID>/e2e-cache/).
   * Never mutates .agents/cache/e2e/ directly.
   */
  public async recordStepSuccess(input: { taskId: string; step: CachedIntentStep }): Promise<void> {
    const taskDir = this.getTaskCacheDir(input.taskId);
    await fs.mkdir(taskDir, { recursive: true });
    const targetPath = this.getTaskCachePath(input.taskId, input.step.stepKey);
    await fs.writeFile(targetPath, JSON.stringify(input.step, null, 2), 'utf8');
  }

  /**
   * Attempts cache replay with 0 tokens; falls back to live resolution on drift or miss.
   */
  public async replayOrExecuteStep(input: {
    taskId: string;
    intent: string;
    action: CacheReplayAction;
    pageUrl: string;
    ariaSnapshot: string;
    intentRuntime: IntentRuntime;
  }): Promise<ReplayOrExecuteResult> {
    const startTime = Date.now();
    const normalizedRoute = normalizeRoutePattern(input.pageUrl);
    const stepKey = this.computeStepKey({
      route: normalizedRoute,
      action: input.action,
      intent: input.intent,
    });

    const currentSnapshotHash = crypto
      .createHash('sha256')
      .update(input.ariaSnapshot, 'utf8')
      .digest('hex');

    const cachedStep = await this.readCachedStep(input.taskId, stepKey);

    // Cache hit & no DOM drift
    if (cachedStep && cachedStep.ariaSnapshotHash === currentSnapshotHash) {
      return {
        stepKey,
        mode: 'cached',
        tokensUsed: 0,
        resolvedLocator: cachedStep.resolvedLocator,
        resolvedValue: cachedStep.resolvedValue ?? null,
        durationMs: Date.now() - startTime,
      };
    }

    // Cache miss or DOM drift -> fallback to live IntentRuntime turn
    const isDrift = cachedStep !== null;
    const missReason = isDrift ? 'DOM_DRIFT' : 'NO_CACHE_FILE';

    let liveResult: IntentStepResult;
    const callArgs = {
      taskId: input.taskId,
      intent: input.intent,
      pageUrl: input.pageUrl,
      ariaSnapshot: input.ariaSnapshot,
    };

    switch (input.action) {
      case 'act':
      case 'click':
      case 'fill':
      case 'navigate':
      case 'select':
        liveResult = await input.intentRuntime.agentAct(callArgs);
        break;
      case 'assert':
        liveResult = await input.intentRuntime.agentAssert(callArgs);
        break;
      case 'extract':
        liveResult = await input.intentRuntime.agentExtract(callArgs);
        break;
      default:
        liveResult = await input.intentRuntime.agentAct(callArgs);
    }

    // Write resolved step ONLY to task-scoped cache (never to project baseline during CI)
    if (liveResult.resolvedLocator) {
      const stepToCache: CachedIntentStep = {
        stepKey,
        normalizedRoute,
        action: input.action,
        intent: input.intent,
        resolvedLocator: liveResult.resolvedLocator,
        resolvedValue: liveResult.resolvedValue ?? undefined,
        ariaSnapshotHash: currentSnapshotHash,
        createdAt: new Date().toISOString(),
        taskId: input.taskId,
      };

      await this.recordStepSuccess({ taskId: input.taskId, step: stepToCache });
    }

    return {
      stepKey,
      mode: 'live',
      tokensUsed: liveResult.tokensUsed,
      fallbackTriggered: isDrift,
      cacheMissReason: missReason,
      resolvedLocator: liveResult.resolvedLocator,
      resolvedValue: liveResult.resolvedValue,
      durationMs: Date.now() - startTime,
    };
  }

  /**
   * Promotes verified task-scoped cache into project baseline upon task MERGED.
   *
   * Guards:
   * - Throws RELAY_BLAST_RADIUS_VIOLATION when called during a CI run (isCiRun = true)
   *   to enforce the SC-002 CI read-only invariant on .agents/cache/e2e/.
   * - Each file is written atomically via a .tmp rename to prevent partial-promotion state
   *   on crash or disk-full errors.
   * - mergeCommitSha is embedded in each promoted entry for provenance tracking.
   */
  public async promoteTaskCacheOnMerge(input: {
    taskId: string;
    mergeCommitSha?: string;
  }): Promise<{ promotedCount: number }> {
    // ISSUE-1 fix: enforce CI read-only invariant — project baseline must never be mutated during CI
    if (this.isCiRun) {
      throw new GraywolfAppError(
        'RELAY_BLAST_RADIUS_VIOLATION',
        'promoteTaskCacheOnMerge must not be called during CI runs. The project baseline cache (.agents/cache/e2e/) is read-only in CI; promotion only occurs on MERGED.',
        { taskId: input.taskId }
      );
    }

    const taskDir = this.getTaskCacheDir(input.taskId);
    let files: string[] = [];
    try {
      files = await fs.readdir(taskDir);
    } catch {
      // No task cache created, nothing to promote
      return { promotedCount: 0 };
    }

    await fs.mkdir(this.projectCacheDir, { recursive: true });
    let promotedCount = 0;

    for (const file of files) {
      if (file.endsWith('.json')) {
        const sourcePath = path.join(taskDir, file);
        const destPath = path.join(this.projectCacheDir, file);
        // ISSUE-2 fix: atomic write via .tmp + rename to avoid partial-promotion state on crash.
        // mergeCommitSha is embedded for cache provenance tracing.
        const tmpPath = `${destPath}.tmp`;
        const raw = JSON.parse(await fs.readFile(sourcePath, 'utf8')) as Record<string, unknown>;
        if (input.mergeCommitSha) {
          raw.promotedByCommit = input.mergeCommitSha;
        }
        await fs.writeFile(tmpPath, JSON.stringify(raw, null, 2), 'utf8');
        await fs.rename(tmpPath, destPath); // atomic on same filesystem
        promotedCount++;
      }
    }

    return { promotedCount };
  }
}
