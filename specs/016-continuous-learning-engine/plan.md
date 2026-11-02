# Implementation Plan: Continuous Learning Engine, Stall Guardrails & Context Compression

**Branch**: `016-continuous-learning-engine` | **Date**: 2026-11-01 | **Spec**: [spec.md](./spec.md)  
**Input**: Feature specification from `/specs/016-continuous-learning-engine/spec.md`

## Summary

Implement Phase 14 of the Graywolf Squad master plan (`docs/implementation-plan-detailed.md` Tasks 14.1–14.4):
1. **3-Axis Background Reflection Worker & Human Gate Diff Learner (`src/orchestrator/learning/reflection-worker.ts`, `src/orchestrator/learning/human-gate-diff.ts`, Task 14.1)**:
   - Low-priority background reflection job evaluating terminal tasks across **Project Memory**, **Skill Library** (`.agents/skills/` enforcing Hermes-strict format and prohibited-skill rejection), and **Anti-Pattern Registry** (`LLM_CODE_SMELL`, `TEST_INTEGRITY` from Gate 4 and ADR-056 debate rejections).
   - Planner retrieval helper querying `project_lessons` with cosine similarity `>= 0.75`, capped at `top-5` project lessons and `top-3` anti-patterns.
   - `learnFromHumanGateDiff` diffing `changes.patch` vs. `final_merged_code`, classifying corrections (`logic_error`, `convention_violation`, `missing_edge_case`, `performance_issue`, `security_fix`), generating 768-dim `nomic-embed-text` embeddings (with deterministic offline hash-vector fallback), and persisting to `project_lessons` via `withTenantContext`.
2. **Autonomous Weekly Skill Curator Job (`src/orchestrator/learning/skill-curator.ts`, Task 14.2)**:
   - Repeatable weekly maintenance operating strictly on `agent-created` skills (`user-created` never auto-patched; `pinned` never archived): `active -> stale` (`>= 14d` unused), `stale -> archived` (`>= 30d` unused, moved to `.agents/skills/.archive/`), and `archived -> pending_deletion` (`>= 90d` archived, gated on explicit operator approval).
   - Opt-in `curator.consolidate = true` pass pre-filtering overlapping `agent-created` skill pairs via Jaccard token similarity `>= 0.50` across `description` and `When to Use` sections and writing unified markdown diff proposals to `.agents/skills/.proposals/consolidation-<YYYY-MM-DD>.diff.md`.
3. **Stall Detection Guardrails & Terminal-State Protocol Contract (`src/orchestrator/learning/stall-detector.ts`, `src/orchestrator/learning/status-protocol.ts`, Task 14.3)**:
   - `StallDetector` stripping volatile tokens (ISO timestamps, durations, PIDs, `/tmp/` suffixes) before SHA-256 signature comparison to catch exact-failure streaks (warn at `3x`, hard-interrupt at `5x`), multi-call cycles of period `<= 4` (`A -> B -> A -> B`: warn at `3` laps, hard-interrupt at `5` laps), per-turn command floods (`> 50` commands -> hard-cap + nudge), and PRD §6 stuck heuristics (`4` identical action-observations or `3` identical diffs); hard-interrupts mark verdict `STALL_ESCALATED` (transitioning canonical task state to `ESCALATED`), increment the Two-Strike counter, and attach a diagnostic stall report.
   - `verifyTerminalStatusProtocol` validating `<worktree>/.agent_status.json` (`patch_ready | blocked | needs_clarification`) on `rc=0` container exit using TypeBox, issuing up to `2` synthetic re-entry nudges before marking `protocol_violation`, incrementing the Two-Strike counter, and escalating to human review.
