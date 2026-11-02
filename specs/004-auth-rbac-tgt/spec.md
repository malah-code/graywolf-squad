# Feature Specification: 004-auth-rbac-tgt

**Feature Branch**: `004-auth-rbac-tgt`  
**Created**: 2026-10-18  
**Status**: Draft  
**Target Phase**: Phase 2 — Auth, Zero-Config Solo Seed, Casbin RBAC & WS TGT (`docs/implementation-plan-detailed.md`)  
**Input**: Master Phased Implementation Plan §Phase 2 (`specs/004-auth-rbac-tgt/`); `docs/architecture/session-token-and-cockpit-rbac.md`; `docs/architecture/error-taxonomy-and-structured-codes.md`; `docs/PRD.md` §11.2; ADR-039, ADR-042

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Zero-Config Solo Mode Seeding & Stateful Session Store with Instant Revocation (Priority: P1)

When an operator starts Graywolf Squad for the first time (`docker compose up` or local boot) on an empty database, the system automatically seeds a default `personal` organization, a default workspace, and a local `owner` administrator user (`PRD` §11.2 Zero-Config Solo Mode) so the developer can work immediately with zero login friction. User sessions are persisted in PostgreSQL (`sessions`) and cached in Valkey (`session:{sessionId}`) for sub-millisecond verification. When an administrator demotes a member, ejects a user, or logs out (`revokeUserSessions(userId)`), all active sessions for that user are immediately marked `revoked_at = NOW()` in PostgreSQL and deleted (`DEL`) from Valkey so any subsequent API or Chat Cockpit request fails immediately with `AUTH_SESSION_REVOKED` (401).

**Why this priority**: Stateful session authentication and instant Valkey revocation are the primary identity perimeter for both REST APIs and the Chat Cockpit (ADR-039), while Zero-Config Solo Mode guarantees out-of-the-box developer usability.

**Independent Test**: Run `seedSoloWorkspaceIfEmpty()` against an empty database (or mocked DB/Valkey layer), verify the default `personal` organization, workspace, and `owner` user are created idempotently, create a session cached in Valkey, invoke `revokeUserSessions(userId)`, and verify subsequent session lookups throw `GraywolfAppError('AUTH_SESSION_REVOKED')`.

**Acceptance Scenarios**:

1. **Given** an empty `organizations` table on startup, **When** the Zero-Config Solo Mode seeder runs, **Then** it creates a default `personal` organization, a default workspace, a local admin user, and an `owner` membership in `workspace_members` (and is a no-op on subsequent boots when `organizations` is non-empty).
2. **Given** a valid active session stored in Valkey under `session:{sessionId}`, **When** `verifySession(sessionToken)` is called, **Then** it resolves `{ userId, email, currentWorkspaceId, currentOrganizationId, role }` in sub-millisecond time.
3. **Given** an active user session, **When** `revokeUserSessions(userId)` is called (e.g., on role demotion or logout), **Then** `sessions.revoked_at` is set in PostgreSQL and all Valkey keys for that user are purged immediately; **When** the user's previous session token is presented again, **Then** verification rejects it with `AUTH_SESSION_REVOKED` (401).
4. **Given** a missing or expired session token, **When** `verifySession` is invoked, **Then** it throws `AUTH_SESSION_MISSING` (401) or `AUTH_SESSION_EXPIRED` (401).

---

### User Story 2 - Cryptographic One-Click Team Workspace Invites (Priority: P1)

An `owner` or `lead_dev` upgrades a solo workspace or invites collaborators by generating a shareable team invite link (`createWorkspaceInvite`). The platform generates a 32-byte cryptographically random hex token, returns the raw token only once in the invite URL, and stores only its `SHA-256` digest in `workspace_invites` along with `target_role` (`developer` | `viewer`), `expires_at`, `max_uses`, and `uses_count`. When an invitee redeems the token (`redeemWorkspaceInvite`), the system hashes the presented token, validates that the digest exists (`AUTH_INVITE_INVALID`), has not expired (`AUTH_INVITE_EXPIRED`), and has remaining uses (`uses_count < max_uses`, otherwise `AUTH_INVITE_EXHAUSTED`), atomically increments `uses_count`, and adds the user to `workspace_members`.

**Why this priority**: Enables seamless transition from Zero-Config Solo Mode to multi-user Team Mode without `.env` edits or container restarts (ADR-039, PRD §11.2).

