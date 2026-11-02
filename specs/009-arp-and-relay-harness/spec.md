# Feature Specification: 009-arp-and-relay-harness

**Feature Branch**: `009-arp-and-relay-harness`  
**Created**: 2026-10-18  
**Status**: Draft  
**Target Phase**: Phase 7 — Agent Relay Protocol (ARP Port 3001) & `relay.mjs` Harness (`docs/implementation-plan-detailed.md`)  
**Input**: Master Phased Implementation Plan §Phase 7 (`specs/009-arp-and-relay-harness/`); `docs/architecture/relay-protocol-and-websocket-contract.md`; `docs/architecture/relay-mjs-contract.md`; ADR-040, ADR-041, ADR-042, ADR-059

## User Scenarios & Testing *(mandatory)*

### User Story 1 - ARP Envelope Schema, Port 3001 Server & F14 Manifest Lock (Priority: P1)

The Agent Relay Protocol (ARP) WebSocket server on Port 3001 (`src/orchestrator/arp/server.ts`) is the bidirectional nervous system between the Control Plane and ephemeral runner containers:
1. **TypeBox ARP Envelope Schema (`src/orchestrator/schemas/arp-envelope.ts`)**: Validates `RelayEnvelope` (`v: 1`, `id`, `ts`, `taskId`, `workspaceId`, `direction: 'c2e' | 'e2c'`, `type`, `payload`, `ack?`, `seq?`) across all 10 `c2e` message types (`task.dispatch`, `task.cancel`, `task.inject`, `clarification.response`, `review.feedback`, `budget.warning`, `budget.exceeded`, `manifest.lock.granted`, `manifest.lock.rejected`, `heartbeat.ping`) and all 12 `e2c` message types (`status.update`, `event.stream`, `terminal.chunk`, `cost.delta`, `file.mutation`, `manifest.lock.acquire`, `manifest.lock.release`, `clarification.request`, `escalation.emit`, `artifact.ready`, `result.final`, `heartbeat.pong`).
2. **Ephemeral JWT Handshake (`ws://orchestrator:3001/relay?taskId=...&token=...`)**: Verifies the 5-minute HMAC-SHA256 `RELAY_AUTH_TOKEN` scoped to `taskId` and `workspaceId`. Closes with WebSocket code `4001` (`Unauthorized`) if missing/invalid/expired or `4004` (`Task Not Found`) if the task is unknown.
3. **Idempotent `file.mutation` Ingestion & Persist-Before-Ack (N10)**: Deduplicates incoming `file.mutation` frames by `(taskId, seq)`, performs an `fsync` write of the mutation entry/snapshot to staging disk *before* sending the `ack` frame, and tracks `reconstructionFidelity: 'complete' | 'gapped'` with `missingSequences: number[]`.
4. **15-Second Heartbeat Monitor**: Sends `heartbeat.ping` every 15s (configurable in tests); if 3 consecutive pings go unanswered, closes with `4010` and triggers `SANDBOX_HEARTBEAT_TIMEOUT`.
5. **F14 Workspace Manifest Mutex (`src/orchestrator/arp/manifest-lock.ts`)**: Acquires and releases a Valkey-backed mutex `workspace:{workspaceId}:lock:manifest:{hash(manifestPath)}` (60s lease TTL, configurable wait timeout up to 120s) in response to `manifest.lock.acquire` / `manifest.lock.release` frames, replying with `manifest.lock.granted` or `manifest.lock.rejected`.

**Why this priority**: Guarantees zero lost work under OOM kills (`fsync`-before-ack), prevents concurrent package lockfile corruption across tasks (F14), and authenticates every container connection.

**Independent Test**: Run `tests/integration/arp-server.test.ts` testing valid/invalid JWT handshakes (`4001`/`4004`), duplicate `(taskId, seq)` `file.mutation` idempotency, `fsync`-before-ack persistence and gap detection (`complete` vs `gapped`), 3-strike heartbeat timeout (`4010`), and F14 manifest lock grant/contention/release.

**Acceptance Scenarios**:

