# Feature Specification: LiteLLM Gateway, Circuit Breaker & Token Spend Governance

**Feature Branch**: `010-litellm-gateway-and-spend`

**Created**: 2026-10-19

**Status**: Draft

**Input**: User description: "Phase 8 LiteLLM Gateway, Circuit Breaker & Token Spend Governance: Route all model calls through LiteLLM Proxy using virtual aliases, trip circuit breakers to fallback providers on 3 consecutive 429/500s, log every call to llm_calls, and enforce task/daily spend caps + CLI Subscription Auth Bridge (PRD §6, ADR-081 Pattern 4)."

## Clarifications

### Session 2026-10-25
- Q: Which scope canonically owns the daily spend cap (`dailySpendCapUSD`) when evaluated by the gateway spend ledger? (CHK002, CHK060) → A: Workspace-first with Org ceiling. Daily spend is aggregated by `workspace_id` (`SUM(cost_usd) WHERE workspace_id = $1 AND created_at >= date_trunc('day', NOW() AT TIME ZONE 'UTC')`). If an `org_id` daily cap is also configured, whichever ceiling is reached first blocks paid calls with canonical error `LLM_DAILY_BUDGET_EXCEEDED`.
- Q: Which specific network errors and HTTP status codes are classified as transient failures that increment the circuit breaker's 3-strike failure counter? (CHK001) → A: Standard Transient Set. Transient failures that increment `consecutiveFailures` toward the 3-strike threshold comprise HTTP `429`, `500`, `502`, `503`, and `504`, along with network socket timeouts (`ETIMEDOUT`, `UND_ERR_CONNECT_TIMEOUT`, and default 30s request timeout), `ECONNRESET`, and transient DNS resolution errors (`EAI_AGAIN`). Non-transient errors (HTTP `400` context length, `401`, `403`, `422`, and local endpoint `ECONNREFUSED` mapped to `LLM_LOCAL_MODEL_OFFLINE`) throw immediately without incrementing the circuit breaker counter.
- Q: What is the authoritative configuration source for deployment topology detection, and how does the gateway enforce the silent ignore of cliSubscriptionAuth in Topologies B and C? (CHK012, CHK025) → A: Environment variable `DEPLOYMENT_TOPOLOGY` (`'solo' | 'team' | 'enterprise'`, defaulting to `'solo'` per Assumption 3). In `'team'` or `'enterprise'` modes, `CliSubscriptionBridge.resolvePolicy` returns `{ active: false, topology, providerTag: null, credentialKey: null, maxTurnsPerTask: 0, maxWallClockMs: 0 }`, completely preventing credential extraction or lane bypassing at the contract layer, routes all model calls through standard LiteLLM Proxy API keys, and emits one OTel event `topology.cli_subscription.ignored` with attributes `{ topology, task_id, project_id, source: 'DEPLOYMENT_TOPOLOGY' }` (closing CHK012, CHK025, CHK049, CHK055).
- Q: How are OpenTelemetry metrics, span attributes, and prompt PII redaction configured across the model gateway and spend ledger? (CHK009, CHK049, CHK055) → A: Standard OTLP Telemetry with OTel GenAI semantic conventions and fail-closed payload redaction: (1) Spans named `chat {model}` with attributes `gen_ai.system`, `gen_ai.operation.name="chat"`, `gen_ai.request.model`, `gen_ai.usage.{input,output,cache_read,cache_write}_tokens`, `gen_ai.response.finish_reasons`, and project metadata (`cost_usd`, `circuit_state`, `used_fallback`) under `graywolf.*` namespace. (2) Latency tracked via `llm_completion_duration_seconds` histogram (RPC bucket defaults: 0.005..10s). (3) High-cardinality `task_id` and `workspace_id` placed on span events (`span.addEvent("graywolf.completion", {...})`) rather than indexed attributes. (4) Redaction fail-closed defaults: `OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT=false`, `GRAYWOLF_OTEL_REDACT_PROMPTS=true`, `GRAYWOLF_OTEL_REDACT_COMPLETIONS=true`; gateway refuses startup in Topologies B/C if payload capture is enabled (closing CHK009, CHK049, CHK055).
- Q: How should the persona tier enum, SpendValveResult.valveStatus states, and local $0.00 normalization override be canonically aligned across spec.md, data-model.md, and contracts/gateway-and-spend.md? (CHK057, CHK058, CHK061) → A: Canonical Contract Alignment with 3 refinements: (1) Persona enum is strictly `'planner' | 'implementer' | 'reviewer' | 'arbiter'` across all documents; spec.md User Story 1 lists "Planner, Implementer (formerly referred to as 'Coder' in earlier drafts), Reviewer, Arbiter". (2) `SpendValveResult.valveStatus` is expanded to `'ok' | 'warning_80_percent' | 'task_limit_exceeded' | 'daily_limit_exceeded'`, cross-walking to ADR-042 error codes `TASK_SPEND_LIMIT_EXCEEDED` and `LLM_DAILY_BUDGET_EXCEEDED`. (3) `SpendLedger.normalizeCostUsd` is an idempotent pure function forcing `cost_usd = 0.000000` when `provider ∈ {'ollama', 'vllm', 'llamacpp'} OR cliPolicy.active === true OR provider.startsWith('cli-subscription-')`, and rejecting `provider.length > 64` pre-INSERT with `SpendingLedgerValidationError` (closing CHK057, CHK058, CHK059, CHK061, CHK028).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Virtual Model Routing & Automatic Circuit-Breaker Failover (Priority: P1)

