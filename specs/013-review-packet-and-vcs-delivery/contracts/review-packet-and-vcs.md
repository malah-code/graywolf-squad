# Module Contracts: Configurable Gate Policy, 60-Second Review Packet & `repo-sdk` PR Delivery

**Feature**: `013-review-packet-and-vcs-delivery`  
**Phase**: Phase 11

## 1. Provider-Agnostic Git & VCS Abstraction (`src/orchestrator/delivery/repo-sdk.ts`)

```typescript
export type VcsProviderType = 'github' | 'gitlab' | 'bitbucket' | 'azure' | 'gitea';

export interface PullRequestRecord {
  prNumber: number;
  url: string;
  provider: VcsProviderType;
  repoUrl: string;
  sourceBranch: string;
  targetBranch: string;
  title: string;
  bodyMarkdown: string;
  status: 'open' | 'merged' | 'closed';
}

export interface VcsProviderAdapter {
  cloneRepo(options: { repoUrl: string; targetDir: string; credential?: string }): Promise<{ clonedTo: string }>;
  pushTaskBranch(options: { repoUrl: string; branch: string; commitSha: string; credential?: string }): Promise<{ pushed: boolean; branch: string; commitSha: string }>;
  createOrUpdatePullRequest(options: {
    repoUrl: string;
    sourceBranch: string;
    targetBranch: string;
    title: string;
    bodyMarkdown: string;
    existingPrNumber?: number;
    credential?: string;
  }): Promise<PullRequestRecord>;
  postPullRequestComment(options: {
    repoUrl: string;
    prNumber: number;
    bodyMarkdown: string;
    credential?: string;
  }): Promise<{ commentId: string; prNumber: number }>;
  mergePullRequest(options: {
    repoUrl: string;
    prNumber: number;
    mergeMethod?: 'squash' | 'merge' | 'rebase';
    credential?: string;
  }): Promise<{ merged: boolean; prNumber: number; mergeCommitSha: string }>;
  registerWebhook(options: {
    repoUrl: string;
    webhookUrl: string;
    events: string[];
    secret?: string;
    credential?: string;
  }): Promise<{ webhookId: string; active: boolean }>;
}

export class RepoSdkClient {
  constructor(options: {
    provider: VcsProviderType;
    repoUrl: string;
    credential?: string;
    adapter?: Partial<VcsProviderAdapter>;
  });

  public cloneRepo(targetDir: string): Promise<{ clonedTo: string }>;
  public pushTaskBranch(branch: string, commitSha: string): Promise<{ pushed: boolean; branch: string; commitSha: string }>;
  public createOrUpdatePullRequest(input: {
    sourceBranch: string;
    targetBranch: string;
    title: string;
    bodyMarkdown: string;
    existingPrNumber?: number;
  }): Promise<PullRequestRecord>;
  public postPullRequestComment(prNumber: number, bodyMarkdown: string): Promise<{ commentId: string; prNumber: number }>;
  public mergePullRequest(prNumber: number, mergeMethod?: 'squash' | 'merge' | 'rebase'): Promise<{ merged: boolean; prNumber: number; mergeCommitSha: string }>;
  public registerWebhook(webhookUrl: string, events?: string[], secret?: string): Promise<{ webhookId: string; active: boolean }>;
}
```

---

## 2. 6 Non-Negotiable Mandatory Human Gates & Gate Policy (`src/orchestrator/delivery/mandatory-gates.ts`)

```typescript
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
  allowProtectedBranchTarget?: boolean; // false by default: merging into main / release/* triggers gate #4
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

export function evaluateMandatoryHumanGates(input: MandatoryGateCheckInput): MandatoryGateEvaluation;

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
};
```

---

## 3. Confidence Calibration & 60-Second Executive Review Packet (`src/orchestrator/delivery/{confidence-calibration,review-packet}.ts`)

