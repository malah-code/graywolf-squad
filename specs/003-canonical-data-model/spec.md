# Feature Specification: 003-canonical-data-model

**Feature Branch**: `003-canonical-data-model`  
**Created**: 2026-10-18  
**Status**: Draft  
**Target Phase**: Phase 1 — Canonical Data Model, PostgreSQL RLS & Core Schemas (`docs/implementation-plan-detailed.md`)  
**Input**: Master Phased Implementation Plan §Phase 1 (`specs/003-canonical-data-model/`); `specs/001-multi-agent-platform/data-model.md`; `specs/001-multi-agent-platform/contracts/relay-result.json`; `specs/002-addon-sdk/addon-interfaces.ts`; ADR-012, ADR-015, ADR-017, ADR-018, ADR-022, ADR-023, ADR-039, ADR-051, ADR-079, ADR-080, ADR-081

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Multi-Tenant Database Isolation via Row-Level Security (Priority: P1)

An operator or automated service executes database queries on behalf of an authenticated workspace and organization. Every tenant-scoped query runs inside a transaction-scoped context that sets the active workspace and organization identifiers. PostgreSQL Row-Level Security (RLS) physically prevents any query, update, or deletion from reading or mutating records belonging to another workspace or organization—even if an application query omits a `WHERE workspace_id = ...` clause. For organizational lessons marked as `is_org_wide = true`, workspaces within the same organization can read those shared lessons, while workspaces in other organizations remain completely isolated.

**Why this priority**: Multi-tenant isolation is a foundational security invariant (ADR-015, ADR-039, ADR-051). Every subsequent phase (Auth, Control Plane API, Task Store, Orchestrator, Continuous Learning) depends on guaranteed database-level tenant boundaries.

**Independent Test**: Can be tested independently by running migrations against PostgreSQL 16 + `pgvector`, seeding two distinct organizations and workspaces, inserting tasks and project lessons under Workspace A's tenant context, and verifying that queries under Workspace B's tenant context return zero rows from Workspace A (while verifying org-wide lesson visibility strictly within the same organization).

**Acceptance Scenarios**:

1. **Given** a database connection executing inside `withTenantContext({ workspaceId, orgId }, fn)`, **When** `SELECT current_setting('app.current_workspace_id', true), current_setting('app.current_org_id', true)` is queried inside `fn`, **Then** both settings match the provided `workspaceId` and `orgId` and automatically reset when the transaction ends.
2. **Given** Workspace A and Workspace B exist in separate organizations and Task `TASK-101` is created in Workspace A, **When** Workspace B executes `SELECT * FROM tasks` inside `withTenantContext`, **Then** 0 rows are returned and attempts to `UPDATE` or `DELETE` `TASK-101` affect 0 rows.
3. **Given** a `project_lessons` record with `is_org_wide = true` in Organization 1 (Workspace A1), **When** Workspace A2 (also in Organization 1) queries `project_lessons`, **Then** the org-wide lesson is returned; **When** Workspace B1 (in Organization 2) queries `project_lessons`, **Then** the lesson is NOT returned.
4. **Given** a query executed on a forced-RLS table without an active tenant context (`app.current_workspace_id` unset or empty), **When** rows are queried, **Then** the query fails closed or returns zero rows without leaking cross-tenant data.

---

### User Story 2 - Complete Canonical Relational & Vector Schema Lifecycle (Priority: P1)

A platform administrator or CI pipeline provisions or upgrades the database using the canonical migration workflow (`pnpm migrate:up` and `pnpm migrate:down`). The migration cleanly establishes all 24 canonical tables across Tenancy, Core Entities, Observability & Gates, Security & Calibration, and Learning & Context, along with 768-dimensional `pgvector` embedding columns (`nomic-embed-text`), foreign key cascades, domain check constraints, forced Row-Level Security policies, and performance indexes.

**Why this priority**: All downstream services require these exact table structures, columns, constraints, and indexes to persist state without ad-hoc schema drift.

**Independent Test**: Run `pnpm migrate:up`, inspect `information_schema` and `pg_policies` to verify all 24 tables, `vector(768)` columns, check constraints, indexes, and `FORCE ROW LEVEL SECURITY` flags exist, then run `pnpm migrate:down` and `pnpm migrate:up` to verify clean reversibility and idempotency.

**Acceptance Scenarios**:

