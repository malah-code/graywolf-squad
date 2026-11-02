# Phase 3 Research: Control Plane REST API (`/api/v1`) & ACI Validation

**Feature**: `005-control-plane-api-aci`  
**Date**: 2026-10-18

## Decisions & Rationale

### 1. Three-Stage ACI Validation Order (Schema First ➔ RBAC Second ➔ `withTenantContext` Third)
- **Decision**: In `executeAuthorizedToolCall(userContext, toolName, rawArgs)`, always validate `rawArgs` against the TypeBox schema **before** Casbin RBAC evaluation, returning `{ executed: false, authorized: true, error: "ACI_VALIDATION_FAILED: ..." }` on schema failure, and returning `{ executed: false, authorized: false, error: "RBAC_COCKPIT_TOOL_FORBIDDEN" }` on RBAC denial.
- **Rationale**: Directly implements Task 3.3 in `docs/implementation-plan-detailed.md` and ADR-066. Returning structured `ACI_VALIDATION_FAILED` diagnostics before handler execution allows the LLM to self-correct malformed tool arguments without triggering false-positive security alerts or partial mutations.
- **Alternatives Considered**: Throwing unhandled exceptions from `executeAuthorizedToolCall` — rejected because the Chat Cockpit (`POST /api/v1/chat/turn` in `openapi.yaml`) expects structured `ToolExecutionRecord` objects (`{ toolName, executed, authorized, error, result }`) in `toolExecutions` so the LLM can read the self-correction or permission-denial feedback in its next turn.

### 2. Dual-Backed Control Plane State Store for Fastify `app.inject()` Integration Testing
- **Decision**: Provide a clean repository/store layer for workspaces, projects, and tasks that executes inside `withTenantContext` when PostgreSQL is connected, and seamlessly uses a tenant-isolated in-memory store when PostgreSQL is offline during Fastify `app.inject()` integration tests.
- **Rationale**: Allows `tests/integration/routes-auth-workspaces.test.ts` and `tests/integration/routes-projects-tasks.test.ts` to test every single route, status transition, dependency blocker check, and RBAC guard deterministically in CI/WSL environments even when the Docker Postgres daemon is not running.
