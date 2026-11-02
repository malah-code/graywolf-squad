# Tasks: Continuous Learning Engine, Stall Guardrails & Context Compression

**Input**: Design documents from `/specs/016-continuous-learning-engine/`  
**Prerequisites**: `plan.md` (required), `spec.md` (required), `research.md`, `data-model.md`, `contracts/continuous-learning.md`, `quickstart.md`

**Tests**: Included as required by `docs/implementation-plan-detailed.md` Phase 14 (`tests/unit/reflection-and-human-diff.test.ts`, `tests/unit/skill-curator.test.ts`, `tests/unit/stall-and-status-protocol.test.ts`, `tests/unit/compression-and-trajectory.test.ts`).

**Organization**: Tasks are grouped by user story and mapped directly to Phase 14 Tasks 14.1–14.4 in `docs/implementation-plan-detailed.md`. Every field constraint from `data-model.md` and `spec.md` is quoted verbatim so zero details are left to implementation-time discretion.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: Which user story this task belongs to (`[US1]`, `[US2]`, `[US3]`, `[US4]`)
- Include exact file paths in descriptions

---

## Phase 1: User Story 1 - 3-Axis Background Reflection & Human Gate Diff Learning (Priority: P1 — Master Plan Task 14.1) 🎯 MVP

**Goal**: Implement the 3-Axis Background Reflection Worker (`src/orchestrator/learning/reflection-worker.ts`) and Human Gate Diff Learner (`src/orchestrator/learning/human-gate-diff.ts`) to extract Project Memory lessons, Hermes-strict `.agents/skills/` documents, Anti-Pattern Registry (`LLM_CODE_SMELL`, `TEST_INTEGRITY`) entries, and human merge diff lessons with 768-dimensional vector embeddings in `project_lessons`.

**Independent Test**: Run `pnpm vitest run tests/unit/reflection-and-human-diff.test.ts` to verify Hermes-strict skill validation, prohibited-skill rejection, anti-pattern logging, cosine similarity `>= 0.75` retrieval (`top-5` lessons / `top-3` anti-patterns), and human diff classification.

### Implementation & Tests for User Story 1 (Master Plan Task 14.1)

- [x] T001 [P] [US1] Implement `validateHermesSkillDocument`, `computeDeterministicEmbedding768`, `cosineSimilarity768`, `retrieveLessonsForPlan`, and `runTaskReflection` in `src/orchestrator/learning/reflection-worker.ts` enforcing `ProjectLessonRecord` constraints (`provenance`: `'reflection_memory' | 'anti_pattern' | 'human_gate_diff'`, `confidenceScore`: `0.00 .. 1.00`, `category`: `'LLM_CODE_SMELL' | 'TEST_INTEGRITY' | 'logic_error' | 'convention_violation' | 'missing_edge_case' | 'performance_issue' | 'security_fix' | 'architecture_convention'`, `embedding`: `length === 768`, `status`: `'active' | 'archived'`), Hermes-strict `SkillDocument` validation (`name`: `/^[a-z0-9]+(?:-[a-z0-9]+)*$/` and `1..64` chars, `description`: single sentence ending in `.`, `1..60` chars with zero marketing buzzwords, `version`: `'0.1.0'`, `origin`: `'agent-created' | 'user-created'`, mandatory ordered sections: `Title`, `When to Use`, `Prerequisites`, `How to Run`, `Quick Reference`, `Procedure`, `Pitfalls`, `Verification`, and deterministic rejection of environment failures `ENOENT`/`command not found`/`missing api key`, negative tool claims, transient errors, and unresolved dead ends), and planner retrieval filtering (`minSimilarity: 0.75`, `maxLessons: 5`, `maxAntiPatterns: 3`)
- [x] T002 [P] [US1] Implement `classifyHumanDiffCorrection` and `learnFromHumanGateDiff` in `src/orchestrator/learning/human-gate-diff.ts` diffing `agentPatch` (`changes.patch`) against `finalMergedPatch` (`final_merged_code`), returning `null` when patches are identical, classifying edits into `'logic_error' | 'convention_violation' | 'missing_edge_case' | 'performance_issue' | 'security_fix'`, generating a 768-dimensional L2-normalized embedding (`length === 768`), and persisting the `ProjectLessonRecord` (`provenance: 'human_gate_diff'`) with `withTenantContext` support
- [x] T003 [US1] Create unit test suite in `tests/unit/reflection-and-human-diff.test.ts` testing `validateHermesSkillDocument` (valid 8-section skill acceptance, `name > 64` rejection, `description > 60` or missing period or marketing buzzword rejection, missing/out-of-order section rejection, environment failure/negative tool claim/dead-end rejection), `runTaskReflection` across all 3 axes (`reflection_memory`, `.agents/skills/<name>/SKILL.md` file emission, and `anti_pattern` for `LLM_CODE_SMELL` / `TEST_INTEGRITY`), `retrieveLessonsForPlan` (`>= 0.75` cosine similarity threshold and `top-5` lessons / `top-3` anti-patterns cap), and `learnFromHumanGateDiff` correction classification and 768-dim embedding generation

