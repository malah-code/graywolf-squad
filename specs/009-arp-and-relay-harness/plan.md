# Implementation Plan: 009-arp-and-relay-harness

**Branch**: `009-arp-and-relay-harness` | **Date**: 2026-10-18 | **Spec**: [specs/009-arp-and-relay-harness/spec.md](./spec.md)
**Input**: Feature specification from `/specs/009-arp-and-relay-harness/spec.md` and Phase 7 of `docs/implementation-plan-detailed.md`

## Summary

Implement the Phase 7 Agent Relay Protocol (ARP Port 3001), F14 Workspace Manifest Lock, Synchronous `BlastRadiusGuard`, Structural Git Write Barrier (`git-guard.sh`), and In-Container `relay.mjs` Harness & `delegate-fleet.v1` Lanes:
1. **ARP Envelope Schema, Port 3001 Server & F14 Manifest Lock (`src/orchestrator/schemas/arp-envelope.ts`, `src/orchestrator/arp/server.ts`, `src/orchestrator/arp/manifest-lock.ts`)**: Define TypeBox schemas for `RelayEnvelope` and all 10 `c2e` and 12 `e2c` message types; authenticate `ws://orchestrator:3001/relay?taskId=...&token=...` using a 5-minute HMAC-SHA256 JWT (`4001` on invalid token, `4004` on unknown task); implement idempotent `(taskId, seq)` `file.mutation` ingestion with `fsync`-before-ack and `reconstructionFidelity: 'complete' | 'gapped'` tracking; implement a 15s `heartbeat.ping`/`pong` monitor (3 missed pings -> `4010` / `SANDBOX_HEARTBEAT_TIMEOUT`); and implement F14 `manifest-lock.ts` using Valkey mutex `workspace:{workspace_id}:lock:manifest:{hash(manifest_path)}` (60s TTL, 120s wait timeout).
2. **Synchronous `BlastRadiusGuard` & `git-guard.sh` (`src/relay/blast-radius-guard.mjs`, `src/relay/git-guard.sh`)**: Enforce Rule 0 Always-Forbidden paths (`.git/**`, `.agents/project.config.json`, `.agents/constitution.md`, `relay.mjs`), `forbiddenGlobs` (`RELAY_BLAST_RADIUS_VIOLATION` exit code 2), `writableGlobs` (`'allow'`), `readonlyGlobs` & default deny (`'escalate'`); and intercept `git commit`, `git push`, `git merge`, `git rebase`, `git reset --hard` with exit code 2 (`RELAY_GIT_BARRIER_VIOLATION`).
3. **In-Container `relay.mjs` Harness & `delegate-fleet.v1` Lanes (`src/relay/lanes.mjs`, `src/relay/relay.mjs`)**: Implement `lanes.mjs` (`feature -> claude`, `tests -> codex`, `ui -> opencode`, `complex -> agy` + Strike 1 `--brief` vs Strike 2 `--session <id>`); and implement `relay.mjs` with `SpendAccumulator` (80% `budget.warning`, 100% emergency patch + `RELAY_SPEND_CEILING_HIT`), `RelayRingBuffer` (1000 msgs / 10MB, dropping `terminal.chunk` while spilling never-dropped `file.mutation`/`artifact.ready`/`cost.delta`/`result.final` to `/scratch/spill/`), and Phase 3 `.agent_status.json` + `changes.patch` + `result.json` (`delegate-relay.result.v1`) + `result.final` teardown.

## Technical Context