**Independent Test**: Generate an invite via `createWorkspaceInvite`, verify only the 64-character SHA-256 hex hash is stored, redeem it validly via `redeemWorkspaceInvite`, and test rejection with `AUTH_INVITE_INVALID`, `AUTH_INVITE_EXPIRED`, and `AUTH_INVITE_EXHAUSTED`.

**Acceptance Scenarios**:

1. **Given** an authorized `owner` or `lead_dev`, **When** `createWorkspaceInvite` is called with `targetRole: 'developer'`, `expiresInHours: 168`, `maxUses: 2`, **Then** a 64-hex-character (32-byte) raw token is returned and its SHA-256 digest is persisted in `workspace_invites`.
2. **Given** a valid unredeemed invite token, **When** `redeemWorkspaceInvite` is called, **Then** `uses_count` increments by 1 and the user is inserted into `workspace_members` with `target_role`.
3. **Given** an unknown token, an expired token (`expires_at <= NOW()`), or an exhausted token (`uses_count >= max_uses`), **When** `redeemWorkspaceInvite` is called, **Then** it throws `AUTH_INVITE_INVALID` (400), `AUTH_INVITE_EXPIRED` (400), or `AUTH_INVITE_EXHAUSTED` (400) respectively.

---

### User Story 3 - Casbin RBAC Enforcer & Fastify Authorization Guard (Priority: P1)

Every REST endpoint and Chat Cockpit tool call is guarded by a server-authoritative Casbin RBAC enforcer (`config/rbac/model.conf`, `config/rbac/policy.csv`, `src/orchestrator/auth/rbac.ts`) implementing the 4-tier role hierarchy `owner > lead_dev > developer > viewer`. When an authenticated user attempts an action outside their role's permissions, the guard blocks execution before any handler runs and throws the exact ADR-042 domain error code (`RBAC_MERGE_NOT_AUTHORIZED`, `RBAC_KEY_MANAGEMENT_DENIED`, `RBAC_COCKPIT_TOOL_FORBIDDEN`, or `RBAC_INSUFFICIENT_ROLE` — all HTTP 403).

**Why this priority**: Enforces Zero Model Trust (Constitution Principle 7, ADR-039) so neither a low-privilege user nor a prompt-injected Chat Cockpit LLM can execute unauthorized mutations, merges, or budget changes.

**Independent Test**: Run `tests/unit/rbac.test.ts` evaluating all 4 roles (`viewer`, `developer`, `lead_dev`, `owner`) against all 19 canonical actions and verifying exact ADR-042 error codes on denial.

**Acceptance Scenarios**:

1. **Given** the Casbin role hierarchy `owner > lead_dev > developer > viewer`, **When** permissions are evaluated:
   - `viewer` is permitted only read-only actions (`list_workspaces`, `list_projects`, `list_tasks`, `ws_ticket_read`).
   - `developer` inherits `viewer` + `create_task`, `dispatch_task`, `answer_clarification`, `reorder_backlog`, `chat_turn`, `change_access_mode_pill`.
   - `lead_dev` inherits `developer` + `create_project`, `trigger_recon`, `modify_blast_radius`, `approve_review_gate`, `create_invite`, `promote_addon`.
   - `owner` inherits `lead_dev` + `manage_keys`, `manage_budgets`, `manage_team_roles`.
2. **Given** a non-`lead_dev`/`owner` attempting `approve_review_gate` (on `/tasks/:taskId/review-gate/approve`), **When** the RBAC guard runs, **Then** it throws `RBAC_MERGE_NOT_AUTHORIZED` (403).
3. **Given** a non-`owner` attempting `manage_keys` or `manage_budgets`, **When** the RBAC guard runs, **Then** it throws `RBAC_KEY_MANAGEMENT_DENIED` (403).
4. **Given** an unauthorized Chat Cockpit tool call or general endpoint action, **When** the RBAC guard runs, **Then** it throws `RBAC_COCKPIT_TOOL_FORBIDDEN` (403) or `RBAC_INSUFFICIENT_ROLE` (403).

---

### User Story 4 - Single-Use WebSocket Ticket-Granting Token (`GETDEL`) (Priority: P2)