**Checkpoint**: User Story 1 (Task 14.1) is complete and independently verified via `tests/unit/reflection-and-human-diff.test.ts`.

---

## Phase 2: User Story 2 - Autonomous Weekly Skill Curator Lifecycle (Priority: P1 — Master Plan Task 14.2)

**Goal**: Implement `runWeeklySkillCurator` (`src/orchestrator/learning/skill-curator.ts`) managing `agent-created` skills through `active -> stale -> archived -> pending_deletion -> deleted` while protecting `user-created` and `pinned: true` skills and generating Jaccard-filtered (`>= 0.50`) human-gated markdown consolidation diff proposals.

**Independent Test**: Run `pnpm vitest run tests/unit/skill-curator.test.ts` to verify 14d/30d/90d lifecycle transitions, `.agents/skills/.archive/` relocation, operator deletion approval gating, `user-created`/`pinned` immunity, and `.agents/skills/.proposals/consolidation-<YYYY-MM-DD>.diff.md` generation.

### Implementation & Tests for User Story 2 (Master Plan Task 14.2)

- [x] T004 [P] [US2] Implement `computeSkillJaccardSimilarity` and `runWeeklySkillCurator` in `src/orchestrator/learning/skill-curator.ts` enforcing strict immunity for `origin === 'user-created'` and `pinned === true` skills, transitioning unpinned `agent-created` skills from `'active'` to `'stale'` at `>= 14` days unused, from `'stale'` (or `'active'`) to `'archived'` at `>= 30` days unused (relocating files to `.agents/skills/.archive/<name>/SKILL.md`), from `'archived'` to `'pending_deletion'` at `>= 90` days archived, permanently unlinking only skills listed in `operatorApprovedDeletionIds`, and when `consolidate === true` pre-filtering overlapping `agent-created` skill pairs with Jaccard token similarity `>= 0.50` across `description` and `When to Use` sections to write a unified markdown diff proposal to `.agents/skills/.proposals/consolidation-<YYYY-MM-DD>.diff.md`
- [x] T005 [US2] Create unit test suite in `tests/unit/skill-curator.test.ts` testing `0d` (`active`), `15d` (`active -> stale`), `35d` (`stale -> archived` moved to `.archive/`), and `95d` (`archived -> pending_deletion` held until `operatorApprovedDeletionIds` approval, then `deleted`), verifying `user-created` and `pinned: true` skills are never auto-patched or archived even after `120d` of inactivity, and verifying `consolidate: true` Jaccard `>= 0.50` pre-filtering and `.proposals/consolidation-<YYYY-MM-DD>.diff.md` output

**Checkpoint**: User Story 2 (Task 14.2) is complete and independently verified via `tests/unit/skill-curator.test.ts`.

---

