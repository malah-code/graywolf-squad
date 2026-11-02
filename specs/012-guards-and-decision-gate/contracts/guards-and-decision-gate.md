# Module Contracts: Reactive Quality Guards, Passive Evidence Ledger & System-One DecisionGate

**Feature**: `012-guards-and-decision-gate`  
**Phase**: Phase 10

## 1. Passive Verification Evidence Ledger (`src/orchestrator/guards/evidence-ledger.ts`)

```typescript
export type EvidenceCommandType = 'test' | 'lint' | 'typecheck' | 'build' | 'browser-test';

export interface VerificationEvidenceInput {
  taskId: string;
  workspaceId: string;
  orgId?: string;
  commandType: EvidenceCommandType;
  command: string;
  exitCode: number;
  durationMs: number;
  stdoutSummary?: string;
  stderrSummary?: string;
}

export interface VerificationEvidenceEntry extends VerificationEvidenceInput {
  id: string;
  createdAt: string;
}

export class EvidenceLedger {
  constructor(options?: { dbRunner?: typeof withTenantContext });

  public recordExecution(
    worktreePath: string,
    input: VerificationEvidenceInput
  ): Promise<VerificationEvidenceEntry>;

  public readWorktreeEvidence(worktreePath: string): Promise<VerificationEvidenceEntry[]>;

  public hasPassingTestExecution(worktreePath: string): Promise<boolean>;
}
```

---

## 2. Deterministic Clean-Code, Test & Doc Guards (`src/orchestrator/guards/*`)

```typescript
export interface GuardCheckViolation {
  rule: string;
  filePath?: string;
  line?: number;
  message: string;
}

export interface SingleGuardResult {
  guard: 'clean-code' | 'test' | 'doc';
  passed: boolean;
  checks: Array<{ label: string; passed: boolean }>;
  violations: GuardCheckViolation[];
}

// 2.1 clean-code-guard.ts (ADR-083 & F14)
export function evaluateCleanCodeGuard(options: {
  patchContent: string;
  allowedDependencies?: string[]; // Sourced strictly from orchestrator-side recon-report.json (F14)
}): SingleGuardResult;

// 2.2 test-guard.ts (ADR-083 & ADR-062)
export function evaluateTestGuard(options: {
  patchContent: string;
  evidenceEntries: VerificationEvidenceEntry[];
  allowedExternalMocks?: string[];
}): SingleGuardResult;

// 2.3 doc-guard.ts (ADR-083) & Verification Orchestrator
export function evaluateDocGuard(options: {
  patchContent: string;
  prDescription?: string;
  documentedEnvKeys?: string[];
  exportedSymbols?: string[];
}): SingleGuardResult;

export function runReactiveGuardSuite(options: {
  taskId: string;
  currentStatus: TaskStatus;
  qaAttempts: number;
  qaMaxRetries?: number; // default: 3
  patchContent: string;
  evidenceEntries: VerificationEvidenceEntry[];
  allowedDependencies?: string[];
  prDescription?: string;
  documentedEnvKeys?: string[];
  exportedSymbols?: string[];
  writeReportToPath?: string; // optional path to write verification.md
}): Promise<{
  overallVerdict: 'PASS' | 'FAIL';
  cleanCode: SingleGuardResult;
  testGuard: SingleGuardResult;
  docGuard: SingleGuardResult;
  nextStatus: 'HUMAN_REVIEW_GATE' | 'QA_FIXING' | 'VERIFICATION_FAILED';
  nextQaAttempts: number;
  verificationMarkdown: string;
}>;
```

---

## 3. System-One `DecisionGate` Service (`src/orchestrator/decision-gate/service.ts`)

```typescript
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

export class DecisionGateService {
  constructor(options?: {
    dbRunner?: typeof withTenantContext;
    classifierFn?: (gate: DecisionGateName, payload: unknown) => Promise<{
      decision: unknown;
      confidence: number;
      modelBackend?: string;
    }>;
  });

  // Gate 1: sandbox_tier (threshold >= 0.85, fallback -> 'tier-2-isolated-db')
  public evaluateSandboxTier(input: {
    taskId: string;
    workspaceId: string;
    orgId?: string;
    briefMarkdown: string;
    targetFiles: string[];
  }): Promise<DecisionGateEvaluationResult<'tier-0-mock' | 'tier-1-shared-db' | 'tier-2-isolated-db'>>;

  // Gate 2: gate_policy (threshold >= 0.90; low + green tests -> 'auto'; high/critical/fallback -> 'mandatory-human')
  public evaluateGatePolicy(input: {
    taskId: string;
    workspaceId: string;
    orgId?: string;
    patchRisk: 'low' | 'medium' | 'high' | 'critical';
    touchesSensitiveFiles: boolean;
    allTestsGreen: boolean;
  }): Promise<DecisionGateEvaluationResult<'auto' | 'ai-pm' | 'human' | 'mandatory-human'>>;

  // Gate 3: relay_tool (threshold >= 0.90; destructive commands blocked immediately)
  public evaluateRelayTool(input: {
    taskId: string;
    workspaceId: string;
    orgId?: string;
    command: string;
  }): Promise<DecisionGateEvaluationResult<{
    allowed: boolean;
    risk: 'low' | 'medium' | 'high' | 'critical';
    reason: string;
  }>>;

  // Gate 4: two_strike_prescreen (Strike 1 + confidence >= 0.90 -> 'fast_rework'; Strike 2 or fallback -> 'full_3_pass_debate')
  public evaluateTwoStrikePrescreen(input: {
    taskId: string;
    workspaceId: string;
    orgId?: string;
    strikeNumber: 1 | 2;
    hasDeterministicFailure: boolean;
    failureSummary: string;
  }): Promise<DecisionGateEvaluationResult<{
    route: 'fast_rework' | 'full_3_pass_debate';
    reason: string;
  }>>;
}
```
