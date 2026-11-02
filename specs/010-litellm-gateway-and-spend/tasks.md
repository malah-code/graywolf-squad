# Tasks: LiteLLM Gateway, Circuit Breaker & Token Spend Governance

**Input**: Design documents from `/specs/010-litellm-gateway-and-spend/`  
**Prerequisites**: `plan.md` (required), `spec.md` (required), `research.md`, `data-model.md`, `contracts/gateway-and-spend.md`

**Tests**: Included as required by `docs/implementation-plan-detailed.md` Phase 8 (`tests/unit/circuit-breaker.test.ts` and `tests/unit/spend-ledger.test.ts`).

**Organization**: Tasks are grouped by user story and mapped directly to Phase 8 Tasks 8.1 and 8.2 in the master plan.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (`[US1]`, `[US2]`, `[US3]`)
- Include exact file paths in descriptions

---

## Phase 1: Setup & Gateway Contracts

**Purpose**: Establish shared gateway types, OTel GenAI telemetry & fail-closed redaction guard (`FR-007`), and circuit-breaker state machine under `src/orchestrator/gateway/`.

- [x] T001 Create `src/orchestrator/gateway/circuit-breaker.ts` with `CircuitState` (`CLOSED` | `OPEN` | `HALF_OPEN`), `CircuitBreakerOptions`, `ProviderCircuitSnapshot`, and `CircuitBreakerRegistry` class tracking consecutive transient failures (HTTP `429`/`500`/`502`/`503`/`504`, `ETIMEDOUT`, `UND_ERR_CONNECT_TIMEOUT`, 30s timeout, `ECONNRESET`, `EAI_AGAIN`; default threshold `3`, cooldown `30000ms`, injectable `nowFn`) and `src/orchestrator/gateway/telemetry.ts` implementing `FR-007` OTel GenAI semantic conventions (`chat {model}` spans, `llm_completion_duration_seconds` histogram, low-cardinality circuit/spend counters, `graywolf.completion` span event for `taskId`/`workspaceId`, and fail-closed `OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT=false` startup guard in Topologies B/C)

---

## Phase 2: User Story 1 - Virtual Model Routing & Automatic Circuit-Breaker Failover (Priority: P1) 🎯 MVP

**Goal**: Route `agent-planner`, `agent-coder`, `agent-reviewer`, and `agent-arbiter` via `env.LITELLM_URL`, trip the circuit breaker on 3 consecutive transient HTTP 429/5xx or socket timeout errors, switch to the fallback alias within `< 2,000ms`, emit OTel GenAI spans/metrics (`FR-007`), and map errors to canonical ADR-042 codes.

**Independent Test**: Run `pnpm vitest run tests/unit/circuit-breaker.test.ts` to verify virtual alias routing, 3-strike circuit breaker trip on the standard transient set, `< 2s` fallback failover, half-open recovery, `LLM_*` error taxonomy mapping, and OTel GenAI telemetry + fail-closed redaction guard.

### Implementation & Tests for User Story 1 (Master Plan Task 8.1)

- [x] T002 [US1] Implement `LiteLLMClient` in `src/orchestrator/gateway/litellm-client.ts` supporting virtual aliases (`agent-planner`, `agent-coder`, `agent-reviewer`, `agent-arbiter`), 30s request timeout & consecutive transient failure tracking via `CircuitBreakerRegistry`, immediate `< 2s` failover to `fallbackAlias` on circuit trip or open state, OTel `chat {model}` span & metric recording (`FR-007`), and canonical ADR-042 error mapping (`LLM_PROVIDER_RATE_LIMITED`, `LLM_CIRCUIT_BREAKER_TRIPPED`, `LLM_CONTEXT_WINDOW_EXCEEDED`, `LLM_LOCAL_MODEL_OFFLINE`)
- [x] T003 [US1] Create unit test suite in `tests/unit/circuit-breaker.test.ts` verifying `CircuitBreakerRegistry` state transitions (`CLOSED` -> `OPEN` at 3 failures -> `HALF_OPEN` after cooldown -> `CLOSED` on probe success), `< 2,000ms` fallback routing on 3 consecutive 429/500/timeout responses, non-tripping `LLM_CONTEXT_WINDOW_EXCEEDED` (400) and `LLM_LOCAL_MODEL_OFFLINE` (503 / `ECONNREFUSED`), and `FR-007` OTel GenAI telemetry + fail-closed startup rejection in Topologies B/C

**Checkpoint**: User Story 1 (Task 8.1) is complete and independently verified via `tests/unit/circuit-breaker.test.ts`.

---

## Phase 3: User Story 3 - Topology A CLI Subscription Auth Bridge Governance (Priority: P2)

**Goal**: Implement ADR-081 Pattern 4 CLI Subscription Auth Bridge (resolved via `process.env.DEPLOYMENT_TOPOLOGY` defaulting to `'solo'`) so Topology A (`solo`) runs record `cost_usd = 0` and `provider = 'cli-subscription-{provider}'` with wall-clock and turn-count caps, while Topologies B (`team`) and C (`enterprise`) silently return a zeroed inactive policy and emit OTel event `topology.cli_subscription.ignored`.

