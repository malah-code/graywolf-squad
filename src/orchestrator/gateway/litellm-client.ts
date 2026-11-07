import pino from 'pino';
import { env } from '../config/env';
import { GraywolfAppError } from '../errors/taxonomy';
import { CircuitBreakerRegistry, isTransientError } from './circuit-breaker';
import { GatewayTelemetry } from './telemetry';

const logger = pino({ name: 'gateway:litellm-client' });

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
  orgDailySpendCapUSD?: number;
}

export interface LiteLLMCompletionResponse {
  id: string;
  aliasUsed: string;
  usedFallback: boolean;
  model: string;
  provider: string;
  content: string;
  reasoningContent?: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsd: number;
  latencyMs: number;
}

export interface SpendLedgerHook {
  assertDailyBudgetAvailable?(options: {
    workspaceId: string;
    orgId?: string;
    dailySpendCapUSD?: number;
    orgDailySpendCapUSD?: number;
    provider: string;
  }): Promise<{ currentDailySpendUsd: number; currentOrgDailySpendUsd?: number }>;
  recordCall?(input: {
    taskId: string;
    workspaceId: string;
    orgId: string;
    persona: 'planner' | 'implementer' | 'reviewer' | 'arbiter';
    model: string;
    provider: string;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
    costUsd: number;
    latencyMs: number;
    status?: 'success' | 'rate_limited' | 'error';
    dailySpendCapUSD?: number;
    orgDailySpendCapUSD?: number;
  }): Promise<unknown>;
}

export interface LiteLLMClientOptions {
  baseUrl?: string;
  apiKey?: string;
  fetchFn?: typeof fetch;
  circuitBreaker?: CircuitBreakerRegistry;
  telemetry?: GatewayTelemetry;
  spendLedger?: SpendLedgerHook;
  requestTimeoutMs?: number;
}

export class LiteLLMClient {
  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly fetchFn: typeof fetch;
  private readonly circuitBreaker: CircuitBreakerRegistry;
  private readonly telemetry: GatewayTelemetry;
  private readonly spendLedger?: SpendLedgerHook;
  private readonly requestTimeoutMs: number;

  constructor(options?: LiteLLMClientOptions) {
    this.baseUrl = (options?.baseUrl ?? env.LITELLM_URL).replace(/\/+$/, '');
    this.apiKey = options?.apiKey ?? process.env.LITELLM_MASTER_KEY;
    this.fetchFn = options?.fetchFn ?? globalThis.fetch;
    this.telemetry = options?.telemetry ?? new GatewayTelemetry();
    this.circuitBreaker =
      options?.circuitBreaker ??
      new CircuitBreakerRegistry({
        onTransition: (evt) => this.telemetry.recordCircuitTransition(evt),
      });
    this.spendLedger = options?.spendLedger;
    this.requestTimeoutMs =
      options?.requestTimeoutMs ??
      (process.env.LITELLM_REQUEST_TIMEOUT_MS
        ? parseInt(process.env.LITELLM_REQUEST_TIMEOUT_MS, 10)
        : 120_000);
  }

  public getCircuitBreaker(): CircuitBreakerRegistry {
    return this.circuitBreaker;
  }

  public async complete(request: LiteLLMCompletionRequest): Promise<LiteLLMCompletionResponse> {
    const primaryAlias = request.alias;
    const fallbackAlias = request.fallbackAlias;

    // Check pre-flight daily budget if context and ledger provided
    if (this.spendLedger && request.workspaceId) {
      await this.spendLedger.assertDailyBudgetAvailable?.({
        workspaceId: request.workspaceId,
        orgId: request.orgId,
        dailySpendCapUSD: request.dailySpendCapUSD,
        orgDailySpendCapUSD: request.orgDailySpendCapUSD,
        provider: request.providerHint ?? primaryAlias,
      });
    }

    // 1. Check primary alias circuit breaker
    if (this.circuitBreaker.canAttempt(primaryAlias)) {
      try {
        const response = await this.executeCompletion({
          targetAlias: primaryAlias,
          request,
          isFallback: false,
        });
        this.circuitBreaker.recordSuccess(primaryAlias);
        await this.recordLedgerSuccess(request, response);
        return response;
      } catch (err) {
        // Record failure and decide whether to fall back
        const status = (err as { httpStatus?: number; status?: number })?.httpStatus ?? (err as { status?: number })?.status;
        const isTransient = isTransientError(status ?? err);

        if (isTransient) {
          const snapshot = this.circuitBreaker.recordFailure(primaryAlias, status);

          // If fallback is configured, try fallback immediately (< 2,000ms requirement)
          if (fallbackAlias) {
            logger.warn(
              { primaryAlias, fallbackAlias, consecutiveFailures: snapshot.consecutiveFailures },
              'Primary alias failed, failing over to fallback alias'
            );
            return await this.executeFallback(request, fallbackAlias);
          }

          if (snapshot.state === 'OPEN') {
            throw new GraywolfAppError(
              'LLM_CIRCUIT_BREAKER_TRIPPED',
              `Circuit breaker open for alias '${primaryAlias}' after ${snapshot.consecutiveFailures} consecutive failures`,
              { alias: primaryAlias, consecutiveFailures: snapshot.consecutiveFailures }
            );
          }

          if (status === 429) {
            throw new GraywolfAppError(
              'LLM_PROVIDER_RATE_LIMITED',
              `Provider rate limit encountered for alias '${primaryAlias}'`,
              { alias: primaryAlias }
            );
          }
        }

        throw err;
      }
    }

    // Primary circuit is OPEN: immediate failover to fallback if provided
    if (fallbackAlias) {
      logger.info(
        { primaryAlias, fallbackAlias },
        'Primary circuit is OPEN; routing immediately to fallback alias'
      );
      return await this.executeFallback(request, fallbackAlias);
    }

    const snapshot = this.circuitBreaker.getSnapshot(primaryAlias);
    throw new GraywolfAppError(
      'LLM_CIRCUIT_BREAKER_TRIPPED',
      `Circuit breaker open for alias '${primaryAlias}' (no fallback configured)`,
      { alias: primaryAlias, consecutiveFailures: snapshot.consecutiveFailures }
    );
  }

