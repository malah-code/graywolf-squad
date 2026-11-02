import { GateType, ProjectConfig } from '../schemas/project-config';

/**
 * 6 Non-Negotiable Mandatory Human Gates, Configurable Gate Policy &
 * Solo Dev Auto-Merge-if-Green (Task 11.2, PRD §8.4, §12.2, FR-002, SC-002).
 */

export type MandatoryGateId =
  | 'blast_radius_escape'
  | 'destructive_ddl'
  | 'security_or_license_exposure'
  | 'protected_branch_target'
  | 'task_spend_ceiling_exceeded'
  | 'two_strike_review_rejection';

export interface MandatoryGateCheckInput {
  hasBlastRadiusEscape?: boolean;
  patchContent?: string;
  hasDestructiveDdl?: boolean;
  gitleaksSecretsFound?: number;
  criticalCvesFound?: number;
  copyleftLicenseDetected?: boolean;
  targetBranch: string;
  allowProtectedBranchTarget?: boolean; // false by default: target main / release/* triggers gate #4
  currentSpendUSD?: number;
  spendLimitUSD?: number;
  taskSpendExceeded?: boolean;
  consecutiveReviewStrikes?: number;
  configuredGatePolicy?: GateType;
  taskTags?: string[];
  gatePolicyByTaskTag?: Record<string, GateType>;
  topology?: 'solo' | 'team' | 'enterprise';
  autoMergeIfGreen?: boolean;
  allTestsAndGuardsGreen?: boolean;
}

export interface MandatoryGateEvaluation {
  triggered: boolean;
  triggeredGates: MandatoryGateId[];
  effectiveGatePolicy: GateType;
  canAutoMerge: boolean;
  reasons: string[];
}

const PROTECTED_BRANCH_RE = /^(main|master|release\/.*|release-[0-9].*)$/i;
const DESTRUCTIVE_DDL_RE = /\b(DROP\s+(?:TABLE|DATABASE|SCHEMA)|TRUNCATE\s+(?:TABLE\s+)?)\b/i;

export function evaluateMandatoryHumanGates(input: MandatoryGateCheckInput): MandatoryGateEvaluation {
  const triggeredGates: MandatoryGateId[] = [];
  const reasons: string[] = [];

  // Gate 1: Blast-radius scope escape
  if (input.hasBlastRadiusEscape) {
    triggeredGates.push('blast_radius_escape');
    reasons.push('Gate 1 Triggered: Blast-radius scope escape detected outside permitted writable files');
  }

  // Gate 2: Destructive DDL (DROP TABLE, TRUNCATE)
  const patchHasDestructive = input.patchContent ? DESTRUCTIVE_DDL_RE.test(input.patchContent) : false;
  if (input.hasDestructiveDdl || patchHasDestructive) {
    triggeredGates.push('destructive_ddl');
    reasons.push('Gate 2 Triggered: Destructive DDL statement (DROP TABLE / TRUNCATE) detected in patch');
  }

  // Gate 3: Security vulnerability, secret exposure or copyleft license
  const hasSecrets = (input.gitleaksSecretsFound ?? 0) > 0;
  const hasCves = (input.criticalCvesFound ?? 0) > 0;
  const hasCopyleft = Boolean(input.copyleftLicenseDetected);
  if (hasSecrets || hasCves || hasCopyleft) {
    triggeredGates.push('security_or_license_exposure');
    const parts: string[] = [];
    if (hasSecrets) parts.push(`${input.gitleaksSecretsFound} leaked secret(s) via gitleaks`);
    if (hasCves) parts.push(`${input.criticalCvesFound} critical CVE(s) via osv-scanner`);
    if (hasCopyleft) parts.push('copyleft license detected');
    reasons.push(`Gate 3 Triggered: Security/license exposure detected (${parts.join(', ')})`);
  }

  // Gate 4: Protected branch target (main, master, release/*)
  const isProtected = PROTECTED_BRANCH_RE.test(input.targetBranch.trim());
  if (isProtected && !input.allowProtectedBranchTarget) {
    triggeredGates.push('protected_branch_target');
    reasons.push(`Gate 4 Triggered: Target branch '${input.targetBranch}' is protected (requires human signoff)`);
  }

  // Gate 5: Per-task spend ceiling exceeded
  const spendHit =
    input.spendLimitUSD !== undefined &&
    input.currentSpendUSD !== undefined &&
    input.currentSpendUSD >= input.spendLimitUSD;
  if (input.taskSpendExceeded || spendHit) {
    triggeredGates.push('task_spend_ceiling_exceeded');
    reasons.push(
      `Gate 5 Triggered: Per-task spend ceiling reached ($${input.currentSpendUSD?.toFixed(2) ?? '0.00'} >= $${input.spendLimitUSD?.toFixed(2) ?? '0.00'})`
    );
  }

  // Gate 6: Two-strike internal review rejection
  if ((input.consecutiveReviewStrikes ?? 0) >= 2) {
    triggeredGates.push('two_strike_review_rejection');
    reasons.push(`Gate 6 Triggered: Two consecutive internal review rejections (${input.consecutiveReviewStrikes} strikes)`);
  }

  // Resolve baseline gate policy from task tag or default config
  let baselinePolicy: GateType = input.configuredGatePolicy ?? 'human';
  if (input.taskTags && input.gatePolicyByTaskTag) {
    for (const tag of input.taskTags) {
      if (input.gatePolicyByTaskTag[tag]) {
        baselinePolicy = input.gatePolicyByTaskTag[tag];
        break;
      }
    }
  }

  // Non-negotiable: ANY mandatory gate forces 'mandatory-human' (PRD §8.4)
  const triggered = triggeredGates.length > 0;
  const effectiveGatePolicy: GateType = triggered ? 'mandatory-human' : baselinePolicy;

  // Solo Dev Auto-Merge-if-Green rule (§12.2)
  const isSolo = (input.topology ?? (process.env.DEPLOYMENT_TOPOLOGY || 'solo')) === 'solo';
  const autoMergeEnabled = Boolean(input.autoMergeIfGreen);
  const testsAndGuardsGreen = Boolean(input.allTestsAndGuardsGreen);
  const canAutoMerge = isSolo && autoMergeEnabled && !triggered && testsAndGuardsGreen && effectiveGatePolicy === 'auto';

  return {
    triggered,
    triggeredGates,
    effectiveGatePolicy,
    canAutoMerge,
    reasons,
  };
}

