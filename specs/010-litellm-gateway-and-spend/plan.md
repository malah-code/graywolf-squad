# Implementation Plan: LiteLLM Gateway, Circuit Breaker & Token Spend Governance

**Branch**: `010-litellm-gateway-and-spend` | **Date**: 2026-10-19 | **Spec**: [spec.md](./spec.md)  
**Input**: Feature specification from `/specs/010-litellm-gateway-and-spend/spec.md`

## Summary

Implement Phase 8 of the Graywolf Squad master plan (`docs/implementation-plan-detailed.md` Tasks 8.1–8.2):
1. **LiteLLM Gateway Client & Circuit Breaker (`litellm-client.ts`, `circuit-breaker.ts`)**: Route all model completions through `env.LITELLM_URL` using virtual aliases (`agent-planner`, `agent-coder`, `agent-reviewer`, `agent-arbiter`), track consecutive HTTP `429`/`5xx` errors per alias/provider, trip the circuit breaker on the 3rd consecutive failure, and switch to the configured `fallback` alias within `< 2,000ms` while mapping errors to canonical ADR-042 codes (`LLM_PROVIDER_RATE_LIMITED`, `LLM_CIRCUIT_BREAKER_TRIPPED`, `LLM_CONTEXT_WINDOW_EXCEEDED`, `LLM_LOCAL_MODEL_OFFLINE`).
2. **ACID Token & Cost Ledger, Budget Valves & CLI Subscription Auth Bridge (`spend-ledger.ts`, `cli-sub-bridge.ts`)**: Persist every LLM call inside `withTenantContext` to PostgreSQL `llm_calls`, force `cost_usd = 0` for local runtimes (`ollama`, `vllm`, `llamacpp`), enforce ADR-081 Pattern 4 CLI Subscription Auth in Topology A (`provider = 'cli-subscription-{provider}'`, `cost_usd = 0`, turn-count & wall-clock caps, silent no-op in Topologies B/C), and atomically increment `tasks.current_spend_usd` with 80% `budget.warning`, 100% `budget.exceeded` (`TASK_SPEND_LIMIT_EXCEEDED`), and daily spend cap enforcement (`LLM_DAILY_BUDGET_EXCEEDED`).

## Technical Context

**Language/Version**: TypeScript 5.x on Node.js 20+  
**Primary Dependencies**: `pg` (`withTenantContext` from `src/orchestrator/db/index.ts`), `@sinclair/typebox`, `zod` (`env.LITELLM_URL`), native `fetch` (injectable for tests)  
**Storage**: PostgreSQL 16 (`llm_calls` and `tasks` tables with `ENABLE/FORCE ROW LEVEL SECURITY`)  
**Testing**: Vitest (`tests/unit/circuit-breaker.test.ts`, `tests/unit/spend-ledger.test.ts`)  
**Target Platform**: Linux host / Docker `control-net` (`http://litellm-proxy:4000`)  
**Project Type**: Backend orchestrator gateway module (`src/orchestrator/gateway/*`)  
**Performance Goals**: `< 2,000ms` circuit-breaker fallback switch latency (SC-001); single-transaction ACID ledger write + task spend increment  
**Constraints**: Zero vendor SDK lock-in; strict ADR-042 structured error codes; zero cost (`$0.000000`) for local models and Topology A CLI subscriptions; tenant RLS isolation on all database queries  
**Scale/Scope**: 5 gateway source modules (`circuit-breaker.ts`, `litellm-client.ts`, `cli-sub-bridge.ts`, `spend-ledger.ts`, `telemetry.ts`) + 2 comprehensive unit test suites

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **Principle 1 (Human Sovereignty & Non-Committing Relay Contract)**: PASS — Gateway modules only route LLM calls and record spend metrics; no git mutations occur.
- **Principle 2 (Zero Runtime Lock-In & Permissive Licensing)**: PASS — Uses standard OpenAI-compatible HTTP via LiteLLM Proxy and native Node `fetch`; zero proprietary SDK dependencies added.
- **Principle 3 (Single ACID Relational & Vector Baseline)**: PASS — Uses existing PostgreSQL `llm_calls` and `tasks` tables with tenant RLS via `withTenantContext`.
- **Principle 4 (Headless Execution & Observability)**: PASS — Adheres to standard OTLP telemetry with OTel GenAI semantic conventions (`chat {model}`), duration histogram `llm_completion_duration_seconds`, typed circuit/budget metrics, cardinality protection via span events for `task_id`/`workspace_id`, and fail-closed payload redaction refusing startup in Topologies B/C if content capture is enabled.
- **Principle 6 (Virtual Developer Tier Handoff Protocol)**: PASS — Enforces routing exclusively via virtual aliases (`agent-planner`, `agent-coder`, `agent-reviewer`, `agent-arbiter`) mapped to LiteLLM rather than hardcoded provider models.
- **Principle 9 (Zero-Cost Open Source Foundation)**: PASS — Guarantees `$0.00` cost accounting for local open-weight runtimes (`ollama`, `vllm`, `llamacpp`) and Topology A personal CLI subscriptions, and allows `$0.00` local models to run even when paid `dailySpendCapUSD` is reached.

## Project Structure

### Documentation (this feature)

```text
specs/010-litellm-gateway-and-spend/
├── spec.md              # Feature specification (FR-001..FR-007, SC-001..SC-004)
├── plan.md              # This technical implementation plan
├── research.md          # Technical decisions for LiteLLM, circuit breaker, ledger & CLI bridge
├── data-model.md        # Relational schema touchpoints (llm_calls, tasks) & domain types
├── quickstart.md        # Verification commands and test scenarios
├── checklists/
│   ├── requirements.md          # Specification quality checklist (16/16 pass)
│   └── requirements-quality.md  # Reviewer-owned requirements quality audit
└── contracts/
    └── gateway-and-spend.md # TypeScript interfaces and behavioral invariants
```

### Source Code (repository root)

```text
src/orchestrator/gateway/
├── circuit-breaker.ts   # 3-failure circuit breaker state machine (CLOSED/OPEN/HALF_OPEN)
├── litellm-client.ts    # Virtual alias router, <2s fallback failover, ADR-042 error mapper
├── cli-sub-bridge.ts    # ADR-081 Pattern 4 Topology A CLI Subscription Auth Bridge
├── spend-ledger.ts      # ACID llm_calls writer, local $0 rule, 80%/100% task & daily valves
└── telemetry.ts         # OTel GenAI semconv spans, metrics, cardinality guard & fail-closed redaction

tests/unit/
├── circuit-breaker.test.ts # Unit tests for Task 8.1 (aliases, 3-strike trip, <2s fallback, error codes, OTel telemetry)
└── spend-ledger.test.ts    # Unit tests for Task 8.2 (llm_calls, local $0, 80%/100% valves, daily cap, CLI bridge, OTel events)
```

**Structure Decision**: Matches the exact file paths specified in `docs/implementation-plan-detailed.md` §2 Canonical Repository Target Layout and Phase 8 Tasks 8.1 & 8.2.

## Complexity Tracking

No Constitution violations or complexity exceptions required.