As a platform operator running autonomous engineering tasks across multiple model tiers (Planner, Implementer _(formerly referred to as "Coder" in earlier drafts)_, Reviewer, Arbiter), I need all model requests to route through virtual role aliases with an automatic circuit breaker so that temporary upstream rate limits (HTTP 429) or provider outages (HTTP 5xx) transparently switch to the configured fallback model within 2 seconds without stalling or crashing active tasks.

**Why this priority**: Resilient model routing is the critical dependency for all cognitive tiers (Phase 9+). Without virtual alias resolution and circuit-breaker failover, any single provider rate-limit or outage halts task execution.

**Independent Test**: Can be fully tested by issuing model requests through the gateway client against simulated upstream responses (healthy 200 responses, 3 consecutive 429/500 failures, and total fallback failure) and verifying alias routing, circuit state transitions, fallback switch latency (<2s), and canonical error codes.

**Acceptance Scenarios**:

1. **Given** a project configured with virtual aliases (`agent-planner`, `agent-coder`, `agent-reviewer`, `agent-arbiter`) and corresponding fallback aliases, **When** a tier requests completion for its virtual alias and the primary provider is healthy, **Then** the gateway routes the request to the primary alias and returns the model response with token usage and latency metrics.
2. **Given** a primary provider experiences consecutive rate-limit (HTTP 429) or server errors (HTTP 500/502/503/504), **When** the 3rd consecutive failure occurs for that provider, **Then** the circuit breaker trips to the open state and automatically routes the request to the configured fallback alias within 2 seconds.
3. **Given** a circuit breaker is in the open state and the fallback provider also fails or no fallback is configured, **When** a model call is attempted, **Then** the system rejects the call with the canonical structured error `LLM_CIRCUIT_BREAKER_TRIPPED` (or `LLM_PROVIDER_RATE_LIMITED` / `LLM_LOCAL_MODEL_OFFLINE` as appropriate).
4. **Given** a circuit breaker has tripped open, **When** the configured cooldown window elapses and a probe request succeeds, **Then** the circuit breaker resets its consecutive failure counter and restores normal routing to the primary alias.

---

### User Story 2 - ACID Token Spend Ledger & Two-Tier Budget Valves (Priority: P1)

As a workspace owner or lead developer, I need every model call recorded in an immutable, tenant-isolated cost ledger (`llm_calls`) with real-time per-task (`spendLimitUSD`) and daily (`dailySpendCapUSD`) budget enforcement so that runaway agent loops never exceed financial guardrails and local open-weight models always log at `$0.00`.

**Why this priority**: Financial sovereignty and zero-cost local execution (Constitution Principle 9) require exact per-call accounting and deterministic 80% warning / 100% hard-stop valves before tasks can run autonomous multi-turn loops.

