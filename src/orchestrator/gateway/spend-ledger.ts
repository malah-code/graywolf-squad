import pino from 'pino';
import { PoolClient } from 'pg';
import { withTenantContext } from '../db';
import { GraywolfAppError } from '../errors/taxonomy';
import { CliSubscriptionPolicy } from './cli-sub-bridge';
import { GatewayTelemetry } from './telemetry';

const logger = pino({ name: 'gateway:spend-ledger' });

export class SpendingLedgerValidationError extends GraywolfAppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super('ACI_VALIDATION_FAILED', message, details);
    this.name = 'SpendingLedgerValidationError';
    Object.setPrototypeOf(this, SpendingLedgerValidationError.prototype);
  }
}

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

export interface LlmCallRecordInput {
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
  latencyMs?: number;
  status?: 'success' | 'rate_limited' | 'error';
}

export interface SpendValveResult {
  callId: string;
  recordedCostUsd: number;
  currentTaskSpendUsd: number;
  taskSpendLimitUsd: number;
  percentUsed: number;
  valveStatus: 'ok' | 'warning_80_percent' | 'task_limit_exceeded' | 'daily_limit_exceeded';
}

export interface SpendLedgerOptions {
  notifier?: BudgetSignalNotifier;
  dbRunner?: typeof withTenantContext;
  telemetry?: GatewayTelemetry;
}

export class SpendLedger {
  private readonly notifier?: BudgetSignalNotifier;
  private readonly dbRunner: typeof withTenantContext;
  private readonly telemetry: GatewayTelemetry;

  constructor(options?: SpendLedgerOptions) {
    this.notifier = options?.notifier;
    this.dbRunner = options?.dbRunner ?? withTenantContext;
    this.telemetry = options?.telemetry ?? new GatewayTelemetry();
  }

  /**
   * Idempotent pure function forcing cost_usd = 0.000000 for local models and CLI subscription runs.
   * Rejects provider.length > 64 pre-INSERT with SpendingLedgerValidationError.
   */
  public normalizeCostUsd(options: {
    provider: string;
    rawCostUsd: number;
    cliPolicy?: CliSubscriptionPolicy;
  }): { provider: string; costUsd: number } {
    const { provider, rawCostUsd, cliPolicy } = options;

    if (!provider || provider.length > 64) {
      throw new SpendingLedgerValidationError(
        `Provider tag exceeds maximum column length of 64 characters (${provider?.length ?? 0} > 64)`,
        { provider }
      );
    }

    const isLocalProvider = ['ollama', 'vllm', 'llamacpp'].includes(provider.toLowerCase());
    const isCliSub = cliPolicy?.active === true || provider.startsWith('cli-subscription-');

    if (isLocalProvider || isCliSub) {
      return { provider, costUsd: 0.0 };
    }

    return { provider, costUsd: Number(rawCostUsd) || 0.0 };
  }

