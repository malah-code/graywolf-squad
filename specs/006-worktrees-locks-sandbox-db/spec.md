# Feature Specification: 006-worktrees-locks-sandbox-db

**Feature Branch**: `006-worktrees-locks-sandbox-db`  
**Created**: 2026-10-18  
**Status**: Draft  
**Target Phase**: Phase 4 — Task Filesystem Store, Git Worktrees, Atomic Locks & 3-Tier Sandbox DB (`docs/implementation-plan-detailed.md`)  
**Input**: Master Phased Implementation Plan §Phase 4 (`specs/006-worktrees-locks-sandbox-db/`); `docs/architecture/sandbox-and-testing.md`; `docs/PRD.md` §5.2–§5.4; `specs/001-multi-agent-platform/data-model.md`; ADR-013, ADR-030, ADR-042

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Task Directory Artifact Store & Bi-Directional Chokidar Watcher (Priority: P1)

Each engineering task maintains a dedicated directory under `.agents/tasks/<TASK_ID>/` housing its lifecycle artifacts (`brief.md`, `plan.md`, `changes.patch`, `result.json`, `verification.md`, `review-signoff.md`, `escalation-request.md`, `escalation-memo.md`, `clarification-request.md`, and subdirectories `e2e-cache/` and `review/`). Whenever an artifact is written or updated, the Task Directory Manager computes its `SHA-256` `content_hash` and syncs the metadata to the `task_artifacts` table in PostgreSQL (inside `withTenantContext`). Simultaneously, a debounced (200ms) Chokidar filesystem watcher monitors `.agents/tasks/**/brief.md` so that when a developer edits a task brief on disk, the orchestrator detects whether it is a minor markdown body clarification (emitting a `task.inject` event for active containers) or a major frontmatter/scope pivot (transitioning the task to `UPDATED` and triggering a worktree snapshot).

**Why this priority**: The `.agents/tasks/<TASK_ID>/` directory is the canonical file-backed interface between the host orchestrator, human developer IDE edits, and in-container agent tiers (`Dev-Level-1`, `Dev-Level-3`, `Dev-Level-2`).

**Independent Test**: Run `tests/integration/task-store.test.ts` creating a task directory, reading/writing artifacts, verifying SHA-256 `content_hash` calculation and `task_artifacts` metadata synchronization, and testing the 200ms debounced watcher on `brief.md` edits (`task.inject` vs `UPDATED` pivot).

**Acceptance Scenarios**:

1. **Given** a new `taskId` (`TASK-401`), **When** `initTaskDirectory(taskId)` runs, **Then** `.agents/tasks/TASK-401/` and subdirectories `e2e-cache/` and `review/` are created on disk.
2. **Given** an artifact (`brief.md`, `plan.md`, `result.json`, etc.) written via `writeTaskArtifact`, **When** persisted, **Then** its `SHA-256` hex `content_hash` is computed and synced to `task_artifacts`.
3. **Given** an active watcher on `.agents/tasks/**/brief.md`, **When** a developer modifies the Markdown body of `brief.md` without changing `writableScope` or `blockedBy`, **Then** after the 200ms debounce window it emits a `task.inject` event; **When** `writableScope` or `blockedBy` is modified in frontmatter, **Then** it emits a `task.pivot` (`UPDATED`) event.

---

### User Story 2 - Relative-Path Git Worktree Manager & Snapshot/Restore Lifecycle (Priority: P1)

