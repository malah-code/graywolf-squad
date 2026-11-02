# Data Model: 005-control-plane-api-aci

**Feature**: `005-control-plane-api-aci`

## 1. Control Plane REST API Models (`openapi.yaml`)

| Schema | Fields |
|---|---|
| `SessionContext` | `userId`, `email`, `currentWorkspaceId`, `currentOrganizationId`, `role` (`owner \| lead_dev \| developer \| viewer`) |
| `Workspace` | `id`, `name`, `slug`, `role` |
| `Project` | `id`, `workspaceId`, `name`, `slug`, `mode` (`greenfield \| brownfield`), `gitRemoteUrl`, `gitProvider` (`github \| gitlab \| bitbucket \| azure \| gitea`) |
| `Task` | `id` (`TASK-*`), `projectId`, `workspaceId`, `title`, `type`, `status`, `priority` (`LOW \| MEDIUM \| HIGH \| CRITICAL`), `blockedBy` (`string[]`), `writableScope` (`string[]`), `spendUsd` (`number`) |
| `ToolExecutionRecord` | `toolName`, `authorized` (`boolean`), `executed` (`boolean`), `error?` (`string \| null`), `result?` (`Record<string, unknown> \| null`), `validationErrors?` (`Array<{ path: string; message: string }>`) |

## 2. Cockpit & Agent ACI Tool Matrix (`src/orchestrator/aci/tool-schemas.ts`)

| Tool Name | Required Casbin Action | Minimum Role | Key Arguments |
|---|---|---|---|
| `create_task` | `create_task` | `developer` | `projectId`, `title`, `briefMarkdown`, `priority?`, `blockedBy?`, `writableScope?` |
| `reorder_backlog` | `reorder_backlog` | `developer` | `projectId`, `orderedTaskIds` |
| `update_blocked_by` | `reorder_backlog` | `developer` | `taskId`, `blockedBy` |
| `pause_container` | `dispatch_task` | `developer` | `taskId`, `reason?` |
| `cancel_task` | `dispatch_task` | `developer` | `taskId`, `reason?` |
| `approve_pr_merge` | `approve_review_gate` | `lead_dev` | `taskId`, `comment?` |
| `modify_blast_radius` | `modify_blast_radius` | `lead_dev` | `projectId`, `writable`, `readonly?`, `forbidden?` |
