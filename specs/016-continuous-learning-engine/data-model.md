# Data Model: Continuous Learning Engine, Stall Guardrails & Context Compression

**Feature**: `016-continuous-learning-engine` (Phase 14)  
**Date**: 2026-11-01  
**Canonical Schema Reference**: `migrations/1789444040216_create-tasks-table.js` (`project_lessons`, `skills`)

---

## 1. Project Lesson & Anti-Pattern Record (`ProjectLessonRecord`)

Maps directly to the PostgreSQL `project_lessons` table (with `vector(768)` embedding and dual workspace/org RLS policy).

| Field | Type | Constraints | Description |
|---|---|---|---|
| `id` | `string` (UUID) | PK | Unique lesson identifier |
| `orgId` | `string` (UUID) | NOT NULL, FK | Organization ID for RLS isolation |
| `workspaceId` | `string` (UUID) | NOT NULL, FK | Workspace ID for RLS isolation |
| `projectId` | `string` (UUID) | NOT NULL, FK | Project ID |
| `isOrgWide` | `boolean` | Default `false` | Whether shared across all workspaces in the org |
| `sourceTaskId` | `string \| null` | `VARCHAR(64)` | Originating task ID |
| `provenance` | `'reflection_memory' \| 'anti_pattern' \| 'human_gate_diff'` | `VARCHAR(32)` | Learning axis source |
| `confidenceScore` | `number` | `0.00 .. 1.00` | Confidence weight (`NUMERIC(3,2)`) |
| `category` | `LessonCategory` | `VARCHAR(32)` | `'LLM_CODE_SMELL' \| 'TEST_INTEGRITY' \| 'logic_error' \| 'convention_violation' \| 'missing_edge_case' \| 'performance_issue' \| 'security_fix' \| 'architecture_convention'` |
| `triggerScope` | `string[]` | `TEXT[]` | File path globs or task tags where this lesson applies |
| `summary` | `string` | `TEXT`, NOT NULL | Concise one-line summary of the lesson or anti-pattern |
| `ruleContent` | `string` | `TEXT`, NOT NULL | Actionable positive rule or negative planner constraint |
| `embedding` | `number[]` | `length === 768` | 768-dimensional L2-normalized vector (`nomic-embed-text`) |
| `status` | `'active' \| 'archived'` | Default `'active'` | Lifecycle status |

**Planner Retrieval Filter (`retrieveLessonsForPlan`)**:
- Cosine similarity `>= 0.75` against query embedding
- Returns at most `top-5` lessons (`provenance IN ('reflection_memory', 'human_gate_diff')`) and `top-3` anti-patterns (`provenance === 'anti_pattern'`)

---

## 2. Hermes-Strict Skill Document (`SkillDocument`)

Maps to `.agents/skills/<name>/SKILL.md` (or `.agents/skills/.archive/<name>/SKILL.md`) and the PostgreSQL `skills` table.

| Field | Type | Validation Rule |
|---|---|---|
| `name` | `string` | `/^[a-z0-9]+(?:-[a-z0-9]+)*$/`, `1..64` chars |
| `description` | `string` | Single sentence ending in `.`, `1..60` chars, zero marketing buzzwords |
| `version` | `string` | Semver starting at `'0.1.0'` |
| `origin` | `'agent-created' \| 'user-created'` | `user-created` is immutable to curator/reflection |
| `pinned` | `boolean` | `pinned: true` is immune to staleness and archival |
| `status` | `'active' \| 'stale' \| 'archived' \| 'pending_deletion' \| 'deleted'` | Managed by `SkillCurator` |
| `lastUsedAt` | `string` (ISO-8601) | Used for `14d` (`stale`) and `30d` (`archived`) transitions |
| `archivedAt` | `string \| null` | Used for `90d` (`pending_deletion`) transition |
| `sections` | `SkillSections` | Mandatory ordered sections: `Title`, `When to Use`, `Prerequisites`, `How to Run`, `Quick Reference`, `Procedure`, `Pitfalls`, `Verification` |

**Skill Lifecycle State Machine (`agent-created` & `pinned === false` only)**:
- `active` ➔ `stale`: unused `>= 14` days
- `stale` (or `active`) ➔ `archived`: unused `>= 30` days (file moved to `.agents/skills/.archive/<name>/SKILL.md`)
- `archived` ➔ `pending_deletion`: archived `>= 90` days
- `pending_deletion` ➔ `deleted`: requires explicit operator approval (`operatorApprovedDeletionIds`)

---

## 3. Stall Detection Verdict & Report (`StallCheckResult`, `StallReport`)

