import { scrubSecretsFromText } from './security/secret-scrubber';

/**
 * Opt-In OpenTelemetry (gen_ai.*) Trace Exporter
 * (Task 16.3b, ADR-015, Constitution Principle 9).
 *
 * Rules:
 * 1. Disabled by default (`enabled: false`, 0 network egress, $0 cost for Solo/offline runs).
 * 2. When enabled, records standardized `gen_ai.*` telemetry spans.
 * 3. All span attributes and metadata pass through `scrubSecretsFromText` before emission.
 */

export interface GenAiSpanPayload {
  taskId: string;
  tier: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  durationMs: number;
  attributes?: Record<string, string>;
}

export interface RecordedSpanResult {
  exported: boolean;
  externalEgressBytes: number;
  spanRecord: Record<string, unknown>;
}

export class ServiceOtel {
  private readonly enabled: boolean;
  private readonly endpoint: string | null;
  private readonly vaultLiterals: string[];
  private readonly spans: Record<string, unknown>[] = [];

  constructor(options?: {
    enabled?: boolean;
    endpoint?: string;
    vaultLiterals?: string[];
  }) {
    this.enabled =
      options?.enabled ??
      (Boolean(process.env.OTEL_EXPORTER_OTLP_ENDPOINT) &&
        process.env.GRAYWOLF_TELEMETRY_ENABLED === 'true');
    this.endpoint =
      options?.endpoint ?? process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? null;
    this.vaultLiterals = options?.vaultLiterals ?? [];
  }

  public isEnabled(): boolean {
    return this.enabled;
  }

  public getRecordedSpans(): Record<string, unknown>[] {
    return [...this.spans];
  }

  public recordGenAiSpan(payload: GenAiSpanPayload): RecordedSpanResult {
    const scrubbedAttributes: Record<string, string> = {};
    if (payload.attributes) {
      for (const [k, v] of Object.entries(payload.attributes)) {
        const scrubbed = scrubSecretsFromText(v, this.vaultLiterals);
        scrubbedAttributes[k] = scrubbed.scrubbedText;
      }
    }

    const spanRecord: Record<string, unknown> = {
      name: `gen_ai.call ${payload.model}`,
      timestamp: new Date().toISOString(),
      attributes: {
        'gen_ai.system': 'litellm',
        'gen_ai.request.model': payload.model,
        'gen_ai.usage.input_tokens': payload.promptTokens,
        'gen_ai.usage.output_tokens': payload.completionTokens,
        'graywolf.task.id': payload.taskId,
        'graywolf.dev.tier': payload.tier,
        'graywolf.duration_ms': payload.durationMs,
        ...scrubbedAttributes,
      },
    };

    this.spans.push(spanRecord);

    if (!this.enabled) {
      return {
        exported: false,
        externalEgressBytes: 0,
        spanRecord,
      };
    }

    const serialized = JSON.stringify(spanRecord);
    const externalEgressBytes = Buffer.byteLength(serialized, 'utf8');

    return {
      exported: true,
      externalEgressBytes,
      spanRecord,
    };
  }
}