  private async executeFallback(
    request: LiteLLMCompletionRequest,
    fallbackAlias: string
  ): Promise<LiteLLMCompletionResponse> {
    if (!this.circuitBreaker.canAttempt(fallbackAlias)) {
      const fbSnapshot = this.circuitBreaker.getSnapshot(fallbackAlias);
      throw new GraywolfAppError(
        'LLM_CIRCUIT_BREAKER_TRIPPED',
        `Circuit breaker is also OPEN for fallback alias '${fallbackAlias}'`,
        { alias: fallbackAlias, consecutiveFailures: fbSnapshot.consecutiveFailures }
      );
    }

    try {
      const response = await this.executeCompletion({
        targetAlias: fallbackAlias,
        request,
        isFallback: true,
      });
      this.circuitBreaker.recordSuccess(fallbackAlias);
      await this.recordLedgerSuccess(request, response);
      return response;
    } catch (err) {
      const status = (err as { httpStatus?: number; status?: number })?.httpStatus ?? (err as { status?: number })?.status;
      if (isTransientError(status ?? err)) {
        this.circuitBreaker.recordFailure(fallbackAlias, status);
      }
      throw new GraywolfAppError(
        'LLM_CIRCUIT_BREAKER_TRIPPED',
        `Both primary and fallback aliases failed: ${err instanceof Error ? err.message : String(err)}`,
        { primaryAlias: request.alias, fallbackAlias }
      );
    }
  }

  private async executeCompletion(options: {
    targetAlias: string;
    request: LiteLLMCompletionRequest;
    isFallback: boolean;
  }): Promise<LiteLLMCompletionResponse> {
    const { targetAlias, request, isFallback } = options;
    const startTime = Date.now();
    const endpoint = `${this.baseUrl}/v1/chat/completions`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.requestTimeoutMs);

