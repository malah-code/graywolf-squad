---

description: "Task list for Phase 4 — Task Filesystem Store, Git Worktrees, Atomic Locks & 3-Tier Sandbox DB"
---

# Tasks: 006-worktrees-locks-sandbox-db

**Input**: Design documents from `/specs/006-worktrees-locks-sandbox-db/`

**Prerequisites**: `plan.md`, `spec.md`, `research.md`, `data-model.md`, `contracts/worktrees-locks-db.md`, `quickstart.md`

**Tests**: Included per `spec.md` (`SC-001`–`SC-005`) and `docs/implementation-plan-detailed.md` Phase 4 verification requirements (`tests/integration/task-store.test.ts`, `tests/integration/worktree.test.ts`, `tests/unit/lock.test.ts`, `tests/integration/sandbox-db.test.ts`).

**Organization**: Tasks are grouped by user story (`US1`–`US4`) to enable independent implementation and verification of each capability.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: Which user story this task belongs to (`[US1]`, `[US2]`, `[US3]`, `[US4]`)
- Include exact file paths in descriptions

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Ensure `chokidar` dependency and runner directory scaffolding are ready for Phase 4 modules.

- [x] T001 Install `chokidar` (`^3.6.0`) in `package.json` and ensure `src/orchestrator/runner/` directory exists

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Shared task artifact types and SQL identifier/hash helpers required by User Stories 1–4.

**⚠️ CRITICAL**: Complete before starting User Story phases.

- [x] T002 Define canonical `TaskArtifactFileName` union, artifact type mapping, and SHA-256 content hash helper in `src/orchestrator/runner/task-store.ts`

**Checkpoint**: Foundation ready — User Story phases 3–6 can now proceed.

---

## Phase 3: User Story 1 - Task Directory Artifact Store & Bi-Directional Chokidar Watcher (Priority: P1) 🎯 MVP

**Goal**: Manage `.agents/tasks/<TASK_ID>/` lifecycle files (`brief.md`, `plan.md`, `changes.patch`, `result.json`, `verification.md`, `review-signoff.md`, `escalation-request.md`, `escalation-memo.md`, `clarification-request.md`, `e2e-cache/`, `review/`), compute SHA-256 `content_hash`, sync metadata to `task_artifacts` inside `withTenantContext`, and watch `.agents/tasks/**/brief.md` via debounced (200ms) Chokidar watcher emitting `task.inject` or `task.pivot` (`UPDATED`).

**Independent Test**: Run `pnpm test tests/integration/task-store.test.ts` verifying `.agents/tasks/<TASK_ID>/` initialization, artifact read/write + SHA-256 `content_hash` sync to `task_artifacts`, self-write loop suppression, and 200ms debounced `brief.md` watcher (`task.inject` vs `task.pivot`).

### Implementation for User Story 1

- [x] T003 [US1] Implement `initTaskDirectory`, `writeTaskArtifact` (with SHA-256 `content_hash` and `withTenantContext` sync to `task_artifacts`), `readTaskArtifact`, and `listTaskArtifacts` in `src/orchestrator/runner/task-store.ts`
- [x] T004 [US1] Implement debounced (200ms) `TaskBriefWatcher` in `src/orchestrator/runner/task-watcher.ts` using `chokidar` on `.agents/tasks/**/brief.md` to compare frontmatter (`writableScope`, `blockedBy`, `targetFiles`) and emit `task.inject` or `task.pivot` (`UPDATED`) while suppressing self-originated writes
- [x] T005 [US1] Create integration test suite in `tests/integration/task-store.test.ts` verifying directory initialization, SHA-256 `content_hash` calculation, `task_artifacts` tenant-isolated DB sync, and 200ms debounced watcher (`task.inject` vs `task.pivot`)

**Checkpoint**: User Story 1 is complete and independently verified by `tests/integration/task-store.test.ts`.

---

## Phase 4: User Story 2 - Relative-Path Git Worktree Manager & Snapshot/Restore Lifecycle (Priority: P1)

