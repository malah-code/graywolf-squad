# Tasks: 005-control-plane-api-aci

**Input**: Design documents from `/specs/005-control-plane-api-aci/`  
**Prerequisites**: `plan.md`, `spec.md`, `research.md`, `data-model.md`, `contracts/openapi-aci.md`  
**Target Phase**: Phase 3 — Control Plane REST API (`/api/v1`) & ACI Validation (`docs/implementation-plan-detailed.md`)

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: Which user story this task belongs to (`[US1]`, `[US2]`, `[US3]`)
- Exact file paths are included in every task description.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Ensure `src/orchestrator/routes/` and `src/orchestrator/aci/` directory structure is ready for Phase 3 modules.

- [x] T001 Create `src/orchestrator/aci/` directory and verify Fastify 5 + TypeBox route schema bindings in `src/orchestrator/app.ts`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Shared session extraction helper and tenant-scoped state repository used across `/api/v1` routes and ACI tool handlers.

- [x] T002 Implement shared session token extraction helper and tenant-isolated project/task store adapter (PostgreSQL `withTenantContext` with in-memory fallback for offline `app.inject()` tests) in `src/orchestrator/routes/projects.ts` and `src/orchestrator/routes/tasks.ts`

---

## Phase 3: User Story 1 - Authentication, Session Context & Workspace Invite REST API (Priority: P1) 🎯 MVP

**Goal**: Expose `GET /api/v1/auth/session`, `POST /api/v1/auth/logout`, `GET /api/v1/workspaces`, `POST /api/v1/workspaces/:workspaceId/invites`, and `POST /api/v1/invites/redeem` matching `openapi.yaml`.

**Independent Test**: Run `tests/integration/routes-auth-workspaces.test.ts` verifying session context retrieval, immediate logout revocation, workspace listing, RBAC-guarded invite generation (`lead_dev`+ vs `developer`/`viewer` 403), and invite redemption.

- [x] T003 [P] [US1] Implement `GET /api/v1/auth/session` and `POST /api/v1/auth/logout` in `src/orchestrator/routes/auth.ts`
- [x] T004 [P] [US1] Implement `GET /api/v1/workspaces`, `POST /api/v1/workspaces/:workspaceId/invites`, and `POST /api/v1/invites/redeem` in `src/orchestrator/routes/workspaces.ts`
- [x] T005 [US1] Register `authRoutes` and `workspaceRoutes` under `/api/v1` in `src/orchestrator/app.ts`
- [x] T006 [US1] Author route injection integration tests in `tests/integration/routes-auth-workspaces.test.ts` covering `/api/v1/auth/*`, `/api/v1/workspaces/*`, and `/api/v1/invites/redeem`

---

## Phase 4: User Story 2 - Project, Task Lifecycle, Panic Button & WebSocket Ticket REST API (Priority: P1)

**Goal**: Expose `GET/POST /api/v1/projects`, `POST /api/v1/projects/:projectId/recon`, `GET/POST /api/v1/tasks`, `POST /api/v1/tasks/:taskId/dispatch`, `POST /api/v1/tasks/:taskId/clarification`, `POST /api/v1/tasks/:taskId/review-gate/approve`, `POST /api/v1/tasks/:taskId/cancel` (Panic Button), and `POST /api/v1/telemetry/ws-ticket`.

**Independent Test**: Run `tests/integration/routes-projects-tasks.test.ts` verifying project onboarding, recon queueing (202), task creation, dispatch (`TASK_BLOCKED_BY_DEPENDENCIES` / `TASK_ALREADY_DISPATCHED`), clarification resolution, review-gate approval (`RBAC_MERGE_NOT_AUTHORIZED` for `developer`), Panic Button cancellation, and WS ticket minting.

