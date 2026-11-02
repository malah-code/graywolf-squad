# Quickstart & Verification Guide: 005-control-plane-api-aci

## 1. Run Unit & Route Injection Integration Tests

```bash
pnpm test
```

Expected outcome:
- `tests/integration/routes-auth-workspaces.test.ts`: Tests `GET /api/v1/auth/session`, `POST /api/v1/auth/logout`, `GET /api/v1/workspaces`, `POST /api/v1/workspaces/:workspaceId/invites`, and `POST /api/v1/invites/redeem`.
- `tests/integration/routes-projects-tasks.test.ts`: Tests `GET/POST /api/v1/projects`, `POST /api/v1/projects/:projectId/recon`, `GET/POST /api/v1/tasks`, `dispatch`, `clarification`, `review-gate/approve` (`RBAC_MERGE_NOT_AUTHORIZED` for `developer`), `cancel` (Panic Button), and `POST /api/v1/telemetry/ws-ticket`.
- `tests/unit/aci-gateway.test.ts`: Tests `executeAuthorizedToolCall` across all 7 tools for invalid arguments (`ACI_VALIDATION_FAILED`), unauthorized roles (`RBAC_COCKPIT_TOOL_FORBIDDEN`), and valid execution inside `withTenantContext`.

## 2. Run Static Quality Checks

```bash
pnpm typecheck && pnpm lint && pnpm build
```

Expected outcome: 0 TypeScript errors, 0 ESLint warnings, and clean build output.
