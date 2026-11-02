# Quickstart: LiteLLM Gateway, Circuit Breaker & Token Spend Governance

**Feature**: `010-litellm-gateway-and-spend`  
**Phase**: Phase 8

## 1. Run Unit Tests for Phase 8

```bash
pnpm vitest run tests/unit/circuit-breaker.test.ts tests/unit/spend-ledger.test.ts
```

## 2. Verify Full Test Suite, Typecheck & Lint

```bash
pnpm typecheck && pnpm lint && pnpm test
```

## 3. Key Scenarios Verified

1. **Circuit Breaker 3-Strike Trip & <2s Fallback (`tests/unit/circuit-breaker.test.ts`)**:
   - Routes `agent-planner`, `agent-coder`, `agent-reviewer`, `agent-arbiter` through `LITELLM_URL`.
   - Trips after 3 consecutive HTTP `429` or `500` responses and switches to `fallbackAlias` in `< 2000ms`.
   - Emits `LLM_CIRCUIT_BREAKER_TRIPPED`, `LLM_PROVIDER_RATE_LIMITED`, `LLM_CONTEXT_WINDOW_EXCEEDED`, and `LLM_LOCAL_MODEL_OFFLINE` with exact ADR-042 wire metadata.
2. **ACID Spend Ledger, Local $0 Rule & CLI Subscription Auth Bridge (`tests/unit/spend-ledger.test.ts`)**:
   - Logs every call to `llm_calls` inside `withTenantContext`.
   - Forces `cost_usd = 0` for `ollama`, `vllm`, `llamacpp`, and Topology A `cli-subscription-{provider}`.
   - Emits `budget.warning` at 80% of `spend_limit_usd` and throws `TASK_SPEND_LIMIT_EXCEEDED` (+ `budget.exceeded`) at 100%.
   - Enforces `dailySpendCapUSD` (`LLM_DAILY_BUDGET_EXCEEDED`) for paid calls while allowing `$0` local/subscription calls.
   - Silently ignores `cliSubscriptionAuth` in Topologies B (`team`) and C (`enterprise`).
