# Graywolf Squad — Architecture Decision Records (ADRs)

This document tracks all foundational architectural decisions, their context, rationale, alternatives considered, and consequences.

**ADR Status Lifecycle**:
- **Proposed**: Under discussion.
- **Accepted**: Approved for implementation.
- **Superseded-by-implementation-experience**: Overturned or heavily revised after confronting reality in the codebase.
- **Deprecated**: No longer relevant.

---

## ADR-001: Separation of Discovery Phase (PRD) from Implementation Specs

- **Date**: 2026-09-10
- **Status**: Accepted
- **Context**: The product vision for Graywolf Squad is expansive and evolving (greenfield vs. brownfield, virtual dev tiers, chat control plane, blast-radius boundaries). Jamming all base requirements into a single Spec Kit `spec.md` created an oversized, rigid document that forced premature acceptance-test criteria before requirements were fully brainstormed.
- **Decision**: 
  - Maintain `docs/PRD.md` as the living master product requirements document for brainstorming, deep analysis, and continuous requirements expansion.
  - Maintain `docs/decisions.md` as the log of architectural decisions.
  - Spec Kit `specs/` will only be generated when a specific domain of the PRD is declared mature and ready for implementation.
- **Consequences**: Fast, free-form requirements discovery without being bottlenecked by premature task execution or rigid Spec Kit phase gating.

---

## ADR-002: Dual Operating Modes (Greenfield Autonomous House vs. Brownfield Embedded Squad)

- **Date**: 2026-09-10
- **Status**: Accepted
- **Context**: Autonomous coding platforms are typically designed either as stand-alone scratch builders or as in-IDE pair programmers. Graywolf needs to function as a complete software house, but also embed into existing client/team codebases (e.g., an accounting app in development by another company on GitLab) to build dedicated features without risking regressions.
- **Decision**: 
  - Support two explicit modes: `greenfield` and `brownfield`.
  - In brownfield mode, enforce three scope tiers: `Writable`, `Read-Only`, and `Forbidden`.
  - Require a pre-implementation Reconnaissance Pass producing `recon-report.md`.
  - Enforce hard execution halts with `escalation-request.md` if an agent determines it must modify files outside its declared writable scope.
- **Consequences**: Enterprise safety. Client teams can trust Graywolf with feature modules knowing core auth, shared databases, and CI/CD pipelines cannot be altered without explicit human intervention.

---

## ADR-003: Cognitive Virtual Developer Tiering Inside a Single Container

- **Date**: 2026-09-10
- **Status**: Accepted
- **Context**: Multi-agent systems frequently spawn separate Docker containers for each agent persona (e.g., one container for architect, one for coder, one for tester). This causes massive host resource overhead, network latency, and complex inter-container volume locking.
- **Decision**: 
  - Each task executes in a **single ephemeral container**.
  - Inside that container, a sequential cognitive handoff occurs between virtual developer personas:
    - **Dev-Level-1 (Planner)**: Writes `plan.md` using frontier reasoning models.
    - **Dev-Level-3 (Implementer)**: Synthesizes code and runs commands using high-throughput models.
    - **Dev-Level-2 (In-Container Reviewer)**: Runs tests and reviews diffs using analytical models, producing `review-signoff.md`.
  - Apply the **Two-Strike Rule**: if Dev-Level-2 rejects code twice consecutively, escalate to human review immediately.
- **Consequences**: Drastically reduces container spin-up overhead and host resource contention while maintaining rigorous peer-review quality before patches reach external QA guards.

---

## ADR-004: Conversational Chat Agent as Active Control Plane (Cockpit Pattern)

- **Date**: 2026-09-10
- **Status**: Accepted
- **Context**: Typical AI coding tools treat chat as a read-only advisor or passive prompt generator. In a real-world engineering workflow, developers notice bugs while testing and need to immediately dispatch work, reprioritize queues, or pause execution without context-switching to complex UI dashboards.
- **Decision**: 
  - The Chat Agent is granted tool-calling authority over the platform orchestrator.
  - Allowed tools: create task, modify task, cancel task, query task status/logs, reorder backlog, adjust dependencies (`blockedBy`), and initiate brainstorming.
  - Every state-modifying action requires permission verification.
- **Consequences**: Developers can operate Graywolf entirely through natural language commands while testing or reviewing code.

---

## ADR-005: Technology Stack Standards

- **Date**: 2026-09-09 / 2026-09-10
- **Status**: Accepted
- **Context**: Graywolf requires ultra-low latency WebSocket streaming for terminal feeds and filesystem events, ACID durability for task state, vector search for codebase semantics, and zero copyleft licensing risks.
- **Decision**:
  - **Backend**: TypeScript / Node.js (v20+) with **Fastify** (performance, native WebSocket support, schema validation).
  - **Filesystem Locking**: `proper-lockfile` (atomic directory-level `mkdir` protocol).
  - **Primary Database**: **PostgreSQL 16+ with `pgvector`** (single ACID relational & vector engine).
  - **Cache / Job Queue**: **Valkey** (BSD-3-Clause) with **BullMQ**.
  - **Model Gateway**: **LiteLLM Proxy** (unified OpenAI-compatible API, RPM control, circuit breaking, spend tracking).
  - **Frontend**: **React on Vite** + **Tailwind CSS** + **Shadcn UI** + **React Flow** (DAG viewer) + **Xterm.js** (live logs).
- **Consequences**: Zero runtime lock-in, fully permissive licensing (MIT, Apache 2.0, BSD-3-Clause, PostgreSQL), unified relational and vector data layer.

---

## ADR-006: Git Worktree Relative Pointer Paths for Docker Mounts

- **Date**: 2026-09-09
- **Status**: Accepted
- **Context**: When mounting an isolated Git worktree into a Docker container, the `.git` pointer file default contains absolute host paths (e.g. `/home/user/...`). Inside the container, this absolute path does not exist, causing Git commands to fail fatally.
- **Decision**:
  - Provision worktrees with relative `.git` pointer paths (`gitdir: ../../.git/worktrees/...`).
  - Mount the host `.git` repository directory as a read-only volume into the container.
- **Consequences**: Clean Git isolation without path translation errors across host and container namespaces.

---

## ADR-007: Configurable Gate Policy (AI PM Agent as Alternative to Human Review)

- **Date**: 2026-09-10
- **Status**: Accepted
- **Context**: The Human Review Gate is valuable but creates a bottleneck for low-risk tasks and high-velocity workflows. Some tasks (simple bugfixes, style changes) don't warrant human attention. Others could be reviewed by an AI agent acting as a Product Manager, Security Officer, or other persona.
- **Decision**:
  - Implement a **4-tier gate policy system**: `auto` (skip review), `ai-pm` (AI reviewer persona), `human` (default), `mandatory-human` (cannot be overridden).
  - Gate policy is configurable per task tag in `project.config.json`.
  - The AI PM Agent receives the same review packet as a human (diff, tests, plan compliance, guard verdicts) and can escalate to human if uncertain.
  - Custom reviewer personas (Security Officer, UX Lead, etc.) are supported with per-persona system prompts.
  - All AI review decisions are logged to an immutable audit trail.
- **Alternatives Considered**: Binary human/AI switch (too coarse), always-human (too slow for simple tasks), no review gate (too risky).
- **Consequences**: Faster throughput for low-risk work, customizable approval workflows, preserved mandatory human oversight for high-risk changes.

---

## ADR-008: Continuous Learning Engine (Hermes Agent Pattern)

- **Date**: 2026-09-10
- **Status**: Accepted
- **Context**: Without continuous learning, the squad repeats the same mistakes and requires the same human corrections across tasks. The Hermes Agent (Nous Research, MIT) demonstrates a viable closed-loop learning architecture using persistent memory, agent-curated skill creation, and self-improvement.
- **Decision**:
  - Implement a three-tier learning system: **Project Memory** (conventions, corrections), **Skill Library** (reusable procedures in `.agents/skills/`), and **Anti-Pattern Registry** (known failure modes).
  - Learn from the delta between agent output and final merged code when humans correct diffs.
  - Auto-generate skill documents when task patterns complete successfully 2+ times.
  - Follow the `agentskills.io` open standard for skill file format.
  - Store learning data in PostgreSQL + `pgvector` for semantic retrieval.
- **Alternatives Considered**: Fine-tuning models per project (too expensive, too slow), static rule files only (too manual), no learning (unacceptable for long-term value).
- **Consequences**: Squad improves autonomously over time. Human corrections become one-time events rather than recurring interruptions. Skills are portable and shareable across projects.

---

## ADR-009: Chat UI Library Selection (`assistant-ui`)

- **Date**: 2026-09-10
- **Status**: Accepted
- **Context**: Graywolf requires a rich chat interface for the Conversational Control Plane with streaming LLM responses, tool-call rendering, code blocks, and markdown. Building from scratch would be expensive and error-prone.
- **Decision**:
  - Use **`assistant-ui`** (MIT, React/TypeScript) as the chat component library.
  - It provides modular hooks and components for streaming, tool rendering, file attachments, and markdown without vendor lock-in.
- **Alternatives Considered**: `CopilotKit` (good but more opinionated, heavier), `llm-ui` (too minimal for our needs), `LibreChat` (full platform — overkill, we only need UI components), custom build (too expensive).
- **Consequences**: High-quality chat UI with minimal development effort. MIT license ensures no commercial restrictions.

---

## ADR-010: Multi-Provider Git Abstraction (`repo-sdk`)

- **Date**: 2026-09-10
- **Status**: Accepted
- **Context**: Brownfield mode requires connecting to repositories on GitHub, GitLab, Bitbucket, and potentially Azure DevOps or Gitea. Maintaining separate API clients per provider is unsustainable.
- **Decision**:
  - Use **`repo-sdk`** (MIT, TypeScript, zero dependencies) as the primary Git provider abstraction layer.
  - Covers GitHub, GitLab, Bitbucket Cloud, Azure DevOps, and Gitea through a unified typed interface.
  - Maintain individual provider clients (`octokit`, `@gitbeaker/rest`) as escape hatches for edge cases not covered by the abstraction.
- **Alternatives Considered**: Individual clients only (too much code duplication), `unified.to` API service (introduces external dependency and latency), custom abstraction (reinventing the wheel).
- **Consequences**: Single API surface for all Git operations. Easier to add new providers. Fallback clients available for provider-specific features.

---

## ADR-011: Clarification Question Protocol (AWAITING_CLARIFICATION State)

- **Date**: 2026-09-10
- **Status**: Accepted
- **Context**: When a task brief is ambiguous, agents either guess wrong (wasting tokens and producing bad code) or halt entirely. A structured protocol for asking clarification questions before proceeding prevents both failure modes.
- **Decision**:
  - Add `AWAITING_CLARIFICATION` as a formal task state.
  - Dev-Level-1 Planner emits `clarification-request.md` when ambiguities are detected.
  - Configurable limits: max 5 questions per round, max 2 rounds (prevents infinite loops).
  - Developer responds via chat or disk edit. No tokens are burned while awaiting response.
- **Alternatives Considered**: Always guess and iterate (wastes tokens), always ask human (too slow for clear tasks), no limit on questions (could become annoying).
- **Consequences**: Higher first-pass accuracy. Developer is only interrupted when genuinely needed. Clear timeout behavior prevents zombie tasks.

---

## ADR-012: Hybrid Context Architecture (Topological Repo Map + Tree-Sitter AST + Surgical Tooling)

