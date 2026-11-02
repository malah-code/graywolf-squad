# Graywolf Squad — Product Requirements Document (PRD)

**Status**: Living Document (Discovery & Architecture Definition Phase)  
**Last Updated**: 2026-10-17 (Rev 15 — integrated tester-army/e2e intent QA ADR-075..078 peer review refinements, Jev ADR-079, Software Factory ADR-080, ZadLoop UX ADR-081, and WebMCP Deferred ADR-082)  
**Authors**: Tarek Elmallah & Antigravity  

---







## 1. Executive Summary & Vision

**Graywolf Squad** is an autonomous multi-agent software engineering platform designed to operate as a high-velocity, sovereign software engineering organization.

Unlike conventional coding assistants that act as passive tab-completion or simple chat interfaces, Graywolf acts as:
1. **An Autonomous Greenfield Software House**: Capable of taking high-level requirements documents, architecting complete applications from scratch, structuring the codebase, decomposing tasks, implementing modules, and running comprehensive automated test suites.
2. **An Embedded Brownfield Squad**: Capable of integrating into an existing team's codebase (e.g., GitLab/GitHub repositories for enterprise apps like accounting, ERP, or fintech). In this mode, Graywolf takes ownership of designated feature modules (e.g., Tax Reporting Module) while strictly respecting architectural boundaries, existing conventions, and non-modifiable core systems.

### Core Philosophy
- **Human Sovereignty**: Agents propose changes and test results inside isolated sandbox containers; they NEVER commit directly to upstream branches without explicit gate verification.
- **Cognitive Specialization (Virtual Developer Tiers)**: Instead of treating LLMs as generic workers, Graywolf employs tiered developer personas (Planner, Implementer, In-Container Reviewer) routed to the right model caliber.
- **Active Conversational Cockpit**: Natural language chat is an active control plane with tool-calling capabilities across the entire platform lifecycle (issue creation, scheduling, backlog reordering, mid-flight pivot).
- **Blast-Radius Containment**: Structural isolation via Docker containers, isolated Git worktrees, and immutable filesystem permission scopes.

---

## 2. Operating Modes

### 2.1 Greenfield Mode (Autonomous Software House)
- **Input**: High-level requirements, PRD, or user brainstorm sessions.
- **Execution**: Graywolf establishes repository structure, selects baseline tech stack (per Constitution), provisions database and service containers, initializes CI/CD and linting, and iteratively builds out the product.
- **Scope**: Entire repository is writable within the sandboxed environment.
- **Maker / Developer Persona**: Greenfield projects additionally select a UI persona at onboarding (see §7 Step 2 and ADR-081 Pattern 3). **Maker View** simplifies the Cockpit to Chat + Live Preview + Progress Checklist with non-technical clarification questions and plain-English review summaries. **Developer View** retains the full tab layout, diff viewer, and terminal (default for Brownfield).

