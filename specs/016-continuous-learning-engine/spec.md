# Feature Specification: Continuous Learning Engine, Stall Guardrails & Context Compression

**Feature Branch**: `016-continuous-learning-engine`

**Created**: 2026-11-01

**Status**: Draft

**Input**: User description: "Phase 14 Continuous Learning Engine, Stall Guardrails & Context Compression: Implement the Hermes-inspired 3-Tier Continuous Learning Loop (docs/PRD.md §9): 3-Axis Background Reflection Worker & Human Gate Diff Learner (ADR-057, ADR-083), Weekly Skill Curator Job (ADR-063), Stall Detection Guardrails & Terminal-State Protocol Contract (ADR-058, ADR-059), Auxiliary Context Compressor (ADR-060), DSPy-Inspired Prompt Compilation Harness (ADR-068), and Opt-In Trajectory Exporter (ADR-064)."

## Clarifications

### Session 2026-11-01

- Q: What cosine similarity threshold and top-k limit should the context engine use when retrieving project lessons and anti-patterns for Dev-Level-1 planning? (FR-001) → A: Cosine similarity >= 0.75, capped at top-5 lessons and top-3 anti-patterns.
- Q: How should the Skill Curator detect overlapping `agent-created` skills and store the human-gated consolidation proposal when `curator.consolidate = true`? (FR-003) → A: Pre-filter `agent-created` skill pairs using Jaccard token similarity >= 0.50 across `description` and `When to Use` sections, and write the unified markdown diff proposal to `.agents/skills/.proposals/consolidation-<YYYY-MM-DD>.diff.md` for `lead_dev` approval.
- Q: How should the Stall Detector normalize command outputs and diffs before comparing them for exact-failure streaks, multi-call cycles, and stuck-loop heuristics? (FR-004) → A: Strip volatile tokens (ISO timestamps, millisecond durations, PIDs, and `/tmp/` random suffixes) and whitespace before comparing SHA-256 signatures of `(command + args + exitCode + normalizedOutput)`.
- Q: What redaction rules and JSONL record structure should the Trajectory Exporter enforce before writing fine-tuning datasets to disk? (FR-007) → A: Apply a deterministic multi-pattern scrubber across all turns (redacting API keys, Bearer/JWT tokens, database URLs, PEM keys, `.env` assignments, and replacing workspace/org/project names with `<REDACTED_PROJECT>`) and write OpenAI-compatible JSONL (`{"messages": [...], "metadata": {"taskId", "modelAlias", "strikes": 0, "compressed": true}}`).
- Q: How should the Prompt Compilation Harness (`scripts/prompts-compile.ts`) score candidate prompt variants per model alias and store the winning compiled artifacts? (FR-007) → A: Score each candidate prompt variant in `prompts/` against golden evaluation fixtures using a weighted composite metric (`0.5 * schemaCompliance + 0.3 * constraintAdherence + 0.2 * tokenEfficiency`) and write the winning artifact per alias to `prompts/compiled/<alias>.prompt.json`.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - 3-Axis Background Reflection & Human Gate Diff Learning (Priority: P1)

As an engineering lead operating a compound-learning squad (ADR-057, ADR-083, PRD §9.2–9.4), I need a low-priority background reflection worker (`src/orchestrator/learning/reflection-worker.ts`) and human gate diff learner (`src/orchestrator/learning/human-gate-diff.ts`) that analyze completed or failed tasks across three axes—**Project Memory**, **Skill Library** (`.agents/skills/`), and **Anti-Pattern Registry**—and capture the delta between agent-generated patches (`changes.patch`) and human-modified merged code (`final_merged_code`) as 768-dimensional vector embeddings in `project_lessons` so the squad never repeats the same mistake twice.

**Why this priority**: Transforms one-off agent runs and human review corrections into durable, searchable institutional memory, reusable procedures, and negative planner constraints without blocking active task execution.

**Independent Test**: Can be tested by executing the reflection worker on synthetic terminal tasks (completed, Gate 4 guard failure, ADR-056 debate rejection) and running the human gate diff learner on a modified merge diff, verifying Hermes-strict skill authoring rules, exclusion of prohibited skill categories, anti-pattern logging, and 768-dimensional lesson persistence.

