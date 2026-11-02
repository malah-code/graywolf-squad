# Module Contracts: LiteLLM Gateway, Circuit Breaker & Token Spend Governance

**Feature**: `010-litellm-gateway-and-spend`  
**Phase**: Phase 8

## 1. Circuit Breaker (`src/orchestrator/gateway/circuit-breaker.ts`)

```typescript
export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface CircuitBreakerOptions {
  failureThreshold?: number; // default: 3
  cooldownMs?: number;       // default: 30_000
  nowFn?: () => number;      // default: Date.now (injectable for deterministic tests)
}

export interface ProviderCircuitSnapshot {
  key: string;
  state: CircuitState;
  consecutiveFailures: number;
  lastFailureAt: number | null;
  openedAt: number | null;
  lastStatusCode?: number;
}

export class CircuitBreakerRegistry {
  constructor(options?: CircuitBreakerOptions);
  public canAttempt(key: string): boolean;
  public recordSuccess(key: string): ProviderCircuitSnapshot;
  public recordFailure(key: string, statusCode?: number): ProviderCircuitSnapshot;
  public getSnapshot(key: string): ProviderCircuitSnapshot;
  public reset(key?: string): void;
}
```

### Error Classification Invariants
- Transient upstream failures that increment `consecutiveFailures`:
  - HTTP status codes: `429`, `500`, `502`, `503`, `504`.
  - Network and socket errors: `ETIMEDOUT`, `UND_ERR_CONNECT_TIMEOUT`, request timeout (default `30_000ms`), `ECONNRESET`, and temporary DNS errors (`EAI_AGAIN`).
- Reaching `failureThreshold` (`3`) transitions `state` to `'OPEN'`.
- Non-transient errors (do NOT increment `consecutiveFailures`):
  - Context window overflow (`400` with context-length error message/code) throws `GraywolfAppError('LLM_CONTEXT_WINDOW_EXCEEDED')` immediately.
  - Client auth / validation errors (`401`, `403`, `422`) throw canonical error envelopes immediately.
  - Local model connection refused / unreachable (`ECONNREFUSED` on local provider endpoints `ollama`, `vllm`, `llamacpp`) throws `GraywolfAppError('LLM_LOCAL_MODEL_OFFLINE')` (HTTP 503) without tripping the remote provider circuit breaker.

---

## 2. LiteLLM Client (`src/orchestrator/gateway/litellm-client.ts`)

```typescript
export type VirtualModelAlias =
  | 'agent-planner'
  | 'agent-coder'
  | 'agent-reviewer'
  | 'agent-arbiter'
  | (string & {});

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  name?: string;
}

export interface LiteLLMCompletionRequest {
  alias: VirtualModelAlias;
  fallbackAlias?: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  taskId?: string;
  workspaceId?: string;
  orgId?: string;
  persona?: 'planner' | 'implementer' | 'reviewer' | 'arbiter';
  providerHint?: string;
  dailySpendCapUSD?: number;
}

export interface LiteLLMCompletionResponse {
  id: string;
  aliasUsed: string;
  usedFallback: boolean;
  model: string;
  provider: string;
  content: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsd: number;
  latencyMs: number;
}
```

### Failover Contract
1. Check `circuitBreaker.canAttempt(alias)`.
2. If `CLOSED` or `HALF_OPEN`, invoke primary `alias` via `${baseUrl}/v1/chat/completions`.
3. On transient failure (`429` or `5xx`), call `circuitBreaker.recordFailure(alias, status)`.
4. If the failure trips the circuit (`state === 'OPEN'`) or the circuit was already `'OPEN'`, immediately switch to `fallbackAlias` (if provided) within `< 2,000ms`.
5. If no `fallbackAlias` is configured or the `fallbackAlias` also fails:
   - Throw `GraywolfAppError('LLM_CIRCUIT_BREAKER_TRIPPED')` when the circuit breaker is open (`consecutiveFailures >= 3`).
   - Throw `GraywolfAppError('LLM_PROVIDER_RATE_LIMITED')` when a single `429` occurred with no fallback and circuit has not yet reached 3 failures.

---

## 3. CLI Subscription Auth Bridge (`src/orchestrator/gateway/cli-sub-bridge.ts`)

```typescript
export type DeploymentTopology = 'solo' | 'team' | 'enterprise';

export interface CliSubscriptionPolicy {
  active: boolean;
  topology: DeploymentTopology;
  providerTag: string | null;
  credentialKey: string | null;
  maxTurnsPerTask: number;
  maxWallClockMs: number;
}

export class CliSubscriptionBridge {
  /**
   * Resolves subscription policy.
   * When topology !== 'solo' ('team' | 'enterprise'):
   * - Forces active: false, providerTag: null, credentialKey: null, maxTurnsPerTask: 0, maxWallClockMs: 0
   * - Emits OTel event 'topology.cli_subscription.ignored' with { topology, task_id, project_id, source: 'DEPLOYMENT_TOPOLOGY' }
   * - Completely blocks credential extraction or container CLI lane bypass at the contract layer.
   */
  public resolvePolicy(options: {
    topology: DeploymentTopology;
    cliSubscriptionAuth?: ProjectConfig['cliSubscriptionAuth'];
    lane?: string;
    provider?: string;
    taskId?: string;
    projectId?: string;
  }): CliSubscriptionPolicy;

  public recordAndEnforceTurn(options: {
    taskId: string;
    policy: CliSubscriptionPolicy;
    elapsedWallClockMs?: number;
  }): { turnCount: number; elapsedWallClockMs: number };

  public resetTaskUsage(taskId?: string): void;
}
```

