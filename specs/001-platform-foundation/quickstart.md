# Quickstart: Platform Foundation Validation

## Prerequisites
- Node.js v20+
- `pnpm` (or `npm`)
- Docker Desktop / Docker Engine running locally
- PostgreSQL 16 running locally on port 5432 (e.g. via `docker run --name pg -e POSTGRES_PASSWORD=postgres -p 5432:5432 -d postgres:16`)

## Setup
1. Create the `tasks` table in your local Postgres:
```bash
psql -U postgres -h localhost -c "CREATE TABLE tasks (id VARCHAR(64) PRIMARY KEY, status VARCHAR(48) NOT NULL DEFAULT 'BACKLOG', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());"
```

2. Install dependencies:
```bash
npm install
```

3. Start the orchestrator server:
```bash
npm run dev
```
*(Server will listen on port 3000 for REST and 3001 for WebSocket)*

## Validation Execution

Trigger the dummy task dispatch:
```bash
curl -X POST http://localhost:3000/tasks/TASK-001/dispatch
```

**Expected Outcome**:
1. The API responds with `{"taskId": "TASK-001", "status": "QUEUED"}`.
2. In the orchestrator terminal, you will see logs indicating:
   - Task `TASK-001` transitioned to `IN_PROGRESS`.
   - Docker container spawned.
   - WebSocket connection received on port 3001.
   - `{ type: "result.final" }` message received from the container.
   - Task `TASK-001` transitioned to `MERGED`.
   - Docker container exits and is cleaned up.

3. Verify the database state:
```bash
psql -U postgres -h localhost -c "SELECT * FROM tasks WHERE id = 'TASK-001';"
```
*(Status should be `MERGED`)*