**Goal**: Provision isolated Git worktrees (`git worktree add`) on branch `worktree-<taskId>` (or stacked on a parent task's branch for DAG Branch Stacking), rewrite `<worktree>/.git` to use a relative `gitdir: ../../.git/worktrees/...` pointer for Docker container portability, and support `snapshotWorktree`, `restoreWorktree` (`git restore . && git clean -fd`), and `removeTaskWorktree`.

**Independent Test**: Run `pnpm test tests/integration/worktree.test.ts` creating a real temporary Git repository, provisioning worktrees (including parent branch stacking), asserting relative `gitdir:` pointers inside `<worktree>/.git`, capturing a pre-pivot snapshot, restoring dirty/untracked files via `restoreWorktree`, and removing worktrees cleanly.

### Implementation for User Story 2

- [x] T006 [P] [US2] Implement `createTaskWorktree` (supporting `parentTaskId` DAG branch stacking and `GIT_WORKTREE_COLLISION` detection) and `rewriteWorktreeGitPointerToRelative` in `src/orchestrator/runner/worktree.ts`
- [x] T007 [US2] Implement `snapshotWorktree`, `restoreWorktree` (`git restore . && git clean -fd`), and `removeTaskWorktree` in `src/orchestrator/runner/worktree.ts`
- [x] T008 [US2] Create integration test suite in `tests/integration/worktree.test.ts` testing worktree creation, relative `gitdir:` pointer rewrite, DAG parent branch stacking, `snapshotWorktree`, `restoreWorktree`, and `removeTaskWorktree`

**Checkpoint**: User Story 2 is complete and independently verified by `tests/integration/worktree.test.ts`.

---

## Phase 5: User Story 3 - Atomic Directory Locking (`proper-lockfile`), Heartbeats & Startup Garbage Collection (Priority: P1)

**Goal**: Acquire atomic directory locks at `.agents/locks/<TASK_ID>.lock` via `proper-lockfile`, write `metadata.json` (`{ taskId, pid, containerId, acquiredAt, lastHeartbeat, staleTimeoutMs: 30000 }`), emit 15s heartbeats updating `metadata.json` and `task_locks`, throw `GraywolfAppError('TASK_LOCK_CONTENTION')` (423) on concurrent contention, and implement `pruneStaleResourcesOnBoot()` to reclaim stale locks (>60s), prune orphan worktrees, and teardown dangling containers.

**Independent Test**: Run `pnpm test tests/unit/lock.test.ts` verifying lock acquisition, `metadata.json` persistence, heartbeat updates, `TASK_LOCK_CONTENTION` (423) on concurrent lock attempts, and `pruneStaleResourcesOnBoot()` reclaiming locks older than 60 seconds.

### Implementation for User Story 3

- [x] T009 [P] [US3] Implement `acquireTaskLock` in `src/orchestrator/runner/lock.ts` using `proper-lockfile` on `.agents/locks/<TASK_ID>.lock`, writing `metadata.json`, starting the 15s heartbeat timer (updating `metadata.json` and `task_locks` via `withTenantContext`), and throwing `TASK_LOCK_CONTENTION` (423) on contention
- [x] T010 [US3] Implement `pruneStaleResourcesOnBoot()` in `src/orchestrator/runner/lock.ts` to reclaim lock directories and `task_locks` rows with `lastHeartbeat` older than 60,000ms, prune orphan worktrees, and invoke container cleanup callbacks
- [x] T011 [US3] Create unit test suite in `tests/unit/lock.test.ts` testing lock acquisition, heartbeat updates, `TASK_LOCK_CONTENTION` (423) contention, and 60s stale lock recovery via `pruneStaleResourcesOnBoot()`

**Checkpoint**: User Story 3 is complete and independently verified by `tests/unit/lock.test.ts`.

---

## Phase 6: User Story 4 - 3-Tier Adaptive Database Isolation Engine (PRD §5.4) (Priority: P1)

**Goal**: Resolve the required database isolation tier using the 4-level precedence hierarchy (Human Task Override > Pre-flight File Pattern Analyzer > Dev-Level-1 `plan.md` declaration > Global Config Default) and provision/teardown Tier 0 (`tier-0-mock`), Tier 1 (`tier-1-shared-db` schema isolation with `search_path`), and Tier 2 (`tier-2-isolated-db` `CREATE DATABASE ... TEMPLATE graywolf_template`).

**Independent Test**: Run `pnpm test tests/integration/sandbox-db.test.ts` verifying all 4 tier resolution precedence levels, SQL identifier sanitization, Tier 0 null connection string, Tier 1 `CREATE SCHEMA` + `search_path` URL + `DROP SCHEMA` teardown, and Tier 2 `CREATE DATABASE ... TEMPLATE graywolf_template` + seed SQL + `DROP DATABASE` teardown.

### Implementation for User Story 4

- [x] T012 [P] [US4] Implement `sanitizeTaskDbIdentifier` and `resolveSandboxDbTier` (Human Task Override > Pre-flight File Pattern Analyzer via `picomatch` > Dev-Level-1 `plan.md` declaration > Global Config Default) in `src/orchestrator/db/sandbox-db.ts`
- [x] T013 [US4] Implement `provisionSandboxDatabase` and `teardownSandboxDatabase` for `tier-0-mock`, `tier-1-shared-db` (`CREATE SCHEMA IF NOT EXISTS` + `search_path` connection string), and `tier-2-isolated-db` (`CREATE DATABASE ... TEMPLATE graywolf_template` + optional seed SQL + `DROP DATABASE`) in `src/orchestrator/db/sandbox-db.ts`
- [x] T014 [US4] Create integration test suite in `tests/integration/sandbox-db.test.ts` covering all 4 precedence rules, SQL identifier sanitization, Tier 0, Tier 1 schema isolation, and Tier 2 template clone + teardown

**Checkpoint**: User Story 4 is complete and independently verified by `tests/integration/sandbox-db.test.ts`.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Full verification of TypeScript build, ESLint rules, Vitest suite, and master implementation plan tracking.

- [x] T015 Run `pnpm typecheck`, `pnpm lint`, `pnpm build`, and `pnpm test` across all suites and mark Tasks 4.1–4.4 complete in `docs/implementation-plan-detailed.md`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1: T001)**: No dependencies — starts immediately.
- **Foundational (Phase 2: T002)**: Depends on T001.
- **User Story 1 (Phase 3: T003–T005)**: Depends on T002.
- **User Story 2 (Phase 4: T006–T008)**: Independent of US1; can run in parallel after T001.
- **User Story 3 (Phase 5: T009–T011)**: Independent of US1/US2; can run in parallel after T001.
- **User Story 4 (Phase 6: T012–T014)**: Independent of US1/US2/US3; can run in parallel after T001.
- **Polish (Phase 7: T015)**: Depends on all User Stories (T001–T014) completing.