## Phase 3: User Story 3 - Tool-Loop Stall Detection Guardrails & Terminal-State Protocol Contract (Priority: P1 — Master Plan Task 14.3)

**Goal**: Implement `StallDetector` (`src/orchestrator/learning/stall-detector.ts`) with volatile output normalization and 4 loop guardrails, and `verifyTerminalStatusProtocol` (`src/orchestrator/learning/status-protocol.ts`) validating `<worktree>/.agent_status.json` with a 2-nudge synthetic re-entry loop.

**Independent Test**: Run `pnpm vitest run tests/unit/stall-and-status-protocol.test.ts` to verify volatile token normalization, 3× warn / 5× hard-interrupt on exact-failure streaks and `A->B->A->B` cycles (period `<= 4`), `> 50` commands/turn hard-cap, 4 identical action-observations / 3 identical diffs, and `.agent_status.json` Nudge 1 / Nudge 2 / `protocol_violation` escalation.

### Implementation & Tests for User Story 3 (Master Plan Task 14.3)

- [x] T006 [P] [US3] Implement `normalizeVolatileOutput` and `StallDetector` class in `src/orchestrator/learning/stall-detector.ts` stripping ISO-8601 timestamps, epoch timestamps, PIDs (`pid 12345`), millisecond/second durations (`124ms`, `1.23s`), and `/tmp/...` random suffixes before computing SHA-256 signatures of `command | args | exitCode | normalizedOutput`, enforcing (1) `exact_failure_streak` (`exitCode !== 0`: `action: 'warn'` at `3`, `action: 'hard_interrupt'` at `5`), (2) `multi_call_cycle` (repeating `A -> B -> A -> B` sequence of period `2..4`: `action: 'warn'` at `3` laps, `action: 'hard_interrupt'` at `5` laps), (3) `per_turn_command_cap` (`> 50` commands in a single turn -> `action: 'turn_cap_nudge'`), and (4) PRD §6 stuck heuristics (`identical_action_observation` at `4` consecutive identical action-observations regardless of exit code, and `identical_diff_streak` at `3` consecutive identical normalized git diffs -> `action: 'hard_interrupt'`), returning `taskStatus: 'STALL_ESCALATED'`, `strikeIncrement: 1`, and a populated `StallReport` on every `hard_interrupt`
- [x] T007 [P] [US3] Implement `AgentTerminalStatusSchema` (TypeBox schema with `status: 'patch_ready' | 'blocked' | 'needs_clarification'`, `summary` `minLength: 1`, `artifacts: string[]`, `exit_reason` `minLength: 1`) and `verifyTerminalStatusProtocol` in `src/orchestrator/learning/status-protocol.ts` checking `<worktree>/.agent_status.json` when `exitCode === 0`, returning `valid: true` (`strikeIncrement: 0`, `escalated: false`) on valid files, issuing synthetic re-entry nudges (`protocolStatus: 'nudge_retry'`, `nudgeRequired: true`, `nudgeCount: previousNudges + 1`) when `previousNudges < 2`, and returning `protocolStatus: 'protocol_violation'`, `strikeIncrement: 1`, `escalated: true` when `previousNudges >= 2`
- [x] T008 [US3] Create unit test suite in `tests/unit/stall-and-status-protocol.test.ts` testing `normalizeVolatileOutput` (stripping timestamps/PIDs/durations/`/tmp/` suffixes), `StallDetector` exact-failure streak (`3x` warn, `5x` hard-interrupt with `STALL_ESCALATED` and `strikeIncrement: 1`), `A->B->A->B` multi-call cycle (`3` laps warn, `5` laps hard-interrupt), `> 50` per-turn command cap (`turn_cap_nudge`), `4` identical action-observations and `3` identical git diffs hard-interrupts, and `verifyTerminalStatusProtocol` across valid `.agent_status.json`, missing/malformed files at `previousNudges = 0` (Nudge 1), `previousNudges = 1` (Nudge 2), and `previousNudges = 2` (`protocol_violation` + `strikeIncrement: 1` + `escalated: true`)

