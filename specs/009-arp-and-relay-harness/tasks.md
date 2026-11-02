---

description: "Detailed step-by-step task list for Phase 7 — Agent Relay Protocol (ARP Port 3001) & relay.mjs Harness"
---

# Tasks: 009-arp-and-relay-harness

**Input**: Design documents from `/specs/009-arp-and-relay-harness/`

**Prerequisites**: `plan.md`, `spec.md`, `research.md`, `data-model.md`, `contracts/arp-and-relay.md`, `quickstart.md`

**Tests**: Included per `spec.md` (`SC-001`–`SC-004`) and `docs/implementation-plan-detailed.md` Phase 7 verification requirements (`tests/integration/arp-server.test.ts`, `tests/unit/blast-radius-guard.test.ts`, `tests/unit/git-guard.test.ts`, and `tests/integration/relay-harness.test.ts`).

**Organization**: Tasks are grouped by user story (`US1`–`US3`) and written with explicit function signatures, exact TypeBox / ES module schemas, and error codes so a fast/cheap coding model can execute each task deterministically without ambiguity.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: Which user story this task belongs to (`[US1]`, `[US2]`, `[US3]`)
- Include exact file paths in descriptions

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Ensure `src/relay/` and `src/orchestrator/arp/` directories exist before writing Phase 7 modules.

- [x] T001 Create `src/relay/` directory (`mkdir -p src/relay`) for the in-container relay harness modules

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Implement `src/orchestrator/schemas/arp-envelope.ts` containing the canonical `RelayEnvelope` TypeBox schema, all 10 `c2e` and 12 `e2c` message types, and the HMAC-SHA256 JWT helpers (`mintRelayJwt`, `verifyRelayJwt`) required by both the Port 3001 ARP Server (`US1`) and the `relay.mjs` harness (`US3`).

**⚠️ CRITICAL**: Complete before starting User Story 1 (`T003`–`T005`).

- [x] T002 Implement `src/orchestrator/schemas/arp-envelope.ts` with exact exports:
  - `C2EMessageTypeSchema` union of 10 literals: `'task.dispatch'`, `'task.cancel'`, `'task.inject'`, `'clarification.response'`, `'review.feedback'`, `'budget.warning'`, `'budget.exceeded'`, `'manifest.lock.granted'`, `'manifest.lock.rejected'`, `'heartbeat.ping'`.
  - `E2CMessageTypeSchema` union of 12 literals: `'status.update'`, `'event.stream'`, `'terminal.chunk'`, `'cost.delta'`, `'file.mutation'`, `'manifest.lock.acquire'`, `'manifest.lock.release'`, `'clarification.request'`, `'escalation.emit'`, `'artifact.ready'`, `'result.final'`, `'heartbeat.pong'`.
  - `RelayMessageTypeSchema = Type.Union([C2EMessageTypeSchema, E2CMessageTypeSchema])`.
  - `RelayEnvelopeSchema = Type.Object({ v: Type.Literal(1), id: Type.String({ minLength: 1 }), ts: Type.String({ minLength: 1 }), taskId: Type.String({ pattern: '^TASK-[0-9A-Z-]+$' }), workspaceId: Type.String({ minLength: 1 }), direction: Type.Union([Type.Literal('c2e'), Type.Literal('e2c')]), type: RelayMessageTypeSchema, payload: Type.Record(Type.String(), Type.Unknown()), ack: Type.Optional(Type.String()), seq: Type.Optional(Type.Integer({ minimum: 1 })) })`.
  - `validateRelayEnvelope(raw: unknown): RelayEnvelope` using `Value.Check(RelayEnvelopeSchema, raw)` and throwing `GraywolfAppError('ACI_VALIDATION_FAILED', ...)` when invalid.
  - `mintRelayJwt(input: { taskId: string; workspaceId: string; ttlSeconds?: number; secret?: string }): string`: encodes `{ alg: 'HS256', typ: 'JWT' }` header + `{ taskId, workspaceId, iat, exp: iat + (ttlSeconds ?? 300) }` payload as `base64url` and signs with `crypto.createHmac('sha256', secret ?? env.RELAY_JWT_SECRET)`.
  - `verifyRelayJwt(token: string, expectedTaskId?: string, secret?: string): { taskId: string; workspaceId: string; exp: number }`: verifies signature (`crypto.timingSafeEqual`), checks `exp * 1000 > Date.now()`, and checks `expectedTaskId` match if provided; throws `GraywolfAppError('AUTH_SESSION_EXPIRED' | 'AUTH_SESSION_MISSING')` on failure.