- **Date**: 2026-09-10
- **Status**: Accepted
- **Context**: Autonomous agents operating in medium-to-large codebases (50,000+ lines) cannot ingest entire codebases without exhausting token budgets and hallucinating non-existent modules. Simple vector search over arbitrary code chunks fails due to semantic inversion (matching definitions instead of callers) and loss of structural hierarchy.
- **Decision**:
  - Adopt a **4-Layer Context Pyramid**:
    1. **Layer 1 (Topological Repo Map)**: In-prompt compressed outline of file paths and exported signatures ranked via Tree-sitter + PageRank centrality (~1,500 tokens).
    2. **Layer 2 (AST Symbol Index)**: On-demand symbol definitions and call-graph reference resolution via `tree-sitter`.
    3. **Layer 3 (Hybrid Search)**: Lexical exact matching (`ripgrep`) + dense semantic search (`pgvector`) over module summaries and commit/PR history fused via Reciprocal Rank Fusion (RRF).
    4. **Layer 4 (Surgical Slicing)**: Agents read and edit targeted line ranges (50–150 lines) rather than full files.
  - Index the last 100 merged PRs/conventional commits and code churn hotspots into `pgvector` for architectural memory, while excluding raw historical git diffs. To prevent `pgvector` HNSW index builds from starving the shared Fastify OLTP database of memory (`shared_buffers`) during massive brownfield ingestion, the vector ingestion pipeline MUST be rate-limited via a background queue. In Enterprise topologies with repositories exceeding 500k symbols, Layer 3 search should be architecturally isolated to a dedicated read-replica or standalone `pgvector` instance.
  - Detailed architecture formalized in [`docs/architecture/context-and-memory.md`](file:///home/tarikelmallah/Projects/GraywolfSquad/docs/architecture/context-and-memory.md).
- **Alternatives Considered**:
  - *Pure Vector RAG over code chunks*: Rejected due to import hallucinations, lack of hierarchy, and caller inversion.
  - *Full codebase ingestion via 1M+ context window*: Rejected due to prohibitive financial cost ($1-$5 per turn), latency degradation, and context dilution ("lost in the middle").
- **Consequences**: Prevents module hallucination, keeps turn costs under ~15k working tokens, supports safe brownfield exploration, and adheres to 100% open-source tooling (`tree-sitter`, `ripgrep`, `pgvector`).

---

## ADR-013: Adaptive Sandbox Environments & Playwright Visual Testing

- **Date**: 2026-09-10
- **Status**: Accepted
- **Context**: Autonomous agents implementing full-stack features (DB migrations, API endpoints, UI modifications) need realistic testing environments. Hardcoding a single environment strategy causes either concurrent test state corruption (shared DB with migrations) or excessive resource/time overhead (spinning up heavy cloud DBs for frontend-only tasks). Additionally, agents verifying UI solely through unit tests miss rendering anomalies, console crashes, and visual regressions.
- **Decision**:
  - Implement a **3-Tier Adaptive Database Sandbox Matrix**:
    - **Tier 0 (Mock / None)**: For frontend/docs/algorithm tasks. Zero DB overhead.
    - **Tier 1 (Shared Dev DB with Schema Namespacing)**: For read/CRUD query tasks without DDL changes. Uses per-task Postgres schema namespace (`search_path`).
    - **Tier 2 (Isolated Ephemeral Postgres Clone)**: For schema migrations (`**/migrations/**`, `*.sql`, Prisma, Alembic). Uses a pre-warmed pool of Postgres copy-on-write template database clones (`CREATE DATABASE task_id TEMPLATE graywolf_template STRATEGY = WAL_LOG`). Using PostgreSQL 15+ `WAL_LOG` prevents serialization locks on the template database, ensuring concurrent task scaling creates a full-fidelity Postgres instance in $<300$ms with zero cloud cost. Dropped on task exit.
  - Decision hierarchy: Human task override > Pre-flight file pattern match > Dev-Level-1 Planner declaration (`plan.md`) > Global default.
  - Embed **Playwright Headless Browser Testing** into the Runner base Docker image. For UI/API tasks, Dev-Level-2/3 boot backend and frontend dev servers inside the sandbox, execute Playwright tests, and capture screenshots and WebM video recordings.
  - Bundle visual proof (screenshots, Playwright trace/HTML reports) into the `.agents/tasks/<TASK_ID>/review/` Review Packet for human or AI-PM gate inspection.
  - Detailed architecture formalized in [`docs/architecture/sandbox-and-testing.md`](file:///home/tarikelmallah/Projects/GraywolfSquad/docs/architecture/sandbox-and-testing.md).
- **Alternatives Considered**:
  - *Cloud DB branching (Neon/Supabase/AWS RDS)*: High latency (5-15s), cloud cost, egress constraints. Rejected for default runner.
  - *SQLite mock fallback*: Misses Postgres-specific types, triggers, and JSONB operations.
  - *Unit-test-only UI verification*: Misses visual defects and client-side runtime errors.
- **Consequences**: Instantaneous database isolation when needed, zero collateral state pollution between concurrent tasks, and undeniable visual proof attached to PR reviews.

---

## ADR-014: Standard Source Control PRs as Review Gate & Blocking Clarification Subtasks

- **Date**: 2026-09-10
- **Status**: Accepted
- **Context**: Code reviews for autonomous agents must inspire confidence without creating workflow friction or requiring developers to learn custom diff review software. Similarly, when an agent requires human clarification, it needs an unambiguous, non-blocking mechanism to pause and solicit answers.
- **Decision**:
  - Deliver completed task work through **native Pull / Merge Requests on GitHub, GitLab, and Bitbucket** (via `repo-sdk`).
  - Standardize an **Executive Review Packet** in the PR body structured for under-60-second review: executive summary, gate compliance matrix, unit/E2E test pass metrics, embedded Playwright screenshots/video recordings, and scoped file diffs.
  - Implement **Blocking Clarification Subtasks**: When an agent detects ambiguity (`AWAITING_CLARIFICATION`), the orchestrator spawns a child subtask (e.g. `TASK-104.1`) assigned to the human developer on the Kanban board and alerts the Chat Cockpit. Answering via Chat or Kanban resolves the subtask and resumes execution.
  - Establish a **PR Review Feedback Loop**: Webhook integration catches human PR review comments, awakens the task container in its worktree, applies revisions, and pushes updated commits to the PR branch.
  - Enforce **6 Non-Negotiable Human Gates**: Blast-radius escape, destructive DDL, security/secret exposure, protected branch merges, budget runaway, and two-strike review failure.
  - Detailed architecture formalized in [`docs/architecture/review-gates-and-guardrails.md`](file:///home/tarikelmallah/Projects/GraywolfSquad/docs/architecture/review-gates-and-guardrails.md).
- **Alternatives Considered**:
  - *Custom in-app web diff review editor*: High development cost, lacks CI/CD integration, creates context switching away from standard VCS.
- **Consequences**: Seamless integration into existing developer workflows, full auditability in enterprise Git repositories, and confident reviews in under 60 seconds.

---

## ADR-015: SaaS-Ready Multi-Tenancy from Day 1 & Dashboard-Driven Team Mode

- **Date**: 2026-09-10
- **Status**: Accepted
- **Context**: Autonomous software platforms typically either start as local-only single-user CLI tools (which hit a dead-end when enterprise engineering squads adopt them) or premature cloud-only multi-tenant SaaS platforms (which create massive hosting liabilities and trigger enterprise source-code privacy alarms). Furthermore, requiring server reboots or manual `.env` file editing to invite team members creates poor developer ergonomics.
- **Decision**:
  - Adopt a **"Local-First, SaaS-Ready from Day 1"** decoupled architecture separating the **Control Plane** (Web/API/Database) from the **Execution Plane** (Docker Task Sandboxes).
  - Implement **Tenant Isolation from Day 1**:
    - Every table and vector embedding is strictly scoped by `org_id` and `workspace_id`.
    - PostgreSQL Row-Level Security (RLS) is enabled across all tables, ensuring physical isolation even if queries omit explicit workspace checks.
  - Implement **Dashboard-Driven Team Upgrade**:
    - First boot runs in Zero-Config Solo Mode with an auto-authenticated admin and a default personal workspace.
    - Upgrading to Team Mode is handled via a single toggle in the Settings UI, generating shareable invite links instantly without container restarts or `.env` file modifications.
  - Implement **4-Tier Lean RBAC**: `owner`, `lead_dev`, `developer`, `viewer`.
  - Support **Enterprise Hybrid BYOC (Bring Your Own Compute)**: For cloud SaaS, allow the web control plane to run on Graywolf Cloud while the task execution runner runs inside the customer's private network via an outbound WebSocket connection—ensuring customer source code and database credentials never leave their private network.
  - Detailed architecture formalized in [`docs/architecture/multi-tenancy-and-deployments.md`](file:///home/tarikelmallah/Projects/GraywolfSquad/docs/architecture/multi-tenancy-and-deployments.md).
- **Alternatives Considered**:
  - *Single-user desktop architecture*: Rejected because it prevents teams from sharing project memory, learned skills, and Kanban backlogs.
  - *Database-per-tenant architecture*: Rejected as overly complex to maintain and migrate for initial self-hosted deployments compared to schema RLS.
  - *Env-var-only team toggle*: Rejected as user-unfriendly; requires SSH/server restart.
- **Consequences**: Zero friction for solo developers on day one, zero architectural refactoring needed when launching a cloud SaaS or selling to enterprise teams, and complete source code privacy protection via BYOC runners.

---

## ADR-016: Two-Tier Package Cache Architecture for Sub-2s Container Starts

- **Date**: 2026-09-13
- **Status**: Accepted
- **Context**: In autonomous agent workflows, running `npm install` or `pip install` across the network on every task creates a 30–120s penalty that destroys conversational responsiveness. Sharing raw `node_modules` or `.venv` across containers leads to native binary libc mismatches, stale symlinks, and race conditions, while rebuilding Docker images on every push causes build storms.
- **Decision**:
  - Adopt a **Two-Tier Cache Architecture**:
    - **Tier 1 (Always-On Content-Addressable Cache Volume)**: Mount a persistent Docker volume (`pkg-cache-{project_id}`) pointing to the package managers' internal immutable cache directories (`~/.npm`, `~/.cache/pip`, Cargo registry). Runs real installs from local disk in 2–8 seconds without native binary corruption.
    - **Tier 2 (Debounced Pre-Baked Snapshot Image Layer)**: For heavy projects, a background worker watches lockfiles and rebuilds a cached image layer via BuildKit cache mounts after 10 minutes of lockfile quiescence.
  - Mid-task package additions remain strictly isolated inside the task container while tarball downloads are absorbed by the Tier 1 cache. Merged lockfiles trigger background cache warming.
  - Detailed architecture formalized in [`docs/architecture/build-cache-and-performance.md`](file:///home/tarikelmallah/Projects/GraywolfSquad/docs/architecture/build-cache-and-performance.md).
- **Alternatives Considered**:
  - *Sharing raw `node_modules` across containers*: Rejected due to native addon libc crashes and symlink corruption.
  - *Rebuilding Docker image on every lockfile commit*: Rejected due to latency tax and CI build storms.
- **Consequences**: Task sandboxes boot in seconds with 100% build reliability and zero inter-task state pollution.

---

## ADR-017: Unified Event Stream Observability & Granular LLM Token Ledger

- **Date**: 2026-09-13
- **Status**: Accepted
- **Context**: Autonomous coding agents require complete transparency to earn developer trust. A pure terminal stream produces noise that hides high-level progress, while raw LLM JSON logs lack readability. In addition, organizations require deep visibility into AI token costs and prompt caching effectiveness.
- **Decision**:
  - Implement a **Unified Event Stream with Dual Rendering**:
    - **Primary Narrative Timeline**: Structured events (`tool_call`, `file_edit`, `test_run`, `cost_delta`) rendered as human-readable activity in the Cockpit UI.
    - **Expandable Ground-Truth Terminal**: Raw stdout/stderr streams attached to specific events, expandable into an Xterm.js pane on demand.
  - Create a dedicated **`llm_calls` fact table** in PostgreSQL tracking individual calls, token counts, latency, and prompt-cache hits (`cache_read_tokens`) broken down by persona, model, and task.
  - Provide an **optional, additive OpenTelemetry (OTLP) exporter** implementing `gen_ai.*` semantic conventions for enterprise Datadog/Grafana integration, while keeping PostgreSQL as the zero-dependency source of truth.
  - Detailed architecture formalized in [`docs/architecture/observability-and-telemetry.md`](file:///home/tarikelmallah/Projects/GraywolfSquad/docs/architecture/observability-and-telemetry.md).
- **Alternatives Considered**:
  - *Maintaining two separate logging systems (one for UI events, one for terminal)*: Rejected due to divergence and maintenance burden.
  - *Requiring an external OTel collector for local runs*: Rejected to preserve the $0 zero-dependency local experience.
- **Consequences**: High-level clarity at a glance, instant access to raw terminal output when needed, exact cost accounting, and seamless enterprise observability.

---

## ADR-018: Column-Level Envelope Encryption & Out-of-Band Secrets Proxy

- **Date**: 2026-09-13
- **Status**: Accepted
- **Context**: Autonomous agents troubleshooting code or running tests may inadvertently leak secrets into prompts, terminal logs, or patches (e.g., via `console.log(process.env)`). Additionally, requiring a master passphrase on startup breaks the "<1s boot, zero-config" promise of solo mode, while unencrypted databases expose credentials in `pg_dump` backups.
- **Decision**:
  - Implement **Zero-Prompt Column-Level Envelope Encryption**:
    - Secrets encrypted via `pgcrypto` (AES-256) using Data Encryption Keys (DEKs).
    - Key Encryption Key (KEK) is stored outside PostgreSQL: in `~/.graywolf/master.key` (`chmod 600`) for solo mode, or HashiCorp Vault / Cloud KMS for enterprise teams. For Topology A, onboarding MUST include an explicit backup/recovery warning, as loss of the local KEK results in permanent, unrecoverable loss of all PATs and credentials.
  - Enforce **Out-of-Band Sandbox Secrets Proxying**:
    - Secrets are never injected as plain environment variables in the task container.
    - Git PATs are handled via `credential.helper` backed by an orchestrator Unix socket.
    - Third-party test credentials route through a Secrets Broker sidecar that rewrites dummy placeholders and scrubs error responses.
    - LiteLLM provider keys remain strictly server-side.
  - Apply real-time **regex-based secret scrubbing** on all container stdout/stderr streams before persistence or UI rendering.
  - Detailed architecture formalized in [`docs/architecture/security-and-secrets.md`](file:///home/tarikelmallah/Projects/GraywolfSquad/docs/architecture/security-and-secrets.md).
- **Alternatives Considered**:
  - *Interactive master password on container startup*: Rejected as it violates the frictionless solo boot requirement.
  - *Direct environment variable injection*: Rejected due to high risk of accidental agent logging and prompt leakage.
- **Consequences**: Secrets are structurally hidden from agent inspection, database backups remain cryptographically protected, and solo developers experience zero setup friction.

---

## ADR-019: Adoption of Elastic License 2.0 (ELv2) & Clean Open-Core Repository Split

- **Date**: 2026-09-13
- **Status**: Accepted
- **Context**: The project vision mandates that Graywolf Squad is 100% free to run for personal and commercial use (internal team engineering), but prevents third parties from taking the codebase and operating a competing commercial SaaS offering. Standard OSI open-source licenses (MIT/Apache) permit competitors to stand up commercial hosted services. Furthermore, mixing proprietary SaaS billing and Stripe code with the open-source core creates governance and legal confusion.
- **Decision**:
  - Adopt the **Elastic License 2.0 (ELv2)** file-verbatim for the primary public repository:
    - Personal use: unrestricted and free ($0).
    - Internal commercial use: unrestricted and free ($0).
    - Only restriction: third parties may NOT offer Graywolf as a hosted or managed cloud service.
  - Establish a **Clean Open-Core Repository Split**:
    - `GraywolfSquad/graywolf` (Public, ELv2): Complete autonomous software house, UI, agents, sandboxes, and BYOC runner.
    - `GraywolfSquad/graywolf-cloud` (Private, Proprietary): Hosted SaaS control plane, Stripe billing, organization usage meters, team invite management, and managed runner coordination.
  - Implement a **Developer Certificate of Origin (DCO) + License Grant** bot for external contributions rather than a heavy corporate CLA.
- **Alternatives Considered**:
  - *MIT / Apache-2.0*: Leaves the project vulnerable to cloud providers/competitors commercializing the core without contributing back.
  - *Business Source License 1.1 (BSL)*: Introduces administrative overhead tracking conversion dates per release with no near-term gain over ELv2.
  - *Server Side Public License (SSPL)*: Too aggressive; causes enterprise legal teams to block adoption.
- **Consequences**: Complete clarity of licensing, ironclad protection against SaaS freeloading, frictionless commercial adoption inside enterprise engineering teams, and zero accidental leaks of SaaS billing code into the Community core.

---

## ADR-020: The Constitution as a Machine-Enforced & Deterministic Linter Artifact

- **Date**: 2026-09-13
- **Status**: Accepted
- **Context**: Autonomous agents require architectural guardrails to prevent library sprawl (e.g. importing deprecated libraries like `moment` or `lodash`) and pattern drift. Relying purely on LLM prompts to obey vague markdown rules is unreliable and wastes expensive token passes on trivial syntax corrections.
- **Decision**:
  - Define the **Constitution** as a structured Markdown file with YAML frontmatter. The **master template** resides at `.specify/memory/constitution.md`, and a **per-project runtime copy** is created at `.agents/constitution.md` during onboarding.
  - Implement a **Dual-Tier Enforcement Engine**:
    1. **Cognitive Tier**: Injected into Dev-Level-1 (Planner) prompt to steer architectural choices and module boundaries.
    2. **Deterministic Machine Tier**: Dev-Level-2 (Reviewer) compiles frontmatter constraints (`forbiddenImports`, `forbiddenRegex`, `governance.prohibitedLicenses`) into instant `ast-grep` and `ripgrep` pre-commit checks executed *before* calling any reviewer LLM.
  - Catch violations in 8 milliseconds for $0.00, returning instant revision feedback to Dev-Level-3 without burning LLM review tokens.
  - Detailed architecture formalized in [`docs/architecture/project-constitution.md`](file:///home/tarikelmallah/Projects/GraywolfSquad/docs/architecture/project-constitution.md).
- **Alternatives Considered**:
  - *Pure natural language prompt rules*: Slow, expensive, and subject to model hallucination/oversight.
- **Consequences**: Deterministic, millisecond-fast boundary enforcement and zero token waste on trivial architectural infractions.

---

## ADR-021: Cognitive Virtual Developer Tier Handoff Protocol & Token Economics

- **Date**: 2026-09-13
- **Status**: Accepted
- **Context**: Running multi-agent software engineering within a single ephemeral sandbox requires disciplined persona handoffs. Naive retry loops replay entire conversation histories, causing token costs to balloon exponentially upon reviewer rejections.
- **Decision**:
  - Formalize the cognitive pipeline between **Dev-Level-1 (Planner)** ➔ **Dev-Level-3 (Implementer)** ➔ **Dev-Level-2 (Reviewer)** inside a single container.
  - Personas communicate via a typed, compact contract (`handoff.json`).
  - **Token Replay Ban**: On a Dev-Level-2 rejection, Dev-Level-3 receives **only** `plan.md`, the current patch diff, and targeted `reviewerNotes` with failed test excerpts. Working context remains bounded at 12,000–18,000 tokens.
  - Enforce the **Two-Strike Rule**: two consecutive rejections by Dev-Level-2 immediately halts the task as `INTERNAL_REVIEW_FAILED` for human review.
  - Detailed architecture formalized in [`docs/architecture/virtual-developer-tiers.md`](file:///home/tarikelmallah/Projects/GraywolfSquad/docs/architecture/virtual-developer-tiers.md).
- **Alternatives Considered**:
  - *Multi-container agents*: Excessive RAM overhead, network latency, and volume-locking deadlocks.
  - *Full conversational replay on retry*: Exponential token cost growth and model confusion from superseded code snippets.
- **Consequences**: Predictable, lean token spend across turns, rigorous peer-review quality inside the sandbox, and zero infinite loops.

---

## ADR-022: Continuous Learning Engine Scaling, Vector Half-Life Decay & Provenance

- **Date**: 2026-09-13
- **Status**: Accepted
- **Context**: Learning from past tasks is essential for long-term capability, but unbounded vector storage leads to retrieval poisoning: outdated or conflicting lessons pollute agent context windows. Furthermore, unverified agent inferences must not have the same standing as explicit human corrections.
- **Decision**:
  - Implement a **4-Part Vector Scaling & Decay Policy**:
    1. **Provenance Classification**: Lessons tagged `human_correction` (confidence 1.0), `postmortem` (0.95), `qa_guard_failure` (0.80), or `auto_inferred` (0.50).
    2. **Recency-Weighted Scoring**: Exponential half-life decay ($\lambda = 0.01$, 90-day half-life) prioritizes recently validated lessons over stale ones.
    3. **Semantic Consolidation**: Weekly clustering background worker merges near-duplicate lessons ($>0.88$ similarity) into unified rules.
    4. **Incident Quarantining**: Tasks that cause production rollbacks automatically trace and quarantine all lessons born from that task.
  - Auto-generate reusable skills conforming to `agentskills.io` committed to `.agents/skills/` under Git version control when patterns succeed twice.
  - Detailed architecture formalized in [`docs/architecture/continuous-learning-engine.md`](file:///home/tarikelmallah/Projects/GraywolfSquad/docs/architecture/continuous-learning-engine.md).
- **Alternatives Considered**:
  - *Unbounded raw RAG memory*: Inevitably leads to context pollution and contradictory instructions.
- **Consequences**: Memory remains pristine and high-signal indefinitely, automatically pruning obsolete conventions.

---

## ADR-023: Tool & Local Model Pinning for Guaranteed $0 Platform Cost

- **Date**: 2026-09-13
- **Status**: Accepted
- **Context**: To uphold the non-negotiable $0 platform cost and fully offline local operation, every supporting subsystem must be pinned to explicit, permissively licensed open-source tools, avoiding any accidental dependencies on paid commercial APIs for embeddings or security scans.
- **Decision**:
  - Pin the following standard tools across the platform:
    - **Secret Scanner**: **`gitleaks`** (MIT, Go pre-compiled binary in runner image).
    - **CVE & License Scanner**: **`osv-scanner`** (Apache 2.0, Open Source Vulnerabilities database).
    - **Vector Embedding Engine**: **`nomic-embed-text` via Ollama** (Apache 2.0, 8192 context window, 100% offline local embedding generation) with `bge-small-en-v1.5` as an ONNX fallback.
    - **AST Static Analysis**: **`ast-grep`** (MIT) + **`tree-sitter`** (MIT).
- **Alternatives Considered**:
  - *Paid commercial scanners (Snyk, Veracode)*: Violates $0 license requirement.
  - *Commercial cloud embeddings (OpenAI text-embedding-3)*: Silently breaks 100% offline runs and imposes hidden per-query costs.
- **Consequences**: Guaranteed $0 software license, 100% air-gapped / offline run capability, and lightning-fast local static analysis.

---

## ADR-024: Dynamic Resource Admission Control & Constrained Hardware Profiles

- **Date**: 2026-09-13
- **Status**: Accepted
- **Context**: Graywolf targets both Raspberry Pi 5 (8GB) self-hosted setups and high-end enterprise servers. Running 3 concurrent task containers with PostgreSQL template clones and headless Playwright Chromium instances will crash an 8GB host with out-of-memory (OOM) errors.
- **Decision**:
  - Implement a **Hardware Profiler & Dynamic Token-Bucket Admission Scheduler**:
    - **Constrained Profile ($\le$ 8GB RAM)**: Sets `maxConcurrentContainers: 1`, disables parallel Chromium instances (runs single-process or mock tests unless tagged `mandatory-e2e`), and caps Docker memory at 2GB per container.
    - **Standard Profile (16GB–32GB RAM)**: Sets `maxConcurrentContainers: 3` with full parallel Playwright suites.
    - **Enterprise Profile ($\ge$ 64GB RAM)**: Sets `maxConcurrentContainers: 8+`.
  - Tasks declare resource tokens based on DB tier and visual browser requirements; the scheduler holds tasks in `QUEUED / READY` when host capacity is saturated.
  - Hard container cgroup memory limits prevent runaway processes from crashing the host operating system.
  - Detailed architecture formalized in [`docs/architecture/resource-admission-and-limits.md`](file:///home/tarikelmallah/Projects/GraywolfSquad/docs/architecture/resource-admission-and-limits.md).
- **Alternatives Considered**:
  - *Static concurrency configuration*: Crashes low-end hosts or drastically underutilizes large servers.
- **Consequences**: Reliable operation on hardware as small as a Raspberry Pi 5 without kernel panics, scaling automatically up to large multi-core cloud nodes.

---

## ADR-025: Untrusted-Content Sanitization & Prompt-Injection Hardening

- **Date**: 2026-09-13
- **Status**: Accepted
- **Context**: The PR Review Feedback Loop and Brownfield Reconnaissance ingest externally authored text (PR review comments, existing repository READMEs, docstrings, commit messages). Malicious actors could submit comments containing prompt injection payloads designed to steer agents into exfiltrating secrets or altering unauthorized files.
- **Decision**:
  - Enforce **Structural Containment for External Content**:
    - All webhook-delivered PR comments and unverified repository docstrings are wrapped in strict XML boundary tags (`<untrusted_pr_comment>` / `<untrusted_repo_context>`).
    - System prompts explicitly declare that text within `<untrusted_*>` blocks represents passive data for inspection, never instructions for tool invocation or system behavior modification.
  - **Structural Blast-Radius Invariance**: Security does not depend on LLM obedience. Even if prompt injection succeeds in confusing the model, OS-level container isolation structurally blocks the attack:
    - Immutable read-only mounts physically prevent writes to forbidden files.
    - `relay.mjs` structurally prohibits `git commit` or direct pushes.
    - Sandbox network egress is blocked except to the LiteLLM proxy and the out-of-band secrets broker.
- **Alternatives Considered**:
  - *Relying solely on LLM prompt instructions*: Highly vulnerable to jailbreaks.
- **Consequences**: Defense-in-depth protection against prompt injection attacks via public PR comments or malicious brownfield source files.

---

## ADR-026: Task Lifecycle Edge Cases, Stale Task Pruning & Orchestrator Crash Recovery

- **Date**: 2026-09-13
- **Status**: Accepted
- **Context**: Real-world operations encounter edge cases: tasks stuck waiting for human answers, orchestrator server restarts mid-task, and external CI pipeline coordination. Without explicit policies, disks fill with orphan worktrees and tasks become irrecoverable.
- **Decision**:
  - Implement three lifecycle recovery policies:
    1. **Stale Clarification Pruning**: If a task remains in `AWAITING_CLARIFICATION` for $>72$ hours, the orchestrator prunes the local Git worktree to reclaim disk space while preserving the brief and questions in PostgreSQL. Answering re-provisions the worktree in $<1$s.
    2. **Orchestrator Crash Reconciliation**: On boot, the orchestrator reconciles PostgreSQL `tasks` against running Docker containers:
       - Container running: Reconnects WebSocket streams and resumes supervision.
       - Container dead: Emits `CRASHED_RECOVERABLE` with a one-click `[ Resume Task ]` button from the last valid `plan.md`.
    3. **External CI Interplay**: Opening a PR immediately attaches the Executive Review Packet. Webhooks track external CI pipelines (GitHub Actions / GitLab CI). If CI fails, the PR status badge updates to 🔴 CI FAILING, and a one-click child subtask `[ Fix CI Failure ]` is offered.
- **Alternatives Considered**:
  - *Hard restart from scratch on orchestrator reboot*: Wastes all tokens spent on completed planning and intermediate code synthesis.
- **Consequences**: Resilient, self-healing lifecycle management with zero orphan resource leaks.

---

## ADR-027: BYOC Model Data Residency & Zero Data Retention (ZDR) Enforcement

- **Date**: 2026-09-13
- **Status**: Accepted
- **Context**: The claim that *"source code never leaves the customer network"* in BYOC topologies is false if code snippets are sent to public cloud LLM APIs (OpenAI/Anthropic). Enterprise security reviewers and compliance officers (SOC 2, ISO 27001) will reject any architecture that obscures this boundary.
- **Decision**:
  - Clarify the BYOC security promise: **The Graywolf Control Plane never ingests or stores customer source code**, but LLM model inference requires explicit data residency classification.
  - Define **Three Data Residency Profiles**:
    1. **Tier 1 (Sovereign / Air-Gapped)**: 100% on-premise inference via Ollama / vLLM (0 bytes egress outside customer network).
    2. **Tier 2 (Private VPC Peered)**: Routed via AWS PrivateLink or Azure ExpressRoute to dedicated customer cloud endpoints (AWS Bedrock / Azure OpenAI) with contractually verified Zero Data Retention (ZDR).
    3. **Tier 3 (Public Commercial API)**: Standard public API endpoints requiring explicit informed opt-in and visible UI warning badges.
  - Embed a **Model Data Residency Badge** directly in the 60-Second Executive Review Packet on all Pull Requests.
  - Detailed architecture formalized in [`docs/architecture/data-residency-and-byoc.md`](file:///home/tarikelmallah/Projects/GraywolfSquad/docs/architecture/data-residency-and-byoc.md).
- **Consequences**: Total transparency during enterprise security reviews, audit-ready data residency compliance, and zero risk of misrepresenting data egress boundaries.

---

## ADR-028: Runner Sandbox OS Hardening, Rootless Execution & Network Egress Allowlisting

- **Date**: 2026-09-13
- **Status**: Accepted
- **Context**: Agents executing shell commands, compiling code, and installing third-party packages inside containers could theoretically escape to the host kernel or exfiltrate data to arbitrary internet command-and-control servers.
- **Decision**:
  - Implement **Three Pillars of Container Hardening**:
    1. **Privilege De-escalation**: Dedicated non-root user (`UID 10001`), read-only root filesystem (`--read-only`), all capabilities dropped (`--cap-drop=ALL`), and `no-new-privileges:true`.
    2. **Syscall Filtering**: Custom seccomp profile blocking dangerous kernel calls (`ptrace`, `bpf`, `sys_chroot`, namespace alterations).
    3. **Default-Deny Network Egress Firewall**: Sandboxes can only communicate with the internal LiteLLM proxy, the local secrets socket, declared Git remotes, and official package registries (npm/PyPI). All other outbound traffic (`0.0.0.0/0`) is dropped by kernel packet filters.
  - Detailed architecture formalized in [`docs/architecture/sandbox-hardening-and-network-egress.md`](file:///home/tarikelmallah/Projects/GraywolfSquad/docs/architecture/sandbox-hardening-and-network-egress.md).
- **Consequences**: Complete containment of malicious dependencies or compromised agent processes, preventing host breakout and data exfiltration.

---

## ADR-029: Control-Plane Disaster Recovery, WAL Archiving & Automated Backup

- **Date**: 2026-09-13
- **Status**: Accepted
- **Context**: While task code is tracked in Git, irreplaceable state (Project Memory, learned skills, audit trails, organizational settings) lives in the control-plane PostgreSQL database. Small self-hosted deployments (Raspberry Pi/laptops) have zero hardware redundancy.
- **Decision**:
  - Implement automated daily `pg_dump` snapshots and WAL archiving persisted to a configurable local volume (`~/.graywolf/backups/`) or S3-compatible bucket.
  - Ship a one-command CLI restore mechanism: `graywolf restore --backup <timestamp>`.
- **Consequences**: Bulletproof disaster recovery ensuring project intelligence is never lost during host failures.

---

## ADR-030: Zero-Downtime Control-Plane Migrations & Safe Task Draining

- **Date**: 2026-09-13
- **Status**: Accepted
- **Context**: Upgrading self-hosted Graywolf instances must not corrupt in-flight agent tasks or require manual database schema intervention.
- **Decision**:
  - Manage all control-plane database schema evolutions via versioned, additive migrations (`node-pg-migrate`, MIT).
  - Implement a **Graceful Upgrade Drain Mode**: On shutdown/upgrade, the orchestrator allows active sandbox tasks up to 60 seconds to reach a clean handoff checkpoint before restarting, resuming cleanly via ADR-026 crash reconciliation.
- **Consequences**: Friction-free updates for self-hosted instances with zero corrupted task states.

---

## ADR-031: Dynamic Writable-Scope Overlap Detection & PR Merge Conflict Auto-Rebase

- **Date**: 2026-09-13
- **Status**: Accepted
- **Context**: Concurrently running tasks with overlapping file scopes or closely timed PR merges can cause Git merge conflicts or destructive overwrite races on upstream branches.
- **Decision**:
  - Implement a **Pre-Dispatch Scope Overlap Checker**: The orchestrator compares declared writable scopes (and in-flight touched files) before dispatching concurrent containers; tasks with overlapping writable paths are serialized.
  - **Auto-Rebase PR Feedback Loop**: If an upstream merge causes a PR branch to fall behind or conflict, the orchestrator automatically awakens a container to execute `git rebase origin/main`, re-runs Playwright and unit tests, and force-pushes with lease to the PR branch.
- **Consequences**: Zero git merge conflicts on protected branches and seamless concurrent execution safety.

---

## ADR-032: Full Turn Context Snapshotting & Deterministic Replay Harness

- **Date**: 2026-09-13
- **Status**: Accepted
- **Context**: Debugging why an LLM planner made an incorrect decision or hallucinated a file is difficult after the fact due to model non-determinism.
- **Decision**:
  - Snapshot the exact 4-layer context bundle (repo-map, AST slice, memory injection) into `.agents/tasks/<id>/turns/turn_<N>.json`.
  - Provide a `graywolf debug replay --task <id> --turn <N>` command to re-run the prompt against the exact same context bundle.
- **Consequences**: Instant post-mortem diagnostics and deterministic agent evaluation.

---

## ADR-033: Dual-Confidence Scoring in Planning and In-Container Review

- **Date**: 2026-09-13
- **Status**: Accepted
- **Context**: Binary pass/fail review gates do not convey nuanced certainty to human reviewers scanning dozens of PRs.
- **Decision**:
  - Dev-Level-1 (Planner) and Dev-Level-2 (Reviewer) emit structured **Confidence Scores (0.00–1.00)** overall and per-file, with explicit uncertainty justifications in `plan.md` and `review-signoff.md`.
  - **Per-File Scoring**: Highlights specific files where human scrutiny is required, particularly in polyglot codebases where the developer may not be an expert in the target language.
  - **Assistive Heuristic Coupling**: Heuristics that cannot provide 100% static proof (such as `queryScopingInvariant` across dynamic query builders) never claim a verified clean pass; instead, files with ambiguous patterns suffer automatic confidence penalties (e.g. -0.35) and trigger explicit reviewer flags.
  - Displayed prominently in the Executive Review Packet (e.g. `🟢 Reviewer Confidence: 96%` vs. `⚠️ Reviewer Confidence: 68% - Low Test Coverage on Edge Cases`), guiding human reviewers to focus attention where it matters most.
- **Consequences**: Humans can approve high-confidence tasks in under 15 seconds while thoroughly reviewing lower-confidence edge cases. Eliminates the danger of false confidence from simplistic regex/AST checks.

---

## ADR-034: Project Memory & Skill Library Portability (JSONL / Tarball Export)

- **Date**: 2026-09-13
- **Status**: Accepted
- **Context**: Users must not suffer vendor lock-in when transitioning between local self-hosted instances, enterprise on-prem clusters, and Graywolf Cloud SaaS.
- **Decision**:
  - Implement standard export/import endpoints: `GET /api/v1/workspace/export` emitting a gzip tarball of Project Memory (`lessons.jsonl`), Skill Library (`.agents/skills/`), and the Project Constitution.
  - Allows full migration of accumulated organizational intelligence across instances with one click.
- **Consequences**: Zero vendor lock-in and seamless migration paths.

---

## ADR-035: WCAG 2.1 AA Accessibility Standards for the Graywolf Web UI

- **Date**: 2026-09-13
- **Status**: Accepted
- **Context**: While Graywolf tests external applications for accessibility via `@axe-core/playwright`, the platform's own web UI must maintain identical accessibility standards.
- **Decision**:
  - Build all UI components using **Radix UI (Shadcn UI)** with 100% keyboard navigability, ARIA landmarks, screen-reader announcements for streaming agent events, and automated `@axe-core` CI checks on every PR to the Graywolf repository.
- **Consequences**: Fully accessible control plane compliant with enterprise accessibility mandates.

---

## ADR-036: Agent Relay Protocol (ARP) — WebSocket Wire Contract

- **Date**: 2026-09-14
- **Status**: Accepted
- **Context**: Every architecture document references the bidirectional link between the Control Plane (Fastify orchestrator) and the Execution Plane (ephemeral Docker sandbox containers), but no formal message format, lifecycle phases, reconnection policy, or backpressure strategy was specified. This made the relay layer an implicit assumption rather than a verified contract.
- **Decision**:
  - Define the **Agent Relay Protocol (ARP)** as a JSON-over-WebSocket protocol with a typed `RelayEnvelope` message format, discriminated by `direction` (`c2e` / `e2c`) and `type`.
  - Implement **dual delivery guarantees**: fire-and-forget for streaming data (`terminal.chunk`, `event.stream`) and at-least-once with acknowledgment for critical messages (`task.dispatch`, `result.final`, `cost.delta`, `escalation.emit`).
  - Enforce **heartbeat liveness** (15-second ping interval, 3-miss stale detection) and **sequence-number gap detection** for reliable ordered delivery.
  - Support **session resumption** for BYOC/Topology C reconnections with replay of unacknowledged messages.
  - Apply **TCP-level backpressure** with a 1000-message / 10MB ring buffer. To ensure High Availability (HA) across orchestrator restarts in Topologies B and C, this buffer is strictly backed by **Valkey**, not Node.js process memory. This guarantees session resumption and message replay even if the physical WebSocket disconnects and re-establishes against a different load-balanced orchestrator instance. Prioritizes critical messages over streaming data when saturated.
  - Define custom **WebSocket close codes** (4001–4010) for authentication, budget, cancellation, and staleness scenarios.
- **Deep-Dive**: [`docs/architecture/relay-protocol-and-websocket-contract.md`](file:///home/tarikelmallah/Projects/GraywolfSquad/docs/architecture/relay-protocol-and-websocket-contract.md)
- **Consequences**: All Control Plane ↔ Execution Plane communication now has a formally specified, versionable contract. Enables independent testing of orchestrator and relay components against the shared schema.

---

## ADR-037: `relay.mjs` Non-Committing In-Container Harness Contract

- **Date**: 2026-09-14
- **Status**: Accepted
- **Context**: `relay.mjs` is the single most security-critical runtime component — it bridges the untrusted agent execution environment (where arbitrary LLM-generated code runs) with the trusted orchestrator infrastructure. Despite being referenced in every sandbox and review-gate document, it had no formal specification for its three core invariants (non-committing, blast-radius enforcement, spend ceiling) or its lifecycle phases, exit codes, or output artifact contract.
- **Decision**:
  - Formally specify the three **absolute invariants**: (1) Non-Committing — git push/commit/merge/rebase are hard-blocked via a shell wrapper (`git-guard.sh`), (2) Blast-Radius Enforcement — all file mutations pass through a synchronous glob-based interceptor with fail-closed default-deny, (3) Spend Ceiling — strict per-call bounding where the orchestrator calculates a `max_tokens` cap dynamically from the remaining budget before dispatching, ensuring worst-case overruns are strictly bounded rather than relying solely on post-stream accounting.
  - Define the **three lifecycle phases**: Boot (< 2s target, WebSocket connect, context unpack), Cognitive Handoff (Dev-Level-1 → 3 → 2 with retry loop), and Artifact Collection & Teardown (patch generation, result.json, clean exit).
  - Define the **Agent-Computer Interface (ACI) Tool Schema**, dividing features to guard against scope creep:
    - **v1 Requirements**: `bash_execute` MUST use a PTY wrapper, idle timeouts (not hard kill), and non-interactive env injection. `edit_file` MUST use an exact-match block replacement strategy (failing loudly on multiple matches or whitespace issues).
    - **v2 Enhancements**: `multi_edit` for batched atomicity, synchronous linter-driven fast feedback (re-using configured linters instead of heavy LSP daemons), and orchestrator-enforced context compaction / scratchpad routines to prevent long-horizon drift.
  - Specify the complete `RelayResult` TypeScript interface as the canonical output contract for `result.json`.
  - Define **exit codes** (0 = success, 1 = relay error, 2 = blast-radius violation, 137 = OOM, 143 = SIGTERM cancellation).
  - Document **always-forbidden system files** (`.git/**`, `relay.mjs`, `.agents/constitution.md`, `.agents/project.config.json`) that cannot be overridden by project configuration.
- **Deep-Dive**: [`docs/architecture/relay-mjs-contract.md`](file:///home/tarikelmallah/Projects/GraywolfSquad/docs/architecture/relay-mjs-contract.md)
- **Consequences**: The in-container security boundary is now a formally specified contract with clear enforcement mechanisms, and the Agent-Computer Interface is structured to prevent LLM execution hangs and context exhaustion.

---

## ADR-038: Reference Framework Extraction Strategy & Repo Convention Ingestion

- **Date**: 2026-09-14
- **Status**: Accepted
- **Context**: Autonomous coding frameworks like DeepSeek Harness, OpenHands, and SWE-bench harnesses provide battle-tested tool signatures, trajectory schemas, and agent ergonomics. However, adopting their full runtimes introduces volatile plugin meta-frameworks, heavy dependency trees, and risk of breaking architectural sovereignty. Simultaneously, modern software repositories increasingly define custom agent guidance in ecosystem convention files (`AGENTS.md`, `CLAUDE.md`, `.cursorrules`), which Graywolf must honor without manual duplication.
- **Decision**:
  - **Read-Only Interface Extraction**: Treat external harnesses (DeepSeek Harness, OpenHands) strictly as read-only reference specifications. Extract tool definitions (`view_file`, `edit_file`, `bash_execute`), parameter shapes, and trajectory schemas directly into Graywolf's native TypeScript / `relay.mjs` runtime without importing external framework dependencies ($0 cost, zero supply-chain bloat).
  - **Repo-Native Convention Ingestion**: During project onboarding and pre-flight reconnaissance, the orchestrator inspects the target repository root for ecosystem convention files following a strict precedence cascade:
    1. System Baseline Constitution (`.specify/memory/constitution.md`) — non-negotiable platform safety and $0 tooling rules.
    2. Project Runtime Constitution (`.agents/constitution.md`) — project-specific architectural rules and machine-checked linters.
    3. Ecosystem Convention Files (`AGENTS.md` ➔ `CLAUDE.md` ➔ `.cursorrules` ➔ `.windsurfrules`) — parsed and injected into the task context buffer under `## Repository Local Guidelines`.
    *Note on Untrusted PR Comments (ADR-025)*: External webhook-sourced PR review comments and issue bodies are likewise classified strictly as Level 3 (Untrusted Ecosystem Inputs) — they are passed through the ADR-025 prompt-injection sanitizer. To prevent Denial of Wallet (DoW) attacks via rapid-fire PR comments, the orchestrator enforces a strict webhook debounce (e.g., 3 minutes) and an absolute ceiling on autonomous revisions per task.
  - **Structured Trajectory Logging**: Standardize in-container telemetry (`e2c:output`, `execution.log`, and `result.json`) to emit typed trajectory events (`thought`, `action`, `observation`, `reflection`) compatible with the dual-state UI (collapsible step-by-step reasoning in Kanban DAG and raw streaming in Xterm.js).
  - **Blast-Radius Invariant Preservation**: All extracted tool execution paradigms inside `relay.mjs` remain strictly subordinate to the `BlastRadiusGuard` (synchronous path validation) and the non-committing git barrier (`git-guard.sh`).
- **Deep-Dive**: [`docs/architecture/project-constitution.md`](file:///home/tarikelmallah/Projects/GraywolfSquad/docs/architecture/project-constitution.md) and [`docs/architecture/relay-mjs-contract.md`](file:///home/tarikelmallah/Projects/GraywolfSquad/docs/architecture/relay-mjs-contract.md)
- **Consequences**: Graywolf gains state-of-the-art agent ergonomics and seamless out-of-the-box compatibility with existing developer repositories while preserving bulletproof container isolation, deterministic guardrails, and independent codebase ownership.

---

## ADR-039: Identity, Stateful Session Cache, Invite Protocol & Cockpit RBAC

- **Date**: 2026-09-14
- **Status**: Accepted
- **Context**: Transitioning from zero-config solo mode to team collaboration requires identity management, instant session revocation, secure team invites, and fine-grained authorization. Furthermore, the natural-language Chat Cockpit possesses tool-calling capabilities that directly mutate platform state (creating tasks, adjusting priorities, merging code). Without server-side RBAC enforcement, models could be tricked via prompt injection into executing unauthorized operations. Finally, running sandbox containers must be structurally prevented from calling back into Control Plane management APIs.
- **Decision**:
  - **Stateful Sessions via Better-Auth + Valkey**: Implement authentication via Better-Auth (MIT) with stateful sessions backed by PostgreSQL and cached in Valkey (BSD-3-Clause). Fastify validates session tokens per request in $<1$ms from cache. Revocation (e.g., user demotion or ejection) immediately purges the Valkey cache key, terminating tool-calling and API access instantly without waiting for a JWT to expire.
  - **Database Row-Level Security (RLS) Context**: Fastify authentication hooks extract `{ user_id, current_workspace_id, role }` and inject them into transactional PostgreSQL session settings (`SET LOCAL app.current_workspace_id`), guaranteeing multi-tenant isolation at the database layer.
  - **Cryptographic Team Invite Protocol**: Dashboard-driven workspace invites generate a high-entropy 32-byte token. The hash (`SHA-256`) is persisted in `workspace_invites` with a target role (`developer` or `viewer`), expiration timestamp, and optional usage limits. Invite links (`/invite/join?token=<RAW_TOKEN>`) are validated against the hash and consumed atomically.
  - **Server-Authoritative Chat Cockpit RBAC Interceptor**: AI models in the Chat Cockpit have zero intrinsic authorization. When the model emits a `tool_call`, the Fastify gateway intercepts the action and evaluates the user's Casbin role before executing:
    - `viewer`: Read-only queries (`query_task_status`, `read_logs`).
    - `developer`: Task creation, backlog reordering, answering clarification subtasks.
    - `lead_dev` / `owner`: PR approvals, blast-radius scope changes, task cancellations.
    Unauthorized calls are blocked with a `403 Forbidden` synthetic tool result, prompting the model to explain the permission denial.
  - **WebSocket Ticket-Granting Token (TGT)**: Live telemetry and Xterm.js terminal streams authenticate via short-lived (10-second), single-use TGTs acquired through an authenticated REST endpoint.
  - **Absolute Sandbox Isolation Invariant & IDOR Guard**:
    - Ephemeral runner containers have **zero network reachability or HTTP tokens** to the Graywolf Control Plane REST API.
    - Containers communicate exclusively via the dedicated Agent Relay Protocol (ARP) WebSocket using a single-connection, task-bound `containerToken`.
    - **IDOR Guard**: For context queries (`e2c:query_context`), the orchestrator resolves workspace and project tenancy **strictly from the server-side task record bound to `containerToken` at mint time**. Any tenant, project, or workspace ID supplied inside the message payload by untrusted in-container code is ignored.
    - `containerToken` has a strictly limited blast radius: single-socket binding, invalidated on container teardown, and granting message emission for that specific task ID only.
- **Deep-Dive**: [`docs/architecture/session-token-and-cockpit-rbac.md`](file:///home/tarikelmallah/Projects/GraywolfSquad/docs/architecture/session-token-and-cockpit-rbac.md)
- **Consequences**: Immediate session revocation is guaranteed. Chat Cockpit actions are strictly bound to human user permissions. Sandboxes cannot pivot into the management plane or leak tenant data across boundaries.

---

## ADR-040: Scoped Docker Socket Proxy & Multi-Bridge Network Segmentation

- **Date**: 2026-09-14
- **Status**: Accepted
- **Context**: Dynamically provisioning ephemeral sandboxes (`runner-{TASK_ID}`) traditionally involves mounting `/var/run/docker.sock` directly into the orchestrator container. However, raw Docker socket exposure grants root-equivalent control over the host filesystem—if the orchestrator process or any of its dependencies were compromised, an attacker could trivially spawn a privileged container with `/` mounted from the host. Furthermore, running all services on a single flat Docker bridge network would reduce the "sandboxes cannot reach Control Plane APIs" claim to application-level trust rather than kernel-enforced network segmentation.
- **Decision**:
  - **Scoped Docker Socket Proxy (`tecnativa/docker-socket-proxy`)**: The host `/var/run/docker.sock` is mounted strictly into an unexposed `docker-proxy` sidecar container. The orchestrator accesses the Docker API via an internal TCP endpoint (`http://docker-proxy:2375`) on an isolated private bridge (`daemon-net`). To future-proof Enterprise horizontal scaling beyond a single VM, the orchestrator MUST wrap all `dockerode` logic behind an abstract `IRunnerProvider` interface, allowing seamless substitution with Kubernetes or Nomad later. API access is constrained via environment variables:
    - `CONTAINERS=1`, `POST=1` (permitted: list/create/start/stop/remove ephemeral sandboxes).
    - `NETWORKS=1` (permitted: attach runners to the runner network).
    - `EXEC=0` (disabled: orchestrator cannot exec into running containers).
    - `VOLUMES=0` (disabled: cannot create arbitrary host mounts).
    - `SWARM=0`, `SERVICES=0`, `INFO=0`, `AUTH=0` (disabled).
  - **Three-Tier Physical Docker Network Segmentation**:
    1. `control-net` (`internal: true`): Houses `postgres-shared` (5432), `valkey` (6379), `litellm-proxy` (4000), and `orchestrator` (internal management port 3000). Runners are **not attached** to this network, making control-plane ports physically unreachable.
    2. `daemon-net` (`internal: true`): Private two-node bridge containing only `docker-proxy` (2375) and `orchestrator`.
    3. `runner-net` (Bridge): Ephemeral sandboxes (`runner-{TASK_ID}`, `postgres-{TASK_ID}`) attach here. The orchestrator exposes a **dedicated WebSocket listener on Port 3001 (`ARP_PORT`)** to this network. Port 3000 (REST/Admin) is NOT bound to `runner-net`.
    4. `edge-net`: Published ports to host (`dashboard` on 5173/80, `orchestrator` client API on 3000).
  - **Defense-in-Depth Posture & Residual Risk Gates**:
    - *Topology Gate (Strict Trigger Condition)*: Unscoped `IMAGES=1` and open internet egress on `runner-net` are **strictly permitted only in Topology A (Local/Solo Developer Mode)** for development velocity.
    - *Mandatory Hardening Gate for Topologies B (Enterprise Self-Hosted) & C (BYOC / Hybrid SaaS)*: Before any external, team, or production customer source code touches a runner sandbox, the deployment **MUST** enforce:
      1. **Immutable Image Digest Pinning**: Base runner images must be pinned to explicit SHA-256 digests (`image@sha256:...`) from a verified internal registry, and `IMAGES` on `docker-proxy` is set to `0` or locked to an internal registry allowlist.
      2. **Strict Egress Filtering (ADR-028)**: Direct egress on `runner-net` is disabled, routing all sandbox network traffic through an egress proxy with strict domain allowlisting (npm, PyPI, verified Git remote, LiteLLM) to prevent source code exfiltration.
- **Deep-Dive**: [`docs/architecture/local-development-topology.md`](file:///home/tarikelmallah/Projects/GraywolfSquad/docs/architecture/local-development-topology.md)
- **Consequences**: Host root escalation via raw Docker socket exposure is completely eliminated. Network segmentation is physically verifiable via `docker network inspect runner-net`. Residual convenience risks are bound to explicit topology gates and cannot silently leak into production or multi-user environments.

---

## ADR-041: Schema-First OpenAPI 3.1 REST API Contract & Dual-Port Gateway

- **Date**: 2026-09-14
- **Status**: Accepted
- **Context**: The platform boundary between the Fastify orchestrator, the React/Vite dashboard, external webhook integrations, and client tools requires a formal, versioned contract. Additionally, the physical network separation established in ADR-040 mandates a clean architectural separation between control-plane REST operations (Port 3000) and in-container agent WebSocket communication (Port 3001).
- **Decision**:
  - Adopt a **Schema-First OpenAPI 3.1 Contract** located at `specs/001-multi-agent-platform/contracts/openapi.yaml` as the canonical source of truth for all Control Plane REST and server-sent event (SSE) endpoints.
  - Formally specify endpoints across 6 foundational resource domains:
    1. **Authentication & Session Management** (`/auth/session`, `/auth/logout`) with Better-Auth cookie transport.
    2. **Workspaces & Cryptographic Invites** (`/workspaces`, `/workspaces/:id/invites`, `/invites/redeem`) enforcing SHA-256 hashed invite redemption.
    3. **Projects & Brownfield Reconnaissance** (`/projects`, `/projects/:id/recon`) with multi-provider Git credentials.
    4. **Tasks & DAG Orchestration** (`/tasks`, `/tasks/:id/dispatch`, `/tasks/:id/clarification`, `/tasks/:id/review-gate/approve`).
    5. **Conversational Chat Cockpit** (`/chat/turn`) supporting `assistant-ui` message flows and server-authoritative tool execution records.
    6. **WebSocket Ticket-Granting Tokens (TGT)** (`/telemetry/ws-ticket`) with task scoping and single-use validation.
  - Enforce strict TypeScript code generation from `openapi.yaml` for both Fastify route schemas (via TypeBox) and React frontend query hooks (via `openapi-fetch` / `tanstack-query`), eliminating manual type drift.
- **Contract Specification**: [`specs/001-multi-agent-platform/contracts/openapi.yaml`](file:///home/tarikelmallah/Projects/GraywolfSquad/specs/001-multi-agent-platform/contracts/openapi.yaml)
- **Consequences**: Frontend and backend engineering can proceed concurrently against a shared, mockable schema. Type safety is guaranteed from the database RLS layer through Fastify routes directly into React UI components.

---

## ADR-042: Unified Error Taxonomy & Structured Machine-Readable Codes

- **Date**: 2026-09-14
- **Status**: Accepted
- **Context**: In multi-agent autonomous platforms, free-form error strings lead to ambiguous agent reflections, brittle UI parsing, and unpredictable retry behaviors. With OpenAPI contracts and in-container relay harnesses now specified, Graywolf requires a standardized, machine-readable error classification system that spans Fastify REST endpoints, ARP WebSockets, in-container sandboxes, and the React/assistant-ui dashboard.
- **Decision**:
  - Implement a **Domain-Prefixed Error Taxonomy** categorizing all operational and runtime failures:
    - `AUTH_*`: Session expiration, invalid invites, TGT timeouts.
    - `RBAC_*`: Insufficient role, unauthorized merge, forbidden Cockpit tool execution.
    - `TASK_*`: Invalid state transition, dependency blockers, lock contention.
    - `SANDBOX_*`: Docker proxy unreachable, OOM kills (Exit 137), heartbeat timeouts.
    - `RELAY_*`: Blast-radius scope escapes, git barrier violations, deterministic linter failures.
    - `LLM_*`: Rate limits, circuit breaker trips, context overflows, budget caps.
    - `GIT_*`: Remote authentication failure, worktree collision, auto-rebase conflicts.
  - Standardize the **Wire Schema**: Every error response contains `{ code, message, details, retryable, timestamp }`, mapping deterministically to HTTP status codes and ARP WebSocket close frames (4001–4010).
  - Enforce global Fastify error interception and typed client handling, enabling the UI to perform transparent TGT refreshes, natural language AI role explanations, and targeted escalation cards.
- **Deep-Dive**: [`docs/architecture/error-taxonomy-and-structured-codes.md`](file:///home/tarikelmallah/Projects/GraywolfSquad/docs/architecture/error-taxonomy-and-structured-codes.md)
- **Consequences**: Error handling is fully deterministic across all four tiers (API, runner, relay, UI). Agents and human engineers receive structured diagnostic payloads rather than generic stack traces.

---

## ADR-043: Automated Brownfield Reconnaissance & Blast-Radius Engine

- **Date**: 2026-09-14
- **Status**: Accepted
- **Context**: When integrating into existing enterprise codebases, agents cannot be allowed to guess coding patterns, alter core authentication/billing logic, or break CI/CD pipelines. Defining file scopes manually is tedious and error-prone for developers. Graywolf requires an automated, structural pre-flight analysis phase that discovers conventions and bounds agent blast radius before any task execution begins.
- **Decision**:
  - Implement an **Automated 5-Phase Reconnaissance Pipeline**:
    1. **Manifest & Infrastructure Fingerprinting** (0 tokens, <1s): Detect frameworks (NestJS, Fastify, Django, etc.), ORMs (TypeORM, Prisma, SQLAlchemy), test runners (Jest, Pytest), and CI/CD pipelines.
    2. **Tree-Sitter AST Symbol Extraction** (0 tokens, <5s): Parse identifiers, exports, interfaces, and import statements into the code intelligence repository.
    3. **Dependency Graph Centrality** (0 tokens, <2s): Compute PageRank over module import graphs to locate core shared utilities versus leaf implementations.
    4. **Algorithmic Blast-Radius Proposal**:
       - Non-overridable system files (`.git/**`, CI/CD pipelines, Dockerfiles, `package.json`, `relay.mjs`, Constitution) are strictly locked to **Forbidden Scope**.
       - Target feature directories and tests are assigned to **Writable Scope**.
       - Transitive upstream imports and bounded downstream dependents (depth ≤ 1, max 20) are classified as **Read-Only Scope**.
    5. **Artifact Generation**: Emit `.agents/recon-report.md` and propose the initial runtime `.agents/constitution.md` for human lead sign-off.
  - Require explicit **Human Lead Engineer Approval** in the web dashboard before committing `.agents/project.config.json` to the target repository.
- **Deep-Dive**: [`docs/architecture/brownfield-reconnaissance-and-blast-radius.md`](file:///home/tarikelmallah/Projects/GraywolfSquad/docs/architecture/brownfield-reconnaissance-and-blast-radius.md)
- **Consequences**: Zero tokens are wasted learning basic repository topology. Core infrastructure and CI/CD pipelines are structurally shielded from modification from day one.

---

## ADR-044: Webhook Replay Defense, Rate-Limiting & Denial-of-Wallet (DoW) Loop Mitigation

- **Date**: 2026-09-14
- **Status**: Accepted
- **Context**: Graywolf's brownfield integration relies on external Git forge webhooks (`repo-sdk`) to catch pull request review comments, CI status updates, and issue events. However, an automated agent responding to external webhooks creates a severe Denial-of-Wallet (DoW) and infinite-loop attack surface: an adversary or automated bot rapidly posting comments or oscillating CI statuses could trigger endless sandbox provisioning cycles, exhausting LLM token budgets and host compute. Furthermore, forged or replayed webhook payloads could trick the orchestrator into modifying unauthorized worktrees or overriding gate policies.
- **Decision**:
  - Implement a **Triple-Tier Webhook Hardening & DoW Defense Engine**:
    1. **HMAC Signature Verification & Nonce Replay Defense**:
       - Every incoming webhook from GitHub, GitLab, Bitbucket, Azure DevOps, or Gitea MUST be verified using the repository's configured webhook secret via constant-time HMAC comparison (`X-Hub-Signature-256`, `X-Gitlab-Token`).
       - Webhook delivery IDs (`X-GitHub-Delivery`) and payload SHA-256 digests are cached in Valkey with a 10-minute TTL. Duplicate payloads are rejected immediately with HTTP 200 `WEBHOOK_ALREADY_PROCESSED` (idempotent no-op).
    2. **Sliding-Window Webhook Debounce (`webhookDebounceMs`)**:
       - Multiple rapid-fire review comments on the same PR are debounced over a configurable window (`webhookDebounceMs`, default: 3 minutes / 180,000ms).
       - Comments arriving during the debounce window are aggregated into a single combined revision brief rather than spawning concurrent, competing runner containers.
    3. **Autonomous Revision Ceiling (`maxAutonomousRevisionsPerTask`)**:
       - Enforce a hard ceiling on autonomous PR review iterations (`maxAutonomousRevisionsPerTask`, default: 5).
       - If a task exceeds 5 autonomous review iterations, the orchestrator immediately halts automatic execution, marks the task `AWAITING_HUMAN_INTERVENTION`, and posts a notice to the PR: *"Autonomous revision ceiling reached. Human lead sign-off required to resume."*
    4. **Untrusted Input Sanitization (ADR-025 Cascade)**:
       - All webhook comment bodies are classified as Level 3 (Untrusted Ecosystem Inputs) and wrapped in XML boundary tags (`<untrusted_pr_comment>`) before being passed to the model, preventing prompt injection from PR comments.
- **Deep-Dive**: [`docs/architecture/review-gates-and-guardrails.md`](file:///home/tarikelmallah/Projects/GraywolfSquad/docs/architecture/review-gates-and-guardrails.md)
- **Consequences**:
  - Protects the project from wallet-draining infinite loops caused by bot debates, flappy CI, or malicious comment floods.
  - Ensures deterministic, idempotent processing of Git forge webhooks.
  - Guarantees human operator visibility when PR discussions exceed standard iteration thresholds.

---

## ADR-045: Core Developer Experience & UX Safeguards

- **Status**: Proposed
- **Context**: The backend architecture is robust, but the Developer Experience (DX) for interacting with the agent presents cognitive bottlenecks and potential security loopholes if designed poorly. Notification fatigue can lead to rubber-stamping, and diff-blindness can mask subtle regressions. Furthermore, executing an agent without explicit cancellation or live-spend visibility presents a major operational risk.
- **Decision**:
  - Implement the **Core UX/DX Safeguards**. To prevent scope creep, these are strictly divided into v1 (Thin Vertical Slice requirements) and v2 (Deferred):
  - **Required for v1 (Thin Vertical Slice)**:
    1. **The "Panic Button" (Graceful Stop/Cancel)**: The Cockpit must have an explicit Cancel mechanism. It must issue a `SIGTERM` targeting the entire container *process group* (to catch child processes like `npm install`), abort pending LLM generations, cleanly drop the ephemeral `task_{id}` PostgreSQL database tier, and revert uncommitted worktree changes via `git restore .`.
    2. **Live Spend Meter**: A running USD/token metric visible during mid-execution in the UI, allowing operators to kill looping tasks before they hit the hard budget ceiling.
  - **Deferred to v2**:
    3. **Context-Aware Boot Diagnostics**: Proactive dashboard nudges based on background recon scans.
    4. **Cost-Estimated Prompts**: Proactive suggestions must display an estimated max token cost upfront.
    5. **Progressive Trust Scopes**: Allow users to elevate Writable scopes (e.g., "approve `src/users/*` for this task") to prevent interrupt fatigue. Modifying scope must emit an explicit audit event into the task's `.specify/memory/project.config.json` snapshot.
    6. **Six-Gate Immutability**: Progressive Trust **CANNOT** bypass the six mandatory safety gates (Destructive Ops, Secrets, Merge, Budget, Protected Paths, Two-Strike Rejection). These must remain atomic, per-instance approvals regardless of trust elevation.
    7. **Deterministic AST Semantic Diffs**: The 60-second review packet must summarize diffs using deterministic AST parsing (Tree-sitter) rather than LLM-generated prose, preventing AI-narrated hallucinations.
    8. **Time-Travel Trajectory Inspector**: A DevTools-style timeline slider utilizing ADR-032 (Deterministic Replay) to debug the agent's context and terminal at any specific millisecond.
    9. **Bi-Directional Viewport Sync**: Implicitly sync the developer's active file viewing state into the Chat Cockpit context.
    10. **Pre-Flight PM Clarification Gate**: Use a cheap, fast model call to interrogate vague or high-risk task descriptions before launching the heavy Dev-Level-1 planner.
    11. **Stakeholder UI (Viewer Role)**: A stripped-down dashboard for non-technical users showing goal progress, Demos/Traces, and budget, omitting AST/terminal views.
- **Consequences**: The thin vertical slice retains critical operator safety controls (Cancel & Budget UI) without the scope creep of the full v2 orchestration UX.

---

## ADR-046: Generic Target-Stack Sandbox Provisioning via Testcontainers + Pluggable Providers

- **Date**: 2026-09-14
- **Status**: Accepted
- **Context**: Tier 2 databases in the ephemeral sandbox were specified as PostgreSQL using a sub-300ms `CREATE DATABASE ... TEMPLATE` cloning strategy. While highly optimized, this breaks when the target repository uses MongoDB, MySQL, Redis, or other stacks. A generic sandbox solution is required without sacrificing developer onboarding velocity or security.
- **Decision**:
  - Adopt **Testcontainers** as the generic sandbox provisioning backend, eliminating the need to write bespoke container lifecycles for every database engine.
  - Implement a **Two-Tier Sandbox Model**:
    - **Fast-Clone Tier**: Engines with native template/snapshot primitives (Postgres) that boot in <300ms.
    - **Generic Tier**: Everything else (MongoDB, Redis, etc.) boots as a fresh container per-task via Testcontainers. Slower (seconds instead of ms), but universally compatible.
  - Merge the Sandbox Provisioner with the Plugin Extension System (`skillImports` gap) into a single **Provider Plugin** format placed in `.agents/sandbox-providers/`. Built-ins (Postgres, Mongo) are first-party and digest-pinned; custom third-party providers are subject to strict supply-chain scrutiny.
  - Achieve **Zero-Friction Onboarding**: 
    1. Phase 1 Recon auto-detects `docker-compose.yml` services and wires them to Providers.
    2. Default to **Tier 0 (Mock, no DB)** if no compose file exists, avoiding forced Postgres assumptions.
    3. Expose a wizard only as an ambiguous fallback.
- **Consequences**: The platform is stack-agnostic. Developers building MongoDB or Redis apps can use Graywolf out-of-the-box, with the honest tradeoff that non-Postgres stacks will have standard Docker container boot times rather than sub-second clone times.

---

## ADR-047: Triple-Layer Non-Committing Barrier (Read-Only `.git` Mount & Three-Variable tmpfs Isolation)

- **Date**: 2026-09-16
- **Status**: Accepted
- **Context**: A field report discovered that the PATH-level Git wrapper script (`git-guard.sh`) was bypassable: an agent could execute `/usr/bin/git.real` directly by absolute path, or invoke `git -c user.name=x commit` because the wrapper only matched `$1`. Because `.git` was writable, commits were written directly to the worktree, corrupting patch diff generation. Furthermore, setuid helpers cannot be used because container hardening already enforces `--security-opt=no-new-privileges:true` and `--cap-drop=ALL`. Finally, standard `git add` writes loose objects into `.git/objects`, so a naive read-only `.git` mount would fail on the first `add`.
- **Decision**:
  - Implement a **Triple-Layer Defense-in-Depth Model**:
    1. **Filesystem Kernel Invariant**: Mount `/workspace/.git` as **Read-Only** (`:ro` bind mount or `chmod -R 555`). Even with root privileges inside the container, writing to `.git/refs` or `.git/HEAD` fails with `EROFS` (Read-only file system). Commits and ref mutations (`git commit`, `git stash`) are physically impossible at the OS kernel level.
    2. **Three-Variable tmpfs Object & Index Isolation**: The container environment presets:
       - `GIT_INDEX_FILE=/tmp/graywolf/git/index`
       - `GIT_OBJECT_DIRECTORY=/tmp/graywolf/git/objects`
       - `GIT_ALTERNATE_OBJECT_DIRECTORIES=/workspace/.git/objects`
       `git add` writes new loose objects into tmpfs, while reading base commits from the read-only mount. Patches are emitted via `git diff HEAD` (capturing both staged tmpfs objects and unstaged worktree edits).
    3. **Hardened Wrapper**: `git-guard.sh` strips all global flags (`-c`, `--git-dir`, etc.) to parse the real subcommand, early-rejecting blocked commands (`commit`, `push`, `merge`, `rebase`, `stash`) with exit code 128. Security does not rely on setuid elevation; kernel filesystem immutability is the non-negotiable anchor.
- **Consequences**: Absolute, tamper-proof enforcement of the non-committing relay contract.

---

## ADR-048: Graceful Budget Wrap-Up, Emergency Checkpointing, and Belt-and-Suspenders Resumption

- **Date**: 2026-09-16
- **Status**: Accepted
- **Context**: Previously, hitting `spendLimitUSD` triggered an immediate `process.exit(0)` with status `budget_exceeded`, completely discarding in-flight changes and wasting LLM spend on near-complete tasks. Operators had no historical basis for setting budget ceilings.
- **Decision**:
  - **Active 80% Soft Warning**: When spend reaches 80% of `limitUsd`, inject an active steering message into the agent loop: switch immediately to wrap-up mode (finalize in-flight file edits, ensure tests pass, prepare patch diff).
  - **100% Emergency Checkpointing (N6, N12)**: If the hard ceiling is breached, execute `relay.flushEmergencyPatch()`:
    ```bash
    git add -A
    git diff --binary --full-index HEAD > changes.patch
    ```
    Writes `.agents/tasks/{TASK_ID}/checkpoint.json` containing the file mutation ledger, plan state, and preserved binary/untracked diff before cleanly exiting.
  - **Belt-and-Suspenders Resumption Architecture (N15)**:
    - *Lifecycle (Fresh Container + Patch Reapply)*: Resumption does NOT re-attach to the exited container or its existing worktree (which may be unclean or corrupted). Instead, `POST /api/v1/tasks/{id}/resume` provisions a **pristine container**, checks out a clean worktree from the base commit, applies `changes.patch` via `git apply --3way --binary`, and safely resumes execution from `plan.md`.
    - *Network Layer (Topology A/B)*: Under ADR-040, Port 3000 (management API) is on `control-net`/`edge-net`, with no network route from `runner-net`.
    - *Application Layer (Topology C & Defense-in-Depth)*: `POST /api/v1/tasks/{id}/resume` strictly requires `OPERATOR_SESSION_TOKEN` (human admin JWT/cookie) and explicitly rejects `RELAY_AUTH_TOKEN` with HTTP 403 Forbidden.
    - *Governor Clamps*: Hard ceiling of `maxResumesPerTask: 2`, 7-day patch retention TTL, and global workspace budget cap `orgSpendLimitHardCapUSD`.
  - **Pre-Flight Spend Estimator**: At dispatch, calculate historical spend percentiles from similar past tasks to guide operator limit configuration.
- **Consequences**: Zero work discarded on budget limits. Novice operators avoid under-budgeting traps. Resumption guarantees clean worktree state through patch re-application and cannot be self-resumed by untrusted agent tokens.

---

## ADR-049: Cross-Language Symbol Resolution, Route Literals, and OpenAPI `contract.diff`

- **Date**: 2026-09-16
- **Status**: Accepted
- **Context**: In polyglot repositories (e.g. Go backend + TypeScript/React frontend), standard AST symbol graphs fail at the language boundary. Changes to Go response structs went unnoticed by TypeScript components, causing contract-drift bugs to reach manual testing with green test passes.
- **Decision**:
  - **Route Literals as First-Class Symbols**: Tree-sitter indexes API route literals across languages (Go handler registrations `r.Get("/api/v1/...")` and TypeScript fetch calls `fetch('/api/v1/...')`). `find_symbol_references` bridges routes across backend and frontend.
  - **Automated `contract.diff` Pipeline**: Any task touching API boundaries generates the target OpenAPI spec and runs `openapi-diff` against baseline.
  - **Mandatory Review Artifact**: Emits `.agents/tasks/{TASK_ID}/review/contract.diff`. Uncoordinated breaking API changes automatically penalize confidence scores and require explicit human sign-off.
- **Consequences**: Eliminates silent full-stack contract drift across multi-language codebases.

---

## ADR-050: Non-Expert Operator Assistance Layer (Decision Memos, Re-Confirmable Lessons, Scope Simulator)

- **Date**: 2026-09-16
- **Status**: Accepted
- **Context**: Safety gates previously assumed the human operator had deep architectural knowledge to adjudicate technical agent disputes, triage quarantined lessons, and write picomatch scope globs. For non-expert solo operators, this caused paralysis or blind approvals.
- **Decision**:
  - **Escalation Decision Memo**: On Two-Strike review failures, an independent Neutral Arbiter (`agent-arbiter`, Requirement N8) synthesizes `escalation-memo.md` to prevent structural conflicts of interest (since Dev-Level-1 authored the disputed plan), explaining the core dispute in plain English, contrasting Option A vs. Option B with specific risks/benefits, and providing a one-click "Proceed with Recommended Default" button.
  - **Async Notifications & Non-Blocking DAG**: Escalations dispatch webhooks (Slack/Email/Push). Other non-dependent tasks in the project DAG continue executing rather than freezing the entire squad overnight.
  - **Re-Confirmable Human Corrections**: Preserve `confidence = 1.00` for `human_correction` (anti-thrashing), but prompt the operator to re-confirm lessons applied $\ge 5$ times or older than 30 days during periodic digests.
  - **Quarantine Plain-English Summaries**: Quarantined lessons feature an LLM-assisted explanation and action recommendation instead of raw diffs.
  - **Interactive Scope Simulator**: Provide an interactive tool at task creation allowing operators to preview which files match `writableScope` and `readonlyScope` before launching containers.
- **Consequences**: Solo developers and non-expert operators can safely govern multi-agent squads without rubber-stamping or suffering decision paralysis.

---

## ADR-051: Organization-Level Memory Tier and Cross-Workspace Intelligence

- **Date**: 2026-09-16
- **Status**: Accepted
- **Context**: When an organization manages multiple repositories (e.g. frontend web app, backend Go API, microservices), newly created project workspaces previously started with a blank slate, forcing the squad to re-learn corporate conventions from scratch and re-committing past mistakes.
- **Decision**:
  - Implement a **Hierarchical Two-Tier Memory System**:
    1. **Organization Memory Tier (`org_id`)**: Stores enterprise-wide conventions, approved third-party libraries, and prohibited anti-patterns. Curated via explicit operator promotion from project lessons.
    2. **Project Memory Tier (`project_id`)**: Stores localized file topologies and service-specific quirks.
  - Onboarding a new project under the same organization automatically pre-seeds its `.agents/constitution.md` and vector context with approved organizational lessons on Day 1.
  - Organization-wide skills (`.agents/org-skills/`) are shared across workspaces.
- **Consequences**: Zero cold-start relearning when creating new services or projects within an enterprise. Established conventions propagate effortlessly across the organization.

---

## ADR-052: Manifest Write Serialization and Dynamic Dependency Locking (F14)

- **Date**: 2026-09-17
- **Status**: Accepted (amended 2026-09-21 — Mastra evaluation subsection added)
- **Context**: Package manifests (`package.json`, `package-lock.json`, `go.mod`, `go.sum`, `Cargo.toml`) were excluded from Rule 0's forbidden defaults to allow mid-task dependency installations. However, allowing concurrent tasks to mutate manifests without synchronization causes lockfile clobbering, non-trivial merge conflicts in binary/hash formats, and split-brain dependency graphs. Furthermore, reading the Go module path from the container's mutable `go.mod` allows agents to circumvent path-banning import validators.
- **Decision**:
  - **Distributed Redis Mutex**: Package manifest mutations are serialized via distributed Redis locks keyed by workspace and manifest path: `workspace:{workspace_id}:lock:manifest:{hash(manifest_path)}`.
  - **Two-Phase Enforcement**:
    1. *Pre-Dispatch Serialization*: If Dev-Level-1 explicitly declares manifests in `writableScope`, ADR-031's pre-dispatch checker queues the task behind active manifest-modifying tasks.
    2. *Mid-Task Dynamic Interception*: If Dev-Level-3 dynamically invokes `npm install`, `go get`, or modifies a manifest file, `relay.mjs` intercepts the command and requests a lock from the Orchestrator via ARP message `manifest.lock.acquire`.
  - **Lease & Heartbeat Management**: Locks are granted with a 60-second lease TTL, maintained by a 15-second heartbeat from `relay.mjs`. A 120-second timeout ceiling prevents deadlocks; if the lock cannot be acquired within 120 seconds, the operation fails cleanly with error code `MANIFEST_LOCK_TIMEOUT`.
  - **Pre-Mutation Sync & Post-Mutation Verification**: Containers verify base alignment before modifying manifests and run `go mod verify` or `npm ls` before releasing the lock.
  - **Orchestrator Recon Source of Truth**: Because manifests in the container are mutable, static analysis guards (Go Import Validator, TypeScript Module Resolver) MUST read the canonical module path and dependency allowlists from the orchestrator-side **Recon Report** (`recon-report.json`), NEVER from the container's local mutable manifest.
- **Consequences**: Concurrent agents can safely install dependencies without race conditions, corrupted lockfiles, or circumventing static analysis security rules.

### Appendix: Mastra Framework Evaluation

- **Assessment Date**: 2026-09-21
- **Framework**: Mastra (`@mastra/core`, Apache-2.0, TypeScript)
- **Disposition**: **Pattern reference only — same as LangGraph (ADR-069).** Do NOT adopt as a workflow engine or memory orchestration layer.
- **Reason**: Mastra is a full TypeScript agent orchestration framework (workflow engine, memory/state primitives, agent-loop abstractions). It is architecturally the same shape as LangGraph, just in TypeScript instead of Python. It has no awareness of: the ARP WebSocket contract, the Docker sandbox lifecycle and worktree model, the blast-radius file interceptors (ADR-008/ADR-047), or RLS-enforced multi-tenant PostgreSQL tenancy. Adopting its workflow or memory primitives wholesale would quietly re-introduce the orchestration-layer coupling that ADR-069 explicitly rejects.
- **Permitted evaluation scope**: Specific, bounded sub-components may be evaluated in isolation — e.g., storage adapter interface patterns for conversation history retrieval. Any specific piece lifted must demonstrate zero interference with the ARP contract, sandbox lifecycle, and RLS boundary before adoption. Document the finding as a new ADR if adopted.

---

## ADR-053: Active Cockpit UI Architecture (Inspired by OpenHands Agent Canvas)

- **Date**: 2026-09-19
- **Status**: Accepted
- **Context**: The Chat Cockpit (ADR-004) required a concrete tab layout for observing live agent work. A production reference implementation (`@openhands/agent-canvas` v1.20.0, MIT License) demonstrated a battle-tested multi-tab split-pane pattern that covers all Graywolf viewing surfaces: diffs, terminal, files, planning, browser, and token usage.
- **Decision**:
  - Adopt the **multi-tab split-pane cockpit layout** with:
    - **Left pane**: Chat conversation interface.
    - **Right pane (tabbed)**:
      - `files` — Workspace file explorer and read-only previews.
      - `commits` — Monaco DiffEditor with 3-mode toggle (`old` / `diff` / `new`), custom dark theme, and per-file accordion rows. Height capped at 600px per panel. Displays both working-tree vs base diff and per-commit deltas (supporting the Non-Committing Relay output, ADR-018).
      - `planner` — Live task checklist synchronized with Dev-Level-1's `plan.md`.
      - `terminal` — XTerm.js WebSocket terminal streaming container stdout/stderr.
      - `browser` — Headless browser viewport for agents running Playwright or UI verification tasks.
      - `usage` — **ContextMeter** (gauge showing % of context window filled), **CompactContextButton** (manual trigger for context condensation), and live accumulated token and cost stats.
  - **Resizable split pane** between left and right with drag handle; widths persisted per-conversation in `localStorage`.
  - **Tab lazy-loading**: All right-panel tab components are dynamically imported to avoid bundling XTerm + Monaco into the eager route graph.
  - **Session-only drawer state**: Right-panel open/closed state is not persisted in `localStorage` — only the selected tab is. Rationale: reopening a conversation should not auto-expand a drawer the developer may have closed intentionally.
  - **Source**: Pattern adopted from MIT-licensed `@openhands/agent-canvas`. No source code is copied; this is an architectural pattern adoption. Original copyright: © 2025 OpenHands contributors.
- **Alternatives Considered**:
  - Building a bespoke tab layout from scratch: rejected because OpenHands has already solved edge cases (resize handles, drag-during-transition performance, mobile breakpoints, lazy-load ordering).
  - Embedding the OpenHands npm package (`@openhands/agent-canvas`): rejected because Graywolf's multi-tenant platform requires its own backend adapter layer.
- **Consequences**: Developers get a zero-context-switch cockpit — live terminal, diff review, task planning, and token budget all visible simultaneously without leaving the active task view.

---

## ADR-054: Agent CLI Dispatch Interface (delegate-skills Relay Contract + ACP)

- **Date**: 2026-09-19
- **Status**: Accepted
- **Context**: ADR-003 defines the 3-tier virtual developer loop (Dev-Level-1 Planner → Dev-Level-3 Implementer → Dev-Level-2 Reviewer). The implementer tier was previously assumed to be a single model call. To enable Graywolf to dispatch work to specialized external agent CLIs (Claude Code, OpenCode, Codex, Gemini CLI, Antigravity `agy`) without bespoke per-CLI integration code, a standardized dispatch contract is needed. Two battle-tested MIT-licensed reference implementations address this:
  1. **`delegate-skills`** (MIT, Ahmed Mohammed / amElnagdy) — provides the `brief → relay → result.json` contract across 18 implementer CLIs.
  2. **ACP (Agent Client Protocol)** — JSON-RPC 2.0 over stdio, providing structured streaming from CLIs that support it (Claude Code, Codex, Gemini CLI); surfaced in OpenHands Agent Canvas (MIT).
- **Decision**:
  - **Dev-Level-3 dispatches work via the `delegate-skills` relay contract**:
    - **Input**: `brief.txt` written to stdin + `--cd <repo-path>` + `--lane <lane-name>`.
    - **Output**: `<out-dir>/result.json` → `{ status, exitCode, sessionId, touchedFiles, finalMessage, eventsPath }`.
    - **Session Resumption**: Delta briefs sent via `--session <id>` for Two-Strike Strike-2 rework (same session, same implementer, no cold restart).
  - **Fleet Lane Configuration** follows the **`delegate-fleet.v1` schema**:
    - Named lanes (`feature`, `tests`, `ui`, `complex`, `security`) mapping to implementer CLIs.
    - Per-lane dials: `model`, `effort`/`variant`, `timeout`, `readOnly`.
    - **Scope**: global (`~/.config/delegate-skills/config.json`) and project (`<git-root>/.delegate/config.json`).
    - **Project config integrity**: Content-bound to a tamper-proof approval hash (written at setup time). Cloned or edited project configs fail closed until re-approved through `delegate-setup`.
  - **ACP JSON-RPC streaming** is used as the subprocess communication transport for CLIs that support it (Claude Code, Codex, Gemini CLI). This enables live turn-by-turn rendering in the cockpit's `terminal` tab.
  - **Strict non-committing enforcement**: All relay scripts structurally deny `git commit`, `git push`, and nested agent invocations via string deny rules. These are speed bumps atop the brief's "no-commit" instruction; the orchestrator's diff review and the Non-Committing Relay Contract (ADR-018) remain the authoritative boundary.
  - **Two-Strike Mapping**:
    - **Strike 1**: Fresh dispatch (`relay.mjs --brief brief.txt --cd <repo>`).
    - **Strike 2**: Delta brief via `relay.mjs --session <id> --cd <repo>` — same implementer session, incremental correction only.
    - **Strike 3+**: Escalate to human (`INTERNAL_REVIEW_FAILED`) with Escalation Decision Memo (ADR-050).
  - **Implementer registry** (all MIT-licensed relays from `delegate-skills`): `claude`, `codex`, `opencode`, `agy`, `grok`, `cursor`, `cline`, `aider`, `vibe`, `kimi`, `pi`, `qoder`, `commandcode`, `copilot`, `warp`, `zcode`, `omp`.
  - **Default dispatch mode**: ACP JSON-RPC streaming preferred when supported; plain stdin-brief relay as fallback for non-ACP CLIs.
- **Source**: MIT-licensed `delegate-skills` by Ahmed Mohammed (`reference-opensources/delegate-skills-master/`). MIT-licensed ACP protocol from OpenHands Agent Canvas (`reference-opensources/OpenHands-main/`). Relay scripts may be copied into Graywolf's internal `tools/relay/` directory with attribution per MIT requirements.
- **Alternatives Considered**:
  - Single-model implementation without external CLI delegation: accepted for v0 baseline but rejected as the primary approach because it prevents swapping models mid-project and forces all work through one LLM.
  - Forking OpenHands as the full platform: rejected (ADR implicit decision — product scope and safety model misalignment).
- **Consequences**:
  - Dev-Level-3 becomes **CLI-agnostic**: swapping between Claude Code, OpenCode, Codex, or Antigravity requires only a lane config change, no code change.
  - Two-Strike rework is efficient: Strike-2 resumes the exact session rather than restating the entire context.
  - Live ACP streaming makes the terminal tab useful during execution, not just after.
  - The platform can evolve to support future ACP-compatible agents with zero architectural change.

---

## ADR-055: MCP Server Credential Redaction and Secure Probe Pattern

- **Date**: 2026-09-19
- **Status**: Accepted
- **Context**: MCP server configurations in the cockpit settings UI contain credentials (OAuth tokens, API keys, environment variables for tool servers). The UI must never expose cleartext values once stored — yet connectivity testing requires sending the real values to the MCP server.
- **Decision**: Adopt the credential redaction pattern from OpenHands Agent Canvas (`src/api/mcp-service/mcp-redacted-credentials.ts`, MIT):
  - **Storage**: MCP credentials are stored server-side in encrypted form (via column-level envelope encryption, ADR-013).
  - **Display**: The settings UI receives `REDACTED_MCP_SECRET_VALUE = "**********"` placeholders for all credential leaves.
  - **Edit Semantics**: When a user edits non-credential fields (e.g. MCP server URL) and submits, the redacted placeholder is preserved for untouched secret leaves.
  - **Probe / Connectivity Test**: Before dispatching a connectivity test, the frontend recursively merges redacted placeholder leaves with the corresponding server-side encrypted values. The probe request exercises the real encrypted configuration transparently, without ever sending a cleartext secret to the browser.
  - **Fresh secret edits**: New or replaced secrets flow from the UI to the server in a single encrypted write; the browser never re-receives the cleartext after initial submission.
- **Source**: Pattern adopted from MIT-licensed `@openhands/agent-canvas`. Original copyright: © 2025 OpenHands contributors.
- **Consequences**: MCP credentials never travel in cleartext through the UI layer after initial save. Probe requests test real connectivity without credential exposure. Stolen browser network traces or memory dumps cannot yield usable MCP credentials.

---

## ADR-056: Adversarial Multi-Model Debate Review for Dev-Level-2 (review-skills Debate Protocol)

- **Date**: 2026-09-19
- **Status**: Accepted
- **Context**: ADR-003 and ADR-054 defined Dev-Level-2 Reviewer as a single analytical model review before human sign-off or escalation. In practice, single-model reviewers frequently suffer from hallucinated errors, false positive syntax/spec rejections, and stylistic bias against valid implementations. When Dev-Level-2 issues a spurious rejection, it burns one of the two strikes in the Two-Strike Rule, leading to premature, noisy, and costly human escalations (`INTERNAL_REVIEW_FAILED`). The MIT-licensed `review-skills` project by Ahmed Mohammed (`debate-review`) establishes an adversarial 3-pass protocol where two independent model families debate findings before producing a final verdict.
- **Decision**:
  - **Adopt 3-Pass Adversarial Debate Protocol for Dev-Level-2**:
    1. **Pass 1 (`debate-review.findings.v1`)**: Main reviewer (`review-main` lane) audits the patch diff and produces structured findings with line anchors, severity (`P0` security/crash, `P1` logic/spec violation, `P2` non-blocking/nitpick), axis (`correctness`, `security`, `spec`, `standards`, `tests`, `docs`), claim, code evidence, recommendation, and confidence score. Findings below `min_confidence` (default 0.5) are automatically dropped.
    2. **Pass 2 (`debate-review.debate.v1`)**: Debate reviewer (`review-debate` lane; strictly required to be a different model family, e.g. Claude vs Codex/Gemini) audits each finding: `confirm`, `refute` (with code evidence), or `downgrade`. Also performs a gap sweep (`new_findings`) for missed blocking defects only.
    3. **Pass 3 (`debate-review.final.v1`)**: Main reviewer makes the final call on challenged findings. Every finding resolves to `agreed`, `contested`, or `withdrawn`.
  - **Two-Strike Accounting & Escalation Thresholds**:
    - **`withdrawn`**: Debate model successfully refuted finding with code evidence; finding is discarded and **never counts as a Strike**.
    - **`agreed` P0 / P1**: Both model families independently verified the defect; **counts as an authoritative Strike** against Dev-Level-3.
    - **`contested`**: Debate model refuted finding but Main reviewer held ground with evidence. Does **not** auto-fail Dev-Level-3 as a Strike; instead escalated to human via **Escalation Decision Memo** (ADR-050) with both arguments presented.
    - **P2 (Non-blocking)**: Advisory notes only; bundled into review packet but never block completion or trigger a Strike.
  - **Local In-Container Evaluation (`--local`)**:
    - Dev-Level-2 executes against the ephemeral container's local git worktree diff (comparing current tree against base branch) via the Non-Committing Relay Contract (ADR-018). Zero forge API calls (`gh`/`glab`) or cloud network egress required during review.
  - **Fleet Lane Configuration**:
    - Requires two independent lanes in `delegate-fleet.v1`: `review-main` (e.g. `claude`) and `review-debate` (e.g. `codex` or `gemini`). Both lanes must enforce `--read-only: true`.
  - **Dual-Axis Review Formatting & `docs-guard` Validation (ADR-083)**:
    - Final review sign-off synthesizes findings into two distinct columns: **Standards Axis** (linter, architecture boundaries, error handling, typing) vs. **Spec Axis** (functional acceptance criteria in `brief.md`).
    - An automated AST `docs-guard` cross-check verifies that all symbols and configuration keys mentioned in the PR description or documentation exist in `changes.patch` before human presentation.
- **Source**: MIT-licensed `review-skills` by Ahmed Mohammed (`reference-opensources/review-skills-master/`). Contracts and scripts adapted under MIT license into Graywolf's internal review engine.
- **Alternatives Considered**:
  - Single-model reviewer with self-reflection: rejected because models consistently reproduce their own blind spots during self-reflection.
  - External CI bot harvesting (`babysit-pr`) in v1: deferred for internal tasks; retained as an architectural pattern for Brownfield external PR monitoring.
- **Consequences**:
  - Slashes false positive rejections in the Two-Strike loop, preserving human operator attention for real architectural conflicts.
  - High-precision, evidence-grounded review reports attached to every verified patch diff.
  - Enforces model diversity across the review pipeline.

---

## ADR-057: Background Learning Loop — Post-Task Reflection & Autonomous Skill Generation (Hermes Pattern)

- **Date**: 2026-09-19
- **Status**: Accepted
- **Context**: After every task, Graywolf Squad accumulates valuable knowledge: successful implementation patterns, debugging paths that worked, human corrections, and workflow preferences. Without a structured mechanism to capture this, each task starts from scratch, wasting the compounded learning of prior executions. The Hermes Agent (Nous Research, MIT) solves this with a daemon-thread "Background Review" that fires after every user turn, asking the agent to reflect on the conversation and persist valuable lessons as memory entries or reusable skill documents — without blocking the main agent loop.
- **Decision**: Adopt the Hermes Background Review pattern, adapted for Graywolf's task-based architecture:
  - **Trigger**: When a task reaches terminal state (completed, review-requested, or even blocked/failed), enqueue a low-priority `background_reflection` BullMQ job. This job never blocks the main task queue.
  - **Reflection Prompt (Dual-Axis — Hermes-Faithful)**:
    - **Project Memory axis**: Did this task reveal architectural patterns, environment quirks, user preferences, or codebase conventions worth remembering? Store as a searchable PostgreSQL + `pgvector` fact.
    - **Skill Library axis**: Did this task yield a non-trivial procedure, a fix pattern, a debugging path, or a workflow correction? If the same procedure class has been executed 2+ times successfully, auto-generate or patch the `.agents/skills/<category>/<skill-name>/SKILL.md` document.
    - **Anti-Pattern axis (ADR-083)**: Did this task trigger Gate 4 guard failures (`test-guard`, `clean-code-guard`) or ADR-056 debate rejections? Store the failure pattern in the PostgreSQL + `pgvector` Anti-Pattern Registry to inject as negative constraints during future Dev-Level-1 planning.
  - **Skill Authoring Standard (Hermes-Strict)**:
    - `name`: lowercase-hyphenated, ≤64 chars.
    - `description`: ONE sentence, ≤60 characters. No marketing words. Ends with period.
    - `version`: starts at `0.1.0`.
    - Body order: Title → When to Use → Prerequisites → How to Run → Quick Reference → Procedure → Pitfalls → Verification.
    - `references/` directory for depth that's only needed sometimes; `scripts/` for re-runnable scripts; `templates/` for boilerplate starters.
  - **DO NOT capture as skills** (Hermes anti-pattern list, adapted):
    - Environment-dependent failures (missing binaries, unconfigured creds) — these are not durable rules.
    - Negative claims about tools ("X doesn't work") — these become stale refusals after the tool is fixed.
    - Session-specific transient errors that resolved before the task ended.
    - One-off task narratives that are not a generalizable class.
    - Unresolved failures — never dress up dead ends as a recommended workflow.
  - **Skill Library Classification (Hermes Curator scope)**:
    - `agent-created`: skills generated by the background reflection job (curator-managed).
    - `user-created`: skills hand-authored by the operator (never auto-patched by background reflection).
    - `pinned`: user-pinned; never auto-archived or patched autonomously.
  - **Model routing**: Background reflection runs via a fast/cheap auxiliary model (e.g., Gemini Flash or Haiku via LiteLLM) to minimize cost. The main task's context window is never touched.
- **Source**: Pattern and skill-authoring standards adapted from MIT-licensed Hermes Agent by Nous Research (`reference-opensources/hermes-agent-main/agent/background_review.py`, `agent/learn_prompt.py`).
- **Alternatives Considered**:
  - Synchronous post-task reflection blocking the next task dispatch: rejected — operator latency impact.
  - Manual skill creation only: rejected — requires operator to manually identify and write skills, eliminating the self-improvement loop.
- **Consequences**:
  - The squad becomes measurably faster on repeated task classes without any operator involvement.
  - The `.agents/skills/` directory grows organically and is inspectable/auditable.
  - Background reflection never competes with active task execution (separate BullMQ queue with lower priority).

---

## ADR-058: Tool Loop Stall Detection Guardrails (Hermes Guardrails Pattern)

- **Date**: 2026-09-19
- **Status**: Accepted
- **Context**: Dev-Level-3 implementer containers can enter infinite retry loops — running the same failing test command repeatedly, looping on an unreachable service check, or cycling through a multi-step pattern that always fails identically. Without detection, these loops exhaust the task's time budget and cost ceiling while producing nothing. Hermes Agent (`agent/tool_guardrails.py`) implements a battle-tested stall-detection system that classifies tool calls, detects exact-failure streaks AND multi-call cycle patterns, and escalates to a hard stop.
- **Decision**: Implement a stall-detection policy layer for Dev-Level-3 container sessions, tracking tool invocations across turns:
  - **Tool Classification** (adapted from Hermes):
    - `IDEMPOTENT`: Read-only operations (file reads, searches, test observation). Stall threshold: 3 consecutive identical (command + output) calls.
    - `MUTATING`: State-changing operations (file writes, terminal commands, git operations). Primary failure tracking target.
    - `FAILURE_TOLERANT`: Tools where failure is expected work output (test runs returning red, grep returning empty). Stall guard only fires on exact-args replay with no intervening change, not on different failing commands.
  - **Stall Patterns Detected**:
    - **Exact-failure streak**: Same command + same failure output N consecutive times. Warn at 3, hard-interrupt at 5.
    - **Multi-call cycle**: Pattern A→B→A→B... (with identical args AND identical results) across consecutive turns. Hermes observation: alternating calls reset the consecutive streak, so naive streak counting misses cycles. Detect cycles up to period 4. Warn at 3 laps, hard-interrupt at 5 laps.
    - **Per-task caps**: Max 50 terminal commands per task turn (configurable via `gate_policy`). Max 3 sub-agent spawns per turn.
  - **On Stall Detection**:
    - **Warn**: Inject a synthetic system message nudging the agent to change approach.
    - **Hard-interrupt**: Cancel the container run, mark task as `STALL_ESCALATED`, increment the Two-Strike counter (counts as a failure strike). Attach a stall report to the task record.
  - **Implementation**: Stall state is tracked in the BullMQ job's metadata store (Redis). Counts survive across turn boundaries within a single task execution. Counts reset at task boundaries.
  - **Non-Interactive Hard Stop**: For unattended gateway/cron tasks (no human watching), the warn threshold is also the hard-stop threshold — no grace period. For attended CLI sessions (operator watching in real-time), warn and allow manual recovery first.
- **Source**: Architecture adapted from MIT-licensed Hermes Agent stall guard (`agent/tool_guardrails.py`, `agent/repetition_guard.py`). Cycle detection ported from Hermes `_STALL_GUARD_MAX_CYCLE_PERIOD = 4` logic.
- **Alternatives Considered**:
  - Pure wall-clock timeout: rejected — cuts off legitimately long-running compilations or test suites.
  - Token budget only: rejected — doesn't detect looping behavior, just limits spend without surfacing the root cause.
- **Consequences**:
  - Eliminates infinite-retry budget burn on container tasks.
  - Provides structured stall reports for diagnosis.
  - Wall-clock timeouts remain as a last-resort backstop (configurable, default 30 min per task).

---

## ADR-059: Container Terminal-State Protocol Contract (Hermes Kanban Stop Pattern)

- **Date**: 2026-09-19
- **Status**: Accepted
- **Context**: Hermes's kanban dispatcher enforces that every worker agent must end its execution by calling a terminal board tool (`kanban_complete`, `kanban_request_review`, `kanban_block`, or `kanban_request_changes`). A worker that exits with rc=0 but without a terminal call is a **protocol violation** — the card is left in `running` state, confusing the dispatcher. Hermes injects up to 2 synthetic nudges before auto-blocking the task. This is directly analogous to Graywolf's requirement that every Dev-Level-3 container run must produce an explicit terminal status update before exiting.
- **Decision**: Enforce a **Terminal-State Protocol Contract** for all Dev-Level-3 container executions:
  - **Required terminal events** (must fire before container exit):
    - `task.status = "patch_ready"` + `result.json` written to shared worktree path.
    - `task.status = "blocked"` + `block_reason` explanation.
    - `task.status = "stall_escalated"` (auto-set by stall guardrail, ADR-058).
  - **Protocol Violation Detection**: The container supervisor (Valkey-backed process monitor) watches for `container_exit` events. If a container exits with rc=0 but no terminal status event was posted within the task's worktree:
    - **Nudge 1** (synthetic re-entry): Re-open the container session with a system injection: _"You exited without completing the protocol. The task has no patch or status update. Write your result now or call block."_ Max 2 nudge attempts.
    - **After 2 failed nudges**: Mark task as `protocol_violation`, increment Two-Strike counter, escalate to human.
  - **Worktree Status File**: Each container run writes to `<worktree>/.agent_status.json`:
    ```json
    { "status": "patch_ready" | "blocked" | "needs_clarification",
      "summary": "...",
      "artifacts": ["path/to/file.diff"],
      "exit_reason": "..." }
    ```
  - **Non-Committing Relay**: The relay contract (ADR-018) is extended to also verify the `.agent_status.json` exists before treating the relay as a success. A relay with no status file is a `protocol_violation`.
- **Source**: Architecture pattern derived from MIT-licensed Hermes Agent (`agent/kanban_stop.py`, `cron/AGENTS.md` kanban dispatch hardening rules).
- **Alternatives Considered**:
  - Trust-based contract (agents are expected to always write status): rejected — models narrate intent and stop, producing clean exits without completing the protocol.
  - Exit-code-only protocol: rejected — rc=0 is ambiguous between "success" and "clean shutdown without work done."
- **Consequences**:
  - Zero orphaned `running` tasks in the queue.
  - Protocol violations are caught automatically, not discovered by the operator when manually inspecting task state.
  - The dispatcher can safely reclaim worktrees and trigger the next stage without manual intervention.

---

## ADR-060: Context Compression via Auxiliary Model for Long Tasks (Hermes Compressor Pattern)

- **Date**: 2026-09-19
- **Status**: Accepted
- **Context**: Graywolf Squad tasks routinely involve multi-file refactors, long debugging sessions, and extensive tool-call chains that push against LLM context window limits. Simply failing when the context fills up is unacceptable for multi-hour tasks. Hermes Agent (`agent/context_compressor.py`) implements a battle-tested context compression strategy: a **cheap auxiliary model** summarizes the middle of the conversation while protecting the system prompt (head) and recent turns (tail) from modification. It includes deterministic fallbacks when the auxiliary model stalls.
- **Decision**: Implement **Auxiliary Context Compression** for Dev-Level-3 container sessions:
  - **Trigger**: When estimated token usage for the next API call exceeds 80% of the active model's context window.
  - **Compression Strategy (Hermes-faithful)**:
    - **Protected Head**: System prompt + task brief (`brief.txt`) + first 2 turns — NEVER summarized.
    - **Protected Tail**: Last 8 turns (4 user+assistant pairs) — NEVER summarized. Ensures recent tool results and corrections are always fully visible.
    - **Compressible Middle**: All turns between head and tail are candidates for summarization.
  - **Auxiliary Model Call**: A fast/cheap model (e.g., Gemini Flash Lite or Haiku via LiteLLM, routed as `auxiliary.compression`) receives the middle turns and produces a dense summary message injected as a single synthetic `user`-role message: `[Context summary — earlier turns compressed to stay within context window. Full history available in session store. Summary: ...]`.
  - **Cache Preservation**: Compression is the ONE permitted exception to the prompt-cache stability principle (ADR-061). The new summarized context invalidates the KV cache, but the alternative (task failure) is worse. The system prompt itself is never mutated — only the message history.
  - **Deterministic Fallback**: If the auxiliary model stalls or fails, use a deterministic heuristic summary (last tool call names + first 200 chars of each turn) rather than failing the compression attempt.
  - **Duty Cycle**: Compression runs in chunks (not one blocking operation) to avoid holding the write lock for extended periods on large sessions.
  - **Compressed History Storage**: Full uncompressed history is stored in the PostgreSQL session store (ADR per hermes_state pattern). The compressed view is the active working memory for the container. Dev-Level-2 and the operator always have access to the full history.
- **Source**: Pattern adapted from MIT-licensed Hermes Agent (`agent/context_compressor.py`, `agent/conversation_compression.py`). Chunk-based compression and duty-cycle rate limiting from Hermes `_FTS_REBUILD_DUTY_FACTOR` pattern.
- **Alternatives Considered**:
  - Hard context limit with task failure: rejected — unacceptable for multi-hour tasks.
  - Sliding window (drop oldest turns): rejected — loses tool result context needed for coherent continuation.
  - Full main-model self-compression: rejected — expensive and slow; a cheap auxiliary model provides 80% of quality at 5% of the cost.
- **Consequences**:
  - Tasks can run indefinitely regardless of context window size.
  - A cheap model handles compression, keeping cost impact minimal.
  - Full audit trail always available in the session store.

---

## ADR-061: Prompt Cache Stability Principle (Hermes Cache Invariant)

- **Date**: 2026-09-19
- **Status**: Accepted
- **Context**: Hermes Agent treats prompt caching as sacred: "Per-conversation prompt caching is sacred. A long-lived conversation reuses a cached prefix every turn. Anything that mutates past context, swaps toolsets, reloads memories, or rebuilds the system prompt mid-conversation invalidates that cache and multiplies the user's cost." For Graywolf Squad, each container session has a system prompt assembled at session start containing the task brief, project context, active skills, and tool definitions. Re-assembling this mid-session (e.g., to add a newly discovered skill or updated memory) destroys KV cache coherence and doubles or triples LLM call cost.
- **Decision**: Enforce **Prompt Cache Stability** as a hard architectural constraint for Dev-Level-3 container sessions:
  - **System Prompt is Immutable After Session Start**: The system prompt (`brief.txt` + project context + injected skills + tool definitions) is assembled once when the container boots. It MUST remain byte-for-byte identical for the lifetime of the session.
  - **One Exception**: Context compression (ADR-060) is the only permitted mid-session context mutation. All other mutations are deferred.
  - **Deferred Tool/Skill Changes**: If new skills are discovered or anti-patterns updated mid-task, they are queued and injected at the START of the next task session, not the current one. The pattern is `--now` opt-in only (analogous to Hermes `/skills install --now`).
  - **Toolset Stability**: The set of tools available to Dev-Level-3 is fixed at session start. A tool cannot be added or removed mid-session.
  - **Relay Contract Alignment**: The relay contract (ADR-018/ADR-054) must pre-assemble the full `brief.txt` before container launch. Incremental context additions mid-session are forbidden.
  - **Implementation Enforcement**: The container supervisor validates that the system prompt hash at turn N equals the hash at turn 0 (excluding only the compressed context segment if ADR-060 compression has fired).
- **Source**: Principle directly from MIT-licensed Hermes Agent root `AGENTS.md`: "Per-conversation prompt caching is sacred." Implementation patterns from `agent/prompt_cache_scope.py`, `agent/prompt_cache_boundary.py`.
- **Alternatives Considered**:
  - Dynamic context injection (add skills mid-session): rejected — multiplies LLM cost due to cache invalidation.
  - Session restart for each new context: rejected — loses tool-call chain continuity.
- **Consequences**:
  - LLM costs remain stable and predictable across multi-turn task sessions.
  - Container sessions are cache-warm from turn 2 onward, dramatically reducing per-turn latency.
  - Forces disciplined pre-task context assembly (which also improves task brief quality).

---

## ADR-062: Verification Evidence Ledger (Hermes Verification Pattern)

- **Date**: 2026-09-19
- **Status**: Accepted
- **Context**: Dev-Level-3 agents self-report that tests pass, builds succeed, and linters are clean. Dev-Level-2 reviewers currently have no way to independently verify these claims — they can only read the agent's text output and the patch diff. The Hermes Agent (`agent/verification_evidence.py`) implements a **passive evidence ledger**: every test, lint, typecheck, and build command is recorded with its exit code, command string, scope, and output summary. It never blocks completion — it just accumulates verifiable proof that gets cross-referenced during review.
- **Decision**: Implement a **Verification Evidence Ledger** stored in the container's worktree:
  - **What is recorded** (passively, on every terminal command in the container):
    - Command string (canonical form)
    - Command kind: `test`, `lint`, `typecheck`, `build`, `format`
    - Exit code
    - Scope: `targeted` (specific file/function), `suite` (full test suite), `repo` (everything)
    - Output summary: first 2000 chars of stdout/stderr
    - Timestamp
    - Session ID + worktree path
  - **Storage**: SQLite file at `<worktree>/.agent_evidence.db`. Schema: `verification_events`, `verification_state` tables (directly adapted from Hermes schema).
  - **Dev-Level-2 Integration**: The 3-pass adversarial debate (ADR-056) gains access to the evidence ledger. Findings of type `tests`, `build`, or `standards` MUST cite a matching evidence event:
    - `agreed P0/P1` finding claiming "tests fail" must have a matching failing `test` event in the ledger.
    - If no evidence event exists, the finding is automatically downgraded to P2 (advisory) with a note: "No verification evidence found; claim is unverifiable from the diff alone."
  - **Passive by Design**: The ledger never blocks task completion, never fails a task, and never runs commands on its own. It only records what the agent already ran.
  - **Retention**: Evidence events older than 30 days are purged. Max 100 events per session root. Max 10,000 total unreferenced events.
- **Source**: Schema and design directly adapted from MIT-licensed Hermes Agent (`agent/verification_evidence.py`). Retention limits and purge policy from Hermes constants `_MAX_EVIDENCE_AGE_DAYS = 30`, `_MAX_EVENTS_PER_SESSION_ROOT = 100`.
- **Alternatives Considered**:
  - Trust agent self-reporting: rejected — known attack surface for hallucinated test results.
  - Run verification commands independently in Dev-Level-2 review: rejected — reviewer should review, not re-execute (costly and creates environment dependency).
- **Consequences**:
  - Dev-Level-2 review findings are grounded in actual evidence, not agent claims.
  - Automatically downgrades unverifiable findings, reducing false-positive strikes.
  - Zero overhead on the agent loop — evidence capture is a passive tap on the terminal tool.

---

## ADR-063: Skill Curator — Autonomous Skill Library Maintenance (Hermes Curator Pattern)

- **Date**: 2026-09-19
- **Status**: Accepted
- **Context**: As the background learning loop (ADR-057) generates skills, the `.agents/skills/` directory will grow. Without periodic maintenance, it accumulates: stale skills that describe approaches no longer used, redundant skills covering the same class with slightly different names, and orphaned skills created from one-off tasks. The Hermes Agent (`agent/curator.py`) has a background "Curator" that runs on an inactivity trigger, performing lifecycle transitions on agent-managed skills without ever touching user-created or pinned skills.
- **Decision**: Implement a **Skill Curator** as a weekly BullMQ cron job:
  - **Scope**: Only operates on `agent-created` skills (from ADR-057 background reflection). Never touches `user-created` or `pinned` skills.
  - **Lifecycle Transitions** (deterministic, no LLM required for basic runs):
    - `active` → `stale`: skill not used in last 14 days.
    - `stale` → `archived`: skill not used in last 30 days. Archived skills are moved to `.agents/skills/.archive/` (not deleted — recoverable).
    - `archived` → `deleted`: skill archived for 90+ days with zero usage. Requires explicit operator approval before deletion.
  - **Pinning**: Operators can pin any skill via `graywolf curator pin <skill-name>`. Pinned skills bypass all automatic transitions.
  - **LLM Consolidation Pass** (opt-in, default off): When `curator.consolidate = true`, an auxiliary LLM call scans the skill library and identifies:
    - Overlapping skills covering the same class of task.
    - Skills that are too narrow (created from a single task) and should be merged into an umbrella.
    - Skills with references files that duplicate content from another skill.
    - Produces a consolidation proposal as a markdown diff. Human approval required before applying.
  - **Curator State**: Persisted in `.agents/skills/.curator_state.json`: `last_run_at`, `last_run_summary`, `run_count`, `paused`.
  - **Audit Trail**: All curator actions (stale/archive transitions, consolidation proposals) are written to the operator's notification feed and task history.
- **Source**: Architecture adapted from MIT-licensed Hermes Agent (`agent/curator.py`, `tools/skill_usage.py`). Default thresholds (`stale_after_days = 14`, `archive_after_days = 30`) from Hermes defaults.
- **Alternatives Considered**:
  - Manual-only skill maintenance: rejected — skill library becomes unusably bloated within weeks.
  - Automatic deletion: rejected — irreversible data loss. Archive-only approach preserves recovery options.
- **Consequences**:
  - Skill library quality degrades gracefully rather than silently bloating.
  - Operator maintains full control via pinning and approval gates.
  - Consolidation remains opt-in to avoid unwanted autonomous rewrites.

---

## ADR-064: Trajectory Compression for Fine-Tuning Dataset Generation (Hermes Research Pattern)

- **Date**: 2026-09-19
- **Status**: Accepted (Long-term / Phase 3)
- **Context**: Every task the Graywolf Squad completes produces a trajectory: a sequence of (system prompt → tool calls → tool results → final patch). These trajectories represent high-quality, real-world coding agent behavior in the user's specific codebase. The Hermes Agent (`trajectory_compressor.py`) has a production pipeline for post-processing agent trajectories into compressed training data suitable for fine-tuning next-generation tool-calling models, using a protect-head / protect-tail / summarize-middle strategy.
- **Decision**: Adopt the Hermes trajectory compression pipeline as a **Phase 3 feature** for generating a proprietary fine-tuning dataset:
  - **Eligible Trajectories**: Only tasks that completed successfully AND passed Dev-Level-2 adversarial review without any `agreed P0/P1` findings. These are the highest-quality examples.
  - **Compression Strategy** (Hermes-faithful):
    - Protect head: system prompt + initial task brief + first assistant turn.
    - Protect tail: last N turns (configurable, default last 4 turns).
    - Summarize middle: auxiliary model compresses older tool-call sequences into a compact narration.
    - Output: JSONL trajectory file per task.
  - **Dataset Format**: OpenAI-compatible chat completion format with tool calls, suitable for fine-tuning on any major provider.
  - **Privacy Gate**: Before any trajectory enters the dataset, run a redaction pass to strip file paths, credentials, project-specific names, and any content tagged as sensitive in the project's `.agents/config.yaml`.
  - **Operator Opt-In Only**: Trajectory collection is disabled by default. Must be explicitly enabled per-project with `dataset.collect = true`. No trajectories are collected or stored without this setting.
  - **Storage**: Trajectories stored in `.agents/dataset/trajectories/YYYY-MM/` as compressed JSONL. Monthly rotation. Operator-controlled retention.
- **Source**: Pipeline architecture adapted from MIT-licensed Hermes Agent (`trajectory_compressor.py`). Protect-head / protect-tail / summarize-middle strategy is a direct port of Hermes compression logic.
- **Alternatives Considered**:
  - Use raw uncompressed trajectories: rejected — too large for practical fine-tuning datasets; context window exceeds most training pipelines.
  - Collect all trajectories regardless of outcome: rejected — failed trajectories introduce negative training signal without proper filtering.
  - Phase 3 enables users to fine-tune smaller, cheaper models on their own codebase patterns, reducing per-task LLM cost dramatically over time.
  - Privacy gate ensures no proprietary code leaves the project without explicit consent.
  - Dataset is immediately compatible with major fine-tuning pipelines (OpenAI, Together, Fireworks).

---

## ADR-065: Vercel AI SDK for Chat Cockpit Streaming (Direct Adopt) + Mastra Storage Patterns (Pattern Reference)

- **Date**: 2026-09-21
- **Status**: Accepted (amended 2026-09-21)
- **Context**: The Chat Cockpit (§3, ADR-053) requires robust, production-grade LLM token streaming from Fastify to the React frontend via `assistant-ui`. Building a custom SSE parser from scratch introduces boilerplate, reconnect-logic fragility, and backpressure edge cases. **Vercel AI SDK** solves this with minimal, provider-agnostic TypeScript plumbing. **Mastra** (`@mastra/core`) was initially assessed for workflow/memory adoption — but is architecturally in the same category as LangGraph (a full agent orchestration framework with its own workflow engine, memory primitives, and agent-loop abstractions) and carries the same risks: it has no knowledge of the ARP WebSocket contract, the Docker sandbox lifecycle, the blast-radius file interceptors, or RLS tenancy. Wholesale adoption risks quietly re-introducing the orchestration-layer conflict ADR-069 was written to avoid, just because it happens to be TypeScript. See ADR-052 §Mastra Evaluation for the constrained assessment.
- **Decision**:
  - **Vercel AI SDK** (`ai` npm package, Apache-2.0): **Directly adopted** as the streaming transport layer:
    - `streamText()` + `toDataStreamResponse()` from Fastify route handlers; `assistant-ui` consumes natively — no custom SSE parser.
    - Built-in `tool()` helper with Zod schemas for Chat Cockpit tool calls (`create_task`, `reorder_backlog`, etc.), eliminating manual argument parsing.
    - **No lock-in**: Provider-agnostic via LiteLLM's OpenAI-compatible endpoint. LiteLLM gateway (ADR-006) is unchanged; the SDK is purely a streaming abstraction over it.
  - **Mastra**: **Pattern reference only** — same disposition as LangGraph (ADR-069). Evaluate specific, bounded sub-components (e.g., storage adapter interface patterns for conversation history) in isolation. Do NOT adopt its workflow engine, agent-loop abstractions, or memory primitives wholesale. Any specific piece worth lifting must be evaluated against the ARP contract, sandbox lifecycle, and RLS boundary before adoption. See ADR-052 §Mastra Evaluation.
- **Scope Boundary**: Vercel AI SDK operates exclusively in the Fastify control plane + React frontend layer. It is never used inside the ephemeral Dev-Level-3 container. Container internals remain governed by the relay contract (ADR-018/ADR-054).
- **Alternatives Considered**:
  - Custom SSE parser + raw `fetch` streaming: rejected — significant maintenance burden.
  - tRPC subscriptions for streaming: rejected — incompatible with `assistant-ui` protocol.
  - Mastra as full workflow engine: rejected — see context above and ADR-052 §Mastra Evaluation.
- **Consequences**:
  - Chat Cockpit streaming goes from a custom build to a ~50-line integration.
  - Mastra is held at arm's length as a reference; no orchestration-layer coupling introduced.
  - Full provider flexibility maintained — LiteLLM gateway unchanged.

---

## ADR-066: Generation-Time Schema Validation on ACI Boundaries (Pydantic AI Pattern → TypeBox + Zod)

- **Date**: 2026-09-21
- **Status**: Accepted
- **Context**: LLM-generated outputs are probabilistically structured — models hallucinate field names, emit wrong types, omit required fields, and produce subtly malformed JSON. Without validation at the point of generation, bad data propagates through the system: `handoff.json` with missing fields causes silent relay failures; `result.json` with malformed artifact paths causes downstream crashes. Pydantic AI (S-Tier) solves this with **generation-time validation**: the LLM output is validated against a strict schema immediately after generation, and if it fails, the model is forced to self-correct before the data enters the system. Because Graywolf is TypeScript/Node, Pydantic itself cannot be adopted, but the **exact validation pattern** must be implemented using TypeScript-native tools.
- **Decision**: Enforce **Generation-Time Validation** at all Agent-Computer Interface (ACI) boundaries using **TypeBox** (Fastify-native) and **Zod** (relay + tool call layer):
  - **ACI Boundary 1 — Tool Call Arguments**: Every Chat Cockpit tool call (`create_task`, `reorder_backlog`, etc.) is defined with a Zod schema via Vercel AI SDK's `tool()` helper. The SDK validates arguments before the tool handler executes. Invalid arguments cause a structured error returned to the model for self-correction — the tool handler never runs with bad input.
  - **ACI Boundary 2 — `handoff.json` (Dev-Level-1 → Dev-Level-3)**: Typed as a TypeBox schema validated by Fastify's `ajv` integration before the brief is written to the worktree. Rejection causes a structured planning error with specific field-level violations — Dev-Level-1 must produce a valid handoff or the task never reaches the container.
  - **ACI Boundary 3 — `result.json` / `.agent_status.json` (Dev-Level-3 → Supervisor)**: The container supervisor validates the status file against a TypeBox schema before accepting the container exit as a valid terminal event (ADR-059). Invalid status files trigger the protocol-violation nudge loop.
  - **ACI Boundary 4 — Review findings (`debate-review.findings.v1`)**: All structured review output (P0/P1/P2 findings, debate responses, final verdicts from ADR-056) are validated against a Zod schema before entering the debate pipeline. Malformed findings are dropped and the reviewer is re-prompted.
  - **Self-Correction Loop**: On validation failure at any ACI boundary, the error is returned as a structured JSON diff: `{ valid: false, errors: [{ path, message, expected, received }] }`. This is injected back into the model's context for a single retry. After 2 consecutive validation failures at the same boundary, the task is marked `VALIDATION_FAILED` and escalated.
  - **No Runtime Trust**: No ACI boundary accepts unvalidated input regardless of the producing model. Trust is structural, not model-based.
- **Source**: Pattern derived from Pydantic AI's generation-time validation philosophy. TypeScript implementation uses TypeBox (JSONSchema-native, Fastify-integrated) and Zod (runtime schema with first-class TypeScript inference). No Python code adopted.
- **Alternatives Considered**:
  - Best-effort JSON.parse + manual field checks: rejected — silent failures on malformed data are the primary risk.
  - JSON Schema validation via `ajv` alone (without self-correction loop): rejected — surfaces errors to operators rather than giving models an opportunity to self-correct.
- **Consequences**:
  - Zero unvalidated LLM output enters the task lifecycle at any stage.
  - Self-correction loops recover from transient model errors without operator intervention.
  - Strict schema contracts serve as machine-readable documentation for all ACI boundaries.

---

## ADR-067: Micro-Kernel Plugin Architecture for relay.mjs Execution Harness (DeepSeek Harness / Cordis Pattern)

- **Date**: 2026-09-21
- **Status**: Accepted
- **Context**: The `relay.mjs` execution harness currently bundles test runners, AST slicers, git barriers, and verification logic into a single runner loop. This creates a monolithic boundary where adding a new test framework, a new language's AST tool, or a new Git provider requires modifying the core runner — increasing blast radius on every change. The DeepSeek Harness (S-Tier) uses the **Cordis micro-kernel** pattern: every capability (models, tools, loops, sandboxes) is a hot-swappable plugin registered against a minimal core. The kernel dispatches events; plugins handle them. The core loop never mutates.
- **Decision**: Refactor the `relay.mjs` execution harness to a **micro-kernel plugin architecture**:
  - **Immutable Core** (`relay-core.mjs`): Only responsible for:
    1. Loading the task brief (`brief.txt`).
    2. Dispatching lifecycle events: `relay:start`, `relay:tool-call`, `relay:tool-result`, `relay:complete`, `relay:error`.
    3. Enforcing the Non-Committing Relay Contract (ADR-018): no `git commit`, `git push`, or nested agent invocations.
    4. Writing `.agent_status.json` on exit (ADR-059).
  - **Plugin Interface**: Each plugin registers event handlers:
    ```typescript
    interface RelayPlugin {
      name: string;
      on: Partial<Record<RelayEvent, (ctx: RelayContext) => Promise<void>>>;
    }
    ```
  - **Plugin Scope — Permitted** (extensible, hot-swappable):
    - `plugin-stall-guard`: Stall detection (ADR-058) — monitors tool-call patterns and injects hard-interrupt signals.
    - `plugin-evidence-ledger`: Verification evidence capture (ADR-062) — taps terminal commands and records to `.agent_evidence.db`.
    - `plugin-ast-slicer`: Language-aware AST scope restriction (TypeScript, Python, Go) — limits file mutation to task-relevant AST nodes.
    - `plugin-schema-validator`: Validates `.agent_status.json` on exit (ADR-066 ACI Boundary 3).
    - Test runners, language toolchains, and any future capability with equivalent extensibility characteristics.
  - **Plugin Scope — EXPLICITLY EXCLUDED (security boundary, not pluggable):**
    > ⚠️ **The git barrier and blast-radius interceptor are NOT plugins and must NEVER be made pluggable.**
    - The git barrier (`EROFS` bind-mount enforcement, ADR-047) and Brownfield blast-radius interceptors (ADR-008) are hardened at the **kernel/filesystem level** — a physical `EROFS` mount constraint, not a software layer. ADR-047 specifically chose this approach *because* a flexible, swappable software barrier is easier to bypass or misconfigure than a mount-level constraint. Making these pluggable would silently downgrade a kernel-enforced guarantee to a software convention that a future contributor could remove without understanding why it was unconditional. Cordis's own maintainers have not security-audited it against this threat model. This carve-out must be documented in `relay-mjs-contract.md` to prevent well-meaning "pluggable everything" refactors from hollowing out the security model.
  - **Plugin Configuration**: Plugins are declared in the task brief's `relay_plugins` array. Missing plugins are an error, not a silent skip. Unrecognized plugins trigger a `relay:error` event.
  - **No Plugin Cross-Contamination**: Plugins share `RelayContext` (read-only task metadata + mutable event bus) but cannot call each other directly.
- **Source**: Micro-kernel/plugin pattern inspired by DeepSeek Harness (Cordis architecture). TypeScript implementation uses a lightweight event emitter; no Cordis library dependency is required.
- **Alternatives Considered**:
  - Monolithic runner with feature flags: rejected — every new capability increases blast radius on the core loop.
  - Full Cordis library adoption: rejected — designed for the Koishi bot ecosystem; not security-audited for this threat model.
  - Making git-barrier pluggable: rejected — degrades a kernel-enforced guarantee to a software convention (see security carve-out above).
- **Consequences**:
  - Adding a new test framework (e.g., Bun test) requires a single new plugin, zero core mutations.
  - Each plugin is independently testable with a mock `RelayContext`.
  - The security-critical git barrier and blast-radius interceptor remain unconditional, mount-level guarantees regardless of plugin configuration.

---

## ADR-068: DSPy-Inspired Prompt Compilation Harness for Model-Portability (Programmatic Prompt Optimization)

- **Date**: 2026-09-21
- **Status**: Accepted (Phase 2 / Internal Tooling)
- **Context**: Graywolf Squad's LiteLLM gateway routes traffic across commercial models (Claude Sonnet, Gemini Pro) and local sovereign models (Qwen-72B, DeepSeek-Coder). System prompts for Dev-Level-1, Dev-Level-3, and Dev-Level-2 are manually engineered against one specific model family. When the routing target changes (e.g., budget reduction pushes traffic from Claude to a local Qwen instance), prompt fragility becomes a major risk: instruction-following behaviors, tool-call formats, and chain-of-thought tendencies differ across model families. DSPy (S-Tier) replaces manual prompt engineering with **programmatic compilation** — defining the task declaratively and letting an optimizer discover the best prompt for the target model via evaluation over a test set.
- **Decision**: Build a **Prompt Compilation Harness** as an internal developer tool (not user-facing), directly inspired by DSPy's philosophy:
  - **Prompt as Code**: Dev-Level-1, Dev-Level-3, and Dev-Level-2 system prompts are stored as **typed modules** in `prompts/` (TypeScript):
    ```typescript
    interface PromptModule {
      name: string;              // e.g. "dev-level-3-implementer"
      signature: string;         // input fields → output fields
      instructions: string;      // current best prompt body
      examples: PromptExample[]; // few-shot examples (input, expected output)
    }
    ```
  - **Evaluation Harness**: A test suite (`prompts/eval/`) defines evaluation tasks with known correct outputs. Each task runs the target module against a configurable model endpoint and scores the result using a structured rubric (e.g., "did the output match the TypeBox schema?", "did the agent correctly call the right tools?", "did the patch compile?").
  - **Compilation Run** (`pnpm prompts:compile --module dev-level-3 --target qwen-72b`): Runs the evaluation harness against the target model and applies a beam-search-inspired optimization loop:
    1. Generate N prompt variants by permuting instruction order, few-shot examples, and explicit constraints.
    2. Evaluate each variant against the test suite.
    3. Select the highest-scoring variant.
    4. Commit the winning prompt as the new `instructions` body for that module + target model.
  - **Per-Model Prompt Registry**: The harness maintains a registry mapping `(module, model_alias)` → `compiled_prompt`. LiteLLM's virtual alias routing automatically selects the right compiled prompt before dispatch.
  - **Trigger**: Compilation is triggered manually by the operator (`pnpm prompts:compile`) or automatically when a new model alias is added to the LiteLLM config and no compiled prompt exists for that alias.
  - **Scope**: Internal developer tooling only. Operators never see prompt internals; the harness is a CI/CD-layer concern.
- **Source**: Philosophy adapted from DSPy (Stanford NLP, MIT). Implementation is a TypeScript-native lightweight harness — no Python dependency, no DSPy library adopted directly.
- **Alternatives Considered**:
  - Manual prompt tuning per model: rejected — O(models × tiers) maintenance burden; prompt drift is invisible.
  - Full DSPy library adoption: rejected — Python-native; incompatible with Graywolf's TypeScript stack.
  - Single universal prompt for all models: rejected — known to produce 30-60% quality degradation on non-primary models.
- **Consequences**:
  - Switching the active model for any tier takes minutes (run compile, commit) rather than days of manual prompt tuning.
  - Prompt quality is measurable and regression-testable.
  - Sovereign/local model support becomes a first-class citizen, not a degraded fallback.

---

## ADR-069: Architectural Validation — Avoided Framework Antipatterns (CrewAI / LangChain / Visual Builders)

- **Date**: 2026-09-21
- **Status**: Accepted (Architectural Guardrail Record)
- **Context**: Multiple high-profile agentic frameworks evaluated against Graywolf's requirements were explicitly ruled out. This ADR records the reasoning to prevent future "why don't we just use X?" regressions.
- **Decision**: The following framework categories are **permanently excluded** from Graywolf Squad's architecture, with rationale:

  **CrewAI / LangChain (Roleplay-Orchestration Frameworks):**
  - These frameworks simulate multi-agent collaboration via chat roleplay between agent personas. State management is emergent (modeled through message passing), not structural. This produces unpredictable state transitions, uncontrolled token replay across agents, and no hard blast-radius enforcement.
  - Graywolf's **sequential Virtual Developer Tiers** (Planner → Implementer → Reviewer, ADR-003) within a single ephemeral container solve the same coordination problem with deterministic state transitions, no cross-agent token replays, and container-level isolation. LangGraph's cyclic graph model independently validates this approach — we achieve equivalent human-in-the-loop controls via the Configurable Gate Policy System (§8, ADR-039) without LangGraph's overhead.
  - **Kept out indefinitely.**

  **Flowise / Langflow / Dify / n8n (Visual Drag-and-Drop Builders):**
  - Visual builders generate configuration graphs rather than code. At enterprise scale, these become unmaintainable "spaghetti" logic with no Git-based diff visibility, no CI/CD integration, and no schema contracts between nodes.
  - Graywolf manages all agent configurations (blast-radius boundaries, skills, task briefs, model routing, gate policies) as **Git-versioned code and JSON contracts**. Every change is a commit, every contract is typed, every boundary is auditable.
  - **Kept out indefinitely.**

  **LangChain (General):**
  - Heavy abstraction over tool calls, prompt chains, and memory that obfuscates the actual LLM interactions. Makes debugging production failures opaque (which layer failed?). Strong version fragility — LangChain breaking changes have repeatedly broken downstream codebases.
  - Graywolf uses direct, typed interfaces at each LLM boundary (Vercel AI SDK for streaming, TypeBox/Zod for validation, ADR-065/ADR-066). Every model interaction is transparent and debuggable.
  - **Kept out indefinitely.**

- **Positive Validation**: These exclusions validate and reinforce:
  - Sequential tier architecture (ADR-003) over roleplay-based multi-agent.
  - Git-versioned configuration over visual builders.
  - Transparent direct LLM interfaces over opaque framework abstractions.
  - Configurable Gate Policy (ADR-039) as the correct human-in-the-loop mechanism.
  - LangGraph's cyclic graph model independently validates our Configurable Gate Policy approach — we achieve equivalent human-in-the-loop control without adopting it.
- **Naming Precision** (corrected 2026-09-21): The B-tier "proprietary agent SDK" category refers specifically to:
  - **OpenAI Agents SDK** (Python-native, proprietary to OpenAI's tool-call protocol)
  - **Google Agent Development Kit (ADK)** (Google Cloud-native, opinionated on Vertex AI)
  - **Anthropic Claude Agents SDK** (Anthropic-native, proprietary to Messages API)
  - These are distinct products; grouping them as "Google AI SDK / OpenAgents" (as appeared in early video-summary notes) is inaccurate and misnames the citation. The rejection rationale is the same for all three: each creates a proprietary golden-cage dependency on the vendor's runtime, preventing model-swap and breaking the LiteLLM gateway pattern.
- **Additional Pattern Notes**:
  - **LlamaIndex**: Not evaluated for adoption. LlamaIndex is purpose-built for generic document RAG at scale. Graywolf's `context-and-memory.md` Layer 3 is purpose-built for *source code* (ripgrep + pgvector + RRF over symbols, definitions, and docstrings — not documents). LlamaIndex solves a different and less specific problem; Graywolf's bespoke approach is more precisely fitted to its actual retrieval workload.
  - **Agno**: Worth noting as secondary validation — its "plain Python objects, no graph-builder ceremony" philosophy validates that minimal-abstraction agent design is an actively favored industry pattern, not a Graywolf idiosyncrasy. Relevant context for the resource-admission-control work targeting constrained hardware (`resource-admission-and-limits.md`). No adoption action required.
- **Consequences**:
  - No future "migrate to LangChain / adopt OpenAI Agents SDK" proposals need extensive re-evaluation — this ADR is the standing record.
  - SDK citations in future docs should use the precise product names above, not category labels.
  - The stack remains debuggable: every LLM call, tool invocation, and state transition is traceable without framework-layer intermediaries.

---

## ADR-070: Layered Prompt Composition Architecture & Prompt-Leakage Defense

- **Date**: 2026-10-04
- **Status**: Accepted
- **Context**: During evaluation of prompt engineering patterns in Basar AI (`reference-opensources/basarai-master`), a critical LLM failure mode was highlighted: models frequently leak internal prompt metadata, system frame labels, or instructional scaffolding into visible user outputs or generated source code when prompt sections lack rigid structural separation. Furthermore, platform identity details must never pollute generated software artifacts.
- **Decision**: Formalize Graywolf's agent prompt construction into a deterministic 5-layer pipeline with explicit structural boundaries and negative leakage instructions:
  1. **Layer 1: Identity & Constitution** (`=== SYSTEM CONTEXT ===`): Model role, core non-negotiables from `.specify/memory/constitution.md`, and execution mode (Greenfield vs. Brownfield).
  2. **Layer 2: Workspace & Blast-Radius Rules** (`=== WORKSPACE RULES ===`): Explicit writable, read-only, and forbidden path boundaries, patch-diff relay constraints, and two-strike rules.
  3. **Layer 3: Domain Skills & Tool Contracts** (`=== ACTIVE SKILLS ===`): Injected tool schemas, CLI contracts, and domain skill cheat sheets.
  4. **Layer 4: Task Brief & Context** (`=== TASK SPECIFICATION ===`): Task objective, user instructions, relevant code context from Layer 3 retrieval (RRF code symbols).
  5. **Layer 5: Output Constraints & Leakage Guardrails** (`=== OUTPUT CONSTRAINTS ===`): Negative directives strictly forbidding reproduction of section headers, internal scaffolding, or platform metadata in generated outputs.
  - **Platform Name Omission**: Generated code, commit messages, and PR diffs must never reference internal platform identifiers (e.g., "Graywolf", "Dev-Level-X", "ARP"). All output must appear as pristine, human-grade engineering artifacts.
  - **Coding Style Mapping**: Project-specific architectural conventions and style guides are mapped to structured prompt directives for Dev-Level-1 rather than loose natural language summaries.
- **Source**: Pattern extracted from Basar AI (`reference-opensources/basarai-master`); idea-level adoption only, no code copied (repository lacks an open source license).
- **Consequences**:
  - Eliminates prompt leakage into user code and PR patches.
  - Enforces uniform prompt construction across all agent runners.
  - Ensures clean separation between system instructions and generated deliverables.

---

## ADR-071: Fine-Grained LLM Content Policy Refusal Handling (`LLM_CONTENT_POLICY`)

- **Date**: 2026-10-04
- **Status**: Accepted
- **Context**: LLM providers commonly return generic HTTP 400 or 422 Bad Request statuses when a user prompt or code snippet triggers provider-side safety or content moderation filters. Standard HTTP client error handlers often misclassify these as malformed client requests or transient failures, triggering useless BullMQ retries and presenting confusing error messages to users.
- **Decision**: Extend Graywolf's error taxonomy (ADR-042) to introduce a dedicated `LLM_CONTENT_POLICY` error code with response body inspection:
  - When the LiteLLM proxy or provider returns HTTP 400 or 422, the gateway inspects the response payload for safety filter triggers (`content_filter`, `safety_ratings`, `blocked`, `policy_violation`).
  - Upon detection, the error is mapped to `LLM_CONTENT_POLICY` and marked as **non-retryable**, immediately aborting task retry loops in BullMQ.
  - Decouple user-facing messaging from raw provider diagnostics: present a clear, actionable explanation in the Chat Cockpit ("The model declined to process this prompt due to content safety policies") while capturing full provider payloads in internal audit logs.
- **Source**: Pattern extracted from Basar AI (`reference-opensources/basarai-master`); idea-level adoption only, no code copied.
- **Consequences**:
  - Prevents retry storms and token waste on non-retryable content policy blocks.
  - Provides clear and honest UX feedback to end users when requests are refused by upstream safety filters.

---

## ADR-072: Three-Valued BYOK API Key Validation Probe

- **Date**: 2026-10-04
- **Status**: Accepted
- **Context**: When enterprise tenants configure Bring-Your-Own-Key (BYOK) credentials for external LLM providers, validation routines typically rely on a binary (valid/invalid) check. Transient network failures, provider rate limits, or upstream outages during onboarding frequently cause valid API keys to be falsely rejected.
- **Decision**: Implement a three-valued validation probe for all BYOK onboarding and LiteLLM circuit-breaker checks:
  1. `valid: true`: Lightweight read-only probe succeeded (e.g., `GET /v1/models?limit=1`).
  2. `valid: false, error`: Definite authentication failure (HTTP 401 Unauthorized or 403 Forbidden with invalid key payload). Key is definitively rejected.
  3. `valid: null, error`: Inconclusive outcome due to network timeout (HTTP 408/504), DNS failure, or upstream provider 5xx downtime during the probe.
  - Inconclusive results never trigger key rejection or deletion; the key is placed in a `pending_verification` state with scheduled background retries.
- **Source**: Pattern extracted from Basar AI (`reference-opensources/basarai-master`); idea-level adoption only, no code copied.
- **Consequences**:
  - Eliminates false-positive key rejections caused by transient upstream degradation.
  - Strengthens tenant onboarding resilience and simplifies LiteLLM credential health diagnostics.

---

## ADR-073: Strict Authentication vs. Infrastructure Service Availability Separation (503 ≠ 401)

- **Date**: 2026-10-04
- **Status**: Accepted
- **Context**: Authentication flows across Graywolf (ARP WebSocket Ticket Granting Token verification, Better-Auth session verification, container relay auth) often validate signatures against upstream JWKS endpoints or central session stores. When the auth service or JWKS endpoint is unreachable or timing out, poorly scoped catch blocks often return HTTP 401 Unauthorized. This tricks client applications and agents into assuming credentials have expired, causing disruptive logout loops and token cache purges.
- **Decision**: Strictly separate credential invalidity from auth infrastructure reachability across all service boundaries:
  - `401 Unauthorized` / `403 Forbidden`: Reserved exclusively for deterministically invalid, expired, or malformed credentials/signatures.
  - `503 Service Unavailable`: Returned whenever the JWKS endpoint, database session store, or identity service is unreachable, times out, or fails internally.
  - Client layers, the Chat Cockpit, and ARP reconnect loops must treat 503 as a transient infrastructure condition (initiating exponential backoff reconnect) rather than invalidating user sessions.
- **Source**: Pattern extracted from Basar AI (`reference-opensources/basarai-master`); idea-level adoption only, no code copied.
- **Consequences**:
  - Eliminates session dropouts and logout loops during transient identity service hiccups.
  - Preserves client-side token caches during upstream outages.

---

## ADR-074: Deterministic Cursor-Based Pagination with Composite Opaque Cursors

- **Date**: 2026-10-04
- **Status**: Accepted
- **Context**: Offset-based pagination (`OFFSET n LIMIT m`) suffers severe performance degradation on large PostgreSQL tables (task logs, execution runs, audit events) and produces duplicate or skipped items when records are inserted or deleted while a user is actively paginating or polling.
- **Decision**: Standardize all paginated REST and RPC list endpoints on cursor-based pagination using composite opaque cursors:
  - **Opaque Cursor**: Base64-encoded composite key of `(created_at, id)`.
  - **Deterministic SQL Pattern**:
    ```sql
    WHERE (created_at < $cursor_ts) OR (created_at = $cursor_ts AND id < $cursor_id)
    ORDER BY created_at DESC, id DESC
    LIMIT $page_size + 1;
    ```
  - **Eager Next-Page Detection**: Fetching `page_size + 1` rows determines `has_next` immediately without executing an expensive `COUNT(*)` query.
  - **Collision Resistance**: The composite `(created_at, id)` key ensures deterministic ordering even when multiple records share identical microsecond timestamps.
- **Source**: Pattern extracted from Basar AI (`reference-opensources/basarai-master`); idea-level adoption only, no code copied.
- **Consequences**:
  - Guarantees $O(1)$ index-backed pagination performance regardless of dataset depth.
  - Prevents drift and duplicate record display in live feeds (Chat Cockpit, Admin UI task lists).

---

## ADR-075: Intent-Based E2E Testing with Deterministic Cache Replay (tester.army/e2e Pattern Adoption)

- **Date**: 2026-10-12
- **Status**: Accepted
- **Context**: ADR-013 established Playwright headless browser testing inside sandbox containers and the 60-Second Executive Review Packet. However, it has two structural weaknesses: (1) Dev-Level-3-generated Playwright tests rely on brittle CSS/XPath selectors that break across cosmetic refactors — a well-documented failure mode for autonomous coding agents, and (2) there is no strategy for test suite token cost on repeat CI runs, where re-executing agent-resolved action sequences wastes significant LLM budget re-reasoning steps already proven correct. The **tester-army/e2e** open-source library (Apache-2.0, TypeScript, TesterArmy GitHub org) addresses both problems with a deterministic cache-replay architecture layered on top of Playwright, making its patterns directly compatible with Graywolf's sandbox model. (Disambiguation: Only the open-source library `tester-army/e2e` is evaluated here; the companion commercial CLI `@tester-army/cli` is a hosted SaaS product requiring a proprietary tester.army API key and cloud account, and is strictly prohibited per ADR-027 Zero Cloud Sync and ADR-040 Egress Filtering).
- **Decision**: Adopt tester-army/e2e's **core patterns and evaluation spike** as the standard for Graywolf-generated E2E tests, following a plugin-isolated spike strategy (ADR-067 / ADR-038):
  1. **Hybrid Intent/Deterministic API & Anti-Self-Grading Split**:
     - Deterministic Playwright locators (`screen.getByRole`, `screen.getByTestId`, `expect`) for stable, structurally anchored assertions.
     - Intent-based agent steps (`agent.act`, `agent.assert`, `agent.waitFor`, `agent.extract`) for multi-step flows, wizards, and UI copy that changes cosmetically.
     - **Deterministic vs. Agent-Judged Assertion Split (Anti-Self-Grading Rule)**: LLM-judged assertions (`agent.assert('...')`) are probabilistic and strictly restricted to qualitative or cosmetic layout checks (e.g., visual presence of banners, toast styles). **Business-critical, financial, calculation, and tax logic** (e.g., invoice sums, tax amounts, line-item totals, balance updates) MUST use exact deterministic `expect()` assertions (e.g., `expect(page.getByTestId('tax-amount')).toHaveText('$14.25')`). Never allow `agent.assert` to evaluate math or business invariants (preventing the self-graded homework antipattern).
     - **Review Packet Gate Counting**: The 60-Second Executive Review Packet must categorize and report deterministic assertions separately from agent-judged assertions. **Only passing deterministic assertions count toward the merge gating threshold**.
     - **Semantic Locator Mandate**: Dev-Level-3 system prompts (ADR-070 Layer 4) MUST instruct the agent to prefer `getByRole('button', { name: 'Save' })` over `$('#save-btn')`. CSS selectors are only permitted when no semantic role/name is available. Exact-name matching is the default; Dev-Level-3 briefs explicitly prohibit generating `getByText('Save')` that would match `'Save as draft'`.
  2. **Deterministic Cache-Replay Lifecycle**:
     - After a passing `agent.act` step is **verified** (subsequent assertion confirms the effect occurred), the resolved DOM action sequence — including the control matched by role, name, testId, and context — is serialized to the task-scoped cache.
     - Cache path: `.agents/tasks/<TASK_ID>/e2e-cache/` (NOT `.e2e/cache/` — this is a task artifact, not a committed workspace file, consistent with ADR-018 Non-Committing Relay).
     - **Project Cache Promotion on Merge**: To allow subsequent tasks and CI to benefit across isolated worktrees, successfully verified cache files are promoted upon task merge into the persistent project cache at `.agents/cache/e2e/` (backed by the project persistent volume, ADR-013/ADR-046). On task container startup, `.agents/cache/e2e/` is mounted read-only into the task worktree.
     - **Zero-Model Replay on Stable Paths**: Replaying cached action sequences bypasses LLM inference entirely, producing zero model token consumption for proven paths (vendor claims of up to 90% savings are treated as rough estimates subject to empirical benchmark during the spike).
     - **CI Cache Read-Only Invariant**: In CI runs, the cache is strictly **read-only**: matching cached steps replay at zero model cost; no new cache entries are written in CI.
     - The cache artifact is bundled into the `.agents/tasks/<TASK_ID>/review/` Review Packet alongside `changes.patch`, so Dev-Level-2 reviewers can distinguish between flows that ran live vs. cache-replayed.
  3. **DOM-Drift Invalidation Fallback & Cache Overwrite Scope**:
     - If a cached selector path fails during replay (element not found, role mismatch), the runner catches the `PlaywrightError` and falls back to a live `agent.act` resolution turn.
     - **Task-Scoped Cache Overwrite**: During interactive task iteration, the fallback turn **overwrites the stale cache entry** in the task-scoped cache (`.agents/tasks/<TASK_ID>/e2e-cache/`).
     - **CI Non-Persistence**: In CI runs, the fallback turn resolves live to determine pass/fail for the build, but does **NOT** persist or mutate the project cache (`.agents/cache/e2e/`), preserving the read-only CI cache invariant.
     - Fallback events are logged as `CACHE_MISS` in the runner telemetry and surface in the cockpit `terminal` tab.
  4. **LiteLLM Proxy Routing for Model-Agnostic E2E**:
     - All `agent.act` / `agent.assert` model calls route through Graywolf's internal LiteLLM proxy (`OPENAI_BASE_URL=http://litellm-proxy:4000`), guaranteeing compliance with ADR-027 Data Residency Profiles. No model-specific SDK dependencies are introduced.
     - For **Topology A (Constrained Hardware — Raspberry Pi 5, ≤8GB RAM)**: E2E agent steps use a bounded decision executor pattern (see ADR-076) backed by a local Ollama model, never a frontier reasoning model.
  5. **Adoption Strategy & Spike-First Evaluation**:
     - Unlike heavy multi-process agent frameworks, `tester-army/e2e` is a focused TypeScript library built directly on Playwright. Rebuilding the entire trace-cache and intent-step execution engine natively in Graywolf from scratch would be significant redundant engineering.
     - However, because `tester-army/e2e` is pre-1.0 and its API may shift, Graywolf adopts a **spike-first approach**: run a spike installing `tester-army/e2e` at an exact pinned version, encapsulated behind the ADR-067 plugin interface inside `.agents/skills/qa/`.
     - If pre-1.0 instability, breaking changes, or unwanted sub-dependencies emerge during the spike, fall back to native pattern extraction without disturbing other subsystems. Network egress allowlists (ADR-040) guarantee that zero cloud sync occurs in either scenario.
  6. **Absolute Prohibitions**:
     - **No tester.army Cloud SaaS sync**: violates Zero Source Code Ingestion (ADR-027). All runs are local-only; `@tester-army/cli` is barred from installation.
     - **No replacing deterministic gates**: `agent.assert` is additive and probabilistic. It never supersedes `ast-grep` linting, `openapi-diff` contract checks (ADR-049), or database migration guards (ADR-013 Tier 2).
     - **No self-grading on financial/business math**: `agent.assert` is banned from checking arithmetic, taxes, or balances; deterministic `expect()` is mandatory.
- **Source**: Patterns and library evaluation from `tester-army/e2e` (Apache-2.0, TesterArmy organization on GitHub, https://github.com/tester-army/e2e, https://e2e.tester.army/docs). Evaluated via an ADR-067 plugin spike with strict zero-cloud egress.
- **Alternatives Considered**:
  - *Raw Playwright only (current state)*: Rejected as insufficient — brittle CSS selector generation by autonomous agents and no cost-reduction strategy for repeated CI test runs.
  - *Pure native reimplementation without evaluation*: Rejected — re-implementing trace caching and intent steps from scratch repeats the DSPy mistake when a lightweight TS library already exists. The spike-first approach balances pragmatic reuse with pre-1.0 isolation.
  - *Vision/Computer-Use models for all browser interactions*: Rejected per ADR-024 — creates kernel OOM panics on 8GB host profiles and bloats token budgets on every turn.
- **Consequences**:
  - Dev-Level-3-generated tests become resilient to cosmetic UI refactors.
  - Repeat CI runs for stable flows cost zero model tokens.
  - Task-scoped cache updates on DOM drift prevent false passes while keeping CI cache strictly read-only.
  - Gating thresholds rely exclusively on deterministic assertions, eliminating LLM self-grading risk on business logic.
  - Full data residency compliance maintained — zero bytes egressed via tester.army cloud.

---

## ADR-076: `e2e explore` Autonomous PR Smoke Gate (Dev-Level-2 Third Pass)

- **Date**: 2026-10-12
- **Status**: Accepted
- **Context**: ADR-056 specifies Dev-Level-2 as a 3-pass adversarial debate (findings → debate → final verdict) operating on the **static** patch diff and ADR-062 evidence ledger. This is thorough for code correctness and specification compliance, but it has a structural blind spot: **dynamic runtime failures** — unhandled API 500 errors, broken navigation paths, flash-of-missing-validation, race-condition UI states — are invisible from the diff and the terminal evidence ledger alone. tester.army/e2e's `e2e explore` mode offers a precise solution: given a goal, the agent drives the app unscriptedly, records findings with severity and repro steps, and reports back — all within a strict budget.
- **Decision**: Add **`e2e explore` as an optional fourth pass in the Dev-Level-2 review cycle**, activated for tasks tagged `ui`, `api-surface`, `mandatory-e2e`, or any task whose `changes.patch` touches frontend routes or API response contracts:
  1. **Trigger Condition**: After the 3-pass debate completes (ADR-056), if the task has a `ui` or `api-surface` tag **and** the Review Packet sandbox has a running preview server (already guaranteed by ADR-013 for these task types), the orchestrator dispatches a bounded `e2e explore` pass.
  2. **Budget Caps (Non-Negotiable)**:
     - `maxTurns: 6` — maximum agent reasoning turns per explore session.
     - `timeoutSeconds: 180` — hard 3-minute wall-clock ceiling.
     - `spendLimitUSD: 0.50` — micro-budget enforced by relay.mjs before dispatching (ADR-037 Spend Ceiling invariant).
  3. **Fleet Lane Configuration**:
     ```jsonc
     // .delegate/config.json — delegate-fleet.v1 schema (ADR-054)
     "qa-explore": {
       "command": "node .agents/skills/qa/explore-runner.mjs",
       "timeout": 180,
       "readOnly": true,
       "maxTurns": 6,
       "spendLimitUSD": 0.50
     }
     ```
  4. **Constrained Hardware Executor (Topology A)**:
     - On Raspberry Pi 5 / ≤8GB RAM profiles (ADR-024), the explore runner uses a **bounded decision executor** — a small classification model (local Ollama, e.g. `qwen2.5:3b`) that picks from a bounded set of UI actions rather than free-form LLM reasoning. This caps RAM usage below 2GB and keeps turn latency under 5 seconds.
     - On Standard Profile (16GB+) and Enterprise Profile (64GB+), a frontier model routed via LiteLLM is permitted.
  5. **Aria-Snapshot & Scoped Subtree Interaction Mandate**:
     - All explore session interactions target the **Playwright aria snapshot** (`locator.ariaSnapshot()` / `page.ariaSnapshot()`, replacing the deprecated legacy `page.accessibility.snapshot()` API) as the primary control surface.
     - **Subtree & Landmark Scoping**: The 2,000-token cap must not truncate real application dashboards (which leads to false "dead end" explore findings). The explore runner scopes the aria snapshot to the active landmark or container (e.g. `page.locator('main').ariaSnapshot()`, `form`, `nav`, or active modal dialog), or paginates landmarks if the view exceeds the token budget.
     - Full-viewport screenshot capture and vision/Computer-Use model interaction are **on-demand only**, triggered by explicit visual regression scenarios (e.g., `screenshot-diff` tool call) — never on every turn.
     - **Untrusted Browser Observation Tagging (ADR-038)**: Page text, aria snapshots, and console logs retrieved from the live application are **untrusted inputs** (vulnerable to prompt injection from user-generated content in the rendered UI). All browser observations passed into explore agent prompts must be enclosed within `<untrusted_browser_observation>` tags per ADR-038 untrusted-content tagging rules before model ingestion.
  6. **Evidence Grounding via ADR-062 Evidence Ledger**:
     - The explore runner passively appends each browser action and HTTP response to `.agent_evidence.db` as a new event kind: **`browser-test`**.
     - `browser-test` events capture: action performed, DOM target (AXTree node), HTTP response status (from Playwright network intercept), console errors, screenshot path (if captured), and finding severity.
     - **Evidence & Repro Requirements for Strikes**: Findings without a matching `browser-test` evidence event cannot count as a Strike against Dev-Level-3; they are downgraded to P2 (advisory). Furthermore, consistent with ADR-078's "No Repro, No Bug" rule, a P0/P1 explore finding can only trigger an authoritative Strike if a minimal repro test confirms the failure **and** the failing behavior is directly attributable to code modified in `changes.patch` (preventing strikes from pre-existing repository defects or external network flakes).
  7. **Executive Review Packet Integration**:
     - Explore findings (structured JSON: severity `P0/P1/P2`, expected vs. observed behavior, repro steps, screenshot) are parsed and embedded into the **60-Second Executive Review Packet** (ADR-014) under a dedicated `## Browser Smoke Test Findings` section.
     - P0 findings (crash/unhandled 500) from the explore pass are treated as equivalent to a P0 `agreed` debate finding — they require human sign-off before PR merge even if the static debate passed.
- **Boundaries**:
  - Explorer runs are **strictly additive** to the 3-pass debate, never replace it.
  - Explorer runs are **never gated as mandatory** for non-UI tasks — only opt-in via tag.
  - Explorer findings are **probabilistic** by nature; they never supersede deterministic `ast-grep` linting, OpenAPI contract checks, or migration guards.
- **Source**: `e2e explore` architecture from tester.army/e2e (Apache-2.0). Budget and evidence grounding patterns are Graywolf-native extensions.
- **Consequences**:
  - Dev-Level-2 catches runtime dynamic failures invisible to static diff analysis.
  - Budget caps guarantee explore passes cost ≤ $0.50 per task regardless of application complexity.
  - All findings are evidence-grounded, preventing unverifiable strike escalations.
  - Topology A hardware is fully supported via the bounded decision executor.

---

## ADR-077: `e2e mcp` Live Browser Session as ACI Tool for Dev-Level-3 Visual Test Authoring

- **Date**: 2026-10-12
- **Status**: Accepted
- **Context**: Dev-Level-3 currently writes Playwright tests by reasoning over code context alone — reading component files, API handlers, and type signatures to infer what the DOM looks like. This produces tests with guessed CSS selectors, incorrect aria roles, and wrong text content, which then fail on first run and consume rework cycles. tester.army/e2e's `e2e mcp` server solves this: it exposes a **live Chromium browser session** to a coding agent through the Model Context Protocol, with tools to observe the running UI, locate elements, take screenshots, and record video — before a single test line is written. This is the exact pattern the OpenHands Agent Canvas `browser` tab in the cockpit (ADR-053) conceptually provides, now made concrete as an MCP tool in the runner container.
- **Decision**: Register `e2e mcp` as an **ACI (Agent-Computer Interface) tool set in `relay.mjs`** for tasks tagged `ui` or `mandatory-e2e`:
  1. **ACI Tool Set (v2 Enhancement, ADR-037 §ACI v2 Enhancements)**:
     - `browser_observe` — Returns the current view's aria snapshot scoped to an active landmark or container (bounded at 2,000 tokens; paginated if necessary; uses Playwright `locator.ariaSnapshot()`). All output is tagged as `<untrusted_browser_observation>` per ADR-038 before being presented to Dev-Level-3.
     - `browser_locate` — Resolves a natural-language element description to a concrete Playwright locator (role + name + testId) using Playwright's built-in accessibility tree traversal without calling an LLM. The resolved locator is returned to Dev-Level-3 to use directly in generated test code.
     - `browser_act` — Executes a single UI action (click, fill, navigate) in the live session. **Origin Restriction**: Navigation is strictly locked to the sandbox preview server origin (e.g., `http://localhost:<preview_port>`); attempts to navigate to external URLs or cloud endpoints are immediately blocked by relay.mjs to prevent SSRF and token exfiltration.
     - `browser_screenshot` — Captures a masked screenshot (credentials redacted per ADR-055 pattern) and appends to the task evidence ledger as a `browser-test` event.
     - `browser_video_start` / `browser_video_stop` — Records a WebM interaction trace, stored as a task artifact at `.agents/tasks/<TASK_ID>/review/browser-trace.webm`.
  2. **Dev-Level-3 Workflow for UI Tasks**:
     - Before writing any test code, Dev-Level-3 uses `browser_observe` and `browser_locate` to inspect the running preview server and resolve exact Playwright locators for all interactive elements.
     - After writing tests, Dev-Level-3 runs them inside the container (using `bash_execute` per ACI v1 contract) and uses `browser_screenshot` on failure to capture the actual failing state.
     - Generated test code uses **only** the locators returned by `browser_locate` — never hand-crafted CSS.
  3. **Session Isolation**:
     - Each task container runs its own isolated Chromium instance (no cross-container browser state). This is a consequence of the three-tier Docker network segmentation (ADR-040) — containers cannot share browser sessions.
     - Multiple concurrent task containers on Enterprise Profile (≤8 containers, ADR-024) can run independent browser sessions simultaneously without port conflicts, because each Chromium process is bound to the container's loopback interface.
  4. **No-Model Path**:
     - `browser_locate` and `browser_observe` do not call any LLM. Locator resolution uses Playwright's built-in aria tree traversal. This is safe for Topology A constrained hardware — no memory overhead beyond the Chromium process.
  5. **Resource Gate (ADR-024 Constrained Hardware)**:
     - On Constrained Profile (≤8GB RAM): `e2e mcp` browser sessions are only permitted for tasks tagged `mandatory-e2e`. For non-mandatory UI tasks, the ACI tool falls back to code-only test generation without a live session.
     - Docker memory cgroup limit for the browser process: 512MB additional headroom allocated within the 2GB container ceiling.
- **Source**: `e2e mcp` MCP server architecture from tester.army/e2e (Apache-2.0). ACI tool integration and session isolation strategy are Graywolf-native extensions.
- **Alternatives Considered**:
  - *Playwright `codegen` CLI*: Generates brittle CSS selectors from manual interaction recording; not suitable for autonomous agent authoring.
  - *Full vision/Computer-Use model for every turn*: Rejected per ADR-024 (OOM risk on 8GB host, excessive token cost per turn).
- **Consequences**:
  - Dev-Level-3 writes tests grounded in observed DOM structure rather than guessed selectors.
  - Browser trace WebM recordings augment the Executive Review Packet with undeniable visual proof.
  - `browser_locate` eliminates the most common cause of first-run test failures in autonomous test generation.
  - Preview origin locking and untrusted content tagging eliminate SSRF and prompt injection vectors through the browser session.

---

## ADR-078: Parallel Bug Bash Sprint Pattern (e2e explore Multi-Lane Fan-Out)

- **Date**: 2026-10-12
- **Status**: Accepted
- **Context**: Software releases accumulate known-unknown failure modes across multiple functional areas simultaneously — authentication, checkout, onboarding, API error handling — that are impractical to cover with a single linear test pass. tester.army/e2e's **bug bash** pattern addresses this: a coding agent fans out N parallel `e2e explore` runs, one per functional area and user persona, then reproduces every finding with a failing regression test. A finding is only confirmed as a real bug when its repro test fails for the reported reason. This pattern maps naturally onto Graywolf's existing task DAG fan-out architecture (ADR-003, ADR-054) and the Chat Cockpit's tool-calling authority (ADR-004).
- **Decision**: Implement a **Bug Bash Sprint** as a first-class Graywolf task type with the following lifecycle:
  1. **Task Type**: `bug-bash-sprint`
     - Created via Chat Cockpit (`create_task type=bug-bash-sprint areas="checkout,auth,onboarding" personas="first-time buyer,returning user"`) or from the Kanban board.
     - The orchestrator spawns **one `qa-explore-<area>` child subtask per (area × persona) combination**, up to a configurable maximum (`maxExplorers: 8` on Enterprise Profile; `maxExplorers: 1` on Constrained Profile per ADR-024).
     - Child tasks are dispatched in parallel via the `qa-explore` fleet lane (ADR-076) — all subject to the same budget caps (`maxTurns: 6`, `timeoutSeconds: 180`, `spendLimitUSD: 0.50` per child).
  2. **Confirmation Protocol — "No Repro, No Bug"**:
     - A finding from a child explore task is classified as `CANDIDATE` until confirmed.
     - Confirmation requires a **`qa-repro-<issue>`** child subtask: Dev-Level-3 writes a minimal failing test that reproduces the finding. The finding is promoted to `CONFIRMED` only when the repro test fails **for the reported reason** (matching error message or screenshot diff).
     - Findings where the repro test passes are reclassified as `UNCONFIRMED` and downgraded to P2 advisory.
     - This prevents false positives from exploratory hallucinations or flaky UI states.
  3. **Automatic Backlog Promotion**:
     - Every `CONFIRMED` finding automatically generates a `fix:<issue-title>` task in the project backlog, with: the repro test as the acceptance criterion, the severity from the explore finding, and the failing `qa-repro` test attached as a child dependency (`blockedBy: fix:<issue>`).
     - The `fix:` task cannot be marked complete until its child `qa-repro` test passes.
  4. **Chat Cockpit Integration**:
     - The Chat Agent (ADR-004) can query: `"what did the bug bash find in checkout?"` → returns a structured summary of confirmed vs. candidate findings.
     - The Chat Agent can: `"dismiss all P2 findings in onboarding"`, `"promote finding #3 to P0"`, `"cancel the auth explore"` — all via existing task tool-calling authority.
  5. **Budget Governor**:
     - The parent `bug-bash-sprint` task has a hard aggregate spend cap: `totalSpendLimitUSD = maxExplorers × 0.50` (e.g., 8 explorers = $4.00 max).
     - The orchestrator monitors real-time aggregate spend across all child tasks and cancels remaining children if the aggregate cap is reached.
     - Spend is reported live in the cockpit `usage` tab.
  6. **Evidence Requirements**:
     - All confirmed findings must have matching `browser-test` evidence events in `.agent_evidence.db` (ADR-062). Findings without evidence are not promoted to the backlog.
     - The `qa-repro` repro test result is itself recorded as a `browser-test` evidence event and attached to the `fix:` task's Review Packet.
- **Source**: Bug bash pattern from tester.army/e2e (Apache-2.0, https://e2e.tester.army/docs/bug-bash.md). Task fan-out and DAG integration are Graywolf-native.
- **Alternatives Considered**:
  - *Manual QA sprints*: Time-intensive, inconsistent coverage, no machine-readable findings.
  - *Single linear explore pass*: Cannot achieve multi-area coverage within a 3-minute budget ceiling.
- **Consequences**:
  - Entire product areas can be autonomously stress-tested before a release sprint.
  - "No repro, no bug" protocol eliminates false positive backlog bloat from LLM hallucinations.
  - Confirmed bugs enter the backlog with repro tests as acceptance criteria — zero ambiguity in definition-of-done.
  - Budget governor guarantees predictable, bounded QA sprint cost regardless of codebase complexity.

---

## ADR-079: System-One Decision Model (Jev Pattern) as Synchronous Classification & Routing Gate

- **Date**: 2026-10-12
- **Status**: Accepted
- **Context**: Graywolf's orchestrator makes several categorically different types of decisions in the hot path before expensive operations: *"Does this task need an isolated DB sandbox or a mock?"*, *"Does this diff require human review or can it auto-approve?"*, *"Is this relay tool call safe to forward to the bash executor?"*. Currently, all such decisions fall through to full frontier LLM calls (Dev-Level-1 Planner or the RBAC interceptor). TypeSafe AI's **Jev model** (released September 2026) introduces a new model category — **"System One" discriminative models** — that answers typed questions (choice, score, yes/no) from a provided state in 70–500ms at ~$0.042/M input tokens with **free output** (no autoregressive generation). Independent benchmarks show 46–65% lower latency and 79–83% lower token cost compared to lightweight chat models (e.g., GPT-4o-mini) forced into structured output mode. Critically, the open-weight ecosystem ("OpenJev", SemIf, Laya — built on compact Qwen/MiniCPM variants) enables full local deployment on Graywolf's Topology A (Raspberry Pi 5, 8GB) with zero cloud egress, satisfying ADR-027 Tier 1 Sovereign data residency without the memory overhead of frontier models.
- **Decision**: Introduce a **System-One Decision Layer** in the Fastify Control Plane that executes synchronously *before* tasks enter the expensive Docker execution plane, as well as at specific in-relay gates:

  ### Architecture: The `DecisionGate` Service
  A thin Fastify middleware service (`services/decision-gate.ts`) wraps either the TypeSafe AI Jev HTTP API or a local OpenJev-compatible endpoint behind a unified interface:
  ```ts
  interface DecisionGateResult {
    choice?: string;          // for Choice questions
    score?: 'low' | 'medium' | 'high' | 'critical'; // for Score questions
    answer?: boolean;         // for Yes/No (Noul) questions
    confidence: number;       // 0.0 – 1.0
    latencyMs: number;
  }
  ```
  When `confidence < CONFIDENCE_THRESHOLD` (default: `0.85`), the gate **escalates to a full LLM call** rather than acting on a low-confidence classification. This prevents the gate from introducing hidden failure modes — it degrades gracefully to the existing reasoning path.

  ### Gate 1: Pre-Flight Sandbox Tier Classifier (ADR-013 Tier Selection)
  - **Trigger**: Before provisioning any task container, the orchestrator currently relies on Dev-Level-1 Planner to classify sandbox tier (Tier 0 Mock / Tier 1 Shared / Tier 2 Isolated). This costs ~2,000–5,000 frontier tokens just for tier selection.
  - **Decision Gate Replacement**: Submit the task brief + git diff (if resumption) to the Decision Gate with the question:
    - *Choice*: `["tier-0-mock", "tier-1-shared-db", "tier-2-isolated-db"]`
    - *Score*: `"Blast radius: how broadly does this task touch shared infrastructure?"`
  - **Result Handling**:
    - `tier-0-mock` or `tier-1-shared-db` with `confidence ≥ 0.85` → provision immediately with zero frontier token cost.
    - `tier-2-isolated-db` or `confidence < 0.85` → pass through to Dev-Level-1 Planner for proper reasoning (existing behavior).
  - **Estimated Savings**: 60–80% of tasks are Tier 0 or Tier 1 (docs, UI, API changes without DDL). Each pre-empted planner call saves ~$0.01–0.05 and 3–8 seconds of latency.

  ### Gate 2: Configurable Gate Policy Auto-Router (ADR-007)
  - **Trigger**: After Dev-Level-2 review completes and before opening a PR, the orchestrator must select a gate policy tier (`auto`, `ai-pm`, `human`, `mandatory-human`).
  - **Decision Gate Addition**: Submit the patch diff summary + evidence ledger verdict to the gate with questions:
    - *Score*: `"Risk level of this patch: Low / Medium / High / Critical"`
    - *Noul*: `"Does this change touch authentication, billing, or security-critical paths?"`
    - *Noul*: `"Are all tests passing with `agreed` debate verdict and zero P0/P1 findings?"`
  - **Result Routing**:
    - Score `Low` + both Nouls `false` + `confidence ≥ 0.90` → gate policy auto-promoted to `auto` (skip human gate).
    - Score `High` or `Critical` OR any Noul `true` → gate policy enforced as `mandatory-human` regardless of existing tag.
    - Score `Medium` or `confidence < 0.90` → fallback to tag-configured policy (existing ADR-007 behavior).
  - **Audit Trail**: Every gate decision is logged to `task_gate_decisions` PostgreSQL table with `{ task_id, gate, question, result, confidence, latency_ms, model_backend, timestamp }`. The gate's recommendation is displayed in the 60-Second Executive Review Packet as a risk badge.

  ### Gate 3: relay.mjs Tool-Call Pre-Authorization (ADR-037)
  - **Trigger**: Immediately before `bash_execute` forwards an agent tool-call command to the container's bash process. This gate inspects top-level agent tool invocations only (never nested commands or child processes inside executed scripts/build steps).
  - **Decision Gate Addition**: Submit the command string + agent context to the gate with questions:
    - *Noul*: `"Is this command attempting a destructive operation (rm -rf, DROP TABLE, force-push, secret exfiltration)?"`
    - *Choice*: `["safe-forward", "requires-blast-radius-check", "block-immediately"]`
  - **Result Handling**:
    - `safe-forward` + Noul `false` + `confidence ≥ 0.90` → forward to bash executor (existing path).
    - `requires-blast-radius-check` → synchronously invoke the synchronous `BlastRadiusGuard` (existing interceptor, ADR-037) before executing.
    - `block-immediately` or Noul `true` → reject with `RELAY_DESTRUCTIVE_COMMAND` error (ADR-042), log to evidence ledger.
  - **Critical Constraint**: This gate is **strictly additive and defense-in-depth**. It is not a replacement for the `BlastRadiusGuard` or `git-guard.sh`. Even if the gate incorrectly approves a command (`false negative`), OS-level container isolation, read-only mounts, and the git barrier remain in force. This gate is a **speed bump** that catches obvious attempts before they hit the structural guards.
  - **Latency Profile**: At 70–150ms per gate call, this adds negligible overhead to command execution. The `bash_execute` ACI tool already imposes a PTY start delay; the gate fits within this window.

  ### Gate 4: Two-Strike Loop Fast-Fail Pre-Screen (ADR-056 / ADR-083)
  - **Trigger**: After Dev-Level-3 pushes a revision and before invoking the expensive 3-pass adversarial debate (ADR-056), a cheap pre-screen short-circuits obvious failure modes.
  - **Decision Gate Pre-Screen**: Submit the test failure output summary (first 2,000 chars from evidence ledger) with questions:
    - *Noul*: `"Is this test failure clearly caused by a logic error in the code, not a test environment issue?"`
    - *Choice*: `["logic-error-rework-immediately", "environment-flake-retry", "ambiguous-run-full-debate"]`
  - **Deterministic Guard Passes (ADR-083)**: In parallel with test failure screening, Gate 4 executes two sub-500ms static/AST heuristic passes derived from `amElnagdy/guard-skills`:
    - **`test-guard`**: Scans test files in `changes.patch` for mock abuse (mocking the class under test, zero-assertion tests, or vacuous `toBeDefined()` tautologies).
    - **`clean-code-guard`**: Scans patch for swallowed exceptions (`catch (e) {}` with no logging/rethrow) and dead/commented-out blocks.
  - **Result Handling**:
    - `logic-error-rework-immediately` + `confidence ≥ 0.90` OR deterministic guard violation detected → skip the 3-pass debate and immediately dispatch an accelerated Strike-1 rework brief to Dev-Level-3 (saving the debate model tokens and latency). Records the skipped debate in the audit log with the gate's confidence score or guard rule ID.
    - `environment-flake-retry` → retry the test suite (up to `maxRetries: 2`) before counting a failure.
    - `ambiguous-run-full-debate` or `confidence < 0.90` → run the full 3-pass debate (existing behavior).
  - **Two-Strike Accounting Integrity**: To protect the core principle of ADR-056 (preventing single-model false positives from triggering fatal escalations), a gate fast-fail can only initiate a **Strike-1 rework**. A fatal **Strike-2 escalation** (`INTERNAL_REVIEW_FAILED` requiring human Escalation Decision Memo) is strictly forbidden to originate from the gate alone — Strike-2 requires full independent confirmation by the ADR-056 3-pass adversarial debate (`review-main` vs `review-debate`).

  ### Data Residency & Deployment Topology
  | Topology | Decision Gate Backend | Data Egress |
  |---|---|---|
  | **Topology A (Sovereign / Raspberry Pi 5)** | OpenJev-compatible local model via Ollama (Qwen/MiniCPM fine-tune, ≤4B params, ≤512MB RAM) | 0 bytes |
  | **Topology B (Enterprise Self-Hosted)** | OpenJev local endpoint on private inference server OR TypeSafe AI Jev API via Private VPC | Contractual ZDR |
  | **Topology C (BYOC / Hybrid SaaS)** | TypeSafe AI Jev API (commercial) — classified as ADR-027 Tier 3, requires explicit informed consent badge | Task brief metadata only; no source code |

  The `DecisionGate` service is configurable via `project.config.json`:
  ```jsonc
  "decisionGate": {
    "backend": "local-ollama" | "typesafe-jev-api" | "openjev-server",
    "endpoint": "http://localhost:11434/v1/classify",  // for local
    "confidenceThreshold": 0.85,
    "disabled": false  // escape hatch: set true to bypass all gates
  }
  ```

  ### What Jev Cannot Do in Graywolf (Explicit Exclusions)
  - **Code synthesis**: Cannot write code, generate `plan.md`, produce diff patches, or formulate Escalation Decision Memos. All generative tasks remain with frontier models.
  - **Context-heavy reasoning**: Decision gates receive bounded inputs (brief summary, diff header, command string, test failure summary — never full repository maps or unbounded diffs).
  - **Replacing the adversarial debate (ADR-056)**: Gates are pre-screens and supplemental fast-fails. The 3-pass debate remains mandatory for all `agreed` Strike determinations.
  - **Replacing the BlastRadiusGuard or git-guard.sh**: Structural OS-level guardrails are never optional regardless of gate results.

- **Source**: System-One discriminative model concept from TypeSafe AI Jev (proprietary commercial API, $0.042/M tokens). Open-weight equivalents ("OpenJev", SemIf, Laya) available on HuggingFace for local deployment under permissive licenses — enabling Topology A air-gapped sovereign operation. Idea-level pattern adoption; implementation uses open-weight local alternatives for all non-Topology-C deployments.
- **Alternatives Considered**:
  - *Dedicated rule-based classifiers (hand-crafted regex/heuristics)*: Inflexible to evolving task language; breaks on novel phrasing. Jev/OpenJev handles zero-shot classification without retraining.
  - *Small fine-tuned chat LLMs for routing (e.g., Qwen-0.5B with JSON schema)*: 3–5x higher latency (autoregressive decoding), requires custom training data, and JSON parsing adds failure modes. Decision model architecture is purpose-built to avoid this.
  - *No pre-flight classification (current state)*: Dev-Level-1 Planner burns 2,000–5,000 tokens just to decide sandbox tier. Cumulative waste across 50 tasks/day = $2.50–$12.50/day in unnecessary tier selection calls.
- **Consequences**:
  - Pre-flight sandbox triage cost drops from ~$0.01–0.05 per task to ~$0.0001 per task (400x cost reduction for routine classifications).
  - Gate latency of 70–500ms is imperceptible to operators — tasks feel instantly dispatched.
  - Confidence threshold ensures the gate never degrades correctness: low-confidence decisions always fall back to the existing reasoning path.
  - Topology A (Raspberry Pi 5) can run the local OpenJev decision model alongside the core orchestrator within the 8GB RAM envelope — no new hardware required.
  - Full auditability: every gate decision is recorded with confidence and latency, enabling operators to tune thresholds and detect gate drift over time.

## ADR-080: Pluggable Addon SDK (`@graywolf/addon-sdk`) — Software Factory Signal Ingestion & Cockpit Relay

- **Date**: 2026-10-17
- **Status**: Accepted
- **Deciders**: Lead Developer

### Context

Graywolf's Software Factory vision requires ingesting omni-channel engineering signals (Sentry crash reports, GitHub Issues, Discord community noise) and routing approved work items through external triage and chat cockpits (Discord, Slack, MS Teams). Hard-coding these integrations into the core control plane creates a maintenance monoculture and violates the Brownfield blast-radius principle — any upstream webhook schema change would require a core release.

The core monolith must remain lean. Integrations must be opt-in, isolated, and exchangeable without restarting the orchestrator. The resolution: a **TypeBox-validated Fastify plugin contract** that decouples signal ingestion (`SignalAddon`) from triage relay (`CockpitAddon`) while enforcing zero execution-plane access.

### Decision

Introduce `@graywolf/addon-sdk` as the canonical extension boundary for Software Factory integrations. Addons are loaded as Fastify plugins at startup and interact with the control plane exclusively through a scoped relay object (`GraywolfRelayContext`) — they can never access the worktree executor, `relay.mjs`, or the Docker daemon directly.

#### `SignalAddon` Contract

A `SignalAddon` is a read-only signal ingestion plugin. It receives inbound webhook payloads from external systems and normalizes them into a `GraywolfSignalEnvelope` that the Kanban engine can process.

**Banned implementation patterns** (enforced at SDK type-level):
- `setInterval` / `setTimeout` polling loops inside addon code — addons are passive webhook receivers by default.
- If an integration's upstream API has no webhook support (e.g., a legacy REST-only API), the addon MUST register a repeatable job with the existing BullMQ/Valkey engine (ADR-005) via `relay.scheduleRepeatableJob()`. The addon itself never holds open a Node.js timer.

#### `CockpitAddon` Contract

A `CockpitAddon` is a write-authorized relay channel. It receives normalized task briefs, PR digests, and escalation alerts from the control plane and forwards them to an external human-facing channel (Discord, Slack, MS Teams). It may also receive human responses (emoji reactions, slash commands) and translate them into control-plane intents (approve, reject, escalate).

CockpitAddon authorization is scoped: it may call `relay.postTaskBrief()`, `relay.postEscalation()`, and `relay.receiveHumanIntent()`. It may never call `relay.executeCommand()` or any worktree I/O method.

#### Addon Registry: Two-Tier Trust Model

Inspired by the ADR-046 Sandbox Database Provider and ADR-054 delegate-setup content-hash locking patterns:

| Tier | Source | Trust | Mechanism |
|---|---|---|---|
| **Tier 1 — Official (`@graywolf/*`)** | Bundled monorepo packages | Fully trusted | Cryptographic signature embedded at build time |
| **Tier 2 — Community (GitHub / npm)** | Any public registry | Untrusted until approved | SHA-256 content-hash lock in `.agents/project.config.json` |

When a Lead Developer installs a community addon, Graywolf:
1. Downloads the addon bundle and computes its SHA-256 digest.
2. Prompts for a one-time human sign-off in the Chat Cockpit: *"Community addon `@community/sentry-signal@1.2.3` digest `sha256:abc123…` — approve install? [✅ / ❌]"*
3. Records the approved digest in `.agents/project.config.json` under `"addons": { "contentHashLock": { … } }`.
4. On every subsequent startup, re-computes the bundle digest and **refuses to load** the addon (Fail-Closed) if it does not match the locked hash. An upstream repo mutation without re-approval causes a hard boot failure with a clear error message.

This allows open-source community addon contributions without creating a supply-chain attack surface.

#### Topology A RAM Budget (Raspberry Pi 5 / 8GB)

- **Maximum concurrent addon slots**: 3 `SignalAddon` + 1 `CockpitAddon`.
- Addons are loaded lazily only when their corresponding signal source or cockpit channel is configured in `project.config.json`.
- Fastify webhook receiver mode uses near-zero idle RAM (event-loop only, no polling loops).
- BullMQ-delegated polling jobs count against the existing BullMQ worker slot budget (ADR-005), not addon slots.

#### Shadow Mode & Graduation Lifecycle

Applying the same metric from `review-gates-and-guardrails.md` §7.11 (Guardrail Incubation) to addon graduation:

| Stage | Trigger | Behavior |
|---|---|---|
| **Shadow** | Default for all newly installed addons | Addon generates draft signal briefs and audit log entries but does NOT write to the Kanban board, dispatch BullMQ jobs, or post to any CockpitAddon channel. |
| **Graduated** | ≥ 20 consecutive shadow runs with < 10% human discard rate + explicit `lead_dev` promotion click in Chat Cockpit | Full live behavior enabled. |
| **Deprecated** | Manual `lead_dev` deprecation click or 5+ consecutive human discards after graduation | Addon disabled, shadow audit log archived. |

Shadow mode is not optional for Tier 2 addons — it cannot be skipped via config to prevent accidental Kanban pollution during ecosystem evaluation.

#### Credential Storage

Two-layer credential strategy following existing ADR-018 and ADR-039 precedents:

| Credential Type | Storage | Rationale |
|---|---|---|
| **Active runtime token scoping & rate-limiting** (e.g., in-flight OAuth bearer tokens) | Valkey (ADR-039) | Low-latency lookup, short TTL, purged on logout |
| **Long-lived OAuth refresh tokens & webhook HMAC secrets at rest** | PostgreSQL `secret_vault` table via `pgcrypto` AES-256 envelope encryption (ADR-018) | Survives Valkey flush; never exposed in `pg_dump` plaintext; per-tenant key derivation |

`SignalAddon` implementations must not import `@sentry/node` or any error-emission SDK (these are designed to *emit* errors, not receive inbound webhook payloads). Signal addons receive Sentry data exclusively via Sentry's outbound webhook (HTTP POST), parsed through the TypeBox `GraywolfSignalEnvelope` schema — no Sentry SDK dependency required or permitted.

### What This ADR Explicitly Does Not Cover

- **Execution-plane addons** (addons that can write code, run bash, or push git commits): explicitly forbidden. The `relay.mjs` non-committing relay contract (ADR-037, ADR-042) is not extensible to addons.
- **Addon-to-addon communication**: addons are fully isolated from each other. Cross-addon orchestration must go through the control plane's BullMQ queue.
- **LiteLLM model addons**: model provider integrations remain exclusively within the LiteLLM Proxy layer (ADR-004).

### Alternatives Considered

- *Hard-coding Sentry, Discord, Slack integrations into the core monolith*: Creates a maintenance monoculture. Upstream API schema changes force core releases. Violates Brownfield blast-radius principle.
- *Webhook-only external adapter service (microservice sidecar)*: Operationally complex on Topology A (Pi 5). Requires inter-process communication overhead. The Fastify plugin model achieves the same isolation within the existing process boundary with zero additional infrastructure.
- *Private registry only (no community addons)*: Kills open-source extensibility goal and community flywheel. The two-tier content-hash lock achieves equivalent supply-chain security while preserving openness.

### Consequences

- Core control plane stays lean: all external integration logic lives in addon packages, never in the orchestrator core.
- Community developers can ship Tier 2 addons on GitHub/npm; operators maintain supply-chain integrity via content-hash locking.
- Topology A RAM budget is protected: no polling loops, BullMQ-delegated jobs, hard addon slot cap.
- Shadow mode graduation (20-run / <10% discard / human promotion) prevents accidental Kanban pollution during addon evaluation.
- Long-lived secrets survive Valkey flushes via `secret_vault` AES-256 envelope encryption; active tokens benefit from Valkey's low-latency lookup with short TTL expiry.
- `SignalAddon` packages remain lightweight (no `@sentry/node` SDK dependency) — inbound webhooks are parsed via TypeBox schema only.
- Full addon lifecycle (shadow → graduated → deprecated) is auditable in the Kanban audit log and Chat Cockpit.

## ADR-081: ZadLoop UX & Workflow Pattern Adoption (BiDi Isolation, Access Mode Pill, Maker/Developer Personas, CLI OAuth Bridge)

- **Date**: 2026-10-17
- **Status**: Accepted
- **Deciders**: Lead Developer
- **Source**: ZadLoop desktop coding agent (zadloop.com) by Ahmed Nagdy — creator of the `delegate-skills` and `review-skills` repositories already integrated in ADR-054 and ADR-056. Graywolf does **not** adopt ZadLoop's backend architecture (which mirrors what Graywolf already has); only the four frontend and workflow patterns described below are extracted.

### Context

ZadLoop (an Arabic-First desktop coding agent) reveals four high-value UX patterns that Graywolf can adopt without architectural conflict. Because Graywolf already incorporates ZadLoop's backend engines (`delegate-fleet.v1`, adversarial debate review, and the Cordis micro-kernel concept), this ADR is purely a **product UX and workflow enrichment** — not a backend change.

Graywolf is already designed for MENA/Egyptian use cases (Egyptian 14% VAT + Arabic UTF-8 CSV scenarios in PRD §3.4 and Review Gates §3.2). This makes all four patterns directly relevant.

---

### Pattern 1: Bidirectional (BiDi) RTL/LTR UI & Code-Path Isolation

**Problem**: In standard chat UIs, mixing Arabic/RTL prose with English/LTR code paths (file paths, CLI commands, stack traces) causes broken punctuation, inverted paths (`ts.xat.vat/xat.loot.ces`), and unreadable terminal output. This is a showstopper for MENA operators using Graywolf's Chat Cockpit and Executive Review Packets in Arabic.

**Decision**: Enforce BiDi Isolation across the entire Chat Cockpit, Kanban UI, and generated document artifacts:

**HTML/CSS Layer**:
- All prose paragraphs and chat bubbles use `dir="auto"` to let the browser detect dominant text direction per paragraph.
- All inline `<code>`, file-path badges, CLI command blocks, Xterm.js views, and Monaco DiffEditor use `dir="ltr"` + `unicode-bidi: isolate` unconditionally.
- Keyboard shortcut labels and numeric values are always `dir="ltr"`.

**Generated Document Layer**:
- Dev-Level-1 `plan.md`, `brief.md`, Neutral Arbiter `escalation-memo.md`, and Executive Review Packets **may be synthesized in the operator's configured locale** (`"locale": "ar"` | `"en"` | `"fr"` | `"tr"` in `project.config.json`).
- Code identifiers, symbol names, AST paths, CLI commands, and file paths within those documents MUST always remain in English/LTR — even inside Arabic-locale documents. This is enforced via a document post-processing step that wraps code spans in `<code dir="ltr">` tags before rendering.
- Operator locale defaults to `"en"` and is a per-project setting, not per-workspace-member (locale-per-member is a future Phase 2 feature).

**Xterm.js / Monaco**:
- Xterm.js and Monaco DiffEditor panels are always `dir="ltr"` regardless of document locale.

**ADR-035 Impact**: This refines the WCAG 2.1 AA (ADR-035) implementation to include WCAG 2.1 Success Criterion 1.3.4 (BiDi Text) and aligns with Unicode BiDi Algorithm (UBA) best practices.

---

### Pattern 2: In-Chat "Access Mode" Pill (Plan-Only / Plan-Gated / Full Factory)

**Problem**: Graywolf's autonomy level is governed by `project.config.json` (`gatePolicy`, `requireHumanPlanApproval`). This is correct for persistent governance but requires config file edits to change per-prompt. Operators frequently want to switch modes mid-session ("let me brainstorm first, then execute").

**Decision**: Add a **3-State Access Mode Pill** to the Chat Cockpit input bar (`assistant-ui`) that overrides autonomy behavior for the **current message/task only** (not persistently — config file settings remain the global default):

| Mode | Icon | Behavior |
|---|---|---|
| **Plan / Read-Only** | 🔍 | Forces `--read-only: true` on the dispatch lane. Dev-Level-1 can inspect the repo map, draft `plan.md` / `brief.md`, and discuss architecture, but cannot spawn a write-enabled container. Zero worktree mutations. |
| **Plan-Gate** | ✋ | Equivalent to `requireHumanPlanApproval: true`. Dev-Level-1 runs, pauses, and surfaces `plan.md` in the Cockpit `planner` tab with a one-click **Approve Plan** / **Request Changes** action. Dev-Level-3 executes only after explicit human approval. |
| **Full Factory** | ⚡ | Runs the full Dev-Level-1 → Dev-Level-3 → Dev-Level-2 pipeline autonomously up to the configured PR Review Gate (existing behavior). |

**Per-Message Override Semantics**:
- The pill state is stored in React component state, not persisted to disk or database.
- The selected mode is attached to the task brief as a `accessModeOverride` field, evaluated server-authoritatively by the Fastify orchestrator.
- The orchestrator honors the override for that specific task dispatch only; subsequent tasks revert to the `project.config.json` default.
- **RBAC Constraint**: Only `developer` and `lead_dev` roles can change the Access Mode Pill. `viewer` roles see the pill as read-only display.

---

### Pattern 3: Dual-Persona Onboarding — "Maker View" vs. "Developer View"

**Problem**: Graywolf's Greenfield Mode is powerful but assumes technical fluency (framework selection, ORM choice, CI/CD config). Non-technical Founders, Product Managers, and "Makers" using Graywolf for Greenfield projects encounter unnecessary complexity in onboarding and the live Cockpit.

**Decision**: Introduce a **Persona Selection** step as Step 2 in the Project Onboarding Flow (§7), before Operational Mode Selection:

**Maker View** (activated when operating mode = Greenfield AND persona = `maker`):
- Chat Cockpit default tab layout: **Chat + `browser` (Live Preview) + Progress Checklist**. Technical tabs (`commits`, `terminal`, `files`) are collapsed by default but accessible.
- Pre-Flight Clarification Protocol (§4.3) adapts its question bank: asks non-technical product questions ("Who are the primary users?", "What problem does this solve?", "What's the most important page?") rather than framework/ORM questions.
- Sensible tech defaults are auto-selected from the Constitution baseline (Fastify + Postgres + React + Vite + Tailwind) without prompting the user.
- Kanban columns use simplified labels: **Ideas → Planning → Building → Ready to Review → Live**.
- AST diffs and stack traces in the Executive Review Packet are hidden behind a "Show Technical Details" toggle; only a plain-English summary is shown by default.

**Developer View** (activated when persona = `developer`, or any Brownfield project):
- Full tab layout, full diff viewer, full terminal — existing behavior unchanged.

**Persona Persistence**:
- Persona (`"maker"` | `"developer"`) is stored in `project.config.json` under `"ui": { "persona": "maker" }` and can be changed at any time via a toggle in the Cockpit settings panel.
- Brownfield projects always default to `"developer"` persona (Brownfield requires technical oversight by design).

---

### Pattern 4: CLI Subscription Auth Bridge (Topology A — "Bring Your Own Subscription")

**Problem**: Solo developers in Topology A (Raspberry Pi 5 / local machine) often have existing **Claude Pro/Max** or **ChatGPT Plus** subscriptions. These subscriptions authenticate via CLI OAuth session tokens (not pay-as-you-go API keys) and cannot route through LiteLLM's standard API-key-based proxy. Requiring a separate API key from developers who already pay $20/month for a subscription is unnecessary friction.

**Decision**: In Topology A (Solo Local Mode), allow the **Out-of-Band Secrets Proxy** (ADR-018) to optionally mount authenticated CLI session credentials into the runner sandbox for specific `delegate-fleet.v1` lanes:

**Mechanism**:
- A new `"cliSubscriptionAuth"` block in `project.config.json` (Topology A only) maps delegate-fleet lanes to CLI session providers:
  ```jsonc
  "cliSubscriptionAuth": {
    "enabled": true,        // Only valid in Topology A; rejected silently in Topology B/C
    "lanes": {
      "feature": { "provider": "claude-cli", "credentialKey": "CLAUDE_CLI_SESSION" },
      "tests":   { "provider": "codex-cli",  "credentialKey": "CODEX_CLI_SESSION" }
    }
  }
  ```
- At container spawn time, the orchestrator reads the named credential from `secret_vault` (AES-256, ADR-018) and injects it via environment variable into the runner sandbox — identical to how `RELAY_AUTH_TOKEN` is injected.
- The delegate-fleet runner authenticates to the CLI provider using the stored session token instead of an API key.

**Spend Accounting Under CLI Auth**:
- When a lane uses CLI subscription auth, dollar-based token accounting via LiteLLM is **not applicable** (the token consumption is invisible to Graywolf's proxy).
- In this case, **wall-clock caps (ADR-058)** and **turn-count limits** replace dollar-based `spendLimitUSD` enforcement. The orchestrator enforces the configured `maxTurns` and `wallClockTimeoutMs` for the session regardless.
- `llm_calls` ledger logs the invocation with `cost_usd = null` and `provider = "cli-subscription-{provider}"` for auditability.

**Security Invariants**:
- `cliSubscriptionAuth` is **only valid for Topology A** (local solo developer mode). The orchestrator silently ignores this config block in Topology B/C deployments where multi-user RBAC and Zero Data Retention constraints apply.
- Session credentials are never logged, never included in `llm_calls` plaintext, and are purged from Valkey on session end (same as API keys under ADR-039).
- This does not bypass any existing BlastRadiusGuard, git-guard.sh, or relay.mjs non-committing invariants. The delegate-fleet CLI runner operates inside the same sandboxed worktree with the same structural guarantees.

### What This ADR Does Not Adopt

- **ZadLoop's desktop Electron/Tauri application shell**: Graywolf's Docker Compose + Web Dashboard + Pluggable Cockpit Addons (ADR-080) is architecturally superior for multi-container sandboxing and team-scale deployment. The desktop wrapper adds no value when the Cockpit is already a rich browser SPA.
- **ZadLoop's backend delegation engine**: Already adopted via ADR-054 (`delegate-fleet.v1`) and ADR-056 (adversarial debate review). No re-adoption needed.

### Alternatives Considered

- *Per-member locale (instead of per-project)*: Deferred to Phase 2. Requires session-scoped document rendering pipeline, which adds complexity before P0 completion criteria are met.
- *Persistent Access Mode Pill (saved in DB)*: Rejected. The pill is a per-prompt intent signal, not a persistent governance policy. Persistence would create silent policy overrides that bypass the `project.config.json` governance contract.
- *Separate Maker and Developer app builds*: Rejected. A single codebase with runtime persona switching is simpler to maintain and allows smooth mid-project transitions.
- *LiteLLM OAuth proxy plugin*: Investigated. LiteLLM does not natively support CLI OAuth session tokens as a credential type for Claude/Codex CLIs. The Out-of-Band Secrets Proxy (ADR-018) is a simpler and more secure injection mechanism.

### Consequences

- **BiDi**: Arabic-speaking operators can use Graywolf Chat Cockpit and read Executive Review Packets without text direction corruption. Zero backend changes; purely CSS + HTML + document post-processing.
- **Access Mode Pill**: Operators switch between brainstorming, gated review, and full autonomy without touching config files. RBAC-enforced server-side. Does not affect persistent governance contracts.
- **Maker/Developer Personas**: Non-technical Founders and PMs can use Graywolf for Greenfield projects without encountering framework choice paralysis or unreadable AST diffs. All power features remain accessible via a toggle.
- **CLI Subscription Bridge**: Solo developers with Claude Max/ChatGPT Plus subscriptions can use Graywolf without a separate API key bill in Topology A. Wall-clock caps replace dollar caps for auditability. Topology B/C deployments are unaffected.

---

## ADR-082: WebMCP Evaluation and Deferred Adoption Watchlist

- **Date**: 2026-10-17
- **Status**: Deferred
- **Context**:
  - WebMCP is a proposed browser API (`navigator.modelContext`) originating from the Web Machine Learning Community Group (WebML CG draft; not a standardized W3C specification). Chrome shipped an early developer preview in February 2026, and open-source polyfills (such as MCP-B under MIT) have appeared.
  - WebMCP enables web applications to register typed, schema-backed tools (via an imperative `navigator.modelContext.registerTool()` API or declarative HTML `<form>` markup) that browser-based AI agents can invoke directly without scraping the DOM or guessing accessibility selectors.
  - The API incorporates a `requestUserInteraction` / `consequentialHint` confirmation paradigm for sensitive operations, conceptually mirroring Graywolf's mandatory human-in-the-loop gates.
  - However, WebMCP contains critical architectural caveats and security boundaries that impact Graywolf's containerized execution model:
    1. **Headless Execution Non-Goal**: The WebML CG specification explicitly lists headless, no-human-present execution as an explicit non-goal. Graywolf's runner sandbox operates in exactly this headless environment, making native browser support unavailable and forcing reliance on polyfills.
    2. **Origin-Level Tool Pollution & Privilege Escalation**: In the current draft, once a tool is registered in a page context, any script running within that page has access to invoke or inspect it. If a page suffers from Cross-Site Scripting (XSS) or third-party script compromise, all registered agent tools are exposed.
    3. **Graywolf Cockpit Attack Surface**: Exposing Graywolf's own Web Dashboard / Chat Cockpit via WebMCP would create a browser-side tool-call path parallel to the server-authoritative Casbin RBAC interceptor (ADR-039), creating an unvalidated vector into internal task scheduling.
    4. **Supply-Chain & Prompt Injection in Generated Apps**: If Graywolf-generated applications ship WebMCP tools into production by default, malicious page content or third-party widgets could exploit agent tools or inject malicious prompts via tool description schemas.
- **Decision**: **Defer adoption of WebMCP across Graywolf Squad** with the following binding governance policies:
  1. **Strict Exclusion from Graywolf's Internal Cockpit & Control Plane**:
     - Graywolf Squad will NOT expose its own Chat Cockpit, Kanban, or administrative dashboard APIs via WebMCP.
     - All cockpit and task operations remain server-authoritative through Fastify REST/WebSocket endpoints protected by Casbin RBAC (ADR-039) and relay.mjs invariant guards (ADR-037).
     - If read-only observability tools are ever considered for the cockpit in a future phase, they must be strictly non-mutating and still pass server-side authorization.
  2. **Pending Constitution Rule for Graywolf-Generated Applications**:
     - Coding agents (Dev-Level-3) generating customer applications must **NEVER** include WebMCP tool registrations in production bundles by default.
     - WebMCP tools in generated applications must be **opt-in only, default disabled**, and gated behind explicit feature flags (`ENABLE_WEBMCP_TOOLS=false`).
     - Destructive or state-mutating tools must enforce explicit human confirmation flows (`requestUserInteraction`) and must never bypass backend authentication.
     - Tool descriptions generated by Dev-Level-3 must be sanitized and treated as untrusted metadata to prevent prompt injection attacks against downstream user agents.
  3. **Potential Future Evaluation Track (QA Test Hooks Only)**:
     - The only viable future application of WebMCP within Graywolf is as an isolated **test hook in ephemeral preview builds**: a QA agent could invoke typed test tools in a test-only build of a generated app instead of navigating the DOM, complementing `browser_act` and Playwright tests.
     - This remains on the architecture **watchlist** pending W3C standardization, headless sandbox support, and per-tool permission isolation.
- **Alternatives Considered**:
  - *Adopt WebMCP immediately via MCP-B polyfill*: Rejected. Graywolf's headless sandbox is an explicit non-goal in the spec; adding experimental browser polyfills adds brittle dependencies with zero immediate ROI over Playwright aria snapshots.
  - *Expose Graywolf Cockpit tools via WebMCP*: Rejected. Violates defense-in-depth and server-authoritative RBAC (ADR-039).
- **Consequences**:
  - Prevents premature adoption of an unstandardized, pre-W3C browser draft.
  - Eliminates browser-side security vulnerabilities in the Chat Cockpit.
  - Protects customer applications generated by Graywolf from inadvertent WebMCP tool injection attack surfaces.
  - Establishes a clear watchlist criterion for future test-hook evaluation.

---

## ADR-083: Socratic Grilling Engine, Deterministic Guard Fast-Fails, and Dual-Axis Quality Review

- **Date**: 2026-10-17
- **Status**: Accepted
- **Context**:
  - Evaluation of Matt Pocock’s `skills` repository (`mattpocock/skills`) and Ahmed Nagdy’s `guard-skills` (`amElnagdy/guard-skills`), highlighted in the engineering analysis of AI coding agent workflows ("Let Claude learn instead of you explaining every time"), identified three critical operational gaps in Graywolf Squad's task lifecycle:
    1. **Upfront Requirement Ambiguity & Task Bloat**: Operators often initiate tasks in the Chat Cockpit with high-level descriptions. While Dev-Level-1 Planner has a clarification protocol (ADR-011), firing clarification subtasks mid-flight (`AWAITING_CLARIFICATION`) after container provisioning and repo-mapping wastes cycles. Proactive conversational stress-testing (the `/grill-me` pattern) resolves edge cases *before* container dispatch.
    2. **Debate Token Waste on Routine LLM Anti-Patterns**: Dev-Level-2's 3-pass adversarial debate (ADR-056) uses expensive frontier models. Running the full debate against diffs with obvious, shallow LLM smells—such as mock abuse (mocking the class under test, vacuous assertions) or swallowed errors (`catch (e) {}`)—burns costly reasoning tokens on problems that can be caught deterministically.
    3. **Conflated PR Review Signals & Docs Drift**: Code reviews often blur architectural compliance (coding standards, linter rules) and functional spec compliance (did we actually build what the user asked for?). Furthermore, AI-generated PR summaries and documentation frequently suffer from drift—hallucinating APIs, configuration keys, or symbol names that do not exist in the code patch.
- **Decision**:
  1. **Socratic Grilling Engine in Chat Cockpit (`CockpitMode: GRILL`)**:
     - Introduce a first-class conversational mode in the Chat Cockpit: **`GRILL`** (alongside `CHAT`, `PLAN`, and `EXECUTE`), implementing the `/grill-me` pattern.
     - When an operator initiates a feature proposal or complex architectural change, the Cockpit enters Socratic interview mode:
       - Actively probes unhandled edge cases, failure states, boundary conditions, data model mutations, and dependency impacts (up to 5 structured questions).
       - Relentlessly challenges vague requirements rather than passively agreeing.
       - Progressively synthesizes decisions into `docs/PRD.md` or a feature brief before any task container is spun up.
  2. **Deterministic Guard Heuristics in Gate 4 Pre-Screen (ADR-079 Integration)**:
     - Expand Gate 4 (Two-Strike Fast-Fail Pre-Screen) of the System-One DecisionGate service with two lightweight, deterministic AST/regex guard checks extracted from `amElnagdy/guard-skills`:
       - **`test-guard`**: Flags (a) mocking the class or module under test, (b) tests with zero assertions, (c) vacuous assertions (e.g. `expect(x).toBeDefined()` on non-null return values or `expect(true).toBe(true)`), and (d) happy-path-only suites missing basic error branch coverage.
       - **`clean-code-guard`**: Flags (a) silent error swallowing (`catch (e) {}` with no logging or rethrow), (b) premature DRY generalization (`options?: any`), and (c) dead/commented-out blocks left in the patch.
     - **Execution & Strike Policy**: Gate 4 executes in <500ms prior to launching the ADR-056 3-pass debate. A confident guard violation triggers an accelerated **Strike-1 rework brief** directly to Dev-Level-3, saving thousands of frontier debate tokens. Fatal Strike-2 escalations still strictly require full confirmation by the ADR-056 3-pass debate.
  3. **Dual-Axis Review Formatting & `docs-guard` in Executive Review Packet**:
     - **Dual-Axis Review Matrix**: In the PR Review Packet (ADR-056 & PRD §8.4), synthesize Dev-Level-2 review findings into two orthogonal axes:
       - **Standards Axis**: Linter compliance, architecture boundaries, error handling, typing, and blast-radius discipline.
       - **Spec Axis**: Direct mapping against the user acceptance criteria in `brief.md`.
     - **Automated `docs-guard` Symbol Cross-Check**: An automated AST validator verifies that every function, exported type, CLI flag, or configuration parameter mentioned in the PR description, README diff, or docstrings actually exists in `changes.patch`. Discrepancies are flagged as blocking P1 documentation drift.
  4. **Continuous Learning Closed Loop (Hermes Anti-Pattern Registry)**:
     - When Gate 4 or the ADR-056 debate catches a guard violation (`test-guard` mock abuse, `clean-code-guard` swallowed errors), the Hermes Background Reflection Job (ADR-057) automatically logs the failure pattern into the **Anti-Pattern Registry** in PostgreSQL (`pgvector`) under category `LLM_CODE_SMELL` or `TEST_INTEGRITY`.
     - Dev-Level-1 Planner injects these historical anti-patterns as negative constraints in subsequent planning prompts for the repository, preventing recurring mistakes.
- **What This ADR Does Not Adopt**:
  - *Adopting Matt Pocock's `git-guardrails` host script*: Rejected for container isolation. Matt's script protects uncontained local laptops running Claude Code. Graywolf's Triple-Layer Non-Committing Barrier (ADR-047) already structurally isolates git remotes and denies commit/push credentials at the Docker container OS level.
  - *Running full guard skills inside the ADR-056 debate prompts*: Rejected. Keeps debate prompts lean and focused on semantic reasoning, while fast deterministic guards handle code smells at Gate 4.
- **Alternatives Considered**:
  - *Relying solely on post-hoc human review for docs drift*: Rejected. Docs-vs-code drift is a notorious LLM defect that humans easily miss in 60-second reviews. AST validation is cheap and deterministic.
  - *Blocking the Chat Cockpit entirely until 5 questions are answered*: Rejected. Operators can bypass `GRILL` mode at any time using the Access Mode Pill (ADR-081) or explicit `--skip-grill` flags.
- **Consequences**:
  - Eliminates premature container dispatches on underspecified tasks via upfront Socratic grilling.
  - Slashes LLM token costs by fast-failing code smells at Gate 4 before invoking the ADR-056 debate.
  - Delivers crystal-clear PR reviews split cleanly between functional fulfillment (Spec Axis) and code quality (Standards Axis).
  - Guarantees zero docs-to-code drift in generated PR summaries and documentation.
  - Establishes a permanent closed-loop learning mechanism against recurring LLM failure modes.


