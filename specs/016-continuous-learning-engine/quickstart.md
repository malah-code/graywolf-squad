# Quickstart & Verification Guide: Continuous Learning Engine, Stall Guardrails & Context Compression

**Feature**: `016-continuous-learning-engine` (Phase 14)  
**Date**: 2026-11-01

## Prerequisites

- Node.js 20+ and `pnpm` installed
- Dependencies installed (`pnpm install`)

## Verification Scenarios

### 1. 3-Axis Reflection Worker & Human Gate Diff Learner (Task 14.1)

Run the reflection and human diff unit test suite:

```bash
pnpm vitest run tests/unit/reflection-and-human-diff.test.ts
```

**Expected Outcomes**:
- Hermes-strict skill validator accepts valid 8-section skills (`name <= 64`, one-sentence `description <= 60` ending in `.`, `version: 0.1.0`) and rejects skills with marketing buzzwords, missing sections, environment errors (`ENOENT`), negative tool claims, or unresolved dead ends.
- Gate 4 / debate failures log `LLM_CODE_SMELL` and `TEST_INTEGRITY` anti-patterns with 768-dim embeddings.
- `retrieveLessonsForPlan` enforces cosine similarity `>= 0.75` and caps results at `top-5` lessons and `top-3` anti-patterns.
- `learnFromHumanGateDiff` detects human edits between `changes.patch` and `final_merged_code`, classifies the correction type, and produces a 768-dim `ProjectLessonRecord`.

### 2. Autonomous Weekly Skill Curator (Task 14.2)

Run the skill curator test suite:

```bash
pnpm vitest run tests/unit/skill-curator.test.ts
```

**Expected Outcomes**:
- `agent-created` skills transition `active -> stale` (`>= 14d`), `stale -> archived` (`>= 30d`, relocated to `.agents/skills/.archive/`), and `archived -> pending_deletion` (`>= 90d`, deleted only when operator-approved).
- `user-created` and `pinned: true` skills remain untouched across all staleness, archival, deletion, and consolidation passes.
- With `consolidate: true`, overlapping `agent-created` skills (Jaccard similarity `>= 0.50` on `description` + `When to Use`) generate a human-gated unified diff proposal in `.agents/skills/.proposals/consolidation-<YYYY-MM-DD>.diff.md`.

### 3. Stall Detection Guardrails & Terminal Status Protocol (Task 14.3)

Run the stall detector and terminal status protocol test suite:

```bash
pnpm vitest run tests/unit/stall-and-status-protocol.test.ts
```

**Expected Outcomes**:
- Volatile output normalization strips timestamps, durations, PIDs, and `/tmp/` suffixes so identical failures match deterministically.
- Exact-failure streaks and `A -> B -> A -> B` cycles (period `<= 4`) warn at `3` and hard-interrupt at `5` (`taskStatus: 'STALL_ESCALATED'`, `strikeIncrement: 1`, attached `stallReport`).
- `> 50` commands in a single turn triggers `turn_cap_nudge`; `4` identical action-observations or `3` identical diffs trigger hard-interrupt.
- Container `rc=0` exit validates `.agent_status.json`; missing/invalid files issue Nudge 1 and Nudge 2 before escalating with `protocol_violation` and `strikeIncrement: 1`.

### 4. >80% Context Compression, Prompt Compiler & Trajectory Export (Task 14.4)

Run the context compression, prompt compiler, and trajectory export test suite, plus the CLI compiler script:

```bash
pnpm vitest run tests/unit/compression-and-trajectory.test.ts
pnpm prompts:compile
```

**Expected Outcomes**:
- Conversations exceeding `80%` context window compress middle turns (`turns.slice(2, -8)`) while keeping Protected Head (system prompt + brief + first 2 turns) and Protected Tail (last 8 turns) byte-for-byte identical (`systemPromptHashPreserved: true`), with deterministic fallback (`200` chars/turn + tool names) when the auxiliary model fails.
- `pnpm prompts:compile` scores candidate prompt variants (`0.5 * schema + 0.3 * constraint + 0.2 * tokenEfficiency`) and writes compiled JSON artifacts to `prompts/compiled/<alias>.prompt.json`.
- `exportFineTuningTrajectory` writes nothing when `dataset.collect = false` or `strikes > 0`, and writes secret-scrubbed (`<REDACTED_*>`) OpenAI JSONL to `.agents/dataset/trajectories/YYYY-MM/` when `dataset.collect = true` on 0-strike tasks.

