import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  SpendLedger,
  SpendingLedgerValidationError,
  BudgetSignalNotifier,
} from '../../src/orchestrator/gateway/spend-ledger';
import {
  CliSubscriptionBridge,
} from '../../src/orchestrator/gateway/cli-sub-bridge';
import {
  LiteLLMClient,
} from '../../src/orchestrator/gateway/litellm-client';
import { GraywolfAppError } from '../../src/orchestrator/errors/taxonomy';
import { PoolClient } from 'pg';

describe('SpendLedger & Cost Normalization', () => {
  it('forces cost_usd = 0.000000 for local providers (ollama, vllm, llamacpp)', () => {
    const ledger = new SpendLedger();

    expect(ledger.normalizeCostUsd({ provider: 'ollama', rawCostUsd: 0.015 }).costUsd).toBe(0.0);
    expect(ledger.normalizeCostUsd({ provider: 'vllm', rawCostUsd: 0.05 }).costUsd).toBe(0.0);
    expect(ledger.normalizeCostUsd({ provider: 'llamacpp', rawCostUsd: 0.12 }).costUsd).toBe(0.0);
  });

  it('forces cost_usd = 0.000000 for CLI subscription runs', () => {
    const ledger = new SpendLedger();
    const cliPolicy = {
      active: true,
      topology: 'solo' as const,
      providerTag: 'cli-subscription-anthropic',
      credentialKey: null,
      maxTurnsPerTask: 50,
      maxWallClockMs: 1800000,
    };

    expect(
      ledger.normalizeCostUsd({
        provider: 'anthropic',
        rawCostUsd: 0.04,
        cliPolicy,
      }).costUsd
    ).toBe(0.0);

    expect(
      ledger.normalizeCostUsd({
        provider: 'cli-subscription-openai',
        rawCostUsd: 0.08,
      }).costUsd
    ).toBe(0.0);
  });

  it('preserves exact rawCostUsd for commercial paid providers', () => {
    const ledger = new SpendLedger();
    const res = ledger.normalizeCostUsd({ provider: 'openai', rawCostUsd: 0.0035 });
    expect(res.costUsd).toBe(0.0035);
  });

  it('rejects provider tag exceeding VARCHAR(64) column length', () => {
    const ledger = new SpendLedger();
    const longProvider = 'a'.repeat(65);
    expect(() =>
      ledger.normalizeCostUsd({ provider: longProvider, rawCostUsd: 0.01 })
    ).toThrow(SpendingLedgerValidationError);
  });
});

describe('CliSubscriptionBridge (ADR-081 Pattern 4)', () => {
  beforeEach(() => {
    delete process.env.DEPLOYMENT_TOPOLOGY;
  });

  it('resolves active policy in Topology A (solo) when enabled', () => {
    const bridge = new CliSubscriptionBridge();
    const policy = bridge.resolvePolicy({
      topology: 'solo',
      cliSubscriptionAuth: {
        enabled: true,
        provider: 'anthropic',
        maxTurnsPerTask: 25,
        maxWallClockMs: 60_000,
      },
    });

    expect(policy.active).toBe(true);
    expect(policy.topology).toBe('solo');
    expect(policy.providerTag).toBe('cli-subscription-anthropic');
    expect(policy.maxTurnsPerTask).toBe(25);
    expect(policy.maxWallClockMs).toBe(60_000);
  });

  it('enforces turn-count and wall-clock caps in Topology A (TASK_SPEND_LIMIT_EXCEEDED)', () => {
    const bridge = new CliSubscriptionBridge();
    const policy = bridge.resolvePolicy({
      topology: 'solo',
      cliSubscriptionAuth: {
        enabled: true,
        maxTurnsPerTask: 2,
        maxWallClockMs: 10_000,
      },
    });

    // 1st turn -> OK
    const t1 = bridge.recordAndEnforceTurn({ taskId: 'TASK-1', policy, elapsedWallClockMs: 2000 });
    expect(t1.turnCount).toBe(1);

    // 2nd turn -> OK
    const t2 = bridge.recordAndEnforceTurn({ taskId: 'TASK-1', policy, elapsedWallClockMs: 4000 });
    expect(t2.turnCount).toBe(2);

    // 3rd turn -> Exceeds maxTurnsPerTask (2)
    try {
      bridge.recordAndEnforceTurn({ taskId: 'TASK-1', policy, elapsedWallClockMs: 5000 });
      expect.fail('Should have thrown turn count exceeded');
    } catch (err) {
      expect(err).toBeInstanceOf(GraywolfAppError);
      expect((err as GraywolfAppError).code).toBe('TASK_SPEND_LIMIT_EXCEEDED');
    }

    // Wall-clock cap exceeded
    bridge.resetTaskUsage('TASK-2');
    try {
      bridge.recordAndEnforceTurn({ taskId: 'TASK-2', policy, elapsedWallClockMs: 15_000 });
      expect.fail('Should have thrown wall-clock cap exceeded');
    } catch (err) {
      expect(err).toBeInstanceOf(GraywolfAppError);
      expect((err as GraywolfAppError).code).toBe('TASK_SPEND_LIMIT_EXCEEDED');
    }
  });

  it('silently ignores cliSubscriptionAuth in Topologies B (team) and C (enterprise)', () => {
    const bridge = new CliSubscriptionBridge();

    // Topology B (team)
    const policyB = bridge.resolvePolicy({
      topology: 'team',
      cliSubscriptionAuth: { enabled: true, provider: 'anthropic' },
    });
    expect(policyB.active).toBe(false);
    expect(policyB.providerTag).toBeNull();
    expect(policyB.credentialKey).toBeNull();
    expect(policyB.maxTurnsPerTask).toBe(0);

    // Topology C (enterprise)
    const policyC = bridge.resolvePolicy({
      topology: 'enterprise',
      cliSubscriptionAuth: { enabled: true, provider: 'anthropic' },
    });
    expect(policyC.active).toBe(false);
    expect(policyC.providerTag).toBeNull();
  });
});

