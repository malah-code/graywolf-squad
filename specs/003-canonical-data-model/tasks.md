# Tasks: 003-canonical-data-model

**Branch**: `003-canonical-data-model` | **Date**: 2026-10-18 | **Spec**: [specs/003-canonical-data-model/spec.md](file:///home/tarikelmallah/Projects/GraywolfSquad/specs/003-canonical-data-model/spec.md) | **Plan**: [specs/003-canonical-data-model/plan.md](file:///home/tarikelmallah/Projects/GraywolfSquad/specs/003-canonical-data-model/plan.md)  
**Target Phase**: Phase 1 — Canonical Data Model, PostgreSQL RLS & Core Schemas (`docs/implementation-plan-detailed.md`)

---

## Phase 1: Setup & Environment Prerequisites

**Purpose**: Verify all database migration and runtime schema parsing dependencies in `package.json` (`pg`, `node-pg-migrate`, `@sinclair/typebox`, `gray-matter`).

- [x] **T001** Verify dependencies in `package.json` ensuring `pg`, `node-pg-migrate`, `@sinclair/typebox`, and `gray-matter` are installed and supported by current TypeScript build settings.

---

## Phase 2: Foundational Infrastructure

**Purpose**: Implement the transaction-scoped tenant context helper `withTenantContext` in `src/orchestrator/db/index.ts` required by all multi-tenant queries.

- [x] **T002** Implement `TenantContext` interface and `withTenantContext<T>(ctx, fn)` transaction helper in `src/orchestrator/db/index.ts` setting local session variables `app.current_workspace_id` and `app.current_org_id` via `SELECT set_config(...)`, with automatic `COMMIT`, safe error `ROLLBACK`, and leak-free client release.

---

## Phase 3: User Story 2 - Complete Canonical Relational & Vector Schema Lifecycle (Priority: P1)

**Goal**: Establish all 24 canonical tables, `vector(768)` embedding columns, check constraints, foreign keys, and indexes via reversible `node-pg-migrate` migrations.

**Independent Test**: Execute `pnpm migrate:up`, verify table existence and constraints, execute `pnpm migrate:down` to verify clean teardown, and re-apply with `pnpm migrate:up`.

- [x] **T003 [US2]** Create the canonical PostgreSQL 16 migration in `migrations/` replacing the Phase 0 placeholder, provisioning `vector` and `pgcrypto` extensions, all 7 tenancy tables (`organizations`, `workspaces`, `users`, `workspace_members`, `workspace_invites`, `workspace_member_identities`, `sessions`), 6 core tables (`projects`, `tasks`, `task_dependencies`, `task_artifacts`, `escalations`, `task_locks`), 3 observability tables (`llm_calls`, `task_gate_decisions`, `review_evidence`), 3 security & calibration tables (`secret_vault`, `mcp_servers`, `confidence_calibration`), and 5 learning & context tables (`project_lessons`, `code_symbols`, `code_references`, `skills`, `addon_registry`).
- [x] **T004 [US2]** Implement canonical domain check constraints on `tasks.type` (`'feature'`, `'bug'`, `'refactor'`, `'bug-bash-sprint'`), `tasks.status` (all 16 lifecycle states), and create all 18 performance and integrity indexes (`idx_tasks_status`, `idx_tasks_project`, `idx_tasks_workspace`, `idx_artifacts_task`, `idx_dependencies_task`, `idx_dependencies_blocker`, `idx_llm_calls_task`, `idx_llm_calls_workspace_date`, `idx_llm_calls_persona`, `idx_task_gate_decisions_task`, `idx_task_gate_decisions_gate`, `idx_lessons_project`, `idx_lessons_workspace`, `idx_symbols_project`, `idx_symbols_name`, `idx_references_project`, `idx_confidence_calibration_agg`, `idx_workspace_invites_hash`).

---

## Phase 4: User Story 1 - Multi-Tenant Database Isolation via Row-Level Security (Priority: P1) 🎯 MVP

**Goal**: Enforce physical data isolation across workspaces and organizations using PostgreSQL Row-Level Security (RLS) policies.

**Independent Test**: Run integration tests in `tests/integration/db-rls.test.ts` inserting data across two workspaces/organizations and verifying zero cross-tenant leakage.

- [x] **T005 [US1]** Add `ENABLE ROW LEVEL SECURITY` and `FORCE ROW LEVEL SECURITY` with fail-closed policies on `tasks`, `task_artifacts`, `llm_calls`, `task_gate_decisions`, `secret_vault`, `code_symbols`, `code_references`, `confidence_calibration`, `escalations`, `task_locks`, `review_evidence`, `mcp_servers`, `skills`, `addon_registry`, and the dual workspace + org-wide policy on `project_lessons` using `NULLIF(current_setting(...), '')::UUID`.
- [x] **T006 [US1]** Author integration test suite in `tests/integration/db-rls.test.ts` testing `withTenantContext`, migration up/down reversibility, cross-tenant isolation between Workspace A and Workspace B, org-wide lesson visibility strictly within the same org, and fail-closed behavior when tenant context is unset.

---

## Phase 5: User Story 3 - Validated Markdown Frontmatter & Artifact Schemas (Priority: P1)

**Goal**: Provide TypeBox schemas and deterministic `gray-matter` parsing/serialization for task Markdown artifacts (`brief.md`, `plan.md`, `review-signoff.md`, `escalation-request.md`).

**Independent Test**: Execute `tests/unit/schemas-task.test.ts` validating all canonical frontmatter structures and round-trip parsing fidelity.

- [x] **T007 [P] [US3]** Implement TypeBox schemas and TypeScript types in `src/orchestrator/schemas/task.ts` for `TaskStatusSchema` (16 states), `TaskTypeSchema` (4 types), `DevTierSchema` (3 tiers), `TaskBriefFrontmatterSchema`, `TaskPlanFrontmatterSchema`, `EscalationRequestFrontmatterSchema`, and `ReviewSignoffFrontmatterSchema`.
- [x] **T008 [US3]** Implement `parseMarkdownArtifact` and `serializeMarkdownArtifact` in `src/orchestrator/schemas/task.ts` using `gray-matter` and TypeBox `Value.Check`/`Value.Errors`, throwing `GraywolfAppError('ACI_VALIDATION_FAILED')` with structured details on validation error.
- [x] **T009 [US3]** Author unit tests in `tests/unit/schemas-task.test.ts` covering valid parsing, diagnostic errors on missing/malformed fields, and round-trip serialization fidelity for all 4 task artifact schemas.

---

## Phase 6: User Story 4 - Validated Relay Result & Project Configuration Contracts (Priority: P2)

**Goal**: Provide runtime TypeBox validation for in-container relay execution results (`delegate-relay.result.v1`) and workspace project configuration (`project.config.json`).

**Independent Test**: Execute `tests/unit/schemas-contracts.test.ts` testing canonical payloads, invalid formats, and PRD/ADR extensions.

- [x] **T010 [P] [US4]** Implement `DelegateRelayResultSchema` and `validateRelayResult(payload: unknown)` in `src/orchestrator/schemas/relay-result.ts` strictly translating `specs/001-multi-agent-platform/contracts/relay-result.json`.
- [x] **T011 [P] [US4]** Implement `AddonManifestSchema`, `ProjectConfigSchema`, and `validateProjectConfig(payload: unknown)` in `src/orchestrator/schemas/project-config.ts` covering blast-radius, locale (`ar`, `en`, `fr`, `tr`), UI persona (`maker`, `developer`), gate policies, AI reviewer personas, CLI subscription auth, and addon manifests.
- [x] **T012 [US4]** Author unit tests in `tests/unit/schemas-contracts.test.ts` validating valid and invalid payloads for both `result.json` and `project.config.json`.

---

## Phase 7: Verification & Static Quality Gate

**Purpose**: Ensure zero compile, lint, or testing regressions across the entire platform.

- [x] **T013** Run `pnpm typecheck && pnpm lint` to verify zero TypeScript errors and zero ESLint warnings.
- [x] **T014** Run `pnpm test` (Vitest) validating 100% pass across all unit and integration test suites.

---

## Dependencies & Execution Order

- **Phase 1 (Setup)** completes first.
- **Phase 2 (withTenantContext)** is foundational for Phase 4 (RLS testing).
- **Phase 3 (Migration & DDL)** and **Phase 4 (RLS Policies & Tests)** execute sequentially to guarantee a working database baseline.
- **Phase 5 (Task Frontmatter Schemas)** and **Phase 6 (Contract Schemas)** can be implemented in parallel (`[P]` tagged).
- **Phase 7 (Verification)** runs as the final quality gate before Step 6 `/speckit-analyze` and Step 7 Human Approval.