4. **80% Auxiliary Context Compressor, Prompt Compiler & Opt-In Trajectory Export (`src/orchestrator/learning/compression.ts`, `scripts/prompts-compile.ts`, `src/orchestrator/learning/trajectory-export.ts`, Task 14.4)**:
   - `compressConversationContext` triggered at `> 80%` context utilization (or `CompactContextButton`), keeping **Protected Head** (system prompt + brief + first `2` turns) and **Protected Tail** (last `8` turns) byte-for-byte untouched, summarizing the **Compressible Middle** via auxiliary model (`LiteLLMClient`) with deterministic heuristic fallback (tool call names + `200` chars/turn), and verifying ADR-061 system prompt prefix hash invariance.
   - `scripts/prompts-compile.ts` evaluating candidate prompts in `prompts/` against golden fixtures via weighted composite score (`0.5 * schemaCompliance + 0.3 * constraintAdherence + 0.2 * tokenEfficiency`) and writing winning artifacts to `prompts/compiled/<alias>.prompt.json`.
   - `exportFineTuningTrajectory` exporting 0-strike successful trajectories when `dataset.collect = true` (default `false`), scrubbing secrets/tokens/URLs/PEMs/identifiers (`<REDACTED_PROJECT>`), and writing OpenAI-compatible JSONL to `.agents/dataset/trajectories/YYYY-MM/`.

## Technical Context

**Language/Version**: TypeScript 5.x on Node.js 20+  
**Primary Dependencies**: `@sinclair/typebox`, `bullmq` (low-priority reflection & repeatable curator jobs), `pg` (`withTenantContext` over `project_lessons` & `skills`), `node:crypto` (SHA-256 signatures & deterministic offline 768-dim embedding fallback), `LiteLLMClient` (Phase 8 auxiliary summarization & `nomic-embed-text` embeddings)  
**Storage**: PostgreSQL 16 + `pgvector` (`project_lessons` with `vector(768)` and dual workspace/org RLS policy; `skills` table); Filesystem (`.agents/skills/`, `.agents/skills/.archive/`, `.agents/skills/.proposals/`, `prompts/compiled/`, `.agents/dataset/trajectories/YYYY-MM/`, `<worktree>/.agent_status.json`)  
**Testing**: Vitest (`tests/unit/reflection-and-human-diff.test.ts`, `tests/unit/skill-curator.test.ts`, `tests/unit/stall-and-status-protocol.test.ts`, `tests/unit/compression-and-trajectory.test.ts`)  
**Target Platform**: Fastify Control Plane & Orchestrator Workers (`src/orchestrator/learning/*`, `scripts/prompts-compile.ts`)  
**Project Type**: Backend orchestrator continuous learning, runtime loop guardrails, context compression, and prompt/trajectory tooling  
**Performance Goals**: Stall signature check `< 1ms` per tool call; deterministic context compression fallback `< 5ms`; Jaccard skill pre-filter `< 10ms` for 100 skills; `pnpm prompts:compile` offline execution `< 500ms`  
**Constraints**: ADR-057 low-priority non-blocking reflection; ADR-061 byte-for-byte system prompt hash stability; ADR-063 zero auto-mutation of `user-created` or `pinned` skills; ADR-064 opt-in trajectory collection (`dataset.collect = false` by default) with mandatory secret scrubbing  
**Scale/Scope**: 7 source modules (`reflection-worker.ts`, `human-gate-diff.ts`, `skill-curator.ts`, `stall-detector.ts`, `status-protocol.ts`, `compression.ts`, `trajectory-export.ts` + `scripts/prompts-compile.ts`) and 4 unit test suites

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **Principle 1 (Human Sovereignty & Non-Committing Relay Contract)**: PASS — Skill Curator never modifies `user-created` skills, never archives `pinned` skills, requires explicit operator approval before deleting `90+` day archived skills, and writes consolidation diffs to `.proposals/` for human review.
- **Principle 2 (Zero Runtime Lock-In & Permissive Licensing)**: PASS — Uses permissive MIT/Apache-2.0 libraries (`@sinclair/typebox`, `bullmq`, `pg`) and standard `agentskills.io` markdown skill files + OpenAI-compatible JSONL trajectories.
- **Principle 3 (Single ACID Relational & Vector Baseline)**: PASS — Stores all Project Memory, Human Gate Diff lessons, and Anti-Pattern Registry vectors (`vector(768)`) in the existing PostgreSQL `project_lessons` table with RLS isolation.
- **Principle 4 (Headless Execution & Observability)**: PASS — Stall detector reports, terminal status nudges, and context compression events produce structured, machine-verifiable diagnostic artifacts.
- **Principle 5 (Dual Operational Mode: Greenfield & Brownfield)**: PASS — Learned lessons and anti-patterns carry `trigger_scope` file patterns and respect project boundaries.
- **Principle 6 (Virtual Developer Tier Handoff Protocol)**: PASS — Hard-interrupt stalls and terminal status protocol violations increment the canonical Two-Strike counter and escalate to human review without unbounded retries.
- **Principle 7 (Chat as Active Control Plane — Cockpit Rule)**: PASS — Context compression supports both automatic `> 80%` threshold triggering and manual operator triggering (`CompactContextButton`).
- **Principle 8 (Blast-Radius and Dependency Integrity)**: PASS — Reflection and curation operate asynchronously outside active task containers and never mutate protected source branches directly.
- **Principle 9 (Zero-Cost Open Source Foundation)**: PASS — Supports 100% offline operation via local `nomic-embed-text` (with deterministic 768-dim hash fallback), deterministic context compression fallback, and offline fixture-based `pnpm prompts:compile`.

