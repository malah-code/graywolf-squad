import pino from 'pino';
import { GraywolfAppError } from '../errors/taxonomy';

const logger = pino({ name: 'gateway:cli-sub-bridge' });

export type DeploymentTopology = 'solo' | 'team' | 'enterprise';

export interface CliSubscriptionPolicy {
  active: boolean;
  topology: DeploymentTopology;
  providerTag: string | null;
  credentialKey: string | null;
  maxTurnsPerTask: number;
  maxWallClockMs: number;
}

export interface CliSubscriptionAuthConfig {
  enabled?: boolean;
  provider?: string;
  credentialKey?: string;
  maxTurnsPerTask?: number;
  maxWallClockMs?: number;
}

export class CliSubscriptionBridge {
  private readonly taskTurns = new Map<string, number>();

  public resolvePolicy(options: {
    topology?: DeploymentTopology;
    cliSubscriptionAuth?: CliSubscriptionAuthConfig;
    lane?: string;
    provider?: string;
    taskId?: string;
    projectId?: string;
  }): CliSubscriptionPolicy {
    const rawTopology = (
      options.topology ??
      process.env.DEPLOYMENT_TOPOLOGY ??
      'solo'
    ).toLowerCase() as DeploymentTopology;

    const topology: DeploymentTopology = ['solo', 'team', 'enterprise'].includes(rawTopology)
      ? rawTopology
      : 'solo';

    // Topologies B and C: Silently ignore cliSubscriptionAuth and enforce contract-layer no-op
    if (topology !== 'solo') {
      logger.info(
        {
          event: 'topology.cli_subscription.ignored',
          topology,
          taskId: options.taskId,
          projectId: options.projectId,
          source: 'DEPLOYMENT_TOPOLOGY',
        },
        'CLI Subscription Auth ignored in non-solo topology'
      );

      return {
        active: false,
        topology,
        providerTag: null,
        credentialKey: null,
        maxTurnsPerTask: 0,
        maxWallClockMs: 0,
      };
    }

    // Topology A (solo): evaluate configuration
    const config = options.cliSubscriptionAuth;
    if (!config || config.enabled === false) {
      return {
        active: false,
        topology: 'solo',
        providerTag: null,
        credentialKey: null,
        maxTurnsPerTask: 0,
        maxWallClockMs: 0,
      };
    }

    const rawProvider = options.provider ?? config.provider ?? 'anthropic';
    // Validate tag format and 47-character limit for provider part (so 'cli-subscription-' + provider <= 64 chars)
    const sanitizedProvider = rawProvider.slice(0, 47);
    const providerTag = `cli-subscription-${sanitizedProvider}`;

    return {
      active: true,
      topology: 'solo',
      providerTag,
      credentialKey: config.credentialKey ?? null,
      maxTurnsPerTask: config.maxTurnsPerTask ?? 50,
      maxWallClockMs: config.maxWallClockMs ?? 30 * 60 * 1000,
    };
  }

  public recordAndEnforceTurn(options: {
    taskId: string;
    policy: CliSubscriptionPolicy;
    elapsedWallClockMs?: number;
  }): { turnCount: number; elapsedWallClockMs: number } {
    const { taskId, policy, elapsedWallClockMs = 0 } = options;

    if (!policy.active) {
      return { turnCount: 0, elapsedWallClockMs };
    }

    const currentTurns = (this.taskTurns.get(taskId) ?? 0) + 1;
    this.taskTurns.set(taskId, currentTurns);

    // 1. Turn count limit check
    if (policy.maxTurnsPerTask > 0 && currentTurns > policy.maxTurnsPerTask) {
      throw new GraywolfAppError(
        'TASK_SPEND_LIMIT_EXCEEDED',
        `Task '${taskId}' exceeded CLI subscription maximum turn count (${currentTurns} > ${policy.maxTurnsPerTask})`,
        { taskId, turnCount: currentTurns, maxTurnsPerTask: policy.maxTurnsPerTask }
      );
    }

    // 2. Wall clock duration limit check
    if (policy.maxWallClockMs > 0 && elapsedWallClockMs > policy.maxWallClockMs) {
      throw new GraywolfAppError(
        'TASK_SPEND_LIMIT_EXCEEDED',
        `Task '${taskId}' exceeded CLI subscription maximum wall-clock duration (${elapsedWallClockMs}ms > ${policy.maxWallClockMs}ms)`,
        { taskId, elapsedWallClockMs, maxWallClockMs: policy.maxWallClockMs }
      );
    }

    return {
      turnCount: currentTurns,
      elapsedWallClockMs,
    };
  }

  public resetTaskUsage(taskId?: string): void {
    if (taskId) {
      this.taskTurns.delete(taskId);
    } else {
      this.taskTurns.clear();
    }
  }
}
