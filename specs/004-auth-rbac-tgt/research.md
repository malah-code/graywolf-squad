# Phase 2 Research: Auth, Zero-Config Solo Seed, Casbin RBAC & WS TGT

**Feature**: `004-auth-rbac-tgt`  
**Date**: 2026-10-18

## Decisions & Rationale

### 1. Instant Session Revocation with Tombstone Tracking in Valkey
- **Decision**: Store active sessions under `session:{sessionId}` with a user index set `user_sessions:{userId}`, and write a `session_revoked:{sessionId}` tombstone key in Valkey alongside `UPDATE sessions SET revoked_at = NOW()` when `revokeUserSessions(userId)` is called.
- **Rationale**: Ensures `verifySession(sessionId)` can distinguish between an unknown/missing session (`AUTH_SESSION_MISSING`) and a session that was actively revoked (`AUTH_SESSION_REVOKED`) in sub-millisecond time without needing a PostgreSQL round-trip on every revoked request.
- **Alternatives Considered**: Simply deleting `session:{sessionId}` without a tombstone or DB check — rejected because a deleted key alone would look identical to a missing/never-created token unless checked against a tombstone or `sessions.revoked_at`.

### 2. Atomic Single-Use WebSocket TGT via `GETDEL` + 60s Tombstone (`tgt_used:{uuid}`)
- **Decision**: Mint `tgt:{uuid}` with a 15s TTL (10s client validity + 5s grace). On `consumeWsTicket(uuid)`, atomically call `GETDEL tgt:{uuid}`. On success, set `tgt_used:{uuid}` with a 60s TTL. On `GETDEL` returning `null`, check `EXISTS tgt_used:{uuid}`: if present, throw `AUTH_TGT_ALREADY_USED` (401); otherwise throw `AUTH_TGT_EXPIRED` (401).
- **Rationale**: Directly implements Task 2.4 in `docs/implementation-plan-detailed.md` and ADR-039/ADR-042, guaranteeing single-use semantics and deterministic differentiation between replay attacks (`AUTH_TGT_ALREADY_USED`, non-retryable) and clock-skew/network expiration (`AUTH_TGT_EXPIRED`, retryable).
- **Alternatives Considered**: Keeping consumed tickets in `tgt:{uuid}` with a `{ used: true }` flag via non-atomic `GET` + `SET` — rejected because non-atomic read-modify-write allows race-condition replays under concurrent WebSocket handshakes.

### 3. Casbin Role Hierarchy & Context-Specific ADR-042 Error Mapping
- **Decision**: Configure Casbin with `[role_definition] g = _, _` and inheritance `owner > lead_dev > developer > viewer`, and map denied actions in `enforcePermission` to specific ADR-042 codes (`RBAC_MERGE_NOT_AUTHORIZED` for `approve_review_gate`, `RBAC_KEY_MANAGEMENT_DENIED` for `manage_keys`/`manage_budgets`, `RBAC_COCKPIT_TOOL_FORBIDDEN` when invoked from the Cockpit ACI gateway, and `RBAC_INSUFFICIENT_ROLE` for all other actions).
- **Rationale**: Satisfies Task 2.3 and ADR-042 without duplicating permission rules across multiple files.
