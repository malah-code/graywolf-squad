# Tasks: 004-auth-rbac-tgt

**Input**: Design documents from `/specs/004-auth-rbac-tgt/`  
**Prerequisites**: `plan.md`, `spec.md`, `research.md`, `data-model.md`, `contracts/auth-rbac.md`  
**Target Phase**: Phase 2 — Auth, Zero-Config Solo Seed, Casbin RBAC & WS TGT (`docs/implementation-plan-detailed.md`)

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: Which user story this task belongs to (`[US1]`, `[US2]`, `[US3]`, `[US4]`)
- Exact file paths are included in every task description.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Ensure directory structure and runtime dependencies (`ioredis`, `casbin`, `pg`) are ready for Phase 2 modules.

- [x] T001 Create `config/rbac/` and `src/orchestrator/auth/` directory structure and verify `ioredis` and `casbin` dependencies in `package.json`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Shared Valkey store and role/session type definitions used across `better-auth.ts` and `tgt.ts`.

- [x] T002 Implement shared Valkey client/store adapter and `WorkspaceRole` types in `src/orchestrator/auth/better-auth.ts` connecting via `env.VALKEY_URL` with injectable/in-memory fallback support for unit/integration testing

---

## Phase 3: User Story 1 - Zero-Config Solo Mode Seeding & Stateful Session Store with Instant Revocation (Priority: P1) 🎯 MVP

**Goal**: Seed default `personal` organization, workspace, and local `owner` user on first boot when `organizations` is empty, and manage stateful sessions in PostgreSQL + Valkey with immediate Valkey revocation (`AUTH_SESSION_REVOKED`).

**Independent Test**: Run `tests/integration/auth-invites-seed.test.ts` verifying idempotent first-boot seeding and instant Valkey revocation (`revokeUserSessions(userId)` -> `AUTH_SESSION_REVOKED`).

- [x] T003 [P] [US1] Implement `seedSoloWorkspaceIfEmpty` in `src/orchestrator/auth/solo-seed.ts` checking `organizations` count and seeding default `personal` organization, default workspace, local `owner` admin user, and `workspace_members` entry
- [x] T004 [US1] Implement `createSession`, `verifySession`, `revokeSession`, and `revokeUserSessions` in `src/orchestrator/auth/better-auth.ts` persisting to PostgreSQL `sessions` and Valkey (`session:{sessionId}`, `user_sessions:{userId}`, `session_revoked:{sessionId}`) and throwing `AUTH_SESSION_MISSING`, `AUTH_SESSION_EXPIRED`, and `AUTH_SESSION_REVOKED`
- [x] T005 [US1] Author integration tests for Zero-Config Solo Mode seeding and instant Valkey session revocation in `tests/integration/auth-invites-seed.test.ts`

---

## Phase 4: User Story 2 - Cryptographic One-Click Team Workspace Invites (Priority: P1)

**Goal**: Generate 32-byte crypto-random hex workspace invite tokens stored exclusively as `SHA-256` digests in `workspace_invites` and redeem them atomically with `AUTH_INVITE_INVALID`, `AUTH_INVITE_EXPIRED`, and `AUTH_INVITE_EXHAUSTED` enforcement.

**Independent Test**: Run `tests/integration/auth-invites-seed.test.ts` verifying SHA-256 digest storage, valid redemption into `workspace_members`, and error codes for invalid, expired, and exhausted tokens.

- [x] T006 [P] [US2] Implement `hashInviteToken`, `createWorkspaceInvite`, and `redeemWorkspaceInvite` in `src/orchestrator/auth/invites.ts` enforcing SHA-256 token hashing, `target_role` (`developer` | `viewer`), `expires_at` (`AUTH_INVITE_EXPIRED`), and `uses_count < max_uses` (`AUTH_INVITE_EXHAUSTED`)
- [x] T007 [US2] Add unit and integration test suites for `createWorkspaceInvite` and `redeemWorkspaceInvite` (valid, invalid, expired, exhausted) in `tests/integration/auth-invites-seed.test.ts`

---

## Phase 5: User Story 3 - Casbin RBAC Enforcer & Fastify Authorization Guard (Priority: P1)

**Goal**: Enforce the 4-tier role hierarchy (`owner > lead_dev > developer > viewer`) across all 19 platform actions and emit exact ADR-042 `RBAC_*` error codes on unauthorized access.