- [x] T007 [P] [US2] Implement `GET /api/v1/projects`, `POST /api/v1/projects`, and `POST /api/v1/projects/:projectId/recon` (HTTP 202) in `src/orchestrator/routes/projects.ts`
- [x] T008 [P] [US2] Implement `GET /api/v1/tasks`, `POST /api/v1/tasks`, `POST /api/v1/tasks/:taskId/dispatch`, `POST /api/v1/tasks/:taskId/clarification`, `POST /api/v1/tasks/:taskId/review-gate/approve`, and `POST /api/v1/tasks/:taskId/cancel` in `src/orchestrator/routes/tasks.ts`
- [x] T009 [P] [US2] Implement `POST /api/v1/telemetry/ws-ticket` in `src/orchestrator/routes/telemetry.ts`
- [x] T010 [US2] Register `projectRoutes`, `taskRoutes`, and `telemetryRoutes` under `/api/v1` in `src/orchestrator/app.ts`
- [x] T011 [US2] Author route injection integration tests in `tests/integration/routes-projects-tasks.test.ts` covering all project, task lifecycle, Panic Button, and WS ticket endpoints

---

## Phase 5: User Story 3 - Agent-Computer Interface (ACI) Validation Gateway (ADR-066) (Priority: P1)

**Goal**: Enforce generation-time TypeBox schema validation, server-authoritative Casbin RBAC (`RBAC_COCKPIT_TOOL_FORBIDDEN`), and `withTenantContext` execution across all 7 Cockpit & Agent tools (`create_task`, `reorder_backlog`, `update_blocked_by`, `pause_container`, `cancel_task`, `approve_pr_merge`, `modify_blast_radius`).

**Independent Test**: Run `tests/unit/aci-gateway.test.ts` testing invalid args (`ACI_VALIDATION_FAILED`), unauthorized roles (`RBAC_COCKPIT_TOOL_FORBIDDEN`), and valid execution inside `withTenantContext`.

- [x] T012 [P] [US3] Define strict TypeBox schemas and Casbin `RbacAction` mappings for `create_task`, `reorder_backlog`, `update_blocked_by`, `pause_container`, `cancel_task`, `approve_pr_merge`, and `modify_blast_radius` in `src/orchestrator/aci/tool-schemas.ts`
- [x] T013 [US3] Implement `executeAuthorizedToolCall(userContext, toolName, rawArgs)` in `src/orchestrator/aci/validate.ts` validating `rawArgs` against TypeBox first (`ACI_VALIDATION_FAILED`), evaluating Casbin RBAC second (`RBAC_COCKPIT_TOOL_FORBIDDEN`), and executing handlers inside `withTenantContext` third
- [x] T014 [US3] Author unit tests in `tests/unit/aci-gateway.test.ts` testing malformed arguments, unauthorized roles, unknown tool names, and valid authorized execution for all 7 Cockpit tools

---

## Phase 6: Polish & Static Quality Gate

**Purpose**: Ensure zero TypeScript, ESLint, build, or test regressions across the repository.

- [x] T015 Run `pnpm typecheck && pnpm lint && pnpm build` to verify 0 TypeScript errors, 0 ESLint warnings, and clean compilation
- [x] T016 Run `pnpm test` to verify 100% passing unit and integration tests across all suites

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)** & **Phase 2 (Foundational)** complete first.
- **User Story 1 (`T003`–`T006`)**, **User Story 2 (`T007`–`T011`)**, and **User Story 3 (`T012`–`T014`)** can proceed in parallel (`[P]` tasks touch disjoint route and ACI files).
- **Phase 6 (Polish & Verification)** runs after all user stories are complete.

### Parallel Opportunities

- `T003` (`routes/auth.ts`), `T004` (`routes/workspaces.ts`), `T007` (`routes/projects.ts`), `T008` (`routes/tasks.ts`), `T009` (`routes/telemetry.ts`), and `T012` (`aci/tool-schemas.ts`) operate on independent files and can be implemented in parallel.
- `tests/integration/routes-auth-workspaces.test.ts` (`T006`), `tests/integration/routes-projects-tasks.test.ts` (`T011`), and `tests/unit/aci-gateway.test.ts` (`T014`) run in parallel in Vitest.

## Implementation Strategy

1. Complete **Phase 1 & Phase 2** (`T001`–`T002`).
2. Deliver **User Story 1 (`T003`–`T006`)** for Auth & Workspace routes.
3. Deliver **User Story 2 (`T007`–`T011`)** for Project, Task Lifecycle, and WS Ticket routes.
4. Deliver **User Story 3 (`T012`–`T014`)** for the ADR-066 ACI Validation Gateway.
5. Run **Phase 6 (`T015`–`T016`)** static checks and test suites.
