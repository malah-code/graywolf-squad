# Data Model: Trajectory Compression Harvester, Privacy Redactor & Local SFT Dataset Pipeline (`020-trajectory-compression-and-dataset`)

**Date**: 2026-11-01  
**Spec**: [spec.md](file:///home/tarikelmallah/Projects/GraywolfSquad/specs/020-trajectory-compression-and-dataset/spec.md)

---

## 1. Trajectory Turn & Candidate Task Trajectory (`src/orchestrator/learning/trajectory-harvester.ts`)

```typescript
export interface TrajectoryToolCall {
  id: string;
  name: string;
  arguments: string;
}

export interface TrajectoryTurn {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  toolCalls?: TrajectoryToolCall[];
  toolCallId?: string;
  toolNames?: string[];
  turnIndex?: number;
}

export interface DatasetCollectionConfig {
  collect: boolean;
  protectTailTurns?: number; // default: 4
  retentionMonths?: number;  // default: 12
  workspaceRoot?: string;
  sensitiveIdentifiers?: string[];
}

export interface CandidateTaskTrajectory {
  taskId: string;
  projectId: string;
  workspaceId: string;
  status: 'COMPLETED' | 'FAILED' | 'CANCELLED' | 'ESCALATED' | 'IN_PROGRESS';
  strikes: number;
  agreedP0P1Findings: number;
  modelAlias: string;
  systemPrompt: string;
  taskBrief: string;
  turns: TrajectoryTurn[];
  completedAt?: string;
}

export interface TrajectoryEligibilityResult {
  eligible: boolean;
  reason?: string;
  split: 'train' | 'eval';
}
```

---

## 2. Hermes Compressed Trajectory (`src/orchestrator/learning/trajectory-compressor.ts`)

```typescript
export interface HermesCompressionOptions {
  systemPrompt: string;
  taskBrief: string;
  turns: TrajectoryTurn[];
  protectTailTurns?: number; // default: 4
  auxiliarySummarizer?: (middleTurns: TrajectoryTurn[]) => Promise<string>;
}

export interface HermesCompressedTrajectory {
  compressed: boolean;
  usedFallback: boolean;
  protectedHead: {
    systemPrompt: string;
    taskBrief: string;
    firstAssistantTurns: TrajectoryTurn[];
  };
  middleSummary: string | null;
  compressedMiddleTurnCount: number;
  protectedTail: TrajectoryTurn[];
  messages: TrajectoryTurn[];
  tokensBefore: number;
  tokensAfter: number;
  compressionRatio: number;
}
```

---

## 3. Persisted Dataset Record & Export Formats (`src/orchestrator/learning/dataset-manager.ts`)

```typescript
export interface PersistedTrajectoryRecord {
  messages: Array<{
    role: 'system' | 'user' | 'assistant' | 'tool';
    content: string;
    tool_calls?: Array<{
      id: string;
      type: 'function';
      function: { name: string; arguments: string };
    }>;
    tool_call_id?: string;
  }>;
  metadata: {
    taskId: string;
    projectId: string;
    workspaceId: string;
    modelAlias: string;
    split: 'train' | 'eval';
    strikes: 0;
    agreedP0P1Findings: 0;
    compressed: boolean;
    compressedMiddleTurnCount: number;
    tokensBefore: number;
    tokensAfter: number;
    compressionRatio: number;
    redactionCount: number;
    harvestedAt: string;
  };
}

export interface ShareGptTrajectoryRecord {
  conversations: Array<{
    from: 'system' | 'human' | 'gpt';
    value: string;
  }>;
  metadata: PersistedTrajectoryRecord['metadata'];
}

export interface DatasetStatsSummary {
  projectId: string;
  totalTrajectories: number;
  trainCount: number;
  evalCount: number;
  months: Array<{
    month: string;
    count: number;
  }>;
  totalTokensBefore: number;
  totalTokensAfter: number;
  totalRedactions: number;
}
```

