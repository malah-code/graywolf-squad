# Phase 0 Research: 009-arp-and-relay-harness

**Feature Branch**: `009-arp-and-relay-harness`  
**Date**: 2026-10-18  
**Status**: Complete (0 unknowns remaining)

## 1. ARP Envelope Schema & Port 3001 Server (`src/orchestrator/schemas/arp-envelope.ts`, `src/orchestrator/arp/server.ts`, `src/orchestrator/arp/manifest-lock.ts`)

- **Decision**:
  - Define `RelayEnvelopeSchema` (`@sinclair/typebox`) in `src/orchestrator/schemas/arp-envelope.ts` with `v: Type.Literal(1)`, `id`, `ts`, `taskId`, `workspaceId`, `direction: 'c2e' | 'e2c'`, `type: RelayMessageTypeSchema` (all 10 `c2e` and 12 `e2c` message types), `payload: Type.Record(Type.String(), Type.Unknown())`, optional `ack`, and optional `seq`.
  - Implement HMAC-SHA256 JWT helpers `mintRelayJwt({ taskId, workspaceId, ttlSeconds?: 300 })` and `verifyRelayJwt(token, expectedTaskId)` using `node:crypto` and `env.RELAY_JWT_SECRET`.
  - Upgrade `buildArpServer` in `src/orchestrator/arp/server.ts`:
    - On `GET /relay` WebSocket connection: extract `?taskId=...&token=...` from `request.url`. If `token` is missing/invalid/expired or `taskId` mismatches token claims, close with code `4001` (`Unauthorized`). If `validateTaskExists` callback returns `false`, close with code `4004` (`Task Not Found`).
    - Maintain per-task connection state (`seenSeqs: Set<number>`, `maxSeq: number`, `salvagedFiles: Set<string>`, `missedPings: number`).
    - On `file.mutation` with `seq`: if `seenSeqs.has(seq)`, immediately send `{ v: 1, ..., direction: 'c2e', ack: envelope.id }` without re-writing disk. Otherwise open `.agents/tasks/<taskId>/ledger/mutation_stream.log` (and optional staging snapshot file), write + `await fileHandle.sync()` (`fsync`) *before* sending the `ack` frame, and record `seq` in `seenSeqs`. Compute `getReconstructionMetadata(taskId)` returning `{ reconstructionFidelity: missingSequences.length === 0 ? 'complete' : 'gapped', missingSequences, salvagedFilesCount }`.
    - Run a periodic `heartbeat.ping` timer (default `15000ms`, configurable in `ArpServerOptions`); increment `missedPings` on each tick, reset to `0` on `heartbeat.pong`, and if `missedPings >= 3`, close socket with `4010` and invoke optional `onHeartbeatTimeout(taskId)` callback.
  - Implement `src/orchestrator/arp/manifest-lock.ts` using `getValkeyStore()`:
    - Key format: `workspace:${workspaceId}:lock:manifest:${sha256Hex(manifestPath)}` with 60s TTL (`leaseTtlMs = 60000`) and polling retry up to `timeoutMs` (default/max `120000ms`).
- **Rationale**: Satisfies `docs/architecture/relay-protocol-and-websocket-contract.md` §2–§8 and Phase 7 Task 7.1 with zero external native dependencies.
- **Alternatives Considered**:
  - Buffering `file.mutation` in memory without `fsync` before ack (rejected: violates N10 Persist-Before-Ack crash consistency guarantee).

## 2. Synchronous `BlastRadiusGuard` & `git-guard.sh` (`src/relay/blast-radius-guard.mjs`, `src/relay/git-guard.sh`)

- **Decision**:
  - Implement `BlastRadiusGuard` in `src/relay/blast-radius-guard.mjs` using `picomatch`:
    - Normalize candidate `filePath` (strip leading `/workspace/`, `./`, `/`).
    - **Rule 0 (Always-Forbidden System Files)**: `['.git', '.git/**', '**/.git/**', '.agents/project.config.json', '.agents/constitution.md', 'relay.mjs', '**/relay.mjs']` -> throw `BlastRadiusViolationError` (`code = 'RELAY_BLAST_RADIUS_VIOLATION'`, `exitCode = 2`).
    - **Rule 1 (`forbiddenGlobs`)**: if matched -> throw `BlastRadiusViolationError` (`code = 'RELAY_BLAST_RADIUS_VIOLATION'`, `exitCode = 2`).
    - **Rule 2 (`writableGlobs`)**: if matched -> return `'allow'`.
    - **Rule 3 (`readonlyGlobs`)**: if matched -> return `'escalate'`.
    - **Rule 4 (Default Deny)**: return `'escalate'`.
  - Implement `src/relay/git-guard.sh`:
    - Inspects subcommand and flags. Blocks `commit`, `push`, `merge`, `rebase`, `pull`, `fetch`, `remote`, `tag`, `branch -D`/`-d`/`-m`, `checkout -b`, and `reset --hard` by printing `RELAY_GIT_BARRIER_VIOLATION: Direct git mutation '<subcommand>' is structurally prohibited inside the sandbox.` to `stderr` and exiting with code `2`.
    - Allows `status`, `diff`, `log`, `show`, `rev-parse`, and `add` (`git add -N` / `git add -A` for Phase 3 binary diff staging), delegating to `${REAL_GIT_BIN:-/usr/bin/git}`.
- **Rationale**: Enforces Constitution Principles 1 & 5 deterministically inside the runner container.
- **Alternatives Considered**:
  - Post-hoc diff checking only after agent completion (rejected: `relay-mjs-contract.md` §4 mandates synchronous pre-write interception).

## 3. In-Container `relay.mjs` Harness & `delegate-fleet.v1` Lanes (`src/relay/lanes.mjs`, `src/relay/relay.mjs`)

- **Decision**:
  - Implement `src/relay/lanes.mjs`:
    - `LANE_MAPPING = { feature: 'claude', tests: 'codex', ui: 'opencode', complex: 'agy' }`.
    - `resolveExecutionLane(categoryOrTag)` and `buildCliSessionArgs({ lane, attempt, briefPath, sessionId, feedback })`:
      - Strike 1 (`attempt === 1`): `['--lane', cliTool, '--brief', briefPath, '--acp-stdio']`
      - Strike 2 (`attempt === 2`): `['--lane', cliTool, '--session', sessionId, '--feedback', feedback ?? '', '--acp-stdio']`.
  - Implement `src/relay/relay.mjs`:
    - Exports `SpendAccumulator` (80% `budget.warning`, 100% emergency patch + `RELAY_SPEND_CEILING_HIT`), `RelayRingBuffer` (max `1000` messages / `10MB`; evicts oldest `terminal.chunk` on overflow; spills never-dropped `file.mutation`, `artifact.ready`, `cost.delta`, `result.final` to `/scratch/spill/`), and `RelayHarness` (connects to `RELAY_ORCHESTRATOR_URL` with `?taskId=...&token=...`, handles `task.dispatch`, `heartbeat.ping` -> `heartbeat.pong`, `task.cancel`, writes `.agent_status.json` + `changes.patch` + `result.json` (`delegate-relay.result.v1`), sends `result.final`, and exits `0`).
- **Rationale**: Modular exports allow both direct CLI execution (`node /relay/relay.mjs`) as container PID 1 and fast, deterministic Vitest unit/integration testing.
- **Alternatives Considered**:
  - Monolithic un-exported script (rejected: harder to unit test ring buffer spill and lane session mapping in isolation).
