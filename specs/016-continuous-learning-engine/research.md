# Research & Technical Decisions: Continuous Learning Engine, Stall Guardrails & Context Compression

**Feature**: `016-continuous-learning-engine` (Phase 14)  
**Date**: 2026-11-01

## 1. 3-Axis Reflection, Hermes-Strict Skill Validation & Vector Retrieval (`reflection-worker.ts`, `human-gate-diff.ts`)

- **Decision**:
  - Run post-task reflection asynchronously on a low-priority BullMQ queue (`learning-reflection`, priority `10` = lowest urgency) so active task execution (`priority: 1`) is never delayed.
  - Validate every candidate skill against a deterministic **Hermes-Strict Validator** before writing to `.agents/skills/<name>/SKILL.md`:
    1. `name`: `/^[a-z0-9]+(?:-[a-z0-9]+)*$/` and `length <= 64`.
    2. `description`: single sentence ending with `.`, `length <= 60`, rejecting marketing buzzwords (`/\b(revolutionary|seamless|ultimate|world-class|cutting-edge|magical|best-in-class|supercharge)\b/i`).
    3. `version`: defaults to `'0.1.0'`.
    4. Mandatory 8-section body order: `# <Title>`, `## When to Use`, `## Prerequisites`, `## How to Run`, `## Quick Reference`, `## Procedure`, `## Pitfalls`, `## Verification`.
    5. Prohibited content filter: deterministically reject skills describing missing binaries/credentials (`ENOENT`, `command not found`, `missing api key`), negative tool claims (`/\b(tool|command|library)\s+[a-z0-9_-]+\s+(does not work|is broken|always fails)\b/i`), transient network timeouts, or unresolved dead ends.
  - Generate 768-dimensional embeddings via `nomic-embed-text` (or a deterministic L2-normalized SHA-256 trigram projection into $\mathbb{R}^{768}$ when running offline/in unit tests without a live Ollama daemon).
  - Retrieve relevant guidance for Dev-Level-1 planning using cosine similarity `>= 0.75`, returning at most `top-5` Project Memory / Human Gate Diff lessons and `top-3` Anti-Pattern Registry (`LLM_CODE_SMELL`, `TEST_INTEGRITY`) entries.
- **Rationale**: Enforces ADR-057 and ADR-083 while guaranteeing 100% offline testability (Constitution Principle 9) and preventing noisy or broken skills from entering `.agents/skills/`.
- **Alternatives Considered**:
  - Unvalidated LLM markdown generation into `.agents/skills/` (rejected: allows stale tool refusals and inconsistent formatting).
  - Unbounded lesson injection into planner prompts (rejected: bloats context and degrades reasoning focus).

## 2. Skill Curator Lifecycle & Jaccard Consolidation Pre-Filter (`skill-curator.ts`)

- **Decision**:
  - Enforce strict origin and pin guards: if `skill.origin === 'user-created'` or `skill.pinned === true`, skip all staleness, archival, deletion, and auto-patch transitions.
  - For `agent-created` unpinned skills:
    - `unusedDays >= 14 && status === 'active'` ➔ `status = 'stale'`
    - `unusedDays >= 30 && (status === 'stale' || status === 'active')` ➔ `status = 'archived'`, moving file to `.agents/skills/.archive/<name>/SKILL.md`
    - `archivedDays >= 90 && status === 'archived'` ➔ `status = 'pending_deletion'` (actual unlink only executes when `operatorApprovedDeletionIds` includes the skill ID/name).
  - When `curator.consolidate === true`, compute word-token Jaccard similarity across `description + When to Use` for all active/stale `agent-created` skill pairs. Pairs with similarity `>= 0.50` (or shared tag/scope overlap) are emitted as a unified markdown diff proposal at `.agents/skills/.proposals/consolidation-<YYYY-MM-DD>.diff.md`.
- **Rationale**: Honors ADR-063 and Constitution Principle 1 (Human Sovereignty) while avoiding $O(N^2)$ LLM calls across the skill catalog.
- **Alternatives Considered**:
  - Automatic silent deletion at 90 days (rejected: violates PRD §9.5 operator approval gate).
  - Pairwise LLM calls for every skill pair (rejected: quadratic token cost).

## 3. Volatile-Stripped Stall Detection & Terminal Status Protocol (`stall-detector.ts`, `status-protocol.ts`)