  /**
   * Asserts workspace (and optional organization) UTC daily spend availability.
   * $0.00 local model calls and Topology A CLI subscriptions bypass USD cap enforcement.
   */
  public async assertDailyBudgetAvailable(options: {
    workspaceId: string;
    orgId?: string;
    dailySpendCapUSD?: number;
    orgDailySpendCapUSD?: number;
    provider: string;
    cliPolicy?: CliSubscriptionPolicy;
  }): Promise<{ currentDailySpendUsd: number; currentOrgDailySpendUsd?: number }> {
    const { workspaceId, orgId, dailySpendCapUSD, orgDailySpendCapUSD, provider, cliPolicy } = options;

    // Zero-cost calls are always permitted even if daily USD limit is exhausted
    const isLocalProvider = ['ollama', 'vllm', 'llamacpp'].includes(provider.toLowerCase());
    const isCliSub = cliPolicy?.active === true || provider.startsWith('cli-subscription-');
    if (isLocalProvider || isCliSub) {
      return { currentDailySpendUsd: 0.0 };
    }

    return await this.dbRunner({ workspaceId, orgId }, async (client: PoolClient) => {
      // 1. Workspace daily spend
      const wsRes = await client.query<{ daily_spend: string }>(
        `SELECT COALESCE(SUM(cost_usd), 0)::text AS daily_spend
         FROM llm_calls
         WHERE workspace_id = $1
           AND created_at >= date_trunc('day', NOW() AT TIME ZONE 'UTC')`,
        [workspaceId]
      );
      const currentDailySpendUsd = parseFloat(wsRes.rows[0]?.daily_spend ?? '0');

      if (dailySpendCapUSD !== undefined && dailySpendCapUSD > 0 && currentDailySpendUsd >= dailySpendCapUSD) {
        logger.warn(
          { workspaceId, currentDailySpendUsd, dailySpendCapUSD },
          'Workspace daily budget cap reached'
        );
        this.telemetry.recordBudgetSignal({
          workspaceId,
          signal: 'daily_limit_exceeded',
        });
        throw new GraywolfAppError(
          'LLM_DAILY_BUDGET_EXCEEDED',
          `Daily spend limit reached for workspace ($${currentDailySpendUsd.toFixed(2)} >= $${dailySpendCapUSD.toFixed(2)})`,
          { workspaceId, currentDailySpendUsd, dailySpendCapUSD }
        );
      }

      // 2. Optional Org ceiling
      let currentOrgDailySpendUsd: number | undefined;
      if (orgId && orgDailySpendCapUSD !== undefined && orgDailySpendCapUSD > 0) {
        const orgRes = await client.query<{ daily_spend: string }>(
          `SELECT COALESCE(SUM(cost_usd), 0)::text AS daily_spend
           FROM llm_calls
           WHERE org_id = $1
             AND created_at >= date_trunc('day', NOW() AT TIME ZONE 'UTC')`,
          [orgId]
        );
        currentOrgDailySpendUsd = parseFloat(orgRes.rows[0]?.daily_spend ?? '0');

        if (currentOrgDailySpendUsd >= orgDailySpendCapUSD) {
          logger.warn(
            { orgId, currentOrgDailySpendUsd, orgDailySpendCapUSD },
            'Organization daily budget cap reached'
          );
          this.telemetry.recordBudgetSignal({
            workspaceId,
            signal: 'daily_limit_exceeded',
          });
          throw new GraywolfAppError(
            'LLM_DAILY_BUDGET_EXCEEDED',
            `Daily spend limit reached for organization ($${currentOrgDailySpendUsd.toFixed(2)} >= $${orgDailySpendCapUSD.toFixed(2)})`,
            { orgId, currentOrgDailySpendUsd, orgDailySpendCapUSD }
          );
        }
      }

      return { currentDailySpendUsd, currentOrgDailySpendUsd };
    });
  }

