# Implementation Plan: 006-worktrees-locks-sandbox-db

**Branch**: `006-worktrees-locks-sandbox-db` | **Date**: 2026-10-18 | **Spec**: [specs/006-worktrees-locks-sandbox-db/spec.md](./spec.md)
**Input**: Feature specification from `/specs/006-worktrees-locks-sandbox-db/spec.md` and Phase 4 of `docs/implementation-plan-detailed.md`

## Summary

Implement the Phase 4 Task Filesystem Store, Relative-Path Git Worktree Manager, Atomic Directory Locking with Startup Garbage Collection, and the 3-Tier Adaptive Database Isolation Engine:
1. **Task Directory Manager & Chokidar Watcher (`src/orchestrator/runner/task-store.ts`, `src/orchestrator/runner/task-watcher.ts`)**: Manage `.agents/tasks/<TASK_ID>/` lifecycle artifacts and subdirectories (`e2e-cache/`, `review/`), compute SHA-256 `content_hash`, synchronize metadata to `task_artifacts` inside `withTenantContext`, and watch `.agents/tasks/**/brief.md` via `chokidar` (debounced 200ms) to emit `task.inject` on minor body clarifications or `task.pivot` (`UPDATED` + worktree snapshot trigger) on scope/dependency frontmatter changes.
2. **Relative-Path Git Worktree Manager (`src/orchestrator/runner/worktree.ts`)**: Provision isolated Git worktrees (`git worktree add`) for `worktree-<taskId>` (including DAG branch stacking on a parent task's branch), rewrite `<worktree>/.git` to a relative `gitdir: ../../.git/worktrees/...` pointer for host/Docker container portability, and support `snapshotWorktree`, `restoreWorktree` (`git restore . && git clean -fd`), and `removeTaskWorktree`.
3. **Atomic Directory Locking & Startup GC (`src/orchestrator/runner/lock.ts`)**: Acquire atomic directory locks at `.agents/locks/<TASK_ID>.lock` via `proper-lockfile`, write `metadata.json` (`staleTimeoutMs: 30000`), emit 15-second heartbeats to `metadata.json` and `task_locks`, throw `GraywolfAppError('TASK_LOCK_CONTENTION')` (423) on contention, and provide `pruneStaleResourcesOnBoot()` to reclaim locks older than 60 seconds, prune orphan worktrees, and invoke container cleanup callbacks.
4. **3-Tier Adaptive Database Isolation Engine (`src/orchestrator/db/sandbox-db.ts`)**: Enforce the 4-level tier resolution hierarchy (Human Task Override > Pre-flight File Pattern Analyzer > Dev-Level-1 `plan.md` declaration > Global Config Default) and provision/teardown Tier 0 (`null` DB), Tier 1 (`CREATE SCHEMA IF NOT EXISTS task_<id>` + `search_path`), and Tier 2 (`CREATE DATABASE task_<id> TEMPLATE graywolf_template`).

## Technical Context

**Language/Version**: TypeScript 5.8+ on Node.js 20+ (`commonjs`)  
**Primary Dependencies**: `proper-lockfile` (`^4.1.2`), `picomatch` (`^4.0.2`), `chokidar` (`^3.6.0` / `^4.0.3`), `gray-matter` (`^4.0.3`), `pg` (`^8.23.0`), `@sinclair/typebox` (`^0.34.47`), `node:crypto`, `node:child_process`  
**Storage**: Local filesystem (`.agents/tasks/<TASK_ID>/`, `.agents/locks/<TASK_ID>.lock`, `.agents/worktrees/<TASK_ID>/`) + PostgreSQL 16 (`task_artifacts`, `task_locks`, and per-task schemas/template DB clones)  
**Testing**: Vitest (`tests/integration/task-store.test.ts`, `tests/integration/worktree.test.ts`, `tests/unit/lock.test.ts`, `tests/integration/sandbox-db.test.ts`)  
**Target Platform**: Linux / Dockerized Host Orchestrator  
**Project Type**: Multi-Agent Orchestrator Backend Service  
**Performance Goals**: Chokidar watcher debounce 200ms; lock heartbeat 15s / boot stale threshold 60s; Tier 2 PostgreSQL `TEMPLATE graywolf_template` clone <300ms  
**Constraints**: Relative `.git` pointers mandatory for container bind-mounts; strict SQL identifier sanitization on `taskId`; `withTenantContext` RLS enforcement on `task_artifacts` and `task_locks`; ADR-042 error codes (`TASK_LOCK_CONTENTION`, `GIT_WORKTREE_COLLISION`, `ACI_VALIDATION_FAILED`)  
**Scale/Scope**: Phase 4 of `docs/implementation-plan-detailed.md` (Tasks 4.1–4.4)

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **Principle 1 (Human Sovereignty & Non-Committing Relay Contract)**: ✅ PASS — Worktrees isolate task execution on `worktree-<taskId>` and `restoreWorktree` (`git restore . && git clean -fd`) resets uncommitted changes cleanly on Panic Button cancel without touching upstream branches.
- **Principle 2 (Zero Runtime Lock-In & Permissive Licensing)**: ✅ PASS — `chokidar` (MIT), `proper-lockfile` (MIT), `picomatch` (MIT), and PostgreSQL native `CREATE DATABASE ... TEMPLATE` are 100% permissive open-source.
- **Principle 3 (Single ACID Relational & Vector Baseline)**: ✅ PASS — Artifact hashes (`task_artifacts`), lock leases (`task_locks`), Tier 1 schemas, and Tier 2 template clones all run on the single PostgreSQL 16 baseline.
- **Principle 8 (Blast-Radius and Dependency Integrity)**: ✅ PASS — Directly implements the mid-flight minor clarification (`task.inject`) vs major pivot (`UPDATED` + worktree snapshot) watcher and the startup garbage-collection pass (`pruneStaleResourcesOnBoot()`) reclaiming stale locks (>60s), orphan worktrees, and dangling containers.
- **Principle 9 (Zero-Cost Open Source Foundation)**: ✅ PASS — Zero external SaaS dependencies.

## Project Structure

### Documentation (this feature)

```text
specs/006-worktrees-locks-sandbox-db/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output (/speckit-plan command)
├── data-model.md        # Phase 1 output (/speckit-plan command)
├── quickstart.md        # Phase 1 output (/speckit-plan command)
├── contracts/
│   └── worktrees-locks-db.md
└── tasks.md             # Phase 2 output (/speckit-tasks command)
```

### Source Code (repository root)

```text
src/orchestrator/
├── db/
│   ├── index.ts
│   └── sandbox-db.ts          # Task 4.4: 3-Tier Adaptive Database Isolation Engine
└── runner/
    ├── task-store.ts          # Task 4.1: .agents/tasks/<TASK_ID>/ artifact manager & DB sync
    ├── task-watcher.ts        # Task 4.1: Debounced (200ms) Chokidar watcher on brief.md
    ├── worktree.ts            # Task 4.2: Relative-path Git worktree manager, snapshot & restore
    └── lock.ts                # Task 4.3: proper-lockfile directory locks, 15s heartbeat & boot GC

tests/
├── unit/
│   └── lock.test.ts           # Task 4.3 verification
└── integration/
    ├── task-store.test.ts     # Task 4.1 verification
    ├── worktree.test.ts       # Task 4.2 verification
    └── sandbox-db.test.ts     # Task 4.4 verification
```

**Structure Decision**: Matches the exact file paths and module boundaries specified in `docs/implementation-plan-detailed.md` Phase 4 (Tasks 4.1–4.4).

## Complexity Tracking

No constitution violations or complexity exemptions required.
