import * as crypto from 'node:crypto';

import { withTenantContext } from '../db';

/**
 * System-One DecisionGate Service (Task 10.3, ADR-079, FR-006).
 *
 * Gates 1–4 (`sandbox_tier`, `gate_policy`, `relay_tool`,
 * `two_strike_prescreen`) evaluate in `< 150ms` via a pluggable local
 * classifier. Confidence floors: `>= 0.85` for Gates 1/4, `>= 0.90` for
 * Gates 2/3. Below the floor, or when the backend is unreachable, the gate
 * fail-closes with `GATE_LOW_CONFIDENCE_FALLBACK` to the safe conservative
 * default. Every decision persists to PostgreSQL `task_gate_decisions`
 * inside `withTenantContext` (SC-003).
 */

export type DecisionGateName =
  | 'sandbox_tier'
  | 'gate_policy'
  | 'relay_tool'
  | 'two_strike_prescreen';

export interface DecisionGateEvaluationResult<T> {
  id: string;
  taskId: string;
  workspaceId: string;
  gate: DecisionGateName;
  decision: T;
  confidence: number;
  latencyMs: number;
  modelBackend: string;
  usedFallback: boolean;
  fallbackCode?: 'GATE_LOW_CONFIDENCE_FALLBACK';
}

export interface ClassifierResponse {
  decision: unknown;
  confidence: number;
  modelBackend?: string;
}

export type GateClassifierFn = (
  gate: DecisionGateName,
  payload: unknown
) => Promise<ClassifierResponse>;

export type GateDbRunner = typeof withTenantContext;

const CONFIDENCE_FLOORS: Readonly<Record<DecisionGateName, number>> = Object.freeze({
  sandbox_tier: 0.85,
  gate_policy: 0.9,
  relay_tool: 0.9,
  two_strike_prescreen: 0.85,
});

const LOCAL_BACKEND = 'system-one-local';
const FALLBACK_BACKEND = 'frontier-fallback';

