# Technical Research: Brownfield Reconnaissance, 8-Layer Context Engine & Virtual Developer Tiers

**Feature**: `011-recon-context-and-dev-tiers`  
**Phase**: Phase 9

## 1. Zero-Token AST Extraction & PageRank Centrality (Tasks 9.1 & 9.2)

- **Decision**: Implement deterministic TypeScript/JavaScript/Python/Go symbol and import extraction in `src/orchestrator/recon/ast-indexer.ts` with SHA-256 file hashing and route literal normalization (`:id`, `{id}`, `<id>` -> `:id`), paired with power-iteration PageRank (`damping = 0.85`, `maxIterations = 40`, `tolerance = 1e-6`) in `src/orchestrator/recon/pagerank.ts`.
- **Rationale**: Guarantees 0 LLM token consumption in Recon Phases 1–4, fast execution (`< 1s` on fixture repositories) without requiring native C++ compilation in unit test environments, and deterministic centrality rankings where shared core modules outrank leaf callers.
- **Alternatives Considered**: Invoking an LLM to summarize every file during reconnaissance (rejected: violates 0-token Phase 1–4 constraint and blows token budgets on large repos).

## 2. Bounded Blast-Radius Algorithm & Rule 0 Invariants (Task 9.1)

- **Decision**: Enforce Rule 0 Forbidden globs (`.git/**`, `.github/**`, `.gitlab-ci.yml`, `bitbucket-pipelines.yml`, `Dockerfile*`, `helm/**`, `docker-compose*.yml`, `relay.mjs`, `.agents/constitution.md`, `.agents/project.config.json`) unconditionally, resolve feature roots from brief keywords into `writableScope`, include all transitive upstream imports in `readOnlyScope`, and restrict downstream dependents in `readOnlyScope` to `depth <= 1` and at most `20` files sorted by descending PageRank score (placing any additional direct dependents into `downstreamWatchlist`).
- **Rationale**: Directly implements ADR-012 and `docs/architecture/brownfield-reconnaissance-and-blast-radius.md` §4.1 to prevent token bloat while preserving regression visibility.
- **Alternatives Considered**: Unbounded transitive downstream inclusion (rejected: a change to a shared utility would pull the entire repository into `readOnlyScope`).

## 3. Reciprocal Rank Fusion (`RRF`, `k = 60`) & Boot-Time Immutable Context Bundle (Task 9.2)

- **Decision**: Fuse lexical (`ripgrep` / keyword match rank) and dense (`pgvector` cosine similarity rank) search lists using `score(doc) = sum(1 / (60 + rank))` (1-based rank) in `src/orchestrator/context/hybrid-search.ts`, and deep-freeze the 8-Layer `ContextBundle` (`Object.freeze`) at container boot in `src/orchestrator/context/bundle.ts` with a deterministic `prefixHash` (SHA-256).
- **Rationale**: Satisfies ADR-061 Prompt Cache Stability (100% identical system/context prefix across agent turns) and ensures exact identifier hits from lexical search are never drowned out by approximate vector matches.
- **Alternatives Considered**: Rebuilding the context bundle on every turn (rejected: invalidates prompt cache on every turn and increases input token costs by 5–10x).

## 4. 3-Pass Adversarial Review, Evidence Ledger Cross-Check & 2-Strike Arbiter (Tasks 9.3 & 9.4)

- **Decision**:
  1. Validate `findings.v1` (Pass 1, `confidence >= 0.5`), `debate.v1` (Pass 2), and `final.v1` (Pass 3 verdicts: `agreed`, `contested`, `withdrawn`) using `@sinclair/typebox` schemas in `src/orchestrator/schemas/review.ts`.
  2. Cross-check every `agreed` `P0`/`P1` finding that claims a test failure (`category === 'test'` or `claimsTestFailure === true`) against the passive verification evidence ledger: if no failing `test` command (`exitCode !== 0`) exists in the evidence records, deterministically downgrade the finding's severity to `'P2'` (`downgradedByEvidenceLedger: true`).
  3. Count `0` strikes for `withdrawn` and `contested` verdicts; increment consecutive strikes by `1` only when at least one verified `agreed P0/P1` finding remains. On the 2nd consecutive strike, invoke `arbiter.ts` (`agent-arbiter`) to synthesize `escalation-memo.md` and transition the task to `INTERNAL_REVIEW_FAILED`.
- **Rationale**: Enforces Constitution Principle 6, ADR-056 (3-Pass Adversarial Debate), and ADR-062 (Passive Verification Evidence Ledger) so hallucinated test failures or withdrawn nitpicks never waste retries or stall tasks.
- **Alternatives Considered**: Single-pass LLM code review without evidence verification (rejected: high false-positive rate and susceptible to hallucinated test failures).