1. **Given** an empty PostgreSQL 16 database with `vector` and `pgcrypto` extensions, **When** `pnpm migrate:up` runs, **Then** all 24 canonical tables (`organizations`, `workspaces`, `users`, `workspace_members`, `workspace_invites`, `workspace_member_identities`, `sessions`, `projects`, `tasks`, `task_dependencies`, `task_artifacts`, `escalations`, `task_locks`, `llm_calls`, `task_gate_decisions`, `review_evidence`, `secret_vault`, `mcp_servers`, `confidence_calibration`, `project_lessons`, `code_symbols`, `code_references`, `skills`, `addon_registry`) and their indexes are created with zero errors.
2. **Given** an applied canonical schema, **When** `pnpm migrate:down` followed by `pnpm migrate:up` is executed, **Then** the schema tears down cleanly in reverse dependency order and re-applies identically.
3. **Given** the `tasks` table, **When** a task is inserted with each valid `type` (`feature`, `bug`, `refactor`, `bug-bash-sprint`) and any of the 16 canonical `status` values (`BACKLOG`, `QUEUED`, `IN_PROGRESS`, `BLOCKED`, `AWAITING_CLARIFICATION`, `INTERNAL_REVIEW`, `INTERNAL_REVIEW_FAILED`, `GUARD_VERIFYING`, `QA_FIXING`, `VERIFICATION_FAILED`, `HUMAN_REVIEW_GATE`, `MERGED`, `REJECTED`, `ESCALATED`, `UPDATED`, `CANCELLED`), **Then** the insert succeeds; **When** an invalid `type` or `status` is inserted, **Then** PostgreSQL rejects it with a constraint violation.

---

### User Story 3 - Validated Markdown Frontmatter & Artifact Schemas (Priority: P1)

The orchestrator and in-container agents read and write Markdown task artifacts (`brief.md`, `plan.md`, `review-signoff.md`, `escalation-request.md`) stored in `.agents/tasks/<TASK_ID>/`. A unified frontmatter parser and serializer extracts the YAML frontmatter and Markdown body, validates the frontmatter against strict TypeBox schemas covering all 16 task lifecycle states and tier metadata, and serializes updated artifacts back to deterministic Markdown + YAML frontmatter strings.

**Why this priority**: Task state synchronization between `.agents/tasks/<TASK_ID>/*.md` and PostgreSQL depends on deterministic, schema-validated parsing and serialization of YAML frontmatter.

**Independent Test**: Pass every canonical Markdown artifact example from `specs/001-multi-agent-platform/data-model.md` (§1.1 `brief.md`, §1.7 `plan.md`, §1.8 `escalation-request.md`, §1.9 `review-signoff.md`) through the parser/serializer unit tests and verify round-trip fidelity and rejection of malformed frontmatter.

**Acceptance Scenarios**:

1. **Given** a valid `brief.md` string with YAML frontmatter and Markdown body, **When** parsed via the task frontmatter parser, **Then** it returns strongly typed frontmatter matching `TaskBriefFrontmatterSchema` and preserves the Markdown body intact.
2. **Given** `plan.md`, `review-signoff.md`, and `escalation-request.md` strings matching `data-model.md` §1.7, §1.8, and §1.9, **When** validated against their respective TypeBox schemas, **Then** validation succeeds; **When** required fields (e.g. `taskId`, `verdict`, `escalationType`) are missing or invalid, **Then** validation fails with structured schema diagnostics.
3. **Given** a valid frontmatter object and Markdown body, **When** serialized and re-parsed, **Then** the resulting object is deeply equal to the original input.

---

### User Story 4 - Validated Relay Result (`delegate-relay.result.v1`) & Project Configuration (`project.config.json`) Contracts (Priority: P2)

When an execution container finishes a task, it emits `result.json` conforming to `delegate-relay.result.v1`. Similarly, each onboarded repository persists `.agents/project.config.json` governing blast-radius scopes, model routing, gate policies, AI reviewer personas, locale (`ar` | `en` | `fr` | `tr`), UI persona (`maker` | `developer`), Topology A CLI subscription auth bridges, and installed Addon SDK manifests. Strict TypeBox schemas validate both contracts at runtime.

**Why this priority**: Prevents corrupted container relay outputs or invalid project governance configurations from entering the control plane or bypassing blast-radius/spend guardrails.

**Independent Test**: Validate canonical and edge-case JSON payloads for `result.json` and `project.config.json` (including PRD extensions and `AddonManifest`) in unit tests (`tests/unit/schemas-contracts.test.ts`).

**Acceptance Scenarios**:

1. **Given** a `result.json` payload matching `specs/001-multi-agent-platform/contracts/relay-result.json`, **When** validated with `DelegateRelayResultSchema`, **Then** it passes for valid task IDs (`^TASK-[0-9A-Z-]+$`) and statuses (`completed`, `failed`, `timeout`, `circuit_tripped`), and rejects invalid versions, negative metrics, or malformed task IDs.
2. **Given** a `project.config.json` payload containing core fields (`projectId`, `mode`, `sourceControl`, `blastRadius`, `modelRouting`, `taskTags`, `limits`, `skillImports`) plus PRD extensions (`locale`, `ui.persona`, `gatePolicy`, `aiReviewer`, `cliSubscriptionAuth`, `addons`), **When** validated with `ProjectConfigSchema`, **Then** valid configurations pass and invalid enum values or out-of-range limits fail.