| Field | Type | Description |
|---|---|---|
| `action` | `'none' \| 'warn' \| 'hard_interrupt' \| 'turn_cap_nudge'` | Immediate supervisor directive |
| `detectorTriggered` | `'exact_failure_streak' \| 'multi_call_cycle' \| 'per_turn_command_cap' \| 'identical_action_observation' \| 'identical_diff_streak' \| null` | Which guardrail fired |
| `streakOrLapCount` | `number` | Current streak count or cycle lap count |
| `taskStatus` | `'STALL_ESCALATED' \| null` | Set on `hard_interrupt` (maps to canonical `ESCALATED` in `state-machine.ts`) |
| `strikeIncrement` | `0 \| 1` | `1` on `hard_interrupt`, `0` otherwise |
| `nudgeMessage` | `string \| null` | Warning or turn-cap message injected into agent stream |
| `stallReport` | `StallReport \| null` | Attached diagnostic report on `hard_interrupt` (`taskId`, `detector`, `normalizedSignatures`, `recentCommands`, `detectedAt`) |

---

## 4. Container Terminal-State Protocol (`AgentTerminalStatus`, `StatusProtocolOutcome`)

TypeBox-validated schema for `<worktree>/.agent_status.json`:

```json
{
  "status": "patch_ready",
  "summary": "Implemented 3-axis reflection worker and passed unit tests.",
  "artifacts": ["changes.patch"],
  "exit_reason": "All acceptance criteria satisfied"
}
```

| Field | Type | Constraints |
|---|---|---|
| `status` | `'patch_ready' \| 'blocked' \| 'needs_clarification'` | Required enum |
| `summary` | `string` | `minLength: 1` |
| `artifacts` | `string[]` | Array of relative artifact paths |
| `exit_reason` | `string` | `minLength: 1` |

**Supervisor Verification Outcome (`StatusProtocolOutcome`)**:
- `valid: true` ➔ `protocolStatus: status.status`, `nudgeRequired: false`, `strikeIncrement: 0`, `escalated: false`
- `valid: false` and `previousNudges < 2` ➔ `protocolStatus: 'nudge_retry'`, `nudgeRequired: true`, `nudgeCount: previousNudges + 1`, `strikeIncrement: 0`, `escalated: false`
- `valid: false` and `previousNudges >= 2` ➔ `protocolStatus: 'protocol_violation'`, `nudgeRequired: false`, `nudgeCount: 2`, `strikeIncrement: 1`, `escalated: true`

---

## 5. Context Compression Envelope (`CompressedContextResult`)

| Field | Type | Description |
|---|---|---|
| `compressed` | `boolean` | Whether compression ran (`> 80%` tokens or `forceCompact` with `turns.length > 10`) |
| `protectedHead` | `{ systemPrompt: string; taskBrief: string; firstTurns: ConversationTurn[] }` | System prompt + brief + first `2` turns (never modified) |
| `compressedMiddleSummary` | `string \| null` | Summary of `turns.slice(2, -8)` |
| `protectedTail` | `ConversationTurn[]` | Last `8` turns (never modified) |
| `reconstructedTurns` | `ConversationTurn[]` | Ready-to-send turn array (`firstTurns + [middleSummaryTurn] + protectedTail`) |
| `usedFallback` | `boolean` | `true` if deterministic heuristic fallback (`[Turn N \| tools] <200 chars>`) was used |
| `systemPromptHashPreserved` | `boolean` | `SHA-256(systemPrompt + taskBrief)` before === after (ADR-061 invariant) |
| `tokensBefore` | `number` | Estimated tokens prior to compression |
| `tokensAfter` | `number` | Estimated tokens after compression |

---

## 6. Compiled Prompt Artifact & Fine-Tuning Trajectory Entry

### Compiled Prompt (`CompiledPromptArtifact` at `prompts/compiled/<alias>.prompt.json`)
- `alias`: `'agent-planner' | 'agent-coder' | 'agent-reviewer' | string`
- `selectedVariantId`: `string`
- `compositeScore`: `number` (`0.5 * schemaCompliance + 0.3 * constraintAdherence + 0.2 * tokenEfficiency`)
- `scores`: `{ schemaCompliance: number; constraintAdherence: number; tokenEfficiency: number }`
- `systemPromptTemplate`: `string`
- `compiledAt`: `string` (ISO-8601)

### Fine-Tuning Trajectory JSONL (`TrajectoryJsonlEntry` at `.agents/dataset/trajectories/YYYY-MM/<taskId>.jsonl`)
- `messages`: `Array<{ role: 'system' | 'user' | 'assistant' | 'tool'; content: string }>` (with middle turns compressed and all secrets/project identifiers scrubbed to `<REDACTED_*>`)
- `metadata`: `{ taskId: string; modelAlias: string; strikes: 0; compressed: boolean; redactionCount: number; exportedAt: string }`