**Acceptance Scenarios**:

1. **Given** a task reaching a terminal state (`MERGED`, `FAILED`, `VERIFICATION_FAILED`, or `HUMAN_REVIEW_GATE`), **When** the low-priority reflection job executes, **Then** it evaluates all 3 axes (Project Memory, Skill Library, and Anti-Pattern Registry) without blocking active task execution queues.
2. **Given** a generalizable procedure discovered during reflection, **When** a skill file is authored or updated in `.agents/skills/`, **Then** it enforces the Hermes-strict format (`name` lowercase-hyphenated `<= 64` chars, one-sentence `description` `<= 60` chars ending with a period and free of marketing buzzwords, `version: 0.1.0`, and mandatory section order: `Title -> When to Use -> Prerequisites -> How to Run -> Quick Reference -> Procedure -> Pitfalls -> Verification`) while strictly rejecting environment failures, negative tool claims, transient errors, one-off narratives, and unresolved dead ends.
3. **Given** a task that triggered Gate 4 deterministic guard failures (`test-guard`, `clean-code-guard`) or ADR-056 adversarial debate rejections, **When** reflection runs, **Then** it records the failure pattern into the searchable Anti-Pattern Registry (`project_lessons` with anti-pattern category `LLM_CODE_SMELL` or `TEST_INTEGRITY`) for injection as negative constraints into future Dev-Level-1 plans.
4. **Given** a human reviewer who edits an agent's patch (`changes.patch`) before merging (`final_merged_code`), **When** `learnFromHumanGateDiff` runs, **Then** it computes the delta between agent output and final merged code, classifies the correction type (`logic_error`, `convention_violation`, `missing_edge_case`, `performance_issue`, `security_fix`), generates a 768-dimensional embedding (`nomic-embed-text`), and stores the lesson in `project_lessons`.

---

### User Story 2 - Autonomous Weekly Skill Curator Lifecycle (Priority: P1)

As a platform administrator maintaining a clean `.agents/skills/` catalog (ADR-063, PRD §9.5), I need a repeatable weekly curator job (`src/orchestrator/learning/skill-curator.ts`) that transitions `agent-created` skills through `active -> stale -> archived -> deleted` based on usage recency while never auto-patching `user-created` skills or archiving `pinned` skills, and optionally generates a human-gated consolidation diff when `curator.consolidate = true`.

**Why this priority**: Prevents skill library bloat and stale procedural guidance while guaranteeing complete human sovereignty over user-authored and pinned skills.

**Independent Test**: Can be tested by running the Skill Curator against a fixture skill catalog containing `agent-created`, `user-created`, and `pinned` skills with varying last-used timestamps (`0d`, `15d`, `35d`, `95d`) and verifying exact state transitions, `.archive/` file movement, operator approval gating for 90+ day deletion, and opt-in markdown consolidation diff generation.

**Acceptance Scenarios**:

1. **Given** an `agent-created` skill in `.agents/skills/`, **When** the weekly Skill Curator evaluates skill usage timestamps, **Then** it transitions skills unused for `>= 14` days from `active` to `stale`, moves skills unused for `>= 30` days from `stale` to `archived` (relocating them to `.agents/skills/.archive/`), and marks `archived` skills older than `>= 90` days as `pending_deletion` requiring explicit operator approval before permanent removal.
2. **Given** a skill classified as `user-created` or marked `pinned: true`, **When** the Skill Curator executes lifecycle sweeps or consolidation passes, **Then** `user-created` skills are never auto-patched and `pinned` skills are never transitioned to `stale` or `archived` regardless of inactivity duration.
3. **Given** a project with `curator.consolidate = true` and overlapping `agent-created` skills, **When** the Skill Curator runs its consolidation pass, **Then** it produces a human-gated markdown consolidation diff proposal without applying mutations until a lead developer approves.

---

### User Story 3 - Tool-Loop Stall Detection Guardrails & Terminal-State Protocol Contract (Priority: P1)