---

### Edge Cases

- **Missing or Unset Tenant Context on RLS Tables**: If a query runs against an RLS-enforced table outside `withTenantContext` (where `current_setting('app.current_workspace_id', true)` returns `NULL` or `''`), the RLS policy MUST use `NULLIF(current_setting('app.current_workspace_id', true), '')::UUID` so PostgreSQL evaluates the comparison to `NULL`/`false` (returning 0 rows / failing closed) rather than throwing an unhandled invalid UUID syntax cast error on empty strings.
- **Transaction Rollback on Error in `withTenantContext`**: If the callback `fn(client)` throws an error inside `withTenantContext`, the helper MUST execute `ROLLBACK`, release the `PoolClient` back to the pool without leaking connections, and rethrow the original error.
- **CLI Subscription Auth Null Cost in `llm_calls`**: Under ADR-081 Pattern 4 (`cliSubscriptionAuth`), `llm_calls.cost_usd` may be `0` or `NULL` when token billing goes through a CLI OAuth subscription; the schema supports nullable or zero `cost_usd` with `provider = 'cli-subscription-{provider}'`.
- **Legacy Migration Superseding**: The existing bootstrap migration `migrations/1789444040216_create-tasks-table.js` created a placeholder `tasks` table with non-canonical columns (`plan_id`, `budget_usd`, `graywolf.workspace_id`). Phase 1 MUST cleanly replace/supersede this so fresh and migrated databases match the exact canonical schema in `data-model.md` §2.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST provide a `withTenantContext<T>(ctx: { workspaceId: string; orgId?: string }, fn: (client: PoolClient) => Promise<T>): Promise<T>` transaction helper in `src/orchestrator/db/index.ts` that begins a transaction, sets `app.current_workspace_id` and `app.current_org_id` locally (`set_config(..., true)`), executes `fn(client)`, commits on success, rolls back on error, and always releases the client.
- **FR-002**: System MUST provide a reversible database migration creating all canonical tables defined in `docs/implementation-plan-detailed.md` Task 1.2 and `specs/001-multi-agent-platform/data-model.md` §2:
  - **Tenancy**: `organizations`, `workspaces`, `users`, `workspace_members`, `workspace_invites`, `workspace_member_identities`, `sessions`
  - **Core**: `projects`, `tasks` (`id VARCHAR(64) PK`, `type CHECK (type IN ('feature', 'bug', 'refactor', 'bug-bash-sprint'))`, all 16 canonical `status` values), `task_dependencies`, `task_artifacts` (`embedding vector(768)`), `escalations`, `task_locks`
  - **Observability & Gates**: `llm_calls`, `task_gate_decisions`, `review_evidence`
  - **Security & Calibration**: `secret_vault` (`encrypted_value BYTEA`, `encrypted_dek BYTEA`), `mcp_servers`, `confidence_calibration`
  - **Learning & Context**: `project_lessons` (`is_org_wide BOOLEAN`, `embedding vector(768)`), `code_symbols`, `code_references`, `skills`, `addon_registry`
- **FR-003**: System MUST enable and force Row-Level Security (`ENABLE ROW LEVEL SECURITY` and `FORCE ROW LEVEL SECURITY`) on all tenant-scoped operational tables: `tasks`, `task_artifacts`, `llm_calls`, `task_gate_decisions`, `secret_vault`, `code_symbols`, `code_references`, `confidence_calibration`, `project_lessons` (with dual workspace + `is_org_wide` organization policy), and `escalations` (plus `review_evidence`, `task_locks`, `mcp_servers`, `skills`, `addon_registry` where workspace-scoped).
- **FR-004**: System MUST create all canonical indexes defined in `data-model.md` §2 (`idx_tasks_status`, `idx_tasks_project`, `idx_tasks_workspace`, `idx_artifacts_task`, `idx_dependencies_task`, `idx_dependencies_blocker`, `idx_llm_calls_task`, `idx_llm_calls_workspace_date`, `idx_llm_calls_persona`, `idx_task_gate_decisions_task`, `idx_task_gate_decisions_gate`, `idx_lessons_project`, `idx_lessons_workspace`, `idx_symbols_project`, `idx_symbols_name`, `idx_references_project`, `idx_confidence_calibration_agg`, `idx_workspace_invites_hash`).
- **FR-005**: System MUST define TypeBox schemas and TypeScript static types in `src/orchestrator/schemas/task.ts` for:
  - `TaskStatusSchema` (all 16 states: `BACKLOG`, `QUEUED`, `IN_PROGRESS`, `BLOCKED`, `AWAITING_CLARIFICATION`, `INTERNAL_REVIEW`, `INTERNAL_REVIEW_FAILED`, `GUARD_VERIFYING`, `QA_FIXING`, `VERIFICATION_FAILED`, `HUMAN_REVIEW_GATE`, `MERGED`, `REJECTED`, `ESCALATED`, `UPDATED`, `CANCELLED`)
  - `TaskTypeSchema` (`feature`, `bug`, `refactor`, `bug-bash-sprint`)
  - `TaskBriefFrontmatterSchema` (`brief.md` frontmatter, `data-model.md` §1.1)
  - `TaskPlanFrontmatterSchema` (`plan.md` frontmatter, `data-model.md` §1.7)
  - `EscalationRequestFrontmatterSchema` (`escalation-request.md` frontmatter, `data-model.md` §1.8)
  - `ReviewSignoffFrontmatterSchema` (`review-signoff.md` frontmatter, `data-model.md` §1.9)
