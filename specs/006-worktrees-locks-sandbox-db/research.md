# Phase 0 Research: 006-worktrees-locks-sandbox-db

**Feature Branch**: `006-worktrees-locks-sandbox-db`  
**Date**: 2026-10-18  
**Status**: Complete (0 unknowns remaining)

## 1. Bi-Directional Task Directory Store & Chokidar Watcher (`src/orchestrator/runner/task-store.ts`, `src/orchestrator/runner/task-watcher.ts`)

- **Decision**:
  - Implement `src/orchestrator/runner/task-store.ts` to manage `.agents/tasks/<TASK_ID>/` with canonical files (`brief.md`, `plan.md`, `changes.patch`, `result.json`, `verification.md`, `review-signoff.md`, `escalation-request.md`, `escalation-memo.md`, `clarification-request.md`) and subdirectories (`e2e-cache/`, `review/`).
  - Compute SHA-256 hex `content_hash` via `node:crypto` on every write and sync artifact metadata into `task_artifacts` inside `withTenantContext(workspaceId, orgId, ...)` when database synchronization is enabled.
  - Implement `src/orchestrator/runner/task-watcher.ts` using `chokidar` (with a 200ms debounce timer per task and last-seen `content_hash` deduplication) watching `.agents/tasks/**/brief.md`. Compare the newly parsed `TaskBriefFrontmatter` against the previous baseline:
    - If `writableScope`, `blockedBy`, or `targetFiles` changed ➔ emit `task.pivot` (`status: 'UPDATED'` + trigger worktree snapshot).
    - If only the Markdown body or non-scope metadata changed ➔ emit `task.inject` (for mid-flight minor clarification injection).
- **Rationale**: Keeps the filesystem `.agents/tasks/<TASK_ID>/` directory and PostgreSQL `task_artifacts` table in deterministic sync while preventing self-triggered infinite watcher loops via `content_hash` comparison.
- **Alternatives Considered**:
  - Polling `.agents/tasks/` on an interval (rejected: higher latency and unnecessary I/O compared to event-driven debounced Chokidar/fs watcher).

## 2. Relative-Path Git Worktree Manager (`src/orchestrator/runner/worktree.ts`)

- **Decision**:
  - Provision isolated task worktrees at `<baseDir>/<taskId>` (defaulting to `.agents/worktrees/<taskId>`) on branch `worktree-<taskId>` (or stacked on a parent task's branch `worktree-<parentTaskId>` when DAG Branch Stacking is specified).
  - After `git worktree add`, read the generated `<worktreePath>/.git` pointer file (`gitdir: /abs/path/to/repo/.git/worktrees/<name>`), compute `path.relative(worktreePath, targetGitDir)` normalized to POSIX forward slashes (`/`), and rewrite `<worktreePath>/.git` as `gitdir: <relativePath>\n`.
  - Provide `snapshotWorktree(worktreePath, taskId)` (capturing `git status --porcelain` and `git diff HEAD` into a snapshot patch before a major pivot) and `restoreWorktree(worktreePath)` (`git restore . && git clean -fd` for Panic Button teardown).
- **Rationale**: Docker containers bind-mount the worktree at `/workspace` and the repository `.git` directory at a matching relative hierarchy; absolute host paths inside `.git` break `git status`/`git diff` inside the container namespace.
- **Alternatives Considered**:
  - Full `git clone` per task (rejected: slow disk I/O and duplicates `.git/objects` across concurrent tasks).

## 3. Atomic Directory Locking & Startup Garbage Collection (`src/orchestrator/runner/lock.ts`)

- **Decision**:
  - Use `proper-lockfile` on `.agents/locks/<TASK_ID>.lock` directory with `retries: 0` (fail-fast contention).
  - Upon acquiring the lock, write `.agents/locks/<TASK_ID>.lock/metadata.json` containing `{ taskId, workspaceId, pid, containerId, acquiredAt, lastHeartbeat, staleTimeoutMs: 30000 }` and optionally upsert the `task_locks` row in PostgreSQL.
  - Start an unref'd `setInterval` heartbeat every `15000ms` (configurable for fast unit tests) that updates `lastHeartbeat` in `metadata.json` and `task_locks`.
  - If `proper-lockfile` reports `ELOCKED` or an active non-stale lock already exists, throw `new GraywolfAppError('TASK_LOCK_CONTENTION', ...)` (HTTP 423, `retryable: true`).
  - Implement `pruneStaleResourcesOnBoot(options)` (Constitution Principle 8) which scans `.agents/locks/*.lock`, reclaims any lock where `Date.now() - metadata.lastHeartbeat > 60000` (60s threshold), removes corresponding `task_locks` rows, runs `git worktree prune` (or orphan worktree cleanup), and invokes an optional container cleanup callback for dangling `gw-task-*` containers.
- **Rationale**: Guarantees mutual exclusion across concurrent BullMQ workers and provides deterministic self-healing after SIGKILL or power loss.
- **Alternatives Considered**:
  - Advisory locks in Redis/Valkey only (rejected: PRD §5.2 and Constitution Principle 8 mandate filesystem lock directories `.agents/locks/<TASK_ID>.lock` + `task_locks` metadata).

## 4. 3-Tier Adaptive Database Isolation Engine (`src/orchestrator/db/sandbox-db.ts`)

- **Decision**:
  - Implement `resolveSandboxDbTier(input)` enforcing the strict 4-level precedence hierarchy (PRD §5.4):
    1. **Human Task Override** (`input.explicitTier`)
    2. **Pre-Flight File Pattern Analyzer** (`picomatch` check on `input.targetFiles` / `writableScope` against `['**/migrations/**', '**/*.sql', '**/schema.prisma', '**/alembic/**', '**/drizzle/**']` ➔ `tier-2-isolated-db`)
    3. **Dev-Level-1 Planner Declaration** (`input.plannerDeclaredTier` from `plan.md`)
    4. **Global Config Default** (`input.defaultTier ?? 'tier-0-mock'`)
  - Implement `sanitizeTaskDbIdentifier(taskId)` converting `TASK-402-AUTH` ➔ `task_402_auth` and validating `^[a-z0-9_]+$` to prevent SQL injection in DDL statements.
  - Implement `provisionSandboxDatabase` and `teardownSandboxDatabase`:
    - `tier-0-mock`: no DDL executed; returns `{ tier: 'tier-0-mock', connectionString: null }`.
    - `tier-1-shared-db`: executes `CREATE SCHEMA IF NOT EXISTS "task_<id>"` and returns a connection URL with `?options=-c%20search_path%3Dtask_<id>,public`; teardown executes `DROP SCHEMA IF EXISTS "task_<id>" CASCADE`.
    - `tier-2-isolated-db`: executes `CREATE DATABASE "task_<id>" TEMPLATE graywolf_template` (and optional seed SQL callback), returning a connection URL pointing to `/task_<id>`; teardown executes `DROP DATABASE IF EXISTS "task_<id>" WITH (FORCE)`.
- **Rationale**: Satisfies PRD §5.4 and `docs/architecture/sandbox-and-testing.md` §3.1–3.2 with sub-300ms PostgreSQL template cloning and zero SQL injection surface.
- **Alternatives Considered**:
  - Spinning up a fresh PostgreSQL Docker container per task (rejected: 5–15s cold boot vs <300ms `TEMPLATE graywolf_template` clone).