/** Destructive / exfiltration relay-tool patterns (ADR-079 Gate 3). */
const DESTRUCTIVE_COMMAND_PATTERNS: ReadonlyArray<{ pattern: RegExp; label: string }> = Object.freeze([
  { pattern: /rm\s+(?:-[a-z]*[rf][a-z]*\s+)+(\/|\/\*|~|\*)(?:\s|$)/i, label: 'rm -rf on root or wildcard' },
  { pattern: /rm\s+-[rf]+\s+(?:\*|~|\/\*)/i, label: 'rm -rf wildcard target' },
  { pattern: /\bDROP\s+(?:TABLE|DATABASE|SCHEMA)\b/i, label: 'DROP TABLE/DATABASE statement' },
  { pattern: /\bTRUNCATE\s+(?:TABLE\s+)?/i, label: 'TRUNCATE statement' },
  {
    pattern:
      /(?:curl|wget|nc|ncat|netcat)\b.*(?:\.env\b|process\.env|secret|token|api[_-]?key|credential)|(?:\.env\b|process\.env|secret|token|api[_-]?key|credential).*(?:curl|wget|nc|ncat|netcat)\b/i,
    label: 'network secret exfiltration attempt',
  },
  { pattern: /\bmkfs(?:\.[a-z0-9]+)?\b/i, label: 'mkfs filesystem destroy' },
  { pattern: /dd\s+[^|;&]*of=\/dev\//i, label: 'dd write to raw device' },
  { pattern: /chmod\s+-R\s+777\s+\/(?:\s|$)/, label: 'chmod -R 777 on root' },
]);

function isDestructiveCommand(command: string): { matched: boolean; label?: string } {
  for (const { pattern, label } of DESTRUCTIVE_COMMAND_PATTERNS) {
    if (pattern.test(command)) return { matched: true, label };
  }
  return { matched: false };
}

function defaultDeterministicClassifier(
  gate: DecisionGateName,
  payload: unknown
): Promise<ClassifierResponse> {
  const input = payload as Record<string, unknown>;
  switch (gate) {
    case 'sandbox_tier': {
      const brief = String(input.briefMarkdown ?? '').toLowerCase();
      const targets = (Array.isArray(input.targetFiles) ? input.targetFiles : []) as string[];
      const targetText = targets.join(' ').toLowerCase();
      const isTestOnly = targets.length > 0 && targets.every((file) => /\.(test|spec)\.[cm]?[jt]sx?$/.test(file));
      let decision: 'tier-0-mock' | 'tier-1-shared-db' | 'tier-2-isolated-db';
      if (isTestOnly || brief.includes('mock')) decision = 'tier-0-mock';
      else if (/migrations?\/|schema|isolated|destructive/.test(`${brief} ${targetText}`)) decision = 'tier-2-isolated-db';
      else decision = 'tier-1-shared-db';
      return Promise.resolve({ decision, confidence: 0.9, modelBackend: LOCAL_BACKEND });
    }
    case 'gate_policy': {
      const risk = String(input.patchRisk ?? 'medium');
      const touchesSensitive = Boolean(input.touchesSensitiveFiles);
      const allTestsGreen = Boolean(input.allTestsGreen);
      let decision: 'auto' | 'ai-pm' | 'human' | 'mandatory-human';
      if (risk === 'high' || risk === 'critical' || touchesSensitive) decision = 'mandatory-human';
      else if (risk === 'low' && allTestsGreen) decision = 'auto';
      else if (risk === 'low') decision = 'human';
      else decision = 'ai-pm';
      return Promise.resolve({ decision, confidence: 0.95, modelBackend: LOCAL_BACKEND });
    }
    case 'relay_tool': {
      const command = String(input.command ?? '');
      const destructive = isDestructiveCommand(command);
      if (destructive.matched) {
        return Promise.resolve({
          decision: { allowed: false, risk: 'critical', reason: `Blocked destructive pattern: ${destructive.label}` },
          confidence: 0.95,
          modelBackend: LOCAL_BACKEND,
        });
      }
      return Promise.resolve({
        decision: { allowed: true, risk: 'low', reason: 'No destructive or exfiltration pattern detected' },
        confidence: 0.95,
        modelBackend: LOCAL_BACKEND,
      });
    }
    case 'two_strike_prescreen': {
      const strikeNumber = input.strikeNumber === 2 ? 2 : 1;
      const hasDeterministicFailure = Boolean(input.hasDeterministicFailure);
      if (strikeNumber === 2) {
        return Promise.resolve({
          decision: {
            route: 'full_3_pass_debate',
            reason: 'Strike 2 always requires the full ADR-056 3-pass adversarial debate',
          },
          confidence: 0.95,
          modelBackend: LOCAL_BACKEND,
        });
      }
      if (hasDeterministicFailure) {
        return Promise.resolve({
          decision: {
            route: 'fast_rework',
            reason: 'Strike 1 with deterministic guard failure — accelerated rework brief',
          },
          confidence: 0.92,
          modelBackend: LOCAL_BACKEND,
        });
      }
      return Promise.resolve({
        decision: {
          route: 'full_3_pass_debate',
          reason: 'Strike 1 without deterministic failure evidence — full debate retained',
        },
        confidence: 0.87,
        modelBackend: LOCAL_BACKEND,
      });
    }
  }
}

export interface SandboxTierInput {
  taskId: string;
  workspaceId: string;
  orgId?: string;
  briefMarkdown: string;
  targetFiles: string[];
}

export interface GatePolicyInput {
  taskId: string;
  workspaceId: string;
  orgId?: string;
  patchRisk: 'low' | 'medium' | 'high' | 'critical';
  touchesSensitiveFiles: boolean;
  allTestsGreen: boolean;
}

export interface RelayToolInput {
  taskId: string;
  workspaceId: string;
  orgId?: string;
  command: string;
}

export interface TwoStrikePrescreenInput {
  taskId: string;
  workspaceId: string;
  orgId?: string;
  strikeNumber: 1 | 2;
  hasDeterministicFailure: boolean;
  failureSummary: string;
}

export class DecisionGateService {
  private readonly dbRunner: GateDbRunner;
  private readonly classifierFn: GateClassifierFn;

  constructor(options?: { dbRunner?: GateDbRunner; classifierFn?: GateClassifierFn }) {
    this.dbRunner = options?.dbRunner ?? withTenantContext;
    this.classifierFn = options?.classifierFn ?? defaultDeterministicClassifier;
  }

  private async persistGateDecision(input: {
    taskId: string;
    workspaceId: string;
    orgId?: string;
    gate: DecisionGateName;
    question: string;
    result: unknown;
    confidence: number;
    latencyMs: number;
    modelBackend: string;
  }): Promise<void> {
    await this.dbRunner(
      { workspaceId: input.workspaceId, orgId: input.orgId },
      async (client) => {
        await client.query(
          `INSERT INTO task_gate_decisions
             (task_id, workspace_id, gate, question, result, confidence, latency_ms, model_backend)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            input.taskId,
            input.workspaceId,
            input.gate,
            input.question,
            JSON.stringify(input.result),
            Number(input.confidence.toFixed(3)),
            input.latencyMs,
            input.modelBackend,
          ]
        );
      }
    );
  }

  private async evaluateGate<T>(options: {
    gate: DecisionGateName;
    taskId: string;
    workspaceId: string;
    orgId?: string;
    payload: Record<string, unknown>;
    fallbackDecision: () => T;
    forceDecision?: (classifierDecision: unknown, confidence: number) => T | undefined;
  }): Promise<DecisionGateEvaluationResult<T>> {
    const { gate, taskId, workspaceId, orgId, payload, fallbackDecision, forceDecision } = options;
    const startedAt = Date.now();

    let decision: T;
    let confidence: number;
    let modelBackend: string;
    let usedFallback = false;
    let fallbackCode: 'GATE_LOW_CONFIDENCE_FALLBACK' | undefined;

    try {
      const classified = await this.classifierFn(gate, payload);
      confidence = classified.confidence;
      if (classified.confidence < CONFIDENCE_FLOORS[gate]) {
        // Fail-closed: below the gate's confidence floor (ADR-079)
        usedFallback = true;
        fallbackCode = 'GATE_LOW_CONFIDENCE_FALLBACK';
        decision = fallbackDecision();
        modelBackend = FALLBACK_BACKEND;
      } else {
        modelBackend = classified.modelBackend ?? LOCAL_BACKEND;
        const forced = forceDecision?.(classified.decision, classified.confidence);
        decision = forced !== undefined ? forced : (classified.decision as T);
      }
    } catch {
      // Backend unavailable — safe conservative fallback (ADR-079)
      usedFallback = true;
      fallbackCode = 'GATE_LOW_CONFIDENCE_FALLBACK';
      decision = fallbackDecision();
      confidence = 0;
      modelBackend = FALLBACK_BACKEND;
    }

    const latencyMs = Math.max(0, Date.now() - startedAt);

    await this.persistGateDecision({
      taskId,
      workspaceId,
      orgId,
      gate,
      question: JSON.stringify(payload),
      result: { decision, usedFallback, fallbackCode: fallbackCode ?? null },
      confidence,
      latencyMs,
      modelBackend,
    });

    return {
      id: crypto.randomUUID(),
      taskId,
      workspaceId,
      gate,
      decision,
      confidence,
      latencyMs,
      modelBackend,
      usedFallback,
      fallbackCode,
    };
  }

  /** Gate 1: sandbox_tier (floor >= 0.85; fallback -> 'tier-2-isolated-db'). */
  public evaluateSandboxTier(
    input: SandboxTierInput
  ): Promise<DecisionGateEvaluationResult<'tier-0-mock' | 'tier-1-shared-db' | 'tier-2-isolated-db'>> {
    const { taskId, workspaceId, orgId, briefMarkdown, targetFiles } = input;
    return this.evaluateGate<'tier-0-mock' | 'tier-1-shared-db' | 'tier-2-isolated-db'>({
      gate: 'sandbox_tier',
      taskId,
      workspaceId,
      orgId,
      payload: { briefMarkdown, targetFiles },
      fallbackDecision: () => 'tier-2-isolated-db',
    });
  }

  /**
   * Gate 2: gate_policy (floor >= 0.90; low + green tests -> 'auto',
   * high/critical or sensitive touches -> 'mandatory-human',
   * fallback -> 'mandatory-human' for high/critical else 'human').
   */
  public evaluateGatePolicy(
    input: GatePolicyInput
  ): Promise<DecisionGateEvaluationResult<'auto' | 'ai-pm' | 'human' | 'mandatory-human'>> {
    const { taskId, workspaceId, orgId, patchRisk, touchesSensitiveFiles, allTestsGreen } = input;
    return this.evaluateGate<'auto' | 'ai-pm' | 'human' | 'mandatory-human'>({
      gate: 'gate_policy',
      taskId,
      workspaceId,
      orgId,
      payload: { patchRisk, touchesSensitiveFiles, allTestsGreen },
      fallbackDecision: () => (patchRisk === 'high' || patchRisk === 'critical' ? 'mandatory-human' : 'human'),
    });
  }

  /** Gate 3: relay_tool (floor >= 0.90; destructive commands blocked immediately). */
  public async evaluateRelayTool(input: RelayToolInput): Promise<
    DecisionGateEvaluationResult<{
      allowed: boolean;
      risk: 'low' | 'medium' | 'high' | 'critical';
      reason: string;
    }>
  > {
    const { taskId, workspaceId, orgId, command } = input;

    // Hard pre-screen: destructive / exfiltration patterns are blocked
    // immediately, regardless of classifier confidence (FR-006, US3/AC3).
    const destructive = isDestructiveCommand(command);
    if (destructive.matched) {
      const startedAt = Date.now();
      const decision = {
        allowed: false,
        risk: 'critical' as const,
        reason: `Blocked destructive pattern: ${destructive.label}`,
      };
      const result: DecisionGateEvaluationResult<typeof decision> = {
        id: crypto.randomUUID(),
        taskId,
        workspaceId,
        gate: 'relay_tool',
        decision,
        confidence: 1,
        latencyMs: Math.max(0, Date.now() - startedAt),
        modelBackend: 'deterministic-pattern-guard',
        usedFallback: false,
      };
      await this.persistGateDecision({
        taskId,
        workspaceId,
        orgId,
        gate: 'relay_tool',
        question: JSON.stringify({ command }),
        result: { decision, usedFallback: false, fallbackCode: null },
        confidence: 1,
        latencyMs: result.latencyMs,
        modelBackend: result.modelBackend,
      });
      return result;
    }

    return this.evaluateGate<{
      allowed: boolean;
      risk: 'low' | 'medium' | 'high' | 'critical';
      reason: string;
    }>({
      gate: 'relay_tool',
      taskId,
      workspaceId,
      orgId,
      payload: { command },
      fallbackDecision: () => ({
        allowed: false,
        risk: 'medium',
        reason: 'GATE_LOW_CONFIDENCE_FALLBACK: escalate_frontier',
      }),
    });
  }

  /**
   * Gate 4: two_strike_prescreen (floor >= 0.85; Strike 1 + deterministic
   * failure + confidence >= 0.90 -> 'fast_rework'; Strike 2 ALWAYS
   * 'full_3_pass_debate' — never bypassable, even at confidence 0.99).
   */
  public evaluateTwoStrikePrescreen(input: TwoStrikePrescreenInput): Promise<
    DecisionGateEvaluationResult<{
      route: 'fast_rework' | 'full_3_pass_debate';
      reason: string;
    }>
  > {
    const { taskId, workspaceId, orgId, strikeNumber, hasDeterministicFailure, failureSummary } = input;
    return this.evaluateGate<{
      route: 'fast_rework' | 'full_3_pass_debate';
      reason: string;
    }>({
      gate: 'two_strike_prescreen',
      taskId,
      workspaceId,
      orgId,
      payload: { strikeNumber, hasDeterministicFailure, failureSummary },
      fallbackDecision: () => ({
        route: 'full_3_pass_debate',
        reason: 'GATE_LOW_CONFIDENCE_FALLBACK: full 3-pass adversarial debate retained',
      }),
      // ADR-079 invariants: Strike 2 never skips the 3-pass debate, and the
      // accelerated fast_rework brief additionally requires confidence >= 0.90
      forceDecision: (classifierDecision, confidence) => {
        const proposedRoute = (classifierDecision as { route?: string })?.route;
        if (strikeNumber === 2) {
          return {
            route: 'full_3_pass_debate',
            reason: `Strike 2 mandatory 3-pass adversarial debate (classifier proposed ${proposedRoute ?? 'unknown'})`,
          };
        }
        if (proposedRoute === 'fast_rework' && confidence < 0.9) {
          return {
            route: 'full_3_pass_debate',
            reason: `Strike 1 fast_rework requires confidence >= 0.90 (classifier reported ${confidence.toFixed(3)})`,
          };
        }
        return undefined;
      },
    });
  }
}
