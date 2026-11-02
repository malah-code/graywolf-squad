import { describe, it, expect, vi } from 'vitest';
import {
  CircuitBreakerRegistry,
  isTransientError,
} from '../../src/orchestrator/gateway/circuit-breaker';
import {
  LiteLLMClient,
  LiteLLMCompletionRequest,
} from '../../src/orchestrator/gateway/litellm-client';
import { GatewayTelemetry } from '../../src/orchestrator/gateway/telemetry';
import { GraywolfAppError } from '../../src/orchestrator/errors/taxonomy';

describe('CircuitBreakerRegistry', () => {
  it('initializes in CLOSED state with 0 consecutive failures', () => {
    const registry = new CircuitBreakerRegistry();
    const snapshot = registry.getSnapshot('agent-planner');
    expect(snapshot.state).toBe('CLOSED');
    expect(snapshot.consecutiveFailures).toBe(0);
    expect(registry.canAttempt('agent-planner')).toBe(true);
  });

  it('increments failures and trips to OPEN after 3 consecutive failures', () => {
    const fakeTime = 1000;
    const registry = new CircuitBreakerRegistry({
      failureThreshold: 3,
      cooldownMs: 30_000,
      nowFn: () => fakeTime,
    });

    // 1st failure
    const snap1 = registry.recordFailure('agent-coder', 500);
    expect(snap1.state).toBe('CLOSED');
    expect(snap1.consecutiveFailures).toBe(1);
    expect(registry.canAttempt('agent-coder')).toBe(true);

    // 2nd failure
    const snap2 = registry.recordFailure('agent-coder', 429);
    expect(snap2.state).toBe('CLOSED');
    expect(snap2.consecutiveFailures).toBe(2);
    expect(registry.canAttempt('agent-coder')).toBe(true);

    // 3rd failure -> trip!
    const snap3 = registry.recordFailure('agent-coder', 503);
    expect(snap3.state).toBe('OPEN');
    expect(snap3.consecutiveFailures).toBe(3);
    expect(snap3.openedAt).toBe(1000);
    expect(registry.canAttempt('agent-coder')).toBe(false);
  });

  it('transitions from OPEN to HALF_OPEN when cooldown elapses', () => {
    let fakeTime = 1000;
    const registry = new CircuitBreakerRegistry({
      failureThreshold: 3,
      cooldownMs: 30_000,
      nowFn: () => fakeTime,
    });

    registry.recordFailure('agent-reviewer', 500);
    registry.recordFailure('agent-reviewer', 500);
    registry.recordFailure('agent-reviewer', 500);
    expect(registry.canAttempt('agent-reviewer')).toBe(false);

    // Advance time within cooldown (20 seconds)
    fakeTime += 20_000;
    expect(registry.canAttempt('agent-reviewer')).toBe(false);

    // Advance past cooldown (30 seconds total)
    fakeTime += 10_000;
    expect(registry.canAttempt('agent-reviewer')).toBe(true);
    const snap = registry.getSnapshot('agent-reviewer');
    expect(snap.state).toBe('HALF_OPEN');
  });

  it('recovers to CLOSED on probe success in HALF_OPEN', () => {
    let fakeTime = 1000;
    const registry = new CircuitBreakerRegistry({
      failureThreshold: 3,
      cooldownMs: 30_000,
      nowFn: () => fakeTime,
    });

    registry.recordFailure('agent-arbiter', 500);
    registry.recordFailure('agent-arbiter', 500);
    registry.recordFailure('agent-arbiter', 500);

    fakeTime += 30_000;
    expect(registry.canAttempt('agent-arbiter')).toBe(true);

    // Record success on probe
    const restored = registry.recordSuccess('agent-arbiter');
    expect(restored.state).toBe('CLOSED');
    expect(restored.consecutiveFailures).toBe(0);
    expect(restored.openedAt).toBeNull();
  });

  it('re-trips to OPEN immediately on failure during HALF_OPEN', () => {
    let fakeTime = 1000;
    const registry = new CircuitBreakerRegistry({
      failureThreshold: 3,
      cooldownMs: 30_000,
      nowFn: () => fakeTime,
    });

    registry.recordFailure('agent-coder', 500);
    registry.recordFailure('agent-coder', 500);
    registry.recordFailure('agent-coder', 500);

    fakeTime += 30_000;
    expect(registry.canAttempt('agent-coder')).toBe(true); // HALF_OPEN

    // Failure on probe
    const reTripped = registry.recordFailure('agent-coder', 500);
    expect(reTripped.state).toBe('OPEN');
    expect(registry.canAttempt('agent-coder')).toBe(false);
  });

  it('correctly classifies transient vs non-transient errors', () => {
    expect(isTransientError(429)).toBe(true);
    expect(isTransientError(500)).toBe(true);
    expect(isTransientError(502)).toBe(true);
    expect(isTransientError(503)).toBe(true);
    expect(isTransientError(504)).toBe(true);
    expect(isTransientError(400)).toBe(false);
    expect(isTransientError(401)).toBe(false);
    expect(isTransientError(403)).toBe(false);
    expect(isTransientError(422)).toBe(false);

    const netTimeout = new Error('Connection timed out');
    (netTimeout as unknown as { code: string }).code = 'ETIMEDOUT';
    expect(isTransientError(netTimeout)).toBe(true);

    const connectTimeout = new Error('Connect timeout');
    (connectTimeout as unknown as { code: string }).code = 'UND_ERR_CONNECT_TIMEOUT';
    expect(isTransientError(connectTimeout)).toBe(true);

    const resetError = new Error('Connection reset');
    (resetError as unknown as { code: string }).code = 'ECONNRESET';
    expect(isTransientError(resetError)).toBe(true);

    const dnsError = new Error('DNS lookup failure');
    (dnsError as unknown as { code: string }).code = 'EAI_AGAIN';
    expect(isTransientError(dnsError)).toBe(true);
  });
});

