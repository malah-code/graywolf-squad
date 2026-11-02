# Feature Specification: 005-control-plane-api-aci

**Feature Branch**: `005-control-plane-api-aci`  
**Created**: 2026-10-18  
**Status**: Draft  
**Target Phase**: Phase 3 — Control Plane REST API (`/api/v1`) & ACI Validation (`docs/implementation-plan-detailed.md`)  
**Input**: Master Phased Implementation Plan §Phase 3 (`specs/005-control-plane-api-aci/`); `specs/001-multi-agent-platform/contracts/openapi.yaml`; `docs/architecture/session-token-and-cockpit-rbac.md`; ADR-039, ADR-042, ADR-066

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Authentication, Session Context & Workspace Invite REST API (`/api/v1/auth/*`, `/api/v1/workspaces/*`, `/api/v1/invites/redeem`) (Priority: P1)

An authenticated operator or web dashboard interacts with the Control Plane REST API on Port 3000 under `/api/v1` to inspect their active session (`GET /api/v1/auth/session`), terminate their session (`POST /api/v1/auth/logout`), list their accessible workspaces (`GET /api/v1/workspaces`), generate cryptographic shareable workspace invite links (`POST /api/v1/workspaces/:workspaceId/invites`, restricted to `lead_dev` and `owner`), and redeem invite links (`POST /api/v1/invites/redeem`). Every route enforces stateful Valkey session authentication, Casbin RBAC permissions, and TypeBox request/response validation matching `specs/001-multi-agent-platform/contracts/openapi.yaml`.

**Why this priority**: Provides the foundational HTTP entrypoints for user identity, workspace selection, and team onboarding required by the web dashboard and CLI clients.

**Independent Test**: Run Fastify route injection tests (`tests/integration/routes-auth-workspaces.test.ts`) verifying HTTP 200/201 responses for valid sessions, HTTP 401 (`AUTH_SESSION_MISSING` / `AUTH_SESSION_REVOKED`) for missing or logged-out sessions, HTTP 403 (`RBAC_INSUFFICIENT_ROLE`) when a `developer` or `viewer` attempts to create an invite, and HTTP 200/400 on invite redemption.

**Acceptance Scenarios**:

1. **Given** an active session cookie (`__session`) or session header, **When** `GET /api/v1/auth/session` is requested, **Then** the server responds with HTTP 200 and `{ userId, email, currentWorkspaceId, currentOrganizationId, role }`.
2. **Given** an active session, **When** `POST /api/v1/auth/logout` is requested, **Then** the session is immediately revoked in Valkey and PostgreSQL and returns HTTP 200 `{ success: true }`, and a subsequent `GET /api/v1/auth/session` with the same token returns HTTP 401 (`AUTH_SESSION_REVOKED`).
3. **Given** an authenticated `lead_dev` or `owner`, **When** `POST /api/v1/workspaces/:workspaceId/invites` is called with `{ targetRole: 'developer', expiresInHours: 168, maxUses: 2 }`, **Then** it returns HTTP 201 with `{ inviteUrl, expiresAt, targetRole }`; **When** called by a `viewer` or `developer`, **Then** it returns HTTP 403 (`RBAC_INSUFFICIENT_ROLE`).
4. **Given** a valid raw invite token, **When** an authenticated user calls `POST /api/v1/invites/redeem` with `{ token }`, **Then** it returns HTTP 200 `{ workspaceId, role }`.

---

### User Story 2 - Project, Task Lifecycle, Panic Button & WebSocket Ticket REST API (`/api/v1/projects/*`, `/api/v1/tasks/*`, `/api/v1/telemetry/ws-ticket`) (Priority: P1)

