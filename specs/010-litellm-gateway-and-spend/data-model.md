# Data Model: LiteLLM Gateway, Circuit Breaker & Token Spend Governance

**Feature**: `010-litellm-gateway-and-spend`  
**Phase**: Phase 8  
**Source of Truth**: `specs/001-multi-agent-platform/data-model.md` §2 & `migrations/1789444040216_create-tasks-table.js`

## 1. Relational Schema Touchpoints (Existing Canonical Tables)

No new database migration is required in Phase 8 because `llm_calls` and `tasks` (with RLS enabled and forced) were created in Phase 1 (`migrations/1789444040216_create-tasks-table.js`).

### 1.1 `llm_calls` Table (Table #14)

| Column | Type | Nullable | Description |
|---|---|---|---|
| `id` | `UUID` | `NOT NULL` (PK) | Default `gen_random_uuid()` |
| `task_id` | `VARCHAR(64)` | `NOT NULL` (FK) | References `tasks(id) ON DELETE CASCADE` |
| `workspace_id` | `UUID` | `NOT NULL` (FK) | References `workspaces(id) ON DELETE CASCADE` (RLS key) |
| `org_id` | `UUID` | `NOT NULL` (FK) | References `organizations(id) ON DELETE CASCADE` |
| `persona` | `VARCHAR(32)` | `NOT NULL` | `'planner' \| 'implementer' \| 'reviewer' \| 'arbiter'` |
| `model` | `VARCHAR(128)` | `NOT NULL` | Resolved model identifier (e.g. `'gpt-4o'`, `'deepseek-v3'`, `'qwen2.5-coder:32b'`) |
| `provider` | `VARCHAR(64)` | `NOT NULL` | `'openai'`, `'anthropic'`, `'openrouter'`, `'ollama'`, `'vllm'`, `'llamacpp'`, or `'cli-subscription-{provider}'` |
| `input_tokens` | `INT` | `NOT NULL` | Prompt/input token count |
| `output_tokens` | `INT` | `NOT NULL` | Completion/output token count |
| `cache_read_tokens` | `INT` | `DEFAULT 0` | Prompt cache read tokens (ADR-061) |
| `cache_write_tokens` | `INT` | `DEFAULT 0` | Prompt cache write tokens |
| `cost_usd` | `NUMERIC(10, 6)` | `NOT NULL` | Exact USD cost (`0.000000` for local & Topology A CLI subscription runs) |
| `latency_ms` | `INT` | `NULL` | End-to-end call duration in milliseconds |
| `status` | `VARCHAR(16)` | `NOT NULL` | `'success' \| 'rate_limited' \| 'error'` |
| `created_at` | `TIMESTAMPTZ` | `NOT NULL` | Default `NOW()` |

### 1.2 `tasks` Spend Columns (Table #9)

| Column | Type | Description |
|---|---|---|
| `spend_limit_usd` | `NUMERIC(10, 4)` | Per-task ceiling (e.g. `2.0000`). `0` means no per-task USD limit unless overridden. |
| `current_spend_usd` | `NUMERIC(10, 4)` | Atomically incremented cumulative spend for the task. |

---

## 2. In-Memory Domain Entities

### 2.1 `VirtualModelAlias`
- `'agent-planner' | 'agent-coder' | 'agent-reviewer' | 'agent-arbiter'` (plus custom string aliases defined in `project.config.json` `modelRouting`).

### 2.2 `CircuitBreakerState`
- `state`: `'CLOSED' | 'OPEN' | 'HALF_OPEN'`
- `consecutiveFailures`: `number` (trips at `>= 3`)
- `lastFailureAt`: `number | null` (epoch ms)
- `openedAt`: `number | null` (epoch ms)
- `cooldownMs`: `number` (default `30_000`)

### 2.3 `LlmCallRecordInput` & `SpendValveResult`
- `LlmCallRecordInput`:
  - `taskId: string`
  - `workspaceId: string`
  - `orgId: string`
  - `persona: 'planner' | 'implementer' | 'reviewer' | 'arbiter'`
  - `model: string`
  - `provider: string`
  - `inputTokens: number`
  - `outputTokens: number`
  - `cacheReadTokens?: number`
  - `cacheWriteTokens?: number`
  - `costUsd: number`
  - `latencyMs: number`
  - `status?: 'success' | 'rate_limited' | 'error'`
- `SpendValveResult`:
  - `callId: string`
  - `recordedCostUsd: number`
  - `currentTaskSpendUsd: number`
  - `taskSpendLimitUsd: number`
  - `percentUsed: number`
  - `valveStatus: 'ok' | 'warning_80_percent' | 'task_limit_exceeded' | 'daily_limit_exceeded'`
  - *Daily Cap Scope*: Evaluated prior to dispatch by `assertDailyBudgetAvailable` over `workspace_id` UTC daily aggregate with optional `org_id` ceiling.
  - *Normalization Guard*: `SpendLedger.normalizeCostUsd` is an idempotent pure function forcing `cost_usd = 0.000000` when `provider ∈ {'ollama', 'vllm', 'llamacpp'} OR cliPolicy.active === true OR provider.startsWith('cli-subscription-')`, and rejecting `provider.length > 64` with `SpendingLedgerValidationError`.

### 2.4 `CliSubscriptionPolicy` (ADR-081 Pattern 4)
- `active: boolean` (forced `false` in `'team'` / `'enterprise'`)
- `topology: 'solo' | 'team' | 'enterprise'` (resolved from `process.env.DEPLOYMENT_TOPOLOGY`, default `'solo'`)
- `providerTag: string | null` (forced `null` in non-solo)
- `credentialKey: string | null` (forced `null` in non-solo)
- `maxTurnsPerTask: number` (default `50` in solo; forced `0` in non-solo)
- `maxWallClockMs: number` (default `30 * 60 * 1000` in solo; forced `0` in non-solo)
