# Implementation Plan: 003-canonical-data-model

**Branch**: `003-canonical-data-model` | **Date**: 2026-10-18 | **Spec**: [specs/003-canonical-data-model/spec.md](file:///home/tarikelmallah/Projects/GraywolfSquad/specs/003-canonical-data-model/spec.md)  
**Target Phase**: Phase 1 — Canonical Data Model, PostgreSQL RLS & Core Schemas (`docs/implementation-plan-detailed.md`)

## Summary

Phase 1 implements the canonical relational and vector database schema on PostgreSQL 16 + `pgvector` (`specs/001-multi-agent-platform/data-model.md` §2), the transaction-scoped Row-Level Security (RLS) tenant context helper (`withTenantContext`), and the TypeBox runtime validation contracts for all Markdown task frontmatter artifacts (`brief.md`, `plan.md`, `review-signoff.md`, `escalation-request.md`) and JSON configuration/relay contracts (`delegate-relay.result.v1` and `project.config.json`).

## Technical Context

**Language/Version**: TypeScript 5.8+ / Node.js 20+  
**Primary Dependencies**: `pg` (`^8.23.0`), `node-pg-migrate` (`^9.0.0`), `@sinclair/typebox` (`^0.34.47`), `gray-matter` (`^4.0.3`), `pino` (`^10.3.1`)  
**Storage**: PostgreSQL 16 + `pgvector` (`vector(768)` via `nomic-embed-text`) + `pgcrypto`  
**Testing**: `vitest` (`^3.0.8`) for unit and PostgreSQL RLS integration tests  
**Target Platform**: Linux / Docker Compose (`pgvector/pgvector:pg16`)  
**Project Type**: Multi-Agent Orchestrator Backend Service  
**Performance Goals**: `< 5s` full migration `up -> down -> up` cycle; `< 1ms` TypeBox schema validation and frontmatter parsing overhead  
**Constraints**: Mandatory `ENABLE ROW LEVEL SECURITY` and `FORCE ROW LEVEL SECURITY` on all tenant-scoped tables; fail-closed `NULLIF(current_setting(...), '')::UUID` policy evaluation; 0 `any` casts (ESLint strict compliance)

## Constitution Check

*GATE: Must pass before Phase 1 tasks generation.*

- [x] **Human Sovereignty & Non-Committing Relay Contract (Principle 1)**: `DelegateRelayResultSchema` and `ReviewSignoffFrontmatterSchema` strictly enforce the non-committing relay output contract (`result.json`) and Dev-Level-2 sign-off gate before external QA guards.
- [x] **Zero Runtime Lock-In & Permissive Licensing (Principle 2)**: Uses PostgreSQL (`pg`), `pgvector`, `node-pg-migrate`, `@sinclair/typebox`, and `gray-matter` (all MIT / PostgreSQL licensed).
- [x] **Single ACID Relational & Vector Baseline (Principle 3)**: Consolidates all 24 relational tables, tenant RLS policies, and `vector(768)` embeddings (`task_artifacts.embedding`, `project_lessons.embedding`) inside PostgreSQL 16 + `pgvector`.
- [x] **Dual Operational Mode: Greenfield & Brownfield (Principle 5)**: `ProjectConfigSchema` enforces `mode: 'greenfield' | 'brownfield'` and explicit `blastRadius` (`writable`, `readonly`, `forbidden`) plus `EscalationRequestFrontmatterSchema` for boundary violations.
- [x] **Virtual Developer Tier Handoff Protocol (Principle 6)**: `TaskBriefFrontmatterSchema`, `TaskPlanFrontmatterSchema`, and `ReviewSignoffFrontmatterSchema` codify the `dev-level-1` ➔ `dev-level-3` ➔ `dev-level-2` handoff metadata and two-strike counter (`internalReviewAttempts`).

## Project Structure

### Documentation (this feature)

```text
specs/003-canonical-data-model/
├── spec.md              # Feature specification
├── plan.md              # This implementation plan
├── research.md          # Phase 0 research & technical decisions
├── data-model.md        # Complete 24-table DDL, RLS policies & schema mappings
├── quickstart.md        # Runnable verification guide
├── checklists/
│   └── requirements.md  # Specification quality checklist
└── contracts/
    └── schemas.md       # TypeBox & Frontmatter contract specifications
```

### Source Code (repository root)

```text
GraywolfSquad/
├── migrations/
│   └── 1789444040216_create-tasks-table.js  # Updated to full canonical 24-table + RLS migration (or superseded cleanly)
├── src/
│   └── orchestrator/
│       ├── db/
│       │   └── index.ts                     # Pool + query + getClient + withTenantContext<T>
│       └── schemas/
│           ├── task.ts                      # Task status/type + brief/plan/review-signoff/escalation frontmatter schemas & gray-matter parser/serializer
│           ├── relay-result.ts              # DelegateRelayResultSchema (delegate-relay.result.v1)
│           └── project-config.ts            # ProjectConfigSchema + AddonManifest + PRD/ADR extensions
└── tests/
    ├── unit/
    │   ├── schemas-task.test.ts             # Unit tests for brief.md, plan.md, review-signoff.md, escalation-request.md schemas & parser/serializer
    │   └── schemas-contracts.test.ts        # Unit tests for delegate-relay.result.v1 & project.config.json schemas
    └── integration/
        └── db-rls.test.ts                   # Integration tests for withTenantContext, migration up/down/up, and cross-tenant RLS isolation
```

**Structure Decision**: Matches the exact file layout specified in `docs/implementation-plan-detailed.md` §2 and Phase 1 (Tasks 1.1–1.4).

---

## Detailed Component Specifications

### 1. Tenant-Aware Database Pool & RLS Transaction Helper (`src/orchestrator/db/index.ts` — Task 1.1)

- **Interface**:
  ```typescript
  export interface TenantContext {
    workspaceId: string;
    orgId?: string;
  }

  export const withTenantContext = async <T>(
    ctx: TenantContext,
    fn: (client: PoolClient) => Promise<T>
  ): Promise<T>
  ```
- **Execution Flow**:
  1. Checkout a client from `pool` via `await getClient()`.
  2. Execute `await client.query('BEGIN')`.
  3. Execute `await client.query("SELECT set_config('app.current_workspace_id', $1, true), set_config('app.current_org_id', $2, true)", [ctx.workspaceId, ctx.orgId ?? ''])`.
  4. Run `const result = await fn(client)`.
  5. Execute `await client.query('COMMIT')` and return `result`.
  6. On any exception inside steps 2–5, execute `await client.query('ROLLBACK')` (catching rollback errors safely so original error is preserved) and rethrow the error.
  7. In `finally`, always invoke `client.release()`.

### 2. Full Canonical Migration (`migrations/1789444040216_create-tasks-table.js` — Task 1.2)

- Replaces the Phase 0 placeholder `tasks`-only migration with the complete canonical schema from `specs/001-multi-agent-platform/data-model.md` §2 and `docs/implementation-plan-detailed.md` Task 1.2:
  - **Extensions**: `CREATE EXTENSION IF NOT EXISTS vector; CREATE EXTENSION IF NOT EXISTS pgcrypto;`
  - **Tenancy Tables (7)**:
    1. `organizations` (`id UUID PK`, `slug UNIQUE`, `name`, `plan_tier`, `mode`, `created_at`, `updated_at`)
    2. `workspaces` (`id UUID PK`, `org_id FK -> organizations`, `name`, `slug`, `created_at`, `UNIQUE(org_id, slug)`)
    3. `users` (`id UUID PK`, `email UNIQUE`, `full_name`, `avatar_url`, `created_at`)
    4. `workspace_members` (`id UUID PK`, `workspace_id FK`, `user_id FK`, `role`, `created_at`, `UNIQUE(workspace_id, user_id)`)
    5. `workspace_invites` (`id UUID PK`, `workspace_id FK`, `invited_by FK -> users`, `token_hash VARCHAR(64) UNIQUE`, `target_role`, `max_uses`, `uses_count`, `expires_at`, `created_at`)
    6. `workspace_member_identities` (`id UUID PK`, `workspace_id FK`, `user_id FK`, `provider VARCHAR(32)`, `external_provider_user_id VARCHAR(255)`, `created_at`, `UNIQUE(workspace_id, provider, external_provider_user_id)`)
    7. `sessions` (`id VARCHAR(128) PK`, `user_id FK`, `workspace_id FK`, `token_hash VARCHAR(64) UNIQUE`, `expires_at`, `revoked_at TIMESTAMPTZ`, `ip_address`, `user_agent`, `created_at`)
  - **Core Tables (6)**:
    8. `projects` (`id UUID PK`, `workspace_id FK`, `name`, `slug`, `mode`, `git_remote_url`, `git_provider`, `config_json JSONB`, `created_at`, `UNIQUE(workspace_id, slug)`)
    9. `tasks` (`id VARCHAR(64) PK`, `project_id FK`, `workspace_id FK`, `title VARCHAR(512)`, `type VARCHAR(32) CHECK (type IN ('feature', 'bug', 'refactor', 'bug-bash-sprint'))`, `status VARCHAR(48) CHECK (status IN ('BACKLOG', 'QUEUED', 'IN_PROGRESS', 'BLOCKED', 'AWAITING_CLARIFICATION', 'INTERNAL_REVIEW', 'INTERNAL_REVIEW_FAILED', 'GUARD_VERIFYING', 'QA_FIXING', 'VERIFICATION_FAILED', 'HUMAN_REVIEW_GATE', 'MERGED', 'REJECTED', 'ESCALATED', 'UPDATED', 'CANCELLED')) DEFAULT 'BACKLOG'`, `priority VARCHAR(16)`, `assigned_tier VARCHAR(16)`, `blocked_by TEXT[]`, `writable_scope TEXT[]`, `spend_limit_usd NUMERIC(10,4)`, `current_spend_usd NUMERIC(10,4)`, `internal_review_attempts INT`, `created_at`, `updated_at`)
    10. `task_dependencies` (`task_id FK -> tasks`, `blocked_by_task_id FK -> tasks`, `PRIMARY KEY (task_id, blocked_by_task_id)`)
    11. `task_artifacts` (`id UUID PK`, `task_id FK`, `workspace_id FK`, `artifact_type VARCHAR(32)`, `authored_by VARCHAR(16)`, `file_path TEXT`, `content_hash VARCHAR(64)`, `embedding vector(768)`, `created_at`)
    12. `escalations` (`id UUID PK`, `task_id FK`, `workspace_id FK`, `escalation_type VARCHAR(32)`, `agent_tier VARCHAR(16)`, `emitted_at`, `resolved_at`, `resolution VARCHAR(16)`)
    13. `task_locks` (`task_id VARCHAR(64) PK FK -> tasks`, `workspace_id UUID NOT NULL FK -> workspaces`, `pid INT NOT NULL`, `container_id VARCHAR(128)`, `acquired_at BIGINT NOT NULL`, `last_heartbeat BIGINT NOT NULL`, `stale_timeout_ms INT NOT NULL DEFAULT 30000`)
  - **Observability & Gates Tables (3)**:
    14. `llm_calls` (`id UUID PK`, `task_id FK`, `workspace_id FK`, `org_id FK`, `persona VARCHAR(32)`, `model VARCHAR(128)`, `provider VARCHAR(64)`, `input_tokens INT`, `output_tokens INT`, `cache_read_tokens INT`, `cache_write_tokens INT`, `cost_usd NUMERIC(10,6)` nullable for CLI subscription auth per ADR-081, `latency_ms INT`, `status VARCHAR(16)`, `created_at`)
    15. `task_gate_decisions` (`id UUID PK`, `task_id FK`, `workspace_id FK`, `gate VARCHAR(32)`, `question TEXT`, `result JSONB`, `confidence NUMERIC(4,3)`, `latency_ms INT`, `model_backend VARCHAR(64)`, `created_at`)
    16. `review_evidence` (`id UUID PK`, `task_id VARCHAR(64) NOT NULL FK -> tasks`, `workspace_id UUID NOT NULL FK -> workspaces`, `command_type VARCHAR(32) NOT NULL`, `command TEXT NOT NULL`, `exit_code INT NOT NULL`, `duration_ms INT NOT NULL`, `stdout_summary TEXT`, `stderr_summary TEXT`, `created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`)
  - **Security & Calibration Tables (3)**:
    17. `secret_vault` (`id UUID PK`, `workspace_id FK`, `secret_name VARCHAR(128)`, `encrypted_value BYTEA`, `encrypted_dek BYTEA`, `created_at`, `updated_at`, `UNIQUE(workspace_id, secret_name)`)
    18. `mcp_servers` (`id UUID PK`, `workspace_id UUID NOT NULL FK -> workspaces`, `name VARCHAR(128) NOT NULL`, `transport VARCHAR(32) NOT NULL`, `command_or_url TEXT NOT NULL`, `secret_refs TEXT[] DEFAULT '{}'`, `enabled BOOLEAN NOT NULL DEFAULT true`, `created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`, `UNIQUE(workspace_id, name)`)
    19. `confidence_calibration` (`id UUID PK`, `task_id FK`, `workspace_id FK`, `user_id FK -> users ON DELETE SET NULL`, `model_id VARCHAR(64)`, `model_version VARCHAR(32)`, `file_path TEXT`, `file_language VARCHAR(32)`, `file_type VARCHAR(32)`, `confidence_score NUMERIC(3,2)`, `justification TEXT`, `created_at`)
  - **Learning & Context Tables (5)**:
    20. `project_lessons` (`id UUID PK`, `org_id FK`, `workspace_id FK`, `project_id FK`, `is_org_wide BOOLEAN DEFAULT false`, `source_task_id FK -> tasks ON DELETE SET NULL`, `provenance VARCHAR(32)`, `confidence_score NUMERIC(3,2)`, `category VARCHAR(32)`, `trigger_scope TEXT[]`, `summary TEXT`, `rule_content TEXT`, `embedding vector(768)`, `times_applied INT`, `times_rejected INT`, `status VARCHAR(16)`, `last_applied_at`, `created_at`, `updated_at`)
    21. `code_symbols` (`id UUID PK`, `org_id FK`, `workspace_id FK`, `project_id FK`, `name VARCHAR(255)`, `kind VARCHAR(32)`, `file_path TEXT`, `line_start INT`, `line_end INT`, `exported BOOLEAN`, `signature TEXT`, `hash VARCHAR(64)`)
    22. `code_references` (`id UUID PK`, `org_id FK`, `workspace_id FK`, `project_id FK`, `caller_symbol_id FK -> code_symbols`, `callee_symbol_id FK -> code_symbols`, `reference_type VARCHAR(16)`)
    23. `skills` (`id UUID PK`, `workspace_id UUID NOT NULL FK -> workspaces`, `project_id UUID REFERENCES projects(id) ON DELETE CASCADE`, `name VARCHAR(64) NOT NULL`, `description VARCHAR(128) NOT NULL`, `version VARCHAR(32) NOT NULL DEFAULT '0.1.0'`, `origin VARCHAR(32) NOT NULL DEFAULT 'agent-created'`, `status VARCHAR(32) NOT NULL DEFAULT 'active'`, `pinned BOOLEAN NOT NULL DEFAULT false`, `file_path TEXT NOT NULL`, `usage_count INT NOT NULL DEFAULT 0`, `last_used_at TIMESTAMPTZ`, `created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`, `updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`, `UNIQUE(workspace_id, name)`)
    24. `addon_registry` (`id UUID PK`, `workspace_id UUID NOT NULL FK -> workspaces`, `project_id UUID REFERENCES projects(id) ON DELETE CASCADE`, `package_name VARCHAR(255) NOT NULL`, `addon_type VARCHAR(32) NOT NULL`, `tier VARCHAR(32) NOT NULL`, `shadow_state VARCHAR(32) NOT NULL DEFAULT 'shadow'`, `shadow_run_count INT NOT NULL DEFAULT 0`, `shadow_discard_rate NUMERIC(4,3) NOT NULL DEFAULT 0.000`, `content_hash VARCHAR(64)`, `approved_at TIMESTAMPTZ`, `approved_by VARCHAR(255)`, `created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`, `updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`, `UNIQUE(workspace_id, package_name)`)
- **Row-Level Security (RLS) Policies**:
  - Enable and force RLS (`ENABLE ROW LEVEL SECURITY; FORCE ROW LEVEL SECURITY;`) on `tasks`, `task_artifacts`, `llm_calls`, `task_gate_decisions`, `secret_vault`, `code_symbols`, `code_references`, `confidence_calibration`, `project_lessons`, `escalations`, `task_locks`, `review_evidence`, `mcp_servers`, `skills`, and `addon_registry`.
  - Standard workspace policy uses fail-closed `NULLIF(current_setting('app.current_workspace_id', true), '')::UUID`:
    ```sql
    CREATE POLICY workspace_isolation ON <table>
      FOR ALL
      USING (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::UUID)
      WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::UUID);
    ```
  - `project_lessons` dual workspace + org-wide policy:
    ```sql
    CREATE POLICY tenant_and_org_lesson_isolation ON project_lessons
      FOR ALL
      USING (
        (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::UUID)
        OR
        (is_org_wide = true AND org_id = NULLIF(current_setting('app.current_org_id', true), '')::UUID)
      )
      WITH CHECK (
        workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::UUID
        AND org_id = NULLIF(current_setting('app.current_org_id', true), '')::UUID
      );
    ```

### 3. Markdown Task Frontmatter Schemas & Parser (`src/orchestrator/schemas/task.ts` — Task 1.3)

- Defines TypeBox schemas:
  - `TaskStatusSchema`: 16 literals (`BACKLOG`, `QUEUED`, `IN_PROGRESS`, `BLOCKED`, `AWAITING_CLARIFICATION`, `INTERNAL_REVIEW`, `INTERNAL_REVIEW_FAILED`, `GUARD_VERIFYING`, `QA_FIXING`, `VERIFICATION_FAILED`, `HUMAN_REVIEW_GATE`, `MERGED`, `REJECTED`, `ESCALATED`, `UPDATED`, `CANCELLED`).
  - `TaskTypeSchema`: `'feature' | 'bug' | 'refactor' | 'bug-bash-sprint'`.
  - `DevTierSchema`: `'dev-level-1' | 'dev-level-2' | 'dev-level-3'`.
  - `TaskBriefFrontmatterSchema`: `id` (`^TASK-[0-9A-Z-]+$`), `title`, `type`, `status`, `priority` (`P1 | P2 | P3 | LOW | MEDIUM | HIGH | CRITICAL`), `assignedTier` (optional), `blockedBy` (`string[]`), `branch` (optional), `targetFiles` (`string[]`, optional), `writableScope` (`string[]`), `spendLimitUSD` (`number`), `currentSpendUSD` (`number`), `internalReviewAttempts` (`integer`), `created` (`string`), `updated` (`string`).
  - `TaskPlanFrontmatterSchema`: `taskId`, `authoredBy` (`'dev-level-1'`), `modelUsed`, `designatedImplementer`, `designatedReviewer`, `requiresHumanGate` (`boolean`).
  - `EscalationRequestFrontmatterSchema`: `taskId`, `escalationType` (`'boundary-violation' | 'internal-review-failed' | 'qa-loop-exceeded' | 'stuck-detector'`), `emittedAt`, `agentTier`.
  - `ReviewSignoffFrontmatterSchema`: `taskId`, `reviewer` (`'dev-level-2'`), `attempt` (`integer`, min 1), `verdict` (`'approved' | 'rejected'`).
- Provides `parseMarkdownArtifact<T extends TSchema>(rawMarkdown: string, schema: T): { frontmatter: Static<T>; body: string }` and `serializeMarkdownArtifact<T extends TSchema>(frontmatter: Static<T>, body: string, schema: T): string` using `gray-matter` and `@sinclair/typebox/value`, throwing `GraywolfAppError('ACI_VALIDATION_FAILED', ...)` when validation fails.

### 4. Contract Schemas (`src/orchestrator/schemas/relay-result.ts` & `project-config.ts` — Task 1.4)

- `src/orchestrator/schemas/relay-result.ts`:
  - `DelegateRelayResultSchema`: exact TypeBox translation of `specs/001-multi-agent-platform/contracts/relay-result.json` + `validateRelayResult(payload: unknown): DelegateRelayResult`.
- `src/orchestrator/schemas/project-config.ts`:
  - `AddonManifestSchema`: matches `AddonManifest` in `specs/002-addon-sdk/addon-interfaces.ts`.
  - `ProjectConfigSchema`: matches `data-model.md` §1.5 (`projectId`, `mode`, `sourceControl`, `blastRadius`, `modelRouting`, `taskTags`, `limits`, `skillImports`) plus PRD/ADR extensions (`locale: 'ar' | 'en' | 'fr' | 'tr'`, `ui: { persona: 'maker' | 'developer' }`, `gatePolicy`, `aiReviewer`, `cliSubscriptionAuth`, `addons: AddonManifestSchema`) + `validateProjectConfig(payload: unknown): ProjectConfig`.

## Complexity Tracking

No Constitution violations. All components strictly follow the standard technology stack matrix.
