# Interface Contracts: 006-worktrees-locks-sandbox-db

**Feature Branch**: `006-worktrees-locks-sandbox-db`  
**Date**: 2026-10-18

## 1. Task Store & Watcher Contract (`src/orchestrator/runner/task-store.ts`, `src/orchestrator/runner/task-watcher.ts`)

```typescript
export interface TaskStoreOptions {
  baseDir?: string; // defaults to path.resolve(process.cwd(), '.agents/tasks')
  workspaceId?: string;
  orgId?: string;
  syncToDb?: boolean;
}

export async function initTaskDirectory(
  taskId: string,
  options?: TaskStoreOptions
): Promise<string>;

export async function writeTaskArtifact(
  taskId: string,
  fileName: TaskArtifactFileName,
  content: string,
  options?: TaskStoreOptions & { authoredBy?: string }
): Promise<{ filePath: string; contentHash: string }>;

export async function readTaskArtifact(
  taskId: string,
  fileName: TaskArtifactFileName,
  options?: TaskStoreOptions
): Promise<{ content: string; contentHash: string }>;
```

### Watcher Contract (`src/orchestrator/runner/task-watcher.ts`)
- Watches `<baseDir>/**/brief.md` with configurable `debounceMs` (default `200ms`).
- Emits typed events on an `EventEmitter`:
  - `watcher.on('task.inject', (event: TaskInjectEvent) => void)`
  - `watcher.on('task.pivot', (event: TaskPivotEvent) => void)`
- Exposes `recordProgrammaticWrite(taskId: string, contentHash: string, frontmatter?: TaskBriefFrontmatter)` so orchestrator-initiated writes update baseline state without firing self-triggered loop events.

## 2. Relative-Path Git Worktree Contract (`src/orchestrator/runner/worktree.ts`)

```typescript
export interface CreateWorktreeOptions {
  repoRoot: string;
  taskId: string;
  worktreesDir?: string; // defaults to path.join(repoRoot, '.agents/worktrees')
  baseRef?: string;      // defaults to 'HEAD'
  parentTaskId?: string; // DAG Branch Stacking: branches from 'worktree-<parentTaskId>'
}

export async function createTaskWorktree(
  options: CreateWorktreeOptions
): Promise<TaskWorktreeInfo>;

export async function rewriteWorktreeGitPointerToRelative(
  worktreePath: string
): Promise<string>;

export async function snapshotWorktree(
  worktreePath: string,
  taskId: string,
  snapshotDir?: string
): Promise<WorktreeSnapshot>;

export async function restoreWorktree(
  worktreePath: string
): Promise<void>;

export async function removeTaskWorktree(
  repoRoot: string,
  worktreePath: string,
  taskId: string
): Promise<void>;
```

## 3. Atomic Directory Lock & Boot GC Contract (`src/orchestrator/runner/lock.ts`)

```typescript
export interface AcquireLockOptions {
  locksDir?: string;          // defaults to '.agents/locks'
  workspaceId?: string;
  orgId?: string;
  containerId?: string | null;
  heartbeatIntervalMs?: number; // defaults to 15000 (15s)
  staleTimeoutMs?: number;      // defaults to 30000 (30s)
  syncToDb?: boolean;
}

export interface AcquiredTaskLock {
  taskId: string;
  lockDir: string;
  metadata: TaskLockMetadata;
  release(): Promise<void>;
}

export async function acquireTaskLock(
  taskId: string,
  options?: AcquireLockOptions
): Promise<AcquiredTaskLock>;

export async function pruneStaleResourcesOnBoot(options?: {
  locksDir?: string;
  repoRoot?: string;
  staleThresholdMs?: number; // defaults to 60000 (60s)
  workspaceId?: string;
  orgId?: string;
  syncToDb?: boolean;
  teardownDanglingContainers?: () => Promise<string[]>;
}): Promise<{
  reclaimedLocks: string[];
  prunedWorktrees: boolean;
  removedContainers: string[];
}>;
```

## 4. 3-Tier Sandbox Database Isolation Contract (`src/orchestrator/db/sandbox-db.ts`)

```typescript
export type SandboxDbTier =
  | 'tier-0-mock'
  | 'tier-1-shared-db'
  | 'tier-2-isolated-db';

export function sanitizeTaskDbIdentifier(taskId: string): string;
export function sanitizePostgresIdentifier(raw: string, prefix?: string): string;

export function resolveSandboxDbTier(input: {
  explicitTier?: SandboxDbTier;
  targetFiles?: string[];
  plannerDeclaredTier?: SandboxDbTier;
  defaultTier?: SandboxDbTier;
}): SandboxDbTier;

export async function provisionSandboxDatabase(options: {
  taskId: string;
  tier: SandboxDbTier;
  baseDatabaseUrl: string;
  templateDbName?: string; // defaults to 'graywolf_template'
  queryExecutor?: (sql: string, targetConnectionString?: string) => Promise<unknown>;
  seedSql?: string;
}): Promise<{
  tier: SandboxDbTier;
  identifier: string | null;
  connectionString: string | null;
}>;

export async function teardownSandboxDatabase(options: {
  taskId: string;
  tier: SandboxDbTier;
  queryExecutor?: (sql: string) => Promise<unknown>;
}): Promise<void>;
```