## Project Structure

### Documentation (this feature)

```text
specs/016-continuous-learning-engine/
├── spec.md              # Feature specification (FR-001..FR-007, SC-001..SC-004)
├── plan.md              # This technical implementation plan
├── research.md          # Technical decisions for reflection, curator, stall guardrails, compression, compiler, trajectory export
├── data-model.md        # Domain models (ProjectLessonRecord, SkillDocument, StallCheckResult, AgentTerminalStatus, CompressedContextResult, TrajectoryJsonlEntry)
├── quickstart.md        # Verification commands and test scenarios
├── checklists/
│   └── requirements.md  # Specification quality checklist (16/16 pass)
└── contracts/
    └── continuous-learning.md # Module and CLI contracts
```

### Source Code (repository root)

```text
src/orchestrator/learning/
├── reflection-worker.ts  # Task 14.1a: 3-axis background reflection & Hermes skill authoring (FR-001)
├── human-gate-diff.ts    # Task 14.1b: Human merge diff learner & 768-dim lesson storage (FR-002)
├── skill-curator.ts      # Task 14.2:  Weekly skill lifecycle & Jaccard consolidation diff (FR-003)
├── stall-detector.ts     # Task 14.3a: Volatile-stripped SHA-256 stall & cycle guardrails (FR-004)
├── status-protocol.ts    # Task 14.3b: .agent_status.json TypeBox verifier & 2-nudge loop (FR-005)
├── compression.ts        # Task 14.4a: >80% head/tail-protected context compressor (FR-006)
└── trajectory-export.ts  # Task 14.4c: Opt-in 0-strike redacted JSONL trajectory exporter (FR-007)

scripts/
└── prompts-compile.ts    # Task 14.4b: DSPy-inspired prompt evaluator & compiler (FR-007)

tests/unit/
├── reflection-and-human-diff.test.ts # Task 14.1 verification
├── skill-curator.test.ts             # Task 14.2 verification
├── stall-and-status-protocol.test.ts # Task 14.3 verification
└── compression-and-trajectory.test.ts # Task 14.4 verification
```

**Structure Decision**: Matches the exact file paths specified in `docs/implementation-plan-detailed.md` Phase 14 Tasks 14.1–14.4 and `package.json` (`"prompts:compile": "tsx scripts/prompts-compile.ts"`).

## Complexity Tracking

No Constitution violations or complexity exceptions required.
