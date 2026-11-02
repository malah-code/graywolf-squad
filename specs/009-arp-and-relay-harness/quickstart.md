# Quickstart & Validation Guide: 009-arp-and-relay-harness

**Feature Branch**: `009-arp-and-relay-harness`  
**Date**: 2026-10-18

## Prerequisites

- Node.js 20+ and `pnpm`
- Git CLI and `bash` available on `PATH`

## Validation Commands

1. **ARP Port 3001 Server & F14 Manifest Lock Integration Tests**:
   ```bash
   pnpm test tests/integration/arp-server.test.ts
   ```
   - Verifies `RelayEnvelope` schema validation, 5-minute JWT handshake (`4001` on invalid token, `4004` on unknown task), idempotent `(taskId, seq)` `file.mutation` ingestion with `fsync`-before-ack, `complete` vs `gapped` sequence tracking, 3-strike heartbeat timeout (`4010`), and F14 manifest lock grant/contention/release.

2. **Synchronous `BlastRadiusGuard` & `git-guard.sh` Unit Tests**:
   ```bash
   pnpm test tests/unit/blast-radius-guard.test.ts tests/unit/git-guard.test.ts
   ```
   - Verifies Rule 0 Always-Forbidden paths (`.git/**`, `.agents/project.config.json`, `.agents/constitution.md`, `relay.mjs`), `forbiddenGlobs` (`RELAY_BLAST_RADIUS_VIOLATION` exit code 2), `writableGlobs` (`'allow'`), `readonlyGlobs` & default deny (`'escalate'`), and `git-guard.sh` exit code `2` on `git commit` / `git push` / `git rebase` / `git reset --hard`.

3. **In-Container `relay.mjs` Harness & `lanes.mjs` Integration Tests**:
   ```bash
   pnpm test tests/integration/relay-harness.test.ts
   ```
   - Verifies `lanes.mjs` (`feature -> claude`, `tests -> codex`, `ui -> opencode`, `complex -> agy` + Strike 1 `--brief` vs Strike 2 `--session`), `SpendAccumulator` (80% warning, 100% emergency patch + halt), `RelayRingBuffer` (1000 msgs / 10MB cap, dropping `terminal.chunk` while spilling `file.mutation`/`result.final` to `/scratch/spill/`), and end-to-end `RelayHarness` execution against the Port 3001 ARP server producing `.agent_status.json`, `changes.patch`, `result.json`, and `result.final`.

4. **Full Build, Lint, and Typecheck Verification**:
   ```bash
   pnpm typecheck
   pnpm lint
   pnpm build
   pnpm test
   ```