**Checkpoint**: User Story 3 (Task 14.3) is complete and independently verified via `tests/unit/stall-and-status-protocol.test.ts`.

---

## Phase 4: User Story 4 - 80% Auxiliary Context Compressor, Prompt Compiler & Opt-In Trajectory Export (Priority: P2 — Master Plan Task 14.4)

**Goal**: Implement `compressConversationContext` (`src/orchestrator/learning/compression.ts`) protecting Head (system + brief + first 2 turns) and Tail (last 8 turns), `compilePromptVariants` (`scripts/prompts-compile.ts`) scoring candidate prompts per model alias, and `exportFineTuningTrajectory` (`src/orchestrator/learning/trajectory-export.ts`) exporting secret-scrubbed 0-strike JSONL trajectories when `dataset.collect = true`.

**Independent Test**: Run `pnpm vitest run tests/unit/compression-and-trajectory.test.ts` and `pnpm prompts:compile` to verify head/tail invariance, heuristic compression fallback, prompt composite scoring (`0.5 * schema + 0.3 * constraint + 0.2 * tokenEfficiency`), and opt-in secret-scrubbed trajectory export.

### Implementation & Tests for User Story 4 (Master Plan Task 14.4)

- [x] T009 [P] [US4] Implement `estimateConversationTokens` and `compressConversationContext` in `src/orchestrator/learning/compression.ts` triggering when `estimatedTokens / contextWindowTokens > 0.80` (default `thresholdRatio: 0.80`) or `forceCompact === true` (`CompactContextButton`), returning a safe no-op when `turns.length <= 10`, preserving `protectedHead` (`systemPrompt`, `taskBrief`, and `turns.slice(0, 2)`) and `protectedTail` (`turns.slice(-8)`) byte-for-byte untouched, summarizing `turns.slice(2, -8)` via `auxiliarySummarizer` with deterministic heuristic fallback (`[Turn N | tools: <names>] <first 200 chars>` setting `usedFallback: true`) on error/timeout, and verifying `SHA-256(systemPrompt + taskBrief)` invariance (`systemPromptHashPreserved: true`, ADR-061)
- [x] T010 [P] [US4] Implement `scorePromptVariant`, `compilePromptVariants`, and CLI entrypoint in `scripts/prompts-compile.ts` evaluating candidate prompt variants for `agent-planner`, `agent-coder`, and `agent-reviewer` using the weighted composite metric `0.5 * schemaCompliance + 0.3 * constraintAdherence + 0.2 * tokenEfficiency` (rounded to 4 decimal places) and writing the highest-scoring `CompiledPromptArtifact` per alias to `prompts/compiled/<alias>.prompt.json`
- [x] T011 [P] [US4] Implement `scrubTrajectorySecrets` and `exportFineTuningTrajectory` in `src/orchestrator/learning/trajectory-export.ts` gating strictly on `datasetCollectEnabled === true` AND `strikes === 0` AND `agreedHighSeverityFindings === 0`, compressing middle turns when `turns.length > 10`, scrubbing API keys (`sk-*`, `ghp_*`, `glpat-*`, `xox[baprs]-*`), `Bearer` / JWT tokens, `postgres(ql)://` URLs, PEM private key blocks, `.env` secret assignments, and `sensitiveIdentifiers` (replaced with `<REDACTED_PROJECT>`), and writing OpenAI-compatible JSONL (`{"messages": [...], "metadata": {"taskId", "modelAlias", "strikes": 0, "compressed": boolean, "redactionCount": number, "exportedAt": string}}`) to `.agents/dataset/trajectories/YYYY-MM/<taskId>.jsonl`
- [x] T012 [US4] Create unit test suite in `tests/unit/compression-and-trajectory.test.ts` testing `compressConversationContext` (`> 80%` threshold trigger, `forceCompact: true` button trigger, `<= 10` turns no-op, byte-for-byte `protectedHead` and `protectedTail` preservation, `systemPromptHashPreserved: true`, auxiliary model success vs deterministic `200`-char heuristic fallback), `compilePromptVariants` (`0.5 * schema + 0.3 * constraint + 0.2 * tokenEfficiency` scoring and `prompts/compiled/<alias>.prompt.json` output), and `exportFineTuningTrajectory` (`datasetCollectEnabled: false` no-op, `strikes > 0` rejection, and `datasetCollectEnabled: true` 0-strike JSONL export with full credential and `<REDACTED_PROJECT>` scrubbing)

