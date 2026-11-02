# Feature Specification: Brownfield Reconnaissance, 8-Layer Context Engine & Virtual Developer Tiers

**Feature Branch**: `011-recon-context-and-dev-tiers`

**Created**: 2026-10-25

**Status**: Draft

**Input**: User description: "Phase 9 Brownfield Reconnaissance, 8-Layer Context Engine & Virtual Developer Tiers: Implement the 5-Phase Brownfield Reconnaissance Pipeline, the 8-Layer Context Bundle (Boot-Time Immutable), and the Dev-Level-1 (Planner) ➔ Dev-Level-3 (Implementer + e2e mcp) ➔ Dev-Level-2 (3-Pass Adversarial Debate) ➔ Neutral Arbiter pipeline (PRD §2.2, §4)."

## Clarifications

### Session 2026-10-25
- Q: How does the 5-Phase Reconnaissance Pipeline handle Phase 1–4 token consumption vs. Phase 5 report synthesis? → A: Phases 1–4 (`fingerprint`, `ast-indexer`, `pagerank`, `blast-radius`) are 100% deterministic and consume 0 LLM tokens; Phase 5 (`constitution-loader` & `pipeline`) deterministically merges existing project instruction files (`AGENTS.md`, `CLAUDE.md`, `.cursorrules`, `.windsurfrules` per ADR-038 precedence) and optionally invokes `agent-planner` (`Dev-Level-1`) to synthesize `.agents/recon-report.md` and `.agents/constitution.md` (falling back to a deterministic Markdown template when run in offline/0-token mode).
- Q: How does the Layer 2 Symbol Index prevent stale line numbers after Dev-Level-3 mutates a file mid-task? → A: `find_symbol_definition` and `find_symbol_references` compute a SHA-256 content hash of the target file on disk and compare it against `code_symbols.hash`; on mismatch, the symbol engine synchronously re-parses that file before returning symbol definitions or references.
- Q: How does Dev-Level-2 (In-Container Reviewer) count strikes across the 3-pass adversarial debate (`findings.v1` ➔ `debate.v1` ➔ `final.v1`) and verify test failure claims? → A: Only `agreed` findings with severity `P0` or `P1` count toward a review rejection strike (+1 strike per failed review cycle). Findings with verdict `withdrawn` or `contested` add 0 strikes (`contested` findings are attached to the escalation memo if escalated). Furthermore, any `agreed P0/P1` finding claiming a test failure without a corresponding failing `test` command record (`exit_code != 0`) in the verification evidence ledger (`.agent_evidence.db` / `review_evidence`, ADR-062) is automatically downgraded to `P2` advisory so hallucinated test failures never burn a strike.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - 5-Phase Brownfield Reconnaissance & Algorithmic Blast-Radius Proposal (Priority: P1)

As a lead engineer onboarding an existing brownfield repository into Graywolf Squad, I need a deterministic reconnaissance pipeline that fingerprints the tech stack, indexes AST symbols and call graphs, computes file centrality via PageRank, proposes bounded Writable / Read-Only / Forbidden blast-radius scopes, and synthesizes `.agents/recon-report.md` and `.agents/constitution.md` so agents never guess project conventions or touch protected CI/CD infrastructure.

**Why this priority**: In brownfield repositories, executing tasks without accurate convention discovery and blast-radius boundaries risks breaking CI/CD pipelines or mutating core shared modules.

**Independent Test**: Can be fully tested against a multi-module TypeScript fixture repository by running the 5-phase reconnaissance pipeline and verifying 0-token detection of frameworks/CI files, `code_symbols`/`code_references` extraction, PageRank scoring, bounded downstream blast-radius calculation (`depth <= 1`, max `20` files), and generation of `.agents/recon-report.md` and `.agents/constitution.md`.

**Acceptance Scenarios**:

1. **Given** a target repository containing `package.json`, `.github/workflows/ci.yml`, `.gitlab-ci.yml`, `Dockerfile`, and source modules, **When** Phase 1 (`fingerprint`) and Phase 4 (`blast-radius`) execute, **Then** the pipeline detects the framework/test runner with 0 LLM tokens and automatically classifies all CI/CD, container, and platform control files (`.git/**`, `.github/**`, `.gitlab-ci.yml`, `Dockerfile*`, `relay.mjs`, `.agents/constitution.md`, `.agents/project.config.json`) into the immutable **Forbidden Scope** (Rule 0).
2. **Given** a multi-module repository, **When** Phase 2 (`ast-indexer`) and Phase 3 (`pagerank`) execute, **Then** exported functions, classes, interfaces, and API route literals are extracted with line ranges and SHA-256 hashes, and a directed dependency graph assigns PageRank centrality scores where core shared modules rank higher than leaf modules.
3. **Given** a feature brief targeting a specific domain keyword (e.g., `"billing"`), **When** Phase 4 (`blast-radius`) computes scopes, **Then** matching feature and test directories are placed in `writableScope`, transitive upstream imports are placed in `readOnlyScope`, and direct downstream dependents (`depth <= 1`) are capped at a maximum of `20` highest-PageRank files in `readOnlyScope` with any overflow logged to the Downstream Regression Watchlist.
4. **Given** a repository containing instruction files (`AGENTS.md`, `CLAUDE.md`, `.cursorrules`, `.windsurfrules`), **When** Phase 5 (`constitution-loader` & `pipeline`) executes, **Then** instruction rules are merged according to ADR-038 precedence and `.agents/recon-report.md`, `.agents/recon-report.json` (orchestrator source-of-truth for F14), and `.agents/constitution.md` are emitted.

---

### User Story 2 - Boot-Time Immutable 8-Layer Context Bundle & Hybrid Exploration Engine (Priority: P1)

As an autonomous developer tier executing inside a task container, I need a boot-time immutable 8-Layer Context Bundle (~10,000–20,000 working tokens) and on-demand exploration tools (PageRank Repo Map, AST Symbol Graph with hash-verified re-indexing, Hybrid `ripgrep` + `pgvector` RRF search, and surgical file slicing) so I can navigate large codebases accurately while preserving prompt-cache prefixes (ADR-061).

**Why this priority**: Prevents context-window bloat, eliminates hallucinated imports, and maintains high prompt-cache hit rates across multi-turn agent execution.

**Independent Test**: Can be tested by assembling an 8-Layer Context Bundle at container boot, verifying byte-for-byte prefix immutability across turns, running PageRank repo-map token-budget trimming (~1,500 tokens), executing RRF (`k = 60`) fusion over lexical and vector search results, and testing surgical file slicing (`view_file_range`, `replace_file_content`).

**Acceptance Scenarios**:

1. **Given** a project's indexed symbols and PageRank scores, **When** Layer 1 (`repo-map`) renders the topological outline, **Then** symbols are included in descending PageRank order and strictly truncated at the configured token budget (default `1,500` tokens).
2. **Given** a symbol query via Layer 2 (`find_symbol_definition` or `find_symbol_references`), **When** the target file on disk has been modified since indexing (SHA-256 hash mismatch), **Then** the symbol graph synchronously re-indexes the modified file before returning up-to-date line numbers and references.
3. **Given** a natural-language or identifier query in Layer 3 (`hybrid-search`), **When** lexical (`ripgrep`) and dense vector (`pgvector` 768-dim `nomic-embed-text`) rankings are returned, **Then** the engine merges them deterministically using Reciprocal Rank Fusion (`RRF_Score(d) = Σ 1 / (60 + rank_m(d))`).
4. **Given** a container boot sequence, **When** `bundle.ts` assembles Layers 1–8 (Repo Map, Symbol Graph metadata, Hybrid Search hints, Surgical Slice descriptors, Project State Summary, `project_lessons` Anti-Patterns, Architecture Context, and gated Internet Search logger), **Then** the assembled boot bundle is frozen as an immutable prefix to guarantee ADR-061 prompt cache stability.

---

### User Story 3 - Virtual Developer Tier Handoff (Dev-Level-1 ➔ Dev-Level-3 ➔ Dev-Level-2 3-Pass Debate ➔ Neutral Arbiter) (Priority: P1)