To stream live container stdout/stderr or DAG telemetry over WebSockets without exposing long-lived session cookies in URL query strings, an authenticated client requests a short-lived Ticket-Granting Token (`mintWsTicket`). The server stores `tgt:{uuid}` in Valkey with a 15-second TTL (10s client validity + 5s server clock-skew grace window). When the client connects to the WebSocket and presents the ticket (`consumeWsTicket`), the server atomically reads and deletes `tgt:{uuid}` via Valkey `GETDEL` (or atomic script) and writes a 60-second tombstone key `tgt_used:{uuid}`. If an attacker or client replays a consumed ticket, the server detects `tgt_used:{uuid}` and throws `AUTH_TGT_ALREADY_USED` (401); if the ticket has expired or never existed, it throws `AUTH_TGT_EXPIRED` (401).

**Why this priority**: Protects real-time WebSocket streams from credential leakage in access logs and prevents token replay attacks (ADR-039).

**Independent Test**: Run `tests/unit/tgt.test.ts` testing `mintWsTicket` and `consumeWsTicket` across valid first-use consumption, immediate second-use replay (`AUTH_TGT_ALREADY_USED`), and expired/unknown ticket rejection (`AUTH_TGT_EXPIRED`).

**Acceptance Scenarios**:

1. **Given** a minted WebSocket ticket `{ userId, workspaceId, streamType, taskId }`, **When** `consumeWsTicket(ticket)` is called within 15 seconds for the first time, **Then** `tgt:{ticket}` is atomically removed from Valkey, `tgt_used:{ticket}` is recorded for 60s, and the ticket payload is returned.
2. **Given** a ticket that has already been consumed once, **When** `consumeWsTicket(ticket)` is called a second time within 60 seconds, **Then** it throws `GraywolfAppError('AUTH_TGT_ALREADY_USED')` (401, retryable: false).
3. **Given** a ticket whose 15s TTL has elapsed (and has no `tgt_used` tombstone), **When** `consumeWsTicket(ticket)` is called, **Then** it throws `GraywolfAppError('AUTH_TGT_EXPIRED')` (401, retryable: true).

---

### Edge Cases

- **Concurrent Invite Redemption Race Condition**: If two users attempt to redeem a single-use invite (`max_uses = 1`) simultaneously, the SQL `UPDATE workspace_invites SET uses_count = uses_count + 1 WHERE id = $1 AND uses_count < max_uses RETURNING *` inside a transaction ensures only one succeeds while the second receives `AUTH_INVITE_EXHAUSTED`.
- **Duplicate Workspace Membership on Invite Redeem**: If an existing member redeems an invite to a workspace they already belong to, `INSERT INTO workspace_members ... ON CONFLICT (workspace_id, user_id) DO NOTHING` prevents an unhandled unique constraint crash while preserving their existing role (or returning their membership cleanly).
- **Revoking a User with Multiple Active Device Sessions**: A user logged in across multiple browsers has multiple session tokens; maintaining a user-to-session index set in Valkey (`user_sessions:{userId}`) alongside `sessions` rows in PostgreSQL allows `revokeUserSessions(userId)` to `DEL` all active `session:{tokenHash}` keys in O(1) without scanning the entire keyspace.
- **Valkey Unavailable / Disconnected**: If Valkey or PostgreSQL is unreachable during unit testing, the auth/session/TGT modules support clean dependency injection (or an in-memory/ioredis-compatible store interface) while binding to the configured `VALKEY_URL` and `pool` in production.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST implement a Zero-Config Solo Mode seeder in `src/orchestrator/auth/solo-seed.ts` that checks if `organizations` is empty on startup and idempotently seeds a default `personal` organization, default workspace, and local `owner` user in `users` and `workspace_members`.
- **FR-002**: System MUST implement stateful session creation, verification, and revocation in `src/orchestrator/auth/better-auth.ts` backed by PostgreSQL (`sessions` table) and Valkey (`session:{sessionId}` -> `{ userId, email, currentWorkspaceId, currentOrganizationId, role }`).
- **FR-003**: System MUST implement `revokeUserSessions(userId)` in `src/orchestrator/auth/better-auth.ts` which sets `revoked_at = NOW()` in PostgreSQL `sessions` and immediately purges all active Valkey session keys for that user, causing subsequent requests with revoked tokens to throw `AUTH_SESSION_REVOKED` (401).
- **FR-004**: System MUST implement `createWorkspaceInvite` and `redeemWorkspaceInvite` in `src/orchestrator/auth/invites.ts` using 32-byte crypto-random hex tokens (`crypto.randomBytes(32).toString('hex')`) stored exclusively as `SHA-256` hex digests in `workspace_invites`, enforcing `target_role` (`developer` | `viewer`), `expires_at` (`AUTH_INVITE_EXPIRED`), `uses_count < max_uses` (`AUTH_INVITE_EXHAUSTED`), and hash existence (`AUTH_INVITE_INVALID`).
- **FR-005**: System MUST define the Casbin RBAC model (`config/rbac/model.conf`) and policy (`config/rbac/policy.csv`) with role hierarchy `owner > lead_dev > developer > viewer` and exact action mappings:
  - `viewer`: `list_workspaces`, `list_projects`, `list_tasks`, `ws_ticket_read`
  - `developer`: + `create_task`, `dispatch_task`, `answer_clarification`, `reorder_backlog`, `chat_turn`, `change_access_mode_pill`
  - `lead_dev`: + `create_project`, `trigger_recon`, `modify_blast_radius`, `approve_review_gate`, `create_invite`, `promote_addon`
  - `owner`: + `manage_keys`, `manage_budgets`, `manage_team_roles`