**Independent Test**: Run `tests/unit/rbac.test.ts` evaluating all 4 roles against all 19 actions and verifying `RBAC_MERGE_NOT_AUTHORIZED`, `RBAC_KEY_MANAGEMENT_DENIED`, `RBAC_COCKPIT_TOOL_FORBIDDEN`, and `RBAC_INSUFFICIENT_ROLE`.

- [x] T008 [P] [US3] Create Casbin RBAC model definition in `config/rbac/model.conf` and role hierarchy/permission policy in `config/rbac/policy.csv` (`owner > lead_dev > developer > viewer` across all 19 actions)
- [x] T009 [US3] Implement Casbin RBAC enforcer (`checkPermission`, `enforcePermission`) and Fastify preHandler guard (`requirePermission`) in `src/orchestrator/auth/rbac.ts` throwing `RBAC_MERGE_NOT_AUTHORIZED`, `RBAC_KEY_MANAGEMENT_DENIED`, `RBAC_COCKPIT_TOOL_FORBIDDEN`, and `RBAC_INSUFFICIENT_ROLE`
- [x] T010 [US3] Author comprehensive RBAC unit test suite in `tests/unit/rbac.test.ts` testing all 4 roles against all 19 actions and verifying exact ADR-042 error codes and Fastify guard behavior

---

## Phase 6: User Story 4 - Single-Use WebSocket Ticket-Granting Token (`GETDEL`) (Priority: P2)

**Goal**: Mint short-lived (15s TTL: 10s client + 5s grace) WebSocket tickets in Valkey (`tgt:{uuid}`) and consume them atomically via `GETDEL` with a 60s tombstone (`tgt_used:{uuid}`) to reject replays with `AUTH_TGT_ALREADY_USED` (401) and expired tickets with `AUTH_TGT_EXPIRED` (401).

**Independent Test**: Run `tests/unit/tgt.test.ts` verifying first-use consumption, replay rejection (`AUTH_TGT_ALREADY_USED`), and expiry rejection (`AUTH_TGT_EXPIRED`).

- [x] T011 [P] [US4] Implement `mintWsTicket` and `consumeWsTicket` in `src/orchestrator/auth/tgt.ts` using 15s Valkey TTL on `tgt:{uuid}`, atomic `GETDEL`, and 60s tombstone key `tgt_used:{uuid}`
- [x] T012 [US4] Author unit tests in `tests/unit/tgt.test.ts` testing valid ticket consumption, replay detection (`AUTH_TGT_ALREADY_USED`), and ticket expiry (`AUTH_TGT_EXPIRED`)

---

## Phase 7: Polish & Static Quality Gate

**Purpose**: Ensure zero TypeScript, ESLint, build, or test regressions across the repository.

- [x] T013 Run `pnpm typecheck && pnpm lint && pnpm build` to verify 0 TypeScript errors, 0 ESLint warnings, and clean compilation
- [x] T014 Run `pnpm test` to verify 100% passing unit and integration tests across all suites

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: No dependencies — starts immediately.
- **Phase 2 (Foundational)**: Depends on Phase 1 — provides shared Valkey store & role types.
- **User Stories (Phases 3–6)**:
  - **US1 (`solo-seed.ts`, `better-auth.ts`)**: Depends on Phase 2.
  - **US2 (`invites.ts`)**: Can run in parallel `[P]` with US1, US3, and US4.
  - **US3 (`config/rbac/*`, `rbac.ts`)**: Can run in parallel `[P]` with US1, US2, and US4.
  - **US4 (`tgt.ts`)**: Depends on Phase 2 Valkey adapter; can run in parallel `[P]` with US2 and US3.
- **Phase 7 (Polish & Verification)**: Depends on Phases 3–6 completion.

### Parallel Opportunities

- `T003` (`solo-seed.ts`), `T006` (`invites.ts`), `T008` (`config/rbac/*`), and `T011` (`tgt.ts`) touch completely disjoint files and can be implemented in parallel.
- `tests/unit/rbac.test.ts` (`T010`), `tests/unit/tgt.test.ts` (`T012`), and `tests/integration/auth-invites-seed.test.ts` (`T005`, `T007`) run in parallel in Vitest.

## Implementation Strategy

1. Complete **Phase 1 & Phase 2** (`T001`–`T002`) to establish the Valkey store abstraction and role types.
2. Implement **User Story 1 (`T003`–`T005`)** as the MVP authentication & Zero-Config Solo Mode baseline.
3. Implement **User Story 2 (`T006`–`T007`)**, **User Story 3 (`T008`–`T010`)**, and **User Story 4 (`T011`–`T012`)**.
4. Execute **Phase 7 (`T013`–`T014`)** static checks and test suites.