export function evaluateAiPmReviewer(options: {
  taskId: string;
  mandatoryEvaluation: MandatoryGateEvaluation;
  calibratedConfidence: number;
  allGuardsPassed: boolean;
  aiReviewerConfig?: ProjectConfig['aiReviewer'];
}): {
  decision: 'approved' | 'escalated_to_human' | 'rejected';
  persona: string;
  effectiveGatePolicy: GateType;
  auditReason: string;
} {
  const persona = options.aiReviewerConfig?.persona ?? 'AI Product Lead';
  const threshold = options.aiReviewerConfig?.autoApproveThreshold ?? 0.85;
  const canEscalate = options.aiReviewerConfig?.canEscalateToHuman !== false;

  // 1. Mandatory gates non-negotiably escalate to human
  if (options.mandatoryEvaluation.triggered) {
    return {
      decision: 'escalated_to_human',
      persona,
      effectiveGatePolicy: 'mandatory-human',
      auditReason: `Mandatory human gate(s) triggered: ${options.mandatoryEvaluation.triggeredGates.join(', ')}`,
    };
  }

  // 2. Guard failures cause rejection
  if (!options.allGuardsPassed) {
    return {
      decision: 'rejected',
      persona,
      effectiveGatePolicy: options.mandatoryEvaluation.effectiveGatePolicy,
      auditReason: 'External QA guards failed — patch rejected by AI PM persona',
    };
  }

  // 3. Below confidence threshold escalates to human if escalation is allowed
  if (options.calibratedConfidence < threshold) {
    if (canEscalate) {
      return {
        decision: 'escalated_to_human',
        persona,
        effectiveGatePolicy: 'human',
        auditReason: `Calibrated confidence (${options.calibratedConfidence.toFixed(2)}) is below auto-approval threshold (${threshold.toFixed(2)}) — escalated to human`,
      };
    }
    return {
      decision: 'rejected',
      persona,
      effectiveGatePolicy: options.mandatoryEvaluation.effectiveGatePolicy,
      auditReason: `Calibrated confidence (${options.calibratedConfidence.toFixed(2)}) is below auto-approval threshold (${threshold.toFixed(2)}) without human escalation`,
    };
  }

  return {
    decision: 'approved',
    persona,
    effectiveGatePolicy: 'auto',
    auditReason: `All guards green and calibrated confidence (${options.calibratedConfidence.toFixed(2)}) meets or exceeds threshold (${threshold.toFixed(2)}) — approved by AI PM`,
  };
}