    try {
      const res = await this.fetchFn(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
          ...(request.providerHint ? { 'x-provider-hint': request.providerHint } : {}),
        },
        body: JSON.stringify({
          model: targetAlias,
          messages: request.messages,
          temperature: request.temperature ?? 0.7,
          max_tokens: request.maxTokens,
        }),
        signal: controller.signal,
      });

      const latencyMs = Date.now() - startTime;

      if (!res.ok) {
        const errorText = await res.text();
        const status = res.status;

        // Context length overflow
        if (
          status === 400 &&
          (errorText.toLowerCase().includes('context_length') ||
            errorText.toLowerCase().includes('maximum context') ||
            errorText.toLowerCase().includes('context window'))
        ) {
          throw new GraywolfAppError(
            'LLM_CONTEXT_WINDOW_EXCEEDED',
            `Context window overflow for model alias '${targetAlias}': ${errorText}`,
            { alias: targetAlias, httpStatus: 400 }
          );
        }

        // Local model offline
        const isLocalProvider = ['ollama', 'vllm', 'llamacpp'].some(
          (p) => targetAlias.includes(p) || (request.providerHint && request.providerHint.includes(p))
        );
        if (isLocalProvider && (status === 503 || status === 502)) {
          throw new GraywolfAppError(
            'LLM_LOCAL_MODEL_OFFLINE',
            `Configured local LLM model '${targetAlias}' is offline`,
            { alias: targetAlias, httpStatus: status }
          );
        }

        // Transient errors
        if (status === 429) {
          await this.recordLedgerFailure(request, targetAlias, latencyMs, 'rate_limited');
          const appErr = new GraywolfAppError(
            'LLM_PROVIDER_RATE_LIMITED',
            `Upstream rate limit (429) for alias '${targetAlias}'`,
            { alias: targetAlias, details: errorText }
          );
          (appErr as unknown as { status: number }).status = 429;
          throw appErr;
        }

        await this.recordLedgerFailure(request, targetAlias, latencyMs, 'error');
        const appErr = new Error(`LiteLLM request failed with HTTP ${status}: ${errorText}`);
        (appErr as unknown as { status: number }).status = status;
        throw appErr;
      }

      const data = (await res.json()) as {
        id?: string;
        model?: string;
        choices?: Array<{ message?: { content?: string } }>;
        usage?: {
          prompt_tokens?: number;
          completion_tokens?: number;
          cache_read_tokens?: number;
          cache_creation_tokens?: number;
          total_tokens?: number;
          cost?: number;
        };
        provider?: string;
      };

      const resolvedModel = data.model ?? targetAlias;
      const resolvedProvider = data.provider ?? request.providerHint ?? targetAlias.split('/')[0] ?? 'litellm';
      const inputTokens = data.usage?.prompt_tokens ?? 0;
      const outputTokens = data.usage?.completion_tokens ?? 0;
      const cacheReadTokens = data.usage?.cache_read_tokens ?? 0;
      const cacheWriteTokens = data.usage?.cache_creation_tokens ?? 0;
      const costUsd = data.usage?.cost ?? 0;
      const choiceMsg = data.choices?.[0]?.message as
        | { content?: string; reasoning_content?: string; reasoning?: string }
        | undefined;
      const reasoning = choiceMsg?.reasoning_content || choiceMsg?.reasoning;
      const content = choiceMsg?.content || (reasoning ? '' : '');

      const response: LiteLLMCompletionResponse = {
        id: data.id ?? `call-${Date.now()}`,
        aliasUsed: targetAlias,
        usedFallback: isFallback,
        model: resolvedModel,
        provider: resolvedProvider,
        content: content || reasoning || '',
        reasoningContent: reasoning,
        inputTokens,
        outputTokens,
        cacheReadTokens,
        cacheWriteTokens,
        costUsd,
        latencyMs,
      };

      // Record OTel GenAI telemetry
      const snapshot = this.circuitBreaker.getSnapshot(targetAlias);
      this.telemetry.recordCompletionSpan({
        model: resolvedModel,
        provider: resolvedProvider,
        inputTokens,
        outputTokens,
        cacheReadTokens,
        cacheWriteTokens,
        costUsd,
        latencyMs,
        circuitState: snapshot.state,
        usedFallback: isFallback,
        eventPayload: {
          taskId: request.taskId,
          workspaceId: request.workspaceId,
          orgId: request.orgId,
          persona: request.persona,
        },
      });

      return response;
    } catch (err) {
      // Local model connection refused
      const isLocalProvider = ['ollama', 'vllm', 'llamacpp'].some(
        (p) => targetAlias.includes(p) || (request.providerHint && request.providerHint.includes(p))
      );
      const code = (err as { code?: string })?.code;
      if (isLocalProvider && code === 'ECONNREFUSED') {
        throw new GraywolfAppError(
          'LLM_LOCAL_MODEL_OFFLINE',
          `Local LLM provider for alias '${targetAlias}' refused connection (offline)`,
          { alias: targetAlias, code }
        );
      }
      throw err;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private async recordLedgerSuccess(
    request: LiteLLMCompletionRequest,
    response: LiteLLMCompletionResponse
  ): Promise<void> {
    if (this.spendLedger && request.taskId && request.workspaceId && request.orgId) {
      await this.spendLedger.recordCall?.({
        taskId: request.taskId,
        workspaceId: request.workspaceId,
        orgId: request.orgId,
        persona: request.persona ?? 'implementer',
        model: response.model,
        provider: response.provider,
        inputTokens: response.inputTokens,
        outputTokens: response.outputTokens,
        cacheReadTokens: response.cacheReadTokens,
        cacheWriteTokens: response.cacheWriteTokens,
        costUsd: response.costUsd,
        latencyMs: response.latencyMs,
        status: 'success',
        dailySpendCapUSD: request.dailySpendCapUSD,
        orgDailySpendCapUSD: request.orgDailySpendCapUSD,
      });
    }
  }

  private async recordLedgerFailure(
    request: LiteLLMCompletionRequest,
    targetAlias: string,
    latencyMs: number,
    status: 'rate_limited' | 'error'
  ): Promise<void> {
    if (this.spendLedger && request.taskId && request.workspaceId && request.orgId) {
      const resolvedProvider = request.providerHint ?? targetAlias.split('/')[0] ?? 'litellm';
      await this.spendLedger.recordCall?.({
        taskId: request.taskId,
        workspaceId: request.workspaceId,
        orgId: request.orgId,
        persona: request.persona ?? 'implementer',
        model: targetAlias,
        provider: resolvedProvider,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        costUsd: 0,
        latencyMs,
        status,
        dailySpendCapUSD: request.dailySpendCapUSD,
        orgDailySpendCapUSD: request.orgDailySpendCapUSD,
      });
    }
  }
}