As a task orchestrator enforcing Constitution Principle 6, I need every task to progress through **Dev-Level-1 (Planner)** ➔ **Dev-Level-3 (Implementer)** ➔ **Dev-Level-2 (3-Pass Adversarial Reviewer)** with evidence-ledger cross-checking and a **2-Strike Neutral Arbiter (`agent-arbiter`)** escalation rule so no unverified code reaches external QA guards and no task wastes tokens on a third auto-retry.

**Why this priority**: Enforces the core cognitive architecture of Graywolf Squad (Constitution Principle 6), preventing single-model confirmation bias and infinite retry loops.

**Independent Test**: Can be tested by running the Planner, Implementer, 3-Pass Reviewer (`findings.v1` ➔ `debate.v1` ➔ `final.v1`), and Arbiter tiers against simulated gateway responses and `.agent_evidence.db` records, verifying locale/LTR rules, `<untrusted_browser_observation>` wrapping, evidence-backed P0/P1 downgrade, strike counting, and 2-strike escalation to `INTERNAL_REVIEW_FAILED`.

**Acceptance Scenarios**:

1. **Given** a task brief and project configuration, **When** Dev-Level-1 (`planner.ts`) runs, **Then** it honors `simplebugs.skipPlanning` and Access Mode (`Plan / Read-Only`, `Plan-Gate`, `Full Factory`), generates `plan.md` in the configured `locale` (`ar | en | fr | tr`) while keeping code identifiers and file paths strictly LTR (ADR-081), and validates all planned target files against `BlastRadiusGuard`.
2. **Given** an approved `plan.md`, **When** Dev-Level-3 (`implementer.ts`) executes `delegate-fleet.v1` lanes on a `ui` or `mandatory-e2e` task, **Then** in-container Chromium MCP observations (`browser_observe`, `browser_locate`, `browser_act`) are restricted to the allowed preview origin and wrapped in `<untrusted_browser_observation>` tags (ADR-077) to prevent indirect prompt injection.
3. **Given** Dev-Level-3 completes implementation, **When** Dev-Level-2 (`reviewer.ts`) executes the 3-pass adversarial review (`findings.v1` Pass 1 with `confidence >= 0.5` ➔ `debate.v1` Pass 2 cross-family challenge ➔ `final.v1` Pass 3 verdict synthesis), **Then** any `agreed P0/P1` finding that alleges a test failure without a matching non-zero exit code `test` entry in `.agent_evidence.db` / `review_evidence` is automatically downgraded to `P2` advisory.
4. **Given** a completed `final.v1` review packet, **When** strike accounting evaluates verdicts, **Then** `withdrawn` findings add `0` strikes, `contested` findings add `0` strikes, and one or more verified `agreed P0/P1` findings increment the task's consecutive strike counter by `1` (emitting `review-signoff.md` when `0` blocking `agreed P0/P1` findings remain).
5. **Given** a task incurs `2` consecutive review strikes, **When** the 2nd strike is recorded, **Then** the orchestrator invokes the Neutral Arbiter (`arbiter.ts` via `agent-arbiter`) to synthesize `escalation-memo.md` (containing a plain-English dispute summary, Option A/B trade-offs, and a recommended default) and transitions the task state to `INTERNAL_REVIEW_FAILED`.

---

### Edge Cases

