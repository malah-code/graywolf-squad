# Interface Contracts: 009-arp-and-relay-harness

**Feature Branch**: `009-arp-and-relay-harness`  
**Date**: 2026-10-18

## 1. ARP Envelope & JWT Contract (`src/orchestrator/schemas/arp-envelope.ts`)

```typescript
export type C2EMessageType =
  | 'task.dispatch'
  | 'task.cancel'
  | 'task.inject'
  | 'clarification.response'
  | 'review.feedback'
  | 'budget.warning'
  | 'budget.exceeded'
  | 'manifest.lock.granted'
  | 'manifest.lock.rejected'
  | 'heartbeat.ping';

export type E2CMessageType =
  | 'status.update'
  | 'event.stream'
  | 'terminal.chunk'
  | 'cost.delta'
  | 'file.mutation'
  | 'manifest.lock.acquire'
  | 'manifest.lock.release'
  | 'clarification.request'
  | 'escalation.emit'
  | 'artifact.ready'
  | 'result.final'
  | 'heartbeat.pong';

export type RelayMessageType = C2EMessageType | E2CMessageType;

export interface RelayEnvelope {
  v: 1;
  id: string;
  ts: string;
  taskId: string;
  workspaceId: string;
  direction: 'c2e' | 'e2c';
  type: RelayMessageType;
  payload: Record<string, unknown>;
  ack?: string;
  seq?: number;
}

export function validateRelayEnvelope(raw: unknown): RelayEnvelope;

export function mintRelayJwt(input: {
  taskId: string;
  workspaceId: string;
  ttlSeconds?: number; // default 300 (5 min)
  secret?: string;
}): string;

export function verifyRelayJwt(
  token: string,
  expectedTaskId?: string,
  secret?: string
): { taskId: string; workspaceId: string; exp: number };
```

## 2. F14 Manifest Lock Contract (`src/orchestrator/arp/manifest-lock.ts`)

```typescript
export async function acquireManifestLock(options: {
  workspaceId: string;
  manifestPath: string;
  taskId: string;
  leaseTtlMs?: number; // default 60000 (60s)
  timeoutMs?: number;  // default 120000 (120s), configurable for fast tests
  pollIntervalMs?: number; // default 50ms
}): Promise<{
  granted: boolean;
  lockKey: string;
  lockToken?: string;
  leaseTtlMs?: number;
  reason?: string;
}>;

export async function releaseManifestLock(options: {
  workspaceId: string;
  manifestPath: string;
  lockToken: string;
}): Promise<boolean>;
```

## 3. Port 3001 ARP Server Contract (`src/orchestrator/arp/server.ts`)

```typescript
export interface ReconstructionMetadata {
  reconstructionFidelity: 'complete' | 'gapped';
  missingSequences: number[];
  salvagedFilesCount: number;
}

export interface ArpServerOptions extends FastifyServerOptions {
  baseDir?: string; // staging directory for mutation_stream.log
  heartbeatIntervalMs?: number; // default 15000 (15s)
  requireAuth?: boolean; // default true when query params present
  validateTaskExists?: (taskId: string) => Promise<boolean> | boolean;
  onHeartbeatTimeout?: (taskId: string) => void | Promise<void>;
  onEnvelope?: (envelope: RelayEnvelope, socket: WebSocket) => void | Promise<void>;
  onConnection?: (socket: WebSocket, taskId?: string) => void;
}
```

## 4. In-Container Relay Harness Contracts (`src/relay/*.mjs`)

- `src/relay/blast-radius-guard.mjs`:
  - `export class BlastRadiusViolationError extends Error` (`code = 'RELAY_BLAST_RADIUS_VIOLATION'`, `exitCode = 2`)
  - `export class BlastRadiusGuard` with `evaluate(filePath, operation)` returning `'allow' | 'escalate'` or throwing `BlastRadiusViolationError`.
- `src/relay/git-guard.sh`:
  - Executable bash script exiting `2` with `RELAY_GIT_BARRIER_VIOLATION` on `commit`, `push`, `merge`, `rebase`, `reset --hard`, and delegating allowed read/staging commands (`status`, `diff`, `add`) to `git`.
- `src/relay/lanes.mjs`:
  - `export const LANE_MAPPING = { feature: 'claude', tests: 'codex', ui: 'opencode', complex: 'agy' }`
  - `export function resolveExecutionLane(taskTypeOrTag)`
  - `export function buildLaneCliArgs({ lane, attempt, briefPath, sessionId, feedback })`
- `src/relay/relay.mjs`:
  - `export class SpendAccumulator`
  - `export class RelayRingBuffer`
  - `export class RelayHarness`