**Checkpoint**: `src/orchestrator/schemas/arp-envelope.ts` ready — User Stories 1, 2, and 3 can now proceed.

---

## Phase 3: User Story 1 - ARP Envelope Schema, Port 3001 Server & F14 Manifest Lock (Priority: P1) 🎯 MVP

**Goal**: Implement the F14 Workspace Manifest Mutex (`src/orchestrator/arp/manifest-lock.ts`) and upgrade the Port 3001 ARP WebSocket server (`src/orchestrator/arp/server.ts`) to enforce 5-minute JWT handshake (`4001` / `4004`), idempotent `(taskId, seq)` `file.mutation` ingestion with `fsync`-before-ack, `complete` vs `gapped` reconstruction fidelity tracking, and a 15s `heartbeat.ping`/`pong` monitor (`4010` / `SANDBOX_HEARTBEAT_TIMEOUT`).

**Independent Test**: Run `pnpm test tests/integration/arp-server.test.ts` verifying JWT handshake (`4001`/`4004`), duplicate `seq` idempotency, `fsync`-before-ack, `complete` vs `gapped` sequence tracking, 3-strike heartbeat timeout, and F14 manifest lock grant/contention/release.

### Implementation for User Story 1

- [x] T003 [P] [US1] Implement F14 Workspace Manifest Lock manager in `src/orchestrator/arp/manifest-lock.ts` using `getValkeyStore()` and `sha256Hex` from `../auth/better-auth`:
  - `getManifestLockKey(workspaceId: string, manifestPath: string): string` returning `` `workspace:${workspaceId}:lock:manifest:${sha256Hex(manifestPath.trim().replace(/^\.\//, ''))}` ``.
  - `acquireManifestLock(options: { workspaceId: string; manifestPath: string; taskId: string; leaseTtlMs?: number; timeoutMs?: number; pollIntervalMs?: number })`:
    - Generates `lockToken = crypto.randomUUID()`, `leaseTtlMs = options.leaseTtlMs ?? 60000`, `ttlSeconds = Math.max(1, Math.ceil(leaseTtlMs / 1000))`, `timeoutMs = options.timeoutMs ?? 120000`, `pollIntervalMs = options.pollIntervalMs ?? 50`.
    - Loops until `Date.now() - start <= timeoutMs`: checks if `await store.get(lockKey)` is `null`; if `null`, sets `await store.set(lockKey, JSON.stringify({ taskId: options.taskId, lockToken }), 'EX', ttlSeconds)` and returns `{ granted: true, lockKey, lockToken, leaseTtlMs }`.
    - If still locked after `timeoutMs`, returns `{ granted: false, lockKey, reason: `Manifest lock timeout after ${timeoutMs}ms for '${options.manifestPath}'` }`.
  - `releaseManifestLock(options: { workspaceId: string; manifestPath: string; lockToken: string }): Promise<boolean>`:
    - Reads `await store.get(lockKey)`; if present and parsed `lockToken === options.lockToken`, calls `await store.del(lockKey)` and returns `true`; otherwise returns `false`.
