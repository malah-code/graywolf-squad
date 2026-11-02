# Data Model: Platform Foundation

## Entities

### `Task`
Tracks the lifecycle of an execution payload.

**Fields**:
- `id` (VARCHAR 50): Primary key, e.g., `TASK-001`.
- `status` (VARCHAR 50): Current state of the task (`BACKLOG`, `QUEUED`, `IN_PROGRESS`, `MERGED`, etc.).
- `plan_id` (VARCHAR 50): Associated execution plan ID.
- `budget_usd` (NUMERIC 10,2): Hard ceiling budget for the task (default: $5.00).
- `current_spend_usd` (NUMERIC 10,2): Real-time token/LLM spend ticker (default: $0.00).
- `repository_id` (VARCHAR 100): Target git repository.
- `branch_name` (VARCHAR 100): Isolated worktree branch name.
- `workspace_id` (UUID): Tenant/workspace identifier used for Row Level Security (RLS).
- `created_at` (TIMESTAMPTZ): Creation timestamp.
- `updated_at` (TIMESTAMPTZ): Last update timestamp.

**State Transitions**:
1. `BACKLOG` (Initial)
2. `QUEUED` (Triggered via API)
3. `IN_PROGRESS` (Container spawned)
4. `MERGED` (Container returned `{ type: "result.final" }`)

## SQL Schema
```sql
CREATE TABLE tasks (
    id VARCHAR(50) PRIMARY KEY,
    status VARCHAR(50) NOT NULL,
    plan_id VARCHAR(50),
    budget_usd NUMERIC(10, 2) NOT NULL DEFAULT 5.00,
    current_spend_usd NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
    repository_id VARCHAR(100),
    branch_name VARCHAR(100),
    workspace_id UUID NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_tasks_status ON tasks(status);
CREATE INDEX idx_tasks_created_at ON tasks(created_at);

-- Multi-Tenant Row Level Security (RLS)
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;

CREATE POLICY workspace_isolation_policy ON tasks
FOR ALL
USING (workspace_id = current_setting('graywolf.workspace_id', true)::uuid)
WITH CHECK (workspace_id = current_setting('graywolf.workspace_id', true)::uuid);
```
