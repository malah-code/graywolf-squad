# Architectural Research: Trajectory Compression Harvester, Privacy Redactor & Local SFT Dataset Pipeline (`020-trajectory-compression-and-dataset`)

**Date**: 2026-11-01  
**Spec**: [spec.md](file:///home/tarikelmallah/Projects/GraywolfSquad/specs/020-trajectory-compression-and-dataset/spec.md)  
**References**: ADR-064 (Hermes Trajectory Compression for Fine-Tuning Dataset Generation), ADR-079 (System-One Decision Model Evaluation Harness), PRD §9.11

---

## 1. Eligible Trajectory Filtering (ADR-064)

- **Decision**: Filter candidate trajectories strictly via a deterministic predicate `evaluateTrajectoryEligibility(candidate, config)`:
  - `config.collect === true` (opt-in only; defaults to `false`).
  - `candidate.status === 'COMPLETED'`.
  - `candidate.strikes === 0` (no Two-Strike escalations).
  - `candidate.agreedP0P1Findings === 0` (zero high-severity findings in Dev-Level-2 adversarial review).
- **Rationale**: Failed, escalated, or flawed trajectories introduce negative training signals into small language models (SLMs) during Supervised Fine-Tuning (SFT). By enforcing a zero-defect gate, every JSONL example represents a gold-standard execution trace in the target codebase.
- **Alternatives Considered**:
  - *Harvesting Strike-1 recovery trajectories for DPO (Direct Preference Optimization)*: Deferred to future RLHF/DPO extensions; Phase 19 focuses strictly on clean SFT trajectories per ADR-064.

---

## 2. Hermes Protect-Head / Protect-Tail / Summarize-Middle Compression

- **Decision**: Implement `compressHermesTrajectory()` in `src/orchestrator/learning/trajectory-compressor.ts` faithful to the Hermes `trajectory_compressor.py` pattern:
  - **Protected Head**: System prompt + initial task brief (`user` role) + first `assistant` turn (index `0` of conversation turns if `role === 'assistant'`, or up through the first `assistant` turn and its immediate `tool` results if paired).
  - **Protected Tail**: Configurable `protectTailTurns` (default `4` turns). If the first turn of the Protected Tail has `role === 'tool'`, expand the Protected Tail backwards to include the preceding `assistant` turn so tool-call / tool-result pairs are never orphaned across the compression boundary.
  - **Compressible Middle**: All turns strictly between Protected Head and Protected Tail. When `middleTurns.length === 0`, compression is a safe no-op (`compressed: false`).
  - **Summarization**: Supports an optional async `auxiliarySummarizer(middleTurns)` callback with a deterministic fallback formatter (`buildHermesMiddleNarration(middleTurns)`) that produces a single `[Hermes Compressed Middle Trajectory — N turns]` narration turn.
- **Rationale**: Preserves the initial architectural plan (Head) and the final verification/patch synthesis steps (Tail) verbatim while bounding intermediate file-read/search loops.

---

## 3. Multi-Layer Privacy Redaction Gate

- **Decision**: Implement `redactTrajectoryPrivacy()` in `src/orchestrator/learning/dataset-manager.ts` combining:
  1. **Workspace Path Stripping**: Replaces occurrences of the absolute `workspaceRoot` prefix (e.g. `/home/user/project/` or `/workspace/repo/`) with `<REDACTED_PATH>/`, while keeping relative repository file paths (`src/orchestrator/index.ts`) intact so fine-tuned models retain project structure awareness.
  2. **Git Remote Credential & URL Stripping**: Replaces `https://<token>@github.com/...` and `git@github.com:...` remote URLs with `<REDACTED_GIT_REMOTE>`.
  3. **Secret, Token, DB URL & Private Key Scrubbing**: Reuses and extends the regex patterns from `trajectory-export.ts` (`<REDACTED_SECRET>`, `Bearer <REDACTED_TOKEN>`, `<REDACTED_DB_URL>`, `<REDACTED_PRIVATE_KEY>`).
  4. **Project-Configured `sensitiveIdentifiers`**: Replaces custom strings configured in `dataset.sensitiveIdentifiers` with `<REDACTED_PROJECT>`.
- **Rationale**: Ensures zero leakage of credentials, host user paths, or proprietary organization identifiers before any JSONL line touches disk.

---

## 4. Deterministic 90/10 Train/Eval Split & Dual Format Export (OpenAI + ShareGPT)

- **Decision**:
  - Compute a deterministic split (`split: 'train' | 'eval'`) by hashing `taskId` with SHA-256 (`parseInt(sha256(taskId).slice(0, 8), 16) % 10 === 0 ? 'eval' : 'train'`), providing a reproducible 90% train / 10% eval partition for ADR-079 System-One SLM benchmarking.
  - Store trajectories in `.agents/dataset/trajectories/YYYY-MM/<taskId>.jsonl` with full metadata (`split`, `compressed`, `tokensBefore`, `tokensAfter`, `redactionCount`).
  - Support exporting records in both **OpenAI** (`{ messages: [{ role, content, tool_calls? }] }`) and **ShareGPT** (`{ conversations: [{ from: 'system' | 'human' | 'gpt', value }] }`) formats via `GET /api/v1/projects/:id/dataset/export`.

