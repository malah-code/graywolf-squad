---
description: "Task list for Phase 19 — Trajectory Compression Harvester, Privacy Redactor & Local SFT Dataset Pipeline (ADR-064 & ADR-079)"
---

# Tasks: Trajectory Compression Harvester, Privacy Redactor & Local SFT Dataset Pipeline

**Input**: Design documents from `/specs/020-trajectory-compression-and-dataset/`

**Prerequisites**: `plan.md` (required), `spec.md` (required for user stories), `research.md`, `data-model.md`, `contracts/dataset-api.md`, `quickstart.md`

**Tests**: Automated unit and integration test suites are explicitly required per `FR-008` and `SC-004`.

**Organization**: Tasks are grouped by user story (`US1` Harvester & Hermes Compressor, `US2` Multi-Layer Privacy Redaction & Monthly Rotation/Pruning, `US3` Dataset Stats, ShareGPT/OpenAI Export & REST API) so each slice can be implemented and verified independently.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (`[US1]`, `[US2]`, `[US3]`)
- Exact file paths and verbatim constraints are included in every task description

---

## Phase 1: User Story 1 - Eligible Trajectory Harvester & Hermes Protect-Head / Tail / Summarize-Middle Compressor (Priority: P1) 🎯 MVP (Task 19.1)

**Goal**: Filter completed task trajectories strictly for zero-defect runs (`dataset.collect === true`, `status === 'COMPLETED'`, `strikes === 0`, `agreedP0P1Findings === 0`), compute a deterministic 90/10 `train` / `eval` split, and compress long middle tool-call loops using the Hermes Protect-Head / Protect-Tail / Summarize-Middle pattern while preserving tool-call/tool-result pair boundaries.

**Independent Test**: `pnpm test tests/unit/trajectory-compressor.test.ts`

### Implementation for User Story 1

- [x] T001 [P] [US1] Implement `compressHermesTrajectory(options)` and `buildHermesMiddleNarration(middleTurns)` in `src/orchestrator/learning/trajectory-compressor.ts` enforcing Protected Head (system prompt + initial task brief + first `assistant` turn and any immediately paired `tool` response turns), Protected Tail (configurable `protectTailTurns`, default `4`, expanded backwards when the first tail turn has `role === 'tool'` so `assistant` $\rightarrow$ `tool` pairs are never split across the compression boundary), and Summarize-Middle with deterministic fallback (`FR-002`, `FR-003`, `SC-002`)
- [x] T002 [US1] Implement `computeTrajectorySplit(taskId)` (deterministic 90/10 `train` / `eval` split from SHA-256 of `taskId`), `evaluateTrajectoryEligibility(candidate, config)` (strictly requiring `config.collect === true && candidate.status === 'COMPLETED' && candidate.strikes === 0 && candidate.agreedP0P1Findings === 0`), and `harvestEligibleTrajectory(candidate, config, options)` in `src/orchestrator/learning/trajectory-harvester.ts` (`FR-001`, `SC-001`)
- [x] T003 [US1] Create unit test suite in `tests/unit/trajectory-compressor.test.ts` verifying eligibility filtering (completed zero-defect tasks vs. failed/escalated/P0-flawed tasks or `collect: false`), Hermes Protect-Head / Protect-Tail (`default 4`) / Summarize-Middle compression, backward tail expansion for tool-call/tool-result pair integrity, short-trajectory no-op, offline summarizer fallback, and deterministic 90/10 train/eval split (`FR-001`, `FR-002`, `FR-003`, `FR-008`, `SC-001`, `SC-002`, `SC-004`)

**Checkpoint**: User Story 1 (`Task 19.1`) is independently complete and verified via `tests/unit/trajectory-compressor.test.ts`.

---

## Phase 2: User Story 2 - Multi-Layer Privacy Redaction Gate & Monthly JSONL Storage with Retention Pruning (Priority: P1) (Task 19.2a)

**Goal**: Scrub absolute workspace root paths (`<REDACTED_PATH>`), git remote URLs (`<REDACTED_GIT_REMOTE>`), API keys/tokens (`<REDACTED_SECRET>`), Bearer headers, database URLs, PEM private keys, and project-configured `sensitiveIdentifiers` (`<REDACTED_PROJECT>`) while preserving relative repository paths (`src/...`), and persist JSONL trajectories under `.agents/dataset/trajectories/YYYY-MM/<taskId>.jsonl` with monthly retention pruning.

**Independent Test**: `pnpm test tests/integration/trajectory-dataset-pipeline.test.ts`

### Implementation for User Story 2