```typescript
// 3.1 confidence-calibration.ts
export interface CalibrationSample {
  confidenceScore: number; // 0.00 - 1.00
  wasAccepted: boolean;    // true if merged without defect/rework, false if rejected
  ageDays: number;         // age of sample in days for 90-day half-life decay
}

export interface CalibrationResult {
  rawConfidence: number;
  calibratedConfidence: number;
  delta: number;
  sampleCount: number;
  isCalibrated: boolean;
}

export function computeCalibratedConfidence(
  rawConfidence: number,
  samples: CalibrationSample[],
  options?: { minSamples?: number; maxDelta?: number; halfLifeDays?: number }
): CalibrationResult;

export class ConfidenceCalibrator {
  constructor(options?: { dbRunner?: typeof withTenantContext });

  public recordCalibrationSample(input: {
    taskId: string;
    workspaceId: string;
    userId?: string;
    modelId: string;
    modelVersion: string;
    filePath: string;
    fileLanguage?: string;
    fileType: string;
    confidenceScore: number;
    wasAccepted: boolean;
    justification?: string;
  }): Promise<{ id: string }>;

  public calibrateForModelAndFileType(input: {
    workspaceId: string;
    modelId: string;
    modelVersion: string;
    fileType: string;
    rawConfidence: number;
  }): Promise<CalibrationResult>;
}

// 3.2 review-packet.ts
export type ModelDataResidencyTier =
  | 'tier-1-local-only'
  | 'tier-2-zero-retention-cloud'
  | 'tier-3-standard-commercial-api';

export interface ExecutiveReviewPacketInput {
  taskId: string;
  title: string;
  executiveSummary: string;
  decisionGateRisk: 'low' | 'medium' | 'high' | 'critical';
  providersUsed: string[]; // used to derive ModelDataResidencyTier if not explicitly passed
  dataResidencyTier?: ModelDataResidencyTier;
  calibration: CalibrationResult;
  guardCompliance: {
    cleanCodePassed: boolean;
    testGuardPassed: boolean;
    docGuardPassed: boolean;
    inContainerReviewPassed: boolean;
  };
  dualAxisMatrix: {
    standardsAxisSummary: string;
    specAxisSummary: string;
    agreedP2Advisories?: string[];
  };
  docsGuardVerifiedSymbols: string[];
  browserSmokeFindings?: Array<{ route: string; status: 'pass' | 'fail'; note: string }>;
  visualProofArtifacts?: Array<{ label: string; pathOrUrl: string; mode: 'cached' | 'live' }>;
  semanticDiffSummary: string[];
  scopedFileDiffs: Array<{ filePath: string; scope: 'writable' | 'readonly'; additions: number; deletions: number }>;
}

export function resolveDataResidencyTier(providersUsed: string[]): ModelDataResidencyTier;
export function buildExecutiveReviewPacket(input: ExecutiveReviewPacketInput): {
  residencyTier: ModelDataResidencyTier;
  markdown: string;
};
```

---

## 4. PR Review Comment Webhook Loop & External PM Sync (`src/orchestrator/routes/webhooks-vcs.ts`, `src/orchestrator/delivery/pm-sync.ts`)

```typescript
// 4.1 webhooks-vcs.ts
export interface InboundPrReviewComment {
  provider: VcsProviderType;
  taskId: string;
  prNumber: number;
  author: string;
  body: string;
  filePath?: string;
  line?: number;
}

export class VcsWebhookDebouncer {
  constructor(options: {
    debounceMs?: number;
    onFlush: (batch: {
      taskId: string;
      prNumber: number;
      provider: VcsProviderType;
      comments: InboundPrReviewComment[];
    }) => Promise<void>;
  });

  public enqueue(comment: InboundPrReviewComment): void;
  public flushNow(taskId?: string): Promise<void>;
}

// 4.2 pm-sync.ts
export type ExternalPmProvider = 'github' | 'gitlab' | 'jira' | 'linear';

export interface ExternalIssueState {
  externalId: string;
  provider: ExternalPmProvider;
  statusLabel: string;
  labels: string[];
  assignees: string[];
}

export class PmSyncService {
  public reconcileState(options: {
    taskId: string;
    graywolfStatus: TaskStatus;
    externalIssue: ExternalIssueState;
    incomingExternalUpdate?: {
      attemptedStatusOverride?: string;
      labels?: string[];
      assignees?: string[];
    };
  }): {
    authoritativeGraywolfStatus: TaskStatus;
    syncedExternalStatusLabel: string;
    authoritativeLabels: string[];
    authoritativeAssignees: string[];
  };
}
```