- **Downstream dependent explosion (>20 consumer files)**: When a shared utility is imported by more than 20 downstream files, Phase 4 (`blast-radius.ts`) includes only the top 20 direct dependents (`depth <= 1`) ranked by PageRank in `readOnlyScope` and logs the remaining files under `"Downstream Regression Watchlist"` in `recon-report.md` to prevent context budget exhaustion.
- **Hallucinated test failure in Pass 3 (`final.v1`)**: When the reviewer marks a `P0` or `P1` finding as `agreed` with category `'test'` (claiming tests fail), but the passive verification evidence ledger shows all executed `test` commands exited with `0` (or no failing test exists), the reviewer engine deterministically downgrades the finding severity to `'P2'` so it cannot trigger a false rejection strike.
- **Mid-task file edit invalidating AST line numbers**: When Dev-Level-3 edits a file using `replace_file_content`, a subsequent `find_symbol_definition` or `find_symbol_references` call detects the SHA-256 hash change and re-indexes that file on the fly before returning symbol coordinates.
- **Browser DOM prompt injection attempt**: When a rendered page during `browser_observe` contains adversarial text attempting to hijack agent instructions, `implementer.ts` encapsulates all browser tool outputs inside `<untrusted_browser_observation>` delimiters and rejects navigation outside the configured preview origin.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001 (5-Phase Brownfield Reconnaissance)**: System MUST implement the 5-phase reconnaissance pipeline (`fingerprint.ts`, `ast-indexer.ts`, `pagerank.ts`, `blast-radius.ts`, `constitution-loader.ts`, `pipeline.ts`) where Phases 1–4 execute deterministically with 0 LLM tokens and Phase 5 ingests `AGENTS.md`, `CLAUDE.md`, `.cursorrules`, and `.windsurfrules` (ADR-038) to emit `.agents/recon-report.md`, `.agents/recon-report.json`, and `.agents/constitution.md`.
- **FR-002 (Rule 0 Forbidden Scope & Bounded Blast-Radius Algorithm)**: System MUST always place `.git/**`, `.github/**`, `.gitlab-ci.yml`, `bitbucket-pipelines.yml`, `Dockerfile*`, `helm/**`, `docker-compose*.yml`, `relay.mjs`, `.agents/constitution.md`, and `.agents/project.config.json` into `forbiddenScope`, assign matched feature/test directories to `writableScope`, assign transitive upstream imports to `readOnlyScope`, and bound downstream dependents in `readOnlyScope` to `depth <= 1` and at most `20` files ordered by PageRank centrality.
- **FR-003 (8-Layer Boot-Time Immutable Context Bundle)**: System MUST assemble the 8-Layer Context Bundle once at container boot (`bundle.ts`) and freeze its static prefix (ADR-061), incorporating Layer 1 PageRank Repo Map (~1,500 tokens), Layer 2 Symbol Graph (`find_symbol_definition`, `find_symbol_references` with SHA-256 hash-verified on-demand re-indexing and route literal normalization), Layer 3 Hybrid Search (`ripgrep` + `pgvector` fused via RRF `k = 60`), Layer 4 Surgical File Slicing (`view_file_range`, `replace_file_content`), and Layers 5–8 (Project State Summary, `project_lessons` Anti-Patterns, Architecture Context, and gated Internet Search logger).
- **FR-004 (Dev-Level-1 Planner & Locale/Access Governance)**: System MUST implement `planner.ts` (`agent-planner`) honoring `simplebugs.skipPlanning` and Access Mode (`Plan / Read-Only`, `Plan-Gate`, `Full Factory`), validating planned target files against `BlastRadiusGuard`, and emitting `plan.md` in the configured `locale` (`ar | en | fr | tr`) with code blocks, symbols, and file paths preserved in LTR.
- **FR-005 (Dev-Level-3 Implementer & Sandboxed Browser MCP)**: System MUST implement `implementer.ts` (`agent-coder`) orchestrating `delegate-fleet.v1` execution and exposing in-container Chromium MCP tools (`browser_observe`, `browser_locate`, `browser_act`) for `ui` / `mandatory-e2e` tasks locked to the preview server origin with outputs wrapped in `<untrusted_browser_observation>` tags (ADR-077).
- **FR-006 (Dev-Level-2 3-Pass Adversarial Debate & Evidence Downgrade)**: System MUST implement TypeBox/structured schemas (`review.ts`) and `reviewer.ts` (`agent-reviewer`) executing Pass 1 (`findings.v1`, `confidence >= 0.5`), Pass 2 (`debate.v1` cross-model challenge & gap sweep), and Pass 3 (`final.v1` verdicts: `agreed`, `contested`, `withdrawn`), automatically downgrading any `agreed P0/P1` test-failure claim lacking a matching failing `test` record in the evidence ledger (ADR-062) to `P2` advisory.
- **FR-007 (Strike Accounting & 2-Strike Neutral Arbiter Escalation)**: System MUST count `0` strikes for `withdrawn` and `contested` findings, increment consecutive strikes by `1` when one or more verified `agreed P0/P1` findings remain, emit `review-signoff.md` when a review pass succeeds with `0` blocking findings, and on the 2nd consecutive strike invoke `arbiter.ts` (`agent-arbiter`) to generate `escalation-memo.md` and transition the task to `INTERNAL_REVIEW_FAILED`.