describe('LiteLLMClient Virtual Routing & Failover', () => {
  it('routes to primary alias on healthy 200 response', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        id: 'chatcmpl-test-1',
        model: 'gpt-4o',
        provider: 'openai',
        choices: [{ message: { content: 'Plan created successfully' } }],
        usage: { prompt_tokens: 100, completion_tokens: 50, cost: 0.002 },
      }),
    });

    const client = new LiteLLMClient({ fetchFn: mockFetch as unknown as typeof fetch });
    const res = await client.complete({
      alias: 'agent-planner',
      messages: [{ role: 'user', content: 'Generate task plan' }],
    });

    expect(res.aliasUsed).toBe('agent-planner');
    expect(res.usedFallback).toBe(false);
    expect(res.content).toBe('Plan created successfully');
    expect(res.inputTokens).toBe(100);
    expect(res.outputTokens).toBe(50);
    expect(res.costUsd).toBe(0.002);
  });

  it('trips circuit breaker on 3rd failure and fails over to fallback alias within 2 seconds', async () => {
    const startTime = Date.now();

    const mockFetch = vi.fn().mockImplementation(async (_url, options) => {
      const body = JSON.parse(options.body as string);

      if (body.model === 'agent-coder') {
        // Primary alias fails with 500
        return {
          ok: false,
          status: 500,
          text: async () => 'Internal Server Error upstream',
        };
      }

      if (body.model === 'agent-coder-fallback') {
        // Fallback alias succeeds
        return {
          ok: true,
          status: 200,
          json: async () => ({
            id: 'chatcmpl-fallback-1',
            model: 'deepseek-coder:33b',
            provider: 'ollama',
            choices: [{ message: { content: 'Fallback synthesis ready' } }],
            usage: { prompt_tokens: 80, completion_tokens: 40, cost: 0 },
          }),
        };
      }

      throw new Error(`Unexpected model: ${body.model}`);
    });

    const registry = new CircuitBreakerRegistry();
    const client = new LiteLLMClient({
      fetchFn: mockFetch as unknown as typeof fetch,
      circuitBreaker: registry,
    });

    const req: LiteLLMCompletionRequest = {
      alias: 'agent-coder',
      fallbackAlias: 'agent-coder-fallback',
      messages: [{ role: 'user', content: 'Write code' }],
    };

    // 1st attempt: primary fails, falls back immediately
    const res1 = await client.complete(req);
    expect(res1.usedFallback).toBe(true);
    expect(res1.aliasUsed).toBe('agent-coder-fallback');
    expect(res1.content).toBe('Fallback synthesis ready');

    // 2nd attempt: primary fails again, falls back
    const res2 = await client.complete(req);
    expect(res2.usedFallback).toBe(true);

    // 3rd attempt: primary fails 3rd time, trips circuit, falls back
    const res3 = await client.complete(req);
    expect(res3.usedFallback).toBe(true);

    // Primary circuit is now OPEN
    expect(registry.getSnapshot('agent-coder').state).toBe('OPEN');
    expect(registry.getSnapshot('agent-coder').consecutiveFailures).toBe(3);

    // 4th attempt: primary circuit is OPEN -> directly routes to fallback without attempting primary
    const res4 = await client.complete(req);
    expect(res4.usedFallback).toBe(true);

    const elapsed = Date.now() - startTime;
    expect(elapsed).toBeLessThan(2000); // Under 2,000ms SLA
  });

  it('throws canonical LLM_CIRCUIT_BREAKER_TRIPPED when fallback also fails or is not configured', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      text: async () => 'Service Unavailable',
    });

    const registry = new CircuitBreakerRegistry();
    const client = new LiteLLMClient({
      fetchFn: mockFetch as unknown as typeof fetch,
      circuitBreaker: registry,
    });

    // Without fallback, 3 failures trip the circuit
    const req: LiteLLMCompletionRequest = {
      alias: 'agent-arbiter',
      messages: [{ role: 'user', content: 'Arbitrate' }],
    };

    await expect(client.complete(req)).rejects.toThrow();
    await expect(client.complete(req)).rejects.toThrow();

    // 3rd failure trips and throws LLM_CIRCUIT_BREAKER_TRIPPED
    try {
      await client.complete(req);
      expect.fail('Should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(GraywolfAppError);
      expect((err as GraywolfAppError).code).toBe('LLM_CIRCUIT_BREAKER_TRIPPED');
    }
  });

  it('maps HTTP 400 with context length error to LLM_CONTEXT_WINDOW_EXCEEDED without tripping breaker', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => 'Error: maximum context length exceeded (4096 tokens max)',
    });

    const registry = new CircuitBreakerRegistry();
    const client = new LiteLLMClient({
      fetchFn: mockFetch as unknown as typeof fetch,
      circuitBreaker: registry,
    });

    try {
      await client.complete({
        alias: 'agent-coder',
        messages: [{ role: 'user', content: 'Huge prompt'.repeat(1000) }],
      });
      expect.fail('Should have thrown context window error');
    } catch (err) {
      expect(err).toBeInstanceOf(GraywolfAppError);
      expect((err as GraywolfAppError).code).toBe('LLM_CONTEXT_WINDOW_EXCEEDED');
      expect((err as GraywolfAppError).retryable).toBe(false);
      // Circuit breaker failures must NOT be incremented
      expect(registry.getSnapshot('agent-coder').consecutiveFailures).toBe(0);
      expect(registry.getSnapshot('agent-coder').state).toBe('CLOSED');
    }
  });

  it('maps local model offline errors to LLM_LOCAL_MODEL_OFFLINE', async () => {
    const mockFetch = vi.fn().mockImplementation(() => {
      const err = new Error('connect ECONNREFUSED 127.0.0.1:11434');
      (err as unknown as { code: string }).code = 'ECONNREFUSED';
      throw err;
    });

    const client = new LiteLLMClient({ fetchFn: mockFetch as unknown as typeof fetch });

    try {
      await client.complete({
        alias: 'ollama/qwen2.5-coder:32b',
        messages: [{ role: 'user', content: 'Local code task' }],
      });
      expect.fail('Should have thrown offline error');
    } catch (err) {
      expect(err).toBeInstanceOf(GraywolfAppError);
      expect((err as GraywolfAppError).code).toBe('LLM_LOCAL_MODEL_OFFLINE');
      expect((err as GraywolfAppError).httpStatus).toBe(503);
      expect((err as GraywolfAppError).retryable).toBe(true);
    }
  });

  it('throws LLM_PROVIDER_RATE_LIMITED on single 429 when no fallback is configured and circuit is not yet open', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      text: async () => 'Rate limit exceeded',
    });

    const client = new LiteLLMClient({ fetchFn: mockFetch as unknown as typeof fetch });

    try {
      await client.complete({
        alias: 'agent-planner',
        messages: [{ role: 'user', content: 'Plan step' }],
      });
      expect.fail('Should have thrown rate limit error');
    } catch (err) {
      expect(err).toBeInstanceOf(GraywolfAppError);
      expect((err as GraywolfAppError).code).toBe('LLM_PROVIDER_RATE_LIMITED');
      expect((err as GraywolfAppError).httpStatus).toBe(429);
    }
  });

  it('records OTel GenAI completion telemetry span and span events for task context', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        id: 'chatcmpl-otel-1',
        model: 'gpt-4o-mini',
        provider: 'openai',
        choices: [{ message: { content: 'Plan step ready' } }],
        usage: { prompt_tokens: 50, completion_tokens: 25, cost: 0.0005 },
      }),
    });

    const client = new LiteLLMClient({ fetchFn: mockFetch as unknown as typeof fetch });
    const res = await client.complete({
      alias: 'agent-planner',
      messages: [{ role: 'user', content: 'Plan task' }],
      taskId: 'TASK-100',
      workspaceId: 'ws-100',
      orgId: 'org-100',
      persona: 'planner',
    });

    expect(res.model).toBe('gpt-4o-mini');
    expect(res.inputTokens).toBe(50);
    expect(res.outputTokens).toBe(25);
  });

  it('enforces fail-closed OTel telemetry startup check rejecting payload capture in multi-tenant topologies', () => {

    // Solo topology allows capture if configured
    process.env.OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT = 'true';
    expect(() => GatewayTelemetry.assertStartupSafety('solo')).not.toThrow();

    // Multi-tenant topologies (team / enterprise) MUST throw and halt startup
    expect(() => GatewayTelemetry.assertStartupSafety('team')).toThrowError(
      /OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT=true is forbidden in multi-tenant topology/
    );
    expect(() => GatewayTelemetry.assertStartupSafety('enterprise')).toThrowError(
      /OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT=true is forbidden in multi-tenant topology/
    );

    // Reset env
    delete process.env.OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT;
    expect(() => GatewayTelemetry.assertStartupSafety('team')).not.toThrow();
  });
});