Developers and lead engineers manage projects, engineering tasks, lifecycle gates, and live telemetry tickets through `/api/v1`:
- **Projects**: List workspace projects (`GET /api/v1/projects`), onboard a new Greenfield or Brownfield project (`POST /api/v1/projects`, requires `lead_dev`+), and trigger a brownfield reconnaissance scan (`POST /api/v1/projects/:projectId/recon`, returns HTTP 202 `{ reconJobId, status: 'queued' }`, requires `lead_dev`+).
- **Tasks**: Query tasks by `projectId` and optional `status` (`GET /api/v1/tasks`), create a new task (`POST /api/v1/tasks`, requires `developer`+), dispatch a task to an execution sandbox (`POST /api/v1/tasks/:taskId/dispatch`, requires `developer`+, enforcing `blockedBy` dependency checks), resolve an `AWAITING_CLARIFICATION` subtask (`POST /api/v1/tasks/:taskId/clarification`, requires `developer`+), approve the human review gate (`POST /api/v1/tasks/:taskId/review-gate/approve`, requires `lead_dev`+ or throws `RBAC_MERGE_NOT_AUTHORIZED` 403), and trigger the emergency **Panic Button** cancellation (`POST /api/v1/tasks/:taskId/cancel`, transitions task to `CANCELLED`).
- **Telemetry WS Ticket**: Mint a single-use WebSocket Ticket-Granting Token (`POST /api/v1/telemetry/ws-ticket`, requires `viewer`+ `ws_ticket_read`) returning `{ ticket, ttlSeconds, wsUrl }`.

**Why this priority**: Exposes the complete project and task orchestration control plane specified in `openapi.yaml` and Phase 3 Task 3.2.

**Independent Test**: Run Fastify route injection tests (`tests/integration/routes-projects-tasks.test.ts`) exercising project creation, recon queueing, task creation, dispatch, clarification answer submission, review-gate approval (`lead_dev` vs `developer` 403 `RBAC_MERGE_NOT_AUTHORIZED`), task cancellation (`/cancel`), and WS ticket minting.

**Acceptance Scenarios**:

1. **Given** an authenticated `lead_dev`, **When** `POST /api/v1/projects` and `POST /api/v1/projects/:projectId/recon` are invoked, **Then** the project is created (HTTP 201) and recon returns HTTP 202 `{ reconJobId, status: 'queued' }`.
2. **Given** an authenticated `developer`, **When** `POST /api/v1/tasks` is called with `{ projectId, title, briefMarkdown, priority, blockedBy, writableScope }`, **Then** a new task is created with status `BACKLOG` (HTTP 201) and returned by `GET /api/v1/tasks?projectId=...`.
3. **Given** an existing task, **When** `POST /api/v1/tasks/:taskId/dispatch`, `POST /api/v1/tasks/:taskId/clarification`, and `POST /api/v1/tasks/:taskId/cancel` are called by an authorized user, **Then** the task transitions states deterministically (`IN_PROGRESS`, resumed `IN_PROGRESS`, `CANCELLED`).
4. **Given** a task at `HUMAN_REVIEW_GATE`, **When** a `developer` calls `POST /api/v1/tasks/:taskId/review-gate/approve`, **Then** it is rejected with HTTP 403 and code `RBAC_MERGE_NOT_AUTHORIZED`; **When** a `lead_dev` or `owner` calls it, **Then** it succeeds with HTTP 200 `{ taskId, mergedStatus: 'MERGED', prUrl }`.
5. **Given** an authenticated `viewer`, **When** `POST /api/v1/telemetry/ws-ticket` is called with `{ streamType: 'active_logs', taskId: 'TASK-101' }`, **Then** it returns HTTP 200 `{ ticket, ttlSeconds: 10, wsUrl }`.

---

### User Story 3 - Agent-Computer Interface (ACI) Validation Gateway (ADR-066) (Priority: P1)

When the conversational Chat Cockpit LLM or an autonomous agent invokes a control-plane tool (`create_task`, `reorder_backlog`, `update_blocked_by`, `pause_container`, `cancel_task`, `approve_pr_merge`, `modify_blast_radius`), the call is routed through `executeAuthorizedToolCall(userContext, toolName, rawArgs)` in `src/orchestrator/aci/validate.ts`.
1. **Step 1 — Generation-Time TypeBox Validation**: `rawArgs` are validated against the strict TypeBox tool schema (`src/orchestrator/aci/tool-schemas.ts`). If invalid, the gateway does NOT execute the handler and returns a structured self-correction payload `{ toolName, executed: false, authorized: true, error: "ACI_VALIDATION_FAILED: ...", validationErrors: [...] }` so the LLM can self-correct.
2. **Step 2 — Server-Authoritative Casbin RBAC Check**: Evaluates the user's `role` against the required RBAC action for `toolName` with `{ isCockpitTool: true }`. If denied, it logs an audit event and returns `{ toolName, executed: false, authorized: false, error: "RBAC_COCKPIT_TOOL_FORBIDDEN: ..." }` without executing the handler.
3. **Step 3 — Tenant-Scoped Execution**: Executes the registered tool handler inside `withTenantContext({ workspaceId, orgId }, ...)` and returns `{ toolName, executed: true, authorized: true, result }`.