- [x] T004 [P] [US2] Implement `redactTrajectoryPrivacy(rawText, options)` (scrubbing `workspaceRoot` prefixes $\rightarrow$ `<REDACTED_PATH>` while preserving relative repository subpaths, git remote URLs $\rightarrow$ `<REDACTED_GIT_REMOTE>`, API keys/tokens $\rightarrow$ `<REDACTED_SECRET>`, Bearer headers $\rightarrow$ `Bearer <REDACTED_TOKEN>`, DB URLs $\rightarrow$ `<REDACTED_DB_URL>`, PEM private keys $\rightarrow$ `<REDACTED_PRIVATE_KEY>`, and `sensitiveIdentifiers` $\rightarrow$ `<REDACTED_PROJECT>`) and `pruneExpiredTrajectoryMonths(outputBaseDir, retentionMonths, referenceDate)` in `src/orchestrator/learning/dataset-manager.ts` (`FR-004`, `FR-005`, `SC-003`)

**Checkpoint**: Multi-layer privacy redaction and monthly rotation/pruning are complete in `src/orchestrator/learning/dataset-manager.ts`.

---

## Phase 3: User Story 3 - Dataset Statistics, Format Export (OpenAI / ShareGPT) & REST API Endpoints (Priority: P2) (Task 19.2b)

**Goal**: Provide OpenAI and ShareGPT format export, dataset health statistics, and Fastify Control Plane REST endpoints (`GET /api/v1/projects/:id/dataset/stats`, `GET /api/v1/projects/:id/dataset/export`, `POST /api/v1/projects/:id/dataset/prune`).

**Independent Test**: `pnpm test tests/integration/trajectory-dataset-pipeline.test.ts`

### Implementation for User Story 3

- [x] T005 [US3] Implement `convertToShareGptFormat(record)` (mapping `system` $\rightarrow$ `{ from: 'system' }`, `user` $\rightarrow$ `{ from: 'human' }`, and `assistant`/`tool` turns $\rightarrow$ `{ from: 'gpt' }` with `<tool_call>` serialization), `getDatasetStats(projectId, outputBaseDir)`, and `exportDatasetJsonl(options)` in `src/orchestrator/learning/dataset-manager.ts` (`FR-006`)
- [x] T006 [US3] Implement Fastify plugin `datasetRoutes` in `src/orchestrator/routes/dataset.ts` exposing `GET /api/v1/projects/:id/dataset/stats`, `GET /api/v1/projects/:id/dataset/export` (validating `format=openai|sharegpt`, `split=train|eval|all`, and `month=YYYY-MM` regex `^\d{4}-(0[1-9]|1[0-2])$` with `400 ACI_VALIDATION_FAILED` on invalid query), and `POST /api/v1/projects/:id/dataset/prune` (`FR-007`)
- [x] T007 [US2] [US3] Create integration test suite in `tests/integration/trajectory-dataset-pipeline.test.ts` verifying end-to-end harvesting, multi-layer privacy redaction (zero raw secret or workspace root leakage while preserving relative paths), monthly directory rotation and retention pruning, and REST API endpoints (`GET /stats`, `GET /export?format=openai|sharegpt`, `POST /prune`, and `400 ACI_VALIDATION_FAILED` on path-traversal `month` parameter) (`FR-004`, `FR-005`, `FR-006`, `FR-007`, `FR-008`, `SC-003`, `SC-004`)

**Checkpoint**: User Stories 2 & 3 (`Task 19.2`) are complete and verified via `tests/integration/trajectory-dataset-pipeline.test.ts`.

---

## Phase 4: Polish & Cross-Cutting Verification

**Purpose**: Run full repository typecheck, lint, build, and test suite verification, and mark Tasks 19.1–19.2 complete in `docs/implementation-plan-detailed.md`.

- [x] T008 Run `pnpm typecheck`, `pnpm lint`, `pnpm build`, and `pnpm test` across all repository suites, and mark Tasks 19.1 and 19.2 `[x]` in `docs/implementation-plan-detailed.md` (`SC-004`)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (`T001`)** and **Phase 2 (`T004`)**: Operate on independent files (`trajectory-compressor.ts` and `dataset-manager.ts`) and can be developed in parallel (`[P]`).
- **Phase 1 Harvester (`T002`)**: Depends on `T001` (`compressHermesTrajectory`) and `T004` (`redactTrajectoryPrivacy` / `pruneExpiredTrajectoryMonths`).
- **Phase 3 (`T005`, `T006`, `T007`)**: Depends on `T002` and `T004`.
- **Phase 4 (`T008`)**: Depends on `T001`–`T007` passing cleanly.

### Parallel Opportunities

- `T001` (`src/orchestrator/learning/trajectory-compressor.ts`) and `T004` (`src/orchestrator/learning/dataset-manager.ts`) touch separate files and can be built in parallel.