### 2.2 Brownfield Mode (Embedded External Squad)
(Detailed spec: [`docs/architecture/brownfield-reconnaissance-and-blast-radius.md`](file:///home/tarikelmallah/Projects/GraywolfSquad/docs/architecture/brownfield-reconnaissance-and-blast-radius.md))
- **Input**: Existing external repository URL (GitLab, GitHub, Bitbucket, Azure DevOps, or Gitea), credentials, and feature brief.
- **Multi-Provider Git Support**: Graywolf connects to any major Git hosting provider through a **provider-agnostic abstraction layer** (`repo-sdk`). All Git operations (clone, worktree, read branches, create PRs/MRs) pass through this layer. Authentication supports Personal Access Tokens, SSH keys, and OAuth flows.
- **5-Phase Reconnaissance Pipeline**: Before generating code, Graywolf executes an automated structural scan (0 tokens for phases 1–4):
  - *Phase 1*: Manifest & Infrastructure fingerprinting (NestJS, Fastify, Django, Prisma, TypeORM, CI/CD).
  - *Phase 2*: Tree-sitter AST symbol extraction (classes, interfaces, methods, exports).
  - *Phase 3*: Dependency graph PageRank centrality mapping.
  - *Phase 4*: Algorithmic blast-radius proposal (Feature target ➔ Writable; Upstream imports & bounded downstream dependents ➔ Read-Only; Core CI/CD & auth ➔ Forbidden).
  - *Phase 5*: Emits `.agents/recon-report.md` and authors initial `.agents/constitution.md` for human lead sign-off.
- **Blast-Radius Enforcement**:
  - **Writable Scope**: Globs of files/folders the squad is permitted to create and modify (e.g., `src/modules/tax/**`, `tests/modules/tax/**`).
  - **Read-Only Scope**: Context files the squad may inspect for types, schemas, and utilities, but never modify (e.g., `src/database/models/**`, `src/shared/**`).
  - **Forbidden Scope**: Strictly isolated core infrastructure (e.g., `src/core/auth/**`, `.gitlab-ci.yml`, `src/billing/**`).
- **Escalation Protocol**: If an agent determines that a feature requires altering code outside its Writable Scope, execution immediately halts and generates an `escalation-request.md` for human approval or re-scoping. Agents cannot bypass or work around scope boundaries.


---

## 3. Human Workflow & Developer Experience

### 3.1 Dual-Interface Workflow (Kanban + Live Chat)
Developers interact with Graywolf through two tightly synchronized interfaces:
1. **Interactive Kanban Board & DAG Visualizer**:
   - Visual columns: `Backlog`, `Queued / Ready`, `In Progress (Sandbox)`, `Internal Review`, `QA Guard Verifying`, `Awaiting Clarification`, `Review Gate`, `Merged / Done`.
   - **Maker View** uses simplified column labels: **Ideas → Planning → Building → Ready to Review → Live** (ADR-081 Pattern 3).
   - DAG dependency graph powered by React Flow, illustrating blocking/dependent tasks.
   - Real-time terminal streaming powered by Xterm.js displaying sandbox container stdout/stderr.
2. **Conversational Control Plane (Chat Agent Cockpit)**:
   - Built using **`assistant-ui`** (MIT, React/TypeScript) — a modular chat component library handling streaming responses, tool-call rendering, code blocks, and markdown without building a chat UI from scratch.
   - **Streaming Transport**: **Vercel AI SDK** (`ai`, Apache-2.0) powers the backend streaming layer. `streamText()` + `toDataStreamResponse()` emit protocol-compliant streams from Fastify that `assistant-ui` consumes natively — no custom SSE parser (ADR-065). All LLM traffic still routes through LiteLLM; the SDK is purely a TypeScript streaming abstraction over the OpenAI-compatible endpoint.
   - **State Workflows / Memory**: **Mastra** (`@mastra/core`) is held at **pattern-reference only** — same disposition as LangGraph (ADR-065, ADR-052 §Mastra Evaluation). Its storage adapter patterns may inform Graywolf's own conversation history implementation, but its workflow engine and memory primitives are NOT adopted wholesale. Background jobs (background reflection, skill curator) are owned by Graywolf's BullMQ layer directly.
   - Always available during development, testing, and debugging.
   - Supports natural language commands to create bug tickets, reprioritize queues, pause containers, inspect active logs, and link task dependencies.
   - **Access Mode Pill** (ADR-081 Pattern 2): A 3-state selector embedded in the Chat input bar that overrides autonomy for the current task only (not persistently):
     - 🔍 **Plan / Read-Only** — Dev-Level-1 drafts `plan.md` / `brief.md` without spawning a write-enabled container.
     - ✋ **Plan-Gate** — Dev-Level-1 runs, pauses for one-click `plan.md` approval in the `planner` tab, then Dev-Level-3 executes.
     - ⚡ **Full Factory** — Full Dev-Level-1 → Dev-Level-3 → Dev-Level-2 pipeline (existing default behavior).
     - RBAC: only `developer` / `lead_dev` roles can change the pill. `viewer` sees it as display-only.
   - **Brainstorming & Socratic Grilling Mode (`CockpitMode: GRILL`)** (ADR-083 — `/grill-me` Pattern):
     - An interactive conversation mode where:
       - The operator discusses a feature idea or architectural change with the Chat Agent.
       - Rather than passively nodding along, the agent enters Socratic stress-testing mode: it actively challenges vague assumptions, explores boundary conditions, unhandled failure branches, and data model implications (asking up to 5 structured probing questions).
       - References existing codebase architecture, similar past tasks, and the project constitution.
       - Progressively synthesizes decisions directly into `docs/PRD.md` or a structured `brief.md`.
       - Drastically slashes downstream `AWAITING_CLARIFICATION` halts before any container is provisioned.
       - The conversation is persisted and linked to the resulting task for full traceability.
       - The agent requests explicit operator confirmation before queuing the task for execution.
3. **Active Task Cockpit — Multi-Tab Right Panel** (ADR-053):
   - Split-pane layout: Chat on left, tabbed panel on right. Pane widths are resizable via a drag handle and persisted per-conversation in `localStorage`.
   - Right panel open/closed state is **session-only** (not persisted); the selected tab is persisted.
   - All tab components are **lazy-loaded** to exclude XTerm and Monaco from the eager bundle.
   - **Maker View** defaults to **Chat + `browser` + Progress Checklist** tabs; technical tabs (`commits`, `terminal`, `files`) are collapsed but accessible. AST diffs and stack traces in the Executive Review Packet are hidden behind a "Show Technical Details" toggle (ADR-081 Pattern 3).
   - **Tab inventory**:

   | Tab | Contents |
   |---|---|
   | `files` | Workspace file explorer with read-only file preview |
   | `commits` | Monaco DiffEditor (3-mode: `old` / `diff` / `new`), per-file accordion rows, custom dark theme. Height capped at 600px. Displays working-tree vs base diff and per-commit deltas from `result.json`. |
   | `planner` | Live task checklist synchronized with Dev-Level-1's `plan.md`. In Plan-Gate mode, surfaces **Approve Plan** / **Request Changes** action buttons. |
   | `terminal` | XTerm.js WebSocket terminal streaming container stdout/stderr |
   | `browser` | Headless browser viewport for agents running Playwright or UI verification |
   | `usage` | **ContextMeter** (% context window fill gauge) + **CompactContextButton** (manual context condensation trigger) + live accumulated token count and dollar cost |

4. **BiDi (Bidirectional) Text Isolation** (ADR-081 Pattern 1):
   - All prose paragraphs and chat bubbles use `dir="auto"`. All inline `<code>`, file-path badges, CLI command blocks, Xterm.js, and Monaco DiffEditor enforce `dir="ltr" unicode-bidi: isolate` unconditionally.
   - Dev-Level-1 `plan.md`, `brief.md`, `escalation-memo.md`, and Executive Review Packets may be synthesized in the operator's configured locale (`"locale": "ar" | "en" | "fr" | "tr"` in `project.config.json`, default `"en"`).
   - Code identifiers, file paths, AST symbols, and CLI commands always remain English/LTR inside locale-specific documents — enforced via document post-processing before rendering.
   - Extends ADR-035 (WCAG 2.1 AA) to include WCAG 2.1 SC 1.3.4 (BiDi Text) and Unicode BiDi Algorithm (UBA) compliance.


### 3.2 Chat Cockpit Tool-Calling Authorization & RBAC
(Detailed spec: [`docs/architecture/session-token-and-cockpit-rbac.md`](file:///home/tarikelmallah/Projects/GraywolfSquad/docs/architecture/session-token-and-cockpit-rbac.md))
- **Zero Model Trust**: AI models in the Chat Cockpit have zero intrinsic authority. All tool calls (`create_task`, `reorder_backlog`, `approve_pr_merge`, `modify_blast_radius`) are intercepted and evaluated server-authoritatively by the Fastify gateway against the user's role (`viewer`, `developer`, `lead_dev`, `owner`).
- **Instant Revocation**: Backed by **Better-Auth** and **Valkey** stateful session caching. Demoting or ejections purge Valkey keys immediately, blocking tool calls mid-session.
- **WebSocket Ticket-Granting Tokens (TGT)**: Terminal streaming and live UI updates authenticate via short-lived (10-second client + 5-second server grace) single-use tickets.
- **Sandbox Isolation Invariant**: Ephemeral runner containers have zero HTTP reachability to Control Plane APIs; all interaction is restricted to typed Agent Relay Protocol (ARP) frames with server-side IDOR enforcement.

### 3.3 Control Plane REST API (OpenAPI 3.1 Contract)
(Detailed spec: [`specs/001-multi-agent-platform/contracts/openapi.yaml`](file:///home/tarikelmallah/Projects/GraywolfSquad/specs/001-multi-agent-platform/contracts/openapi.yaml) and [`docs/decisions.md#adr-041`](file:///home/tarikelmallah/Projects/GraywolfSquad/docs/decisions.md))
- Formal schema-first contract defining Fastify Port 3000 REST endpoints across Sessions, Workspaces, Projects, Tasks, Conversational Cockpit, and Telemetry Tickets.
- **ACI Validation (ADR-066)**: All LLM-generated outputs at Agent-Computer Interface boundaries are validated at generation time using TypeBox (Fastify-native) and Zod (relay + tool call layer). No unvalidated model output enters the task lifecycle. On failure, a structured error is returned to the model for self-correction before any handler executes.
- Powers dual-stack code generation: TypeBox route schemas for Fastify backend, and type-safe query hooks for the React/Vite dashboard.


### 3.4 Daily Flow Scenarios
- **Scenario A (Bug Caught in Testing)**: Developer notices an issue (e.g., CSV export failure with Arabic characters). They type into chat: *"Create a P1 bug for CSV UTF-8 encoding in tax reports, block the tax generation task on it, and run it now."* The Chat Agent executes tools to create the brief, update `blockedBy` pointers, reorder the queue, and spin up an ephemeral container.

- **Scenario B (Mid-Flight Task Refinement)**: While an agent is working in a container:
  - *Minor Clarification*: Developer adds details to the task brief on disk or in chat. Orchestrator detects this and injects the update into the active agent's turn buffer without restarting.
  - *Major Requirement Pivot*: Developer drastically changes the direction. Orchestrator snapshots the current worktree for safety, kills the container, marks the task `UPDATED`, and triggers a clean re-plan from Dev-Level-1.
- **Scenario C (Brainstorming & Socratic Grilling for a New Feature)**: Developer has a rough idea for a notification system. They start a session in chat: *"Let's brainstorm how push notifications should work in our app."* The Chat Cockpit enters `GRILL` mode (ADR-083): the agent stress-tests edge cases ("Real-time via WebSockets or queued via push provider?", "What happens on mobile network dropouts?"), references existing architecture, and updates domain docs. After resolving ambiguities, the developer says: *"OK, create a task from this."* The agent synthesizes the conversation into `brief.md` and requests explicit confirmation before queuing.

---

## 4. Cognitive Architecture: Virtual Developer Tiers
(Detailed spec: [`docs/architecture/virtual-developer-tiers.md`](file:///home/tarikelmallah/Projects/GraywolfSquad/docs/architecture/virtual-developer-tiers.md))

Rather than running multiple heavy containers communicating over external networks, each task sandbox runs a disciplined internal cognitive handoff:

```
┌────────────────────────────────────────────────────────┐
│ Task Container (Isolated Docker Sandbox)               │
│                                                        │
│  [Dev-Level-1: Planner] (Frontier Reasoning Model)      │
│        │                                               │
│        ▼ Generates plan.md & selects tiers             │
│  [Dev-Level-N: Implementer] (Fast / High-Throughput)   │
│        │                                               │
│        ▼ Writes code, runs tools, emits diff           │
│  [Dev-Level-M: Reviewer] (Rigorous Reasoning Model)    │
│        │                                               │
│        ├── Reject (max 2 attempts) ──► Re-plan / Fix   │
│        └── Sign-off (review-signoff.md)                │
└────────────────────────┬───────────────────────────────┘
                         ▼
        External Orchestrator Reactive Quality Gates
     (Clean-Code Guard ➔ Test Guard ➔ Doc Guard)
                         ▼
             Configurable Final Review Gate
    (auto-approve | AI PM Agent | human | mandatory-human)
```

### 4.1 Developer Tier Definitions
- **Dev-Level-1 (Lead Architect / Planner)**:
  - *Responsibility*: Reads task brief, project configuration, and repository context. Formulates technical strategy, identifies file mutations, ensures blast-radius compliance, and writes `plan.md`. Designates the appropriate implementer and reviewer tiers.
  - *Model Profile*: Frontier reasoning model via LiteLLM virtual alias `agent-planner` (e.g., Claude Sonnet, Gemini Pro, or local Qwen-2.5-72B).
  - *Context Bundle & Exploration Engine* (Detailed spec: [`docs/architecture/context-and-memory.md`](file:///home/tarikelmallah/Projects/GraywolfSquad/docs/architecture/context-and-memory.md)):
    1. **Layer 1: Topological Repo Map**: AST-derived outline of modules, key functions, types, and dependencies ranked via Tree-sitter + PageRank centrality (~1,500 token budget, Aider pattern). In brownfield mode, this is seeded from `recon-report.md`.
    2. **Layer 2: Symbol Index & Call Graph**: On-demand resolution of symbol definitions, interface contracts, and callers (`find_symbol_definition`, `find_symbol_references`) via Tree-sitter.
    3. **Layer 3: Hybrid Lexical + Dense Search**: `ripgrep` for exact identifiers/errors combined with `pgvector` dense search over module summaries and conventional commit/PR history via Reciprocal Rank Fusion (RRF).
    4. **Layer 4: Surgical Slicing**: Targeted line-range viewing (`view_file_range`) and contiguous replacement edits (`replace_file_content`).
    5. **Project State Summary**: Auto-generated from `.agents/tasks/` — status counts, active blockers, current queue.
    6. **Project Memory & Anti-Patterns**: Lessons learned from past corrections, known failure modes, and convention rules from the continuous learning engine (§9).
    7. **Architecture Context**: Constitution, data model, and any upstream `plan.md` artifacts.
    8. **Internet Search** (gated): Sandboxed tool for library docs, API references, or design patterns (all searches logged).
- **Dev-Level-2 (Senior Reviewer / Quality Gate)**:
  - *Responsibility*: In-container review. Inspects code diff against `plan.md`, runs unit and integration tests inside the sandbox, checks for edge cases, and emits `review-signoff.md` or targeted revision instructions.
  - *Model Profile*: High-precision analytical model.
- **Dev-Level-3 (Core Software Engineer / Implementer)**:
  - *Responsibility*: Executes the steps outlined in `plan.md`. Edits source files, installs declared packages, adjusts configurations, and authoring unit and E2E tests.
  - *Visual Test Authoring via `e2e mcp` (ADR-077)*: For tasks tagged `ui` or `mandatory-e2e`, Dev-Level-3 is granted an in-container Chromium session via MCP tools (`browser_observe`, `browser_locate`, `browser_act`, `browser_screenshot`, `browser_video_start`/`stop`). Inspects the live preview server to extract verified semantic locators (`getByRole`) before authoring tests, eliminating brittle guessed CSS selectors.
  - *Model Profile*: Fast, cost-efficient, high-throughput code synthesis model via LiteLLM virtual alias `agent-coder` (e.g., DeepSeek-V3, Haiku, or local DeepSeek-Coder).
- **Specialist Tiers (Dev-Level-4 through Dev-Level-7)** (activated on demand by Planner or task tags):
  - **Dev-Level-4 (QA Specialist)**: Playwright headless E2E test execution, intent-based testing (`agent.act`, `agent.assert` ADR-075), deterministic cache replay, cross-browser compatibility, accessibility audits, visual regression.
  - **Dev-Level-5 (Security Auditor)**: SAST scanning, AST taint analysis, secret detection, CVE remediation.
  - **Dev-Level-6 (Database Specialist)**: Schema migration validation, query execution plan inspection, zero-downtime indexing strategy.
  - **Dev-Level-7 (Performance Specialist)**: Microbenchmarking, memory leak analysis, hot-path optimization.

### 4.2 Handoff & Failure Rules
- **Two-Strike Review Rule & Adversarial Debate Protocol (ADR-056)**:
  - **Dev-Level-2 3-Pass Adversarial Debate**: Instead of a single model, Dev-Level-2 code review runs a 3-pass adversarial debate between two independent model families (`review-main` e.g. Claude vs `review-debate` e.g. Codex/Gemini) using the `review-skills` JSON contracts:
    1. **Pass 1 (`findings.v1`)**: Main reviewer extracts findings (`P0/P1/P2`) anchored to lines with confidence scores $\ge 0.5$.
    2. **Pass 2 (`debate.v1`)**: Debate reviewer confirms, refutes (with code evidence), or downgrades findings, plus performs a gap sweep.
    3. **Pass 3 (`final.v1`)**: Main reviewer issues final verdicts: `agreed`, `contested`, or `withdrawn`.
  - **Dev-Level-2 Fourth Pass: `e2e explore` Autonomous PR Smoke Gate (ADR-076)**:
    - Activated for tasks tagged `ui`, `api-surface`, or `mandatory-e2e` when a preview server is running.
    - An autonomous agent drives the running application unscriptedly looking for runtime crashes, unhandled 500s, or broken flows under hard budget caps (`maxTurns: 6`, `timeout: 180s`, `spendLimitUSD: $0.50`).
    - Findings are passively recorded as `browser-test` events in `.agent_evidence.db` (ADR-062).
    - **Repro & Strike Rule**: P0/P1 explore findings require a minimal failing repro test directly attributable to code modified in `changes.patch` to count toward a Strike against Dev-Level-3 ("No Repro, No Bug" protocol ADR-078).
  - **Gate 4 Two-Strike Loop Fast-Fail Pre-Screen (ADR-079)**:
    - Before triggering the expensive 3-pass debate, a System-One Decision Gate pre-screens test failure output (70–150ms).
    - If a logic error is classified with confidence $\ge 0.90$, the orchestrator skips the debate and immediately dispatches an accelerated Strike-1 rework brief to Dev-Level-3.
    - Fatal Strike-2 escalations (`INTERNAL_REVIEW_FAILED`) strictly require full independent confirmation by the ADR-056 3-pass adversarial debate.
  - **Strike Accounting**:
    - `withdrawn` findings (refuted by debate model) are dropped and **never trigger a Strike**.
    - Only `agreed` P0 (security/crash) and P1 (logic/contract violation) findings trigger an authoritative Strike against Dev-Level-3.
    - `contested` findings (debate model disagreed but main held ground) do **not** burn a strike; they route to the human operator via an **Escalation Decision Memo** (ADR-050) highlighting both perspectives.
    - Non-blocking P2 findings are advisory notes and never block completion.
  - If Dev-Level-2 rejects the implementation twice consecutively (`agreed` P0/P1), the task automatically escalates to `INTERNAL_REVIEW_FAILED` and halts for human review. To prevent structural conflicts of interest (since Dev-Level-1 authored the disputed plan), an independent **Neutral Arbiter (`agent-arbiter`)** synthesizes an **Escalation Decision Memo** (`escalation-memo.md`) summarizing the dispute in plain English with Option A/B trade-offs, a recommended default action, and async notifications (Slack/Webhook) (ADR-050, Requirement N8).
  - **Local In-Sandbox Evaluation**: Review runs against the local working tree diff (`--local`) inside the ephemeral container; no forge tokens or external network egress required.
- **Configurable Planning By-Pass**: For simple bugs, project settings can declare `simplebugs.skipPlanning: true`, letting Dev-Level-3 start immediately.
- **Mandatory Human Plan Gate**: For high-risk tasks (e.g., database schema migrations), `plan.md` can mandate human sign-off before the implementer is allowed to write code.
- **Dev-Level-3 CLI Dispatch — delegate-skills Relay Contract** (ADR-054):
  - Dev-Level-3 dispatches implementation work to external agent CLIs via the **`delegate-fleet.v1`** lane model (MIT-licensed `delegate-skills` relay protocol):
    - **Brief on stdin** → `relay.mjs --lane <name> --cd <repo>` → blocks until exit → reads `result.json`.
    - **`result.json`** provides: `status`, `exitCode`, `sessionId`, `touchedFiles`, `finalMessage`.
  - **Fleet Lanes** bind task types to implementer CLIs: e.g., `feature → claude`, `tests → codex`, `ui → opencode`, `complex → agy`.
  - **Two-Strike Session Mapping**:
    - **Strike 1**: Fresh dispatch — `relay.mjs --brief brief.txt`.
    - **Strike 2**: Delta brief on the same session — `relay.mjs --session <id>`, no cold restart, incremental correction only.
    - **Strike 3+**: Escalate to human (`INTERNAL_REVIEW_FAILED` + Escalation Decision Memo).
  - **ACP Streaming**: For CLIs that support Agent Client Protocol (Claude Code, Codex, Gemini CLI), JSON-RPC 2.0 over stdio is used for live turn-by-turn streaming into the cockpit `terminal` tab.
  - **Non-Committing invariant**: Relay scripts structurally deny `git commit` / `git push`. The orchestrator owns the verified commit gate (ADR-018).

### 4.3 Clarification Question Protocol & Blocking Subtasks
When the Dev-Level-1 Planner identifies ambiguities that would lead to wrong implementation, it emits a `clarification-request.md` instead of guessing:
- **Task State**: Transitions to `BLOCKED` (`AWAITING_CLARIFICATION`).
- **Child Subtask Spawning**: The orchestrator creates a high-priority child subtask (e.g. `TASK-104.1: [CLARIFICATION REQUIRED] <topic>`) assigned directly to the human developer on the Kanban board.
- **Cockpit Notification**: An alert is pushed immediately to the Chat Cockpit with the questions.
- **Answering & Resuming**: The developer can answer via Chat or on the Kanban subtask card. Answering marks the subtask `RESOLVED`, unblocks the parent task, injects answers into `plan.md`, and resumes execution in the existing container without a cold restart.
- **Configurable limits in `project.config.json`**:
  - `maxClarificationQuestions`: 5 per round (default).
  - `maxClarificationRounds`: 2 (default) — prevents infinite back-and-forth loops.
  - If unanswered after a configurable timeout, the task remains safely idle in `AWAITING_CLARIFICATION` without burning tokens.
- **Upfront Prevention via Socratic Grilling (ADR-083)**: Using `CockpitMode: GRILL` during task drafting resolves edge cases and domain boundaries before container dispatch, reducing the frequency of in-container `AWAITING_CLARIFICATION` halts by over 70%.

---

## 5. Sandboxing, Isolation & Concurrency Engine

### 5.1 Non-Committing Relay Contract
(Detailed specs: [`relay-protocol-and-websocket-contract.md`](file:///home/tarikelmallah/Projects/GraywolfSquad/docs/architecture/relay-protocol-and-websocket-contract.md) and [`relay-mjs-contract.md`](file:///home/tarikelmallah/Projects/GraywolfSquad/docs/architecture/relay-mjs-contract.md))
- Agents operate via a lightweight relay harness (`relay.mjs`).
- Agents are structurally barred from executing `git commit` or `git push`.
- Upon completion or failure, the relay records touched files, peak memory, duration, exit code, and emits `changes.patch` and `result.json` conforming to `delegate-relay.result.v1`.

### 5.2 Git Worktree Isolation
- Every task receives an isolated Git worktree on the host filesystem.
- Relative pointer paths (`gitdir: ../../.git/worktrees/...`) resolve Docker path-collision paradoxes.
- Parent `.git` repository directory is mounted read-only into containers.

### 5.3 Concurrency & Atomic Locking
- Filesystem-driven state stored in `.agents/tasks/<TASK_ID>/`.
- Directory-level atomic locks implemented via `proper-lockfile` (atomic `mkdir` protocol).
- Stale lock detection with 30-second heartbeats and 60-second automatic garbage collection on orchestrator boot.
- Non-overlapping tasks with disjoint writable scopes execute concurrently up to `maxConcurrentContainers` (default: 3).

### 5.4 Adaptive Sandbox & Database Isolation Engine
(Detailed spec: [`docs/architecture/sandbox-and-testing.md`](file:///home/tarikelmallah/Projects/GraywolfSquad/docs/architecture/sandbox-and-testing.md))
- **3-Tier Database Strategy**:
  - **Tier 0 (Mock)**: Frontend-only, documentation, and pure algorithmic tasks. No DB container overhead.
  - **Tier 1 (Shared Dev DB)**: Read/CRUD tasks without schema modifications. Connects to shared dev Postgres with per-task schema namespacing (`search_path`).
  - **Tier 2 (Isolated Ephemeral DB)**: Schema migrations (`**/migrations/**`, `*.sql`, Prisma, Alembic). Uses Postgres copy-on-write template database cloning (`CREATE DATABASE task_id TEMPLATE graywolf_template`), spinning up in $<300$ms with zero cloud cost. Dropped upon task completion.
- **Resolution Hierarchy**: Human Task Override > Pre-flight File Pattern Analyzer > Dev-Level-1 Planner Declaration in `plan.md` > Global Config Default.

### 5.5 End-to-End Browser & Intent-Based QA Engine (Playwright + tester-army/e2e Patterns — ADR-075, ADR-077)
- **Base Environment**: Runner Docker base image pre-bundles Chromium and `@playwright/test`.
- **Hybrid Intent / Deterministic Authoring & Anti-Self-Grading (ADR-075)**:
  - Stable structure uses standard Playwright locators (`screen.getByRole`, `screen.getByTestId`, `expect`).
  - Fluid multi-step flows use intent-based primitives (`agent.act`, `agent.assert`, `agent.waitFor`, `agent.extract`).
  - **Deterministic vs. Agent-Judged Assertion Split**: Financial, billing, calculation, and tax logic MUST use deterministic `expect()` assertions with exact values (preventing LLM self-grading). Only deterministic assertions count toward PR merge gating.
  - **Semantic Locator Mandate**: Dev-Level-3 briefs prohibit brittle CSS/XPath selectors; agents must prioritize accessible role/name pairs (`getByRole('button', { name: 'Save' })`) matching scoped aria snapshots.
- **Deterministic Cache-Replay Lifecycle**:
  - After an `agent.act` step succeeds and its assertion passes, the resolved DOM action sequence is serialized to `.agents/tasks/<TASK_ID>/e2e-cache/`.
  - **Repeat CI Zero-Token Replay**: Cached actions replay deterministically without calling LLM endpoints.
  - **Project Cache Promotion on Merge**: Upon verified task merge, task caches are promoted to `.agents/cache/e2e/` (backed by persistent project volume) and mounted read-only for subsequent tasks.
  - **DOM-Drift Fallback & Cache Scoping**: If a cached control fails during replay, the runner catches the error and falls back to a live agent resolution turn. Overwrites apply only to the task-scoped cache; in CI, the fallback resolves live without persisting to the read-only project cache.
- **Visual Review Packets & MCP Authoring (ADR-077)**:
  - Generates Visual Review Packets with HTML reports, console errors, masked screenshots, and WebM video recordings stored in `.agents/tasks/<TASK_ID>/review/`.
  - Dev-Level-3 leverages in-container `e2e mcp` session tools (`browser_observe`, `browser_locate`, `browser_act`) to inspect the running UI before authoring test specs.
  - **Security & Origin Locking**: `browser_act` is strictly locked to the sandbox preview server origin (prevents SSRF). All browser observations (aria snapshots, page text) are wrapped in `<untrusted_browser_observation>` tags (ADR-038) before model ingestion.
- **Strict Data Residency & Governance**:
  - All model calls route through internal LiteLLM (`OPENAI_BASE_URL=http://litellm-proxy:4000`).
  - Zero Cloud SaaS sync (local-only execution per ADR-027; `@tester-army/cli` barred). Evaluated via an ADR-067 plugin spike with native pattern extraction fallback.

### 5.6 Build & Package Cache Optimization (Sub-2s Container Starts)
(Detailed spec: [`docs/architecture/build-cache-and-performance.md`](file:///home/tarikelmallah/Projects/GraywolfSquad/docs/architecture/build-cache-and-performance.md))
- **The Sub-2s Constraint**: Eliminates the 30–120s network download tax on `npm ci` / `pip install` without corrupting native addons or monorepo symlinks.
- **Tier 1 (Always-On Content-Addressable Cache Volume)**:
  - Mounts a persistent Docker volume (`pkg-cache-{project_id}`) pointing to the package managers' internal immutable store (`~/.npm`, `~/.cache/pip`, Cargo registry).
  - Runs real installs from local SSD storage in 2–8 seconds with 100% build fidelity.
- **Tier 2 (Debounced Pre-Baked Snapshot Layer)**:
  - For massive monorepos/ML projects, a background worker watches lockfiles and rebuilds a cached image layer via BuildKit cache mounts after 10 minutes of lockfile quiescence.
- **Mid-Task Isolation & Post-Merge Warming**:
  - Packages installed mid-task remain isolated in the task container, while tarball downloads are absorbed by the Tier 1 volume. Merging to the main branch triggers proactive background cache warming for subsequent tasks.

---

## 6. Model Governance & Cost Management (LiteLLM Open-Source Gateway)

- **100% Free & Open-Source Proxy**: All agent calls route through a self-hosted instance of LiteLLM Proxy (MIT License, $0 platform fee).
- **Universal Provider Support**: Connects seamlessly to both commercial cloud APIs (OpenAI, Anthropic, Google Gemini, DeepSeek, Mistral) using the user's own API keys, as well as **100% free local inference runtimes** (Ollama, vLLM, llama.cpp, LocalAI) for zero-cost or offline operation.
- **Virtual Model Aliases**:
  - `agent-planner` ➔ Claude 3.5 Sonnet / Gemini 1.5 Pro / local Qwen-2.5-72B
  - `agent-coder` ➔ DeepSeek-V3 / Haiku / local DeepSeek-Coder
  - `agent-reviewer` ➔ Claude 3.5 Sonnet / GPT-4o / local Qwen-Coder
  - `agent-arbiter` ➔ Claude 3.5 Sonnet / GPT-4o / local Qwen-2.5-72B (Neutral Arbiter for Escalation Decision Memos, Requirement N8)
- **Circuit Breaker**: Detects consecutive HTTP 429/500 errors (threshold: 3) and automatically switches to configured fallback providers within 2 seconds.
- **Token Spend Governance (Budget Safety Valve)**:
  - Spend tracking is strictly an **anti-runaway safety valve** to prevent infinite loops from overspending on commercial token bills.
  - Per-task spend limits (`spendLimitUSD`, e.g. $3.00 max).
  - Daily project spend caps (`dailySpendCapUSD`).
  - Stuck-detector heuristic: 4 identical action-observation pairs or 3 identical diffs halts execution immediately.
  - When using local models (Ollama/vLLM), spend tracking registers $0.00.
- **Granular Token & Cost Ledger (`llm_calls`)**:
  - Every model invocation logs to an internal ACID PostgreSQL fact table (`llm_calls`) recording `task_id`, `persona`, `model`, `provider`, `input_tokens`, `output_tokens`, `cache_read_tokens`, and `cost_usd`.
  - **Prompt Cache Tracking**: Explicitly monitors `cache_read_tokens` to measure the cost-saving ROI of Layer 1 Topological Repo Map caching across turns.
- **Prompt Compilation Harness (ADR-068 — Phase 2)**: A DSPy-inspired internal tool (`pnpm prompts:compile`) programmatically optimizes Dev-Level-1, Dev-Level-3, and Dev-Level-2 system prompts per target model. Prompts are stored as typed modules in `prompts/` with associated evaluation suites. When the active model alias changes (e.g., Claude → Qwen-72B), compilation runs automatically and commits the highest-scoring prompt variant. Eliminates manual prompt tuning when switching models.
- **Framework Guardrails (ADR-069)**: CrewAI, LangChain, and visual drag-and-drop builders (Flowise, Langflow, Dify, n8n) are permanently excluded. Roleplay-orchestration frameworks produce unpredictable emergent state; visual builders generate unmaintainable spaghetti logic with no Git diff or CI/CD integration. LangGraph validates our existing Configurable Gate Policy approach (§8) — we achieve equivalent human-in-the-loop control without adopting it.
- **CLI Subscription Auth Bridge — Topology A (ADR-081 Pattern 4)**: Solo developers with existing Claude Pro/Max or ChatGPT Plus subscriptions can use their CLI OAuth session tokens instead of a separate API key for `delegate-fleet.v1` lanes in Topology A. Configured via `"cliSubscriptionAuth"` in `project.config.json`. Dollar-based `spendLimitUSD` accounting is replaced by wall-clock caps (ADR-058) and turn-count limits when CLI subscription auth is active. The `llm_calls` ledger records `cost_usd = null` and `provider = "cli-subscription-{provider}"`. **Topology B/C only**: config block is silently ignored, ensuring multi-user RBAC and ZDR constraints are never bypassed.

### 6.1 System-One Decision Layer (Jev Pattern & DecisionGate Service — ADR-079)
- **Concept & Motivation**: Routine classification, triage, and routing decisions in the hot path previously burned thousands of expensive frontier tokens and incurred 3–8s delays. The `DecisionGate` service (`services/decision-gate.ts`) introduces a Fastify-native discriminative classification middleware powered by "System One" models (70–500ms latency, ~$0.042/M tokens, free output decoding).
- **Core Standardized Gates**:
  - **Gate 1: Pre-Flight Sandbox Tier Classifier (ADR-013)**: Classifies tasks into `tier-0-mock`, `tier-1-shared-db`, or `tier-2-isolated-db` before provisioning containers. Pre-empts 60–80% of unnecessary Dev-Level-1 Planner tier selection calls at 400x lower cost.
  - **Gate 2: Configurable Gate Policy Auto-Router (ADR-007)**: Scores PR risk (`low`, `medium`, `high`, `critical`) and sensitive file access to auto-promote low-risk verified patches to `auto` or escalate high-risk changes to `mandatory-human`.
  - **Gate 3: relay.mjs Tool-Call Pre-Authorization (ADR-037)**: Pre-authorizes top-level `bash_execute` agent tool invocations against destructive actions (`rm -rf`, `DROP TABLE`, secret exfiltration) as an additive speed-bump prior to OS/Git guards.
  - **Gate 4: Two-Strike Loop Fast-Fail Pre-Screen (ADR-056 / ADR-083)**: Pre-screens test failure output and executes deterministic AST/code guards (`test-guard` for mock abuse/0-assertion vacuity, `clean-code-guard` for swallowed errors/unhandled rejections/zombie code). Confident logic errors and guard violations dispatch an accelerated Strike-1 rework brief without burning debate tokens; fatal Strike-2 escalations always require full ADR-056 debate confirmation.
- **Confidence Threshold Escalation Fallback**:
  - If gate confidence $< 0.85$ (or $< 0.90$ for security/gate routing), execution seamlessly falls back to full frontier reasoning. The gate never degrades system correctness.
- **Data Residency & Deployment Topologies**:
  - **Topology A (Sovereign / Raspberry Pi 5)**: Local open-weight OpenJev/SemIf/Laya model via Ollama ($\le$4B parameters, $\le$512MB RAM ceiling, 0 bytes egress).
  - **Topology B (Enterprise Self-Hosted)**: Private OpenJev inference server or TypeSafe AI Jev API via Private VPC (Contractual ZDR).
  - **Topology C (BYOC / Hybrid SaaS)**: TypeSafe AI Jev commercial API with informed consent badge.

---

## 7. Project Onboarding & Setup Lifecycle

When a new project is created in Graywolf, it passes through a guided onboarding flow:
1. **Source Control Connection**: Git remote verification via `repo-sdk` — supports GitHub, GitLab, Bitbucket Cloud, Azure DevOps, and Gitea. Authenticates via PAT, SSH key, or OAuth.
2. **Persona Selection** (ADR-081 Pattern 3): **Maker** (non-technical Founder / PM using Graywolf for Greenfield) or **Developer** (engineer, default for all Brownfield projects). Stored as `"ui": { "persona": "maker" | "developer" }` in `project.config.json`; changeable at any time via Cockpit settings.
3. **Operational Mode Selection**: Greenfield vs. Brownfield. Maker persona is only available for Greenfield; Brownfield always enforces Developer persona.
3. **Reconnaissance Scan** (if Brownfield): Generates `recon-report.md` and proposes blast-radius boundaries.
4. **Constitution Alignment & Ecosystem Convention Discovery** (Detailed spec: [`project-constitution.md`](file:///home/tarikelmallah/Projects/GraywolfSquad/docs/architecture/project-constitution.md)):
   - Defines or imports coding standards, forbidden practices, and quality benchmarks into `.agents/constitution.md`.
   - Automatically detects and ingests existing repo convention files (`AGENTS.md`, `CLAUDE.md`, `.cursorrules`, `.windsurfrules`) following the ADR-038 precedence cascade.
5. **Model Routing Configuration**: Assigns provider keys, virtual aliases, fallbacks, and daily spend limits.
6. **Gate Policy Configuration**: Sets the default review gate behavior per task risk level (auto-approve, AI PM, human, mandatory-human). See §8.
7. **Skills & Personas Import**: Binds relevant agent skills (e.g., BMAD personas, domain libraries).
8. **Ambiguity Resolution**: If a requirements document is provided, the platform asks up to 5 targeted clarification questions (Clarification Protocol, §4.3) before emitting the first backlog task.
9. **External PM Integration** (optional): Connects to Jira, Linear, GitHub Issues, or GitLab Issues for bidirectional task sync. See §10.
10. **Artifact Generation**: Emits validated `project.config.json` and initializes task tracking directory.

---

## 8. Configurable Gate Policy System

The final approval gate after QA Guards is **not hard-coded as human-only**. Instead, it is a configurable policy engine that allows different gate types based on task risk level:

### 8.1 Gate Types

| Gate Type | Behavior | Use Case |
|---|---|---|
| `auto` | Auto-approve if all guards pass and tests are green. No human or AI review. | Low-risk: style fixes, comment updates, simple refactors |
| `ai-pm` | An AI agent with a configurable persona (e.g., Product Manager, Security Officer) reviews the diff and test results against acceptance criteria. Auto-approves or flags concerns. | Medium-risk: feature implementations, bug fixes |
| `human` | Human developer reviews in the UI. Default for most tasks. | Standard-risk: any task without explicit override |
| `mandatory-human` | Cannot be overridden. Always requires human sign-off. | High-risk: schema migrations, auth changes, CI/CD, anything in Forbidden scope escalations |

### 8.2 Gate Policy Configuration & DecisionGate Auto-Router (ADR-007, ADR-079)
- **Configurable Defaults**: Defined in `project.config.json` by task tags:
```json
"gatePolicy": {
  "default": "human",
  "byTaskTag": {
    "simple-bugfix": "auto",
    "feature": "ai-pm",
    "schema-change": "mandatory-human",
    "security": "mandatory-human"
  }
}
```
- **DecisionGate Auto-Routing (ADR-079 Gate 2)**:
  - Fastify Control Plane evaluates patch risk score (`low`, `medium`, `high`, `critical`) and sensitive scope touches synchronously upon review completion.
  - Score `low` + green tests + confidence $\ge 0.90$ auto-promotes tasks to `auto` (zero human review latency for clean routine fixes).
  - Score `high`/`critical` or auth/billing scope touches automatically enforces `mandatory-human`.
  - Decisions are persisted to `task_gate_decisions` and stamped as a badge in the PR review packet.

### 8.3 AI PM Agent Configuration
When `gatePolicy` is set to `ai-pm`, the reviewer agent is configurable:
```json
"aiReviewer": {
  "persona": "Product Manager",
  "modelAlias": "agent-reviewer",
  "systemPrompt": "You are a senior product manager reviewing code changes...",
  "strictnessLevel": "medium",
  "canEscalateToHuman": true
}
```
- The AI PM receives the same **review packet** a human would see: diff, test results, plan compliance, guard verdicts, and task acceptance criteria.
- If `canEscalateToHuman` is true and the AI PM is uncertain (confidence below threshold), it escalates to human instead of auto-approving.
- Every AI PM decision is logged to an immutable audit trail for traceability.

### 8.4 Native Source Control PR Delivery & The 60-Second Review Packet
(Detailed spec: [`docs/architecture/review-gates-and-guardrails.md`](file:///home/tarikelmallah/Projects/GraywolfSquad/docs/architecture/review-gates-and-guardrails.md))
- **Native VCS Review**: Code reviews are conducted via standard **Pull/Merge Requests** (GitHub, GitLab, Bitbucket via `repo-sdk`) rather than custom in-app diff software.
- **The 60-Second Executive Review Packet** (PR Body):
  1. **10-Second Executive Summary**: Core problem solved, blast-radius scope compliance, turns and spend metrics, and Decision Gate risk badge.
  2. **Quality Gate Compliance Table**: Status badges for blast radius, unit tests, Playwright E2E tests, security/secret scans, and license checks.
  3. **Dual-Axis Review Matrix (ADR-083)**: Explicit separation of Dev-Level-2 review status into **Standards Axis** (linter, architecture boundaries, error handling, typing) vs. **Spec Axis** (functional acceptance criteria fulfillment from `brief.md`).
  4. **Docs-Guard AST Symbol Verification (ADR-083)**: Deterministic validation badge confirming that all exported symbols, types, CLI flags, or configuration keys referenced in the PR description, README diff, or docstrings exist in `changes.patch` (prevents docs-vs-code drift).
  5. **Browser Smoke Test Findings (ADR-076)**: Structured findings table (severity P0/P1/P2, repro steps, observed vs expected) from the `e2e explore` smoke gate.
  6. **Visual Proof Artifacts**: Embedded Playwright UI screenshots, WebM video traces, and cache replay indicators (`cached` vs `live`).
  7. **Scoped File Diff Breakdown**: Clear list of modified, added, and deleted files within allowed boundaries.
- **PR Review Comment Feedback Loop**:
  - Webhooks catch review comments left on the PR.
  - The orchestrator awakens the task sandbox, injects the developer's feedback into Dev-Level-1/3, applies the fixes, re-runs tests, and pushes an updated commit to the PR branch.
- **6 Non-Negotiable Human Approval Gates**:
  1. Blast-radius scope escape (attempting to touch Read-Only or Forbidden files).
  2. Destructive / irreversible DDL operations (`DROP TABLE`, `TRUNCATE`, destructive migrations).
  3. Security / secret exposure (hardcoded credentials, critical CVEs, copyleft licensing).
  4. Merging into protected branches (`main`, `release/*`).
  5. Per-task budget / spend ceiling exceeded (`spendLimitUSD`).
  6. Two-strike internal review rejection by Dev-Level-2.
- Custom reviewer personas beyond PM are supported (e.g., "Security Officer", "UX Lead") — each with their own system prompt and evaluation criteria.

### 8.5 Error Taxonomy & Diagnostic Failure Handling (ADR-042)
(Detailed spec: [`docs/architecture/error-taxonomy-and-structured-codes.md`](file:///home/tarikelmallah/Projects/GraywolfSquad/docs/architecture/error-taxonomy-and-structured-codes.md))
- Machine-readable, domain-prefixed error classification (`AUTH_*`, `RBAC_*`, `TASK_*`, `SANDBOX_*`, `RELAY_*`, `LLM_*`, `GIT_*`).
- Standardized wire schema `{ code, message, details, retryable, timestamp }` shared across Fastify REST, ARP WebSockets, and in-container `result.json`.
- Enforces Casbin RBAC evaluation on `/tasks/{taskId}/review-gate/approve`, returning `RBAC_MERGE_NOT_AUTHORIZED` (HTTP 403) if a non-lead/owner attempts to trigger VCS merges.

### 8.6 Parallel Bug Bash Sprint Pattern (ADR-078)
- **First-Class Task Type (`bug-bash-sprint`)**:
  - Spawned via Chat Cockpit (`create_task type=bug-bash-sprint areas="checkout,auth" personas="first-time,returning"`) or Kanban board.
  - Orchestrator fans out parallel **`qa-explore-<area>`** child tasks (one per area $\times$ persona combination, up to `maxExplorers: 8` on Enterprise, `1` on Topology A) via `delegate-fleet.v1`.
  - Each child explorer runs under strict budget caps (`maxTurns: 6`, `timeout: 180s`, `spendLimitUSD: $0.50`).
- **"No Repro, No Bug" Confirmation Protocol**:
  - Candidate findings from exploratory sessions are classified as `CANDIDATE`.
  - Requires a **`qa-repro-<issue>`** child subtask: Dev-Level-3 authors a minimal failing test. The finding is promoted to `CONFIRMED` only when the repro test fails for the reported reason.
  - Hallucinated or non-reproducible findings are flagged `UNCONFIRMED` and downgraded to P2 advisory.
- **Automatic Backlog Promotion**:
  - Every `CONFIRMED` bug automatically generates a `fix:<issue>` task in the project backlog with the failing repro test as its acceptance criterion and blocker dependency.
- **Budget Governor**: Hard aggregate sprint spend cap (`maxExplorers * $0.50`), monitored in real-time with automatic cancellation if exceeded.

---

## 9. Continuous Learning Engine
(ADRs: [ADR-057](file:///home/tarikelmallah/Projects/GraywolfSquad/docs/decisions.md) · [ADR-058](file:///home/tarikelmallah/Projects/GraywolfSquad/docs/decisions.md) · [ADR-059](file:///home/tarikelmallah/Projects/GraywolfSquad/docs/decisions.md) · [ADR-060](file:///home/tarikelmallah/Projects/GraywolfSquad/docs/decisions.md) · [ADR-061](file:///home/tarikelmallah/Projects/GraywolfSquad/docs/decisions.md) · [ADR-062](file:///home/tarikelmallah/Projects/GraywolfSquad/docs/decisions.md) · [ADR-063](file:///home/tarikelmallah/Projects/GraywolfSquad/docs/decisions.md) · [ADR-064](file:///home/tarikelmallah/Projects/GraywolfSquad/docs/decisions.md) · [ADR-083](file:///home/tarikelmallah/Projects/GraywolfSquad/docs/decisions.md))

Graywolf Squad's learning engine is deeply inspired by the **Hermes Agent** (Nous Research, MIT) closed-loop learning system — the only open-source agent with a true closed learning loop. We adapt its most impactful patterns to fit Graywolf's task-based, multi-agent, container-isolated architecture.

### 9.1 The Full Learning Loop

```
  Task Completed ──► Background Reflection Job ──► Extract Lessons ──► Store / Update
       ▲              (BullMQ low-priority)              │                     │
       │                                          Project Memory          Skill Library
       │                                         (PostgreSQL +             (.agents/skills/)
       │                                           pgvector)                    │
       └──────── Inject Context into Next Task Plan ◄────────────────────────────┘
                (Semantic search at planning time)
```

### 9.2 Three-Tier Learning Architecture

| Tier | What It Learns | Trigger | Storage |
|---|---|---|---|
| **Project Memory** | Coding conventions, past decisions, solved bugs, human feedback/corrections | Auto-extracted from review gate corrections, QA guard patterns, successful completions | PostgreSQL + `pgvector` (searchable, embeddable) |
| **Skill Library** | Reusable procedures (e.g., "how to add a new API endpoint in this project") | Generated when a task pattern is completed successfully 2+ times, or when a human correction is generalizable | Markdown files in `.agents/skills/` (compatible with `agentskills.io` standard) |
| **Anti-Pattern Registry** | Known failure modes (e.g. mock abuse, error swallowing, 'never import library X — conflicts with Y') | Extracted from Gate 4 deterministic guard failures (`test-guard`, `clean-code-guard`), ADR-056 debate rejections, and human rejections | PostgreSQL + `pgvector` searchable index, injected as negative constraints into planner context |

### 9.3 Background Reflection Loop (ADR-057 — Hermes Background Review)

The **Background Reflection Job** fires after every task reaches terminal state (completed, review-requested, blocked, or failed). It runs as a low-priority BullMQ job — never blocking the main task queue.

**Three-axis reflection prompt (Hermes-faithful + ADR-083):**
- **Project Memory axis**: Did this task reveal architectural patterns, environment quirks, user preferences, or codebase conventions worth remembering?
- **Skill Library axis**: Did this task yield a non-trivial procedure, a fix pattern, a debugging path, or a workflow correction? Auto-generate or patch the relevant skill.
- **Anti-Pattern axis (ADR-083)**: Did this task trigger Gate 4 guard failures (`test-guard`, `clean-code-guard`) or ADR-056 debate rejections? Store the failure pattern in the PostgreSQL + `pgvector` Anti-Pattern Registry to inject as negative constraints during future Dev-Level-1 planning.

**Skill Authoring Standard (Hermes-strict):**
- `name`: lowercase-hyphenated, ≤64 chars; `description`: ONE sentence, ≤60 characters, ends with period, no marketing words.
- `version`: starts at `0.1.0`.
- Body order: Title → When to Use → Prerequisites → How to Run → Quick Reference → Procedure → Pitfalls → Verification.
- `references/` for on-demand depth; `scripts/` for re-runnable scripts; `templates/` for boilerplate.

**DO NOT capture as skills:**
- Environment-dependent failures (missing binaries, unconfigured creds).
- Negative claims about tools ("X doesn't work") — these become stale refusals after the tool is fixed.
- Session-specific transient errors that resolved before task end.
- One-off task narratives that aren't a generalizable class.
- Unresolved failures — never dress up dead ends as recommended workflows.

**Skill classification:**
- `agent-created` (curator-managed, auto-patchable) · `user-created` (never auto-patched) · `pinned` (never auto-archived)

### 9.4 Human Gate Learning
The highest-signal learning source is the delta between what the agent produced and what the human actually shipped:
1. When a human rejects a diff and provides feedback, or modifies code before merging, the system diffs `agent_output` vs. `final_merged_code`.
2. Classifies the correction type: logic error, convention violation, missing edge case, performance issue, etc.
3. Stores the correction as a searchable lesson in Project Memory.
4. Injects relevant lessons into future planner contexts for tasks with similar file scopes, tags, or keywords.

### 9.5 Skill Curator — Autonomous Skill Library Maintenance (ADR-063 — Hermes Curator)

A **weekly BullMQ cron job** maintains skill library quality. Only operates on `agent-created` skills.

| Lifecycle Transition | Threshold | Reversible? |
|---|---|---|
| `active` → `stale` | Not used in 14 days | Yes (use the skill) |
| `stale` → `archived` | Not used in 30 days | Yes (restore from `.archive/`) |
| `archived` → `deleted` | Archived 90+ days | Operator approval required |

**LLM Consolidation Pass** (opt-in, `curator.consolidate = true`): Produces a consolidation proposal as a markdown diff. Human approval required before applying. Identifies overlapping skills, too-narrow skills, and duplicate reference files.

### 9.6 Prompt Cache Stability Principle (ADR-061 — Hermes Cache Invariant)

> **"Per-conversation prompt caching is sacred."** — Hermes Agent AGENTS.md

The system prompt (`brief.txt` + project context + injected skills + tool definitions) is assembled **once** at container boot and remains **byte-for-byte identical** for the session lifetime. No mid-session skill injection, toolset changes, or context rebuilds are permitted. The only exception is context compression (ADR-060). This keeps every turn after the first cache-warm, dramatically reducing latency and cost on multi-turn sessions.

### 9.7 Context Compression via Auxiliary Model (ADR-060 — Hermes Compressor)

When estimated token usage exceeds **80% of the active model's context window**, a cheap auxiliary model (Gemini Flash Lite / Haiku via LiteLLM) compresses the middle of the conversation:

- **Protected Head**: System prompt + task brief + first 2 turns — NEVER summarized.
- **Protected Tail**: Last 8 turns — NEVER summarized.
- **Compressible Middle**: All turns between head and tail.
- **Deterministic Fallback**: If auxiliary model stalls, use heuristic summary (tool call names + 200 chars per turn) rather than failing.

Full uncompressed history is always stored in PostgreSQL for Dev-Level-2 access and operator audit.

### 9.8 Stall Detection Guardrails (ADR-058 — Hermes Tool Guardrails)

Detects and halts agent loops that make no forward progress:

| Pattern | Detection | Response |
|---|---|---|
| Exact-failure streak | Same command + same failure output 3× consecutive | Warn; hard-interrupt at 5× |
| Multi-call cycle | A→B→A→B... pattern (period ≤4) with identical args + results | Warn at 3 laps; hard-interrupt at 5 laps |
| Per-turn cap | >50 terminal commands in one turn | Hard-cap, inject nudge |

On hard-interrupt: mark task `STALL_ESCALATED`, increment Two-Strike counter, attach stall report.

### 9.9 Container Terminal-State Protocol Contract (ADR-059 — Hermes Kanban Stop)

Every container run **MUST** write `.agent_status.json` before exit:
```json
{ "status": "patch_ready" | "blocked" | "needs_clarification",
  "summary": "...", "artifacts": ["path/to/file.diff"], "exit_reason": "..." }
```
If a container exits rc=0 without a status file:
- **Nudge 1**: Synthetic re-entry with protocol violation message. Max 2 attempts.
- **After 2 failed nudges**: `protocol_violation` status, Two-Strike increment, escalate to human.

### 9.10 Verification Evidence Ledger (ADR-062 — Hermes Verification)

A **passive SQLite ledger** at `<worktree>/.agent_evidence.db` records every test, lint, typecheck, and build command silently — without blocking task execution.

Dev-Level-2 (ADR-056 adversarial debate) cross-checks findings against the ledger:
- `agreed P0/P1` finding claiming "tests fail" **must** have a matching failing `test` event.
- If no evidence event exists → auto-downgrade to P2 (advisory) with note: "No verification evidence found; claim is unverifiable from the diff alone."

### 9.11 Trajectory Compression for Fine-Tuning (ADR-064 — Phase 3 / Hermes Research)

Every successful task that passes Dev-Level-2 review without any `agreed P0/P1` findings is a high-quality **training trajectory**. Phase 3 introduces an opt-in pipeline (disabled by default, `dataset.collect = true`) to:
1. Compress trajectories using the protect-head / protect-tail / summarize-middle strategy.
2. Redact all credentials, project-specific names, and sensitive content.
3. Output OpenAI-compatible JSONL suitable for fine-tuning on any major provider.

Storage: `.agents/dataset/trajectories/YYYY-MM/`. Operator-controlled retention. Privacy gate is mandatory.

---

---

## 10. Integrations & Provider Abstraction

### 10.1 Git Provider Abstraction (Core — Day 1)
All Git hosting operations pass through a **provider-agnostic abstraction layer** using `repo-sdk` (MIT, TypeScript, zero dependencies):

| Provider | Status | Library |
|---|---|---|
| GitHub | ✅ Required | `repo-sdk` + `octokit` fallback |
| GitLab | ✅ Required | `repo-sdk` + `@gitbeaker/rest` fallback |
| Bitbucket Cloud | ✅ Required | `repo-sdk` |
| Azure DevOps | ⬜ Nice-to-have | `repo-sdk` |
| Gitea / Forgejo | ⬜ Nice-to-have | `repo-sdk` |

The abstraction layer also handles **webhook registration** per provider, enabling Graywolf to receive push events, PR/MR comments, and CI status updates that trigger task state changes.

### 10.2 External Project Management Integration (Phase 2)
By default, Graywolf ships with an **internal Kanban board** backed by the `.agents/tasks/` filesystem. Optionally, users can enable bidirectional sync with external PM tools:

| Provider | Library | Sync Direction |
|---|---|---|
| GitHub Issues | `octokit` (MIT) | Bidirectional |
| Jira Cloud | `jira.js` (MIT) | Bidirectional |
| Linear | `@linear/sdk` (MIT) | Bidirectional |
| GitLab Issues | `@gitbeaker/rest` (MIT) | Bidirectional |

**Sync Rules**:
- Task created in Graywolf → mirrored as issue in external tool.
- Issue created in external tool → imported as task in Graywolf (webhook-triggered).
- Status changes sync bidirectionally.
- **Conflict resolution**: Graywolf is source of truth for execution state; external tool is source of truth for human-facing metadata (labels, assignees, epics).

**Note**: [Kaneo](https://usekaneo.com/) (TypeScript, MIT-ish) is worth evaluating as the internal Kanban engine — it has built-in GitHub sync and an MCP endpoint for AI agent integration.

---

## 11. Multi-Tenancy, Team Collaboration & SaaS Deployment
(Detailed spec: [`docs/architecture/multi-tenancy-and-deployments.md`](file:///home/tarikelmallah/Projects/GraywolfSquad/docs/architecture/multi-tenancy-and-deployments.md))

### 11.1 Tenant Isolation from Day 1
- **Composite Tenancy Keys**: Every database table and vector embedding is strictly scoped by `org_id` and `workspace_id`.
- **PostgreSQL Row-Level Security (RLS)**: Enforced across all tables containing `workspace_id`. Even in cases of developer query oversight, PostgreSQL physically prevents cross-tenant data leaks.
- **Data Model Hierarchy**: `Organization` (billing, LiteLLM keys) ➔ `Workspace` (collaboration scope) ➔ `Project` (Git remote, blast-radius rules) ➔ `Task` (execution unit).

### 11.2 Dashboard-Driven Team Mode
- **Zero-Config Solo Mode (Default)**: First boot (`docker compose up`) seeds a local admin user and default personal workspace. Developers code immediately with zero login friction.
- **One-Click Team Upgrade**: In Settings ➔ Team, clicking `[ Enable Team Workspace ]` upgrades the workspace and immediately emits an authenticated **Shareable Invite Link**. No container reboots or manual `.env` file modifications required.
- **4 Lean RBAC Roles**:
  - `Owner`: Manages billing, LiteLLM API keys, team members, and global settings.
  - `Lead Developer`: Configures projects, blast-radius boundaries, and approves `mandatory-human` review gates.
  - `Developer`: Creates tasks, chats with the Cockpit agent, moves Kanban cards, and answers clarification subtasks.
  - `Viewer`: Read-only access to Kanban board, live logs, and visual review packets (screenshots/videos).

### 11.3 Deployment Topologies & Enterprise Hybrid BYOC
(Detailed spec: [`docs/architecture/data-residency-and-byoc.md`](file:///home/tarikelmallah/Projects/GraywolfSquad/docs/architecture/data-residency-and-byoc.md))
- **Local / Solo Self-Hosted**: Single Docker Compose stack running on localhost or Raspberry Pi.
- **Enterprise Team Self-Hosted**: Deployed on internal company VM / Kubernetes cluster with team authentication.
- **Hybrid SaaS / BYOC (Bring Your Own Compute)**:
  - Web Control Plane is hosted on Graywolf Cloud, while execution runner containers run inside the customer's private VPC/network via outbound WebSocket connections.
  - **Zero Source Code Ingestion**: Graywolf SaaS never stores or ingests customer source code or database credentials.
  - **Model Data Residency Policy**: To satisfy enterprise compliance (SOC 2, ISO 27001), model inference supports three strict residency tiers:
    1. *Tier 1 (Sovereign / Air-Gapped)*: 100% on-premise inference via Ollama / vLLM (0 bytes egress).
    2. *Tier 2 (Private VPC Peered)*: Dedicated AWS Bedrock / Azure OpenAI endpoints with Zero Data Retention (ZDR) guarantees.
    3. *Tier 3 (Public Commercial API)*: Opt-in with explicit UI badging.
  - Every Pull Request review packet includes an audit-verified **Model Data Residency Badge**.

---

## 12. Monitoring, Observability & Agent Logs
(Detailed spec: [`docs/architecture/observability-and-telemetry.md`](file:///home/tarikelmallah/Projects/GraywolfSquad/docs/architecture/observability-and-telemetry.md))

### 12.1 Unified Event Stream & User Interface (The Chat Cockpit & Dashboard)
The primary interface for developers is a web-based dashboard housing the "Chat Cockpit" and Kanban board.

- **Single Source of Truth**: All agent actions emit typed, append-only events (`tool_call`, `file_edit`, `test_run`, `cost_delta`) through Fastify WebSockets.
- **The "Panic Button" (Stop/Cancel)**: The UI must include a prominent "Cancel" button during execution. Triggering this initiates a graceful multi-layered teardown: killing the container process group, aborting LLM generation, dropping the ephemeral PostgreSQL task database, and restoring the git worktree (`git restore .`).
- **Live Spend Meter**: A running, real-time USD/token ticker visible directly above the Chat Cockpit, updating dynamically as the active container streams token consumption events via ARP.
- **Context-Aware Boot Diagnostics**: When connecting to a repo, the dashboard runs a background recon scan and suggests tasks (e.g., unmerged PRs, low test coverage) with explicitly calculated *max estimated token costs* before execution.
- **Bi-Directional Viewport Sync**: The developer's active file viewing state (in the dashboard's file explorer or IDE) is implicitly sent to the agent's context as an `@current_file` marker, eliminating "which file did you mean?" disambiguation loops.
- **Deterministic AST Semantic Diffs**: The PR review screen replaces raw 500-line diffs with a deterministic, AST-parsed semantic summary (e.g., `🛠️ Refactored: AuthService.login() - verified by Tree-sitter`). LLM-generated summary prose is strictly treated as an annotation, never as the source of truth for structural file changes.
- **Time-Travel Trajectory Inspector**: A DevTools-style timeline slider in the Kanban view that uses ADR-032 Deterministic Replay snapshots, allowing a developer to scrub backward and view exactly what files, terminal output, and internal thoughts the agent had at any specific millisecond.
- **Viewer/Client Role Dashboard**: A secondary UI view for non-technical stakeholders that strips out AST diffs, terminal traces, and internal configs. It focuses solely on: Goal, Progress Bar, Playwright Video Demos/Screenshots, and Spend.
- **Surface A: High-Level Narrative Timeline**: The default UI view in the Cockpit displaying human-readable actions ("Dev-Level-1 drafted plan", "Implementer edited auth.ts", "Reviewer executed Playwright suite").
- **Surface B: Expandable Terminal Drawer (Xterm.js)**: Raw command stdout/stderr attached to specific timeline items, expandable on demand for developers needing ground-truth verification. Eliminates UI clutter without hiding details.

### 12.2 The "Solo Dev" Productivity Suite
For single-developer environments (Topology A) where velocity is prioritized over strict bureaucratic review, the dashboard must expose the following features:
- **Auto-Merge-if-Green**: A UI toggle that bypasses the manual Human Review click *only* if the PR passes all tests (unit/Playwright) and clears all 6 mandatory gates without escalation. It does not suppress blast-radius escalations; it merely automates the approval of a verifiably safe PR.
- **DAG Branch Stacking & Batch Execution**: The UI Kanban board allows drawing dependency arrows between tasks. The orchestrator proactively boots child tasks using the parent task's branch (not `main`), enabling a solo developer to queue a massive overnight batch of work and wake up to a consolidated morning digest.
- **Proactive Backlog & Brief Generation**: The UI features a "Context Harvester / Record" button (ingesting voice memos and open IDE files) to let Dev-Level-1 proactively draft `brief.md` for human thumbs-up, paired with an org-level spend ceiling to prevent runaway batch costs.
- **Topology-Gated Live HMR Streaming**: For Topology A (local dev) only, the UI supports a short-lived WS-TGT authenticated iframe streaming the active Vite/frontend dev server out of the sandbox. This enables instant "hot reload" visual pairing via chat. (Off by default for Enterprise Topology B/C).
- **Synthetic Constitution Seed Data**: Instead of exposing real local databases to the LLM (which breaks data-residency isolation), the project `constitution.md` mandates synthetic, Faker-style fixture definitions that instantly populate the ephemeral `task_{id}` DB with realistic volume and edge cases to ensure E2E tests run against a populated schema.

### 12.3 OpenTelemetry (OTLP) Semantic Export (Enterprise Tier)
- **Zero-Dependency Default**: Self-hosted instances store metrics and call logs in internal PostgreSQL tables (`llm_calls`), requiring zero external collectors for $0 solo runs.
- **Additive OTLP Bridge**: Enterprise and Hybrid SaaS teams can enable a background exporter streaming traces directly to Datadog, Grafana, or Honeycomb using standardized `gen_ai.*` OpenTelemetry semantic conventions.

---

## 13. Security, Secrets & Credential Management
(Detailed spec: [`docs/architecture/security-and-secrets.md`](file:///home/tarikelmallah/Projects/GraywolfSquad/docs/architecture/security-and-secrets.md))

### 13.1 Zero-Prompt Column-Level Envelope Encryption
- **Frictionless Solo Mode**: Retains the "< 1s boot, zero-config" promise. On first launch, the orchestrator silently creates `~/.graywolf/master.key` (`chmod 600`) as the Key Encryption Key (KEK).
- **Data Protection**: Secrets (Git tokens, provider keys) are encrypted via `pgcrypto` (AES-256). Stolen `pg_dump` backups or volume snapshots cannot be decrypted without the host's external KEK.
- **Enterprise Upgrade**: Pluggable integration with HashiCorp Vault, AWS KMS, or GCP Cloud KMS for enterprise team deployments.

### 13.2 Out-of-Band Secrets Proxy (Zero Environment Exposure)
- **No Plaintext Env Vars**: Real secrets are structurally barred from being injected as standard environment variables in the task container, preventing accidental `console.log(process.env)` leaks.
- **Git Credential Helper**: Git operations authenticate via a local Unix socket proxy providing short-lived, scoped tokens.
- **Secrets Broker Sidecar**: Third-party test API keys (Stripe, Twilio) route through a container-local sidecar that substitutes dummy placeholders with real keys in-flight and strips secrets from error responses.
- **Regex Secret Scrubber**: Real-time high-throughput regex filtering sanitizes all container stdout/stderr streams before persistence, terminal display, or PR generation.

### 13.3 Sandbox OS Hardening & Network Egress Allowlisting
(Detailed spec: [`docs/architecture/sandbox-hardening-and-network-egress.md`](file:///home/tarikelmallah/Projects/GraywolfSquad/docs/architecture/sandbox-hardening-and-network-egress.md))
- **Privilege De-escalation**: Dedicated non-root user (`UID 10001`), read-only rootfs (`--read-only`), all capabilities dropped (`--cap-drop=ALL`), and `no-new-privileges:true`.
- **Syscall Filtering**: Custom seccomp profile blocking dangerous kernel calls (`ptrace`, `bpf`, `sys_chroot`, namespace alterations).
- **Default-Deny Egress Firewall**: Sandboxes can only communicate with the internal LiteLLM proxy, local secrets socket, declared Git remotes, and official package registries (npm/PyPI). All other outbound traffic is dropped by kernel packet filters.

### 13.4 MCP Server Credential Redaction & Secure Probe Pattern (ADR-055)
- **Problem**: MCP server configurations in the cockpit settings UI contain credentials (OAuth tokens, API keys, env vars). The UI must never expose cleartext values once stored — yet connectivity testing requires the real values.
- **Redaction at rest**: Stored server-side via column-level envelope encryption (ADR-013). UI receives `REDACTED_MCP_SECRET_VALUE = "**********"` placeholders for all credential leaves.
- **Edit semantics**: When a user edits non-credential fields (e.g. server URL), redacted placeholders are preserved for untouched secret leaves — no accidental cleartext round-trip.
- **Probe / Connectivity Test**: Before dispatching a connectivity test, the frontend recursively merges redacted placeholder leaves with the corresponding server-side encrypted values. The probe exercises the real configuration without ever sending a cleartext secret to the browser.
- **Fresh secret edits**: New or replaced secrets flow from browser to server in a single encrypted write; the browser never re-receives cleartext after initial submission.
- **Source**: Pattern adopted from MIT-licensed `@openhands/agent-canvas` (`src/api/mcp-service/mcp-redacted-credentials.ts`).


---

## 14. Licensing Model & $0 Cost Registry

### 14.1 Core License: Elastic License 2.0 (ELv2) & Open-Core Split
(Detailed spec: [`docs/decisions.md#adr-019`](file:///home/tarikelmallah/Projects/GraywolfSquad/docs/decisions.md))
- **Graywolf Community Core (`GraywolfSquad/graywolf`)**: Licensed under **Elastic License 2.0 (ELv2)**.
  - **100% Free for Personal Use**.
  - **100% Free for Commercial Use**: Any company may self-host Graywolf to build, test, and maintain their own commercial software for $0 forever.
  - **One Restriction**: Third parties may NOT offer Graywolf's functionality as a hosted or managed cloud service.
- **Graywolf Cloud (`GraywolfSquad/graywolf-cloud`)**: Separate, private repository for commercial SaaS hosting (P1), handling Stripe billing, organization usage meters, team invite management, and managed BYOC runner coordination. Zero proprietary billing code is shipped in the Community core.
- **Contribution Policy**: Standard Developer Certificate of Origin (DCO) + lightweight license grant on GitHub Pull Requests.

### 14.2 Standard Pinned Tool Registry ($0 Platform Cost)

| Component | Library / Tool | Purpose | License | Commercial Platform Cost |
|---|---|---|---|:---:|
| **Chat UI** | `assistant-ui` | Modular React/TS chat interface for LLM streaming, tool rendering | MIT | $0.00 |
| **Git Provider Abstraction** | `repo-sdk` | Unified TypeScript API for GitHub/GitLab/Bitbucket/Azure DevOps | MIT | $0.00 |
| **AST Parsing** | `tree-sitter` | Incremental AST parsing for codebase mapping (100+ languages) | MIT | $0.00 |
| **AST Linter / Guard** | `ast-grep` | Millisecond-fast structural code and regex matching | MIT | $0.00 |
| **Secret Scanning** | `gitleaks` | High-speed static secret and credential detection in runner | MIT | $0.00 |
| **CVE & License Scanning** | `osv-scanner` | Automated dependency vulnerability and license auditing | Apache 2.0 | $0.00 |
| **Vector Embedding Engine** | `nomic-embed-text` (via Ollama) | 8192-token context local vector embeddings for pgvector | Apache 2.0 | $0.00 |
| **Codebase Mapping** | Aider `repo-map` pattern | Concise codebase summaries optimized for LLM context windows | Apache 2.0 | $0.00 |
| **Skill Standard** | `agentskills.io` | Open standard for agent skill document format | Open Standard | $0.00 |
| **Learning Loop Pattern** | Hermes Agent (Nous Research) | Persistent memory, autonomous skill creation, self-improvement | MIT | $0.00 |
| **Backend Framework** | Fastify | High-performance TypeScript HTTP + WebSocket server | MIT | $0.00 |
| **Database + Vector** | PostgreSQL 16 + `pgvector` | ACID relational + vector similarity search | PostgreSQL License | $0.00 |
| **Cache / Queue** | Valkey + BullMQ | In-memory cache + job queue | BSD-3-Clause / MIT | $0.00 |
| **Model Gateway** | LiteLLM Proxy | Unified LLM routing, rate limits, circuit breaking | MIT | $0.00 |
| **Frontend** | React + Vite + Tailwind + Shadcn UI | SPA framework + design system | MIT | $0.00 |
| **DAG Visualization** | React Flow | Interactive dependency graph viewer | MIT | $0.00 |
| **Terminal Streaming** | Xterm.js | Browser-based terminal emulator | MIT | $0.00 |
| **File Locking** | `proper-lockfile` | Atomic directory-level locking | MIT | $0.00 |
| **Jira Integration** | `jira.js` | TypeScript Jira Cloud API client | MIT | $0.00 |
| **Linear Integration** | `@linear/sdk` | Official Linear GraphQL SDK | MIT | $0.00 |
| **GitHub API** | `octokit` | Official GitHub REST + GraphQL client | MIT | $0.00 |
| **GitLab API** | `@gitbeaker/rest` | TypeScript GitLab API client | MIT | $0.00 |
| **E2E Browser Testing** | `@playwright/test` | Headless Chromium browser testing in sandbox containers | Apache 2.0 | $0.00 |
| **RBAC Policy Engine** | `casbin` (Node-Casbin) | Authorization matrix evaluated at Fastify route and tool-call gateway | Apache 2.0 | $0.00 |
| **Daemon Isolation Proxy** | `tecnativa/docker-socket-proxy` | Scoped Docker daemon proxy preventing raw host socket exposure | MIT / HAProxy | $0.00 |
| **Visual Regression** | `pixelmatch` | Pixel-level screenshot comparison for UI diffing | MIT | $0.00 |
| **Chat Cockpit Streaming** | `ai` (Vercel AI SDK) | Direct-adopt UI streaming and hook abstractions for Chat Cockpit (ADR-065) | Apache 2.0 | $0.00 |
| **Schema Validation & SDK Contracts** | `@sinclair/typebox` | Fast in-memory JSON schema compilation and ACI/Addon boundaries (ADR-066, ADR-080) | MIT | $0.00 |
| **System-One Decision Classifier** | `OpenJev` / local fine-tune (Ollama) | Fast discriminative classification and routing gate (ADR-079) | Apache 2.0 / MIT | $0.00 |

---

## 15. Resource Admission & Constrained Host Profiles
(Detailed spec: [`docs/architecture/resource-admission-and-limits.md`](file:///home/tarikelmallah/Projects/GraywolfSquad/docs/architecture/resource-admission-and-limits.md))

- **Hardware Profiler**: Automatically detects host CPU and RAM on boot (`os.totalmem()`, `os.cpus()`).
- **Constrained Profile ($\le$ 8GB RAM, e.g. Raspberry Pi 5)**:
  - Caps `maxConcurrentContainers = 1`.
  - Serializes Playwright runs with `--single-process --disable-gpu` or defaults to mock tests unless tagged `mandatory-e2e`.
  - Enforces container memory limits (`--memory=2.0g`) to prevent kernel OOM panics.
- **Standard Profile (16GB–32GB RAM)**: Default `maxConcurrentContainers = 3` with full parallel Chromium suites.
- **Weighted Admission Token Bucket**: Tasks declare weights based on DB tier and browser requirements (Tier 0 = 1.0 token, Tier 2 + E2E = 3.5 tokens). The scheduler queues tasks until capacity frees up.

---

## 16. Platform Maturity Exit Criteria (P0 Completion Bar)

Before initiating P1 commercial SaaS development (`graywolf-cloud`), the core platform must achieve the following verified operational benchmarks:
1. **5 Consecutive Real-World Brownfield Tasks Completed**: Zero container deadlocks, zero boundary escapes, and zero git conflicts.
2. **100% Gate Integrity**: Zero unauthorized modifications to protected branches or forbidden scopes.
3. **Sub-2s Container Cold Start**: Verified across repeated task runs using Tier 1 package cache.
4. **Zero External Token Leaks**: Verified 100% offline local run using Ollama (`qwen2.5-coder` + `nomic-embed-text`).

---

## 17. Software Factory & Pluggable Addon Ecosystem

(Architecture Decision: [`ADR-080`](file:///home/tarikelmallah/Projects/GraywolfSquad/docs/decisions.md#adr-080-pluggable-addon-sdk-graywolfaddon-sdk--software-factory-signal-ingestion--cockpit-relay))

### 17.1 Vision

Graywolf's Software Factory capability transforms the platform from a task-execution engine into an **autonomous, end-to-end engineering pipeline** that continuously ingests real-world telemetry and community signals, routes approved work to the virtual developer tiers, and delivers verified patch diffs — with minimal human friction. Inspired by the omni-channel signal → HITL triage → worker execution → verification → delivery pipeline pattern.

### 17.2 Five-Stage Pipeline

| Stage | Name | Description |
|---|---|---|
| 1 | **Omni-Channel Signal Ingestion** | `SignalAddon` plugins receive inbound webhook payloads from Sentry (crash reports), GitHub Issues, Discord, and other configured sources. Each payload is normalized into a `GraywolfSignalEnvelope`. In accordance with **ADR-044 (Webhook Replay & DoW Mitigation)**, inbound signals are subject to fingerprint deduplication: a deterministic hash (`signal:{workspaceId}:{fingerprintHash}`) is cached in Valkey with a configurable cooldown window (default: 3 minutes) to prevent crash storms from flooding HITL triage or exhausting token quotas. |
| 2 | **HITL Triage** | Normalized envelopes are surfaced to the Lead Developer via the active `CockpitAddon` channel (Discord, Slack, MS Teams). In Shadow Mode, drafts are audit-logged only (no Kanban write). The Lead Developer approves, rejects, or escalates via emoji reaction or slash command. |
| 3 | **Task Dispatch** | Approved signals are converted to Kanban tasks and dispatched through the existing BullMQ/Valkey queue (ADR-005). The Dev-Level-1 Planner decomposes the signal into an implementation plan using the standard virtual developer tier flow. |
| 4 | **Verification Engineering** | Existing adversarial debate review (ADR-056), E2E smoke gate (ADR-076), and System-One Decision Gate (ADR-079) apply to Software Factory tasks identically to hand-authored tasks. No special bypass. |
| 5 | **Non-Committing Delivery** | The verified patch diff and test evidence ledger (ADR-062) are posted back to the originating `CockpitAddon` channel as a 60-Second Executive Review Packet. The in-container `relay.mjs` harness never commits or pushes directly (ADR-037 relay contract). The Control Plane Orchestrator can auto-merge the resulting Pull Request via `repo-sdk` **if and only if** the task's Gate Policy evaluates to `auto` (via ADR-007 / ADR-079 Gate 2) or `Auto-Merge-if-Green` is enabled (§12.2); otherwise, the Lead Developer performs a final merge approval. |

### 17.3 `@graywolf/addon-sdk` — Pluggable Extension Boundary

All external integrations are implemented as TypeBox-validated Fastify plugins conforming to one of two contracts:

#### `SignalAddon` (Signal Ingestion — Read-Only)
- Receives inbound webhook payloads and normalizes them to `GraywolfSignalEnvelope`.
- **Banned**: `setInterval` / `setTimeout` polling. Polling-required integrations must register a BullMQ repeatable job via `relay.scheduleRepeatableJob()`.
- **Banned**: `@sentry/node` or any error-emission SDK import. Sentry data arrives as raw JSON via Sentry's outbound webhook.
- **Untrusted Payload Sanitization (ADR-025 / ADR-038)**: All string payloads inside `GraywolfSignalEnvelope` (e.g. crash stack traces, issue bodies, community messages) are strictly classified as Level 3 Untrusted Ecosystem Inputs. Before being presented to Dev-Level-1 Planner, the summarizer, or any LLM context, they MUST be wrapped in `<untrusted_signal_payload>` XML tags and sanitized against prompt-injection patterns.
- TypeBox schema stubs: [`specs/002-addon-sdk/addon-interfaces.ts`](file:///home/tarikelmallah/Projects/GraywolfSquad/specs/002-addon-sdk/addon-interfaces.ts)

#### `CockpitAddon` (Triage Relay — Write-Authorized, Scoped)
- Posts task briefs, escalations, and Executive Review Packets to an external human channel.
- Receives human intents (approve / reject / escalate) and translates them into control-plane commands.
- Permitted relay methods: `postTaskBrief()`, `postEscalation()`, `receiveHumanIntent()`.
- **Forbidden**: `executeCommand()`, any worktree I/O method, or direct `relay.mjs` invocation.
- **External Identity Binding & RBAC Enforcement**: `receiveHumanIntent()` requires a verified identity mapping in PostgreSQL (`workspace_member_identities` table linking `external_provider_user_id` $\rightarrow$ `user_id`). If an unlinked external user attempts to trigger an action (e.g. clicking an emoji reaction or typing a slash command), the Fastify gateway rejects the intent with error `ADDON_UNLINKED_EXTERNAL_USER` (HTTP 403), preventing unauthorized external approval.

### 17.4 Addon Registry — Two-Tier Trust Model

| Tier | Source | Mechanism |
|---|---|---|
| **Tier 1 — Official (`@graywolf/*`)** | Bundled monorepo | Cryptographic build-time signature |
| **Tier 2 — Community (GitHub / npm)** | Public registry | SHA-256 content-hash lock in `.agents/project.config.json` + one-time Lead Developer sign-off |

Tier 2 addons are Fail-Closed: any upstream mutation without re-approval causes a hard boot failure. Inspired by ADR-046 & ADR-054 content-hash locking precedents.

### 17.5 Shadow Mode Lifecycle

All newly installed addons begin in **Shadow Mode**:

- **Shadow → Graduated**: ≥ 20 consecutive shadow runs with < 10% human discard rate + explicit `lead_dev` promotion click in Chat Cockpit. Applies the same metric as the Guardrail Incubation pattern in `review-gates-and-guardrails.md` §7.11.
- **Graduated → Deprecated**: Manual deprecation click or 5+ consecutive human discards post-graduation.

Shadow Mode cannot be skipped for Tier 2 addons via configuration.

### 17.6 Topology A Constraints (Raspberry Pi 5 / 8GB RAM)

- **Maximum addon slots**: 3 `SignalAddon` + 1 `CockpitAddon` concurrently loaded.
- Addons are loaded lazily based on `project.config.json` configuration.
- Fastify webhook receiver mode: near-zero idle RAM.
- BullMQ-delegated polling jobs count against the existing BullMQ worker budget (ADR-005), not addon slots.

### 17.7 Credential Architecture

| Credential Type | Storage Layer |
|---|---|
| Active runtime OAuth bearer tokens (short TTL, rate-limit scoping) | Valkey (ADR-039) |
| Long-lived OAuth refresh tokens & webhook HMAC secrets at rest | PostgreSQL `secret_vault` / `pgcrypto` AES-256 envelope encryption (ADR-018) |

A Valkey flush or restart never exposes long-lived credentials; a `pg_dump` never exposes them in plaintext.

### 17.8 First-Party Addon Roadmap

| Addon | Type | Signal Source | Priority |
|---|---|---|---|
| `@graywolf/addon-sentry` | SignalAddon | Sentry crash webhook | P1 |
| `@graywolf/addon-github-issues` | SignalAddon | GitHub Issues webhook | P1 |
| `@graywolf/addon-discord-signal` | SignalAddon | Discord channel monitor | P2 |
| `@graywolf/addon-discord-cockpit` | CockpitAddon | Discord HITL triage channel | P1 |
| `@graywolf/addon-slack-cockpit` | CockpitAddon | Slack HITL triage channel | P2 |
| `@graywolf/addon-msteams-cockpit` | CockpitAddon | MS Teams HITL triage channel | P3 |