As an orchestrator reliability engineer preventing runaway token burn and silent container exits (ADR-058, ADR-059, PRD §6 & §9.8–9.9), I need a stall detector (`src/orchestrator/learning/stall-detector.ts`) that detects exact-failure streaks, multi-call cycles, per-turn command floods, and identical action-observation/diff loops, and a terminal-state status verifier (`src/orchestrator/learning/status-protocol.ts`) that validates `.agent_status.json` on `rc=0` container exit with up to 2 synthetic re-entry nudges before escalating.

**Why this priority**: Stops stuck agent loops before they exhaust task budgets and guarantees every container exit produces a deterministic, machine-validated terminal status contract.

**Independent Test**: Can be tested by feeding synthetic command/tool streams into `StallDetector` (3x warning vs 5x hard-interrupt on exact failures and `A->B->A->B` cycles of period `<= 4`, `> 50` commands in a single turn, 4 identical action-observations, 3 identical diffs) and testing `verifyTerminalStatusProtocol` across valid `.agent_status.json` files vs missing/invalid files across Nudge 1, Nudge 2, and final `protocol_violation` escalation.

**Acceptance Scenarios**:

1. **Given** an active agent command/tool stream, **When** the same command with identical failure output repeats `3` consecutive times OR a multi-call cycle (`A -> B -> A -> B` with period `<= 4` and identical arguments/results) completes `3` laps, **Then** `StallDetector` emits a structured warning nudge; when either reaches `5` consecutive occurrences/laps (or `4` identical action-observations or `3` identical git diffs per PRD §6), **Then** it triggers a hard-interrupt, transitions the task to `STALL_ESCALATED`, increments the Two-Strike counter, and attaches a diagnostic stall report.
2. **Given** an agent turn executing terminal commands, **When** the command count in a single turn exceeds `50`, **Then** `StallDetector` enforces a hard-cap and injects a turn-limit nudge.
3. **Given** a task container exiting with return code `0`, **When** `verifyTerminalStatusProtocol` checks `<worktree>/.agent_status.json`, **Then** it validates the file against the canonical contract (`status: 'patch_ready' | 'blocked' | 'needs_clarification'`, `summary`, `artifacts`, `exit_reason`); if missing or schema-invalid, it issues up to `2` synthetic re-entry nudges, and after `2` failed nudges marks the run `protocol_violation`, increments the Two-Strike counter, and escalates to human review.

---

### User Story 4 - 80% Auxiliary Context Compressor, Prompt Compiler & Opt-In Trajectory Export (Priority: P2)

As an operator running long multi-turn tasks and optimizing model portability (ADR-060, ADR-061, ADR-064, ADR-068, PRD §9.6, §9.7, §9.11), I need a context compressor (`src/orchestrator/learning/compression.ts`) that triggers at `> 80%` context utilization (or manual operator `CompactContextButton` click) to summarize the middle turns while preserving the Protected Head and Protected Tail untouched, a prompt compilation harness (`scripts/prompts-compile.ts`) evaluating prompt variants per target model alias, and an opt-in trajectory exporter (`src/orchestrator/learning/trajectory-export.ts`) that redacts sensitive data and exports 0-strike successful trajectories to `.agents/dataset/trajectories/YYYY-MM/`.

**Why this priority**: Prevents context window overflow on complex tasks without breaking prompt prefix caching (ADR-061), automates prompt tuning across model families, and builds a clean fine-tuning dataset with strict privacy controls.

**Independent Test**: Can be tested by compressing a 20-turn conversation exceeding 80% token capacity (verifying Protected Head = system prompt + brief + first 2 turns and Protected Tail = last 8 turns remain byte-for-byte identical, plus deterministic heuristic fallback when the auxiliary model fails), running `prompts-compile.ts` across prompt variants, and exporting a 0-strike trajectory with `dataset.collect = true` vs `false` while verifying secret/identifier redaction.

**Acceptance Scenarios**:

1. **Given** an active session whose estimated token count exceeds `80%` of the model's context window (or when triggered via `CompactContextButton`), **When** `compressConversationContext` executes, **Then** it keeps the **Protected Head** (system prompt + task brief + first 2 turns) and **Protected Tail** (last 8 turns) byte-for-byte untouched, summarizes the **Compressible Middle** via the auxiliary model (or falls back deterministically to tool call names + `200` chars per turn if the auxiliary model stalls/fails), and preserves the full uncompressed turn history in PostgreSQL.
2. **Given** typed prompt modules and evaluation suites, **When** the prompt compilation harness (`scripts/prompts-compile.ts`) runs for a target model alias, **Then** it evaluates candidate variants against deterministic scoring criteria and outputs the highest-scoring compiled prompt artifact.
3. **Given** a completed task with `0` strikes and zero agreed `P0`/`P1` findings on a project with `dataset.collect = true`, **When** `exportFineTuningTrajectory` executes, **Then** it compresses middle turns, scrubs all secrets, API keys, and project-specific sensitive identifiers, and writes an OpenAI-compatible JSONL entry to `.agents/dataset/trajectories/YYYY-MM/`; if `dataset.collect` is `false` (default) or the task incurred strikes, zero files are written.

---

### Edge Cases

- **Reflection attempts to save an environment failure (`missing binary`, `unconfigured credentials`) or unresolved dead end as a skill**: Rejected deterministically by the Hermes-strict skill validator so broken workflows or transient tool outages never pollute `.agents/skills/`.
- **Auxiliary model times out during `> 80%` context compression**: `compressConversationContext` never fails the task; it immediately falls back to the deterministic heuristic summary (tool call names + first `200` characters per middle turn) while keeping Protected Head and Protected Tail intact.
- **Container exits `rc=0` with malformed JSON in `.agent_status.json`**: Treated identically to a missing status file—triggers Nudge 1, then Nudge 2, then `protocol_violation` + Two-Strike increment + human escalation.
- **Conversation has `<= 10` total turns when compression is requested**: Since Protected Head (first 2 turns) + Protected Tail (last 8 turns) cover all `<= 10` turns, the Compressible Middle is empty and compression is a safe no-op returning the original turns unchanged.
- **Skill Curator encounters a `user-created` or `pinned` skill unused for 120 days**: Completely skipped by staleness, archival, deletion, and auto-patching passes.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001 (3-Axis Background Reflection Worker — Task 14.1a, ADR-057, ADR-083)**: System MUST implement `src/orchestrator/learning/reflection-worker.ts` triggered as a low-priority background job on terminal task states to extract (1) **Project Memory** lessons into PostgreSQL `project_lessons`, (2) **Skill Library** markdown files into `.agents/skills/` enforcing Hermes-strict validation (`name` lowercase-hyphenated `<= 64` chars, one-sentence `description` `<= 60` chars ending in `.` with no marketing words, `version: 0.1.0`, mandatory 8-section order: `Title -> When to Use -> Prerequisites -> How to Run -> Quick Reference -> Procedure -> Pitfalls -> Verification`, and deterministic rejection of environment failures, negative tool claims, transient errors, and unresolved dead ends), and (3) **Anti-Pattern Registry** entries (`LLM_CODE_SMELL`, `TEST_INTEGRITY`) from Gate 4 guard failures and ADR-056 debate rejections; retrieved during Dev-Level-1 planning using a cosine similarity threshold `>= 0.75` capped at `top-5` project lessons and `top-3` anti-patterns.
- **FR-002 (Human Gate Diff Learner — Task 14.1b, PRD §9.4)**: System MUST implement `src/orchestrator/learning/human-gate-diff.ts` comparing agent output (`changes.patch`) against human-edited merged code (`final_merged_code`), classifying the correction category (`logic_error`, `convention_violation`, `missing_edge_case`, `performance_issue`, `security_fix`), generating a 768-dimensional vector embedding (`nomic-embed-text`), and persisting the lesson in `project_lessons` with workspace tenant isolation.
- **FR-003 (Weekly Skill Curator Job — Task 14.2, ADR-063)**: System MUST implement `src/orchestrator/learning/skill-curator.ts` executing repeatable lifecycle maintenance exclusively on `agent-created` skills (`user-created` skills are never auto-patched; `pinned` skills are never archived): transitioning `active -> stale` at `>= 14` days unused, `stale -> archived` (moved to `.archive/`) at `>= 30` days unused, and `archived -> pending_deletion` at `>= 90` days archived (requiring explicit operator approval before file deletion), plus supporting opt-in `curator.consolidate = true` by pre-filtering overlapping `agent-created` pairs via Jaccard token similarity `>= 0.50` on `description` + `When to Use` sections and writing a human-gated markdown consolidation diff to `.agents/skills/.proposals/consolidation-<YYYY-MM-DD>.diff.md`.
- **FR-004 (Stall Detection Guardrails — Task 14.3a, ADR-058, PRD §6 & §9.8)**: System MUST implement `src/orchestrator/learning/stall-detector.ts` normalizing outputs and diffs (stripping ISO timestamps, millisecond durations, PIDs, and `/tmp/` random suffixes before SHA-256 hashing `command + args + exitCode + normalizedOutput`) to monitor agent execution for (1) exact-failure streaks (same command + same failure output: warn at `3x`, hard-interrupt at `5x`), (2) multi-call cycles (`A -> B -> A -> B` with period `<= 4` and identical args/results: warn at `3` laps, hard-interrupt at `5` laps), (3) per-turn command floods (`> 50` commands in a single turn: hard-cap + nudge), and (4) PRD §6 stuck heuristics (`4` identical action-observations or `3` identical diffs); on any hard-interrupt, the system MUST transition the task to `STALL_ESCALATED`, increment the Two-Strike counter, and attach a structured stall report.
- **FR-005 (Container Terminal-State Protocol Contract — Task 14.3b, ADR-059)**: System MUST implement `src/orchestrator/learning/status-protocol.ts` validating that `<worktree>/.agent_status.json` exists and conforms to the TypeBox contract (`status: 'patch_ready' | 'blocked' | 'needs_clarification'`, `summary`, `artifacts`, `exit_reason`) whenever a container exits with `rc=0`; if missing or invalid, the supervisor MUST issue up to `2` synthetic re-entry nudges before marking the task `protocol_violation`, incrementing the Two-Strike counter, and escalating to human review.
- **FR-006 (80% Auxiliary Context Compressor — Task 14.4a, ADR-060, ADR-061)**: System MUST implement `src/orchestrator/learning/compression.ts` triggered when estimated tokens exceed `80%` of the active model's context window (or via operator `CompactContextButton`), preserving the **Protected Head** (system prompt + brief + first `2` turns) and **Protected Tail** (last `8` turns) byte-for-byte untouched, summarizing the **Compressible Middle** via an auxiliary model with a deterministic heuristic fallback (tool call names + `200` chars/turn), validating system prompt prefix hash stability (ADR-061), and retaining uncompressed history in PostgreSQL.
- **FR-007 (Prompt Compilation Harness & Opt-In Trajectory Exporter — Task 14.4b/c, ADR-064, ADR-068)**: System MUST implement `scripts/prompts-compile.ts` to evaluate candidate prompt variants in `prompts/` against golden evaluation fixtures using the weighted composite score (`0.5 * schemaCompliance + 0.3 * constraintAdherence + 0.2 * tokenEfficiency`) and persist the highest-scoring variant per target model alias to `prompts/compiled/<alias>.prompt.json`, and `src/orchestrator/learning/trajectory-export.ts` to export 0-strike successful trajectories when `dataset.collect = true` (default `false`) by compressing middle turns, applying a deterministic multi-pattern scrubber across all turns (redacting API keys, Bearer/JWT tokens, database connection URLs, PEM private keys, `.env` assignments, and replacing workspace/org/project identifiers with `<REDACTED_PROJECT>`), and writing OpenAI-compatible JSONL (`{"messages": [...], "metadata": {"taskId", "modelAlias", "strikes": 0, "compressed": true}}`) to `.agents/dataset/trajectories/YYYY-MM/`.

