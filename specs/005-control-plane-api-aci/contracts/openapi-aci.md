# REST API & ACI Contracts: 005-control-plane-api-aci

## 1. REST Endpoints (`/api/v1`)

- **Auth (`src/orchestrator/routes/auth.ts`)**:
  - `GET /api/v1/auth/session` ➔ `200 SessionContext` | `401 AUTH_SESSION_MISSING / AUTH_SESSION_REVOKED`
  - `POST /api/v1/auth/logout` ➔ `200 { success: true }` | `401`
- **Workspaces (`src/orchestrator/routes/workspaces.ts`)**:
  - `GET /api/v1/workspaces` (`list_workspaces`) ➔ `200 Workspace[]`
  - `POST /api/v1/workspaces/:workspaceId/invites` (`create_invite`) ➔ `201 { inviteUrl, expiresAt, targetRole }` | `403 RBAC_INSUFFICIENT_ROLE`
  - `POST /api/v1/invites/redeem` (authenticated) ➔ `200 { workspaceId, role }` | `400 AUTH_INVITE_*`
- **Projects (`src/orchestrator/routes/projects.ts`)**:
  - `GET /api/v1/projects` (`list_projects`) ➔ `200 Project[]`
  - `POST /api/v1/projects` (`create_project`) ➔ `201 Project`
  - `POST /api/v1/projects/:projectId/recon` (`trigger_recon`) ➔ `202 { reconJobId, status: 'queued' }`
- **Tasks (`src/orchestrator/routes/tasks.ts`)**:
  - `GET /api/v1/tasks?projectId=...&status=...` (`list_tasks`) ➔ `200 Task[]`
  - `POST /api/v1/tasks` (`create_task`) ➔ `201 Task`
  - `POST /api/v1/tasks/:taskId/dispatch` (`dispatch_task`) ➔ `200 { taskId, status: 'IN_PROGRESS', containerId }` | `409 TASK_BLOCKED_BY_DEPENDENCIES / TASK_ALREADY_DISPATCHED`
  - `POST /api/v1/tasks/:taskId/clarification` (`answer_clarification`) ➔ `200 { success: true, resumedStatus: 'IN_PROGRESS' }`
  - `POST /api/v1/tasks/:taskId/review-gate/approve` (`approve_review_gate`) ➔ `200 { taskId, mergedStatus: 'MERGED', prUrl }` | `403 RBAC_MERGE_NOT_AUTHORIZED`
  - `POST /api/v1/tasks/:taskId/cancel` (`dispatch_task`) ➔ `200 { taskId, status: 'CANCELLED', cancelled: true }`
- **Telemetry (`src/orchestrator/routes/telemetry.ts`)**:
  - `POST /api/v1/telemetry/ws-ticket` (`ws_ticket_read`) ➔ `200 { ticket, ttlSeconds, wsUrl }`

## 2. ACI Validation Gateway (`src/orchestrator/aci/validate.ts`)

- `executeAuthorizedToolCall(userContext, toolName, rawArgs, customHandlers?): Promise<ToolExecutionRecord>`
