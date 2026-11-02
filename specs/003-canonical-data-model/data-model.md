# Data Model: 003-canonical-data-model

**Feature**: `003-canonical-data-model`  
**Canonical Source**: `specs/001-multi-agent-platform/data-model.md` §1–§3 & `docs/implementation-plan-detailed.md` Phase 1

## 1. Relational & Vector Tables (PostgreSQL 16 + `pgvector` + `pgcrypto`)

| # | Table | Category | Primary Key | Tenancy Scope | RLS Policy |
|---|---|---|---|---|---|
| 1 | `organizations` | Tenancy | `id UUID` | Root (`id`) | N/A (Root table) |
| 2 | `workspaces` | Tenancy | `id UUID` | `org_id UUID` | N/A (Tenancy directory) |
| 3 | `users` | Tenancy | `id UUID` | Global identity | N/A |
| 4 | `workspace_members` | Tenancy | `id UUID` | `workspace_id UUID` | N/A |
| 5 | `workspace_invites` | Tenancy | `id UUID` | `workspace_id UUID` | N/A |
| 6 | `workspace_member_identities` | Tenancy | `id UUID` | `workspace_id UUID` | N/A |
| 7 | `sessions` | Tenancy | `id VARCHAR(128)` | `workspace_id UUID` | N/A |
| 8 | `projects` | Core | `id UUID` | `workspace_id UUID` | N/A (Workspace project directory per `specs/001-multi-agent-platform/data-model.md` §2) |
| 9 | `tasks` | Core | `id VARCHAR(64)` | `workspace_id UUID` | Forced (`workspace_isolation`) |
| 10 | `task_dependencies` | Core | `(task_id, blocked_by_task_id)` | Via `tasks` FK | Inherited via `tasks` |
| 11 | `task_artifacts` | Core | `id UUID` | `workspace_id UUID` | Forced (`workspace_isolation`) |
| 12 | `escalations` | Core | `id UUID` | `workspace_id UUID` | Forced (`workspace_isolation`) |
| 13 | `task_locks` | Core | `task_id VARCHAR(64)` | `workspace_id UUID` | Forced (`workspace_isolation`) |
| 14 | `llm_calls` | Observability | `id UUID` | `workspace_id UUID`, `org_id UUID` | Forced (`workspace_isolation`) |
| 15 | `task_gate_decisions` | Observability | `id UUID` | `workspace_id UUID` | Forced (`workspace_isolation`) |
| 16 | `review_evidence` | Observability | `id UUID` | `workspace_id UUID` | Forced (`workspace_isolation`) |
| 17 | `secret_vault` | Security | `id UUID` | `workspace_id UUID` | Forced (`workspace_isolation`) |
| 18 | `mcp_servers` | Security | `id UUID` | `workspace_id UUID` | Forced (`workspace_isolation`) |
| 19 | `confidence_calibration` | Calibration | `id UUID` | `workspace_id UUID` | Forced (`workspace_isolation`) |
| 20 | `project_lessons` | Learning | `id UUID` | `workspace_id UUID`, `org_id UUID` | Forced (`tenant_and_org_lesson_isolation`) |
| 21 | `code_symbols` | Context | `id UUID` | `workspace_id UUID`, `org_id UUID` | Forced (`workspace_isolation`) |
| 22 | `code_references` | Context | `id UUID` | `workspace_id UUID`, `org_id UUID` | Forced (`workspace_isolation`) |
| 23 | `skills` | Learning | `id UUID` | `workspace_id UUID` | Forced (`workspace_isolation`) |
| 24 | `addon_registry` | Extensibility | `id UUID` | `workspace_id UUID` | Forced (`workspace_isolation`) |

## 2. Canonical Task Lifecycle States (16 States)

All 16 states enforced by both PostgreSQL `CHECK` constraint on `tasks.status` and `TaskStatusSchema` in `src/orchestrator/schemas/task.ts`:
`BACKLOG`, `QUEUED`, `IN_PROGRESS`, `BLOCKED`, `AWAITING_CLARIFICATION`, `INTERNAL_REVIEW`, `INTERNAL_REVIEW_FAILED`, `GUARD_VERIFYING`, `QA_FIXING`, `VERIFICATION_FAILED`, `HUMAN_REVIEW_GATE`, `MERGED`, `REJECTED`, `ESCALATED`, `UPDATED`, `CANCELLED`.
