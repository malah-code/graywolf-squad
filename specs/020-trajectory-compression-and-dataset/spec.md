# Feature Specification: Trajectory Compression Harvester, Privacy Redactor & Local SFT Dataset Pipeline

**Feature Branch**: `020-trajectory-compression-and-dataset`

**Created**: 2026-11-01

**Status**: Draft

**Input**: User description: "Phase 19 — Trajectory Compression Harvester, Privacy Redactor & Local SFT Dataset Pipeline (ADR-064 & ADR-079): Implement the complete Phase 3 Hermes-pattern Trajectory Compression and Supervised Fine-Tuning (SFT) dataset pipeline (ADR-064) alongside an offline System-One SLM evaluation harness (ADR-079), enabling operators to harvest high-quality completed tasks into privacy-scrubbed OpenAI/ShareGPT-compatible JSONL training sets in .agents/dataset/trajectories/YYYY-MM/."

## Clarifications

### Session 2026-11-01

- Q1: When Hermes trajectory compression splits middle turns, how should tool-call / tool-result pair boundaries be handled if the compression cutoff falls between an `assistant` tool call and a `tool` response turn? → A (Recommended): Expand the Protected Tail boundary backwards to include the parent `assistant` turn so tool-call and tool-result message pairs are never separated across compression boundaries.
- Q2: What exact path redaction rule should the Privacy Redaction Gate apply to host vs repository file paths? → A (Recommended): Redact any path matching the workspace root prefix (e.g. `/home/user/project/` or `/workspace/`) with `<REDACTED_PATH>`, but preserve relative project repository subpaths (e.g. `src/orchestrator/index.ts`) so the fine-tuning model retains code-tree navigational intelligence.
- Q3: How should the monthly trajectory directory retention pruning be scheduled or triggered? → A (Recommended): Trigger automatic retention pruning as part of the harvest lifecycle on task completion, plus expose an explicit invocation via `POST /api/v1/projects/:id/dataset/prune` for manual operator cleanup.
- Q4: For ShareGPT format export (`format=sharegpt`), how should multi-tool calling assistant turns and tool results be mapped into `conversations`? → A (Recommended): Standard ShareGPT convention: `system` maps to `{ from: 'system', value }`, user prompts map to `{ from: 'human', value }`, and assistant responses with tool calls / execution observations map to `{ from: 'gpt', value }` with tool calls serialized in standard `<tool_call>` format.
- Q5: How should the System-One SLM evaluation harness (ADR-079) integrate with harvested SFT datasets? → A (Recommended): Generate an evaluation dataset split (`.agents/dataset/eval/` or metadata flag `isEval: boolean` using a deterministic 90/10 train/eval split based on `taskId` hash) allowing offline benchmark evaluation of System-One classification accuracy against recorded ground-truth decisions.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Eligible Trajectory Harvester & Hermes Protect-Head / Tail / Summarize-Middle Compressor (Priority: P1)

An engineering team lead wants the platform to automatically evaluate completed task runs and harvest only the highest-quality, zero-defect trajectories (tasks reaching `COMPLETED` with `0` agreed `P0`/`P1` adversarial review findings and `0` two-strike escalations) when explicitly opted in (`dataset.collect = true`), compressing long middle tool-call loops using the Hermes Protect-Head / Protect-Tail / Summarize-Middle pattern so the resulting training examples fit cleanly within standard fine-tuning context windows while preserving the initial reasoning plan and final verification turns verbatim.

**Why this priority**: Collecting raw, unfiltered trajectories pollutes fine-tuning datasets with failed retries and exceeds training context windows. Filtering strictly for zero-defect completions and applying Hermes trajectory compression is the foundational requirement of ADR-064.

**Independent Test**: Can be independently tested by running the harvester and Hermes compressor against candidate task trajectories (completed zero-defect tasks vs. failed/escalated tasks vs. tasks with `P0`/`P1` findings) and verifying that ineligible tasks are rejected while eligible multi-turn trajectories preserve the head (system prompt, task brief, first assistant turn) and tail (configurable `protectTailTurns`, default `4`) verbatim and summarize middle tool sequences.