**Why this priority**: Implements ADR-066 Generation-Time Schema Validation and Constitution Principle 7 (Chat as Active Control Plane with Zero Model Trust), preventing hallucinated arguments or prompt-injected privilege escalations from mutating platform state.

**Independent Test**: Run `tests/unit/aci-gateway.test.ts` testing all 7 tools with malformed arguments (`executed: false, authorized: true, error: 'ACI_VALIDATION_FAILED...'`), insufficient role (`executed: false, authorized: false, error: 'RBAC_COCKPIT_TOOL_FORBIDDEN...'`), unknown tool name, and valid authorized execution inside `withTenantContext`.

**Acceptance Scenarios**:

1. **Given** any of the 7 Cockpit tools (`create_task`, `reorder_backlog`, `update_blocked_by`, `pause_container`, `cancel_task`, `approve_pr_merge`, `modify_blast_radius`) called with malformed or missing required arguments, **When** `executeAuthorizedToolCall` runs, **Then** it returns `{ executed: false, authorized: true, error: "ACI_VALIDATION_FAILED: ..." }` and never invokes the tool handler or RBAC mutation.
2. **Given** valid tool arguments but a user whose role lacks permission for the tool (e.g., `viewer` calling `create_task`, or `developer` calling `approve_pr_merge` / `modify_blast_radius`), **When** `executeAuthorizedToolCall` runs, **Then** it returns `{ executed: false, authorized: false, error: "RBAC_COCKPIT_TOOL_FORBIDDEN: ..." }` and never invokes the tool handler.
3. **Given** valid tool arguments and an authorized user role, **When** `executeAuthorizedToolCall` runs, **Then** the handler executes inside `withTenantContext` for the user's `workspaceId` and `orgId` and returns `{ executed: true, authorized: true, result }`.

---

### Edge Cases

- **Unresolved `blockedBy` Dependencies on Dispatch**: If `POST /api/v1/tasks/:taskId/dispatch` is called for a task whose `blocked_by` upstream tasks are not yet `MERGED`, the route throws `GraywolfAppError('TASK_BLOCKED_BY_DEPENDENCIES')` (HTTP 409).
- **Dispatching an Already Active Task**: If `POST /api/v1/tasks/:taskId/dispatch` is called when the task is already `IN_PROGRESS`, the route throws `GraywolfAppError('TASK_ALREADY_DISPATCHED')` (HTTP 409).
- **Missing Task or Project ID**: Requesting dispatch, clarification, review-gate approval, or cancellation for a non-existent `taskId` in the active workspace throws `GraywolfAppError('TASK_NOT_FOUND')` (HTTP 404).
- **Malformed HTTP Request Bodies/Queries**: Fastify schema validation errors on `/api/v1/*` routes are caught by the global ADR-042 error handler (`src/orchestrator/errors/error-handler.ts`) and formatted with code `ACI_VALIDATION_FAILED` (HTTP 400).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST implement authentication and workspace routes in `src/orchestrator/routes/auth.ts` and `src/orchestrator/routes/workspaces.ts` mounted under `/api/v1`:
  - `GET /api/v1/auth/session`
  - `POST /api/v1/auth/logout`
  - `GET /api/v1/workspaces`
  - `POST /api/v1/workspaces/:workspaceId/invites`
  - `POST /api/v1/invites/redeem`
- **FR-002**: System MUST implement project, task lifecycle, and telemetry routes in `src/orchestrator/routes/projects.ts`, `src/orchestrator/routes/tasks.ts`, and `src/orchestrator/routes/telemetry.ts` mounted under `/api/v1`:
  - `GET /api/v1/projects`, `POST /api/v1/projects`, `POST /api/v1/projects/:projectId/recon` (HTTP 202 queued)
  - `GET /api/v1/tasks`, `POST /api/v1/tasks`, `POST /api/v1/tasks/:taskId/dispatch`, `POST /api/v1/tasks/:taskId/clarification`, `POST /api/v1/tasks/:taskId/review-gate/approve`, `POST /api/v1/tasks/:taskId/cancel`
  - `POST /api/v1/telemetry/ws-ticket`
