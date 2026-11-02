# Implementation Plan: 005-control-plane-api-aci

**Branch**: `005-control-plane-api-aci` | **Date**: 2026-10-18 | **Spec**: [specs/005-control-plane-api-aci/spec.md](file:///home/tarikelmallah/Projects/GraywolfSquad/specs/005-control-plane-api-aci/spec.md)  
**Target Phase**: Phase 3 — Control Plane REST API (`/api/v1`) & ACI Validation (`docs/implementation-plan-detailed.md`)

## Summary

Phase 3 implements the Control Plane REST API (`/api/v1`) specified in `specs/001-multi-agent-platform/contracts/openapi.yaml` and the Agent-Computer Interface (ACI) Validation Gateway (ADR-066):
- **Task 3.1 (`src/orchestrator/routes/auth.ts`, `src/orchestrator/routes/workspaces.ts`)**: `GET /api/v1/auth/session`, `POST /api/v1/auth/logout`, `GET /api/v1/workspaces`, `POST /api/v1/workspaces/:workspaceId/invites`, and `POST /api/v1/invites/redeem`.
- **Task 3.2 (`src/orchestrator/routes/projects.ts`, `src/orchestrator/routes/tasks.ts`, `src/orchestrator/routes/telemetry.ts`)**: `GET /api/v1/projects`, `POST /api/v1/projects`, `POST /api/v1/projects/:projectId/recon` (202 queued), `GET /api/v1/tasks`, `POST /api/v1/tasks`, `POST /api/v1/tasks/:taskId/dispatch`, `POST /api/v1/tasks/:taskId/clarification`, `POST /api/v1/tasks/:taskId/review-gate/approve`, `POST /api/v1/tasks/:taskId/cancel` (Panic Button endpoint), and `POST /api/v1/telemetry/ws-ticket`.
- **Task 3.3 (`src/orchestrator/aci/tool-schemas.ts`, `src/orchestrator/aci/validate.ts`)**: Strict TypeBox schemas for all 7 Cockpit & Agent tools (`create_task`, `reorder_backlog`, `update_blocked_by`, `pause_container`, `cancel_task`, `approve_pr_merge`, `modify_blast_radius`) and `executeAuthorizedToolCall(userContext, toolName, rawArgs)` enforcing TypeBox validation first, Casbin RBAC (`RBAC_COCKPIT_TOOL_FORBIDDEN`) second, and tenant-scoped handler execution inside `withTenantContext` third.

## Technical Context

**Language/Version**: TypeScript 5.8+ / Node.js 20+  
**Primary Dependencies**: `fastify` (`^5.12.4`), `@sinclair/typebox` (`^0.34.47`), `pg` (`^8.23.0`), `ioredis` (`^5.6.1`), `casbin` (`^5.39.0`)  
**Storage**: PostgreSQL 16 (via `withTenantContext` from Phase 1) + Valkey 7.2 (via Phase 2 session/TGT store) + injectable in-memory repository fallback for offline Fastify `app.inject()` route tests  
**Testing**: `vitest` (`^3.0.8`) (`tests/integration/routes-auth-workspaces.test.ts`, `tests/integration/routes-projects-tasks.test.ts`, `tests/unit/aci-gateway.test.ts`)  
**Target Platform**: Linux / Node.js 20+ (Port 3000 Control Plane)  
**Project Type**: Multi-Agent Orchestrator Backend Service  
**Performance Goals**: `< 5ms` route dispatch and TypeBox/ACI validation latency  
**Constraints**: Every `/api/v1/*` route must enforce stateful session verification and Casbin RBAC (`requirePermission`); malformed tool calls must return `{ executed: false, authorized: true, error: "ACI_VALIDATION_FAILED: ..." }` without executing handlers; 0 `any` casts

## Constitution Check

*GATE: Must pass before Phase 3 tasks generation.*

- [x] **Chat as Active Control Plane / Cockpit Rule (Principle 7)**: `executeAuthorizedToolCall` enforces Zero Model Trust — validating tool arguments against TypeBox schemas and checking Casbin RBAC before executing any handler inside `withTenantContext`.
- [x] **Human Sovereignty & Non-Committing Relay Contract (Principle 1)**: `/api/v1/tasks/:taskId/review-gate/approve` and `approve_pr_merge` require `lead_dev` or `owner` role (`RBAC_MERGE_NOT_AUTHORIZED` / `RBAC_COCKPIT_TOOL_FORBIDDEN`).
- [x] **Blast-Radius & Dependency Integrity (Principle 8)**: `/api/v1/tasks/:taskId/dispatch` verifies all upstream tasks in `blockedBy` are `MERGED` before transitioning to `IN_PROGRESS` (`TASK_BLOCKED_BY_DEPENDENCIES`).
- [x] **Zero Runtime Lock-In & Permissive Licensing (Principle 2 & 9)**: Built natively on Fastify 5 + TypeBox + Casbin (MIT / Apache-2.0).

## Project Structure

### Documentation (this feature)

```text
specs/005-control-plane-api-aci/
├── spec.md              # Feature specification
├── plan.md              # This implementation plan
├── research.md          # Phase 0 research & technical decisions
├── data-model.md        # REST API & ACI payload models
├── quickstart.md        # Runnable verification guide
├── checklists/
│   └── requirements.md  # Specification quality checklist
└── contracts/
    └── openapi-aci.md   # Route & ACI tool contract specifications
```

### Source Code (repository root)

```text
GraywolfSquad/
├── src/
│   └── orchestrator/
│       ├── app.ts                       # Register authRoutes, workspaceRoutes, projectRoutes, taskRoutes, telemetryRoutes under /api/v1
│       ├── routes/
│       │   ├── auth.ts                  # Task 3.1: GET /api/v1/auth/session, POST /api/v1/auth/logout
│       │   ├── workspaces.ts            # Task 3.1: GET /api/v1/workspaces, POST /api/v1/workspaces/:workspaceId/invites, POST /api/v1/invites/redeem
│       │   ├── projects.ts              # Task 3.2: GET /api/v1/projects, POST /api/v1/projects, POST /api/v1/projects/:projectId/recon
│       │   ├── tasks.ts                 # Task 3.2: GET/POST /api/v1/tasks, dispatch, clarification, review-gate/approve, cancel
│       │   └── telemetry.ts             # Task 3.2: POST /api/v1/telemetry/ws-ticket
│       └── aci/
│           ├── tool-schemas.ts          # Task 3.3: TypeBox schemas & RBAC action mapping for all 7 Cockpit tools
│           └── validate.ts              # Task 3.3: executeAuthorizedToolCall(userContext, toolName, rawArgs)
└── tests/
    ├── unit/
    │   └── aci-gateway.test.ts          # Task 3.3: Invalid args, unauthorized role, and valid execution inside withTenantContext
    └── integration/
        ├── routes-auth-workspaces.test.ts  # Task 3.1: Route injection tests for /api/v1/auth/*, /api/v1/workspaces/*, /api/v1/invites/redeem
        └── routes-projects-tasks.test.ts   # Task 3.2: Route injection tests for /api/v1/projects/*, /api/v1/tasks/*, /api/v1/telemetry/ws-ticket
```

**Structure Decision**: Matches the exact file layout specified in `docs/implementation-plan-detailed.md` §2 and Phase 3 (Tasks 3.1–3.3).

---

## Detailed Component Specifications

### 1. Auth & Workspace Routes (`src/orchestrator/routes/auth.ts`, `src/orchestrator/routes/workspaces.ts` — Task 3.1)

- **`src/orchestrator/routes/auth.ts`**:
  - `GET /api/v1/auth/session`:
    - Extracts session token from `__session` cookie, `x-session-id` header, or `Authorization: Bearer <token>`.
    - Calls `verifySession(sessionId)`.
    - Returns HTTP 200 `{ userId, email, currentWorkspaceId, currentOrganizationId, role }`.
  - `POST /api/v1/auth/logout`:
    - Extracts session token and verifies via `verifySession(sessionId)`.
    - Calls `revokeSession(session.sessionId)`.
    - Clears `__session` cookie and returns HTTP 200 `{ success: true }`.
- **`src/orchestrator/routes/workspaces.ts`**:
  - `GET /api/v1/workspaces`:
    - Guarded by `requirePermission('list_workspaces')`.
    - Returns HTTP 200 array of `{ id, name, slug, role }` for the authenticated user (queries PostgreSQL `workspaces` + `workspace_members` or falls back to the active session workspace in memory).
  - `POST /api/v1/workspaces/:workspaceId/invites`:
    - Guarded by `requirePermission('create_invite')` (`lead_dev` or `owner`).
    - Validates path `{ workspaceId }` and body `{ targetRole: 'developer' | 'viewer', expiresInHours: integer (1..720), maxUses?: integer (min 1) }`.
    - Verifies `workspaceId === request.user.currentWorkspaceId` (or throws `RBAC_CROSS_TENANT_VIOLATION` 403).
    - Calls `createWorkspaceInvite({ workspaceId, invitedBy: request.user.userId, targetRole, expiresInHours, maxUses })`.
    - Returns HTTP 201 `{ inviteUrl, expiresAt, targetRole }`.
  - `POST /api/v1/invites/redeem`:
    - Requires an authenticated session (`verifySession`).
    - Validates body `{ token: string }`.
    - Calls `redeemWorkspaceInvite({ rawToken: body.token, userId: session.userId })`.
    - Returns HTTP 200 `{ workspaceId, role }`.

### 2. Project, Task Lifecycle & Telemetry Routes (`src/orchestrator/routes/projects.ts`, `tasks.ts`, `telemetry.ts` — Task 3.2)

- **`src/orchestrator/routes/projects.ts`**:
  - `GET /api/v1/projects`:
    - Guarded by `requirePermission('list_projects')`.
    - Executes inside `withTenantContext` (with clean in-memory store fallback when DB is offline in unit/injection tests) returning `Project[]` (`{ id, workspaceId, name, slug, mode, gitRemoteUrl, gitProvider }`).
  - `POST /api/v1/projects`:
    - Guarded by `requirePermission('create_project')` (`lead_dev`+).
    - Validates `CreateProjectRequest` (`{ name, slug, mode: 'greenfield' | 'brownfield', gitRemoteUrl, gitProvider?, credentialVaultKey? }`).
    - Creates project scoped to `request.user.currentWorkspaceId` and returns HTTP 201 `Project`.
  - `POST /api/v1/projects/:projectId/recon`:
    - Guarded by `requirePermission('trigger_recon')` (`lead_dev`+).
    - Returns HTTP 202 `{ reconJobId: crypto.randomUUID(), status: 'queued' }`.
- **`src/orchestrator/routes/tasks.ts`**:
  - `GET /api/v1/tasks`:
    - Guarded by `requirePermission('list_tasks')`.
    - Validates query `{ projectId: string (uuid), status?: string }`.
    - Returns HTTP 200 `Task[]`.
  - `POST /api/v1/tasks`:
    - Guarded by `requirePermission('create_task')` (`developer`+).
    - Validates `CreateTaskRequest` (`{ projectId, title, briefMarkdown, priority?: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL', blockedBy?: string[], writableScope?: string[], type?: 'feature' | 'bug' | 'refactor' | 'bug-bash-sprint' }`).
    - Creates task with status `'BACKLOG'` and returns HTTP 201 `Task`.
  - `POST /api/v1/tasks/:taskId/dispatch`:
    - Guarded by `requirePermission('dispatch_task')` (`developer`+).
    - Verifies task exists (`TASK_NOT_FOUND` 404), is not already `IN_PROGRESS` (`TASK_ALREADY_DISPATCHED` 409), and all task IDs in `blockedBy` have status `'MERGED'` (`TASK_BLOCKED_BY_DEPENDENCIES` 409).
    - Transitions task to `'IN_PROGRESS'` and returns HTTP 200 `{ taskId, status: 'IN_PROGRESS', containerId }`.
  - `POST /api/v1/tasks/:taskId/clarification`:
    - Guarded by `requirePermission('answer_clarification')` (`developer`+).
    - Validates body `{ answers: Array<{ questionId: string, answer: string }> }`.
    - Verifies task exists (`TASK_NOT_FOUND` 404), transitions task to `'IN_PROGRESS'`, and returns HTTP 200 `{ success: true, resumedStatus: 'IN_PROGRESS' }`.
  - `POST /api/v1/tasks/:taskId/review-gate/approve`:
    - Guarded by `requirePermission('approve_review_gate')` (`lead_dev`+ — throws `RBAC_MERGE_NOT_AUTHORIZED` 403 for `developer`/`viewer`).
    - Verifies task exists (`TASK_NOT_FOUND` 404), transitions task to `'MERGED'`, and returns HTTP 200 `{ taskId, mergedStatus: 'MERGED', prUrl }`.
  - `POST /api/v1/tasks/:taskId/cancel` (Panic Button endpoint):
    - Guarded by `requirePermission('dispatch_task')` (`developer`+).
    - Verifies task exists (`TASK_NOT_FOUND` 404), transitions task to `'CANCELLED'`, and returns HTTP 200 `{ taskId, status: 'CANCELLED', cancelled: true }`.
- **`src/orchestrator/routes/telemetry.ts`**:
  - `POST /api/v1/telemetry/ws-ticket`:
    - Guarded by `requirePermission('ws_ticket_read')` (`viewer`+).
    - Validates body `{ streamType: 'dag_updates' | 'terminal_feed' | 'active_logs', taskId?: string | null }`.
    - Calls `mintWsTicket({ userId, workspaceId, role, streamType, taskId })`.
    - Returns HTTP 200 `{ ticket, ttlSeconds, wsUrl: `ws://localhost:${env.PORT_CONTROL}/stream?ticket=${ticket}` }`.

### 3. Agent-Computer Interface (ACI) Validation Gateway (`src/orchestrator/aci/tool-schemas.ts` & `validate.ts` — Task 3.3)

- **`src/orchestrator/aci/tool-schemas.ts`**:
  - Defines strict TypeBox schemas (`additionalProperties: false`) for all 7 tools:
    1. `create_task`: `{ projectId: string (uuid), title: string (minLength 1), briefMarkdown: string (minLength 1), priority?: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL', blockedBy?: string[], writableScope?: string[] }` ➔ requires `'create_task'` (`developer`+)
    2. `reorder_backlog`: `{ projectId: string (uuid), orderedTaskIds: string[] (minItems 1) }` ➔ requires `'reorder_backlog'` (`developer`+)
    3. `update_blocked_by`: `{ taskId: string (pattern ^TASK-[0-9A-Z-]+$), blockedBy: string[] }` ➔ requires `'reorder_backlog'` (`developer`+)
    4. `pause_container`: `{ taskId: string (pattern ^TASK-[0-9A-Z-]+$), reason?: string }` ➔ requires `'dispatch_task'` (`developer`+)
    5. `cancel_task`: `{ taskId: string (pattern ^TASK-[0-9A-Z-]+$), reason?: string }` ➔ requires `'dispatch_task'` (`developer`+)
    6. `approve_pr_merge`: `{ taskId: string (pattern ^TASK-[0-9A-Z-]+$), comment?: string }` ➔ requires `'approve_review_gate'` (`lead_dev`+)
    7. `modify_blast_radius`: `{ projectId: string (uuid), writable: string[], readonly?: string[], forbidden?: string[] }` ➔ requires `'modify_blast_radius'` (`lead_dev`+)
- **`src/orchestrator/aci/validate.ts`**:
  - `executeAuthorizedToolCall(userContext: { userId: string; workspaceId: string; orgId?: string; role: WorkspaceRole }, toolName: string, rawArgs: unknown, customHandlers?: Partial<Record<CockpitToolName, ToolHandler>>)`:
    1. Looks up `toolName` in `COCKPIT_TOOL_SCHEMAS`. If unknown tool name, returns `{ toolName, executed: false, authorized: true, error: "ACI_VALIDATION_FAILED: Unknown tool '...'" }`.
    2. Validates `rawArgs` against the TypeBox schema using `Value.Check(schema, rawArgs)`. If invalid, collects `Value.Errors(schema, rawArgs)` and returns `{ toolName, executed: false, authorized: true, error: "ACI_VALIDATION_FAILED: ...", validationErrors }` without executing any handler.
    3. Evaluates Casbin RBAC via `enforcePermission(userContext.role, requiredAction, { isCockpitTool: true })`. If denied (`RBAC_COCKPIT_TOOL_FORBIDDEN`), logs an audit warning via Pino and returns `{ toolName, executed: false, authorized: false, error: "RBAC_COCKPIT_TOOL_FORBIDDEN" }`.
    4. Executes the tool handler inside `withTenantContext({ workspaceId: userContext.workspaceId, orgId: userContext.orgId }, (client) => handler(validatedArgs, userContext, client))` (gracefully falling back to direct handler execution when Postgres pool is offline in unit tests while still invoking `withTenantContext` when reachable/mocked) and returns `{ toolName, executed: true, authorized: true, result }`.

## Complexity Tracking

No Constitution violations. All components strictly follow the standard technology stack matrix.