**Acceptance Scenarios**:

1. **Given** a project with `dataset.collect = true` and a completed task trajectory (`status: 'COMPLETED'`, `agreedP0P1Findings: 0`, `strikes: 0`) containing 12 conversation turns, **When** the trajectory harvester and Hermes compressor process the trajectory with default `protectTailTurns = 4`, **Then** the system preserves the system prompt, initial task brief, and first assistant turn (Head) plus the final 4 turns (Tail) verbatim, compresses the 7 middle turns into a compact semantic narration turn, and reports token reduction metrics.
2. **Given** a task trajectory that ended in `FAILED`, `CANCELLED`, `ESCALATED`, or incurred `>= 1` agreed `P0`/`P1` findings during Dev-Level-2 adversarial review, **When** evaluated by the trajectory harvester, **Then** the harvester marks the trajectory as ineligible and writes zero dataset files.
3. **Given** a project where `dataset.collect` is `false` (the default), **When** any task completes, **Then** the trajectory harvester performs a fast no-op and stores zero trajectory records.

---

### User Story 2 - Multi-Layer Privacy Redaction Gate & Monthly JSONL Storage with Retention Pruning (Priority: P1)

A security-conscious organization wants every harvested trajectory to pass through a deterministic multi-layer privacy redaction gate before disk serialization so that absolute host/workspace paths, API keys, Bearer/JWT tokens, database connection URLs, PEM private keys, git remote URLs with embedded credentials, and project-configured `sensitiveIdentifiers` are stripped, and wants trajectories stored in monthly rotated directories (`.agents/dataset/trajectories/YYYY-MM/<task-id>.jsonl`) with configurable retention pruning.

**Why this priority**: Fine-tuning datasets are often exported to external training clusters or local SLM fine-tuning pipelines; guaranteeing zero leakage of secrets, paths, or proprietary project identifiers is a non-negotiable security gate (ADR-064).

**Independent Test**: Can be independently tested by feeding trajectories containing raw API keys, DB URLs, absolute workspace paths (`/home/user/project/src/...`), git remotes, and custom `sensitiveIdentifiers` through the dataset manager and verifying 100% redaction in the persisted `.agents/dataset/trajectories/YYYY-MM/<task-id>.jsonl` file as well as deterministic pruning of expired `YYYY-MM` directories.

**Acceptance Scenarios**:

1. **Given** an eligible compressed trajectory containing an API key (`sk-...`), a PostgreSQL connection URL, an absolute workspace path (`/workspace/repo/src/index.ts`), a git remote URL (`https://token@github.com/org/private-repo.git`), and a custom project identifier (`AcmeSecretCorp`), **When** processed by the privacy redaction gate, **Then** all sensitive tokens are replaced with deterministic placeholders (`<REDACTED_SECRET>`, `<REDACTED_DB_URL>`, `<REDACTED_PATH>`, `<REDACTED_GIT_REMOTE>`, `<REDACTED_PROJECT>`) and zero raw secrets or absolute host paths appear in the serialized JSONL output.
2. **Given** harvested trajectories across multiple months (e.g., `2026-06`, `2026-09`, `2026-11`) and a retention policy of `retentionMonths = 3`, **When** retention pruning runs for reference date `2026-11`, **Then** directories older than the retention window (`2026-06`) are pruned while recent monthly directories (`2026-09`, `2026-11`) remain intact.

---

### User Story 3 - Dataset Statistics, Format Export (OpenAI / ShareGPT) & REST API Endpoints (Priority: P2)

A platform operator wants to inspect dataset health metrics (total harvested trajectories, monthly counts, average token compression ratio, total privacy redactions) and export consolidated JSONL training sets in either OpenAI chat-completion format or ShareGPT conversation format via Control Plane REST endpoints (`/api/v1/projects/:id/dataset/stats` and `/api/v1/projects/:id/dataset/export`).

