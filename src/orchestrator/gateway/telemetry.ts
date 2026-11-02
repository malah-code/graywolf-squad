import pino from 'pino';
import { CircuitState } from './circuit-breaker';
import { GraywolfAppError } from '../errors/taxonomy';

const logger = pino({ name: 'gateway:telemetry' });

export interface GenAiSpanAttributes {
  'gen_ai.system': string;
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
  taskId?: string;
  workspaceId?: string;
  orgId?: string;
  persona?: 'planner' | 'implementer' | 'reviewer' | 'arbiter';
}

export const DURATION_HISTOGRAM_BUCKETS = [
  0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10,
];

/**
 * In-memory telemetry recorder providing OTel GenAI semantic conventions
 * with collector cardinality protection and fail-closed payload redaction.
 */
export class GatewayTelemetry {
  public static assertStartupSafety(topology: 'solo' | 'team' | 'enterprise'): void {
    const capturePayloads = process.env.OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT === 'true';
    if (topology !== 'solo' && capturePayloads) {
      throw new GraywolfAppError(
        'RBAC_CROSS_TENANT_VIOLATION',
        'OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT=true is forbidden in multi-tenant topology (Constitution Principle 4 & 5)'
      );
    }
  }

  public static isPayloadCaptureEnabled(): boolean {
    const isRedactPrompts = process.env.GRAYWOLF_OTEL_REDACT_PROMPTS !== 'false';
    const isRedactCompletions = process.env.GRAYWOLF_OTEL_REDACT_COMPLETIONS !== 'false';
    const captureRequested = process.env.OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT === 'true';

    // Must explicitly request capture AND NOT have redaction active
    return captureRequested && !isRedactPrompts && !isRedactCompletions;
  }

  public recordCompletionSpan(options: {
    model: string;
    provider: string;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
    costUsd: number;
    latencyMs: number;
    circuitState: CircuitState;
    usedFallback: boolean;
    eventPayload?: GraywolfCompletionEventPayload;
  }): void {
    const attributes: GenAiSpanAttributes = {
      'gen_ai.system': options.provider,
      'gen_ai.operation.name': 'chat',
      'gen_ai.request.model': options.model,
      'gen_ai.usage.input_tokens': options.inputTokens,
      'gen_ai.usage.output_tokens': options.outputTokens,
      'gen_ai.usage.cache_read.input_tokens': options.cacheReadTokens,
      'gen_ai.usage.cache_write.input_tokens': options.cacheWriteTokens,
      'gen_ai.response.finish_reasons': ['stop'],
      'graywolf.cost_usd': options.costUsd,
      'graywolf.circuit_state': options.circuitState,
      'graywolf.used_fallback': options.usedFallback,
    };

    logger.debug(
      {
        spanName: `chat ${options.model}`,
        attributes,
        durationSeconds: options.latencyMs / 1000,
        spanEvent: options.eventPayload
          ? { name: 'graywolf.completion', attributes: options.eventPayload }
          : undefined,
      },
      'Recorded OTel GenAI completion span'
    );
  }

  public recordCircuitTransition(options: {
    alias: string;
    provider: string;
    fromState: CircuitState;
    toState: CircuitState;
  }): void {
    logger.info(
      {
        metric: 'llm_circuit_breaker_transitions_total',
        labels: options,
      },
      'Circuit breaker state transition recorded'
    );
  }

  public recordSpendUsd(options: {
    topology?: 'solo' | 'team' | 'enterprise';
    persona: 'planner' | 'implementer' | 'reviewer' | 'arbiter';
    provider: string;
    model: string;
    costUsd: number;
  }): void {
    logger.debug(
      {
        metric: 'llm_spend_usd_total',
        value: options.costUsd,
        labels: {
          topology: options.topology ?? (process.env.DEPLOYMENT_TOPOLOGY || 'solo'),
          persona: options.persona,
          provider: options.provider,
          model: options.model,
        },
      },
      'Recorded LLM spend metric'
    );
  }

  public recordBudgetSignal(options: {
    workspaceId: string;
    topology?: 'solo' | 'team' | 'enterprise';
    signal: 'warning_80_percent' | 'task_limit_exceeded' | 'daily_limit_exceeded';
  }): void {
    logger.info(
      {
        metric: 'llm_budget_signals_total',
        labels: {
          topology: options.topology ?? (process.env.DEPLOYMENT_TOPOLOGY || 'solo'),
          signal: options.signal,
        },
        spanEvent: {
          name: 'graywolf.budget_signal',
          attributes: { workspaceId: options.workspaceId, signal: options.signal },
        },
      },
      'Budget signal recorded'
    );
  }
}
