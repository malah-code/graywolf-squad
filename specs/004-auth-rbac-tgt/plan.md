# Implementation Plan: 004-auth-rbac-tgt

**Branch**: `004-auth-rbac-tgt` | **Date**: 2026-10-18 | **Spec**: [specs/004-auth-rbac-tgt/spec.md](file:///home/tarikelmallah/Projects/GraywolfSquad/specs/004-auth-rbac-tgt/spec.md)  
**Target Phase**: Phase 2 — Auth, Zero-Config Solo Seed, Casbin RBAC & WS TGT (`docs/implementation-plan-detailed.md`)

## Summary

Phase 2 implements the complete authentication, workspace onboarding, authorization, and WebSocket ticket-granting layer for Graywolf Squad (ADR-039, ADR-042):
- **Task 2.1 (`src/orchestrator/auth/solo-seed.ts`, `src/orchestrator/auth/better-auth.ts`)**: Zero-Config Solo Mode seeder on first boot (`organizations` empty ➔ seed default `personal` organization, workspace, and local `owner` admin user) and stateful session store backed by PostgreSQL (`sessions`) and Valkey (`session:{sessionId}`) with instant session revocation (`revokeUserSessions(userId)` ➔ `AUTH_SESSION_REVOKED`).
- **Task 2.2 (`src/orchestrator/auth/invites.ts`)**: Cryptographic team workspace invites (`createWorkspaceInvite` & `redeemWorkspaceInvite`) using 32-byte random hex tokens (`crypto.randomBytes(32)`) stored only as `SHA-256` hex digests in `workspace_invites`, enforcing `target_role`, `expires_at`, and `uses_count < max_uses`.
- **Task 2.3 (`config/rbac/model.conf`, `config/rbac/policy.csv`, `src/orchestrator/auth/rbac.ts`)**: Casbin RBAC enforcer and Fastify guard enforcing the 4-tier role hierarchy (`owner > lead_dev > developer > viewer`) across all 19 platform actions and throwing exact ADR-042 `RBAC_*` error codes.
- **Task 2.4 (`src/orchestrator/auth/tgt.ts`)**: Single-use WebSocket Ticket-Granting Token (`mintWsTicket` & `consumeWsTicket`) using a 15s Valkey TTL (`tgt:{uuid}`), atomic `GETDEL`, and a 60s tombstone key (`tgt_used:{uuid}`) returning `AUTH_TGT_ALREADY_USED` (401) on replay and `AUTH_TGT_EXPIRED` (401) on expiry.

## Technical Context

**Language/Version**: TypeScript 5.8+ / Node.js 20+  
**Primary Dependencies**: `ioredis` (`^5.6.1` for Valkey 7.2+), `pg` (`^8.23.0`), `casbin` (`^5.39.0`), Node.js native `crypto`, `fastify` (`^5.12.4`)  
**Storage**: PostgreSQL 16 (`organizations`, `workspaces`, `users`, `workspace_members`, `workspace_invites`, `sessions`) + Valkey 7.2 (`session:{sessionId}`, `session_revoked:{sessionId}`, `user_sessions:{userId}`, `tgt:{uuid}`, `tgt_used:{uuid}`)  
**Testing**: `vitest` (`^3.0.8`) for unit and integration tests (`tests/unit/rbac.test.ts`, `tests/unit/tgt.test.ts`, `tests/integration/auth-invites-seed.test.ts`)  
**Target Platform**: Linux / Node.js 20+  
**Project Type**: Multi-Agent Orchestrator Backend Service  
**Performance Goals**: `< 1ms` Valkey session verification and TGT `GETDEL` consumption; `< 2ms` in-memory Casbin RBAC evaluation  
**Constraints**: Zero stateless JWTs for human user sessions (must support instant Valkey revocation); zero plaintext invite tokens in PostgreSQL; 0 `any` casts (ESLint strict compliance)

## Constitution Check

*GATE: Must pass before Phase 2 tasks generation.*

- [x] **Zero Runtime Lock-In & Permissive Licensing (Principle 2 & 9)**: Uses `casbin` (Apache-2.0), `ioredis` + Valkey (BSD-3-Clause), PostgreSQL (`pg`), and Node.js native `crypto` ($0 platform license cost, 100% offline capable).
- [x] **Chat as Active Control Plane / Cockpit Rule (Principle 7)**: Server-authoritative Casbin RBAC interceptor validates every state-modifying tool call and REST action against the authenticated user's permission level before execution (`RBAC_COCKPIT_TOOL_FORBIDDEN`, `RBAC_INSUFFICIENT_ROLE`, `RBAC_MERGE_NOT_AUTHORIZED`, `RBAC_KEY_MANAGEMENT_DENIED`).
- [x] **Human Sovereignty & Non-Committing Relay Contract (Principle 1)**: `approve_review_gate` is strictly gated to `lead_dev` and `owner` roles (`RBAC_MERGE_NOT_AUTHORIZED` for `developer` and `viewer`).
- [x] **Single ACID Relational Baseline (Principle 3)**: Uses the canonical Phase 1 PostgreSQL tenancy tables (`organizations`, `workspaces`, `users`, `workspace_members`, `workspace_invites`, `sessions`).

## Project Structure

### Documentation (this feature)

```text
specs/004-auth-rbac-tgt/
├── spec.md              # Feature specification
├── plan.md              # This implementation plan
├── research.md          # Phase 0 research & technical decisions
├── data-model.md        # Session, Invite, RBAC & TGT state models
├── quickstart.md        # Runnable verification guide
├── checklists/
│   └── requirements.md  # Specification quality checklist
└── contracts/
    └── auth-rbac.md     # Function & Fastify guard contracts
```

### Source Code (repository root)

```text
GraywolfSquad/
├── config/
│   └── rbac/
│       ├── model.conf                       # Casbin RBAC with role hierarchy (g = _, _)
│       └── policy.csv                       # Role permissions & inheritance rules (owner > lead_dev > developer > viewer)
├── src/
│   └── orchestrator/
│       └── auth/
│           ├── solo-seed.ts                 # Task 2.1: Zero-Config Solo Mode first-boot seeder
│           ├── better-auth.ts               # Task 2.1: Valkey + Postgres session store & revokeUserSessions
│           ├── invites.ts                   # Task 2.2: createWorkspaceInvite & redeemWorkspaceInvite (SHA-256)
│           ├── rbac.ts                      # Task 2.3: Casbin RBAC enforcer & Fastify guard
│           └── tgt.ts                       # Task 2.4: mintWsTicket & consumeWsTicket (GETDEL + tombstone)
└── tests/
    ├── unit/
    │   ├── rbac.test.ts                     # Task 2.3: All 4 roles against all 19 actions + exact RBAC_* codes
    │   └── tgt.test.ts                      # Task 2.4: Valid consumption, replay (AUTH_TGT_ALREADY_USED), expiry (AUTH_TGT_EXPIRED)
    └── integration/
        └── auth-invites-seed.test.ts        # Tasks 2.1 & 2.2: First-boot solo seed, session revocation (AUTH_SESSION_REVOKED), and invite create/redeem/expired/exhausted
```

**Structure Decision**: Matches the exact file layout specified in `docs/implementation-plan-detailed.md` §2 and Phase 2 (Tasks 2.1–2.4).

---

## Detailed Component Specifications

### 1. Zero-Config Solo Mode Seeder & Stateful Session Store (`src/orchestrator/auth/solo-seed.ts` & `better-auth.ts` — Task 2.1)

- **Valkey Store Abstraction (`ValkeyStoreLike`)**:
  - Connects to `env.VALKEY_URL` via `ioredis` (`lazyConnect: true`) in production, while allowing an injectable store interface (or automatic fallback) for deterministic unit/integration tests when Valkey/Postgres are offline.
- **`seedSoloWorkspaceIfEmpty(dbClient?)` (`src/orchestrator/auth/solo-seed.ts`)**:
  - Queries `SELECT COUNT(*)::int AS count FROM organizations`.
  - If `count === 0`, executes a transaction inserting:
    - Organization: `{ slug: 'personal', name: 'Personal Organization', plan_tier: 'community', mode: 'personal' }`
    - Workspace: `{ name: 'Default Workspace', slug: 'default' }`
    - User: `{ email: 'admin@graywolf.local', full_name: 'Solo Owner' }`
    - Workspace Member: `{ role: 'owner' }`
  - Returns `{ seeded: boolean, organizationId, workspaceId, userId, role: 'owner' }`.
- **Session Store (`src/orchestrator/auth/better-auth.ts`)**:
  - `SessionData`: `{ sessionId: string; userId: string; email: string; currentWorkspaceId: string; currentOrganizationId: string; role: WorkspaceRole; expiresAt: string }`.
  - `createSession(input)`:
    1. Generates `sessionId` (or uses provided ID) and `tokenHash = sha256(sessionId)`.
    2. Inserts into PostgreSQL `sessions` (`id`, `user_id`, `workspace_id`, `token_hash`, `expires_at`, `ip_address`, `user_agent`).
    3. Stores JSON in Valkey key `session:{sessionId}` with TTL seconds (`SET key value EX ttl`), and adds `sessionId` to set `user_sessions:{userId}`.
  - `verifySession(sessionId?: string)`:
    1. If `!sessionId`, throws `GraywolfAppError('AUTH_SESSION_MISSING', 'No session token provided')`.
    2. Checks Valkey tombstone `session_revoked:{sessionId}`; if present, throws `GraywolfAppError('AUTH_SESSION_REVOKED', 'Session has been revoked')`.
    3. Reads Valkey `session:{sessionId}`. If found, checks `expiresAt` (`AUTH_SESSION_EXPIRED` if expired) and returns `SessionData`.
    4. If cache miss, checks PostgreSQL `sessions` (if DB is connected): if `revoked_at IS NOT NULL`, throws `AUTH_SESSION_REVOKED`; if `expires_at <= NOW()`, throws `AUTH_SESSION_EXPIRED`; if missing, throws `AUTH_SESSION_MISSING`.
  - `revokeUserSessions(userId: string)`:
    1. Updates PostgreSQL: `UPDATE sessions SET revoked_at = NOW() WHERE user_id = $1 AND revoked_at IS NULL RETURNING id`.
    2. Reads all `sessionId`s from Valkey `user_sessions:{userId}` (plus any returned from Postgres), `DEL`s `session:{sessionId}`, sets `session_revoked:{sessionId}` tombstone in Valkey (TTL 86400s), and `DEL`s `user_sessions:{userId}`.
  - `revokeSession(sessionId: string)`:
    1. Marks `revoked_at = NOW()` for that single session in Postgres, `DEL`s `session:{sessionId}` in Valkey, and sets `session_revoked:{sessionId}` tombstone.

### 2. Cryptographic Workspace Invites (`src/orchestrator/auth/invites.ts` — Task 2.2)

- **`hashInviteToken(rawToken: string): string`**:
  - `crypto.createHash('sha256').update(rawToken).digest('hex')`.
- **`createWorkspaceInvite(input: { workspaceId: string; invitedBy: string; targetRole?: 'developer' | 'viewer'; expiresInHours?: number; maxUses?: number; baseUrl?: string })`**:
  1. Generates 32-byte crypto-random hex token: `const rawToken = crypto.randomBytes(32).toString('hex')` (64 hex chars).
  2. Computes `tokenHash = hashInviteToken(rawToken)`.
  3. Computes `expiresAt = new Date(Date.now() + (expiresInHours ?? 168) * 3600 * 1000)`.
  4. Persists `{ workspace_id, invited_by, token_hash, target_role, max_uses, uses_count: 0, expires_at }` into `workspace_invites`.
  5. Returns `{ inviteId, rawToken, tokenHash, inviteUrl: `${baseUrl}/invite/join?token=${rawToken}`, targetRole, maxUses, expiresAt: expiresAt.toISOString() }`.
- **`redeemWorkspaceInvite(input: { rawToken: string; userId: string })`**:
  1. Computes `tokenHash = hashInviteToken(rawToken)`.
  2. Looks up invite by `token_hash` in `workspace_invites`:
     - If not found ➔ throws `GraywolfAppError('AUTH_INVITE_INVALID', 'Invite token hash not found')` (400).
     - If `new Date(invite.expires_at).getTime() <= Date.now()` ➔ throws `GraywolfAppError('AUTH_INVITE_EXPIRED', 'Invite token has expired')` (400).
     - If `invite.uses_count >= invite.max_uses` ➔ throws `GraywolfAppError('AUTH_INVITE_EXHAUSTED', 'Invite token has reached maximum uses')` (400).
  3. Atomically increments `uses_count` (`UPDATE workspace_invites SET uses_count = uses_count + 1 WHERE id = $1 AND uses_count < max_uses`) and inserts membership (`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, $3) ON CONFLICT (workspace_id, user_id) DO UPDATE SET role = EXCLUDED.role`).
  4. Returns `{ workspaceId, userId, role: invite.target_role, usesCount: invite.uses_count + 1 }`.

### 3. Casbin RBAC Enforcer & Fastify Guard (`config/rbac/model.conf`, `config/rbac/policy.csv`, `src/orchestrator/auth/rbac.ts` — Task 2.3)

- **`config/rbac/model.conf`**:
  ```ini
  [request_definition]
  r = sub, act

  [policy_definition]
  p = sub, act

  [role_definition]
  g = _, _

  [policy_effect]
  e = some(where (p.eft == allow))

  [matchers]
  m = g(r.sub, p.sub) && r.act == p.act
  ```
- **`config/rbac/policy.csv`**:
  - Role permissions (`p`):
    - `viewer`: `list_workspaces`, `list_projects`, `list_tasks`, `ws_ticket_read`
    - `developer`: `create_task`, `dispatch_task`, `answer_clarification`, `reorder_backlog`, `chat_turn`, `change_access_mode_pill`
    - `lead_dev`: `create_project`, `trigger_recon`, `modify_blast_radius`, `approve_review_gate`, `create_invite`, `promote_addon`
    - `owner`: `manage_keys`, `manage_budgets`, `manage_team_roles`
  - Role hierarchy (`g`):
    - `g, owner, lead_dev`
    - `g, lead_dev, developer`
    - `g, developer, viewer`
- **`src/orchestrator/auth/rbac.ts`**:
  - `checkPermission(role: WorkspaceRole, action: RbacAction): Promise<boolean>`
  - `enforcePermission(role: WorkspaceRole, action: RbacAction, options?: { isCockpitTool?: boolean }): Promise<void>`:
    - Evaluates Casbin enforcer. If allowed, returns cleanly.
    - If denied, throws exact ADR-042 error:
      - If `options?.isCockpitTool === true` ➔ `GraywolfAppError('RBAC_COCKPIT_TOOL_FORBIDDEN', ...)` (403)
      - If `action === 'approve_review_gate'` ➔ `GraywolfAppError('RBAC_MERGE_NOT_AUTHORIZED', ...)` (403)
      - If `action === 'manage_keys' || action === 'manage_budgets'` ➔ `GraywolfAppError('RBAC_KEY_MANAGEMENT_DENIED', ...)` (403)
      - Otherwise ➔ `GraywolfAppError('RBAC_INSUFFICIENT_ROLE', ...)` (403)
  - `requirePermission(action: RbacAction)`: Fastify `preHandler` hook extracting the authenticated user's role from request session context and calling `enforcePermission(role, action)`.

### 4. Single-Use WebSocket Ticket-Granting Token (`src/orchestrator/auth/tgt.ts` — Task 2.4)

- **`mintWsTicket(input: { userId: string; workspaceId: string; streamType: string; taskId?: string })`**:
  - Generates `ticket = crypto.randomUUID()`.
  - Stores JSON `{ ticket, userId, workspaceId, streamType, taskId, mintedAt: Date.now() }` in Valkey key `tgt:${ticket}` with a **15-second TTL** (10s client TTL + 5s server grace).
  - Returns `{ ticket, ttlSeconds: 10, graceSeconds: 5, expiresAt: new Date(Date.now() + 10000).toISOString() }`.
- **`consumeWsTicket(ticket: string)`**:
  - Atomically executes `GETDEL tgt:${ticket}` in Valkey:
    1. If a payload is returned:
       - Writes tombstone key `tgt_used:${ticket}` with a **60-second TTL** (`SET tgt_used:${ticket} "1" EX 60`).
       - Parses and returns the `WsTicketPayload`.
    2. If `GETDEL` returns `null`:
       - Checks if tombstone key `tgt_used:${ticket}` exists in Valkey.
       - If `tgt_used:${ticket}` exists ➔ throws `GraywolfAppError('AUTH_TGT_ALREADY_USED', 'WebSocket ticket has already been consumed')` (401, retryable: false).
       - Otherwise ➔ throws `GraywolfAppError('AUTH_TGT_EXPIRED', 'WebSocket ticket has expired or is invalid')` (401, retryable: true).

## Complexity Tracking

No Constitution violations. All components strictly adhere to the standard technology stack matrix and ADR-039/ADR-042.