**Independent Test**: Can be tested by recording model calls with varying token counts and providers (commercial vs. local `ollama`/`vllm`/`llamacpp`) into the spend ledger and verifying database persistence, atomic task spend accumulation, 80% warning emission, 100% task ceiling hard stop (`TASK_SPEND_LIMIT_EXCEEDED`), and daily cap rejection (`LLM_DAILY_BUDGET_EXCEEDED`).

**Acceptance Scenarios**:

1. **Given** an active task in a tenant workspace, **When** any model call completes (or fails after consuming tokens), **Then** the ledger records a row in `llm_calls` inside the workspace's tenant context with `task_id`, `workspace_id`, `org_id`, `persona`, `model`, `provider`, `input_tokens`, `output_tokens`, `cache_read_tokens`, `cache_write_tokens`, `cost_usd`, `latency_ms`, and `status`, and atomically increments `tasks.current_spend_usd`.
2. **Given** a model call executed against a local model provider (`ollama`, `vllm`, or `llamacpp`), **When** the call is logged to the spend ledger, **Then** `cost_usd` is recorded as `$0.000000` regardless of token volume.
3. **Given** an active task with a `spendLimitUSD` of `$2.00`, **When** cumulative task spend crosses 80% (`$1.60`) but remains below 100%, **Then** the ledger triggers a `budget.warning` notification to the active container so the agent can wrap up gracefully.
4. **Given** an active task with a `spendLimitUSD` of `$2.00`, **When** cumulative task spend reaches or exceeds 100% (`$2.00`), **Then** the ledger triggers a `budget.exceeded` signal and halts further spend with canonical error code `TASK_SPEND_LIMIT_EXCEEDED`.
5. **Given** a workspace (and optionally organization) with a `dailySpendCapUSD` limit, **When** total spend for the current UTC day (`created_at >= date_trunc('day', NOW() AT TIME ZONE 'UTC')`) reaches or exceeds `dailySpendCapUSD` at either workspace scope (`workspace_id`) or organization scope (`org_id`), **Then** subsequent paid model calls are blocked before dispatch with canonical error code `LLM_DAILY_BUDGET_EXCEEDED` while `$0.00` local model calls remain permitted.

---

### User Story 3 - Topology A CLI Subscription Auth Bridge Governance (Priority: P2)

As a solo developer running Graywolf locally (Topology A) with personal flat-rate CLI subscriptions (such as Claude Code Pro/Max or Codex CLI Plus), I want to authenticate my in-container CLI lanes using my subscription while enforcing wall-clock and turn-count caps instead of USD token bills, and have those settings safely ignored in multi-user team/enterprise deployments (Topologies B and C).

**Why this priority**: Enables zero marginal API cost for solo developers using existing flat-rate CLI subscriptions (ADR-081 Pattern 4) while preventing credential sharing or ToS violations in multi-user topologies.

**Independent Test**: Can be tested by evaluating the CLI Subscription Auth Bridge under Topology A (`solo` / local mode) vs. Topology B/C (`team` / `enterprise` mode) and verifying provider tag formatting (`cli-subscription-{provider}`), `$0.00` cost recording, turn/wall-clock cap enforcement, and silent no-op behavior in Topologies B/C.

**Acceptance Scenarios**:

1. **Given** `cliSubscriptionAuth.enabled` is true in a Topology A (solo/local) deployment, **When** a task executes a turn via a subscribed CLI lane, **Then** the ledger records `cost_usd = 0` and `provider = 'cli-subscription-{provider}'`, and enforces configured turn-count and wall-clock duration limits rather than USD token limits.
2. **Given** `cliSubscriptionAuth.enabled` is true in a Topology A deployment and a task exceeds the configured maximum turn count or wall-clock duration for subscription runs, **Then** the bridge halts the task with `TASK_SPEND_LIMIT_EXCEEDED` and diagnostic details indicating the subscription turn or wall-clock cap was reached.
3. **Given** a project configuration containing `cliSubscriptionAuth` is loaded in a Topology B (Team Server) or Topology C (Enterprise) deployment, **When** the gateway initializes or resolves credentials, **Then** `cliSubscriptionAuth` is silently ignored without error and standard LiteLLM API proxy routing is enforced.

---

### Edge Cases