**Checkpoint**: User Story 4 (Task 14.4) is complete and independently verified via `tests/unit/compression-and-trajectory.test.ts` and `pnpm prompts:compile`.

---

## Phase 5: Polish & Cross-Cutting Concerns

**Purpose**: Full repository typecheck, lint, prompt compilation check, and regression suite verification.

- [x] T013 Run `pnpm prompts:compile`, `pnpm typecheck`, `pnpm lint`, and `pnpm test` across all suites and mark Tasks 14.1, 14.2, 14.3, and 14.4 `[x]` in `docs/implementation-plan-detailed.md`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (`T001`–`T003`, US1 `reflection-worker.ts` & `human-gate-diff.ts`)**: No dependencies — starts immediately.
- **Phase 2 (`T004`–`T005`, US2 `skill-curator.ts`)**: Can run in parallel with or immediately after Phase 1 (shares `SkillDocument` frontmatter conventions).
- **Phase 3 (`T006`–`T008`, US3 `stall-detector.ts` & `status-protocol.ts`)**: Independent of Phases 1–2 — can run in parallel.
- **Phase 4 (`T009`–`T012`, US4 `compression.ts`, `prompts-compile.ts` & `trajectory-export.ts`)**: `T009` and `T010` have no dependencies; `T011` (`trajectory-export.ts`) uses `compressConversationContext` from `T009`.
- **Phase 5 (`T013`)**: Depends on `T001`–`T012`.

### Parallel Opportunities

- `T001` (`reflection-worker.ts`), `T002` (`human-gate-diff.ts`), `T004` (`skill-curator.ts`), `T006` (`stall-detector.ts`), `T007` (`status-protocol.ts`), `T009` (`compression.ts`), and `T010` (`prompts-compile.ts`) touch completely separate files and can be developed in parallel.

## Parallel Example: User Story 1 & User Story 3

```bash
# Implement reflection worker and human diff learner in parallel (US1):
Task: "T001 [P] [US1] Implement validateHermesSkillDocument and runTaskReflection in src/orchestrator/learning/reflection-worker.ts"
Task: "T002 [P] [US1] Implement learnFromHumanGateDiff in src/orchestrator/learning/human-gate-diff.ts"

# Implement stall detector and status protocol verifier in parallel (US3):
Task: "T006 [P] [US3] Implement StallDetector in src/orchestrator/learning/stall-detector.ts"
Task: "T007 [P] [US3] Implement verifyTerminalStatusProtocol in src/orchestrator/learning/status-protocol.ts"
```

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1 (`T001`–`T003`: 3-Axis Reflection Worker & Human Gate Diff Learner).
2. **STOP and VALIDATE**: Run `pnpm vitest run tests/unit/reflection-and-human-diff.test.ts`.

### Incremental Delivery

1. Complete Phase 1 (US1 — Task 14.1) → Verify `tests/unit/reflection-and-human-diff.test.ts`
2. Complete Phase 2 (US2 — Task 14.2) → Verify `tests/unit/skill-curator.test.ts`
3. Complete Phase 3 (US3 — Task 14.3) → Verify `tests/unit/stall-and-status-protocol.test.ts`
4. Complete Phase 4 (US4 — Task 14.4) → Verify `tests/unit/compression-and-trajectory.test.ts` & `pnpm prompts:compile`
5. Complete Phase 5 (`T013`) → Full repo convergence check

