import pino from 'pino';

const logger = pino({ name: 'gateway:circuit-breaker' });

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface CircuitBreakerOptions {
  failureThreshold?: number; // default: 3
  cooldownMs?: number;       // default: 30_000
  nowFn?: () => number;      // default: Date.now
  onTransition?: (event: {
    alias: string;
    provider: string;
    fromState: CircuitState;
    toState: CircuitState;
  }) => void;
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
  private readonly failureThreshold: number;
  private readonly cooldownMs: number;
  private readonly nowFn: () => number;
  private readonly onTransition?: CircuitBreakerOptions['onTransition'];
  private readonly circuits = new Map<string, ProviderCircuitSnapshot>();

  constructor(options?: CircuitBreakerOptions) {
    this.failureThreshold = options?.failureThreshold ?? 3;
    this.cooldownMs = options?.cooldownMs ?? 30_000;
    this.nowFn = options?.nowFn ?? Date.now;
    this.onTransition = options?.onTransition;
  }

  public getSnapshot(key: string): ProviderCircuitSnapshot {
    let circuit = this.circuits.get(key);
    if (!circuit) {
      circuit = {
        key,
        state: 'CLOSED',
        consecutiveFailures: 0,
        lastFailureAt: null,
        openedAt: null,
      };
      this.circuits.set(key, circuit);
    }

    // Check if OPEN cooldown has elapsed to promote to HALF_OPEN
    if (circuit.state === 'OPEN' && circuit.openedAt !== null) {
      const now = this.nowFn();
      if (now - circuit.openedAt >= this.cooldownMs) {
        const prevState = circuit.state;
        circuit.state = 'HALF_OPEN';
        logger.info({ key, cooldownMs: this.cooldownMs }, 'Circuit breaker transitioned OPEN -> HALF_OPEN (cooldown elapsed)');
        this.onTransition?.({
          alias: key,
          provider: key.split('/')[0] ?? 'litellm',
          fromState: prevState,
          toState: 'HALF_OPEN',
        });
      }
    }

    return { ...circuit };
  }

  public canAttempt(key: string): boolean {
    const snapshot = this.getSnapshot(key);
    if (snapshot.state === 'CLOSED' || snapshot.state === 'HALF_OPEN') {
      return true;
    }
    return false;
  }

  public recordSuccess(key: string): ProviderCircuitSnapshot {
    const current = this.getSnapshot(key);
    const wasHalfOpenOrOpen = current.state !== 'CLOSED';

    const updated: ProviderCircuitSnapshot = {
      key,
      state: 'CLOSED',
      consecutiveFailures: 0,
      lastFailureAt: current.lastFailureAt,
      openedAt: null,
      lastStatusCode: undefined,
    };

    this.circuits.set(key, updated);

    if (wasHalfOpenOrOpen) {
      logger.info({ key, previousState: current.state }, 'Circuit breaker recovered -> CLOSED');
      this.onTransition?.({
        alias: key,
        provider: key.split('/')[0] ?? 'litellm',
        fromState: current.state,
        toState: 'CLOSED',
      });
    }

    return { ...updated };
  }

  public recordFailure(key: string, statusCode?: number): ProviderCircuitSnapshot {
    const current = this.getSnapshot(key);
    const now = this.nowFn();
    const consecutiveFailures = current.consecutiveFailures + 1;
    let nextState: CircuitState = current.state;
    let openedAt = current.openedAt;

    if (current.state === 'HALF_OPEN') {
      // Any failure during HALF_OPEN probe trips immediately back to OPEN
      nextState = 'OPEN';
      openedAt = now;
      logger.warn({ key, statusCode }, 'Circuit probe failed in HALF_OPEN -> tripped to OPEN');
      this.onTransition?.({
        alias: key,
        provider: key.split('/')[0] ?? 'litellm',
        fromState: 'HALF_OPEN',
        toState: 'OPEN',
      });
    } else if (consecutiveFailures >= this.failureThreshold) {
      const prevState = current.state;
      nextState = 'OPEN';
      openedAt = now;
      logger.warn(
        { key, consecutiveFailures, failureThreshold: this.failureThreshold, statusCode },
        'Circuit breaker tripped: CLOSED -> OPEN'
      );
      if (prevState !== 'OPEN') {
        this.onTransition?.({
          alias: key,
          provider: key.split('/')[0] ?? 'litellm',
          fromState: prevState,
          toState: 'OPEN',
        });
      }
    }

    const updated: ProviderCircuitSnapshot = {
      key,
      state: nextState,
      consecutiveFailures,
      lastFailureAt: now,
      openedAt,
      lastStatusCode: statusCode,
    };

    this.circuits.set(key, updated);
    return { ...updated };
  }

  public reset(key?: string): void {
    if (key) {
      this.circuits.delete(key);
    } else {
      this.circuits.clear();
    }
  }
}

/**
 * Standard Transient Error Set predicate:
 * - Status codes: 429, 500, 502, 503, 504
 * - Named network/socket errors: ETIMEDOUT, UND_ERR_CONNECT_TIMEOUT, TimeoutError/AbortError, ECONNRESET, EAI_AGAIN
 * Non-transient: 400 (context overflow), 401, 403, 422, ECONNREFUSED on local providers
 */
export function isTransientError(errorOrStatus: unknown): boolean {
  if (typeof errorOrStatus === 'number') {
    return [429, 500, 502, 503, 504].includes(errorOrStatus);
  }

  if (errorOrStatus instanceof Error) {
    const code = (errorOrStatus as { code?: string }).code;
    const name = errorOrStatus.name;
    const msg = errorOrStatus.message;

    if (code && ['ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT', 'ECONNRESET', 'EAI_AGAIN'].includes(code)) {
      return true;
    }

    if (name === 'AbortError' || name === 'TimeoutError' || msg?.toLowerCase().includes('timeout')) {
      return true;
    }
  }

  return false;
}