- **Decision**:
  - Normalize command outputs and diffs by stripping ISO-8601 timestamps, epoch timestamps, PIDs (`pid 12345`), millisecond/second durations (`124ms`, `1.23s`), and `/tmp/...` random suffixes before computing a SHA-256 signature of `command | args | exitCode | normalizedOutput`.
  - Track 4 deterministic loop detectors:
    1. **Exact-failure streak** (`exitCode !== 0` with identical signature): warn at `3`, hard-interrupt at `5`.
    2. **Multi-call cycle** (repeating sequence of `2..4` command signatures `A -> B -> A -> B`): warn at `3` full laps, hard-interrupt at `5` full laps.
    3. **Per-turn command flood**: `> 50` commands within a single turn triggers `turn_cap_nudge`.
    4. **PRD §6 stuck heuristics**: `4` identical action-observations or `3` identical git diffs triggers hard-interrupt.
  - On hard-interrupt: return verdict `taskStatus: 'STALL_ESCALATED'` (mapped to canonical `ESCALATED` in `state-machine.ts` with `stallEscalated: true` metadata), `strikeIncrement: 1`, and a structured `StallReport`.
  - On container exit with `rc === 0`, `verifyTerminalStatusProtocol` validates `<worktree>/.agent_status.json` against the TypeBox schema (`status: 'patch_ready' | 'blocked' | 'needs_clarification'`, non-empty `summary`, `artifacts: string[]`, `exit_reason: string`). Missing or malformed files trigger synthetic re-entry Nudge 1 and Nudge 2; a 3rd failure (`nudgeCount >= 2`) returns `protocol_violation`, `strikeIncrement: 1`, and `escalated: true`.
- **Rationale**: Directly implements ADR-058, ADR-059, and PRD §6/§9.8–9.9 with sub-millisecond deterministic execution.
- **Alternatives Considered**:
  - Raw string comparison on stdout/stderr (rejected: defeated by timestamps or test runner durations).

## 4. >80% Context Compression, Prompt Compiler & Redacted Trajectory Export (`compression.ts`, `prompts-compile.ts`, `trajectory-export.ts`)

- **Decision**:
  - **Context Compression (`compression.ts`)**: When `estimatedTokens / contextWindowTokens > 0.80` or `forceCompact === true` (`CompactContextButton`):
    - Keep **Protected Head** (`systemPrompt`, `taskBrief`, and `turns.slice(0, 2)`) and **Protected Tail** (`turns.slice(-8)`) byte-for-byte untouched.
    - If `turns.length <= 10`, return turns unchanged (empty middle).
    - Summarize `turns.slice(2, -8)` via `LiteLLMClient` auxiliary alias (`agent-compressor`); if the call fails or times out, fall back deterministically to formatting each middle turn as `[Turn N | tools: <names>] <first 200 chars>`.
    - Verify `SHA-256(systemPrompt + taskBrief)` before and after compression to enforce ADR-061 prompt cache prefix invariance.
  - **Prompt Compilation Harness (`scripts/prompts-compile.ts`)**:
    - Evaluate candidate prompt variants per target alias (`agent-planner`, `agent-coder`, `agent-reviewer`) against golden fixture criteria using composite score `0.5 * schemaCompliance + 0.3 * constraintAdherence + 0.2 * tokenEfficiency`.
    - Persist the winning compiled prompt JSON to `prompts/compiled/<alias>.prompt.json`.
  - **Trajectory Exporter (`trajectory-export.ts`)**:
    - Gate strictly on `dataset.collect === true` AND `strikes === 0` AND `agreedHighSeverityFindings === 0`.
    - Compress middle turns if `turns.length > 10`, scrub credentials/secrets (`sk-*`, `ghp_*`, `glpat-*`, `xox[baprs]-*`, `Bearer <token>`, `postgres(ql)://...`, PEM blocks, `.env` `KEY=VALUE` secrets) and replace configured workspace/org/project names with `<REDACTED_PROJECT>`.
    - Write OpenAI-compatible JSONL (`{"messages": [...], "metadata": {"taskId", "modelAlias", "strikes": 0, "compressed": boolean}}`) under `.agents/dataset/trajectories/YYYY-MM/`.
- **Rationale**: Satisfies ADR-060, ADR-061, ADR-064, and ADR-068 with zero external lock-in and fail-closed privacy protection.
- **Alternatives Considered**:
  - Summarizing the entire conversation including system prompt or recent turns (rejected: invalidates KV prompt cache and loses immediate working state).