### Parallel Opportunities

- `T006` (`src/orchestrator/runner/worktree.ts`), `T009` (`src/orchestrator/runner/lock.ts`), and `T012` (`src/orchestrator/db/sandbox-db.ts`) touch completely disjoint files and can be implemented in parallel with User Story 1 (`T003`–`T004`).
- Test suites `tests/integration/task-store.test.ts` (`T005`), `tests/integration/worktree.test.ts` (`T008`), `tests/unit/lock.test.ts` (`T011`), and `tests/integration/sandbox-db.test.ts` (`T014`) are isolated and run in parallel.

---

## Parallel Example: Phase 4 Modules

```bash
# Implement disjoint Phase 4 modules in parallel:
Task T003: "Implement Task Directory Manager in src/orchestrator/runner/task-store.ts"
Task T006: "Implement Relative-Path Git Worktree Manager in src/orchestrator/runner/worktree.ts"
Task T009: "Implement Atomic Directory Locking in src/orchestrator/runner/lock.ts"
Task T012: "Implement 3-Tier Adaptive Database Isolation Engine in src/orchestrator/db/sandbox-db.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1)

1. Complete Phase 1 (`T001`) and Phase 2 (`T002`).
2. Complete Phase 3 (`T003`–`T005`) and validate `.agents/tasks/<TASK_ID>/` artifact store and 200ms debounced Chokidar watcher via `tests/integration/task-store.test.ts`.

### Incremental Delivery

1. Add Relative-Path Git Worktree Manager (`T006`–`T008`) → Verify with `tests/integration/worktree.test.ts`.
2. Add Atomic Directory Locking & Boot GC (`T009`–`T011`) → Verify with `tests/unit/lock.test.ts`.
3. Add 3-Tier Adaptive Database Isolation Engine (`T012`–`T014`) → Verify with `tests/integration/sandbox-db.test.ts`.
4. Run full verification (`T015`).