1. **Given** an ARP server on `/relay`, **When** a client connects with an invalid `token`, **Then** the server closes the WebSocket with code `4001`; **When** `taskId` does not exist, **Then** it closes with `4004`; **When** valid, **Then** the connection succeeds.
2. **Given** an authenticated runner sending `file.mutation` with `seq: 1`, `seq: 1` (duplicate), and `seq: 3` (skipping `2`), **When** ingested by the ARP server, **Then** `seq: 1` is `fsync`ed to disk before `ack` is returned, duplicate `seq: 1` is acked without double-writing, and reconstruction metadata reports `reconstructionFidelity: 'gapped'` with `missingSequences: [2]`.
3. **Given** two tasks requesting `manifest.lock.acquire` for `package.json` in the same workspace, **When** Task A holds the lock, **Then** Task A receives `manifest.lock.granted` and Task B waits or receives `manifest.lock.rejected` on timeout until Task A sends `manifest.lock.release`.

---

### User Story 2 - Synchronous `BlastRadiusGuard` & Structural Git Barrier (`git-guard.sh`) (Priority: P1)

Inside the runner container, two deterministic security barriers prevent unauthorized file mutations and direct Git commits:
1. **Synchronous `BlastRadiusGuard` (`src/relay/blast-radius-guard.mjs`)**:
   - **Rule 0 (Always-Forbidden System Files)**: `.git/**`, `.agents/project.config.json`, `.agents/constitution.md`, and `**/relay.mjs` (`relay.mjs`) are unconditionally blocked regardless of project config.
   - **Rule 1 (`forbiddenGlobs`)**: Throws `BlastRadiusViolationError` (`code: 'RELAY_BLAST_RADIUS_VIOLATION'`, `exitCode: 2`) for hard halt.
   - **Rule 2 (`writableGlobs`)**: Returns `'allow'`.
   - **Rule 3 (`readonlyGlobs`)**: Returns `'escalate'`.
   - **Rule 4 (Default Deny)**: Returns `'escalate'` (fail-closed) when a path matches nothing.
2. **Structural Git Write Barrier (`src/relay/git-guard.sh`)**:
   - Wrapper script intercepting `git` subcommands: blocks `commit`, `push`, `merge`, `rebase`, `reset --hard`, `checkout -b`, `branch -D`, `tag`, and `remote` by printing `RELAY_GIT_BARRIER_VIOLATION` to stderr and exiting with code `2`.
   - Allows read-only and diff-staging subcommands required by the relay harness: `status`, `diff`, `log`, `show`, and `add` (`git add -N` / `git add -A` used for binary diff staging during Phase 3 teardown).

**Why this priority**: Enforces Constitution Principles 1 (Non-Committing Relay Contract) and 5 (Brownfield Immutable Scope Tiers) at the container boundary.

**Independent Test**: Run `tests/unit/blast-radius-guard.test.ts` and `tests/unit/git-guard.test.ts` verifying Rule 0–Rule 4 evaluation priorities and `git-guard.sh` exit code `2` on forbidden git subcommands vs exit code `0` on allowed commands.

**Acceptance Scenarios**:

1. **Given** a `BlastRadiusGuard` even if `writableGlobs: ['**/*']`, **When** `evaluate('.git/config', 'modify')` or `evaluate('.agents/project.config.json', 'modify')` or `evaluate('relay.mjs', 'modify')` is called, **Then** Rule 0 overrides `writableGlobs` and throws `RELAY_BLAST_RADIUS_VIOLATION` (`exitCode: 2`).
2. **Given** `writableGlobs: ['src/billing/**']`, `readonlyGlobs: ['src/shared/**']`, `forbiddenGlobs: ['src/auth/**']`, **When** `evaluate` is called, **Then** `src/auth/jwt.ts` throws `RELAY_BLAST_RADIUS_VIOLATION`, `src/billing/invoice.ts` returns `'allow'`, `src/shared/types.ts` returns `'escalate'`, and `README.md` (unmatched) returns `'escalate'`.
3. **Given** `src/relay/git-guard.sh`, **When** invoked with `git commit -m "msg"` or `git push`, **Then** it exits with code `2` and outputs `RELAY_GIT_BARRIER_VIOLATION`; **When** invoked with `git status` or `git diff`, **Then** it delegates to real `git` and exits `0`.

---