---

## 4. ACID Spend Ledger (`src/orchestrator/gateway/spend-ledger.ts`)

```typescript
export interface BudgetSignalNotifier {
  onBudgetWarning?: (payload: {
    taskId: string;
    workspaceId: string;
    currentSpendUSD: number;
    spendLimitUSD: number;
    percentUsed: number;
    message: string;
  }) => Promise<void> | void;
  onBudgetExceeded?: (payload: {
    taskId: string;
    workspaceId: string;
    currentSpendUSD: number;
    spendLimitUSD: number;
    action: 'halt_and_escalate';
  }) => Promise<void> | void;
}

export class SpendLedger {
  constructor(options?: {
    notifier?: BudgetSignalNotifier;
    cliBridge?: CliSubscriptionBridge;
  });

  public normalizeCostUsd(options: {
    provider: string;
    rawCostUsd: number;
    cliPolicy?: CliSubscriptionPolicy;
  }): { provider: string; costUsd: number };

  public assertDailyBudgetAvailable(options: {
    workspaceId: string;
    orgId?: string;
    dailySpendCapUSD?: number;
    orgDailySpendCapUSD?: number;
    provider: string;
    cliPolicy?: CliSubscriptionPolicy;
  }): Promise<{ currentDailySpendUsd: number; currentOrgDailySpendUsd?: number }>;

  public recordCall(input: LlmCallRecordInput & {
    cliPolicy?: CliSubscriptionPolicy;
    dailySpendCapUSD?: number;
  }): Promise<SpendValveResult>;
}
```

### ADR-042 Error Envelope Cross-Walk

| `SpendValveResult.valveStatus` | Action & ADR-042 Error Mapping |
|---|---|
| `'ok'` | No error; model call proceeds normally. |
| `'warning_80_percent'` | No error; model call proceeds; emits ARP `c2e` `budget.warning` event per FR-005. |
| `'task_limit_exceeded'` | Halts execution; throws `GraywolfAppError('TASK_SPEND_LIMIT_EXCEEDED')` (HTTP 402/429). |
| `'daily_limit_exceeded'` | Blocks call prior to dispatch; throws `GraywolfAppError('LLM_DAILY_BUDGET_EXCEEDED')` (HTTP 402/429). |

### Cost Normalization & Validation Invariants
- `SpendLedger.normalizeCostUsd` is an idempotent pure function:
  ```typescript
  if (
    ['ollama', 'vllm', 'llamacpp'].includes(provider) ||
    cliPolicy?.active === true ||
    provider.startsWith('cli-subscription-')
  ) {
    costUsd = 0.000000;
  }
  ```
- Tag length validation: If `provider.length > 64`, `normalizeCostUsd` rejects the call pre-INSERT with `SpendingLedgerValidationError('Provider tag exceeds VARCHAR(64) boundary')`.

---

## 5. OTel GenAI Telemetry & Observability (`src/orchestrator/gateway/telemetry.ts`)

```typescript
export interface GenAiSpanAttributes {
  'gen_ai.system': string; // provider (e.g. 'openai', 'anthropic', 'ollama')
  'gen_ai.operation.name': 'chat';
  'gen_ai.request.model': string;
  'gen_ai.usage.input_tokens': number;
  'gen_ai.usage.output_tokens': number;
  'gen_ai.usage.cache_read.input_tokens'?: number;
  'gen_ai.usage.cache_write.input_tokens'?: number;
  'gen_ai.response.finish_reasons'?: string[];
  'graywolf.cost_usd': number;
  'graywolf.circuit_state': CircuitState;
  'graywolf.used_fallback': boolean;
}

export interface GraywolfCompletionEventPayload {
  taskId: string;
  workspaceId: string;
  orgId: string;
  persona: 'planner' | 'implementer' | 'reviewer' | 'arbiter';
}
```

### OTel Metrics & Invariants
- **Histogram**: `llm_completion_duration_seconds` (RPC buckets: `0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10`, labels: `alias, provider, model`).
- **Gauges & Counters** (low-cardinality labels only):
  - `llm_circuit_breaker_state` (gauge: `0 = CLOSED, 1 = HALF_OPEN, 2 = OPEN`, labels: `alias, provider`).
  - `llm_circuit_breaker_transitions_total` (counter, labels: `alias, provider, from_state, to_state`).
  - `llm_spend_usd_total` (counter, labels: `topology, persona, provider, model`).
  - `llm_budget_signals_total` (counter, labels: `topology, signal: 'warning_80_percent' | 'task_limit_exceeded' | 'daily_limit_exceeded'`).
- **High-Cardinality Guard**: `taskId` and `workspaceId` are emitted exclusively as span events via `span.addEvent('graywolf.completion', { ... })` (and persisted in PostgreSQL `llm_calls`), never as indexed span attributes or metric labels, to protect OTel collector index cardinality.
- **Fail-Closed Privacy Rules**:
  - `OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT=false` (default).
  - `GRAYWOLF_OTEL_REDACT_PROMPTS=true` (default).
  - `GRAYWOLF_OTEL_REDACT_COMPLETIONS=true` (default).
  - Startup check: In Topologies B (`team`) and C (`enterprise`), gateway throws and halts startup if `OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT === 'true'` (Constitution Principle 5 hard enforcement).