- **FR-006**: System MUST implement the Casbin RBAC enforcer and Fastify preHandler guard in `src/orchestrator/auth/rbac.ts` throwing exact ADR-042 taxonomy codes on denial: `RBAC_MERGE_NOT_AUTHORIZED` (403) on `approve_review_gate`, `RBAC_KEY_MANAGEMENT_DENIED` (403) on `manage_keys`/`manage_budgets`, `RBAC_COCKPIT_TOOL_FORBIDDEN` (403) on unauthorized cockpit tools, and `RBAC_INSUFFICIENT_ROLE` (403) on all other unauthorized actions.
- **FR-007**: System MUST implement `mintWsTicket({ userId, workspaceId, streamType, taskId })` and `consumeWsTicket(ticket)` in `src/orchestrator/auth/tgt.ts` using a 15s Valkey TTL on `tgt:{uuid}`, atomic `GETDEL`, and a 60s tombstone key `tgt_used:{uuid}` returning `AUTH_TGT_ALREADY_USED` (401) on replay and `AUTH_TGT_EXPIRED` (401) on expired/missing tickets.

### Key Entities

- **SessionPayload**: `{ sessionId: string; userId: string; email: string; currentWorkspaceId: string; currentOrganizationId: string; role: WorkspaceRole }` cached in Valkey under `session:{sessionId}` and persisted in PostgreSQL `sessions`.
- **WorkspaceInvite**: Cryptographic invite record in `workspace_invites` (`token_hash`, `target_role`, `max_uses`, `uses_count`, `expires_at`).
- **WorkspaceRole & RbacAction**: The 4 canonical roles (`owner`, `lead_dev`, `developer`, `viewer`) and 19 governed platform actions evaluated by Casbin.
- **WsTicketPayload**: `{ ticket: string; userId: string; workspaceId: string; streamType: string; taskId?: string; expiresAt: number }` stored ephemerally in Valkey (`tgt:{uuid}`) with tombstone tracking (`tgt_used:{uuid}`).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Zero-Config Solo Mode seeder provisions default organization, workspace, and `owner` user on first boot and is 100% idempotent on repeated invocations.
- **SC-002**: `revokeUserSessions(userId)` invalidates active sessions in Valkey immediately, and subsequent verification of a revoked session deterministically throws `AUTH_SESSION_REVOKED` (401).
- **SC-003**: `tests/unit/rbac.test.ts` verifies all 4 roles against all 19 actions (76 role-action combinations) with 100% accuracy and exact ADR-042 `RBAC_*` error codes.
- **SC-004**: `tests/unit/tgt.test.ts` and invite tests verify 100% of valid, expired, exhausted, and replayed token scenarios (`AUTH_TGT_ALREADY_USED`, `AUTH_TGT_EXPIRED`, `AUTH_INVITE_INVALID`, `AUTH_INVITE_EXPIRED`, `AUTH_INVITE_EXHAUSTED`).
- **SC-005**: `pnpm typecheck`, `pnpm lint`, `pnpm build`, and `pnpm test` pass with 0 errors and 0 warnings.

## Assumptions

- Valkey 7.2+ (via `ioredis` client already installed in `package.json`) and PostgreSQL 16 (via `pg` pool in `src/orchestrator/db/index.ts`) are the backing stores for sessions, invites, and TGTs.
- `casbin` (`^5.39.0`, Apache-2.0) and Node.js built-in `crypto` are used for RBAC policy evaluation and SHA-256 token hashing.