- **FR-006**: System MUST implement generic and artifact-specific Markdown YAML frontmatter parser and serializer helpers in `src/orchestrator/schemas/task.ts` using `gray-matter` and `@sinclair/typebox/value` (`Value.Check` / `Value.Errors`), throwing a structured `GraywolfAppError` on invalid frontmatter.
- **FR-007**: System MUST define `DelegateRelayResultSchema` in `src/orchestrator/schemas/relay-result.ts` matching `specs/001-multi-agent-platform/contracts/relay-result.json` (`version: 'delegate-relay.result.v1'`, `taskId` pattern `^TASK-[0-9A-Z-]+$`, `status`, `exitCode`, `signal`, `metrics`, `touchedFiles`, `agentReport`, `sessionRef`).
- **FR-008**: System MUST define `ProjectConfigSchema` in `src/orchestrator/schemas/project-config.ts` matching `data-model.md` §1.5 and all PRD/ADR extensions (`locale: 'ar' | 'en' | 'fr' | 'tr'`, `ui.persona: 'maker' | 'developer'`, `gatePolicy`, `aiReviewer`, `cliSubscriptionAuth`, and `addons` referencing `AddonManifest`).

### Key Entities

- **Organization & Workspace**: Top-level governance/billing boundary (`organizations`) and tenant sub-compartment (`workspaces`), linked to `users` via `workspace_members`, `workspace_invites`, `workspace_member_identities`, and `sessions`.
- **Project & Task**: Repository-bound configuration container (`projects`) and unit of engineering work (`tasks`) with DAG dependencies (`task_dependencies`), file/vector artifacts (`task_artifacts`), active locks (`task_locks`), and boundary/review escalations (`escalations`).
- **Observability & Evidence Ledgers**: Token/cost audit trail (`llm_calls`), System-One routing decisions (`task_gate_decisions`), in-container command/test execution evidence (`review_evidence`), and per-model confidence tracking (`confidence_calibration`).
- **Security, Learning & Extensibility Entities**: Envelope-encrypted credentials (`secret_vault`), registered MCP servers (`mcp_servers`), three-tier project/org lessons (`project_lessons`), AST symbol/reference graphs (`code_symbols`, `code_references`), curated skills metadata (`skills`), and installed addons (`addon_registry`).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: `pnpm migrate:up && pnpm migrate:down && pnpm migrate:up` executes against PostgreSQL 16 + `pgvector` in under 5 seconds with zero errors and 100% schema restoration.
- **SC-002**: Cross-tenant RLS integration tests prove 0% data leakage across workspaces on all forced-RLS tables, while preserving `is_org_wide = true` lesson sharing strictly within the same `org_id`.
- **SC-003**: 100% of example frontmatter blocks and JSON contracts from `data-model.md` and `contracts/relay-result.json` pass TypeBox validation and round-trip serialization tests in `tests/unit/schemas-task.test.ts` and `tests/unit/schemas-contracts.test.ts`.
- **SC-004**: `pnpm typecheck`, `pnpm lint`, and `pnpm test` pass with 0 errors and 0 warnings.

## Assumptions

- PostgreSQL 16 with `pgvector` (`vector`) and `pgcrypto` extensions is running and accessible via `DATABASE_URL` (provisioned by the Docker Compose topology from Phase 0).
- In PostgreSQL, superusers and table owners bypass RLS unless `FORCE ROW LEVEL SECURITY` is enabled AND the connection role does not have the `BYPASSRLS` attribute; tests verifying RLS enforcement will ensure `NOBYPASSRLS` (or execute under a non-superuser role / session configuration) so `FORCE ROW LEVEL SECURITY` is actively enforced during testing.
- `gray-matter` (MIT license) is used for Markdown YAML frontmatter parsing and serialization as specified in Task 1.3 of `docs/implementation-plan-detailed.md`.
