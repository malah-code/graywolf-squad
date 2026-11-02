import * as crypto from 'node:crypto';
import { GraywolfAppError } from '../errors/taxonomy';
import type { LiteLLMClient } from '../gateway/litellm-client';
import { wrapUntrustedBrowserObservation } from '../tiers/implementer';

/**
 * Local-Only Hybrid Intent Runtime via LiteLLM (Task 13.1b, ADR-075, ADR-077, FR-002).
 *
 * Exposes:
 * - agent.act(intent, pageRef)
 * - agent.assert(intent, pageRef)
 * - agent.waitFor(intent, pageRef)
 * - agent.extract(intent, pageRef)
 *
 * Rules:
 * 1. ZERO external SaaS egress — routes strictly through LiteLLMClient.
 * 2. Origin lock-on: strictly restricts navigation to preview server origin.
 * 3. Untrusted tagging: wraps all browser observations with <untrusted_browser_observation> (ADR-038).
 */

export type IntentStepKind = 'act' | 'assert' | 'waitFor' | 'extract';

export interface IntentRuntimeOptions {
  litellmAlias?: 'agent-e2e-intent' | 'agent-e2e-explore' | string;
  allowedOriginRegex?: string;
  snapshotTokenCap?: number; // default: 2000 tokens (~8000 chars)
}

export interface IntentStepCall {
  taskId: string;
  intent: string;
  pageUrl: string;
  ariaSnapshot: string;
  locale?: 'ar' | 'en' | 'fr' | 'tr';
}

export interface IntentStepResult {
  taskId: string;
  kind: IntentStepKind;
  resolvedLocator: string | null;
  resolvedValue: string | null;
  ariaSnapshotHash: string;
  tokensUsed: number;
  finished: boolean;
  wrappedObservation: string;
}

const DEFAULT_ORIGIN_REGEX = /^https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/i;
const DEFAULT_SNAPSHOT_TOKEN_CAP = 2000;

export class IntentRuntime {
  private readonly litellm: LiteLLMClient;
  private readonly options: Required<IntentRuntimeOptions>;

  constructor(litellm: LiteLLMClient, options?: IntentRuntimeOptions) {
    this.litellm = litellm;
    this.options = {
      litellmAlias: options?.litellmAlias ?? 'agent-e2e-intent',
      allowedOriginRegex: options?.allowedOriginRegex ?? '',
      snapshotTokenCap: options?.snapshotTokenCap ?? DEFAULT_SNAPSHOT_TOKEN_CAP,
    };
  }

  private validateOrigin(url: string): string {
    let origin: string;
    try {
      origin = new URL(url).origin;
    } catch {
      throw new GraywolfAppError(
        'RELAY_BLAST_RADIUS_VIOLATION',
        `Browser intent step navigation to invalid URL '${url}'`,
        { url }
      );
    }

    if (this.options.allowedOriginRegex) {
      const customRegex = new RegExp(this.options.allowedOriginRegex, 'i');
      if (!customRegex.test(origin)) {
        throw new GraywolfAppError(
          'RELAY_BLAST_RADIUS_VIOLATION',
          `Browser navigation to '${origin}' violates allowed origin pattern '${this.options.allowedOriginRegex}'`,
          { origin, allowedOriginRegex: this.options.allowedOriginRegex }
        );
      }
    } else if (!DEFAULT_ORIGIN_REGEX.test(origin)) {
      throw new GraywolfAppError(
        'RELAY_BLAST_RADIUS_VIOLATION',
        `Browser navigation to '${origin}' violates preview server origin restriction. Zero external cloud egress permitted.`,
        { origin }
      );
    }

    return origin;
  }

  private hashSnapshot(snapshot: string): string {
    return crypto.createHash('sha256').update(snapshot, 'utf8').digest('hex');
  }

  private capSnapshot(snapshot: string): string {
    // 1 token ~ 4 characters
    const maxChars = this.options.snapshotTokenCap * 4;
    if (snapshot.length <= maxChars) {
      return snapshot;
    }
    return snapshot.slice(0, maxChars) + '\n<!-- [TRUNCATED_AT_TOKEN_CAP] -->';
  }

  private async executeStep(
    kind: IntentStepKind,
    call: IntentStepCall
  ): Promise<IntentStepResult> {
    const origin = this.validateOrigin(call.pageUrl);
    const snapshotHash = this.hashSnapshot(call.ariaSnapshot);
    const boundedSnapshot = this.capSnapshot(call.ariaSnapshot);

    const wrappedObservation = wrapUntrustedBrowserObservation(
      boundedSnapshot,
      call.pageUrl,
      origin
    );

    const systemPrompt = [
      `You are the Graywolf Squad Hybrid Intent E2E Engine resolving '${kind}' step against the live DOM.`,
      `You must output strict JSON with fields:`,
      `  "resolvedLocator": semantic Playwright locator string (e.g. "getByRole('button', { name: 'Save' })" or "getByTestId('submit-btn')"). Do NOT use raw XPath or CSS class chains.`,
      `  "resolvedValue": string value if extracting or asserting, or null.`,
      `  "finished": boolean indicating step completion.`,
    ].join('\n');

    const userPrompt = [
      `Intent: "${call.intent}"`,
      `Page URL: "${call.pageUrl}"`,
      `Observation:`,
      wrappedObservation,
    ].join('\n\n');

    const response = await this.litellm.complete({
      alias: this.options.litellmAlias,
      taskId: call.taskId,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.1,
    });

    let resolvedLocator: string | null = null;
    let resolvedValue: string | null = null;
    let finished = true;

    try {
      const parsed = JSON.parse(response.content.replace(/```(?:json)?/g, '').trim());
      resolvedLocator = parsed.resolvedLocator ?? null;
      resolvedValue = parsed.resolvedValue !== undefined ? String(parsed.resolvedValue) : null;
      if (typeof parsed.finished === 'boolean') {
        finished = parsed.finished;
      }
    } catch {
      // Fallback: extract locator using getBy... regex if model returned conversational markdown.
      // OBS-2 fix: do NOT fall back to raw response.content — it could cache a prose paragraph
      // as a Playwright locator. If the semantic regex also misses, leave resolvedLocator null
      // so the cache-replay engine skips caching this step (correct fail-open behavior).
      const locatorMatch = response.content.match(/getBy[A-Za-z]+\([^)]+\)/);
      if (locatorMatch) {
        resolvedLocator = locatorMatch[0];
      }
      // resolvedLocator stays null — the caller/cache engine handles null gracefully
    }

    const tokensUsed = Math.max(1, (response.inputTokens || 0) + (response.outputTokens || 0));

    return {
      taskId: call.taskId,
      kind,
      resolvedLocator,
      resolvedValue,
      ariaSnapshotHash: snapshotHash,
      tokensUsed,
      finished,
      wrappedObservation,
    };
  }

  public async agentAct(call: IntentStepCall): Promise<IntentStepResult> {
    return this.executeStep('act', call);
  }

  public async agentAssert(call: IntentStepCall): Promise<IntentStepResult> {
    return this.executeStep('assert', call);
  }

  public async agentWaitFor(call: IntentStepCall): Promise<IntentStepResult> {
    return this.executeStep('waitFor', call);
  }

  public async agentExtract(call: IntentStepCall): Promise<IntentStepResult> {
    return this.executeStep('extract', call);
  }
}