### User Story 3 - In-Container `relay.mjs` Harness & `delegate-fleet.v1` Lanes (Priority: P1)

The in-container harness (`src/relay/relay.mjs` and `src/relay/lanes.mjs`) executes the full agent task lifecycle over ARP:
1. **Lane Routing & Two-Strike Session Mapping (`src/relay/lanes.mjs`)**:
   - Maps task categories/lanes per `delegate-fleet.v1`: `feature -> claude`, `tests -> codex`, `ui -> opencode`, `complex -> agy`.
   - Enforces Two-Strike CLI session args: Strike 1 (`attempt === 1`) builds fresh invocation args (`--brief <path>`), while Strike 2 (`attempt === 2`) passes incremental resumption args (`--session <sessionId> --feedback <feedback>`).
2. **Ring Buffer & Spill-to-Disk (`/scratch/spill/`) + `SpendAccumulator` (`src/relay/relay.mjs`)**:
   - Connects to `RELAY_ORCHESTRATOR_URL` with `RELAY_AUTH_TOKEN`, receives `task.dispatch`, and initializes `SpendAccumulator` (emitting `cost.delta` on every call, `budget.warning` at 80% of `spendLimitUSD`, and halting cleanly with emergency patch + `RELAY_SPEND_CEILING_HIT` at 100%).
   - Maintains an outbound ring buffer (max 1000 messages / 10MB): drops oldest `terminal.chunk` frames on backpressure, but **never** drops `file.mutation`, `artifact.ready`, `cost.delta`, or `result.final` (spilling overflow to `/scratch/spill/`).
   - On Phase 3 teardown: writes `.agent_status.json` (ADR-059), generates `changes.patch` (`git diff --binary --full-index HEAD`), writes `result.json` (`version: 'delegate-relay.result.v1'`), sends `result.final` (waiting for orchestrator `ack` / close), and exits `0`.

**Why this priority**: Bridges the orchestrator ARP server with the in-container virtual developer tiers while guaranteeing budget safety, backpressure resilience, and verified `delegate-relay.result.v1` output.

**Independent Test**: Run `tests/integration/relay-harness.test.ts` connecting `relay.mjs` (and testing `lanes.mjs`, `SpendAccumulator`, and ring-buffer spill-to-disk) against a live Port 3001 ARP server instance.

**Acceptance Scenarios**:

1. **Given** `src/relay/lanes.mjs`, **When** resolving lanes for `feature`, `tests`, `ui`, and `complex`, **Then** it maps them to `claude`, `codex`, `opencode`, and `agy` respectively, using `--brief` on Strike 1 and `--session <id>` on Strike 2.
2. **Given** a `SpendAccumulator` with `limitUsd: 1.00`, **When** `0.85` USD is recorded, **Then** it emits `budget.warning` once; **When** an additional `0.20` USD is recorded (`1.05 >= 1.00`), **Then** it flushes the emergency patch and halts with `RELAY_SPEND_CEILING_HIT`.
3. **Given** `relay.mjs` connected to the ARP server, **When** `task.dispatch` is received and execution completes, **Then** `.agent_status.json`, `changes.patch`, and `result.json` (`delegate-relay.result.v1`) are written and `result.final` is delivered to the ARP server.

---

### Edge Cases