**Independent Test**: Verified as part of `tests/unit/spend-ledger.test.ts` covering Topology A activation, turn/wall-clock limit enforcement (`TASK_SPEND_LIMIT_EXCEEDED`), and Topology B/C contract-layer no-op + `topology.cli_subscription.ignored` event.

### Implementation for User Story 3 (Master Plan Task 8.2 Part A)

- [x] T004 [P] [US3] Implement `CliSubscriptionBridge` in `src/orchestrator/gateway/cli-sub-bridge.ts` resolving `CliSubscriptionPolicy` via `process.env.DEPLOYMENT_TOPOLOGY` (default `'solo'`), formatting `provider = 'cli-subscription-{provider}'`, forcing `costUsd = 0`, enforcing `maxTurnsPerTask` and `maxWallClockMs` caps (`TASK_SPEND_LIMIT_EXCEEDED`), and returning `{ active: false, providerTag: null, credentialKey: null, maxTurnsPerTask: 0, maxWallClockMs: 0 }` with OTel event `topology.cli_subscription.ignored` in Topologies B/C

---

## Phase 4: User Story 2 - ACID Token Spend Ledger & Two-Tier Budget Valves (Priority: P1)

**Goal**: Record every LLM call in `llm_calls` inside `withTenantContext`, idempotently force `cost_usd = 0.000000` for local providers (`ollama`, `vllm`, `llamacpp`) and active Topology A CLI subscriptions (rejecting `provider.length > 64` pre-INSERT), atomically increment `tasks.current_spend_usd`, emit `budget.warning` at 80% and `budget.exceeded` (`TASK_SPEND_LIMIT_EXCEEDED`) at 100% using the 4-state `valveStatus` enum, and enforce workspace-first + optional org ceiling UTC `dailySpendCapUSD` (`LLM_DAILY_BUDGET_EXCEEDED`).

**Independent Test**: Run `pnpm vitest run tests/unit/spend-ledger.test.ts` to verify ACID `llm_calls` insertion, local `$0.000000` override, `VARCHAR(64)` provider tag validation, Topology A CLI subscription bridge integration, 80% warning callback, 100% hard stop (`TASK_SPEND_LIMIT_EXCEEDED`), and workspace/org UTC daily cap enforcement (`LLM_DAILY_BUDGET_EXCEEDED`).

### Implementation & Tests for User Story 2 & 3 (Master Plan Task 8.2 Part B)

- [x] T005 [US2] Implement `SpendLedger` in `src/orchestrator/gateway/spend-ledger.ts` recording calls to `llm_calls` via `withTenantContext`, idempotently enforcing `cost_usd = 0.000000` for local (`ollama`, `vllm`, `llamacpp`) and `cli-subscription-*` providers, validating `provider.length <= 64`, checking workspace-first + optional org UTC `dailySpendCapUSD` (`LLM_DAILY_BUDGET_EXCEEDED`), atomically incrementing `tasks.current_spend_usd`, and returning 4-state `valveStatus` (`'ok' | 'warning_80_percent' | 'task_limit_exceeded' | 'daily_limit_exceeded'`) while triggering 80% `budget.warning` and 100% `budget.exceeded` (`TASK_SPEND_LIMIT_EXCEEDED`)
- [x] T006 [US2] Wire optional `SpendLedger` integration into `LiteLLMClient` in `src/orchestrator/gateway/litellm-client.ts` so model completions automatically check pre-flight daily budget and record completed/rate-limited calls when tenant/task context is supplied
- [x] T007 [US2] [US3] Create unit test suite in `tests/unit/spend-ledger.test.ts` testing `llm_calls` persistence with `withTenantContext`, `$0.000000` local provider accounting (`ollama`, `vllm`, `llamacpp`), `VARCHAR(64)` provider length guard, Topology A vs B/C `CliSubscriptionBridge` behavior, 80% `budget.warning` emission, 100% `TASK_SPEND_LIMIT_EXCEEDED` halt, and workspace/org UTC `LLM_DAILY_BUDGET_EXCEEDED` daily cap valve

**Checkpoint**: User Stories 1, 2, and 3 (Tasks 8.1 and 8.2) are complete and independently verified.

---

## Phase 5: Polish & Cross-Cutting Concerns

**Purpose**: Full repository typecheck, lint, and regression suite verification.

- [x] T008 Run `pnpm typecheck`, `pnpm lint`, and `pnpm test` across all suites and mark Tasks 8.1 and 8.2 `[x]` in `docs/implementation-plan-detailed.md`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (`T001`)**: No dependencies — starts immediately.
- **Phase 2 (`T002`–`T003`)**: Depends on `T001` (`circuit-breaker.ts`).
- **Phase 3 (`T004`)**: Independent (`cli-sub-bridge.ts`) — can run in parallel with Phase 2.
- **Phase 4 (`T005`–`T007`)**: Depends on `T004` (`cli-sub-bridge.ts`) and `T002` (`litellm-client.ts`).
- **Phase 5 (`T008`)**: Depends on `T001`–`T007`.

### Parallel Opportunities

- `T001` (`circuit-breaker.ts`) and `T004` (`cli-sub-bridge.ts`) touch completely separate files and can be developed in parallel.
- Once `T002` and `T005` are implemented, `T003` (`circuit-breaker.test.ts`) and `T007` (`spend-ledger.test.ts`) can run in parallel.