**Why this priority**: Enables one-command export of the local SFT dataset into standard open-source fine-tuning frameworks (Axolotl, Unsloth, LLaMA-Factory, OpenAI SFT) without manual file concatenation.

**Independent Test**: Can be independently tested by harvesting multiple tasks into `.agents/dataset/trajectories/YYYY-MM/` and calling `GET /api/v1/projects/:id/dataset/stats` and `GET /api/v1/projects/:id/dataset/export?format=openai|sharegpt`, verifying accurate statistics and valid multi-line JSONL payloads.

**Acceptance Scenarios**:

1. **Given** a project with harvested trajectories across `.agents/dataset/trajectories/YYYY-MM/`, **When** an authenticated operator requests `GET /api/v1/projects/:id/dataset/stats`, **Then** the endpoint returns HTTP `200` with total trajectory count, per-month breakdown, total tokens before/after compression, and total redaction count.
2. **Given** a project with harvested trajectories, **When** an authenticated operator requests `GET /api/v1/projects/:id/dataset/export?format=openai` or `format=sharegpt`, **Then** the endpoint returns consolidated JSONL entries formatted for the requested training schema (`messages` with `role`/`content`/`tool_calls` for OpenAI; `conversations` with `from`/`value` for ShareGPT).

---

### Edge Cases

- **Short Trajectories Below Compression Threshold**: When an eligible trajectory has fewer turns than `1 (first assistant turn) + protectTailTurns` (e.g., $\le 5$ turns total with `protectTailTurns = 4`), the Hermes compressor MUST perform a safe no-op on middle compression, preserving all turns verbatim while still running the mandatory privacy redaction gate.
- **Auxiliary Summarizer Timeout or Offline Fallback**: If an optional auxiliary LLM summarizer is unavailable or throws an error during middle-turn compression, the Hermes compressor MUST fall back deterministically to structured turn-by-turn semantic narration (`[Turn N | role | tools: ...] <sanitized snippet>`) so harvesting never fails or blocks task completion.
- **Tool-Call Structural Integrity**: When compressing middle turns, tool-call and tool-result pairs inside the protected head or protected tail MUST never be split across the compression boundary, ensuring valid tool-calling message sequences for strict SFT trainers.
- **Path Traversal & Month Filter Validation**: Requests to `/api/v1/projects/:id/dataset/export?month=YYYY-MM` with malformed month strings (e.g. `../../etc`) MUST be rejected with HTTP `400` (`ACI_VALIDATION_FAILED`).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST provide an Eligible Trajectory Harvester (`src/orchestrator/learning/trajectory-harvester.ts`) that filters candidate task trajectories and accepts strictly tasks where `dataset.collect === true`, terminal status is `COMPLETED`, `strikes === 0`, and `agreedP0P1Findings === 0` (ADR-064).
- **FR-002**: System MUST provide a Hermes-faithful Trajectory Compressor (`src/orchestrator/learning/trajectory-compressor.ts`) implementing Protect-Head (system prompt + initial task brief + first assistant turn), Protect-Tail (configurable `protectTailTurns`, default `4` turns), and Summarize-Middle (compressing intermediate tool-call/observation sequences into a compact semantic narration with deterministic fallback).
- **FR-003**: System MUST preserve tool-call/tool-response pairing integrity at compression boundaries so that no orphan `tool` role message starts the Protected Tail without its preceding `assistant` tool-call turn.
- **FR-004**: System MUST enforce a deterministic Multi-Layer Privacy Redaction Gate (`src/orchestrator/learning/dataset-manager.ts`) prior to persisting any trajectory, scrubbing API keys/tokens, Bearer/JWT headers, database connection URLs, PEM private keys, git remote URLs with credentials, absolute workspace file paths (`workspaceRoot` $\rightarrow$ `<REDACTED_PATH>`), and project-configured `sensitiveIdentifiers` ($\rightarrow$ `<REDACTED_PROJECT>`).
- **FR-005**: System MUST persist harvested trajectories as JSONL files under `.agents/dataset/trajectories/YYYY-MM/<task-id>.jsonl` with monthly directory rotation and configurable retention pruning (`pruneExpiredTrajectoryMonths(baseDir, retentionMonths, referenceDate)`).
- **FR-006**: System MUST support exporting harvested trajectories in both OpenAI chat-completion SFT format (`messages: [{ role, content, tool_calls? }]`) and ShareGPT format (`conversations: [{ from: 'system' | 'human' | 'gpt' | 'tool', value }]`).
- **FR-007**: System MUST expose Fastify Control Plane REST endpoints (`src/orchestrator/routes/dataset.ts`) at `GET /api/v1/projects/:id/dataset/stats` and `GET /api/v1/projects/:id/dataset/export` (supporting optional `format=openai|sharegpt` and `month=YYYY-MM` query parameters validated by TypeBox schemas).
- **FR-008**: System MUST include automated unit and integration test suites (`tests/unit/trajectory-compressor.test.ts` and `tests/integration/trajectory-dataset-pipeline.test.ts`) verifying eligibility filtering, Hermes head/tail/middle compression, boundary tool-call integrity, multi-layer privacy redaction, monthly rotation/pruning, and REST export endpoints.