describe('SpendLedger Daily Budget Valves & ACID Recording', () => {
  it('asserts daily spend cap and throws LLM_DAILY_BUDGET_EXCEEDED when cap is reached', async () => {
    const mockDbRunner = vi.fn().mockImplementation(async (_ctx, fn) => {
      const mockClient = {
        query: vi.fn().mockResolvedValue({
          rows: [{ daily_spend: '5.50' }],
        }),
      } as unknown as PoolClient;
      return fn(mockClient);
    });

    const ledger = new SpendLedger({ dbRunner: mockDbRunner });

    // Under cap: cap is $10.00, current spend is $5.50 -> OK
    const res = await ledger.assertDailyBudgetAvailable({
      workspaceId: '123e4567-e89b-12d3-a456-426614174000',
      dailySpendCapUSD: 10.0,
      provider: 'openai',
    });
    expect(res.currentDailySpendUsd).toBe(5.5);

    // Cap reached: cap is $5.00, current spend is $5.50 -> Throws
    try {
      await ledger.assertDailyBudgetAvailable({
        workspaceId: '123e4567-e89b-12d3-a456-426614174000',
        dailySpendCapUSD: 5.0,
        provider: 'openai',
      });
      expect.fail('Should have thrown daily budget exceeded');
    } catch (err) {
      expect(err).toBeInstanceOf(GraywolfAppError);
      expect((err as GraywolfAppError).code).toBe('LLM_DAILY_BUDGET_EXCEEDED');
      expect((err as GraywolfAppError).httpStatus).toBe(402);
    }

    // Zero-cost provider bypasses check even when cap is reached
    const zeroCostRes = await ledger.assertDailyBudgetAvailable({
      workspaceId: '123e4567-e89b-12d3-a456-426614174000',
      dailySpendCapUSD: 5.0,
      provider: 'ollama',
    });
    expect(zeroCostRes.currentDailySpendUsd).toBe(0.0);

    // Organization daily cap reached: workspace is under ($5.50 < $10.00), but org ceiling ($5.00) is reached
    try {
      await ledger.assertDailyBudgetAvailable({
        workspaceId: '123e4567-e89b-12d3-a456-426614174000',
        orgId: '999e4567-e89b-12d3-a456-426614174999',
        dailySpendCapUSD: 10.0,
        orgDailySpendCapUSD: 5.0,
        provider: 'openai',
      });
      expect.fail('Should have thrown organization daily budget exceeded');
    } catch (err) {
      expect(err).toBeInstanceOf(GraywolfAppError);
      expect((err as GraywolfAppError).code).toBe('LLM_DAILY_BUDGET_EXCEEDED');
    }
  });

  it('records call, atomically increments task spend, and emits budget.warning at 80%', async () => {
    const warningSpy = vi.fn();
    const exceededSpy = vi.fn();
    const notifier: BudgetSignalNotifier = {
      onBudgetWarning: warningSpy,
      onBudgetExceeded: exceededSpy,
    };

    let currentSpend = 0.0;
    const taskSpendLimit = 2.0;

    const mockDbRunner = vi.fn().mockImplementation(async (_ctx, fn) => {
      const mockClient = {
        query: vi.fn().mockImplementation(async (sql, params) => {
          if (sql.includes('INSERT INTO llm_calls')) {
            return { rows: [{ id: 'call-uuid-1' }] };
          }
          if (sql.includes('UPDATE tasks')) {
            currentSpend += params[0];
            return {
              rows: [{ current_spend_usd: currentSpend.toFixed(4), spend_limit_usd: taskSpendLimit.toFixed(4) }],
            };
          }
          return { rows: [] };
        }),
      } as unknown as PoolClient;
      return fn(mockClient);
    });

    const ledger = new SpendLedger({ notifier, dbRunner: mockDbRunner });

    // 1st call: costs $1.00 -> total $1.00 (50%) -> no warning
    const r1 = await ledger.recordCall({
      taskId: 'TASK-10',
      workspaceId: 'ws-1',
      orgId: 'org-1',
      persona: 'implementer',
      model: 'gpt-4o',
      provider: 'openai',
      inputTokens: 1000,
      outputTokens: 500,
      costUsd: 1.0,
    });
    expect(r1.valveStatus).toBe('ok');
    expect(r1.percentUsed).toBe(50);
    expect(warningSpy).not.toHaveBeenCalled();

    // 2nd call: costs $0.65 -> total $1.65 (82.5%) -> crosses 80%!
    const r2 = await ledger.recordCall({
      taskId: 'TASK-10',
      workspaceId: 'ws-1',
      orgId: 'org-1',
      persona: 'implementer',
      model: 'gpt-4o',
      provider: 'openai',
      inputTokens: 1000,
      outputTokens: 500,
      costUsd: 0.65,
    });
    expect(r2.valveStatus).toBe('warning_80_percent');
    expect(r2.percentUsed).toBe(82.5);
    expect(warningSpy).toHaveBeenCalledTimes(1);

    // 3rd call: costs $0.10 -> total $1.75 (87.5%) -> stays above 80%, no duplicate warning!
    const r3 = await ledger.recordCall({
      taskId: 'TASK-10',
      workspaceId: 'ws-1',
      orgId: 'org-1',
      persona: 'implementer',
      model: 'gpt-4o',
      provider: 'openai',
      inputTokens: 100,
      outputTokens: 50,
      costUsd: 0.1,
    });
    expect(r3.valveStatus).toBe('warning_80_percent');
    expect(warningSpy).toHaveBeenCalledTimes(1); // Deduped!

    // 4th call: costs $0.30 -> total $2.05 (102.5%) -> reaches 100% hard stop!
    try {
      await ledger.recordCall({
        taskId: 'TASK-10',
        workspaceId: 'ws-1',
        orgId: 'org-1',
        persona: 'implementer',
        model: 'gpt-4o',
        provider: 'openai',
        inputTokens: 200,
        outputTokens: 100,
        costUsd: 0.3,
      });
      expect.fail('Should have halted with TASK_SPEND_LIMIT_EXCEEDED');
    } catch (err) {
      expect(err).toBeInstanceOf(GraywolfAppError);
      expect((err as GraywolfAppError).code).toBe('TASK_SPEND_LIMIT_EXCEEDED');
      expect(exceededSpy).toHaveBeenCalledTimes(1);
    }
  });

  it('integrates SpendLedger pre-flight check and post-call recording into LiteLLMClient', async () => {
    const mockRecordCall = vi.fn().mockResolvedValue({
      callId: 'call-1',
      valveStatus: 'ok',
    });
    const mockAssertBudget = vi.fn().mockResolvedValue({
      currentDailySpendUsd: 1.0,
    });

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        id: 'chatcmpl-client-ledger',
        model: 'gpt-4o',
        provider: 'openai',
        choices: [{ message: { content: 'Client response' } }],
        usage: { prompt_tokens: 150, completion_tokens: 75, cost: 0.003 },
      }),
    });

    const client = new LiteLLMClient({
      fetchFn: mockFetch as unknown as typeof fetch,
      spendLedger: {
        assertDailyBudgetAvailable: mockAssertBudget,
        recordCall: mockRecordCall,
      },
    });

    const res = await client.complete({
      alias: 'agent-coder',
      messages: [{ role: 'user', content: 'Do task' }],
      taskId: 'TASK-20',
      workspaceId: 'ws-20',
      orgId: 'org-20',
      persona: 'implementer',
      dailySpendCapUSD: 10.0,
    });

    expect(res.content).toBe('Client response');
    expect(mockAssertBudget).toHaveBeenCalledWith({
      workspaceId: 'ws-20',
      orgId: 'org-20',
      dailySpendCapUSD: 10.0,
      orgDailySpendCapUSD: undefined,
      provider: 'agent-coder',
    });
    expect(mockRecordCall).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: 'TASK-20',
        workspaceId: 'ws-20',
        orgId: 'org-20',
        persona: 'implementer',
        costUsd: 0.003,
        status: 'success',
      })
    );
  });

  it('records rate_limited status in SpendLedger when upstream returns 429 with task context', async () => {
    const mockRecordCall = vi.fn().mockResolvedValue({
      callId: 'call-rl-1',
      valveStatus: 'ok',
    });

    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      text: async () => 'Rate limit hit',
    });

    const client = new LiteLLMClient({
      fetchFn: mockFetch as unknown as typeof fetch,
      spendLedger: {
        recordCall: mockRecordCall,
      },
    });

    await expect(
      client.complete({
        alias: 'agent-planner',
        messages: [{ role: 'user', content: 'Plan step' }],
        taskId: 'TASK-21',
        workspaceId: 'ws-20',
        orgId: 'org-20',
        persona: 'planner',
      })
    ).rejects.toThrow();

    expect(mockRecordCall).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: 'TASK-21',
        workspaceId: 'ws-20',
        orgId: 'org-20',
        persona: 'planner',
        costUsd: 0,
        status: 'rate_limited',
      })
    );
  });
});
