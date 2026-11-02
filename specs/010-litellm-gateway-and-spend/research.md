# Research & Technical Decisions: LiteLLM Gateway, Circuit Breaker & Token Spend Governance

**Feature**: `010-litellm-gateway-and-spend`  
**Phase**: Phase 8  
**Date**: 2026-10-19

## 1. Virtual Model Alias Routing & LiteLLM Proxy Protocol (`litellm-client.ts`)

- **Decision**: Route all cognitive tier model completions through LiteLLM's OpenAI-compatible HTTP endpoint (`${env.LITELLM_URL}/v1/chat/completions`) using virtual role aliases (`agent-planner`, `agent-coder`, `agent-reviewer`, `agent-arbiter` or project-specific `modelRouting` overrides).
- **Rationale**:
  - Aligns with Constitution Principle 6 ("Model tier assignments ... map to LiteLLM virtual aliases, NOT to specific model providers") and Principle 2/9 (zero runtime lock-in).
  - Using native Node 20 `fetch` (or injectable `fetchImpl` for deterministic unit tests) avoids heavyweight SDK lock-in while parsing standard OpenAI-compatible responses plus LiteLLM response headers/fields (`x-litellm-model-cost`, `usage.prompt_tokens`, `usage.completion_tokens`, `usage.prompt_tokens_details?.cached_tokens`, `usage.cache_read_input_tokens`, `usage.cache_creation_input_tokens`).
- **Alternatives Considered**:
  - Direct provider SDKs (`@anthropic-ai/sdk`, `openai`): Rejected because containers and orchestrator tiers must never bind directly to vendor endpoints or hold raw vendor keys.

## 2. Per-Provider 3-Failure Circuit Breaker & <2s Fallback Switch (`circuit-breaker.ts`)

- **Decision**: Implement an in-memory state machine (`CircuitBreakerRegistry`) keyed by alias/provider with three states (`CLOSED`, `OPEN`, `HALF_OPEN`):
  - **Failure threshold**: `3` consecutive transient failures (HTTP `429` or `500`/`502`/`503`/`504` or network timeout).
  - **Non-tripping errors**: HTTP `400` context-window errors map immediately to `GraywolfAppError('LLM_CONTEXT_WINDOW_EXCEEDED')` without incrementing the circuit breaker failure counter.
  - **Failover execution (<2s)**: As soon as a primary alias hits its 3rd consecutive failure (or is already `OPEN`), `LiteLLMClient` immediately dispatches the request to the configured `fallback` alias within the same call cycle (zero long backoff delay on failover, guaranteeing `< 2,000ms` switch time).
  - **Cooldown / Half-Open probe**: Default cooldown `30,000ms` (configurable in constructor for fast tests). After cooldown elapses, the next call enters `HALF_OPEN`; a `200 OK` resets the circuit to `CLOSED` (`failures = 0`), whereas a transient error immediately re-opens it.
- **Rationale**: Satisfies Phase 8 Exit Criteria ("3 failures switch to fallback within 2s") and ADR-042 taxonomy (`LLM_PROVIDER_RATE_LIMITED`, `LLM_CIRCUIT_BREAKER_TRIPPED`, `LLM_LOCAL_MODEL_OFFLINE`, `LLM_CONTEXT_WINDOW_EXCEEDED`).

## 3. ACID Spend Ledger & Atomic Budget Valves (`spend-ledger.ts`)

- **Decision**:
  - **Local Provider $0 Rule**: Any call where `provider` (case-insensitive) is in `['ollama', 'vllm', 'llamacpp', 'local']` or starts with `'cli-subscription-'` forces `cost_usd = 0` regardless of token counts or upstream headers.
  - **Pre-Flight Daily Budget Check**: Before executing a paid call, query `SELECT COALESCE(SUM(cost_usd), 0) AS daily_spend FROM llm_calls WHERE workspace_id = $1 AND created_at >= date_trunc('day', NOW() AT TIME ZONE 'UTC')` inside `withTenantContext`. If `dailySpendCapUSD > 0` and `daily_spend >= dailySpendCapUSD`, block paid calls with `GraywolfAppError('LLM_DAILY_BUDGET_EXCEEDED')` while still allowing `$0.00` local/subscription calls.
  - **Transactional Ledger Recording + Task Spend Accumulation**: Inside `withTenantContext({ workspaceId, orgId }, ...)`:
    1. Insert row into `llm_calls` (`task_id`, `workspace_id`, `org_id`, `persona`, `model`, `provider`, `input_tokens`, `output_tokens`, `cache_read_tokens`, `cache_write_tokens`, `cost_usd`, `latency_ms`, `status`).
    2. Atomically update `tasks`:
       ```sql
       UPDATE tasks
       SET current_spend_usd = COALESCE(current_spend_usd, 0) + $1,
           updated_at = NOW()
       WHERE id = $2 AND workspace_id = $3
       RETURNING current_spend_usd, spend_limit_usd
       ```
    3. Compute previous spend (`current_spend_usd - cost_usd`) and new ratio (`current_spend_usd / spend_limit_usd` when `spend_limit_usd > 0`):
       - If ratio `>= 1.0`: invoke optional ARP budget notifier (`budget.exceeded` with `currentSpendUSD`, `spendLimitUSD`, `action: 'halt_and_escalate'`) and throw `GraywolfAppError('TASK_SPEND_LIMIT_EXCEEDED')`.
       - Else if ratio `>= 0.8` and previous ratio `< 0.8`: invoke ARP budget notifier (`budget.warning` with `currentSpendUSD`, `spendLimitUSD`, `percentUsed`, `message`).

## 4. Topology A CLI Subscription Auth Bridge (`cli-sub-bridge.ts`)

- **Decision**: Implement ADR-081 Pattern 4 governance in `src/orchestrator/gateway/cli-sub-bridge.ts`:
  - **Topology Gate**: Only active when `topology === 'solo'` (Topology A) AND `projectConfig.cliSubscriptionAuth?.enabled === true`. In Topologies B (`team`) and C (`enterprise`), `resolveCliSubscriptionPolicy()` silently returns `{ active: false, reason: 'topology_ignored' }` with zero errors or warnings.
  - **Provider Tagging & $0 Cost**: When active for a lane/provider (e.g. `claude` -> `anthropic`, `codex` -> `openai`), formats `provider = 'cli-subscription-' + normalizedProvider` and forces `costUsd = 0`.
  - **Wall-Clock & Turn-Count Valves**: Tracks per-task turn count and elapsed wall-clock milliseconds against `maxTurnsPerTask` (default `50`) and `maxWallClockMinutes` (default `30`). Exceeding either cap throws `GraywolfAppError('TASK_SPEND_LIMIT_EXCEEDED')` with structured details `{ capType: 'turns' | 'wall_clock', current, limit }`.