### Key Entities

- **Reconnaissance Report & Blast-Radius Proposal (`ReconReport`)**: Structured output of the 5-phase recon pass containing detected frameworks, test/lint commands, PageRank file rankings, proposed `writableScope`, `readOnlyScope`, `forbiddenScope`, downstream regression watchlist, and discovered convention rules.
- **8-Layer Context Bundle (`ContextBundle`)**: Boot-time frozen context artifact containing the token-capped Layer 1 repo map, Layer 2–4 tool descriptors, and Layers 5–8 project state, lessons, and architecture context.
- **Adversarial Review Packet (`FindingsV1`, `DebateV1`, `FinalV1`)**: Typed 3-pass review artifacts tracking individual finding IDs, severities (`P0`, `P1`, `P2`), confidence scores (`0.0`–`1.0`), Pass 2 challenges (`confirm`, `refute`), and Pass 3 final verdicts (`agreed`, `contested`, `withdrawn`).
- **Escalation Decision Memo (`EscalationMemo`)**: Structured markdown and metadata artifact synthesized by `agent-arbiter` after 2 consecutive review strikes or contested architectural deadlocks, presenting a plain-English summary, Option A vs. Option B trade-offs, and a recommended default.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001 (Zero-Token Recon & Bounded Blast Radius)**: Phases 1–4 of the reconnaissance pipeline consume `0` LLM tokens, classify 100% of Rule 0 CI/CD and control files into `forbiddenScope`, and cap downstream dependents in `readOnlyScope` to `<= 20` direct consumers (`depth <= 1`).
- **SC-002 (Repo Map Token Cap & Cache Immutability)**: Layer 1 repo map output strictly respects its configured token budget (`<= 1,500` tokens by default), Layer 3 RRF (`k = 60`) deterministically ranks exact keyword + semantic hits, and the assembled 8-Layer Context Bundle prefix remains 100% byte-identical across subsequent agent turns within a container session.
- **SC-003 (Adversarial Debate & Evidence Accuracy)**: 100% of `withdrawn` and `contested` findings contribute `0` strikes, 100% of `agreed P0/P1` test-failure claims without a matching failing test in the evidence ledger are downgraded to `P2`, and 2 consecutive strikes deterministically trigger `escalation-memo.md` generation and transition the task to `INTERNAL_REVIEW_FAILED`.
- **SC-004 (Planner & Implementer Safety Boundaries)**: 100% of `planner.ts` outputs validate target files against `BlastRadiusGuard` before handoff, and 100% of `implementer.ts` browser MCP observations enforce origin locking and `<untrusted_browser_observation>` encapsulation.

## Assumptions

- PostgreSQL tables `code_symbols`, `code_references`, `project_lessons`, and `review_evidence` from Phase 1 (`migrations/1789444040216_create-tasks-table.js`) and `withTenantContext` are available.
- `LiteLLMClient` from Phase 8 (`src/orchestrator/gateway/litellm-client.ts`) is used by `planner.ts` (`agent-planner`), `implementer.ts` (`agent-coder`), `reviewer.ts` (`agent-reviewer`), and `arbiter.ts` (`agent-arbiter`).
- `BlastRadiusGuard` from Phase 7 (`src/orchestrator/arp/blast-radius-guard.ts`) and task state transitions from Phase 5 (`src/orchestrator/services/state-machine.ts`) are available for tier handoff and `INTERNAL_REVIEW_FAILED` transitions.
