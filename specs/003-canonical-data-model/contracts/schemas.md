# Schema & Frontmatter Contracts: 003-canonical-data-model

## 1. Database Tenant Context Helper (`src/orchestrator/db/index.ts`)

- `withTenantContext<T>(ctx: { workspaceId: string; orgId?: string }, fn: (client: PoolClient) => Promise<T>): Promise<T>`
  - Begins transaction (`BEGIN`).
  - Sets `app.current_workspace_id` and `app.current_org_id` with transaction-local scope (`set_config(..., true)`).
  - Runs `fn(client)` and commits (`COMMIT`), or rolls back (`ROLLBACK`) on error.

## 2. Markdown Frontmatter Contracts (`src/orchestrator/schemas/task.ts`)

- `TaskBriefFrontmatterSchema` (`brief.md`)
- `TaskPlanFrontmatterSchema` (`plan.md`)
- `EscalationRequestFrontmatterSchema` (`escalation-request.md`)
- `ReviewSignoffFrontmatterSchema` (`review-signoff.md`)
- `parseMarkdownArtifact(markdown, schema)` / `serializeMarkdownArtifact(frontmatter, body, schema)`

## 3. JSON Contracts (`src/orchestrator/schemas/relay-result.ts` & `project-config.ts`)

- `DelegateRelayResultSchema`: Validates `.agents/tasks/<TASK_ID>/result.json` (`version: 'delegate-relay.result.v1'`).
- `ProjectConfigSchema`: Validates `.agents/project.config.json` including `blastRadius`, `modelRouting`, `limits`, `locale`, `ui.persona`, `gatePolicy`, `aiReviewer`, `cliSubscriptionAuth`, and `addons` (`AddonManifestSchema`).
