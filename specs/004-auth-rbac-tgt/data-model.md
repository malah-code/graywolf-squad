# Data Model: 004-auth-rbac-tgt

**Feature**: `004-auth-rbac-tgt`

## 1. Valkey Keyspace Schema

| Key Pattern | Value Type | TTL | Purpose |
|---|---|---|---|
| `session:{sessionId}` | JSON (`SessionData`) | 7 days (configurable) | Sub-1ms active session lookup (`userId`, `email`, `currentWorkspaceId`, `currentOrganizationId`, `role`) |
| `user_sessions:{userId}` | Set (`sessionId[]`) | 7 days | O(1) lookup of all active sessions for a user during `revokeUserSessions(userId)` |
| `session_revoked:{sessionId}` | String (`"1"`) | 24 hours | Fast-path tombstone so revoked tokens immediately return `AUTH_SESSION_REVOKED` (401) |
| `tgt:{uuid}` | JSON (`WsTicketPayload`) | 15 seconds (10s + 5s grace) | Single-use WebSocket Ticket-Granting Token consumed via `GETDEL` |
| `tgt_used:{uuid}` | String (`"1"`) | 60 seconds | Tombstone recording consumed TGTs so replays return `AUTH_TGT_ALREADY_USED` (401) |

## 2. Casbin RBAC Matrix (`owner > lead_dev > developer > viewer`)

| Role | Inherited Roles | Directly Assigned Actions | Total Permitted Actions |
|---|---|---|---|
| `viewer` | *(none)* | `list_workspaces`, `list_projects`, `list_tasks`, `ws_ticket_read` | 4 |
| `developer` | `viewer` | `create_task`, `dispatch_task`, `answer_clarification`, `reorder_backlog`, `chat_turn`, `change_access_mode_pill` | 10 |
| `lead_dev` | `developer`, `viewer` | `create_project`, `trigger_recon`, `modify_blast_radius`, `approve_review_gate`, `create_invite`, `promote_addon` | 16 |
| `owner` | `lead_dev`, `developer`, `viewer` | `manage_keys`, `manage_budgets`, `manage_team_roles` | 19 |
