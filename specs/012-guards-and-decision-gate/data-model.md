# Data Model: Reactive Quality Guards, Passive Evidence Ledger & System-One DecisionGate

**Feature**: `012-guards-and-decision-gate`  
**Phase**: Phase 10  
**Source of Truth**: `specs/001-multi-agent-platform/data-model.md` §1.3 & `migrations/1789444040216_create-tasks-table.js`

## 1. Relational Schema Touchpoints (Existing Canonical Tables)

No new database migration is required in Phase 10 because `task_gate_decisions` (Table #15) and `review_evidence` (Table #16) were created in Phase 1 (`migrations/1789444040216_create-tasks-table.js`).

### 1.1 `review_evidence` Table (Table #16 — ADR-062)
| Column | Type | Nullable | Constraints & Description |
|---|---|---|---|
| `id` | `UUID` | `NOT NULL` (PK) | Default `gen_random_uuid()` |
| `task_id` | `VARCHAR(64)` | `NOT NULL` (FK) | References `tasks(id) ON DELETE CASCADE` |
| `workspace_id` | `UUID` | `NOT NULL` (FK) | References `workspaces(id) ON DELETE CASCADE` (RLS key) |
| `command_type` | `VARCHAR(32)` | `NOT NULL` | `'test' \| 'lint' \| 'typecheck' \| 'build' \| 'browser-test'` |
| `command` | `TEXT` | `NOT NULL` | Executed command string |
| `exit_code` | `INT` | `NOT NULL` | Process exit code (`0` = pass, non-zero = fail) |
| `duration_ms` | `INT` | `NOT NULL` | Execution duration in milliseconds |
| `stdout_summary` | `TEXT` | `NULL` | Truncated stdout summary (max 4,000 chars) |
| `stderr_summary` | `TEXT` | `NULL` | Truncated stderr summary (max 4,000 chars) |
| `created_at` | `TIMESTAMPTZ` | `NOT NULL` | Default `NOW()` |

### 1.2 `task_gate_decisions` Table (Table #15 — ADR-079)
| Column | Type | Nullable | Constraints & Description |
|---|---|---|---|
| `id` | `UUID` | `NOT NULL` (PK) | Default `gen_random_uuid()` |
| `task_id` | `VARCHAR(64)` | `NOT NULL` (FK) | References `tasks(id) ON DELETE CASCADE` |
| `workspace_id` | `UUID` | `NOT NULL` (FK) | References `workspaces(id) ON DELETE CASCADE` (RLS key) |
| `gate` | `VARCHAR(32)` | `NOT NULL` | `'sandbox_tier' \| 'gate_policy' \| 'relay_tool' \| 'two_strike_prescreen'` |
| `question` | `TEXT` | `NOT NULL` | Serialized gate evaluation input summary |
| `result` | `JSONB` | `NOT NULL` | Structured decision payload (including `decision`, `usedFallback`, `fallbackReason`) |
| `confidence` | `NUMERIC(4, 3)` | `NOT NULL` | Classifier confidence score (`0.000`–`1.000`) |
| `latency_ms` | `INT` | `NOT NULL` | Gate evaluation duration in milliseconds |
| `model_backend` | `VARCHAR(64)` | `NOT NULL` | Classifier identifier (e.g. `'system-one-local'`, `'frontier-fallback'`) |
| `created_at` | `TIMESTAMPTZ` | `NOT NULL` | Default `NOW()` |

---

## 2. Worktree & Domain Artifacts

### 2.1 `<worktree>/.agent_evidence.db`
- Append-only JSON-lines ledger file inside the task worktree where each line is a serialized `VerificationEvidenceEntry` (`id`, `taskId`, `workspaceId`, `commandType`, `command`, `exitCode`, `durationMs`, `stdoutSummary`, `stderrSummary`, `createdAt`).

### 2.2 `.agents/tasks/<TASK_ID>/verification.md` (`data-model.md` §1.3)
- Markdown report containing:
  - `# Verification Report: <TASK_ID>`
  - `- **Evaluation Timestamp**: <ISO-8601>`
  - `- **Overall Verdict**: PASS | FAIL`
  - `## Guard 1: Clean-Code Guard` (`PASSED` | `FAILED` + checklist items & violations)
  - `## Guard 2: Test Guard` (`PASSED` | `FAILED` + checklist items & violations)
  - `## Guard 3: Documentation Guard` (`PASSED` | `FAILED` + checklist items & violations)