- [x] T004 [US1] Upgrade `buildArpServer` in `src/orchestrator/arp/server.ts` to support full ARP protocol while keeping backward compatibility with existing `tests/integration/bootstrap.test.ts` (when no `?taskId=` query param is passed and `requireAuth` is not forced, allow basic connection):
  - Parse `?taskId=...&token=...` from `request.url`. If `opts.requireAuth` is `true` or `taskId` / `token` query params are provided:
    - Verify JWT via `verifyRelayJwt(token, taskId)`; if invalid/missing/expired, call `socket.close(4001, 'Unauthorized')` and return.
    - If `opts.validateTaskExists` is provided and `!(await opts.validateTaskExists(taskId))`, call `socket.close(4004, 'Task Not Found')` and return.
  - Maintain per-task state (`seenSeqs: Set<number>`, `maxSeq: number`, `salvagedFiles: Set<string>`, `missedPings: number`).
  - Export helper `getTaskReconstructionMetadata(taskId: string): ReconstructionMetadata` computing `missingSequences` (`1..maxSeq` not in `seenSeqs`), `reconstructionFidelity: missingSequences.length === 0 ? 'complete' : 'gapped'`, and `salvagedFilesCount: salvagedFiles.size`.
  - When an `e2c` `RelayEnvelope` arrives:
    - If `type === 'heartbeat.pong'`: reset `missedPings = 0`.
    - If `type === 'file.mutation'`:
      - Check `seq = envelope.seq`. If `seq && state.seenSeqs.has(seq)`, immediately send `c2e` ack frame `{ v: 1, id: crypto.randomUUID(), ts: new Date().toISOString(), taskId: envelope.taskId, workspaceId: envelope.workspaceId, direction: 'c2e', type: 'status.update', payload: { acked: true, duplicate: true }, ack: envelope.id, seq }` without writing to disk.
      - Otherwise, open `<baseDir>/<taskId>/ledger/mutation_stream.log` with `fs.promises.open(logPath, 'a')`, write the JSONL mutation line, call `await handle.sync()` (`fsync`), close the handle, add `seq` to `state.seenSeqs`, update `state.maxSeq`, add `payload.path` to `state.salvagedFiles`, and *then* send the `ack` frame back over `socket.send(...)`.
    - If `type === 'manifest.lock.acquire'`: call `acquireManifestLock(...)` and send `manifest.lock.granted` or `manifest.lock.rejected` with `ack: envelope.id`.
    - If `type === 'manifest.lock.release'`: call `releaseManifestLock(...)` and send ack frame with `ack: envelope.id`.
    - For any other at-least-once message (`result.final`, `artifact.ready`, `cost.delta`, `clarification.request`, `escalation.emit`), send an `ack: envelope.id` frame (`if (envelope.type === 'result.final')` also close with `1000` if requested or after ack).
  - Start periodic `heartbeat.ping` timer (`opts.heartbeatIntervalMs ?? 15000`); on each tick, if `missedPings >= 3`, call `socket.close(4010, 'SANDBOX_HEARTBEAT_TIMEOUT')` and invoke `opts.onHeartbeatTimeout?.(taskId)`; otherwise increment `missedPings` and send `heartbeat.ping`. Clear timer on socket `close`.
- [x] T005 [US1] Create integration test suite in `tests/integration/arp-server.test.ts` testing:
  1. Valid JWT handshake succeeds; invalid/expired JWT closes with `4001`; unknown task closes with `4004`.
  2. `file.mutation` with `seq: 1`, duplicate `seq: 1`, and `seq: 3` performs `fsync`-before-ack, writes `seq: 1` only once to `mutation_stream.log`, and reports `getTaskReconstructionMetadata` as `reconstructionFidelity: 'gapped'` with `missingSequences: [2]` (and becomes `'complete'` once `seq: 2` arrives).
  3. Heartbeat monitor sends `heartbeat.ping`, resets on `heartbeat.pong`, and closes with `4010` (`onHeartbeatTimeout` called) after 3 missed pings.
  4. F14 `manifest.lock.acquire` grants lock to Task A, rejects concurrent Task B on short timeout, and grants to Task B after Task A sends `manifest.lock.release`.

**Checkpoint**: User Story 1 is complete and independently verified by `tests/integration/arp-server.test.ts`.

---

## Phase 4: User Story 2 - Synchronous `BlastRadiusGuard` & Structural Git Barrier (`git-guard.sh`) (Priority: P1)