- **Simultaneous concurrent calls crossing budget threshold**: When multiple parallel model calls for the same task finish concurrently, atomic database increments (`UPDATE tasks SET current_spend_usd = current_spend_usd + $1 ... RETURNING current_spend_usd`) prevent lost updates and deterministically trigger `budget.warning` (once on crossing 80%) and `budget.exceeded` (on reaching 100%).
- **Local runtime unreachable (`ollama` / `vllm` / `llamacpp`)**: When a local model endpoint refuses connection or times out and no cloud fallback is permitted by residency policy, the gateway emits `LLM_LOCAL_MODEL_OFFLINE` (HTTP 503, `retryable: true`).
- **Context window overflow**: When the upstream proxy rejects a prompt for exceeding the model's maximum context window (HTTP 400 with context length error), the gateway maps it immediately to `LLM_CONTEXT_WINDOW_EXCEEDED` (HTTP 400, `retryable: false`) without tripping the provider availability circuit breaker.
- **Zero-spend local calls when daily USD cap is exhausted**: When `dailySpendCapUSD` is reached, paid cloud model calls are rejected with `LLM_DAILY_BUDGET_EXCEEDED`, but `$0.00` local model calls (`ollama`, `vllm`, `llamacpp`) and Topology A `cli-subscription-*` calls continue to be allowed unless their own turn/time limits are reached.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001 (Virtual Alias Routing)**: System MUST route all model requests through the model gateway using virtual role aliases (`agent-planner`, `agent-coder`, `agent-reviewer`, `agent-arbiter` or project-configured `modelRouting` aliases) rather than hardcoding provider-specific model identifiers in cognitive tiers.
- **FR-002 (3-Failure Circuit Breaker & <2s Fallback)**: System MUST track consecutive transient upstream failures (HTTP 429 rate limits, HTTP 500/502/503/504 server errors, socket timeouts [30s request limit], ECONNRESET, and transient DNS errors EAI_AGAIN) per provider/alias; upon 3 consecutive failures, the circuit breaker MUST trip open and route requests to the configured `fallback` alias within 2 seconds, emitting `LLM_PROVIDER_RATE_LIMITED` or `LLM_CIRCUIT_BREAKER_TRIPPED` if no healthy fallback is available. Non-transient errors (HTTP 400 context overflow, 401, 403, 422, and local model ECONNREFUSED) MUST NOT increment the failure counter.
- **FR-003 (Context Window & Local Offline Error Mapping)**: System MUST distinguish non-retryable context window overflows (`LLM_CONTEXT_WINDOW_EXCEEDED`, HTTP 400, does not increment circuit breaker failure count) and unreachable local model runtimes (`LLM_LOCAL_MODEL_OFFLINE`, HTTP 503) using canonical ADR-042 error envelopes.
- **FR-004 (ACID Spend Ledger & Local $0 Accounting)**: System MUST persist every model call in the `llm_calls` table within the caller's tenant context (`withTenantContext`), capturing `task_id`, `workspace_id`, `org_id`, `persona`, `model`, `provider`, `input_tokens`, `output_tokens`, `cache_read_tokens`, `cache_write_tokens`, `cost_usd`, `latency_ms`, and `status`, while forcing `cost_usd = 0` for local providers (`ollama`, `vllm`, `llamacpp`).
- **FR-005 (Task & Daily Budget Valves)**: System MUST atomically increment `tasks.current_spend_usd` on each call, emit an ARP `budget.warning` event when task spend reaches 80% of `spendLimitUSD`, emit `budget.exceeded` and throw `TASK_SPEND_LIMIT_EXCEEDED` at 100% of `spendLimitUSD`, and block paid calls when daily spend reaches `dailySpendCapUSD` evaluated primarily at `workspace_id` scope with optional `org_id` ceiling (`LLM_DAILY_BUDGET_EXCEEDED`).
- **FR-006 (Topology A CLI Subscription Auth Bridge)**: System MUST support ADR-081 Pattern 4 CLI Subscription Auth in Topology A (Solo/Local, detected via `DEPLOYMENT_TOPOLOGY` env var defaulting to `'solo'`), recording `cost_usd = 0` and `provider = 'cli-subscription-{provider}'` while enforcing wall-clock and turn-count caps. In Topologies B and C (`'team'` or `'enterprise'`), the gateway MUST silently ignore `cliSubscriptionAuth` settings by returning an inactive policy (`active: false`, `providerTag: null`, `credentialKey: null`, `maxTurnsPerTask: 0`, `maxWallClockMs: 0`), routing requests via standard LiteLLM API proxy credentials, and emitting an OTel `topology.cli_subscription.ignored` telemetry event.
- **FR-007 (OTel GenAI Telemetry & Fail-Closed Redaction)**: System MUST export OTLP telemetry following OTel GenAI semantic conventions (`chat {model}` spans with `gen_ai.system`, `gen_ai.operation.name="chat"`, `gen_ai.request.model`, `gen_ai.usage.*_tokens`, and `graywolf.*` attributes), export `llm_completion_duration_seconds` histogram and circuit/budget counters, protect collector cardinality by emitting high-cardinality `task_id`/`workspace_id` via span events, and enforce fail-closed payload redaction (`OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT=false`), refusing startup in Topologies B/C if payload capture is enabled.