  /**
   * Persists an LLM call to llm_calls, normalizes cost, atomically increments tasks.current_spend_usd,
   * and triggers 80% warning and 100% hard stop valves.
   */
  public async recordCall(
    input: LlmCallRecordInput & {
      cliPolicy?: CliSubscriptionPolicy;
      dailySpendCapUSD?: number;
      orgDailySpendCapUSD?: number;
    }
  ): Promise<SpendValveResult> {
    const { provider, costUsd: normalizedCost } = this.normalizeCostUsd({
      provider: input.provider,
      rawCostUsd: input.costUsd,
      cliPolicy: input.cliPolicy,
    });

    return await this.dbRunner(
      { workspaceId: input.workspaceId, orgId: input.orgId },
      async (client: PoolClient) => {
        // 1. Insert into llm_calls
        const insertRes = await client.query<{ id: string }>(
          `INSERT INTO llm_calls (
            task_id, workspace_id, org_id, persona, model, provider,
            input_tokens, output_tokens, cache_read_tokens, cache_write_tokens,
            cost_usd, latency_ms, status
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
          RETURNING id`,
          [
            input.taskId,
            input.workspaceId,
            input.orgId,
            input.persona,
            input.model,
            provider,
            input.inputTokens,
            input.outputTokens,
            input.cacheReadTokens ?? 0,
            input.cacheWriteTokens ?? 0,
            normalizedCost,
            input.latencyMs ?? null,
            input.status ?? 'success',
          ]
        );

        const callId = insertRes.rows[0].id;
        this.telemetry.recordSpendUsd({
          persona: input.persona,
          provider,
          model: input.model,
          costUsd: normalizedCost,
        });

        // 2. Atomically increment tasks.current_spend_usd
        const taskRes = await client.query<{ current_spend_usd: string; spend_limit_usd: string | null }>(
          `UPDATE tasks
           SET current_spend_usd = COALESCE(current_spend_usd, 0) + $1
           WHERE id = $2
           RETURNING current_spend_usd, spend_limit_usd`,
          [normalizedCost, input.taskId]
        );

        const currentTaskSpendUsd = parseFloat(taskRes.rows[0]?.current_spend_usd ?? '0');
        const taskSpendLimitUsd = parseFloat(taskRes.rows[0]?.spend_limit_usd ?? '0');

        let percentUsed = 0;
        let valveStatus: SpendValveResult['valveStatus'] = 'ok';

        if (taskSpendLimitUsd > 0) {
          percentUsed = (currentTaskSpendUsd / taskSpendLimitUsd) * 100;

          if (currentTaskSpendUsd >= taskSpendLimitUsd) {
            valveStatus = 'task_limit_exceeded';
            logger.warn(
              { taskId: input.taskId, currentTaskSpendUsd, taskSpendLimitUsd },
              'Task spend ceiling reached 100%'
            );
            this.telemetry.recordBudgetSignal({
              workspaceId: input.workspaceId,
              signal: 'task_limit_exceeded',
            });

            await this.notifier?.onBudgetExceeded?.({
              taskId: input.taskId,
              workspaceId: input.workspaceId,
              currentSpendUSD: currentTaskSpendUsd,
              spendLimitUSD: taskSpendLimitUsd,
              action: 'halt_and_escalate',
            });
          } else if (percentUsed >= 80) {
            valveStatus = 'warning_80_percent';
            // Only trigger warning when newly crossing 80% boundary
            const prevSpend = currentTaskSpendUsd - normalizedCost;
            const prevPercent = (prevSpend / taskSpendLimitUsd) * 100;

            if (prevPercent < 80) {
              logger.info(
                { taskId: input.taskId, currentTaskSpendUsd, taskSpendLimitUsd, percentUsed },
                'Task spend crossed 80% warning threshold'
              );
              this.telemetry.recordBudgetSignal({
                workspaceId: input.workspaceId,
                signal: 'warning_80_percent',
              });

              await this.notifier?.onBudgetWarning?.({
                taskId: input.taskId,
                workspaceId: input.workspaceId,
                currentSpendUSD: currentTaskSpendUsd,
                spendLimitUSD: taskSpendLimitUsd,
                percentUsed,
                message: `Task ${input.taskId} spend reached ${percentUsed.toFixed(1)}% of ceiling ($${currentTaskSpendUsd.toFixed(2)} / $${taskSpendLimitUsd.toFixed(2)})`,
              });
            }
          }
        }

        const result: SpendValveResult = {
          callId,
          recordedCostUsd: normalizedCost,
          currentTaskSpendUsd,
          taskSpendLimitUsd,
          percentUsed,
          valveStatus,
        };

        if (valveStatus === 'task_limit_exceeded') {
          throw new GraywolfAppError(
            'TASK_SPEND_LIMIT_EXCEEDED',
            `Task '${input.taskId}' reached 100% spend limit ($${currentTaskSpendUsd.toFixed(2)} >= $${taskSpendLimitUsd.toFixed(2)})`,
            { taskId: input.taskId, currentTaskSpendUsd, taskSpendLimitUsd }
          );
        }

        return result;
      }
    );
  }
}
