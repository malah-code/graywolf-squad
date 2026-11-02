# Module & CLI Contracts: Continuous Learning Engine, Stall Guardrails & Context Compression

**Feature**: `016-continuous-learning-engine` (Phase 14)  
**Date**: 2026-11-01

---

## 1. Reflection Worker & Human Gate Diff Learner (`src/orchestrator/learning/reflection-worker.ts`, `src/orchestrator/learning/human-gate-diff.ts`)

```typescript
export interface ReflectionTaskInput {
  orgId: string;
  workspaceId: string;
  projectId: string;
  taskId: string;
  terminalStatus: 'MERGED' | 'FAILED' | 'VERIFICATION_FAILED' | 'HUMAN_REVIEW_GATE';
  briefGoal: string;
  touchedFiles: string[];
  taskTags?: string[];
  memoryObservation?: {
    summary: string;
    ruleContent: string;
    category?: LessonCategory;
  };
  candidateSkill?: SkillDocumentInput;
  guardOrDebateFailures?: Array<{
    source: 'test-guard' | 'clean-code-guard' | 'doc-guard' | 'adversarial-debate';
    category: 'LLM_CODE_SMELL' | 'TEST_INTEGRITY';
    summary: string;
    negativeConstraint: string;
  }>;
}

export function validateHermesSkillDocument(input: SkillDocumentInput): {
  valid: boolean;
  violations: string[];
};

export function runTaskReflection(
  input: ReflectionTaskInput,
  options?: { skillsRootDir?: string; dbPool?: Pool }
): Promise<{
  memoryLessonsStored: ProjectLessonRecord[];
  antiPatternsStored: ProjectLessonRecord[];
  skillAuthoredPath: string | null;
  skillRejectedReasons: string[];
}>;

export function retrieveLessonsForPlan(input: {
  queryText: string;
  queryEmbedding?: number[];
  candidates: ProjectLessonRecord[];
  minSimilarity?: number; // default: 0.75
  maxLessons?: number;    // default: 5
  maxAntiPatterns?: number; // default: 3
}): {
  lessons: Array<ProjectLessonRecord & { similarity: number }>;
  antiPatterns: Array<ProjectLessonRecord & { similarity: number }>;
};

export function learnFromHumanGateDiff(input: {
  orgId: string;
  workspaceId: string;
  projectId: string;
  taskId: string;
  agentPatch: string;
  finalMergedPatch: string;
  touchedFiles: string[];
  reviewerNotes?: string;
}): Promise<ProjectLessonRecord | null>;
```

---

## 2. Weekly Skill Curator (`src/orchestrator/learning/skill-curator.ts`)

```typescript
export interface SkillCuratorRunOptions {
  skillsRootDir: string;
  now?: Date;
  consolidate?: boolean; // curator.consolidate = true
  operatorApprovedDeletionIds?: string[];
}

export function runWeeklySkillCurator(
  options: SkillCuratorRunOptions
): Promise<{
  transitionedToStale: string[];
  transitionedToArchived: string[];
  markedPendingDeletion: string[];
  permanentlyDeleted: string[];
  skippedProtected: string[];
  consolidationProposalPath: string | null;
  overlappingPairs: Array<{ skillA: string; skillB: string; jaccardSimilarity: number }>;
}>;
```

---

## 3. Stall Detection Guardrails & Terminal Status Protocol (`src/orchestrator/learning/stall-detector.ts`, `src/orchestrator/learning/status-protocol.ts`)

```typescript
export function normalizeVolatileOutput(raw: string): string;

export class StallDetector {
  constructor(options?: {
    failureWarnThreshold?: number;     // default: 3
    failureInterruptThreshold?: number; // default: 5
    cycleWarnLaps?: number;            // default: 3
    cycleInterruptLaps?: number;       // default: 5
    maxCyclePeriod?: number;           // default: 4
    perTurnCommandCap?: number;        // default: 50
    identicalActionObsCap?: number;    // default: 4
    identicalDiffCap?: number;         // default: 3
  });

  public recordCommandExecution(input: {
    taskId: string;
    turnIndex: number;
    command: string;
    args?: string[];
    exitCode: number;
    stdoutStderr: string;
  }): StallCheckResult;

  public recordDiffSnapshot(input: {
    taskId: string;
    diffPatch: string;
  }): StallCheckResult;
}

export function verifyTerminalStatusProtocol(input: {
  taskId: string;
  worktreeDir: string;
  exitCode: number;
  previousNudges: number;
}): Promise<StatusProtocolOutcome>;
```

---

## 4. 80% Context Compressor, Prompt Compiler & Trajectory Exporter (`src/orchestrator/learning/compression.ts`, `scripts/prompts-compile.ts`, `src/orchestrator/learning/trajectory-export.ts`)

```typescript
export function compressConversationContext(input: {
  systemPrompt: string;
  taskBrief: string;
  turns: ConversationTurn[];
  contextWindowTokens: number;
  thresholdRatio?: number; // default: 0.80
  forceCompact?: boolean;  // CompactContextButton trigger
  auxiliarySummarizer?: (middleTurns: ConversationTurn[]) => Promise<string>;
}): Promise<CompressedContextResult>;

export function compilePromptVariants(input: {
  alias: string;
  variants: PromptVariantCandidate[];
  outputDir?: string; // default: 'prompts/compiled'
}): Promise<CompiledPromptArtifact>;

export function exportFineTuningTrajectory(input: {
  taskId: string;
  modelAlias: string;
  datasetCollectEnabled: boolean; // dataset.collect (default: false)
  strikes: number;
  agreedHighSeverityFindings: number;
  systemPrompt: string;
  taskBrief: string;
  turns: ConversationTurn[];
  sensitiveIdentifiers?: string[]; // workspace/org/project names -> <REDACTED_PROJECT>
  outputBaseDir?: string;          // default: '.agents/dataset/trajectories'
  now?: Date;
}): Promise<{
  exported: boolean;
  filePath: string | null;
  entry: TrajectoryJsonlEntry | null;
  reason?: string;
}>;
```

