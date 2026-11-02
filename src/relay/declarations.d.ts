declare module '*/lanes.mjs' {
  export const LANE_MAPPING: Readonly<{
    feature: string;
    tests: string;
    ui: string;
    complex: string;
  }>;

  export function resolveExecutionLane(taskTypeOrTag?: string): 'claude' | 'codex' | 'opencode' | 'agy';

  export function buildLaneCliArgs(options?: {
    lane?: string;
    attempt?: number;
    briefPath?: string;
    sessionId?: string;
    feedback?: string;
  }): {
    cliTool: string;
    args: string[];
  };
}

declare module '*/blast-radius-guard.mjs' {
  export class BlastRadiusViolationError extends Error {
    code: string;
    exitCode: number;
    filePath: string;
    operation: string;
    reason: string;
    constructor(filePath: string, operation: string, reason: string);
  }

  export interface BlastRadiusGuardOptions {
    writableGlobs?: string[];
    readonlyGlobs?: string[];
    forbiddenGlobs?: string[];
  }

  export class BlastRadiusGuard {
    writableGlobs: string[];
    readonlyGlobs: string[];
    forbiddenGlobs: string[];
    constructor(options?: BlastRadiusGuardOptions);
    normalizePath(rawPath: string): string;
    evaluate(filePath: string, operation?: string): 'allow' | 'escalate';
  }
}

declare module '*/relay.mjs' {
  export interface SpendAccumulatorOptions {
    limitUsd?: number;
    warningThreshold?: number;
    onSendEnvelope?: (envelope: { type: string; payload: Record<string, unknown> }) => Promise<void> | void;
    onInjectSystemMessage?: (msg: string) => Promise<void> | void;
    onEmergencyFlush?: () => Promise<void> | void;
  }

  export class SpendAccumulator {
    limitUsd: number;
    warningThreshold: number;
    currentSpendUsd: number;
    warned: boolean;
    constructor(options?: SpendAccumulatorOptions);
    record(callCostUsd: number, meta?: Record<string, unknown>): Promise<number>;
  }

  export interface RelayRingBufferOptions {
    maxMessages?: number;
    maxBytes?: number;
    spillDir?: string;
  }

  export class RelayRingBuffer {
    static NEVER_DROP_TYPES: Set<string>;
    maxMessages: number;
    maxBytes: number;
    spillDir: string;
    constructor(options?: RelayRingBufferOptions);
    getQueueLength(): number;
    getQueuedBytes(): number;
    enqueue(envelope: { type: string; payload?: unknown }): Promise<{ spilled: boolean; dropped: boolean }>;
    dequeue(): unknown | null;
  }

  export interface RelayHarnessOptions {
    taskId: string;
    workspaceId?: string;
    orchestratorUrl?: string;
    authToken: string;
    workspaceRoot?: string;
    blastRadiusGuard?: import('*/blast-radius-guard.mjs').BlastRadiusGuard | null;
    spendAccumulator?: SpendAccumulator | null;
    executeTaskFn?: (harness: RelayHarness) => Promise<void> | void;
    socketFactory?: (url: string) => import('ws').WebSocket;
  }

  export class RelayHarness {
    taskId: string;
    workspaceId: string;
    orchestratorUrl: string;
    authToken: string;
    workspaceRoot: string;
    blastRadiusGuard: import('*/blast-radius-guard.mjs').BlastRadiusGuard | null;
    spendAccumulator: SpendAccumulator | null;
    constructor(options: RelayHarnessOptions);
    nextSeq(): number;
    sendEnvelope(type: string, payload?: Record<string, unknown>, options?: { id?: string; seq?: number }): Promise<unknown>;
    recordFileMutation(filePath: string, action?: string, diff?: string): Promise<unknown>;
    flushArtifacts(startTime: number, status?: string, exitCode?: number): Promise<unknown>;
    start(): Promise<{ status: string; exitCode: number }>;
  }
}