### Key Entities

- **Project Lesson & Anti-Pattern Record (`ProjectLessonRecord`)**: Searchable institutional memory entry in `project_lessons` containing `workspaceId`, `projectId`, `taskId`, `axis` (`'project_memory' | 'anti_pattern' | 'human_gate_diff'`), `category` (`'LLM_CODE_SMELL' | 'TEST_INTEGRITY' | 'logic_error' | 'convention_violation' | 'missing_edge_case' | 'performance_issue' | 'security_fix' | 'architecture_convention'`), `summary`, `fileScope`, and 768-dim `embedding`.
- **Hermes Skill Document (`SkillDocument`)**: Structured skill artifact in `.agents/skills/<name>/SKILL.md` with frontmatter (`name`, `description`, `version`, `origin`: `'agent-created' | 'user-created'`, `pinned`: boolean, `status`: `'active' | 'stale' | 'archived' | 'pending_deletion'`, `lastUsedAt`, `archivedAt`) and 8 mandatory body sections.
- **Stall Detection Verdict (`StallCheckResult`)**: Real-time evaluation outcome (`action`: `'none' | 'warn' | 'hard_interrupt' | 'turn_cap_nudge'`, `reason`, `streakOrLapCount`, `taskStatus`: `'STALL_ESCALATED'`, `strikeIncrement`: `0 | 1`, `stallReport`).
- **Terminal Status Contract (`AgentTerminalStatus`)**: Validated `.agent_status.json` payload (`status`: `'patch_ready' | 'blocked' | 'needs_clarification'`, `summary`, `artifacts`, `exit_reason`) and protocol enforcement state (`nudgeCount`: `0 | 1 | 2`, `escalated`: boolean).
- **Compressed Context Envelope (`CompressedContextResult`)**: Output of ADR-060 compression (`protectedHead`, `compressedMiddleSummary`, `protectedTail`, `usedFallback`: boolean, `systemPromptHashPreserved`: boolean, `tokensBefore`, `tokensAfter`).
- **Fine-Tuning Trajectory Entry (`TrajectoryJsonlEntry`)**: Redacted, OpenAI-compatible JSONL record stored under `.agents/dataset/trajectories/YYYY-MM/` for 0-strike tasks when `dataset.collect = true`.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001 (Closed-Loop Learning & Hermes Skill Hygiene)**: 100% of terminal tasks and human-modified merges extract structured lessons/anti-patterns with 768-dim embeddings, and 100% of generated skills violating Hermes-strict constraints (or capturing environment/transient/unresolved failures) are rejected before disk write.
- **SC-002 (Curator Sovereignty & Lifecycle Precision)**: 100% of `agent-created` skills transition accurately at the `14d` (`stale`), `30d` (`archived`), and `90d` (`pending_deletion` with operator gate) thresholds, while `0%` of `user-created` or `pinned` skills are ever auto-patched or auto-archived.
- **SC-003 (Zero Runaway Loops & 100% Terminal Status Compliance)**: 100% of exact-failure streaks (`5x`), multi-call cycles (`5` laps), and stuck loops halt deterministically into `STALL_ESCALATED` with a Two-Strike increment, and 100% of `rc=0` container exits without a valid `.agent_status.json` trigger at most `2` re-entry nudges before escalating as `protocol_violation`.
- **SC-004 (Cache-Safe Context Compression & Redacted Trajectory Export)**: 100% of conversations exceeding `80%` context capacity compress the middle turns while keeping the Protected Head (system + brief + first 2 turns) and Protected Tail (last 8 turns) byte-for-byte identical, and 100% of exported fine-tuning trajectories redact credentials/secrets and only write when `dataset.collect = true` on 0-strike tasks.

## Assumptions

- PostgreSQL `project_lessons` table with `vector(768)` column (created in Phase 1 `migrations/001_initial_schema.sql`) and `withTenantContext` helper are available for storing Project Memory, Human Gate Diff lessons, and Anti-Pattern Registry entries.
- Canonical `TaskStatus` in `src/orchestrator/state-machine.ts` includes `STALL_ESCALATED`, and `LiteLLMClient` from Phase 8 is available for auxiliary model summarization and local `nomic-embed-text` 768-dim embedding generation (with deterministic offline fallback).

