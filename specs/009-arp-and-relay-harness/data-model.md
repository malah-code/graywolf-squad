# Data Model: 009-arp-and-relay-harness

**Feature Branch**: `009-arp-and-relay-harness`  
**Date**: 2026-10-18

## 1. ARP Envelope & Message Payloads (`src/orchestrator/schemas/arp-envelope.ts`)

### 1.1 `RelayEnvelope`
| Field | Type | Constraints | Description |
|---|---|---|---|
| `v` | `1` | Literal `1` | Protocol major version |
| `id` | `string` | Non-empty UUID | Unique message identifier |
| `ts` | `string` | ISO-8601 | Message emission timestamp |
| `taskId` | `string` | `^TASK-[0-9A-Z-]+$` | Target task ID |
| `workspaceId` | `string` | Non-empty | Tenant workspace ID |
| `direction` | `'c2e' \| 'e2c'` | Union | Control-to-Execution or Execution-to-Control |
| `type` | `RelayMessageType` | 22 literals | Discriminated message type |
| `payload` | `Record<string, unknown>` | Object | Type-specific message payload |
| `ack` | `string \| undefined` | Optional | Message ID being acknowledged |
| `seq` | `number \| undefined` | Optional `>= 1` | Monotonically increasing sequence number |

### 1.2 `c2e` Message Types (10 types)
- `task.dispatch`
- `task.cancel`
- `task.inject`
- `clarification.response`
- `review.feedback`
- `budget.warning`
- `budget.exceeded`
- `manifest.lock.granted`
- `manifest.lock.rejected`
- `heartbeat.ping`

### 1.3 `e2c` Message Types (12 types)
- `status.update`
- `event.stream`
- `terminal.chunk`
- `cost.delta`
- `file.mutation`
- `manifest.lock.acquire`
- `manifest.lock.release`
- `clarification.request`
- `escalation.emit`
- `artifact.ready`
- `result.final`
- `heartbeat.pong`

## 2. Crash Reconstruction & Manifest Lock Entities (`src/orchestrator/arp/`)

### 2.1 `ReconstructionMetadata`
| Field | Type | Description |
|---|---|---|
| `reconstructionFidelity` | `'complete' \| 'gapped'` | `'complete'` if all `1..maxSeq` received; `'gapped'` if any sequence numbers are missing |
| `missingSequences` | `number[]` | Sorted list of missing sequence numbers in `1..maxSeq` |
| `salvagedFilesCount` | `number` | Count of distinct file paths persisted via `file.mutation` |

### 2.2 `ManifestLockLease` (`src/orchestrator/arp/manifest-lock.ts`)
| Field | Type | Description |
|---|---|---|
| `workspaceId` | `string` | Workspace UUID |
| `manifestPath` | `string` | Normalized manifest path (e.g., `package.json`) |
| `lockKey` | `string` | `workspace:{workspaceId}:lock:manifest:{sha256(manifestPath)}` |
| `lockToken` | `string` | Unique lease token required for release |
| `leaseTtlMs` | `number` | Default `60000` (60s) |

## 3. In-Container Harness Entities (`src/relay/`)

### 3.1 `AgentStatusFile` (`.agent_status.json`, ADR-059)
| Field | Type | Description |
|---|---|---|
| `taskId` | `string` | Task ID |
| `status` | `'completed' \| 'failed' \| 'timeout' \| 'circuit_tripped' \| 'budget_exceeded'` | Terminal status |
| `exitCode` | `number` | Process exit code (`0`, `1`, `2`) |
| `updatedAt` | `string` | ISO-8601 timestamp |
| `totalSpendUsd` | `number` | Accumulated spend in USD |
| `sessionRef` | `string \| null` | CLI session reference ID |