**Goal**: Implement `src/relay/blast-radius-guard.mjs` (enforcing Rule 0 Always-Forbidden paths, `forbiddenGlobs` hard halt exit code 2, `writableGlobs` allow, `readonlyGlobs` & default deny escalate) and `src/relay/git-guard.sh` (blocking `git commit`, `git push`, `git merge`, `git rebase`, `git reset --hard` with exit code 2 `RELAY_GIT_BARRIER_VIOLATION`).

**Independent Test**: Run `pnpm test tests/unit/blast-radius-guard.test.ts tests/unit/git-guard.test.ts`.

### Implementation for User Story 2

- [x] T006 [P] [US2] Create `src/relay/blast-radius-guard.mjs` exporting `BlastRadiusViolationError` (`code = 'RELAY_BLAST_RADIUS_VIOLATION'`, `exitCode = 2`) and `BlastRadiusGuard` class:
  - Constructor accepts `{ writableGlobs = [], readonlyGlobs = [], forbiddenGlobs = [] }`.
  - Normalizes `filePath` by replacing `\` with `/`, stripping leading `/workspace/`, `./`, and `/`, and resolving `..` segments (if path escapes workspace root via `..`, throw `BlastRadiusViolationError`).
  - **Rule 0 (Always-Forbidden System Files)**: check against `['.git', '.git/**', '**/.git/**', '.agents/project.config.json', '.agents/constitution.md', 'relay.mjs', '**/relay.mjs']`. If matched, throw `new BlastRadiusViolationError(filePath, operation, 'Rule 0: Protected system file')`.
  - **Rule 1 (`forbiddenGlobs`)**: if matched via `picomatch`, throw `new BlastRadiusViolationError(filePath, operation, 'Matched forbiddenGlobs')`.
  - **Rule 2 (`writableGlobs`)**: if matched via `picomatch`, return `'allow'`.
  - **Rule 3 (`readonlyGlobs`)**: if matched via `picomatch`, return `'escalate'`.
  - **Rule 4 (Default Deny)**: return `'escalate'`.
- [x] T007 [P] [US2] Create executable `src/relay/git-guard.sh` (`chmod +x src/relay/git-guard.sh`):
  - Inspects `$1` (subcommand) and all arguments `"$@"`.
  - If subcommand is `commit`, `push`, `merge`, `rebase`, `pull`, `fetch`, `remote`, `tag`, `cherry-pick`, `revert`, or if `reset` is called with `--hard`, or `branch` with `-d`/`-D`/`-m`/`-M`, or `checkout` with `-b`/`-B`: print `RELAY_GIT_BARRIER_VIOLATION: Direct git mutation is structurally prohibited inside the sandbox.` to `stderr` (`>&2`) and `exit 2`.
  - Otherwise (for `status`, `diff`, `log`, `show`, `rev-parse`, `add`), delegate to `"${REAL_GIT_BIN:-/usr/bin/git}" "$@"`.
- [x] T008 [US2] Create unit test suites in `tests/unit/blast-radius-guard.test.ts` and `tests/unit/git-guard.test.ts`:
  - `tests/unit/blast-radius-guard.test.ts`: tests Rule 0 Always-Forbidden paths (`.git/config`, `.agents/project.config.json`, `.agents/constitution.md`, `relay.mjs`) even when `writableGlobs: ['**/*']`; tests `forbiddenGlobs` throwing `RELAY_BLAST_RADIUS_VIOLATION` (`exitCode === 2`); tests `writableGlobs` returning `'allow'`; tests `readonlyGlobs` and unmatched paths returning `'escalate'`.
  - `tests/unit/git-guard.test.ts`: tests `bash -n src/relay/git-guard.sh`, verifies `git commit`, `git push`, `git merge`, `git rebase`, and `git reset --hard` exit with code `2` and stderr containing `RELAY_GIT_BARRIER_VIOLATION`, and verifies `git status`, `git diff`, and `git add -N` succeed with exit code `0`.

**Checkpoint**: User Story 2 is complete and independently verified by `tests/unit/blast-radius-guard.test.ts` and `tests/unit/git-guard.test.ts`.

---

## Phase 5: User Story 3 - In-Container `relay.mjs` Harness & `delegate-fleet.v1` Lanes (Priority: P1)

**Goal**: Implement `src/relay/lanes.mjs` (`feature -> claude`, `tests -> codex`, `ui -> opencode`, `complex -> agy` + Two-Strike session args) and `src/relay/relay.mjs` (`SpendAccumulator`, `RelayRingBuffer` with `/scratch/spill/` overflow, and `RelayHarness` connecting to ARP Port 3001 and producing `.agent_status.json`, `changes.patch`, `result.json`, and `result.final`).

**Independent Test**: Run `pnpm test tests/integration/relay-harness.test.ts`.

### Implementation for User Story 3

- [x] T009 [P] [US3] Create `src/relay/lanes.mjs` exporting:
  - `LANE_MAPPING = Object.freeze({ feature: 'claude', tests: 'codex', ui: 'opencode', complex: 'agy' })`.
  - `resolveExecutionLane(taskTypeOrTag = 'feature'): 'claude' | 'codex' | 'opencode' | 'agy'` mapping `feature -> claude`, `tests | test | bug-bash-sprint -> codex`, `ui | frontend -> opencode`, `complex | refactor | architecture -> agy` (default `'claude'`).
  - `buildLaneCliArgs({ lane, attempt = 1, briefPath = '.agents/tasks/brief.md', sessionId, feedback })`:
    - Resolves `cliTool = LANE_MAPPING[lane] || lane || 'claude'`.
    - If `attempt === 1` (Strike 1 fresh session): returns `{ cliTool, args: ['--brief', briefPath, '--format', 'json-rpc-acp'] }`.
    - If `attempt >= 2` (Strike 2 incremental session): requires `sessionId`, returns `{ cliTool, args: ['--session', sessionId, '--feedback', feedback || '', '--format', 'json-rpc-acp'] }`.
- [x] T010 [US3] Create `src/relay/relay.mjs` exporting `SpendAccumulator`, `RelayRingBuffer`, and `RelayHarness`:
  - `SpendAccumulator`:
    - Constructor `{ limitUsd, warningThreshold = 0.8, onSendEnvelope, onInjectSystemMessage, onEmergencyFlush }`.
    - `record(callCostUsd, meta = {})`: increments `currentSpendUsd`, sends `cost.delta` envelope, at `>= limitUsd * 0.8` (once) sends `budget.warning` and calls `onInjectSystemMessage`, and at `>= limitUsd` calls `onEmergencyFlush()`, sends `result.final` with `code: 'RELAY_SPEND_CEILING_HIT'`, and throws/halts with `code: 'RELAY_SPEND_CEILING_HIT'`.
  - `RelayRingBuffer`:
    - Constructor `{ maxMessages = 1000, maxBytes = 10 * 1024 * 1024, spillDir = '/scratch/spill' }`.
    - `NEVER_DROP_TYPES = new Set(['file.mutation', 'artifact.ready', 'cost.delta', 'result.final'])`.
    - `enqueue(envelope)`: if buffer exceeds `maxMessages` or `maxBytes`, first evicts oldest `terminal.chunk` (or other droppable message) from the in-memory queue. If no droppable message exists and `NEVER_DROP_TYPES.has(envelope.type)` (or oldest is never-drop), appends overflow never-drop envelope as JSONL to `<spillDir>/spill.jsonl` so it is never lost.
    - `drain()` / `dequeue()` returns queued messages (and reads back spilled messages in order when capacity frees).
  - `RelayHarness`:
    - Connects via `ws` to `${orchestratorUrl}?taskId=${taskId}&token=${authToken}`.
    - Replies to `heartbeat.ping` with `heartbeat.pong`.
    - On `task.dispatch`: unpacks brief/config, runs optional injected `executeTaskFn` (or default execution), records file mutations via `BlastRadiusGuard`, and on Phase 3 teardown writes `.agent_status.json` (ADR-059), generates `changes.patch` (`git diff --binary --full-index HEAD` if in git repo), writes `result.json` (`version: 'delegate-relay.result.v1'`), sends `result.final` (retrying until `ack` received), and resolves cleanly with exit code `0`.
- [x] T011 [US3] Create integration test suite in `tests/integration/relay-harness.test.ts` testing:
  1. `lanes.mjs` maps `feature -> claude`, `tests -> codex`, `ui -> opencode`, `complex -> agy` and generates `--brief` args on Strike 1 vs `--session <id>` args on Strike 2.
  2. `SpendAccumulator` emits `cost.delta`, emits `budget.warning` once at 80% of `limitUsd`, and triggers emergency patch flush + `RELAY_SPEND_CEILING_HIT` at 100%.
  3. `RelayRingBuffer` drops oldest `terminal.chunk` frames when full while preserving 100% of `file.mutation`, `artifact.ready`, `cost.delta`, and `result.final` frames by spilling to disk (`spill.jsonl`).
  4. End-to-end `RelayHarness` connects to a live `buildArpServer` instance with a valid JWT, receives `task.dispatch`, streams `file.mutation` (verified `fsync`-acked), writes `.agent_status.json`, `changes.patch`, and `result.json` (`delegate-relay.result.v1`), and delivers `result.final`.

**Checkpoint**: User Story 3 is complete and independently verified by `tests/integration/relay-harness.test.ts`.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Full verification of TypeScript build, ESLint rules, Vitest suite, and master implementation plan tracking.

- [x] T012 Run `pnpm typecheck`, `pnpm lint`, `pnpm build`, and `pnpm test` across all suites and mark Tasks 7.1–7.3 `[x]` in `docs/implementation-plan-detailed.md`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1: T001)**: No dependencies — starts immediately.
- **Foundational (Phase 2: T002)**: Depends on T001.
- **User Story 1 (Phase 3: T003–T005)**: Depends on T002 (`arp-envelope.ts`).
- **User Story 2 (Phase 4: T006–T008)**: Independent of US1; can run in parallel after T001.
- **User Story 3 (Phase 5: T009–T011)**: `T009` (`lanes.mjs`) can run in parallel after T001; `T010`–`T011` (`relay.mjs` + `relay-harness.test.ts`) depend on US1 (`server.ts`) and US2 (`blast-radius-guard.mjs`).
- **Polish (Phase 6: T012)**: Depends on `T001`–`T011` completing.

### Parallel Opportunities

- `T003` (`src/orchestrator/arp/manifest-lock.ts`), `T006` (`src/relay/blast-radius-guard.mjs`), `T007` (`src/relay/git-guard.sh`), and `T009` (`src/relay/lanes.mjs`) touch completely disjoint files and can be implemented in parallel.

---

## Parallel Example: Phase 7 Modules

```bash
# Execute independent Phase 7 files in parallel:
Task T003: "Implement F14 Workspace Manifest Lock in src/orchestrator/arp/manifest-lock.ts"
Task T006: "Create synchronous BlastRadiusGuard in src/relay/blast-radius-guard.mjs"
Task T007: "Create structural Git barrier in src/relay/git-guard.sh"
Task T009: "Create delegate-fleet.v1 lanes in src/relay/lanes.mjs"
```

---

## Implementation Strategy

### MVP First (User Story 1)

1. Complete Phase 1 (`T001`) and Phase 2 (`T002`).
2. Complete Phase 3 (`T003`–`T005`) and validate the Port 3001 ARP Server & F14 Manifest Lock via `pnpm test tests/integration/arp-server.test.ts`.

### Incremental Delivery

1. Add `BlastRadiusGuard` & `git-guard.sh` (`T006`–`T008`) → Verify with `pnpm test tests/unit/blast-radius-guard.test.ts tests/unit/git-guard.test.ts`.
2. Add `lanes.mjs` & `relay.mjs` Harness (`T009`–`T011`) → Verify with `pnpm test tests/integration/relay-harness.test.ts`.
3. Run full verification (`T012`).