**Language/Version**: TypeScript 5.8+ (`src/orchestrator/`) + ES Modules `.mjs` (`src/relay/*.mjs`) + Bash (`src/relay/git-guard.sh`) on Node.js 20+  
**Primary Dependencies**: `@fastify/websocket` (`^11.3.0`), `ws` (`^8.18.3`), `@sinclair/typebox` (`^0.34.47`), `picomatch` (`^4.0.2`), `node:crypto`, `node:fs`  
**Storage**: Host `.agents/tasks/<TASK_ID>/ledger/mutation_stream.log` (`fsync`-before-ack), Valkey (`workspace:{workspaceId}:lock:manifest:{hash}`), and container `/scratch/spill/`  
**Testing**: Vitest (`tests/integration/arp-server.test.ts`, `tests/unit/blast-radius-guard.test.ts`, `tests/unit/git-guard.test.ts`, `tests/integration/relay-harness.test.ts`)  
**Target Platform**: Linux / Dockerized Host Orchestrator (Port 3001) & Ephemeral Runner Container (`/relay/relay.mjs`)  
**Project Type**: Bidirectional Agent Relay Protocol & Sandbox Harness  
**Performance Goals**: `<1ms` synchronous `BlastRadiusGuard` evaluation; `fsync`-before-ack persistence per `file.mutation`  
**Constraints**: Non-committing relay contract (`git-guard.sh` exit code 2); Rule 0 Always-Forbidden protection; never-drop guarantee for `file.mutation`, `artifact.ready`, `cost.delta`, `result.final`  
**Scale/Scope**: Phase 7 of `docs/implementation-plan-detailed.md` (Tasks 7.1–7.3)

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **Principle 1 (Human Sovereignty & Non-Committing Relay Contract)**: ✅ PASS — `git-guard.sh` structurally blocks `git commit`, `git push`, `git merge`, `git rebase`, and `git reset --hard` with exit code `2` (`RELAY_GIT_BARRIER_VIOLATION`), and `relay.mjs` outputs `changes.patch` + `result.json`.
- **Principle 2 & 9 (Zero Runtime Lock-In & Permissive Open Source)**: ✅ PASS — Built on `ws` (MIT), `@fastify/websocket` (MIT), `picomatch` (MIT), and Valkey (BSD-3-Clause).
- **Principle 4 (Headless Execution & Observability)**: ✅ PASS — Typed `RelayEnvelope` streams `event.stream`, `terminal.chunk`, `cost.delta`, and `file.mutation` over Port 3001.
- **Principle 5 (Dual Operational Mode: Greenfield & Brownfield)**: ✅ PASS — `BlastRadiusGuard` enforces Rule 0 Always-Forbidden system files plus `forbiddenGlobs`, `writableGlobs`, `readonlyGlobs`, and fail-closed default deny.

## Project Structure

### Documentation (this feature)

```text
specs/009-arp-and-relay-harness/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output (/speckit-plan command)
├── data-model.md        # Phase 1 output (/speckit-plan command)
├── quickstart.md        # Phase 1 output (/speckit-plan command)
├── contracts/
│   └── arp-and-relay.md
└── tasks.md             # Phase 2 output (/speckit-tasks command)
```

### Source Code (repository root)

```text
src/
├── orchestrator/
│   ├── schemas/
│   │   └── arp-envelope.ts            # Task 7.1: RelayEnvelope TypeBox schemas + JWT helpers
│   └── arp/
│       ├── manifest-lock.ts           # Task 7.1: F14 Valkey workspace manifest mutex
│       └── server.ts                  # Task 7.1: Port 3001 ARP WS server, fsync-before-ack & heartbeats
└── relay/
    ├── blast-radius-guard.mjs         # Task 7.2: Synchronous BlastRadiusGuard (Rule 0..4)
    ├── git-guard.sh                   # Task 7.2: Structural Git write barrier
    ├── lanes.mjs                      # Task 7.3: delegate-fleet.v1 lanes & Two-Strike CLI session args
    └── relay.mjs                      # Task 7.3: SpendAccumulator, RelayRingBuffer & RelayHarness

tests/
├── unit/
│   ├── blast-radius-guard.test.ts     # Task 7.2 verification
│   └── git-guard.test.ts              # Task 7.2 verification
└── integration/
    ├── arp-server.test.ts             # Task 7.1 verification
    └── relay-harness.test.ts          # Task 7.3 verification
```

**Structure Decision**: Matches the exact file paths and module boundaries specified in `docs/implementation-plan-detailed.md` Phase 7 (Tasks 7.1–7.3).

## Complexity Tracking

No constitution violations or complexity exemptions required.