- **FR-003**: System MUST register all `/api/v1` route plugins in `src/orchestrator/app.ts` and validate request bodies, path parameters, and query parameters using TypeBox schemas matching `specs/001-multi-agent-platform/contracts/openapi.yaml`.
- **FR-004**: System MUST define strict TypeBox schemas in `src/orchestrator/aci/tool-schemas.ts` for all 7 Cockpit & Agent tools: `create_task`, `reorder_backlog`, `update_blocked_by`, `pause_container`, `cancel_task`, `approve_pr_merge`, and `modify_blast_radius`, along with their required Casbin `RbacAction` mapping.
- **FR-005**: System MUST implement `executeAuthorizedToolCall(userContext, toolName, rawArgs, customHandlers?)` in `src/orchestrator/aci/validate.ts` that:
  1. Validates `rawArgs` against the tool's TypeBox schema first; if invalid, returns `{ toolName, executed: false, authorized: true, error: "ACI_VALIDATION_FAILED: ..." }` without executing the handler.
  2. Evaluates Casbin RBAC second (`enforcePermission(userContext.role, requiredAction, { isCockpitTool: true })`); if denied, logs an audit warning and returns `{ toolName, executed: false, authorized: false, error: "RBAC_COCKPIT_TOOL_FORBIDDEN: ..." }`.
  3. Executes the handler third inside `withTenantContext({ workspaceId: userContext.workspaceId, orgId: userContext.orgId }, ...)` and returns `{ toolName, executed: true, authorized: true, result }`.

### Key Entities

- **Control Plane Route Schemas**: TypeBox request/response contracts for `SessionContext`, `Workspace`, `Project`, `CreateProjectRequest`, `Task`, `CreateTaskRequest`, `ClarificationAnswersRequest`, and `WsTicketRequest`.
- **CockpitToolName & ToolSchemas**: The 7 governed Cockpit tools (`create_task`, `reorder_backlog`, `update_blocked_by`, `pause_container`, `cancel_task`, `approve_pr_merge`, `modify_blast_radius`) and their TypeBox argument schemas.
- **ToolExecutionRecord**: `{ toolName: string; authorized: boolean; executed: boolean; error?: string | null; result?: Record<string, unknown> | null }` returned by `executeAuthorizedToolCall`.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of REST endpoints in Tasks 3.1 and 3.2 (`GET /api/v1/auth/session`, `POST /api/v1/auth/logout`, `GET /api/v1/workspaces`, `POST /api/v1/workspaces/:workspaceId/invites`, `POST /api/v1/invites/redeem`, `GET /api/v1/projects`, `POST /api/v1/projects`, `POST /api/v1/projects/:projectId/recon`, `GET /api/v1/tasks`, `POST /api/v1/tasks`, `POST /api/v1/tasks/:taskId/dispatch`, `POST /api/v1/tasks/:taskId/clarification`, `POST /api/v1/tasks/:taskId/review-gate/approve`, `POST /api/v1/tasks/:taskId/cancel`, `POST /api/v1/telemetry/ws-ticket`) are registered on the Fastify Control Plane and pass route injection tests.
- **SC-002**: 100% of malformed LLM tool calls to `executeAuthorizedToolCall` return `{ executed: false, authorized: true, error: "ACI_VALIDATION_FAILED: ..." }` without invoking handlers, and 100% of unauthorized role tool calls return `{ executed: false, authorized: false, error: "RBAC_COCKPIT_TOOL_FORBIDDEN..." }`.
- **SC-003**: `pnpm typecheck`, `pnpm lint`, `pnpm build`, and `pnpm test` pass with 0 errors and 0 warnings.

## Assumptions

- Until the full Docker runner & BullMQ orchestrator phases (Phases 4–6) are wired, the state-Backed repository layer used by `/api/v1/projects` and `/api/v1/tasks` supports both PostgreSQL persistence (inside `withTenantContext`) and an in-memory/injectable store fallback so Fastify `app.inject()` integration tests run deterministically in any environment.