### Key Entities

- **Model Gateway Request / Response**: Represents a structured completion or chat request routed via a virtual alias (`agent-planner`, `agent-coder`, `agent-reviewer`, `agent-arbiter`), including fallback alias metadata, token usage (`inputTokens`, `outputTokens`, `cacheReadTokens`, `cacheWriteTokens`), provider attribution, cost in USD, and latency in milliseconds.
- **Provider Circuit Breaker State**: Tracks health per provider/alias (`CLOSED`, `OPEN`, `HALF_OPEN`), consecutive 429/5xx failure count (trip threshold = 3), last failure timestamp, and cooldown recovery window.
- **LLM Call Ledger Entry (`llm_calls`)**: Tenant-isolated ACID record of a single model invocation linked to `task_id`, `workspace_id`, and `org_id`, storing token counts, prompt cache hit metrics, USD cost, latency, and call status (`success`, `rate_limited`, `error`).
- **Task & Daily Budget Valve Status**: Represents the evaluated budget state after or prior to a model call (`ok`, `warning_80_percent`, `task_limit_exceeded`, `daily_limit_exceeded`) along with cumulative spend and remaining budget.
- **CLI Subscription Bridge Policy**: Represents the resolved Topology A subscription execution policy (`active`, `providerTag`, `maxTurnsPerTask`, `maxWallClockMs`), which downgrades cleanly to `inactive` in Topologies B and C.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001 (Failover Latency & Threshold)**: 100% of simulated 3-consecutive HTTP 429/5xx provider failure sequences trip the circuit breaker and complete fallback routing in under 2,000 milliseconds.
- **SC-002 (Ledger & Zero-Cost Accuracy)**: 100% of model invocations record an accurate `llm_calls` audit row under tenant isolation, with local providers (`ollama`, `vllm`, `llamacpp`) and active Topology A CLI subscription runs always recording exactly `$0.000000` cost.
- **SC-003 (Budget Valve Precision)**: Tasks crossing 80% of `spendLimitUSD` emit `budget.warning` exactly once per threshold crossing, and tasks reaching 100% of `spendLimitUSD` or `dailySpendCapUSD` halt immediately (`TASK_SPEND_LIMIT_EXCEEDED` / `LLM_DAILY_BUDGET_EXCEEDED`) with zero unauthorized paid calls dispatched after the cap is hit.
- **SC-004 (Topology Isolation for CLI Subscriptions)**: 100% of Topology B/C runs silently ignore `cliSubscriptionAuth` configuration without error, while Topology A runs enforce configured turn and wall-clock caps and tag ledger entries as `cli-subscription-{provider}`.

## Assumptions

- The PostgreSQL `llm_calls` and `tasks` tables (including `tasks.current_spend_usd` and `tasks.spend_limit_usd`) and tenant RLS helper `withTenantContext` from Phase 1 (`specs/003-canonical-data-model`) are already present and migrated.
- The ARP Server (`src/orchestrator/arp/server.ts`) from Phase 7 exposes `c2e` message dispatch capability (`budget.warning` and `budget.exceeded`) or accepts a callback/notifier interface so the spend ledger can notify active task containers cleanly.
- Deployment topology is resolved via `process.env.DEPLOYMENT_TOPOLOGY` (`'solo'` for Topology A vs. `'team'` / `'enterprise'` for Topologies B/C), defaulting to `'solo'` when unset or running in single-user local mode.