- **Out-of-Order / Duplicate `file.mutation` Sequence Numbers**: If `relay.mjs` retransmits an already-acknowledged `seq` after a brief backpressure stall, the ARP server immediately re-sends the `ack` without re-writing the file or corrupting `missingSequences`.
- **Ring Buffer Backpressure Spill**: When the in-memory ring buffer reaches capacity (`maxMessages` or `maxBytes`), `terminal.chunk` messages are evicted FIFO while `file.mutation`, `artifact.ready`, `cost.delta`, and `result.final` spill to JSONL files in `/scratch/spill/`.
- **Manifest Lock Auto-Expiry**: If a container crashes while holding a F14 manifest lock, the 60-second Valkey TTL automatically releases the lock so other tasks in the workspace never deadlock permanently.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST define TypeBox schemas in `src/orchestrator/schemas/arp-envelope.ts` for `RelayEnvelope` and all 10 `c2e` and 12 `e2c` ARP message types specified in `docs/architecture/relay-protocol-and-websocket-contract.md` §3.
- **FR-002**: System MUST implement the Port 3001 ARP WebSocket server in `src/orchestrator/arp/server.ts` enforcing ephemeral 5-minute JWT authentication (`4001` on invalid token, `4004` on unknown task), idempotent `(taskId, seq)` `file.mutation` ingestion with `fsync`-before-ack and `reconstructionFidelity: 'complete' | 'gapped'` tracking, and a 15s `heartbeat.ping`/`pong` monitor (3 missed pings -> `4010` / `SANDBOX_HEARTBEAT_TIMEOUT`).
- **FR-003**: System MUST implement the F14 Workspace Manifest Lock manager in `src/orchestrator/arp/manifest-lock.ts` using Valkey key `workspace:{workspaceId}:lock:manifest:{hash(manifestPath)}` (60s TTL, up to 120s wait timeout).
- **FR-004**: System MUST implement the synchronous `BlastRadiusGuard` in `src/relay/blast-radius-guard.mjs` (enforcing Rule 0 Always-Forbidden `.git/**`, `.agents/project.config.json`, `.agents/constitution.md`, `relay.mjs`; `forbiddenGlobs` -> `RELAY_BLAST_RADIUS_VIOLATION` exit code 2; `writableGlobs` -> `'allow'`; `readonlyGlobs` & default deny -> `'escalate'`) and the Git barrier script `src/relay/git-guard.sh` (blocking `commit`, `push`, `merge`, `rebase`, `reset --hard` with exit code 2 `RELAY_GIT_BARRIER_VIOLATION` while allowing `status`, `diff`, `add`).
- **FR-005**: System MUST implement `src/relay/lanes.mjs` (`feature -> claude`, `tests -> codex`, `ui -> opencode`, `complex -> agy` + Two-Strike `--brief` vs `--session` mapping) and `src/relay/relay.mjs` (ARP WebSocket client, `SpendAccumulator` 80% warning / 100% halt, 1000-msg/10MB ring buffer with `/scratch/spill/` overflow, and Phase 3 `.agent_status.json` + `changes.patch` + `result.json` + `result.final` teardown).

### Key Entities

- **RelayEnvelope**: `{ v: 1; id: string; ts: string; taskId: string; workspaceId: string; direction: 'c2e' | 'e2c'; type: RelayMessageType; payload: Record<string, unknown>; ack?: string; seq?: number }`.
- **ReconstructionMetadata**: `{ reconstructionFidelity: 'complete' | 'gapped'; missingSequences: number[]; salvagedFilesCount: number }`.
- **ManifestLockLease**: `{ workspaceId: string; manifestPath: string; lockKey: string; lockToken: string; leaseTtlMs: number }`.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: `tests/integration/arp-server.test.ts` passes, verifying JWT handshake (`4001`/`4004`), duplicate `seq` idempotency, `fsync`-before-ack persistence, `complete` vs `gapped` sequence tracking, heartbeat timeout, and F14 manifest lock grant/contention/release.
- **SC-002**: `tests/unit/blast-radius-guard.test.ts` and `tests/unit/git-guard.test.ts` pass, verifying Rule 0–Rule 4 blast-radius enforcement and `git-guard.sh` exit code `2` on forbidden git mutations.
- **SC-003**: `tests/integration/relay-harness.test.ts` passes, verifying `lanes.mjs` routing & Two-Strike args, `SpendAccumulator` 80%/100% thresholds, ring buffer spill-to-disk preservation of critical frames, and end-to-end `relay.mjs` execution against the Port 3001 ARP server.
- **SC-004**: `pnpm typecheck`, `pnpm lint`, `pnpm build`, and `pnpm test` pass with 0 errors and 0 warnings.

## Assumptions

- Ephemeral ARP JWT signing and verification (`mintRelayJwt` / `verifyRelayJwt`) uses Node's built-in `node:crypto` HMAC-SHA256 with `env.RELAY_JWT_SECRET` (zero external native binary dependencies).
- `src/relay/*.mjs` files are standard ES modules (`.mjs`) so they can run directly inside the Node 20 runner container (`node /relay/relay.mjs`) and be imported directly by Vitest unit/integration tests.
