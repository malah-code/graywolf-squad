# Implementation Plan: Trajectory Compression Harvester, Privacy Redactor & Local SFT Dataset Pipeline (`020-trajectory-compression-and-dataset`)

**Branch**: `020-trajectory-compression-and-dataset` | **Date**: 2026-11-01 | **Spec**: [spec.md](file:///home/tarikelmallah/Projects/GraywolfSquad/specs/020-trajectory-compression-and-dataset/spec.md)  
**Input**: Feature specification from `/specs/020-trajectory-compression-and-dataset/spec.md` & `docs/implementation-plan-detailed.md` Phase 19

## Summary

Implement Phase 19 (Track B Initiative B3 — ADR-064 & ADR-079 Trajectory Compression Harvester, Privacy Redactor & Local SFT Dataset Pipeline):
1. **Task 19.1 (`src/orchestrator/learning/trajectory-harvester.ts`, `src/orchestrator/learning/trajectory-compressor.ts`, `tests/unit/trajectory-compressor.test.ts`)**:
   - Filter completed task trajectories strictly for zero-defect runs (`dataset.collect === true`, `status === 'COMPLETED'`, `strikes === 0`, `agreedP0P1Findings === 0`) and compute a deterministic 90/10 `train` / `eval` split from `taskId`.
   - Implement Hermes-faithful Protect-Head (system prompt + initial task brief + first assistant turn), Protect-Tail (configurable `protectTailTurns`, default `4`, expanded backwards if needed to preserve `assistant` $\rightarrow$ `tool` pair boundaries), and Summarize-Middle compression with deterministic fallback.
2. **Task 19.2 (`src/orchestrator/learning/dataset-manager.ts`, `src/orchestrator/routes/dataset.ts`, `tests/integration/trajectory-dataset-pipeline.test.ts`)**:
   - Run multi-layer privacy redaction stripping absolute workspace root paths (`<REDACTED_PATH>`), git remote URLs (`<REDACTED_GIT_REMOTE>`), API keys/tokens (`<REDACTED_SECRET>`), Bearer headers, database URLs, PEM private keys, and project-configured `sensitiveIdentifiers` (`<REDACTED_PROJECT>`) while preserving relative repository subpaths (`src/...`).
   - Persist JSONL records under `.agents/dataset/trajectories/YYYY-MM/<task-id>.jsonl` with monthly rotation, automatic/manual retention pruning, OpenAI + ShareGPT format conversion, and Control Plane REST endpoints (`GET /api/v1/projects/:id/dataset/stats`, `GET /api/v1/projects/:id/dataset/export`, `POST /api/v1/projects/:id/dataset/prune`).

## Technical Context

**Language/Version**: TypeScript 5.x (Node.js 20+)  
**Primary Dependencies**: `node:crypto`, `node:fs/promises`, `node:path`, `@sinclair/typebox`, Fastify 5.x  
**Storage**: Local filesystem JSONL dataset hierarchy (`.agents/dataset/trajectories/YYYY-MM/<task-id>.jsonl`)  
**Testing**: Vitest (`tests/unit/trajectory-compressor.test.ts`, `tests/integration/trajectory-dataset-pipeline.test.ts`)  
**Target Platform**: Linux server & local sovereign deployment (zero cloud egress required)  
**Project Type**: Backend learning/dataset pipeline & Fastify REST routes  
**Performance Goals**: `< 5ms` deterministic compression and redaction pass per trajectory  
**Constraints**: Strictly opt-in (`dataset.collect = false` by default); 100% deterministic fallback when no auxiliary LLM summarizer is configured; zero raw secret or host-path leakage  
**Scale/Scope**: 3 learning/route modules + 2 comprehensive test suites (unit + integration)

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design.*

1. **Human Sovereignty & Non-Committing Relay Contract**: **PASS** — Dataset harvesting is strictly opt-in (`dataset.collect = true`) and never mutates git upstream or repository source files.
2. **Zero Runtime Lock-In & Permissive Licensing First**: **PASS** — Adapted from MIT-licensed Hermes Agent concepts using standard Node.js built-ins and TypeBox; exports standard OpenAI and ShareGPT JSONL formats compatible with any open-source trainer (Unsloth, Axolotl, LLaMA-Factory).
3. **Single ACID Relational & Vector Baseline**: **PASS** — Operates on completed task metadata and stores training files in `.agents/dataset/trajectories/YYYY-MM/` per ADR-064 without adding external databases.
4. **Headless Execution & Observability**: **PASS** — Exposes structured dataset stats (`totalTrajectories`, `trainCount`, `evalCount`, `totalTokensBefore`, `totalTokensAfter`, `totalRedactions`).
5. **Dual Operational Mode (Greenfield & Brownfield)**: **PASS** — Relative repository paths are preserved while absolute workspace root paths are scrubbed across both Greenfield and Brownfield projects.
6. **Virtual Developer Tier Handoff Protocol**: **PASS** — Enforces the Dev-Level-2 adversarial review gate (`agreedP0P1Findings === 0` and `strikes === 0`) as the eligibility filter.
7. **Chat as Active Control Plane (Cockpit Rule)**: **PASS** — REST endpoints validate parameters with TypeBox schemas and return structured ADR-042 error codes (`ACI_VALIDATION_FAILED`).
8. **Blast-Radius and Dependency Integrity**: **PASS** — Strict path-traversal validation on `month` query parameters (`^\d{4}-(0[1-9]|1[0-2])$`).
9. **Zero-Cost Open Source Foundation ($0 Platform License)**: **PASS** — Enables users to fine-tune local open-weight models on their own codebase trajectories at $0 platform license cost.

## Project Structure

### Documentation (this feature)

```text
specs/020-trajectory-compression-and-dataset/
├── spec.md                              # Feature specification with 5 clarifications encoded
├── plan.md                              # This file
├── research.md                          # Phase 0 architectural research decisions
├── data-model.md                        # Phase 1 TypeScript & TypeBox data models
├── quickstart.md                        # Phase 1 runnable verification guide
├── checklists/
│   └── requirements.md                  # 16/16 passing quality checklist
└── contracts/
    └── dataset-api.md                   # Module & REST API contracts
```

### Source Code (repository root)

```text
src/orchestrator/learning/
├── trajectory-compressor.ts             # Task 19.1: Hermes Protect-Head / Protect-Tail / Summarize-Middle compressor
├── trajectory-harvester.ts              # Task 19.1: Zero-defect eligibility filter, 90/10 train/eval split & harvest coordinator
└── dataset-manager.ts                   # Task 19.2: Multi-layer privacy redaction, monthly rotation, pruning & OpenAI/ShareGPT export

src/orchestrator/routes/
└── dataset.ts                           # Task 19.2: GET /stats, GET /export, POST /prune Fastify routes

tests/
├── unit/
│   └── trajectory-compressor.test.ts    # Task 19.1 unit test suite
└── integration/
    └── trajectory-dataset-pipeline.test.ts # Task 19.2 integration test suite
```

## Complexity Tracking

No constitution violations or complexity exemptions required.