### Key Entities

- **Candidate Task Trajectory (`CandidateTaskTrajectory`)**: Raw post-task execution record containing `taskId`, `projectId`, `workspaceId`, `status`, `strikes`, `agreedP0P1Findings`, `modelAlias`, `systemPrompt`, `taskBrief`, `turns`, and `completedAt`.
- **Hermes Compressed Trajectory (`HermesCompressedTrajectory`)**: Output of the Hermes compressor containing `protectedHead`, `middleSummary` (or `null` when uncompressed), `protectedTail`, `messages`, `tokensBefore`, `tokensAfter`, and `compressionRatio`.
- **Dataset Trajectory Record (`DatasetTrajectoryRecord`)**: Privacy-scrubbed JSONL training entry written to `.agents/dataset/trajectories/YYYY-MM/<task-id>.jsonl` with `messages`, `metadata` (`taskId`, `projectId`, `modelAlias`, `compressed`, `tokensBefore`, `tokensAfter`, `redactionCount`, `harvestedAt`).
- **Dataset Stats Summary (`DatasetStatsSummary`)**: Aggregated project dataset telemetry (`totalTrajectories`, `months: Array<{ month, count }>`, `totalTokensBefore`, `totalTokensAfter`, `totalRedactions`).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of trajectories from failed, cancelled, escalated, or P0/P1-flawed tasks (or projects with `dataset.collect = false`) are excluded from the SFT dataset.
- **SC-002**: 100% of long eligible trajectories ($> 6$ turns) compressed with default Hermes settings preserve the head (system prompt, task brief, first assistant turn) and tail (last 4 turns, adjusted for tool-call pair integrity) byte-for-byte prior to privacy scrubbing while reducing middle-turn token volume.
- **SC-003**: 100% of synthetic secrets, database URLs, PEM keys, git credential URLs, absolute workspace paths, and configured `sensitiveIdentifiers` injected in test suites are redacted before disk write.
- **SC-004**: 100% of unit and integration tests for Phase 19 (`tests/unit/trajectory-compressor.test.ts` and `tests/integration/trajectory-dataset-pipeline.test.ts`) pass with zero regressions across the repository test suite.

## Assumptions

- Project dataset configuration (`dataset.collect`, `dataset.protectTailTurns`, `dataset.retentionMonths`, `dataset.sensitiveIdentifiers`) can be supplied via project configuration or per-call options, defaulting to `collect: false`, `protectTailTurns: 4`, and `retentionMonths: 12`.
- Existing primitive helpers in `src/orchestrator/learning/compression.ts` and `src/orchestrator/learning/trajectory-export.ts` remain backward-compatible for Phase 14 tests while the new Phase 19 modules (`trajectory-harvester.ts`, `trajectory-compressor.ts`, `dataset-manager.ts`, `routes/dataset.ts`) implement the full ADR-064 pipeline.

