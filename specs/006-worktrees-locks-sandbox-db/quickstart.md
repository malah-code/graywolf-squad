# Quickstart & Validation Guide: 006-worktrees-locks-sandbox-db

**Feature Branch**: `006-worktrees-locks-sandbox-db`  
**Date**: 2026-10-18

## Prerequisites

- Node.js 20+ and `pnpm`
- Git CLI installed and available on `PATH`
- Dependencies installed (`pnpm install`, including `chokidar`, `proper-lockfile`, `picomatch`)

## Validation Commands

1. **Task Store & Debounced Chokidar Watcher Integration Tests**:
   ```bash
   pnpm test tests/integration/task-store.test.ts
   ```
   - Verifies `.agents/tasks/<TASK_ID>/` initialization (`e2e-cache/`, `review/`), artifact read/write, SHA-256 `content_hash` calculation, `task_artifacts` PostgreSQL sync via `withTenantContext`, and 200ms debounced `brief.md` watcher (`task.inject` on body edits vs `task.pivot` `UPDATED` on `writableScope`/`blockedBy` edits).

2. **Relative-Path Git Worktree Lifecycle Integration Tests**:
   ```bash
   pnpm test tests/integration/worktree.test.ts
   ```
   - Verifies `createTaskWorktree` in a real temporary Git repo, DAG branch stacking (`parentTaskId`), relative `gitdir:` pointer rewrite in `<worktree>/.git`, `snapshotWorktree`, `restoreWorktree` (`git restore . && git clean -fd`), and `removeTaskWorktree`.

3. **Atomic Directory Locking & Startup Garbage Collection Unit Tests**:
   ```bash
   pnpm test tests/unit/lock.test.ts
   ```
   - Verifies `proper-lockfile` acquisition on `.agents/locks/<TASK_ID>.lock`, `metadata.json` creation (`staleTimeoutMs: 30000`), periodic heartbeat updates, `TASK_LOCK_CONTENTION` (HTTP 423) on concurrent acquisition, and `pruneStaleResourcesOnBoot()` reclaiming locks older than 60 seconds.

4. **3-Tier Adaptive Database Isolation Engine Integration Tests**:
   ```bash
   pnpm test tests/integration/sandbox-db.test.ts
   ```
   - Verifies all 4 precedence levels of `resolveSandboxDbTier`, SQL identifier sanitization (`TASK-402-AUTH` ➔ `task_402_auth`), Tier 0 (`null` connection string), Tier 1 (`CREATE SCHEMA IF NOT EXISTS` + `search_path` connection string + `DROP SCHEMA` teardown), and Tier 2 (`CREATE DATABASE ... TEMPLATE graywolf_template` + optional seed SQL + `DROP DATABASE` teardown).

5. **Full Build, Lint, and Typecheck Verification**:
   ```bash
   pnpm typecheck
   pnpm lint
   pnpm build
   pnpm test
   ```