Before spawning a runner container for a task, the orchestrator provisions an isolated Git worktree (`git worktree add`) on branch `worktree-<taskId>` (or stacked on a parent task's branch when DAG Branch Stacking is used). Because host absolute paths inside `.git` pointer files break when bind-mounted into Docker containers at `/workspace`, the Worktree Manager rewrites the worktree's `.git` file to use a **relative path pointer** (`gitdir: ../../.git/worktrees/...`). It also supports `snapshotWorktree(taskId)` before major requirement pivots and `restoreWorktree(taskId)` (`git restore . && git clean -fd`) for the Panic Button.

**Why this priority**: Guarantees 100% Git compatibility across host and container mount namespaces while supporting non-destructive pivots and instant Panic Button cleanup (Constitution Principles 1 & 8).

**Independent Test**: Run `tests/integration/worktree.test.ts` initializing a temporary Git repository, provisioning a task worktree, asserting the `.git` file contains a relative `gitdir:` path, testing `snapshotWorktree` and `restoreWorktree` after dirtying files, and removing the worktree cleanly.

**Acceptance Scenarios**:

1. **Given** a Git repository and `taskId`, **When** `createTaskWorktree(repoRoot, taskId)` is called, **Then** an isolated worktree is created on branch `worktree-<taskId>` and its `.git` file contains a relative `gitdir: ...` path rather than an absolute host path.
2. **Given** untracked and modified files inside a task worktree, **When** `restoreWorktree(worktreePath)` is called, **Then** `git restore . && git clean -fd` resets the worktree to a clean state.
3. **Given** an active worktree prior to a major pivot, **When** `snapshotWorktree(worktreePath, taskId)` is called, **Then** the current diff/state is captured so work is preserved before restarting.

---

### User Story 3 - Atomic Directory Locking (`proper-lockfile`), Heartbeats & Startup Garbage Collection (Priority: P1)

To prevent two orchestrator workers or containers from mutating the same task concurrently, the Lock Manager acquires an atomic directory lock at `.agents/locks/<TASK_ID>.lock` via `proper-lockfile` and writes `metadata.json` (`{ taskId, pid, containerId, acquiredAt, lastHeartbeat, staleTimeoutMs: 30000 }`). Active locks emit a heartbeat every 15 seconds updating `lastHeartbeat` in both `metadata.json` and the `task_locks` database table. If a second caller attempts to lock an already locked task, it immediately throws `GraywolfAppError('TASK_LOCK_CONTENTION')` (HTTP 423, retryable: true). On orchestrator boot, `pruneStaleResourcesOnBoot()` garbage-collects stale locks (`lastHeartbeat` older than 60 seconds), prunes orphan worktrees, and tears down dangling `gw-task-*` containers (Constitution Principle 8).

**Why this priority**: Prevents race conditions on task worktrees and guarantees self-healing recovery after unclean host or process crashes.

**Independent Test**: Run `tests/unit/lock.test.ts` acquiring a task lock, verifying `metadata.json` and 15s heartbeat updates, asserting `TASK_LOCK_CONTENTION` (423) on concurrent lock acquisition, and verifying `pruneStaleResourcesOnBoot()` reclaims locks with `lastHeartbeat` > 60s old.

**Acceptance Scenarios**:

1. **Given** an unlocked task `TASK-101`, **When** `acquireTaskLock('TASK-101', { containerId })` is called, **Then** `.agents/locks/TASK-101.lock/metadata.json` is written with `staleTimeoutMs: 30000` and a 15-second heartbeat timer updates `lastHeartbeat`.
2. **Given** `TASK-101` is already locked by an active holder, **When** another caller invokes `acquireTaskLock('TASK-101')`, **Then** it throws `GraywolfAppError('TASK_LOCK_CONTENTION')` (HTTP 423, retryable: true).
3. **Given** a stale lock directory whose `metadata.json` has `lastHeartbeat` older than 60,000ms, **When** `pruneStaleResourcesOnBoot()` runs, **Then** the stale lock directory and `task_locks` row are removed, orphan worktrees are pruned, and a subsequent `acquireTaskLock` succeeds.

---

### User Story 4 - 3-Tier Adaptive Database Isolation Engine (PRD §5.4) (Priority: P1)

Before starting a task container, the Sandbox Database Isolation Engine (`src/orchestrator/db/sandbox-db.ts`) determines the minimum required database isolation tier using the strict precedence hierarchy:
1. **Human Task Override** (`explicitTier` on task)
2. **Pre-Flight File Pattern Analyzer** (touches `**/migrations/**`, `*.sql`, `schema.prisma`, `alembic/**`, or `drizzle/**` ➔ `tier-2-isolated-db`)
3. **Dev-Level-1 Planner Declaration** in `plan.md` (`dbTier` / `isolationTier`)
4. **Global Config Default** (`tier-0-mock` default)

Based on the resolved tier:
- **Tier 0 (`tier-0-mock`)**: Provisions no database and returns `connectionString: null`.
- **Tier 1 (`tier-1-shared-db`)**: Executes `CREATE SCHEMA IF NOT EXISTS task_<sanitized_id>` in the shared Postgres database and returns a connection string with `?options=-c%20search_path%3Dtask_<sanitized_id>,public`.
- **Tier 2 (`tier-2-isolated-db`)**: Executes `CREATE DATABASE task_<sanitized_id> TEMPLATE graywolf_template` (<300ms copy-on-write clone), optionally runs synthetic seed SQL, and drops the database (`DROP DATABASE IF EXISTS task_<sanitized_id> WITH (FORCE)`) on teardown.

**Why this priority**: Eliminates state pollution across concurrent schema-modifying tasks while keeping frontend/pure-code tasks fast and zero-overhead.

**Independent Test**: Run `tests/integration/sandbox-db.test.ts` testing all 4 precedence levels of tier resolution, Tier 0 null connection, Tier 1 `CREATE SCHEMA` + `search_path` connection string + schema teardown, and Tier 2 `CREATE DATABASE ... TEMPLATE graywolf_template` + `DROP DATABASE` teardown.

**Acceptance Scenarios**:

1. **Given** target files containing `migrations/001_init.sql` or `prisma/schema.prisma`, **When** `resolveSandboxDbTier` evaluates without a human override, **Then** it selects `tier-2-isolated-db`; **When** a human override specifies `tier-0-mock`, **Then** the human override wins.
2. **Given** `tier-1-shared-db` for `TASK-402`, **When** `provisionSandboxDatabase` runs, **Then** it executes `CREATE SCHEMA IF NOT EXISTS task_402` and returns a connection string containing `search_path%3Dtask_402,public`.
3. **Given** `tier-2-isolated-db` for `TASK-402`, **When** `provisionSandboxDatabase` and `teardownSandboxDatabase` run, **Then** `CREATE DATABASE task_402 TEMPLATE graywolf_template` is executed on provision and `DROP DATABASE IF EXISTS task_402` is executed on teardown.

---

### Edge Cases

- **SQL Identifier Sanitization for Task IDs**: Task IDs like `TASK-402-AUTH` contain hyphens that are invalid in unquoted SQL identifiers; `sanitizeTaskDbIdentifier(taskId)` MUST deterministically normalize `TASK-402-AUTH` to lowercase alphanumeric + underscores (`task_402_auth`) and reject any non-conforming characters to prevent SQL injection in `CREATE SCHEMA` / `CREATE DATABASE`.
- **Git Worktree Collision on Existing Branch**: If `worktree-<taskId>` branch already exists from a previous interrupted run, `createTaskWorktree` uses `git worktree add -B <branch>` (or throws `GIT_WORKTREE_COLLISION` 409 if an active worktree is already mounted at that path).
- **Self-Triggered Watcher Events**: When the orchestrator itself writes `brief.md` via `writeTaskArtifact`, the Chokidar watcher can suppress self-originated hashes (tracking last known `content_hash`) so programmatic writes do not trigger redundant `task.inject` loops.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST implement the Task Directory Manager in `src/orchestrator/runner/task-store.ts` managing `.agents/tasks/<TASK_ID>/` (`brief.md`, `plan.md`, `changes.patch`, `result.json`, `verification.md`, `review-signoff.md`, `escalation-request.md`, `escalation-memo.md`, `clarification-request.md`, `e2e-cache/`, `review/`), computing SHA-256 `content_hash`, and syncing artifact records to `task_artifacts`.
- **FR-002**: System MUST implement a debounced (200ms) Chokidar watcher in `src/orchestrator/runner/task-watcher.ts` watching `.agents/tasks/**/brief.md` and emitting `task.inject` on minor body edits or `task.pivot` (`UPDATED` + worktree snapshot trigger) on scope/dependency frontmatter changes.
- **FR-003**: System MUST implement the Git Worktree Manager in `src/orchestrator/runner/worktree.ts` supporting `createTaskWorktree` (with DAG branch stacking support), rewriting the worktree `.git` file to a relative `gitdir:` pointer, `snapshotWorktree(taskId)`, `restoreWorktree(taskId)` (`git restore . && git clean -fd`), and `removeTaskWorktree(taskId)`.
- **FR-004**: System MUST implement Atomic Directory Locking in `src/orchestrator/runner/lock.ts` using `proper-lockfile` on `.agents/locks/<TASK_ID>.lock`, persisting `metadata.json` (`taskId`, `pid`, `containerId`, `acquiredAt`, `lastHeartbeat`, `staleTimeoutMs: 30000`), emitting 15s heartbeats to `metadata.json` and `task_locks`, and throwing `TASK_LOCK_CONTENTION` (423) on contention.
- **FR-005**: System MUST implement `pruneStaleResourcesOnBoot()` in `src/orchestrator/runner/lock.ts` to garbage-collect locks with `lastHeartbeat` older than 60 seconds, prune orphan git worktrees, and invoke an optional container teardown callback for dangling `gw-task-*` containers.
- **FR-006**: System MUST implement the 3-Tier Adaptive Database Isolation Engine in `src/orchestrator/db/sandbox-db.ts` enforcing the resolution hierarchy (Human Task Override > Pre-flight File Pattern Analyzer > Dev-Level-1 `plan.md` declaration > Global Config Default) and provisioning/tearing down `tier-0-mock`, `tier-1-shared-db` (schema isolation with `search_path`), and `tier-2-isolated-db` (`CREATE DATABASE ... TEMPLATE graywolf_template`).

### Key Entities

- **TaskArtifactMetadata**: `{ taskId: string; workspaceId: string; artifactType: string; authoredBy?: string; filePath: string; contentHash: string }` synced between `.agents/tasks/<TASK_ID>/` and `task_artifacts`.
- **LockMetadata**: `{ taskId: string; pid: number; containerId: string | null; acquiredAt: number; lastHeartbeat: number; staleTimeoutMs: number }` persisted in `.agents/locks/<TASK_ID>.lock/metadata.json` and `task_locks`.
- **SandboxDbTier & ProvisionedSandboxDb**: `'tier-0-mock' | 'tier-1-shared-db' | 'tier-2-isolated-db'` and `{ tier: SandboxDbTier; connectionString: string | null; schemaName?: string; databaseName?: string }`.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Editing `brief.md` in `.agents/tasks/<TASK_ID>/` computes the SHA-256 `content_hash`, syncs to `task_artifacts`, and triggers the debounced (200ms) watcher event (`task.inject` or `task.pivot`) in `tests/integration/task-store.test.ts`.
- **SC-002**: Every worktree created by `src/orchestrator/runner/worktree.ts` has its `.git` file rewritten to a relative `gitdir:` pointer and passes snapshot, restore (`git restore . && git clean -fd`), and cleanup tests in `tests/integration/worktree.test.ts`.
- **SC-003**: Concurrent lock attempts throw `TASK_LOCK_CONTENTION` (423) and `pruneStaleResourcesOnBoot()` recovers locks older than 60s in `tests/unit/lock.test.ts`.
- **SC-004**: `src/orchestrator/db/sandbox-db.ts` resolves all 3 database isolation tiers according to the 4-level precedence hierarchy and provisions/tears down Tier 0, Tier 1 (`search_path` schema), and Tier 2 (`TEMPLATE graywolf_template`) in `tests/integration/sandbox-db.test.ts`.
- **SC-005**: `pnpm typecheck`, `pnpm lint`, `pnpm build`, and `pnpm test` pass with 0 errors and 0 warnings.

## Assumptions

- `proper-lockfile` (`^4.1.2`) and `picomatch` (`^4.0.2`) are already installed in `package.json`; `chokidar` (or Node.js `fs.watch` + `chokidar` package) is used for debounced file watching.
- Git CLI (`git`) is available in the execution environment for `tests/integration/worktree.test.ts`.
