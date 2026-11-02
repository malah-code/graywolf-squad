# Merged Markdown Files

Source folder: `/home/tarikelmallah/Projects/GraywolfSquad/docs`
Files merged: 21

---


<!-- START OF FILE: PRD.md -->

# Source: PRD.md

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



<!-- END OF FILE: PRD.md -->

---


<!-- START OF FILE: architecture/brownfield-reconnaissance-and-blast-radius.md -->

# Source: architecture/brownfield-reconnaissance-and-blast-radius.md

# Graywolf Squad — Deep-Dive Architecture: Brownfield Reconnaissance & Blast-Radius Engine

## 1. Executive Summary & Purpose

When Graywolf Squad integrates into an enterprise brownfield repository (e.g. an existing GitLab or GitHub accounting, ERP, or healthcare codebase), it cannot afford to guess conventions, modify protected infrastructure, or break existing CI/CD pipelines.

The **Reconnaissance Pass** is an automated, zero-token and low-token structural analysis phase executed **prior to any task execution**. It inspects the target repository to:
1. **Map Architectural Conventions**: Detect web frameworks (NestJS, Fastify, Express, Django, Spring), ORMs/ODMs (TypeORM, Prisma, Drizzle, SQLAlchemy), test harnesses (Jest, Vitest, Pytest), and package managers.
2. **Catalog CI/CD and Infrastructure Invariants**: Parse `.gitlab-ci.yml`, GitHub Actions (`.github/workflows/*`), Dockerfiles, and Helm charts to identify non-modifiable infrastructure.
3. **Generate Topological Codebase Map**: Build an AST symbol index and PageRank dependency graph via `tree-sitter`.
4. **Synthesize Initial Project Constitution**: Propose machine-executable linter rules and architectural invariants (`.agents/constitution.md`).
5. **Algorithmic Blast-Radius Proposal**: Automatically propose **Writable**, **Read-Only**, and **Forbidden** glob scopes based on feature briefs and dependency graph analysis, preventing accidental modifications to core infrastructure.
6. **Emit `recon-report.md`**: Produce an actionable audit report for the human lead engineer's review and sign-off during onboarding.

---

## 2. The 5-Phase Reconnaissance Pipeline

```
                             [Git Remote Cloned via repo-sdk]
                                            │
                                            ▼
┌───────────────────────────────────────────────────────────────────────────────────────┐
│ PHASE 1: MANIFEST & INFRASTRUCTURE SCAN (Deterministic, 0 tokens, < 1s)               │
│ - Parse package.json, pom.xml, requirements.txt, pyproject.toml, go.mod, Cargo.toml   │
│ - Identify CI/CD configs (.gitlab-ci.yml, .github/workflows/*.yml)                    │
│ - Catalog environment templates (.env.example) and database migrations                │
└───────────────────────────────────────────┬───────────────────────────────────────────┘
                                            │
                                            ▼
┌───────────────────────────────────────────────────────────────────────────────────────┐
│ PHASE 2: TREE-SITTER AST SYMBOL EXTRACTION (0 tokens, < 5s)                           │
│ - Parse all source files across supported languages using tree-sitter grammars        │
│ - Extract classes, methods, exported functions, interfaces, and import statements     │
│ - Populate internal Code Intelligence database (code_symbols & code_references)       │
└───────────────────────────────────────────┬───────────────────────────────────────────┘
                                            │
                                            ▼
┌───────────────────────────────────────────────────────────────────────────────────────┐
│ PHASE 3: DEPENDENCY GRAPH & CENTRALITY (0 tokens, < 2s)                               │
│ - Build directed graph G = (V, E) of modules and file import relationships             │
│ - Run PageRank algorithm to identify core utilities and leaf modules                  │
│ - Detect tightly coupled module clusters (Louvain modularity / Tarjan SCC)            │
└───────────────────────────────────────────┬───────────────────────────────────────────┘
                                            │
                                            ▼
┌───────────────────────────────────────────────────────────────────────────────────────┐
│ PHASE 4: BLAST-RADIUS BOUNDARY PROPOSAL ALGORITHM (Deterministic + Graph Boundary)   │
│ - Auto-classify Protected Core (.github/**, .gitlab-ci.yml, src/core/auth/**) ➔ FORBIDDEN│
│ - Identify feature module root based on feature brief keywords                        │
│ - Compute transitive upstream dependencies & bounded downstream dependents ➔ READ-ONLY   │
│ - Designate feature implementation directories and tests ➔ WRITABLE                   │
└───────────────────────────────────────────┬───────────────────────────────────────────┘
                                            │
                                            ▼
┌───────────────────────────────────────────────────────────────────────────────────────┐
│ PHASE 5: RECON REPORT SYNTHESIS & CONSTITUTION DRAFTING (Dev-Level-1, ~2,000 tokens) │
│ - Synthesize recon-report.md detailing tech stack, dependencies, and risk areas       │
│ - Author initial .agents/constitution.md runtime draft for human lead sign-off        │
└───────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Heuristic Framework & Tooling Detection Matrix

During Phase 1, Graywolf evaluates deterministic signatures to fingerprint the repository without LLM invocation:

| Domain | Target Files / Signatures | Detected Technology | Default Test / Lint Commands |
| :--- | :--- | :--- | :--- |
| **Node / TS** | `package.json` with `@nestjs/core` | **NestJS** | `npm test`, `npm run lint` |
| **Node / TS** | `package.json` with `fastify` | **Fastify** | `npm test`, `npm run lint` |
| **Node / TS** | `package.json` with `next` | **Next.js** | `npm run build`, `npm run lint` |
| **Go** | `go.mod` | **Go Module** | `go test ./... -race`, `golangci-lint run` |
| **Python** | `requirements.txt` / `pyproject.toml` with `fastapi` | **FastAPI** | `pytest`, `ruff check .` |
| **Python** | `requirements.txt` / `pyproject.toml` with `django` | **Django** | `python manage.py test`, `flake8` |
| **Rust** | `Cargo.toml` | **Rust Crate** | `cargo test`, `cargo clippy` |
| **Java** | `pom.xml` / `build.gradle` (with Spring Boot) | **Spring Boot** | `mvn test` / `./gradlew test`, `checkstyle` |
| **C# / .NET** | `*.csproj` / `*.sln` | **.NET Core** | `dotnet test`, `dotnet format --verify-no-changes` |
| **PHP** | `composer.json` (with Laravel / Symfony) | **Laravel / Symfony** | `vendor/bin/phpunit`, `vendor/bin/phpstan` |
| **ORM / Data** | `prisma/schema.prisma` | **Prisma** | Migration tier 2: `prisma migrate dev` |
| **ORM / Data** | `package.json` with `typeorm` | **TypeORM** | Migration tier 2: `typeorm migration:run` |
| **ORM / Data** | `alembic.ini` | **Alembic** | Migration tier 2: `alembic upgrade head` |
| **CI / CD** | `.gitlab-ci.yml` | **GitLab CI** | Auto-classified into **Forbidden Scope** |
| **CI / CD** | `.github/workflows/*.yml` | **GitHub Actions**| Auto-classified into **Forbidden Scope** |

---

## 4. The Blast-Radius Boundary Proposal Algorithm

When a human developer creates a brownfield project or submits an initial feature brief (e.g., *"Implement VAT calculation and invoicing in the billing module"*), Graywolf executes the **Blast-Radius Boundary Proposal Algorithm**:

### 4.1 Step-by-Step Boundary Resolution

1. **Rule 0: Absolute System Forbidden Defaults (Non-Overridable)**:
   - Always placed in **Forbidden Scope**:
     - **VCS & CI/CD**: `.git/**`, `.github/**`, `.gitlab-ci.yml`, `bitbucket-pipelines.yml`, `Dockerfile*`, `helm/**`, `docker-compose*.yml`
     - **Platform Control Files**: `relay.mjs`, `.agents/constitution.md`, `.agents/project.config.json`
   - *Note on Package Manifests (F14)*: Package manifests (e.g., `package.json`, `package-lock.json`, `go.mod`, `go.sum`, `Cargo.toml`, `Cargo.lock`) are intentionally excluded from Rule 0, as mid-task dependency installation is a supported flow. However, making manifests writable introduces two non-negotiable architectural requirements:
     1. **Distributed Manifest Write Serialization (F14 Prerequisite)**: 
        - **Pre-Dispatch Scope Overlap**: If Dev-Level-1 explicitly declares manifests in `writableScope` at dispatch, ADR-031's Pre-Dispatch Scope Overlap Checker automatically queues the task behind any other task declaring the same manifest.
        - **Mid-Task Dynamic Lock**: If Dev-Level-3 dynamically invokes a package manager (`npm install`, `go get`, `cargo add`) or modifies a manifest mid-task, `relay.mjs` intercepts the command and requests a distributed mutex from the Orchestrator via ARP message `manifest.lock.acquire`.
        - **Redis Mutex Mechanics**: The Orchestrator holds the lock at `workspace:{workspace_id}:lock:manifest:{hash(manifest_path)}` with a 60-second TTL and an active keep-alive heartbeat while the package manager executes. Queued tasks wait with exponential backoff + jitter (up to a 120-second timeout). If the lock times out, the command fails cleanly with `MANIFEST_LOCK_TIMEOUT`.
        - **Pre-Mutation Sync & Post-Mutation Verification**: Before writing, the container verifies its local base manifest is aligned with upstream. After writing, it executes `go mod verify` or `npm ls` to confirm lockfile integrity before releasing the lock.
     2. **Orchestrator Source of Truth (F14 Invariant)**: 
        - Because the container's `go.mod` is mutable by the agent, guards such as the Go Import Validator and TypeScript Module Resolver MUST source the canonical module path and dependency allowlists from the orchestrator-side **recon report** (`recon-report.json`), NEVER from the container's mutable `go.mod` on disk. This prevents an agent from manipulating module paths to bypass import bans.
2. **Step 1: Feature Root Identification**:
   - Matches brief keywords against the file tree. (e.g. "VAT calculation in billing" matches directory `src/modules/billing/**`).
   - Declares primary target: `src/modules/billing/**` and corresponding tests `tests/modules/billing/**`.
3. **Step 2: Upstream Dependency Closure (AST Graph Traversal)**:
   - Traverses the directed import graph $G$ from the target module outwards:
     $$\text{UpstreamImports} = \{ m \in V \mid \exists \text{ path } \text{target} \to m \}$$
   - Any shared models, interfaces, utility libraries, or database entities imported by the target module (e.g. `src/shared/types/**`, `src/database/models/**`) are classified as **Read-Only Scope**.
4. **Step 3: Downstream Impact Evaluation (Bounded Traversal)**:
   - Traverses reverse dependencies: modules that import the target module:
     $$\text{DownstreamDependents} = \{ d \in V \mid \exists \text{ path } d \to \text{target} \}$$
   - **Strict Traversal Boundaries (Anti-Token Bloat Guard)**:
     - **Depth Limit**: Traversal is capped at **$\text{depth} \le 1$** (direct immediate consumers only; transitive downstream consumers of consumers are excluded).
     - **Count Cap**: At most **20 direct consumer files** are placed into **Read-Only Scope** (prioritized by PageRank centrality score). Any additional consumers beyond 20 are logged to `recon-report.md` as "Downstream Regression Watchlist" but excluded from context to protect the token budget (ADR-012).
   - If downstream dependents are detected (e.g., `src/modules/checkout/checkout.service.ts` imports `billing.service.ts`), they are placed in **Read-Only Scope** and flagged in `recon-report.md` as regression risk points.

5. **Step 4: Output Proposal**:
   ```json
   {
     "writableScope": [
       "src/modules/billing/**",
       "tests/modules/billing/**"
     ],
     "readOnlyScope": [
       "src/shared/**",
       "src/database/models/**",
       "src/core/config/**",
       "src/modules/checkout/**"
     ],
     "forbiddenScope": [
       "src/core/auth/**",
       ".gitlab-ci.yml",
       "package.json",
       "docker/**",
       ".git/**"
     ]
   }
   ```

---

## 5. Artifact Output Contract: `recon-report.md`

Upon scan completion, Graywolf writes `.agents/recon-report.md` conforming to this structured schema:

```markdown
# Brownfield Reconnaissance Report

**Target Repository**: acme-financial/billing-service  
**Scanned Branch**: main  
**Commit SHA**: 4f8a12e9b...  
**Scan Timestamp**: 2026-09-14T21:57:00Z  

---

## 1. Architectural Summary
- **Language**: TypeScript 5.4
- **Primary Framework**: NestJS 10.3 (Modular Controller-Service-Repository architecture)
- **Data Layer**: PostgreSQL 16 via TypeORM 0.3
- **Test Harness**: Jest 29.7 (Unit) + Supertest (E2E)
- **CI/CD Platform**: GitLab CI (.gitlab-ci.yml detected)

## 2. Codebase Topology & Centrality
- **Total Source Files**: 248
- **Identified Symbols**: 1,842 (Classes: 184, Interfaces: 320, Functions: 1,338)
- **Highest Centrality Modules (PageRank Top 5)**:
  1. `src/shared/database/connection.ts` (Score: 0.084)
  2. `src/modules/auth/jwt.strategy.ts` (Score: 0.062)
  3. `src/shared/errors/app-error.ts` (Score: 0.051)
  4. `src/modules/users/user.entity.ts` (Score: 0.048)
  5. `src/shared/utils/currency.ts` (Score: 0.039)

## 3. Proposed Blast-Radius Scopes

### 🟢 Writable Scope (Designated Sandbox Workspace)
- `src/modules/tax/**`
- `tests/modules/tax/**`

### 🟡 Read-Only Scope (Inspected for Context & Types)
- `src/shared/**`
- `src/database/entities/**`
- `src/modules/invoicing/types/**`

### 🔴 Forbidden Scope (Non-Modifiable Infrastructure)
- `src/modules/auth/**` (Security Boundary)
- `.gitlab-ci.yml` (CI/CD Pipeline)
- `package.json`, `package-lock.json` (Root Dependencies)
- `docker-compose.yml`, `Dockerfile` (Container Infrastructure)

## 4. Key Architectural Invariants for Constitution
1. Controllers must never inject TypeORM repositories directly; must use domain services.
2. All dates must be stored in UTC via ISO-8601 strings; `moment` is strictly prohibited.
3. Database migrations in `src/database/migrations/` must be backward-compatible.
```

---

## 6. Onboarding Handshake & Human Sign-Off

The Reconnaissance Pass bridges into the Human Review Gate:

1. **Dashboard Presentation**: The web UI renders an interactive visual representation of the proposed Writable, Read-Only, and Forbidden boundaries overlaid on the file tree.
2. **Lead Developer Adjustments**: The human lead developer can click to add or remove globs, tune test execution commands, or amend proposed constitution rules.
3. **Commit to Repository**: Clicking **`[ Approve & Initialize Squad ]`** commits `.agents/project.config.json` and `.agents/constitution.md` to the target repository's branch.
4. **Autonomous Ready State**: The squad transitions from onboarding into active execution, capable of receiving tasks without risk of scope escape.


<!-- END OF FILE: architecture/brownfield-reconnaissance-and-blast-radius.md -->

---


<!-- START OF FILE: architecture/build-cache-and-performance.md -->

# Source: architecture/build-cache-and-performance.md

# Graywolf Squad — Deep-Dive Architecture: Build & Package Cache Optimization

## 1. Executive Summary & Problem Statement

To achieve true agent agility and conversational responsiveness, task sandboxes must achieve a **sub-2 second startup time**. 

In conventional developer workflows, running a clean `npm install` or `pip install` takes between **30 and 120 seconds**, downloading hundreds of megabytes of dependencies across the network. If an autonomous agent suffered this penalty on every task or iteration, developer velocity would collapse, and ephemeral sandboxing would become unviable.

However, naive caching approaches introduce fatal pitfalls:
- **Sharing raw `node_modules` or `.venv` directories across containers**: Leads to native binary libc mismatches, stale symlinks, lockfile corruption, and postinstall script failures across concurrent tasks.
- **Rebuilding Docker images on every `package.json` push**: Reintroduces the 30–120s latency tax at the image-build layer, triggers CI build storms during active feature branches, and consumes excessive disk space.

Graywolf Squad implements a **Two-Tier Cache Architecture** designed to drop package installation times to **2–8 seconds** while maintaining 100% build fidelity and isolation.

---

## 2. The Two-Tier Cache Architecture

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│                            ORCHESTRATOR / DOCKER HOST                            │
│                                                                                  │
│   ┌──────────────────────────────────────────────────────────────────────────┐   │
│   │ Tier 1: Persistent Content-Addressable Cache Volume                      │   │
│   │ Volume: pkg-cache-{project_id}                                           │   │
│   │ Holds: ~/.npm, ~/.cache/pip, ~/.cargo/registry, Go module cache          │   │
│   └───────────────────────────────────┬──────────────────────────────────────┘   │
│                                       │ Read-Write Bind Mount                    │
│                     ┌─────────────────┴─────────────────┐                        │
│                     ▼                                   ▼                        │
│   ┌───────────────────────────────────┐   ┌───────────────────────────────────┐  │
│   │ Task Sandbox A (TASK-101)         │   │ Task Sandbox B (TASK-102)         │  │
│   │ - Isolated Git Worktree           │   │ - Isolated Git Worktree           │  │
│   │ - Fresh, local node_modules/      │   │ - Fresh, local node_modules/      │  │
│   │ - npm ci runs in 2-5s (from disk) │   │ - npm ci runs in 2-5s (from disk) │  │
│   └───────────────────────────────────┘   └───────────────────────────────────┘  │
│                                                                                  │
│   ┌──────────────────────────────────────────────────────────────────────────┐   │
│   │ Tier 2 (Debounced): Pre-Baked Snapshot Image Layer                       │   │
│   │ Triggers: Lockfile changes + 10-minute quiescence window                 │   │
│   │ Uses: BuildKit cache mounts (`--mount=type=cache`)                       │   │
│   └──────────────────────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Tier 1: Shared Package-Manager Content-Addressable Cache (Always-On)

### 3.1 Mechanism
Instead of sharing the mutable destination directory (`node_modules` or `.venv`), Graywolf mounts the **underlying package manager's immutable, content-addressable cache directory** as a persistent Docker volume (`pkg-cache-{project_id}`) into the non-root `graywolf` user's home (`/home/graywolf/`).

| Package Manager / Language | Host/Volume Cache Path Mounted | Container Mount Point |
| :--- | :--- | :--- |
| **npm** | `pkg-cache-{project_id}/npm` | `/home/graywolf/.npm` |
| **pnpm** | `pkg-cache-{project_id}/pnpm-store` | `/home/graywolf/.local/share/pnpm/store` |
| **pip / uv** | `pkg-cache-{project_id}/pip` | `/home/graywolf/.cache/pip` (`/home/graywolf/.cache/uv`) |
| **Go (Build Cache)** | `pkg-cache-{project_id}/go-build` | `/home/graywolf/.cache/go-build` |
| **Go (Module Cache)** | `pkg-cache-{project_id}/go-mod` | `/home/graywolf/go/pkg/mod` |
| **Rust / Cargo** | `pkg-cache-{project_id}/cargo-registry`<br>`pkg-cache-{project_id}/cargo-git` | `/home/graywolf/.cargo/registry`<br>`/home/graywolf/.cargo/git` |
| **Java (Maven / Gradle)** | `pkg-cache-{project_id}/maven`<br>`pkg-cache-{project_id}/gradle` | `/home/graywolf/.m2/repository`<br>`/home/graywolf/.gradle/caches` |
| **C# / .NET (NuGet)** | `pkg-cache-{project_id}/nuget` | `/home/graywolf/.nuget/packages` |
| **PHP (Composer)** | `pkg-cache-{project_id}/composer` | `/home/graywolf/.cache/composer` |

### 3.2 Benefits Over Raw `node_modules` Sharing
1. **Zero Native Binary Corruption**: Native C/C++ addons (e.g., `bcrypt`, `sharp`, `esbuild`) compile cleanly against the sandbox container's specific architecture and libc during the local install step.
2. **Deterministic Integrity**: `npm ci`, `go mod download`, or `pip install` still executes a real installation pass, guaranteeing symlinks, monorepo workspace hoisting, and postinstall hooks run properly.
3. **Local Disk Velocity**: Because all package tarballs, wheels, go modules, and crate metadata are read from local SSD storage rather than remote registries, dependency resolution and extraction drops from **30–120s down to 2–8s**.

---

## 4. Tier 2: Debounced Pre-Baked Snapshot Layer (Heavy Projects)

For massive monorepos or Python ML environments where unpacking thousands of packages still exceeds 8 seconds, Graywolf provides an automated snapshot layer:

1. **Repo-Scoped Lockfile Change Detection**: Rather than running global watchers across all 8 languages, the orchestrator scopes its file watcher strictly to the manifest and lockfile patterns discovered during the project's reconnaissance pass (`recon-report.md`):
   - *Node repos*: `package-lock.json`, `pnpm-lock.yaml`, `yarn.lock`, `bun.lockb`
   - *Python repos*: `poetry.lock`, `Pipfile.lock`, `requirements.txt`
   - *Go repos*: `go.mod`, `go.sum`
   - *Rust repos*: `Cargo.lock`
   - *Java repos*: `gradle.lockfile`, `pom.xml`
   - *C# / .NET repos*: `packages.lock.json`
   - *PHP repos*: `composer.lock`
2. **Debounced Quiescence (10 Minutes)**: To prevent rebuild storms during active development where a developer or agent pushes multiple commits in rapid succession, a 10-minute quiescence timer is enforced.
3. **Background Image Rebuild**: Once the relevant lockfile remains quiet for 10 minutes, a background BullMQ job builds a specialized, pre-warmed snapshot image matching the project's detected stack:

   ```dockerfile
   # Example A: Node.js Monorepo Cache Seed
   # Syntax: docker/dockerfile:1.4
   FROM runner-base AS project-cache
   WORKDIR /cache-seed
   COPY package.json package-lock.json ./
   RUN --mount=type=cache,target=/root/.npm npm ci
   ```

   ```dockerfile
   # Example B: Polyglot (Go + React) Cache Seed
   # Syntax: docker/dockerfile:1.4
   FROM runner-polyglot-node-go AS project-cache
   WORKDIR /cache-seed
   # Pre-seed Go module cache
   COPY go.mod go.sum ./
   RUN --mount=type=cache,target=/root/go/pkg/mod go mod download
   # Pre-seed Frontend npm cache
   COPY web/package.json web/package-lock.json ./web/
   RUN --mount=type=cache,target=/root/.npm npm --prefix ./web ci
   ```

4. Subsequent ephemeral task containers spin up directly from this pre-warmed snapshot image, reaching **sub-second** container readiness.

---

## 5. Mid-Task Package Additions & Post-Merge Cache Warming

### 5.1 Mid-Task Package Additions
When an agent is actively exploring solutions and installs a package (e.g., `npm install axios` or `pip install httpx`):
- **Task Sandbox Isolation**: The new package and lockfile modifications exist strictly inside the task's ephemeral container and Git worktree. The project's baseline snapshot is untouched.
- **Tarball Cache Absorption**: The download is automatically cached inside the Tier 1 persistent package-manager volume (`pkg-cache-{project_id}`). Because tarballs are cryptographically checksummed by registry hashes, this accelerates candidate package installs across tasks with zero risk of cache poisoning.

### 5.2 Post-Merge Cache Warming
When a Pull Request / task is approved and merged:
- The orchestrator fires a background cache-warming job.
- The job executes `npm ci` / `pip install` against the newly merged lockfile into the Tier 1 cache.
- The *next* scheduled task benefits immediately from pre-cached tarballs without experiencing any network download latency.

---

## 6. Performance Benchmark Targets

| Scenario | Cold Network Install | Shared Raw Directory (Anti-pattern) | Graywolf Tier 1 (Tarball Cache) | Graywolf Tier 2 (Pre-Baked Snapshot) |
| :--- | :---: | :---: | :---: | :---: |
| **Fresh Node.js (500 packages)** | 45s | 1s *(High Flakiness Risk)* | **3.8s** *(100% Reliable)* | **0.8s** |
| **Fresh Python ML (PyTorch/Transformers)** | 180s | Broken venv paths | **12s** *(Local Wheels)* | **1.2s** |
| **Subsequent Task with identical lockfile** | 42s | Stale lock conflicts | **2.1s** | **0.6s** |
| **Agent Adds 1 New Package** | 12s | Pollutes baseline | **1.8s** (isolated) | **1.8s** (isolated) |


<!-- END OF FILE: architecture/build-cache-and-performance.md -->

---


<!-- START OF FILE: architecture/context-and-memory.md -->

# Source: architecture/context-and-memory.md

# Graywolf Squad — Deep-Dive Architecture: Context & Memory Engine

## 1. Executive Summary & Problem Statement

Navigating codebases containing 50,000 to 500,000+ lines of code without blowing token budgets or hallucinating non-existent modules is the central engineering challenge of autonomous coding agents.

### Why Standard RAG (Pure Vector Search) Fails on Source Code
1. **Semantic Inversion Paradox**: Asking *"Where is `processPayment` called?"* matches the *definition* of `processPayment`, never its call-sites or downstream invocations.
2. **Missing Module & Import Context**: Isolated 500-token chunks lose their root packaging namespace, causing LLMs to guess imports (e.g. `import { Tax } from '@/utils'` instead of `@internal/billing/core/tax`).
3. **Flat Text Fallacy**: Code is not natural language prose. It represents a strict structural directed graph: `Repository -> Package/Module -> File -> Class/Interface -> Functions -> AST Call-Graph`.
4. **Token Cost Explosion**: Ingesting entire files on each turn quickly exhausts 128k/200k context windows and incurs massive monetary cost ($0.50-$2.00 per task step).

Graywolf Squad implements a **4-Layer Context Pyramid** inspired by production-proven systems (Aider's Tree-Sitter PageRank repo-map, Sourcegraph SCIP, and Cursor-style surgical slicing).

---

## 2. The 4-Layer Context Pyramid Architecture

```
┌──────────────────────────────────────────────────────────────────┐  ~1,500 Tokens
│ Layer 1: Topological Repo Map (PageRank Centrality over AST)      │  Always In-Prompt
├──────────────────────────────────────────────────────────────────┤  ~2,000 Tokens
│ Layer 2: Symbol Index & Call-Graph (Tree-sitter AST & SCIP/LSP)   │  Queried On-Demand
├──────────────────────────────────────────────────────────────────┤  ~3,000 Tokens
│ Layer 3: Hybrid Lexical + Vector Engine (BM25 / Ripgrep + Dense) │  Discovered via Tools
├──────────────────────────────────────────────────────────────────┤  ~5,000 - 15,000 Tokens
│ Layer 4: Surgical Line Slices & Unified Diffs                    │  Active Workspace
└──────────────────────────────────────────────────────────────────┘
Total Working Token Budget per Turn: ~10,000 - 20,000 tokens
```

---

## 3. Deep-Dive: The Four Layers

### 3.1 Layer 1: Topological Repo Map (Always-in-Context)
* **Goal**: Provide the agent with an accurate 30,000-foot view of the entire repository structure and exported API signatures in under 2,000 tokens.
* **Mechanism**:
  1. Extract all identifier definitions (classes, functions, interfaces, methods) and import/export statements using **Tree-sitter**.
  2. Build an internal directed dependency graph $G = (V, E)$ where nodes $V$ are symbols/files and edges $E$ are `import` or call relationships.
  3. Compute **PageRank centrality** over $G$:
     - Core utilities and domain interfaces imported across multiple modules receive higher rank.
     - Leaf implementations receive lower rank.
  4. Fill a strict token budget (e.g., 1,500 tokens) starting from the highest-ranked symbols down to lowest.
  5. The output renders a compressed, indented outline of the repo:
     ```typescript
     // src/modules/billing/tax-calculator.ts
     export interface TaxRate { country: string; rate: number; }
     export class TaxCalculator {
       constructor(db: DatabaseConnection);
       public calculate(order: OrderPayload): Promise<TaxResult>;
     }
     ```
* **Anti-Hallucination Impact**: The LLM *sees* exact file paths and exported signatures. It cannot invent non-existent files or modules.

---

### 3.2 Layer 2: AST-Based Symbol Index & Call-Graph (Tree-sitter)
* **Goal**: Enable exact programmatic symbol resolution without guessing or reading whole files.
* **Mechanism**:
  - Incremental parsing using `tree-sitter` (via `web-tree-sitter` or Node native bindings).
  - Background indexer maps every symbol to a tuple:
    `{ name, kind, file, lineStart, lineEnd, exported, signature, hash }`.
  - Maintains two relational index tables in PostgreSQL:
    1. `code_symbols`: Primary declarations, type signatures, and HTTP route endpoints.
    2. `code_references`: Caller-callee pairs, import statements, and client API fetch invocations.
* **Mid-Task Hash Verification**:
  - To prevent reviewers from citing stale pre-edit line numbers (e.g. after Dev-Level-3 modifies a file), `find_symbol_definition` and `find_symbol_references` compute a fast xxHash of the target file on disk. If the hash mismatches the index, the query triggers an **immediate synchronous on-demand AST reindex** for that specific file before returning results.
* **Cross-Language Symbol & Route Tracing (Polyglot Bridging & AST Normalization)**:
  - In polyglot repositories (e.g. Go backend + TypeScript/React frontend), standard AST symbol graphs fail at the language boundary. Graywolf elevates **API Route Literals** into first-class cross-language symbols:
    - *Backend Route Group Concatenation*: Frameworks like `chi`, `gin`, `express`, and `FastAPI` commonly register endpoints inside nested route groups (e.g. `r.Route("/api/v1/orgs", func(r chi.Router) { r.Get("/{id}/members", ...) })`). A naive AST scanner looking only at the leaf string literal would see `/{id}/members` and fail to match the frontend's full URL. Graywolf's Tree-sitter visitor maintains an **AST lexical prefix stack** during traversal, concatenating parent route scopes to reconstruct the canonical full path: `/api/v1/orgs/{id}/members`.
    - *Path Parameter Normalization*: Normalizes parameter variations across language idioms (`:id`, `{id}`, `<id>`) into a canonical parameter representation (`/api/v1/orgs/:id/members`).
    - *Frontend Call Extraction (Static Strings & Modern Template Literals - N11a)*: Tree-sitter extracts both static string literals (`fetch('/api/v1/orgs/' + id + '/members')`) and ES6 template literals (`` fetch(`/api/v1/orgs/${orgId}/members`) ``). For template literals, the AST visitor matches static segments and maps dynamic expression slots (`${...}`) to canonical wildcard parameter positions (`/api/v1/orgs/:id/members`), closing the 31.7% unmatched gap in modern React codebases.
    - *Unified Mapping*: `find_symbol_references("/api/v1/orgs/:id/members")` bridges both worlds, returning the Go handler *and* all frontend React components calling that route.
* **OpenAPI Contract Pipeline & `contract.diff` Severity Classification (ADR-049, N11b)**:
  - When any task touches API handlers or clients, the orchestrator generates the OpenAPI schema and compares it against baseline using `openapi-diff`.
  - Emits `.agents/tasks/{TASK_ID}/review/contract.diff` classified into two explicit severity tiers:
    1. **Breaking Changes (Hard Block)**: Removed routes, changed HTTP methods, altered required request parameters, or modified existing response schemas without corresponding frontend updates. Causes immediate review rejection (red-gate) and halts for human resolution.
    2. **Additive Changes (Green Informational Pass)**: Legitimate new endpoints, optional query parameters, or backward-compatible additive response fields. Does NOT block completion; marked with a green checkmark and an informational note in the PR summary.
* **Exposed Agent Tools**:
  - `find_symbol_definition(symbolName, contextFile?)`
  - `find_symbol_references(symbolName)` — supports symbol names and `/api/v1/...` route paths
  - `get_type_contract(typeName)`
  - `get_module_exports(filePath)`
  - `get_contract_diff()` — inspects API contract changes across backend/frontend

---

### 3.3 Layer 3: Hybrid Search (Lexical Ripgrep + Dense pgvector)
* **Goal**: Help agents locate unfamiliar functionality when only concepts or error strings are known.
* **Dual Engines**:
  1. **Lexical Search (Ripgrep / BM25)**:
     - Exact string, regex, route pattern (e.g., `POST /api/v1/tax`), or error message search.
     - Ultra-fast native execution inside the container via `rg`.
  2. **Dense Semantic Search (`pgvector`)**:
     - Embeds module-level docstrings, `README.md` files, API specifications, and architectural summaries (not raw code blocks).
     - Dimension: 768 vectors indexed with `HNSW` (`m=16, ef_construction=64`) using `nomic-embed-text` (Apache 2.0, local Ollama).
  3. **Reciprocal Rank Fusion (RRF)**:
     $$RRF\_Score(d) = \sum_{m \in M} \frac{1}{k + r_m(d)}$$
     Merges lexical matches and semantic matches with $k=60$, ensuring exact keyword hits rise above vague semantic associations.

---

### 3.4 Layer 4: Surgical File Slicing (The Vibe Coding Standard)
* **Goal**: Prevent loading full 2,000-line files into context when only modifying 20 lines.
* **Mechanism**:
  - Agents interact through surgical window tools:
    - `view_file_outline(filePath)`: View symbols and line ranges.
    - `view_file_range(filePath, startLine, endLine)`: Read 50–150 lines around the target area.
    - `replace_file_content(filePath, targetContent, replacementContent)`: Exact contiguous block replacement.
  - Full files are only read if total file length is $< 300$ lines.

---

## 4. Git History & Architectural Memory (Brownfield Secret Weapon)

Raw git diffs are noisy, but git history contains critical architectural rationale.

### 4.1 What Gets Indexed
1. **Conventional Commit Messages & PR Descriptions**:
   - The last 100 merged Pull Requests or milestone commits are embedded in `pgvector`.
   - Answers: *"Why was this bizarre regex added in 2024?"* $\rightarrow$ *"Workaround for Safari Arabic UTF-8 encoding bug"*.
2. **Code Churn & Hotspot Analysis**:
   - Calculate frequency of edits per file over the last 90 days.
   - High-churn files are automatically flagged to Dev-Level-1 (Planner) and Dev-Level-2 (Reviewer) as **High Risk Areas** requiring higher test coverage.

### 4.2 What Is Deliberately Excluded
- Raw commit diffs across historical commits (massive noise, low signal, wastes vector storage).

---

## 5. Virtual Developer Tiers Context Matrix

| Virtual Developer Tier | Context Received | Tool Access | Primary Token Budget |
| :--- | :--- | :--- | :--- |
| **Dev-Level-1 (Lead Architect / Planner)** | Task Brief + Topological Repo Map + Module Summaries + Past Task Memory | `hybrid_search`, `find_symbol_definition`, `web_search` | ~15,000 input tokens |
| **Dev-Level-3 (Senior Implementer)** | `plan.md` + Targeted File Slices + Symbol Definitions | `view_file_range`, `replace_file_content`, `run_command` (tests/lint) | ~20,000 working context |
| **Dev-Level-2 (In-Container Reviewer)** | `plan.md` + Git Patch Diff (`git diff`) + Reference Checker | `find_symbol_references`, `run_command` (eval/test suite) | ~12,000 input tokens |

---

## 6. Open-Source Ecosystem & Integration Plan

To maintain zero vendor lock-in and avoid reinventing established algorithms:

1. **Tree-sitter (`tree-sitter`, `web-tree-sitter`)**:
   - Universal, incremental syntax parser with grammars for TypeScript, JavaScript, Python, Go, Java, Rust, C#, PHP.
2. **`repomix` & Aider `repomap.py` Architecture**:
   - Standardized algorithms for PageRank-based symbol importance filtering.
3. **Ripgrep (`rg`)**:
   - Pre-installed inside sandbox containers for millisecond lexical search.
4. **PostgreSQL 16 + `pgvector`**:
   - Single unified relational store for symbol tables, call references, and architectural embeddings.


<!-- END OF FILE: architecture/context-and-memory.md -->

---


<!-- START OF FILE: architecture/continuous-learning-engine.md -->

# Source: architecture/continuous-learning-engine.md

# Graywolf Squad — Deep-Dive Architecture: Continuous Learning Engine & Memory Scaling

## 1. Executive Summary & Vision

An autonomous engineering platform that resets its knowledge on every task is doomed to repeat the same subtle mistakes, violate team conventions, and require repetitive human corrections. Conversely, an agent system that naively saves every thought into a vector database rapidly suffers from **retrieval poisoning**: noisy, stale, or conflicting memories degrade prompt context and cause hallucinations.

Inspired by the **Hermes Agent** closed-loop learning framework (Nous Research), Graywolf Squad implements an autonomous three-tier learning engine engineered for long-term scalability, self-pruning, and strict provenance tracking.

---

## 2. Three-Tier Learning Architecture

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│ Continuous Learning Engine (Closed-Loop Autonomous Improvement)                        │
│                                                                                        │
│  ┌──────────────────────────────────────────────────────────────────────────────────┐  │
│  │ Tier 1: Project Memory (PostgreSQL 16 + pgvector)                                │  │
│  │ • Scope: Coding conventions, framework quirks, resolved edge cases, PR feedback  │  │
│  │ • Format: Structured JSONB with vector embeddings (nomic-embed-text / HNSW)     │  │
│  │ • Lifecycle: Automated recency decay, similarity deduplication, confidence decay│  │
│  └──────────────────────────────────────────────────────────────────────────────────┘  │
│                                                                                        │
│  ┌──────────────────────────────────────────────────────────────────────────────────┐  │
│  │ Tier 2: Reusable Skill Library (.agents/skills/*.md)                             │  │
│  │ • Scope: Procedural, multi-step workflows (e.g. "Add New Fastify Route")         │  │
│  │ • Format: Markdown with YAML frontmatter conforming to agentskills.io standard    │  │
│  │ • Lifecycle: Auto-generated when task patterns succeed 2+ times; versioned in git│  │
│  └──────────────────────────────────────────────────────────────────────────────────┘  │
│                                                                                        │
│  ┌──────────────────────────────────────────────────────────────────────────────────┐  │
│  │ Tier 3: Anti-Pattern Registry                                                    │  │
│  │ • Scope: Hard negative constraints ("Never import X", "Never use DROP without...")│  │
│  │ • Format: Exact regex matchers + semantic rules injected as negative prompt guards│  │
│  │ • Lifecycle: Extracted from QA guard failures, test regressions, and human PR veto│  │
│  └──────────────────────────────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Provenance & Confidence Scoring Model

Not all lessons are created equal. A rule extracted from an explicit human PR rejection is far higher signal than a correlation inferred by an agent.

Every learned lesson carries an explicit provenance record:

```sql
CREATE TABLE project_lessons (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    source_task_id VARCHAR(64) REFERENCES tasks(id) ON DELETE SET NULL,
    provenance VARCHAR(32) NOT NULL, 
      -- 'human_correction' | 'qa_guard_failure' | 'auto_inferred' | 'postmortem'
    confidence_score NUMERIC(3, 2) NOT NULL, -- 0.10 to 1.00
    category VARCHAR(32) NOT NULL,          -- 'convention' | 'bugfix' | 'anti_pattern' | 'perf'
    trigger_scope TEXT[] NOT NULL,          -- e.g. ['src/modules/billing/**', '*.ts']
    summary TEXT NOT NULL,
    rule_content TEXT NOT NULL,
    embedding vector(768),                  -- nomic-embed-text embedding
    times_applied INT DEFAULT 0,
    times_rejected INT DEFAULT 0,
    status VARCHAR(16) NOT NULL DEFAULT 'active', -- 'active' | 'quarantined' | 'archived'
    last_applied_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### 3.1 Provenance Hierarchy

| Provenance Type | Initial Confidence | Promotion / Demotion Rules |
| :--- | :---: | :--- |
| **`human_correction`** | **1.00** | Extracted from the delta between agent patch and merged human PR. Permanent to prevent convention thrashing, but subject to **Periodic Re-Confirmation** (§4.4) to catch mistaken approvals. |
| **`postmortem`** | **0.95** | Injected from production incident or reverted PR. Immediately promotes to Anti-Pattern Registry. |
| **`qa_guard_failure`** | **0.80** | Extracted after Clean-Code or Test Guard rejects a candidate patch. Demoted if subsequent human review overrides the guard. |
| **`auto_inferred`** | **0.50** | Synthesized after 2 successful tasks sharing similar file patterns across **distinct task briefs**. Quarantined until tested on 2 subsequent tasks without failure. |

---

## 4. Vector Scaling, Decay & Pruning Policy

As a project completes hundreds of tasks, `project_lessons` could grow to thousands of records. Without pruning, vector search matches obsolete rules (e.g. instructions for a deprecated ORM), polluting the prompt.

Graywolf enforces a **Four-Part Pruning & Validation Engine**:

### 4.1 Recency-Weighted Scoring (Time-Decay RRF)
When Dev-Level-1 (Planner) retrieves lessons for a new task, candidate lessons are ranked by combining semantic similarity with an exponential half-life decay:

$$Score = Similarity \times e^{-\lambda \Delta t} \times \left(1 + \frac{Applied}{Applied + Rejected + 1}\right)$$

Where $\Delta t$ is days since last successful application, and $\lambda = 0.01$ (90-day half-life). Recent and frequently validated lessons naturally surface above old, unused ones. Note that `human_correction` lessons maintain their high baseline weight to protect established standards from decaying away.

### 4.2 Semantic Deduplication & Consolidation (Nightly & On-Demand)
A background worker runs nightly (and on-demand) clustering lessons with cosine similarity $> 0.88$. It invokes an analytical model to synthesize near-duplicates into a single, unified, high-confidence lesson, archiving redundant records to keep retrieval sharp.

### 4.3 Quarantining on Incident / Rollback with LLM-Assisted Triage
If a merged task is marked as causing a regression or is reverted via a git revert PR:
- The orchestrator traces the `source_task_id`.
- All lessons born from that task are instantly updated to `status = 'quarantined'`.
- Quarantined lessons are blocked from retrieval until reviewed.
- **LLM-Assisted Triage Digest**: Instead of forcing non-expert operators to inspect raw AST diffs, Dev-Level-1 generates a plain-English triage summary for each quarantined lesson:
  > *"Lesson 'Always wrap errors with AppError' was quarantined because PR #42 was reverted due to broken error unwrapping. Recommended action: Archive and delete."*

### 4.4 Periodic Re-Confirmation Protocol (The Fallible Human Safeguard)
Because human operators may occasionally approve sub-optimal patterns under pressure, `human_correction` lessons are not left unchecked forever:
- **Trigger**: When a `human_correction` lesson is applied $\ge 5$ times, or when 30 days elapse.
- **Action**: The lesson appears in the weekly project health digest: *"This human convention has steered 5 tasks. Is this still your intended standard?"*
- Clicking **"Confirm"** resets the counter; clicking **"Revoke"** archives the lesson and purges it from prompt injection.

---

## 5. Autonomous Skill Self-Creation (`agentskills.io`)

When a developer asks Graywolf to perform a complex workflow (e.g., *"Set up a new TypeORM migration and entity for customer invoices"*), Dev-Level-1 follows general reasoning. 

However, once that task pattern succeeds twice:
1. **Distinct-Brief Requirement**: The 2 successes MUST come from **distinct task briefs** across different tasks (not successive retry turns or subtasks within the same brief) to prevent overfitting.
2. **Extraction & Synthesis**: It authors a reusable markdown document in `.agents/skills/<skill-name>/SKILL.md` conforming to the open `agentskills.io` standard.
3. **Operator Sign-Off Gate**: The newly generated skill is held in draft state until the human operator signs off on the plain-language summary in the Cockpit or via PR. Once approved, it is committed to version control.
   ```markdown
   ---
   name: add-typeorm-migration
   description: Standard procedure for creating TypeORM migrations in this repository
   triggers:
     - "**/migrations/**"
     - "src/database/models/**"
   provenance: auto-inferred
   confidence: 0.85
   ---

   # Workflow: TypeORM Migration Procedure
   1. Create entity in `src/database/models/<name>.entity.ts`
   2. Run `npm run typeorm:generate -- -n <MigrationName>`
   3. Verify non-blocking lock clauses for production safety...
   ```
3. **Commit**: The skill is committed to the local project repository under version control, making team knowledge transparent, editable, and shareable across Git remotes.

---

## 6. Organization-Level Memory Tier (Cross-Workspace Intelligence — ADR-051)

When an operator manages multiple repositories (e.g. backend services, frontend portals, background workers) or provisions a second project, requiring the agent squad to re-learn organizational conventions from scratch wastes time and risks re-committing previously solved mistakes.

Graywolf establishes a **Hierarchical Two-Tier Memory Architecture**:

```
┌────────────────────────────────────────────────────────────────────────┐
│ ORGANIZATION MEMORY TIER (Scoped to org_id)                            │
│ - Shared organizational conventions, approved library choices,         │
│   and company-wide anti-patterns (e.g., standard error wrapping,        │
│   approved auth patterns, mandatory audit logging).                    │
│ - Curated via explicit operator promotion from project lessons.        │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ inherited on bootstrap
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│ PROJECT MEMORY TIER (Scoped to project_id)                             │
│ - Highly localized module topology, specific database schema quirks,   │
│   and repo-specific test harnesses.                                    │
└────────────────────────────────────────────────────────────────────────┘
```

### 6.1 Promotion & Bootstrapping Mechanics
1. **Explicit Scoping Required for Promotion (Fail-Closed on Empty Scope)**:
   - In the project memory view, high-confidence lessons can be promoted to Organization Scope (`is_org_wide = true`).
   - **Fail-Closed Gate**: Blast radius is fail-closed by philosophy; memory follows the exact same standard. An empty or missing `trigger_scope` (`trigger_scope = []` or `null`) **strictly blocks promotion**.
   - The UI surfaces an interactive prompt: *"Specify target path glob or language pattern before promoting to org scope (e.g. `cmd/**, *.go` or `web/**, *.tsx`). Universal blanket injection is prohibited."*
2. **Precedence on Collision (Project Intent Outranks Org Defaults)**:
   - When an organization-level convention collides with a project-level decision (e.g., an org lesson specifies `chi`, but the project's `.agents/constitution.md` or a local `human_correction` mandates standard library `net/http` mux):
   - **Normative Precedence Rule**: **Project-Level Decision Strictly Wins**. Local human operator intent always outranks organization-level inherited defaults. The orchestrator silences the org lesson and injects only the project-level rule into the agent's context bundle.
3. **Multi-Stack Monorepos (Per-Path Brief Conditioned Matching)**:
   - In polyglot monorepos containing multiple languages and stacks (e.g., Go backend in `cmd/**` + React frontend in `web/**`), org lessons are NOT evaluated at the whole-repo level.
   - Matching is dynamically evaluated **per task brief against the target file paths and recon manifest**:
     - A task brief touching `cmd/api/server.go` receives the Go error-wrapping lesson.
     - A task brief touching `web/src/components/Header.tsx` within the *same workspace* completely excludes the Go lesson from its context bundle.
4. **Cross-Project Skill Library**: High-performing skills can be shared in the organizational skill registry (`.agents/org-skills/`), allowing mature workflows to be invoked across projects with zero duplication.



<!-- END OF FILE: architecture/continuous-learning-engine.md -->

---


<!-- START OF FILE: architecture/data-residency-and-byoc.md -->

# Source: architecture/data-residency-and-byoc.md

# Graywolf Squad — Deep-Dive Architecture: BYOC Model Data Residency & Egress Boundaries

## 1. Executive Summary & The Egress Reality Check

In Bring Your Own Compute (BYOC) topologies, marketing claims like *"Source code never leaves the customer network"* are dangerously misleading if the platform routes prompts containing code snippets to public multi-tenant cloud model APIs (e.g. OpenAI, Anthropic, Google Gemini). 

While it is true that **Graywolf SaaS never ingests or stores customer source code**, sending prompt payloads to external LLMs constitutes network egress to a third party. In enterprise financial, healthcare, or defense environments, this distinction is the difference between passing or failing security compliance (SOC 2, ISO 27001, HIPAA).

Graywolf establishes a mathematically precise **Model Data Residency Policy** based on three strict deployment tiers, enforced at the orchestrator and LiteLLM Proxy layers.

---

## 2. Three Data Residency Profiles

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                              CUSTOMER SECURE PERIMETER (VPC)                           │
│                                                                                        │
│   ┌───────────────────────────────────┐       ┌─────────────────────────────────────┐  │
│   │ Graywolf BYOC Runner Sandbox      │       │ Local LiteLLM Proxy                 │  │
│   │ - Reads customer source code      │──────►│ - Inspects residency policy         │  │
│   │ - Generates prompts & AST slices  │       │ - Enforces ZDR verification badges  │  │
│   └───────────────────────────────────┘       └──────────────────┬──────────────────┘  │
└──────────────────────────────────────────────────────────────────┼─────────────────────┘
                                                                   │
                         ┌─────────────────────────────────────────┼─────────────────────────────────────────┐
                         ▼                                         ▼                                         ▼
           [TIER 1: AIR-GAPPED / SOVEREIGN]          [TIER 2: PRIVATE VPC PEERED]              [TIER 3: COMMERCIAL PUBLIC API]
           • Target: Ollama / vLLM / LocalAI         • Target: AWS Bedrock / Azure OpenAI      • Target: api.anthropic.com / openai.com
           • Egress: ZERO (0.0.0.0/0 blocked)        • Egress: Private AWS/Azure DirectConnect • Egress: Public Internet (TLS 1.3)
           • Residency: 100% On-Premises             • Residency: Customer Dedicated Cloud     • Residency: Third-Party Multi-Tenant
           • Compliance: FedRAMP High, DoD IL5       • Compliance: SOC 2 Type II, HIPAA, ZDR   • Compliance: Standard Enterprise NDA
```

### 2.1 Tier Specifications

| Residency Tier | Model Routing Destination | Network Path | Source Code Egress Outside Customer Boundary? | Compliance Guarantee |
| :--- | :--- | :--- | :---: | :--- |
| **Tier 1: Sovereign (Air-Gapped)** | Local Ollama, vLLM, or dedicated on-prem GPU cluster | Loopback / Internal LAN (`10.0.0.0/8`) | **NO (0 bytes egress)** | 100% Air-gapped, zero external network dependency |
| **Tier 2: Dedicated Private VPC** | AWS Bedrock, Azure OpenAI, or GCP Vertex AI inside customer's cloud account | PrivateLink / VPC Peering / DirectConnect | **NO (Remains inside customer cloud tenant)** | Zero Data Retention (ZDR), dedicated enterprise tenant isolation |
| **Tier 3: Public Commercial API** | Direct endpoints (`api.openai.com`, `api.anthropic.com`) | Public Internet (TLS 1.3) via LiteLLM Proxy | **YES (Code snippets sent to LLM vendor)** | Governed by customer's direct Commercial BAA / API terms |

---

## 3. Zero Data Retention (ZDR) & Egress Badging

### 3.1 LiteLLM Proxy Configuration (`model-routing.json`)
Every model defined in `project.config.json` explicitly declares its data residency classification:

```jsonc
{
  "modelRouting": {
    "devLevel1": {
      "alias": "agent-planner",
      "endpoint": "https://custom-azure-openai.privatelink.openai.azure.com",
      "residencyTier": "private-vpc", // "sovereign" | "private-vpc" | "public-cloud"
      "zeroDataRetentionVerified": true,
      "providerRegion": "us-east-1"
    }
  }
}
```

### 3.2 Executive Review Packet Compliance Row
Every Pull Request generated by Graywolf embeds a verified **Data Residency Audit Badge** in its Quality Gate compliance table:

```markdown
| Gate | Status | Details |
| :--- | :--- | :--- |
| **Model Data Residency** | 🟢 AIR-GAPPED SOVEREIGN | 100% processed locally via on-prem vLLM (0 bytes egressed) |
# OR
| **Model Data Residency** | 🟡 PRIVATE VPC (ZDR) | AWS Bedrock us-east-1 via customer PrivateLink (ZDR Active) |
# OR
| **Model Data Residency** | ⚠️ PUBLIC CLOUD EGRESS | Anthropic Claude 3.5 Sonnet (Public API, customer API key) |
```

This prevents developers and security reviewers from operating under false assumptions: they see the exact residency tier for every single task.

---

## 4. BYOC Runner Network Air-Gap Enforcement

In **Tier 1 (Sovereign)** mode:
1. The runner Docker container is started with `--network=none` or an isolated internal bridge with no default gateway.
2. The only reachable endpoint is the internal LiteLLM proxy listening on a Unix domain socket or internal IP.
3. Attempts to reach public internet addresses (`8.8.8.8`, `api.openai.com`) are dropped at the packet level by Linux kernel `iptables` rules.


<!-- END OF FILE: architecture/data-residency-and-byoc.md -->

---


<!-- START OF FILE: architecture/error-taxonomy-and-structured-codes.md -->

# Source: architecture/error-taxonomy-and-structured-codes.md

# Graywolf Squad — Deep-Dive Architecture: Error Taxonomy & Structured Codes

## 1. Executive Summary & Design Principles

In an autonomous multi-agent platform, unstructured error strings (such as `throw new Error("Something went wrong")`) lead to brittle regex parsing, ambiguous model reasoning, and poor UI user experiences.

To establish machine-readable predictability across the **Fastify Control Plane**, the **In-Container `relay.mjs` Harness**, the **Agent Relay Protocol (ARP)**, and the **React Dashboard**, Graywolf adopts **ADR-042: Unified Error Taxonomy & Structured Codes**.

### Core Invariants:
1. **Namespace Prefixes**: Every error code begins with a dedicated domain prefix:
   - `AUTH_*`: Authentication, session expiration, and cryptographic token verification.
   - `RBAC_*`: Authorization, privilege boundaries, and Casbin matrix evaluations.
   - `TASK_*`: Task lifecycle transitions, lock contention, and concurrency.
   - `SANDBOX_*`: Container provisioning, Docker proxy communication, and OOM kills.
   - `RELAY_*`: In-container harness invariants, blast-radius enforcement, and git barriers.
   - `LLM_*`: Model provider routing, rate limits, spend limits, and circuit breakers.
   - `GIT_*`: Git worktree creation, merge conflicts, and VCS remote operations.
2. **Standard Payload Wire Format**: All REST, WebSocket, and in-container error outputs share the identical schema:
   ```json
   {
     "code": "RELAY_BLAST_RADIUS_VIOLATION",
     "message": "Attempted to modify path 'src/core/auth.ts' outside permitted writable scope.",
     "details": {
       "attemptedPath": "src/core/auth.ts",
       "writableScope": ["src/modules/tax/**"]
     },
     "retryable": false,
     "timestamp": "2026-09-14T21:55:00.000Z"
   }
   ```
3. **HTTP Status Code Mapping**: Every error code maps deterministically to an HTTP status code (400, 401, 403, 404, 409, 422, 429, 500, 503).
4. **WebSocket Close Code Alignment**: Corresponds directly with ARP custom close frames (4001–4010) defined in ADR-036.

---

## 2. Canonical Error Code Taxonomy

### 2.1 Authentication & Session (`AUTH_*`)

| Error Code | HTTP Status | Retryable | Description |
| :--- | :---: | :---: | :--- |
| `AUTH_SESSION_MISSING` | 401 | No | No `__session` cookie provided in request headers. |
| `AUTH_SESSION_EXPIRED` | 401 | No | Session timestamp expired in PostgreSQL and Valkey. |
| `AUTH_SESSION_REVOKED` | 401 | No | Session key purged from Valkey following user demotion or ejection. |
| `AUTH_INVITE_INVALID` | 400 | No | Invite token hash not found in `workspace_invites`. |
| `AUTH_INVITE_EXPIRED` | 400 | No | Invite expiration timestamp has passed. |
| `AUTH_INVITE_EXHAUSTED` | 400 | No | Invite `uses_count >= max_uses`. |
| `AUTH_TGT_EXPIRED` | 401 | Yes | WebSocket Ticket-Granting Token expired (>15s cutoff with grace). |
| `AUTH_TGT_ALREADY_USED` | 401 | No | TGT has already been consumed via `GETDEL` (replay prevention). |

---

### 2.2 Authorization & RBAC (`RBAC_*`)

| Error Code | HTTP Status | Retryable | Description |
| :--- | :---: | :---: | :--- |
| `RBAC_INSUFFICIENT_ROLE` | 403 | No | User's role does not meet minimum threshold (e.g. `viewer` attempting `create_task`). |
| `RBAC_MERGE_NOT_AUTHORIZED` | 403 | No | Non-lead/owner attempting to approve review gate or trigger VCS PR merge. |
| `RBAC_KEY_MANAGEMENT_DENIED` | 403 | No | Non-owner attempting to modify LLM provider keys or daily budget caps. |
| `RBAC_COCKPIT_TOOL_FORBIDDEN` | 403 | No | Chat Cockpit AI tool-call blocked server-side by Fastify Casbin interceptor. |
| `RBAC_CROSS_TENANT_VIOLATION` | 403 | No | User attempting to access a workspace or project they do not belong to. |

---

### 2.3 Task Lifecycle & Concurrency (`TASK_*`)

| Error Code | HTTP Status | Retryable | Description |
| :--- | :---: | :---: | :--- |
| `TASK_NOT_FOUND` | 404 | No | Requested `taskId` does not exist in the active workspace. |
| `TASK_INVALID_STATE_TRANSITION` | 409 | No | Attempted transition violates state machine (e.g. `BACKLOG` directly to `MERGED`). |
| `TASK_BLOCKED_BY_DEPENDENCIES` | 409 | No | Cannot dispatch task because upstream tasks in `blocked_by` are not `MERGED`. |
| `TASK_LOCK_CONTENTION` | 423 | Yes | `proper-lockfile` directory lock held by another active runner or orchestrator thread. |
| `TASK_CLARIFICATION_LIMIT_REACHED` | 400 | No | Maximum clarification rounds (2) exceeded without resolution. |
| `TASK_ALREADY_DISPATCHED` | 409 | No | Task is already `IN_PROGRESS` inside an active container. |
| `TASK_SPEND_LIMIT_EXCEEDED` | 402 | No | Task token bill hit configured `spendLimitUSD` ceiling. |

---

### 2.4 Runner Sandbox & Container Runtime (`SANDBOX_*`)

| Error Code | HTTP Status | Retryable | Description |
| :--- | :---: | :---: | :--- |
| `SANDBOX_DOCKER_PROXY_UNREACHABLE` | 503 | Yes | Orchestrator failed to reach `http://docker-proxy:2375` on `daemon-net`. |
| `SANDBOX_PROVISIONING_FAILED` | 500 | Yes | Docker daemon failed to create or start `runner-{TASK_ID}` container. |
| `SANDBOX_OOM_KILLED` | 500 | No | Container exceeded Docker memory limit (`--memory 4g`) and was killed by Linux OOM (Exit 137). |
| `SANDBOX_STARTUP_TIMEOUT` | 504 | Yes | Runner container failed to establish ARP WebSocket connection within boot limit (10s). |
| `SANDBOX_HEARTBEAT_TIMEOUT` | 504 | No | Container missed 3 consecutive 15-second ARP heartbeats (stale runner). |
| `SANDBOX_IMAGE_PULL_FORBIDDEN` | 403 | No | Orchestrator requested unpinned image in production topology (ADR-040 gate). |

---

### 2.5 In-Container Relay Harness (`RELAY_*`)

*Emitted inside the sandbox by `relay.mjs` and returned in `result.json` or ARP frames:*

| Error Code | Exit Code | Retryable | Description |
| :--- | :---: | :---: | :--- |
| `RELAY_BLAST_RADIUS_VIOLATION` | 2 | No | Synchronous file interceptor caught write attempt to Read-Only or Forbidden glob. |
| `RELAY_GIT_BARRIER_VIOLATION` | 2 | No | Agent attempted `git push`, `git commit`, `git merge` via `git-guard.sh`. |
| `RELAY_SPEND_CEILING_HIT` | 0 | No | In-container spend accumulator hit 100% budget ceiling, triggering clean halt. |
| `RELAY_INTERNAL_REVIEW_TWO_STRIKES` | 0 | No | Dev-Level-2 rejected implementation twice; task escalated to human gate. |
| `RELAY_DETERMINISTIC_LINTER_FAILED` | 0 | Yes | Code violated machine-enforced Constitution rules (`ast-grep` banned import / regex). |
| `RELAY_UNRECOVERABLE_EXCEPTION` | 1 | No | Fatal Node.js crash or WebSocket failure inside `relay.mjs`. |

---

### 2.6 LLM Gateway & Spend Controller (`LLM_*`)

| Error Code | HTTP Status | Retryable | Description |
| :--- | :---: | :---: | :--- |
| `LLM_PROVIDER_RATE_LIMITED` | 429 | Yes | Model provider returned HTTP 429; LiteLLM circuit breaker triggers fallback. |
| `LLM_CIRCUIT_BREAKER_TRIPPED` | 503 | Yes | Primary and fallback providers failed consecutive call thresholds. |
| `LLM_CONTEXT_WINDOW_EXCEEDED` | 400 | No | Task brief, repo map, or diff exceeded model token input limit. |
| `LLM_DAILY_BUDGET_EXCEEDED` | 402 | No | Organization or project hit `dailySpendCapUSD`. |
| `LLM_LOCAL_MODEL_OFFLINE` | 503 | Yes | Local Ollama/vLLM instance unreachable on configured host port. |

---

### 2.7 Git & Version Control (`GIT_*`)

| Error Code | HTTP Status | Retryable | Description |
| :--- | :---: | :---: | :--- |
| `GIT_REMOTE_AUTH_FAILED` | 401 | No | Invalid PAT, expired token, or rejected SSH key during Git clone/fetch. |
| `GIT_WORKTREE_COLLISION` | 409 | Yes | Worktree directory path already registered in `.git/worktrees`. |
| `GIT_AUTO_REBASE_CONFLICT` | 409 | No | Target branch moved ahead and 3-way merge generated unresolvable conflict (ADR-031). |
| `GIT_PATCH_APPLICATION_FAILED` | 422 | No | `git apply changes.patch` failed against target worktree. |

---

### 2.8 Addon Ecosystem & Software Factory (`ADDON_*`)

| Error Code | HTTP Status | Retryable | Description |
| :--- | :---: | :---: | :--- |
| `ADDON_HASH_MISMATCH` | 403 | No | Tier 2 community addon SHA-256 digest failed to match locked hash in `.agents/project.config.json` (ADR-080 Fail-Closed). |
| `ADDON_SLOT_LIMIT_EXCEEDED` | 429 | No | Host profile exceeded maximum concurrent addon slots (Topology A cap: 3 Signal + 1 Cockpit). |
| `ADDON_UNLINKED_EXTERNAL_USER` | 403 | No | External chat user ID (Discord/Slack/Teams) has no verified mapping in `workspace_member_identities` (ADR-080). |

---

### 2.9 System-One Decision Gate (`GATE_*`)

| Error Code | HTTP Status | Retryable | Description |
| :--- | :---: | :---: | :--- |
| `GATE_LOW_CONFIDENCE_FALLBACK` | 200 | Yes | Decision gate score fell below threshold (`<0.85` or `<0.90`); execution safely fell back to full frontier model reasoning (ADR-079). |
| `GATE_BACKEND_UNAVAILABLE` | 503 | Yes | Configured local or remote decision gate endpoint unreachable; bypassed or routed to frontier reasoning. |

---

## 3. Fastify & TypeScript Implementation

### 3.1 TypeBox Schema Definition

```typescript
import { Type, Static } from '@sinclair/typebox';

export const ErrorResponseSchema = Type.Object({
  code: Type.String({ 
    description: 'Machine-readable, domain-prefixed error identifier',
    examples: ['RELAY_BLAST_RADIUS_VIOLATION', 'RBAC_INSUFFICIENT_ROLE']
  }),
  message: Type.String({
    description: 'Human-readable explanation suitable for display'
  }),
  details: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  retryable: Type.Boolean({
    description: 'Whether the client or runner should automatically retry'
  }),
  timestamp: Type.String({ format: 'date-time' })
});

export type ErrorResponse = Static<typeof ErrorResponseSchema>;
```

### 3.2 Global Fastify Error Handler

```typescript
fastify.setErrorHandler((error, request, reply) => {
  if (error instanceof GraywolfAppError) {
    return reply.status(error.httpStatus).send({
      code: error.code,
      message: error.message,
      details: error.details ?? {},
      retryable: error.retryable,
      timestamp: new Date().toISOString()
    });
  }

  // Fallback for unhandled unexpected runtime crashes
  request.log.error(error);
  return reply.status(500).send({
    code: 'INTERNAL_SERVER_ERROR',
    message: 'An unexpected internal error occurred.',
    details: {},
    retryable: false,
    timestamp: new Date().toISOString()
  });
});
```

---

## 4. UI Client Handling Strategy (React / assistant-ui)

The React dashboard and Chat Cockpit consume these structured error codes to render actionable user guidance rather than raw stack traces:

1. **`AUTH_TGT_EXPIRED`**: The dashboard transparently fetches a new ticket from `/telemetry/ws-ticket` and reconnects the WebSocket without showing an error to the user.
2. **`RBAC_COCKPIT_TOOL_FORBIDDEN`**: The Chat Cockpit transforms the error into conversational context, enabling the AI to state: *"You do not have permission to merge this PR. Please ask a Lead Developer or Owner to approve."*
3. **`RELAY_BLAST_RADIUS_VIOLATION`**: The Kanban card displays a red warning badge with a link to inspect the `escalation-request.md` and adjust the task's writable scope.
4. **`GIT_AUTO_REBASE_CONFLICT`**: The UI presents an interactive 3-way diff view allowing the human developer to resolve the conflict or instruct the squad to re-plan.


<!-- END OF FILE: architecture/error-taxonomy-and-structured-codes.md -->

---


<!-- START OF FILE: architecture/local-development-topology.md -->

# Source: architecture/local-development-topology.md

# Graywolf Squad — Deep-Dive Architecture: Local Development Topology & Network Segmentation

## 1. Executive Summary & Security Threat Model

In Graywolf Squad, local development (`docker compose up`) must replicate the exact security posture, isolation boundaries, and network segmentation of the production platform. 

The local development topology addresses two critical security failure modes:
1. **Host Takeover via Docker Socket**: A naive implementation mounts `/var/run/docker.sock` directly into the orchestrator so it can spawn ephemeral runner containers. This allows any process inside the orchestrator to issue raw Docker API calls, mount the host's `/` root directory, and achieve full root execution on the developer's workstation.
2. **Flat Bridge Lateral Movement**: Placing all services on a single bridge network allows an untrusted, prompt-injected LLM or malicious post-install npm script running inside `runner-{TASK_ID}` to `curl http://orchestrator:3000/api/...`, directly access `postgres-shared:5432`, or extract API keys from `litellm-proxy:4000`.

To eliminate these vulnerabilities, **ADR-040** establishes a **Four-Network Segmented Topology** powered by a **Scoped Docker Socket Proxy** (`tecnativa/docker-socket-proxy`, MIT).

---

## 2. Multi-Bridge Network Architecture

```
                                    HOST WORKSTATION (Developer)
                                                 │
                                 ┌───────────────┴───────────────┐
                                 │ HTTP :5173         HTTP :3000 │
                                 ▼                               ▼
═══════════════════════════════════════════════════════════════════════════════════════════════════
  edge-net (Public / Bridge — Published Ports Only)
    ├── dashboard (React / Vite on Nginx — :5173 -> :80)
    └── orchestrator (Fastify REST Gateway — :3000 -> :3000)
═══════════════════════════════════════════════════════════════════════════════════════════════════

═══════════════════════════════════════════════════════════════════════════════════════════════════
  control-net (Internal Bridge: internal: true — NO OUTSIDE ROUTE, NO RUNNER ROUTE)
    ├── orchestrator (Client on Port 3000)
    ├── postgres-shared (Port 5432 — Control Plane DB & Tier 1 Shared Sandboxes)
    ├── valkey (Port 6379 — Session Cache, Proper-Lockfile, BullMQ)
    └── litellm-proxy (Port 4000 — Model Provider Routing & Spend Ceilings)
═══════════════════════════════════════════════════════════════════════════════════════════════════

═══════════════════════════════════════════════════════════════════════════════════════════════════
  daemon-net (Internal Bridge: internal: true — 2 MEMBERS ONLY)
    ├── docker-proxy (Port 2375 — Scoped Docker Daemon TCP Socket)
    └── orchestrator (Client accessing Docker API via http://docker-proxy:2375)
═══════════════════════════════════════════════════════════════════════════════════════════════════

═══════════════════════════════════════════════════════════════════════════════════════════════════
  runner-net (Isolated Bridge — Untrusted Execution Plane)
    ├── orchestrator:3001 (ARP-ONLY WebSocket Port — Dedicated Listener)
    ├── runner-{TASK_ID} (Ephemeral Task Sandbox running relay.mjs)
    └── postgres-{TASK_ID} (Optional Tier 2 Ephemeral Database Sandbox)
═══════════════════════════════════════════════════════════════════════════════════════════════════
```

### 2.1 Network Segmentation Rules & Isolation Table

| Network Name | `internal: true` | Attached Containers | Permitted Communication | Prohibited Routes |
| :--- | :---: | :--- | :--- | :--- |
| **`edge-net`** | No | `dashboard`, `orchestrator` | Host browser access to Web UI and REST API. | Cannot reach `postgres-shared`, `valkey`, `litellm-proxy`, or `docker-proxy`. |
| **`control-net`** | **Yes** | `orchestrator`, `postgres-shared`, `valkey`, `litellm-proxy` | Inter-service control plane traffic (Fastify to DB, Cache, LLM Proxy). | **Physically isolated from runners.** No ephemeral container can attach here. |
| **`daemon-net`** | **Yes** | `docker-proxy`, `orchestrator` | Orchestrator issues container lifecycle API calls to proxy. | Isolated from all other services, host, and runners. |
| **`runner-net`** | No (Egress allowed for npm/pip/git) | `orchestrator:3001` (ARP WebSocket), `runner-*`, `postgres-*` | Runners connect **exclusively** to `orchestrator:3001` via WebSocket. | **Zero route to Port 3000, 5432, 6379, 4000, or 2375.** |

---

## 3. Scoped Docker Socket Proxy (`docker-proxy`)

The `docker-proxy` sidecar is configured via environment variables to allow only container provisioning actions while explicitly disabling dangerous Docker API capabilities:

```yaml
  docker-proxy:
    image: tecnativa/docker-socket-proxy:latest
    container_name: graywolf-docker-proxy
    restart: unless-stopped
    environment:
      # Permitted Operations
      - CONTAINERS=1    # Allow create, start, stop, rm, inspect
      - POST=1          # Allow POST requests (container creation)
      - NETWORKS=1      # Allow attaching containers to runner-net
      
      # Explicitly Blocked High-Risk Operations
      - EXEC=0          # Disallow docker exec into arbitrary containers
      - VOLUMES=0       # Disallow creating new host volume mounts
      - IMAGES=1        # Allow listing and pulling base runner images
      - SWARM=0         # Disable swarm management
      - SERVICES=0      # Disable services
      - INFO=0          # Block system info leaks
      - AUTH=0          # Block credential manipulation
      - SECRETS=0       # Block secret manipulation
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
    networks:
      - daemon-net
```

### Security Benefits:
- **No Direct Socket Access**: The `orchestrator` container does not mount `/var/run/docker.sock`.
- **Read-Only Host Socket**: Even the proxy container mounts the host socket with `:ro`.
- **Restricted Privileges**: Even if the `orchestrator` container is compromised via a code injection or dependency CVE, the attacker cannot execute arbitrary commands into running host containers (`EXEC=0`) or mount arbitrary host directories (`VOLUMES=0`).

### 3.1 Topology Gates & Residual Risk Governance (ADR-040)

To avoid letting "accepted residual risks" become permanent production security debt, Graywolf establishes **strict architectural trigger conditions**:

```
┌────────────────────────────────────────────────────────────────────────┐
│ TOPOLOGY A: Local / Solo Developer Mode (docker-compose.yml)           │
│ Allowed: IMAGES=1 (convenience) + Direct runner-net egress             │
│ Boundary: Single developer machine, non-sensitive local playground.    │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                         TRIGGER CONDITION MET:
                         - Any team member invited (Team Mode enabled)
                         - First customer / production codebase mounted
                         - Deployed as Enterprise Self-Hosted (Topology B)
                         - Deployed as BYOC / Hybrid SaaS (Topology C)
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│ TOPOLOGIES B & C: Production & Multi-User Topologies (MANDATORY GATE)  │
│ 1. Immutable Digest Pinning: IMAGES=0 on proxy; runner images pinned   │
│    to verified SHA-256 digests (image@sha256:...) from internal mirror.│
│ 2. ADR-028 Egress Proxy: Direct egress on runner-net disabled. All     │
│    outbound requests routed through egress proxy with domain allowlist │
│    (npm, PyPI, verified Git remote, LiteLLM) to prevent exfiltration.  │
└────────────────────────────────────────────────────────────────────────┘
```

> [!IMPORTANT]
> **Production Gate Invariant**: Before any external team collaborator joins a workspace or any commercial customer codebase touches a runner sandbox, the deployment environment **MUST** activate digest pinning and ADR-028 egress proxying.


---

## 4. Dual-Port Fastify Listener Design

To guarantee physical network isolation between the management plane and the execution sandboxes, the Fastify Orchestrator initializes **two independent HTTP/WebSocket servers**:

```typescript
// 1. Management & Control Plane Server (Port 3000)
// Bound to control-net and edge-net
const controlServer = fastify({ logger: true });
await controlServer.register(authRoutes);      // /api/v1/auth
await controlServer.register(workspaceRoutes); // /api/v1/workspaces
await controlServer.register(taskRoutes);      // /api/v1/tasks
await controlServer.listen({ port: 3000, host: '0.0.0.0' });

// 2. Agent Relay Protocol Server (Port 3001)
// Bound to runner-net ONLY
const arpServer = fastify({ logger: true });
await arpServer.register(fastifyWebsocket);
arpServer.get('/arp', { websocket: true }, (connection, req) => {
  handleRelayWebSocketConnection(connection, req); // Validates containerToken
});
await arpServer.listen({ port: 3001, host: '0.0.0.0' });
```

In `docker-compose.yml`, the orchestrator defines network-specific port bindings:
- Port 3000 is accessible from `edge-net` and `control-net`.
- Port 3001 is accessible from `runner-net`.
- `runner-net` has **no port 3000 mapping**, meaning `curl http://orchestrator:3000` from inside a runner fails with `Connection Refused`.

---

## 5. Persistent Volume Mounts & Directory Hierarchy

Graywolf preserves application state across container lifecycles using structured Docker named volumes:

```
HOST STORAGE
  ├── graywolf_pgdata       ➔ /var/lib/postgresql/data (PostgreSQL 16 + pgvector)
  ├── graywolf_valkeydata   ➔ /data (Valkey append-only persistence)
  ├── graywolf_litellm      ➔ /root/.local/share/litellm (LiteLLM spend tracking)
  ├── graywolf_task_storage ➔ /app/storage/tasks (Task briefs, reviews, patches)
  └── graywolf_cache_npm    ➔ /home/graywolf/.npm (Tier 1 Package Cache, UID 10001)
```

---

## 6. Cold-Boot Orchestration & Health Checks

To achieve the sub-2-second target and prevent cascading boot failures, services define tight, prioritized health checks:

1. **Phase 1 (Datastores)**: `postgres-shared` and `valkey` initialize.
   - Postgres health check: `pg_isready -U graywolf -d graywolf_db` (interval: 2s, timeout: 2s, retries: 10).
   - Valkey health check: `valkey-cli ping` (interval: 1s, timeout: 1s, retries: 5).
2. **Phase 2 (Proxies & Services)**:
   - `docker-proxy`: TCP ping on port 2375.
   - `litellm-proxy`: HTTP `GET http://localhost:4000/health/liveliness`.
3. **Phase 3 (Application Core)**:
   - `orchestrator`: Depends on `postgres-shared: service_healthy`, `valkey: service_healthy`, `docker-proxy: service_started`, and `litellm-proxy: service_healthy`.
4. **Phase 4 (Frontend)**:
   - `dashboard`: Starts and connects to `orchestrator:3000`.


<!-- END OF FILE: architecture/local-development-topology.md -->

---


<!-- START OF FILE: architecture/multi-tenancy-and-deployments.md -->

# Source: architecture/multi-tenancy-and-deployments.md

# Graywolf Squad — Deep-Dive Architecture: Multi-Tenancy, Team Collaboration & SaaS Deployment

## 1. Executive Summary & Vision

Graywolf Squad is designed with a **"Local-First, SaaS-Ready from Day 1"** topology. 

Rather than building a single-user desktop app that must be thrown away when enterprise teams adopt it, or a bloated cloud SaaS that frightens security-conscious enterprises with source code privacy concerns, Graywolf adopts a **decoupled Control Plane vs. Execution Plane architecture**:

1. **Zero-Friction Solo Mode**: Boots in `< 1` second with zero authentication, seeding a default `Personal Workspace` and auto-logging in the local admin.
2. **Dashboard-Driven Team Upgrade**: A one-click toggle in Settings upgrades a personal workspace into an authenticated team workspace with instant invite links—no server restarts or `.env` file editing.
3. **Tenant Isolation from Day 1**: Every relational table and vector index is strictly scoped by `org_id` and `workspace_id`. PostgreSQL Row-Level Security (RLS) guarantees that multi-tenant SaaS deployment requires zero architectural redesign later.
4. **Hybrid SaaS & BYOC (Bring Your Own Compute)**: Supports full self-hosted single-box deployment, multi-tenant cloud SaaS, and Enterprise Hybrid where the web UI is hosted on cloud SaaS while task execution sandboxes run inside the customer's private VPC/local network.

---

## 2. Decoupled Architecture: Control Plane vs. Execution Plane

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                                CONTROL PLANE (Web & Core)                              │
│  - Fastify API Server & WebSockets                                                     │
│  - React Flow Kanban & assistant-ui Chat Cockpit                                       │
│  - PostgreSQL 16 + pgvector (Multi-Tenant Schema with RLS)                             │
│  - LiteLLM Spend Governance & Key Management                                           │
└────────────────────────────────────────────────────────────────────────────────────────┘
                                            │
                    gRPC / WebSocket Agent Relay Protocol (Encrypted)
                                            │
                                            ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                              EXECUTION PLANE (Task Runners)                            │
│  - Ephemeral Docker Sandbox Containers (Runner Base Image)                             │
│  - Git Worktree Clones & non-committing relay.mjs                                      │
│  - Ephemeral PostgreSQL Template DB Clones (< 300ms copy-on-write)                     │
│  - Playwright Headless Browser & Artifact Exporters                                    │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

### 2.1 Three Supported Deployment Topologies

| Topology | Control Plane Location | Execution Plane Location | Target Audience |
| :--- | :--- | :--- | :--- |
| **A. Local / Solo Self-Hosted** | Localhost / Laptop / Raspberry Pi | Local Docker Engine | Solo developers, open-source hackers, vibe coders |
| **B. Enterprise Team Self-Hosted** | Company internal VM / Office Server | Internal Docker / Kubernetes Node | Small teams, startups, private enterprises |
| **C. Hybrid SaaS (BYOC Runner)** | Graywolf Managed Cloud SaaS | Customer Private VPC / Local Runner | Enterprises requiring code privacy without self-hosting UI/DB |

---

## 3. Tenant Isolation from Day 1: Schema & Data Model

To prevent cross-tenant data leaks and eliminate future tech debt, all core entities enforce composite tenancy keys.

### 3.1 Relational Schema (`PostgreSQL 16`)

```sql
-- 1. Organizations (Top-level workspace & token budget governance boundary)
-- Note: Graywolf is 100% free open source. plan_tier reflects self-managed feature flags,
-- and spend limits refer exclusively to user safety caps on third-party model token consumption.
CREATE TABLE organizations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug VARCHAR(64) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    plan_tier VARCHAR(32) NOT NULL DEFAULT 'community', -- 'community' | 'team' | 'enterprise'
    mode VARCHAR(32) NOT NULL DEFAULT 'personal',       -- 'personal' | 'team'
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Workspaces (Sub-compartments within an organization)
CREATE TABLE workspaces (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(64) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(org_id, slug)
);

-- 3. Users & Memberships
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) UNIQUE NOT NULL,
    full_name VARCHAR(255),
    avatar_url TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE workspace_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role VARCHAR(32) NOT NULL DEFAULT 'developer', -- 'owner' | 'lead_dev' | 'developer' | 'viewer'
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(workspace_id, user_id)
);

-- 4. Projects (Bound to Workspace & Git Remote)
CREATE TABLE projects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(64) NOT NULL,
    mode VARCHAR(32) NOT NULL DEFAULT 'brownfield', -- 'greenfield' | 'brownfield'
    git_remote_url TEXT NOT NULL,
    git_provider VARCHAR(32) NOT NULL DEFAULT 'github', -- 'github' | 'gitlab' | 'bitbucket' | 'azure' | 'gitea'
    config_json JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(workspace_id, slug)
);

-- 5. Tasks (Scoped by Project, Workspace, and Org)
CREATE TABLE tasks (
    id VARCHAR(64) PRIMARY KEY, -- e.g. 'TASK-101'
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    title VARCHAR(512) NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'BACKLOG',
    priority VARCHAR(16) NOT NULL DEFAULT 'MEDIUM',
    blocked_by TEXT[] DEFAULT '{}',
    writable_scope TEXT[] DEFAULT '{}',
    spend_usd NUMERIC(10, 4) DEFAULT 0.0000,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### 3.2 Row-Level Security (RLS) Enforcement & Hardening

PostgreSQL Row-Level Security is strictly enabled and forced on every tenant-scoped table:

```sql
-- Enforce RLS unconditionally even for table owners or superuser connection pools
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks FORCE ROW LEVEL SECURITY;

ALTER TABLE code_symbols ENABLE ROW LEVEL SECURITY;
ALTER TABLE code_symbols FORCE ROW LEVEL SECURITY;

ALTER TABLE project_lessons ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_lessons FORCE ROW LEVEL SECURITY;
```

Before any transaction or API route executes, the Fastify authentication hook sets both the workspace and organization context:
```typescript
await pgClient.query(`
  SET LOCAL app.current_org_id = $1;
  SET LOCAL app.current_workspace_id = $2;
`, [currentOrgId, currentWorkspaceId]);
```

### 3.3 The Sanctioned Bridge Gate: Organization Memory Isolation (ADR-051)

Because `is_org_wide = true` lessons cross workspace boundaries by design, they represent a sanctioned bridge. To prevent cross-customer data leaks in multi-tenant deployments:

1. **Strict Organization Scoping**: Org-wide lessons are **NEVER instance-wide**. Every org lesson retains an immutable `org_id REFERENCES organizations(id)`.
2. **The Two-Tier RLS Policy**:
   ```sql
   CREATE POLICY tenant_and_org_lesson_isolation ON project_lessons
       FOR ALL
       USING (
           (workspace_id = current_setting('app.current_workspace_id')::UUID)
           OR
           (is_org_wide = true AND org_id = current_setting('app.current_org_id')::UUID)
       )
       WITH CHECK (
           workspace_id = current_setting('app.current_workspace_id')::UUID
           AND org_id = current_setting('app.current_org_id')::UUID
       );
   ```
   **Probe Invariant**: If Organization A promotes a lesson matching `trigger_scope: ['cmd/**']`, and Organization B queries lessons in its Go workspace, PostgreSQL evaluates `org_id = 'ORG_B'` $\rightarrow$ **zero rows returned, zero context injection**.

### 3.4 Defense-in-Depth Against Agent SQL & Error Sanitization

1. **Network Segregation**: Task runner containers run on `runner-net`. The Control Plane PostgreSQL (port 5432) runs exclusively on `control-net`, rendering direct database connections physically unreachable from the sandbox.
2. **Sanitized Error Payloads (No Prompt Fuel)**: If an agent probes API endpoints with foreign UUIDs (e.g. attempting an IDOR on `/api/v1/projects/{foreign_uuid}`), the orchestrator:
   - Evaluates the query under RLS, returning an empty set.
   - Responds with a generic HTTP 404 `RESOURCE_NOT_FOUND`.
   - Never leaks database error strings, table names, foreign keys, or schema constraints into the response payload or event stream. This prevents the LLM from using error text as prompt engineering material to map cross-tenant topologies.

### 3.5 Shared `pgvector` HNSW Search: SQL-Level Predication

In a shared vector index, application-level post-filtering (e.g. fetching top-20 nearest vectors and filtering by tenant in Node.js) is strictly prohibited because:
- A missing `if` statement leaks cross-tenant embeddings.
- It leaks timing and result-count side channels.
- Dense neighbor clusters from Tenant A can push Tenant B's results out of the top-$k$ window.

**Normative SQL Predication**:
All semantic similarity queries against `pgvector` MUST execute with tenant constraints directly in the SQL `WHERE` clause:
```sql
SELECT id, summary, rule_content, 1 - (embedding <=> $query_vector) AS similarity
FROM project_lessons
WHERE (
    workspace_id = current_setting('app.current_workspace_id')::UUID
    OR (is_org_wide = true AND org_id = current_setting('app.current_org_id')::UUID)
)
AND status = 'active'
ORDER BY embedding <=> $query_vector
LIMIT 5;
```
Combined with `FORCE ROW LEVEL SECURITY`, PostgreSQL enforces this predicate at the storage engine layer regardless of caller syntax.

### 3.6 Per-Project Cache, Storage & Webhook Scoping

1. **Cache Volume Isolation**:
   - Package manager caches are mounted from discrete Docker named volumes named `pkg-cache-{project_id}`.
   - `project_id` is validated as a strict UUID regex before container creation, preventing path traversal.
   - Containers run as unprivileged `graywolf` user (`uid=1000`) without write access to host volume roots.
2. **Hierarchical Artifact Storage**:
   - Task review artifacts on host storage follow the strict path hierarchy:
     `/storage/artifacts/{org_id}/{workspace_id}/{project_id}/{task_id}/`
   - Artifact download routes enforce session tenant verification before streaming files.
3. **Escalation Webhooks**:
   - Outbound webhooks (Slack, Email, Discord) are stored in `workspace_integrations` and scoped by `workspace_id`.
   - Escalation events and review decision memos dispatch exclusively to the target workspace's registered webhook endpoints.


---

## 4. Dashboard-Driven Team Mode (Zero-Config to Team)

### 4.1 First Boot: Zero-Config Solo Mode
- On initial launch (`docker compose up`), the system runs a database migration seed:
  - Creates a default organization: `Personal Org` (`mode: 'personal'`).
  - Creates a default workspace: `Default Workspace`.
  - Creates a local admin user: `Admin User`.
  - Generates a local persistent session cookie.
- The developer opens `http://localhost:3000` and sees their projects and tasks immediately—no sign-up, no email verification, no friction.

### 4.2 Upgrading to Team Mode via Dashboard
When the developer wants to invite collaborators:
1. Navigates to **Settings $\rightarrow$ Team & Collaboration**.
2. Clicks the button: **`[ Enable Team Workspace ]`**.
3. A modal opens with 2 configuration items:
   - **Authentication Method**: Local email/password OR OAuth (GitHub, GitLab, Google).
   - **Invite Expiration**: 24 hours, 7 days, or permanent.
4. Clicking **Save** updates the database flag:
   ```sql
   UPDATE organizations SET mode = 'team' WHERE id = :org_id;
   ```
5. The UI instantly reveals the **Shareable Invite Link**:
   `http://localhost:3000/invite/join?token=<RAW_32_BYTE_TOKEN>`
   *(Note: The server stores only the `SHA-256` hash of this token in `workspace_invites` with expiration and role binding, per ADR-039).*
6. Teammates open the link, authenticate (via email/password or OAuth), and Better-Auth validates the hash, creating a stateful Valkey-cached session with the assigned `developer` or `viewer` role.
7. **Zero container reboots or `.env` modifications required.**


---

## 5. Role-Based Access Control (RBAC) Matrix

| Action / Permission | Owner / Admin | Lead Developer | Developer | Viewer / Client |
| :--- | :---: | :---: | :---: | :---: |
| **Manage Model API Keys & Token Spend Limits (LiteLLM)** | ✅ | ❌ | ❌ | ❌ |
| **Manage Team Members & Roles** | ✅ | ❌ | ❌ | ❌ |
| **Create Projects & Define Blast-Radius Boundaries** | ✅ | ✅ | ❌ | ❌ |
| **Override Mandatory Human Review Gates** | ✅ | ✅ | ❌ | ❌ |
| **Approve Pull Requests & Merge to Git Remote** | ✅ | ✅ | ❌ | ❌ |
| **Create Tasks & Reorder Kanban Backlog** | ✅ | ✅ | ✅ | ❌ |

| **Chat with Active Control Plane Cockpit** | ✅ | ✅ | ✅ | ❌ |
| **Answer Blocking Clarification Subtasks** | ✅ | ✅ | ✅ | ❌ |
| **View Kanban Board, Live Logs & Visual Artifacts** | ✅ | ✅ | ✅ | ✅ |

---

## 6. Hybrid SaaS & Bring Your Own Compute (BYOC)

For enterprise security and cloud commercialization, Graywolf supports the **BYOC Runner Model** (identical to GitHub Actions self-hosted runners or Datadog agents):

```
┌─────────────────────────────────────────────────────────────┐
│                    GRAYWOLF CLOUD SAAS                      │
│  - Hosted Web Application & Real-Time Collaboration         │
│  - Global Task State, DAG Scheduling & Kanban Board         │
│  - Organization Billing & Multi-Provider LiteLLM Proxy      │
└─────────────────────────────────────────────────────────────┘
                               ▲
                               │ Secure Outbound WebSocket Connection
                               │ (TLS 1.3 / mTLS, No inbound ports required)
                               ▼
┌─────────────────────────────────────────────────────────────┐
│               CUSTOMER INTERNAL VPC / RUNNER                │
│  - `graywolf-runner` Docker daemon / Kubernetes agent       │
│  - Clones Git repository locally within customer network   │
│  - Executes task sandboxes, ephemeral DBs, & Playwright     │
│  - Returns verified patch diff + screenshots back to SaaS   │
│  🔒 GRAYWOLF SAAS NEVER STORES CUSTOMER SOURCE CODE         │
└─────────────────────────────────────────────────────────────┘
```

### Security Benefits of BYOC:
1. **Zero Source Code Ingestion by Graywolf**: Graywolf SaaS never stores, indexes, or retains the customer's proprietary source code on its own infrastructure—only the ephemeral patch diff and test status report pass through the WebSocket relay.
2. **Zero Internal Network Exposure**: The runner connects outbound to the SaaS via WebSocket. The customer never opens inbound firewall ports.
3. **Local Database Safety**: In brownfield mode, the runner connects to internal staging databases that are completely inaccessible from the public internet.
4. **Model Data Residency Policy**: LLM inference calls may send code snippets to external model providers depending on the configured Data Residency Tier. See [`data-residency-and-byoc.md`](file:///home/tarikelmallah/Projects/GraywolfSquad/docs/architecture/data-residency-and-byoc.md) and ADR-027 for the three-tier policy (Sovereign / Private VPC / Public Cloud).


<!-- END OF FILE: architecture/multi-tenancy-and-deployments.md -->

---


<!-- START OF FILE: architecture/observability-and-telemetry.md -->

# Source: architecture/observability-and-telemetry.md

# Graywolf Squad — Deep-Dive Architecture: Monitoring, Observability & Agent Logs

## 1. Executive Summary & Vision

Developers adopt autonomous software engineering agents only when they can **inspect and understand agent reasoning in real time**. A opaque system that outputs raw diffs without context breeds skepticism and fear of hallucinations. Conversely, spewing hundreds of raw LLM JSON logs into the UI overwhelms the developer with low-level noise.

Graywolf Squad implements a **Unified Event Stream Architecture** featuring:
1. **Dual-Layer Rendering**: A high-level structured narrative timeline as the default view, paired with on-demand deep-dive terminal streaming (Xterm.js) for raw stdout/stderr ground truth.
2. **Granular LLM Cost & Token Ledger (`llm_calls`)**: A dedicated relational analytics table tracking prompt tokens, completion tokens, costs, and prompt-cache hits (`cache_read_tokens`) broken down by persona, model, and task.
3. **Additive OpenTelemetry (OTLP) Exporter**: Native internal storage in PostgreSQL for $0 zero-dependency local runs, with an optional OTLP bridge supporting external enterprise monitoring (Datadog, Grafana, Honeycomb) using emerging `gen_ai.*` semantic conventions.

---

## 2. Unified Event Stream Architecture (Dual Rendering)

Rather than maintaining separate logging pipelines for chat, terminal outputs, and system metrics, every action in Graywolf is emitted to an append-only event stream and rendered through two synchronized lenses:

```
                  ┌──────────────────────────────────────────────┐
                  │ Task Container / Agent Execution Relay       │
                  └──────────────────────┬───────────────────────┘
                                         │ Emits Typed Event
                                         ▼
                  ┌──────────────────────────────────────────────┐
                  │ Fastify WebSocket & Event Hub (append-only)  │
                  └──────────────────────┬───────────────────────┘
                                         │
                 ┌───────────────────────┴───────────────────────┐
                 ▼                                               ▼
┌──────────────────────────────────────────────┐ ┌──────────────────────────────────────────────┐
│ Surface A: Primary Narrative Timeline        │ │ Surface B: Expandable Ground Truth Terminal   │
│ (React UI / Cockpit Activity Stream)         │ │ (Xterm.js Drawer / Slide-out)                │
│                                              │ │                                              │
│ [22:01] 🔍 Dev-Level-1 scanned repo-map      │ │ Sub-stream attached to specific actions:     │
│ [22:02] 📝 Planner drafted plan.md           │ │ - Full npm test execution stdout             │
│ [22:04] ✏️ Implementer modified auth.ts      │ │ - Compiler error traces                      │
│ [22:05] 🧪 Reviewer executed Playwright E2E  │ │ - Playwright test runner live feeds          │
│         └── [▶ Expand Terminal Logs (84L)]   │ │                                              │
└──────────────────────────────────────────────┘ └──────────────────────────────────────────────┘
```

### 2.1 Event Schema (`agent_events`)

```typescript
export interface AgentEvent {
  id: string;                      // UUIDv7 (time-ordered)
  taskId: string;                  // 'TASK-104'
  workspaceId: string;
  timestamp: string;               // ISO 8601
  tier: 'dev-level-1' | 'dev-level-2' | 'dev-level-3' | 'orchestrator';
  type: 
    | 'tool_call' 
    | 'tool_result' 
    | 'file_slice_view' 
    | 'file_mutation' 
    | 'command_exec' 
    | 'cost_delta' 
    | 'guard_eval' 
    | 'review_signoff';
  summary: string;                 // Human-readable narrative: "Ran test suite: 14 passing"
  payload: Record<string, unknown>;// Structured inputs & outputs
  hasSubStream: boolean;           // True if raw stdout/stderr exists
  subStreamRef?: string;           // Blob or file pointer to raw terminal logs
}
```

---

## 3. Granular Cost & Token Ledger (`llm_calls`)

To maintain complete visibility over AI spend and identify prompt-caching efficiencies, every individual model invocation is recorded into an ACID relational fact table in PostgreSQL.

### 3.1 Relational Schema

```sql
CREATE TABLE llm_calls (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id VARCHAR(64) NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    persona VARCHAR(32) NOT NULL,   -- 'planner' | 'implementer' | 'reviewer'
    model VARCHAR(128) NOT NULL,    -- 'claude-3-5-sonnet-20241022', 'deepseek-v3'
    provider VARCHAR(64) NOT NULL,  -- 'anthropic', 'openrouter', 'ollama'
    input_tokens INT NOT NULL,
    output_tokens INT NOT NULL,
    cache_read_tokens INT DEFAULT 0,-- Prompt cache hits (e.g., static Layer 1 repo-map)
    cache_write_tokens INT DEFAULT 0,
    cost_usd NUMERIC(10,6) NOT NULL,-- Calculated via LiteLLM cost tables ($0.00 for local)
    latency_ms INT,
    status VARCHAR(16) NOT NULL DEFAULT 'success', -- 'success' | 'rate_limited' | 'error'
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_llm_calls_task ON llm_calls(task_id);
CREATE INDEX idx_llm_calls_workspace_date ON llm_calls(workspace_id, created_at);
CREATE INDEX idx_llm_calls_persona ON llm_calls(persona);
```

### 3.2 Key Analytical Rollups
With this schema, the platform calculates real-time insights without heavy external analytics engines:
1. **Persona Efficiency**: Are reasoning models in Dev-Level-1 (Planner) consuming the bulk of task spend compared to fast code synthesis in Dev-Level-3?
2. **Prompt Cache ROI (`cache_read_tokens`)**: Tracks how effectively Layer 1 Topological Repo Map and system instructions hit provider prompt caches, reducing token costs by up to 90%.
3. **Per-Task Runaway Protection**: Provides the exact data feeding the task-level budget circuit breaker (`spendLimitUSD`).

---

## 4. OpenTelemetry (OTLP) Semantic Export (Enterprise Tier)

For self-hosted local solo users, the internal PostgreSQL ledger powers the entire dashboard with **zero additional dependencies or Docker containers**.

For enterprise teams who manage centralized observability through Datadog, Dynatrace, New Relic, or Grafana Tempo, Graywolf supports an **additive OTLP exporter**:

```jsonc
// In project.config.json or organization settings
{
  "telemetry": {
    "otlpExporter": {
      "enabled": true,
      "endpoint": "http://otel-collector.internal:4318/v1/traces",
      "protocol": "http/json", // "http/json" | "grpc"
      "headers": {
        "x-tenant-id": "engineering-prod"
      }
    }
  }
}
```

### 4.1 OpenTelemetry Trace Hierarchy & `gen_ai.*` Attributes

Graywolf maps each autonomous task lifecycle to an OpenTelemetry distributed trace tree:

```
[Trace: Task TASK-104]
 ├── [Span: Phase: Dev-Level-1 Planning]
 │    ├── [Span: Tool: generate_repo_map]
 │    └── [Span: GenAI Call (gen_ai.system=anthropic, gen_ai.request.model=claude-3-5-sonnet)]
 ├── [Span: Phase: Dev-Level-3 Code Implementation]
 │    ├── [Span: Tool: view_file_range]
 │    ├── [Span: Tool: replace_file_content]
 │    └── [Span: GenAI Call (gen_ai.system=deepseek, gen_ai.request.model=deepseek-v3)]
 └── [Span: Phase: Dev-Level-2 In-Container Review]
      ├── [Span: Exec: npm test]
      └── [Span: Exec: playwright test]
```

Standardized attributes emitted conform to OpenTelemetry GenAI Semantic Conventions:
- `gen_ai.operation.name`: `chat`, `generate_code`, `review_patch`
- `gen_ai.system`: `anthropic`, `openai`, `deepseek`, `ollama`
- `gen_ai.request.model`: Virtual alias or underlying model name
- `gen_ai.usage.input_tokens`: Raw prompt tokens
- `gen_ai.usage.output_tokens`: Completion tokens
- `gen_ai.usage.cache_read_tokens`: Cache hits
- `gen_ai.cost.usd`: Calculated cost in dollars


<!-- END OF FILE: architecture/observability-and-telemetry.md -->

---


<!-- START OF FILE: architecture/project-constitution.md -->

# Source: architecture/project-constitution.md

# Graywolf Squad — Deep-Dive Architecture: Project Constitution & Machine Enforcement

## 1. Executive Summary & Concept

In an autonomous multi-agent engineering platform, the **Constitution** is the supreme architectural law of a repository. It represents the non-negotiable boundaries, coding standards, library preferences, and prohibited patterns that human lead engineers would enforce on any new developer joining the team.

Rather than treating the Constitution as vague philosophical advice, Graywolf Squad establishes the Constitution as a **machine-readable, dual-enforced artifact**:
1. **Cognitive Enforcement**: Injected verbatim into the prompt bundle of **Dev-Level-1 (Planner)** to steer high-level strategy and prevent architecture drift.
2. **Deterministic Enforcement**: Machine-compiled into strict AST linter rules and grep assertions that **Dev-Level-2 (In-Container Reviewer)** executes inside the sandbox *before* invoking any LLM, catching violations in milliseconds for $0.

---

## 2. File Format & Specification

The Constitution follows a two-stage lifecycle:
1. **Master Template**: Stored at `.specify/memory/constitution.md` (project-global architectural principles and technology standards).
2. **Per-Project Runtime Copy**: Created at `.agents/constitution.md` during project onboarding (initialized from the master template, then customized with project-specific rules during the Reconnaissance pass and lead developer sign-off).

The runtime copy uses Markdown with a structured YAML frontmatter:

```markdown
---
version: "graywolf.constitution.v1"
projectId: "acme-billing-service"
language: "typescript"
framework: "fastify"

# Machine-Executable Checks (Run by Dev-Level-2 deterministic guard)
executableRules:
  nodejs:
    pathPattern: "src/frontend/**"
    lintCommand: "npm run lint"
    typecheckCommand: "npm run typecheck"
    testCommand: "npm test"
  golang:
    pathPattern: "src/backend/**"
    lintCommand: "golangci-lint run"
    testCommand: "go test ./... -race"

  forbiddenImports:
    - pattern: "moment"
      reason: "Moment.js is deprecated. Use date-fns or native Temporal API."
    - pattern: "lodash"
      reason: "Use native ES2022 array methods or micro-utilities."
    - pattern: "axios"
      reason: "Use native global fetch() or undici."
  forbiddenRegex:
    - regex: "any\\[\\]"
      reason: "Explicit type declarations required; untyped any arrays banned."
    - regex: "console\\.log\\("
      reason: "Use injected Pino logger (req.log), not raw console.log."

# Contract & Domain Invariants (Machine-Verified & Assistive Heuristics)
architecturalInvariants:
  apiContractValidation:
    sourceOfTruth: "api/openapi.yaml"
    enforceOn: ["src/backend/handlers/**", "src/frontend/api/client.ts"]
    reason: "Backend and frontend must exactly implement the OpenAPI spec."
  queryScopingInvariant:
    # Assistive heuristic layered into Confidence Scoring (ADR-033), NOT an infallible static guarantee.
    # While simple patterns catch obvious misses, dynamic query construction, multi-function builders, and raw SQL
    # cannot be fully proven absent of leaks via static AST alone.
    pattern: "org_id = ?"
    enforceOn: ["src/backend/repository/**"]
    approvedScopedWrappers: ["src/backend/db/ScopedRepository.go", "src/backend/db/tenant_context.go"]
    confidencePenaltyOnAmbiguity: 0.35
    reason: "All tenant-aware queries must strictly predicate on org_id. Unrecognized query builder patterns trigger an immediate confidence deduction and require human review."

# Architectural Invariants (Enforced cognitively by Dev-Level-1 Planner)
architecturalRules:
  - "Controllers must never execute SQL queries or access TypeORM entities directly; all persistence must go through Service repositories."
  - "Every public API endpoint must define a strict TypeBox / Zod JSON schema for request validation."
  - "Database migrations must be strictly additive and backward-compatible with the running deployment."

# Licensing & Dependency Constraints
governance:
  allowedLicenses: ["MIT", "Apache-2.0", "BSD-3-Clause", "ISC"]
  prohibitedLicenses: ["GPL-3.0", "AGPL-3.0", "SSPL"]
---

# Acme Billing Service — Architectural Constitution

## Philosophy
This service processes financial transactions. Reliability, immutability, and zero-downtime migrations take absolute priority over developer convenience.

## Core Invariants
1. **Idempotency**: All payment and billing endpoints must require an `Idempotency-Key` header.
2. **Audit Trails**: Financial records are append-only. Rows in `invoices` or `ledger_entries` are never updated in place.
```

---

## 3. Dual-Tier Enforcement Engine

```
                                  [Task Brief Dispatched]
                                             │
                                             ▼
                 ┌────────────────────────────────────────────────────────┐
                 │ TIER 1: COGNITIVE GUIDANCE (Dev-Level-1 Planner)       │
                 │ Injects architecturalRules + governance into context   │
                 │ Result: plan.md structurally respects constraints      │
                 └───────────────────────────┬────────────────────────────┘
                                             │
                                             ▼
                 ┌────────────────────────────────────────────────────────┐
                 │ Dev-Level-3 (Implementer) writes code & candidate.patch│
                 └───────────────────────────┬────────────────────────────┘
                                             │
                                             ▼
                 ┌────────────────────────────────────────────────────────┐
                 │ TIER 2: DETERMINISTIC MACHINE GUARD (In-Container)     │
                 │ Executed by Dev-Level-2 BEFORE calling Reviewer LLM:   │
                 │ 1. ast-grep scans candidate.patch for forbiddenImports │
                 │ 2. ripgrep scans for forbiddenRegex patterns           │
                 │ 3. osv-scanner checks new packages against license list│
                 │    (govulncheck is deduped in favor of osv-scanner)    │
                 │ 4. Tool versions must be pinned (no @latest allowed)   │
                 └───────────────────────────┬────────────────────────────┘
                                             │
                         ┌───────────────────┴───────────────────┐
                         ▼                                       ▼
                   Checks Pass                             Rule Violation
                         │                                       │
                         ▼                                       ▼
            ┌──────────────────────────┐            ┌──────────────────────────┐
            │ Invoke Dev-Level-2 LLM   │            │ Instant Reject (0 tokens)│
            │ for deep semantic review │            │ Return structured error: │
            └──────────────────────────┘            │ "Banned import: moment"  │
                                                    └──────────────────────────┘
```

### 3.1 Why Deterministic Pre-Filtering Is Critical
- **Cost & Speed**: If an implementer accidentally imports `moment` or leaves a `console.log`, calling a frontier reasoning model (Dev-Level-2) costs tokens and takes 10 seconds to say *"Please remove moment"*.
- **Fallback Strategy**: If an active project spans across boundary files that belong to an un-scanned adjacent module, a full re-scan and boundary re-calculation is mandated.
- The deterministic pre-filter catches this in **8 milliseconds** via `ast-grep` or `ripgrep` inside the container for **$0.00**, returning immediate revision instructions to Dev-Level-3.

### 3.2 Deterministic Guards vs. Assistive Invariant Heuristics
A critical distinction is maintained between:
1. **Deterministic Guards** (`forbiddenImports`, `forbiddenRegex`, `prohibitedLicenses`): Checks for the *presence* of forbidden tokens. These are binary, unambiguous, and carry near-zero false-negative rates. Violations trigger an immediate 0-token rejection.
2. **Assistive Invariant Heuristics** (`queryScopingInvariant`, structural encapsulation): Checking for the *absence* of a tenant-scoping predicate across open-ended query construction patterns (raw SQL strings, GORM/sqlx method chains, multi-function query builders) is fundamentally an open-world problem. A simple AST or regex pattern will catch obvious violations, but **cannot guarantee total absence of leaks**.
   - **No False Green Pass**: If an un-scoped query pattern is caught, it is flagged immediately.
   - **Confidence Penalty for Ambiguous Patterns**: Any file touching queries (`src/backend/repository/**`) that does *not* strictly route through provably-scoped repository wrappers (`approvedScopedWrappers`) automatically suffers a **confidence penalty** (e.g. -0.35, capping confidence at Medium/Low).
   - **Explicit Human Escalation**: In the Executive Review Packet, this file is surfaced with an explicit advisory: *"Query touched without provably scoped ORM wrapper: manual query review recommended for multi-tenant isolation"*. This ensures ambiguous queries never pass silently with artificial high confidence.

---

## 4. Lifecycle & Authorship

1. **Auto-Generation during Reconnaissance**:
   When a brownfield repository is onboarded, the Reconnaissance pass (§7.3) inspects the package manifests, ESLint configurations, and existing code patterns to author an initial draft of `.agents/constitution.md`.
2. **Lead Developer Sign-Off**:
   During the onboarding wizard, the human lead developer reviews, tunes, and commits the Constitution to the repository.
3. **Continuous Evolution**:
   When humans reject PRs due to team convention violations, the Continuous Learning Engine (§9) proposes additions to the Constitution, allowing the ruleset to mature over time with human approval.

---

## 5. Ecosystem Convention Files & Precedence Hierarchy (ADR-038)

Modern software repositories increasingly contain existing agent/developer guidelines authored for tools like Claude Code, Cursor, Windsurf, or Copilot. To eliminate duplicate rule authoring and make Graywolf feel native from day one, Graywolf automatically discovers and ingests these convention files.

### 5.1 Precedence Cascade

During the task pre-flight routine, rules are aggregated according to a strict hierarchical precedence order (higher levels override lower levels on direct conflicts; all non-conflicting rules are additive):

```
┌────────────────────────────────────────────────────────────────────────┐
│ Level 1: System Baseline Constitution (.specify/memory/constitution.md)│
│ Core invariants: Non-committing git barrier, blast radius scopes,       │
│ $0 OSS toolchain constraints, container security boundaries.           │
│ (IMMUTABLE — NEVER OVERRIDDEN BY REPOSITORY RULES)                     │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ overrides
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│ Level 2: Project Runtime Constitution (.agents/constitution.md)        │
│ Machine-executable linters, architecturalRules, banned packages,       │
│ approved licenses, vetted by human lead engineer.                      │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ overrides
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│ Level 3: Repo-Native Ecosystem Convention Files                        │
│ Discovered automatically at repository root during reconnaissance:     │
│ 1. AGENTS.md                                                           │
│ 2. CLAUDE.md                                                           │
│ 3. .cursorrules or .cursor/rules/*.mdc                                 │
│ 4. .windsurfrules                                                      │
└────────────────────────────────────────────────────────────────────────┘
```

### 5.2 Context Injection Mechanics

1. **Discovery**: During the pre-flight routine, `relay.mjs` scans the repository root for any of the supported convention files.
2. **Sanitization**: Discovered files are read into memory and checked against the **Blast-Radius Invariant**: convention files cannot override file scopes or disable the non-committing barrier (`git-guard.sh`).
3. **Prompt Section**: The raw markdown content is injected directly into Dev-Level-1 (Planner) and Dev-Level-3 (Implementer) context windows under the header:
   ```markdown
   ## Repository Local Guidelines (from AGENTS.md / CLAUDE.md)
   <Ingested markdown content>
   ```
4. **Zero Supply-Chain Bloat**: The parser is a lightweight native TypeScript markdown reader — no external meta-frameworks or runtime dependencies are required ($0 cost).

---

## 6. Pending Enhancements & Sequencing (Ledger)

To prevent Goodharting and maintain rule integrity, certain gaps from the field reports have explicit sequencing dependencies before they can be implemented into the constitution:
- **Gap 9 (Test Naming Validation)**: Must be sequenced **behind** Enhancement #9 (Adversarial Tester Persona). Enforcing test naming rules before separating test authorship from implementation incentivizes agents to write empty tests just to pass the guard.
- **Gap 4 (Polyglot Contract Registry)**: **RESOLVED**. Sequenced strictly behind N11b (Severity Classification) and fully specified in `review-gates-and-guardrails.md` §7.9 with binary severity tiers (Breaking hard-block vs Additive green-pass) and F11 diff-scoping.



<!-- END OF FILE: architecture/project-constitution.md -->

---


<!-- START OF FILE: architecture/relay-mjs-contract.md -->

# Source: architecture/relay-mjs-contract.md

# Graywolf Squad — Deep-Dive Architecture: `relay.mjs` In-Container Harness Contract

## 1. Executive Summary & Security Criticality

`relay.mjs` is the **single most security-critical runtime component** in Graywolf Squad. It is the only executable that bridges the untrusted agent execution environment (where arbitrary LLM-generated code runs) with the trusted orchestrator infrastructure.

It enforces three absolute invariants:
1. **Non-Committing**: `relay.mjs` NEVER executes `git push`, `git commit` to upstream, or any operation that modifies the remote repository state. All work produces a `changes.patch` file.
2. **Blast-Radius Enforcement**: All file mutations by the agent are validated against the `writableScope` / `readonlyScope` / `forbiddenScope` boundaries BEFORE being written to disk.
3. **Spend Ceiling Enforcement**: Every LLM call cost is accumulated locally and compared against `spendLimitUSD`. The relay halts execution the moment the ceiling is breached.

---

## 2. Runtime Environment

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│ Ephemeral Runner Container (Docker / Podman)                                           │
│                                                                                        │
│  User: graywolf (UID 10001, GID 10001)                                                │
│  Rootfs: Read-Only (--read-only)                                                       │
│  Writable Mounts: /workspace (git worktree), /tmp (tmpfs, noexec)                     │
│  Security: --cap-drop=ALL, --security-opt=no-new-privileges:true                      │
│  Network: Restricted egress (sandbox-hardening-and-network-egress.md)                  │
│                                                                                        │
│  ┌──────────────────────────────────────────────────────────────────────────────────┐  │
│  │ relay.mjs (Entry Point — PID 1 in container)                                     │  │
│  │                                                                                  │  │
│  │  1. Connects to orchestrator WebSocket (relay-protocol.md)                       │  │
│  │  2. Receives task.dispatch → unpacks context bundle                              │  │
│  │  3. Orchestrates Dev-Level-1 → Dev-Level-3 → Dev-Level-2 cognitive handoff       │  │
│  │  4. Enforces blast-radius, spend ceiling, and non-commit invariants              │  │
│  │  5. Produces result.json + changes.patch → sends result.final                    │  │
│  │  6. Exits cleanly (code 0 = success, 1 = error, 137 = OOM)                      │  │
│  └──────────────────────────────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

### 2.1 Environment Variables (Injected by Orchestrator at Container Spawn)

| Variable | Example Value | Purpose |
| :--- | :--- | :--- |
| `RELAY_AUTH_TOKEN` | `eyJhbGciOiJFUzI1NiI...` | Ephemeral JWT for WebSocket authentication (5-min TTL, auto-refreshed) |
| `RELAY_ORCHESTRATOR_URL` | `ws://orchestrator:3001/relay` | WebSocket endpoint |
| `RELAY_TASK_ID` | `TASK-104` | Current task identifier |
| `RELAY_WORKSPACE_ID` | `550e8400-e29b-41d4-...` | Workspace UUID for RLS scoping |
| `OPENAI_BASE_URL` | `http://litellm-proxy:4000` | LiteLLM proxy endpoint (all model calls route here) |
| `OPENAI_API_KEY` | `sk-graywolf-internal-proxy-token` | Internal proxy token (NOT a real provider key) |
| `RELAY_LOG_LEVEL` | `info` | `debug` \| `info` \| `warn` \| `error` |

> **Security Note**: No real provider API keys, Git PATs, or third-party secrets exist in the container environment. All are proxied via the Secrets Broker Sidecar (ADR-018) and LiteLLM Proxy (ADR-005).

---

## 3. Lifecycle Phases

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│ Phase 1: BOOT (< 2 seconds target)                                              │
│                                                                                 │
│  1. Parse environment variables                                                 │
│  2. Connect to orchestrator WebSocket                                           │
│  3. Authenticate with RELAY_AUTH_TOKEN                                           │
│  4. Receive task.dispatch message                                               │
│  5. Unpack context bundle:                                                      │
│     - brief.md (task specification)                                             │
│     - project.config.json (blast-radius, model routing, guardrails)             │
│     - constitution.md (architectural rules)                                     │
│     - repo-map.md (Layer 1 topological overview)                                │
│     - relevant_lessons[] (Layer 4 from continuous learning engine)               │
│  6. Initialize blast-radius guard (compile glob matchers)                       │
│  7. Initialize spend accumulator (currentSpendUsd = 0.0)                        │
│  8. Initialize file mutation ledger (empty set)                                 │
│  9. Run package installation: npm ci / pip install (Tier 1 cache, < 5s)         │
│ 10. Emit status.update: QUEUED → IN_PROGRESS                                   │
└─────────────────────────────────────────────────────────────────────────────────┘
                                        │
                                        ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│ Phase 2: COGNITIVE HANDOFF (Virtual Developer Tiers)                             │
│                                                                                 │
│  ┌───────────────────────────────────────────────────────────────────────────┐  │
│  │ Step A: Dev-Level-1 (Planner)                                             │  │
│  │  - Receives: brief.md + constitution + repo-map + lessons                 │  │
│  │  - Produces: plan.md (implementation strategy, file mutations, db tier)   │  │
│  │  - Validates: All planned file paths within writableScope                 │  │
│  │  - If scope violation: Emit escalation.emit → HALT                        │  │
│  └──────────────────────────────────┬────────────────────────────────────────┘  │
│                                     ▼                                           │
│  ┌───────────────────────────────────────────────────────────────────────────┐  │
│  │ Step B: Dev-Level-3 (Implementer)                                         │  │
│  │  - Receives: plan.md + full read access to /workspace                     │  │
│  │  - Executes: Code synthesis, file creation/modification, package install  │  │
│  │  - Every file write intercepted by blast-radius guard                     │  │
│  │  - Produces: Modified files in git worktree + unit tests                  │  │
│  └──────────────────────────────────┬────────────────────────────────────────┘  │
│                                     ▼                                           │
│  ┌───────────────────────────────────────────────────────────────────────────┐  │
│  │ Step C: Dev-Level-2 (Reviewer)                                            │  │
│  │  - Phase C.1: Deterministic pre-filter (ast-grep, ripgrep, osv-scanner)  │  │
│  │    └── If violation: Instant reject (0 tokens) → back to Step B          │  │
│  │  - Phase C.2: LLM-powered semantic review                                │  │
│  │  - Phase C.3: Execute test suite (npm test / pytest)                      │  │
│  │  - Phase C.4: Execute Playwright E2E (if ui-change tagged)               │  │
│  │  - Produces: review-signoff.md (approved | rejected)                      │  │
│  │  - If rejected: Increment internalReviewAttempts                          │  │
│  │    └── If attempts ≥ 2: Two-strike escalation → HUMAN_REVIEW_GATE        │  │
│  │  - If approved: Proceed to Phase 3                                        │  │
│  └───────────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────────┘
                                        │
                                        ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│ Phase 3: ARTIFACT COLLECTION & TEARDOWN                                         │
│                                                                                 │
│  1. Generate changes.patch: git add -A && git diff --binary --full-index HEAD > changes.patch │
│  2. Collect artifacts into .agents/tasks/{TASK_ID}/review/:                     │
│     ├── changes.patch                                                           │
│     ├── result.json                                                             │
│     ├── plan.md                                                                 │
│     ├── review-signoff.md                                                       │
│     ├── playwright-report/ (if applicable)                                      │
│     └── screenshots/ (if applicable)                                            │
│  3. Send artifact.ready for each artifact                                       │
│  4. Send result.final with complete RelayResult                                 │
│  5. Receive close frame acknowledgment from orchestrator                        │
│  6. Close WebSocket, write result.json to disk                                  │
│  7. Exit with code 0                                                            │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## 4. Blast-Radius Guard (File Mutation Interceptor)

The blast-radius guard is a synchronous interceptor on every file system write operation within `/workspace`:

```typescript
export interface BlastRadiusGuard {
  writableGlobs: string[];   // e.g. ['src/modules/billing/**', 'tests/modules/billing/**']
  readonlyGlobs: string[];   // e.g. ['src/database/models/**', 'src/shared/**']
  forbiddenGlobs: string[];  // e.g. ['src/core/auth/**', '.github/workflows/**']
  
  /**
   * Evaluates a proposed file path mutation.
   * @returns 'allow' | 'escalate'
   * @throws BlastRadiusViolation if path matches forbidden or is outside writable scope
   */
  evaluate(filePath: string, operation: 'create' | 'modify' | 'delete'): 'allow' | 'escalate';
}
```

### 4.1 Evaluation Priority

1. **Forbidden check** (highest priority): If path matches any `forbiddenGlobs` → **HARD HALT**. Emit `escalation.emit`, transition to `ESCALATED`.
2. **Writable check**: If path matches any `writableGlobs` → **ALLOW**. Log `file.mutation` event.
3. **Read-only check**: If path matches `readonlyGlobs` → **ESCALATE** with explanation.
4. **Default deny**: If path matches nothing → **ESCALATE** (fail-closed).

### 4.2 Protected System Files (Always Forbidden)

Regardless of `project.config.json` settings, the following are **always forbidden** for agent modification:

| Pattern | Rationale |
| :--- | :--- |
| `.git/**` | Direct Git internals manipulation |
| `.agents/project.config.json` | Self-modification of own configuration |
| `.agents/constitution.md` | Self-modification of own guardrails |
| `relay.mjs` | Self-modification of own runtime |

---

## 5. Spend Ceiling Enforcement

```typescript
export class SpendAccumulator {
  private currentSpendUsd: number = 0;
  private readonly limitUsd: number;  // from brief.md spendLimitUSD
  private readonly warningThreshold = 0.80; // 80%
  
  /**
   * Called after every LLM API call with the cost reported by LiteLLM.
   * @throws SpendCeilingExceeded if limit is breached
   */
  record(callCostUsd: number): void {
    this.currentSpendUsd += callCostUsd;
    
    // Emit cost.delta to orchestrator for real-time dashboard
    this.relay.send({
      type: 'cost.delta',
      payload: { costUsd: callCostUsd, totalUsd: this.currentSpendUsd }
    });
    
    // Warning at 80% — Actively steer the agent into wrap-up mode
    if (this.currentSpendUsd >= this.limitUsd * this.warningThreshold && !this.warningEmitted) {
      this.warningEmitted = true;
      this.relay.send({
        type: 'budget.warning',
        payload: {
          currentSpendUsd: this.currentSpendUsd,
          limitUsd: this.limitUsd,
          threshold: this.warningThreshold
        }
      });
      // Injects high-priority steering prompt into agent loop
      this.relay.injectSystemMessage(
        `[BUDGET_WARNING] 80% of spend limit reached ($${this.currentSpendUsd.toFixed(2)} / $${this.limitUsd.toFixed(2)}). ` +
        `Immediately switch to WRAP-UP MODE: complete your in-flight file edits, ensure your tests pass, ` +
        `and prepare the final patch diff.`
      );
    }
    
    // Hard ceiling (100%) — Flush checkpoint & salvage work instead of discarding
    if (this.currentSpendUsd >= this.limitUsd) {
      // 1. Stage ALL tracked and untracked files into the isolated scratch object store, then diff
      const patchSaved = this.relay.flushEmergencyPatch(); 
      // executes:
      //   git add -A
      //   git diff --binary --full-index HEAD > changes.patch
      const checkpoint = this.relay.writeCheckpoint({
        reason: 'budget_exceeded',
        spendUsd: this.currentSpendUsd,
        limitUsd: this.limitUsd,
        resumable: true
      });

      this.relay.send({ type: 'result.final', payload: {
        status: 'budget_exceeded',
        currentSpendUsd: this.currentSpendUsd,
        limitUsd: this.limitUsd,
        checkpointAvailable: true,
        patchSaved,
        checkpointPath: checkpoint.path
      }});
      process.exit(0); // Clean exit with state preserved for one-click resumption
    }
  }
}
```

### 5.1 Asynchronous Host-Streaming & Hard-Kill (OOM/137, SIGKILL) Recovery (N10)

Process-level exit handlers (like `process.exit(0)` or SIGTERM interceptors) cannot run when a container is killed uncatchably by the Linux kernel OOM killer (`exit code 137`) or immediate `SIGKILL`. To ensure zero work is lost even under catastrophic container termination:

1. **Continuous Real-Time Mutation Streaming**:
   - Every file write intercepted by the Blast-Radius Guard emits an asynchronous WebSocket event `file.mutation` to the Fastify orchestrator.
   - For files $< 256\text{ KB}$, the payload includes base64-encoded file contents and target path.
   - The orchestrator appends these writes to `.agents/tasks/{TASK_ID}/ledger/mutation_stream.log` and flushes them to host disk.
2. **Crash Reconstruction on Disconnect / Exit 137**:
   - If the container abruptly disconnects or terminates with exit code 137, the orchestrator detects the abnormal termination before `result.final` is received.
   - The orchestrator synthesizes `changes.patch.reconstructed` directly on the host from the mutation log, marking the task status as `CRASHED_RECOVERABLE` (`provenance: 'reconstructed'`).
   - The operator receives a Cockpit notification: *"Container halted unexpectedly (OOM/kill). 100% of in-flight file mutations were captured from the host stream. Click 'Resume' to continue in a fresh container."*

### 5.2 Resumable Budget Continuations & Multi-Layer Authorization (ADR-048, N15)
When a task halts at `budget_exceeded` or crashes:
1. The patch artifact (`changes.patch` or `changes.patch.reconstructed`) and `checkpoint.json` are retained on host disk with a **7-Day Retention TTL**.
2. The UI cockpit displays an **"Increase Budget & Resume"** button alongside historical spend benchmarks.
3. **Shipped Resumption Lifecycle**: Invoking `POST /api/v1/tasks/{id}/resume` with `{ additionalSpendLimitUSD: 5.00 }` provisions a **fresh container** with a clean base image, checks out the base branch, applies the preserved patch via `git apply --3way --binary`, and resumes `plan.md` execution.
   - If upstream `main` drifted during task execution, 3-way merge conflict detection flags it, invoking the Neutral Arbiter to synthesize an Escalation Decision Memo.

#### Security & Governor Guards on Resumption (N4):
To guarantee an agent container cannot call the resume endpoint to grant itself an infinite budget loop:
- **Network Segmentation (Topology A/B)**: Under ADR-040, Port 3000 (management API) listens on `control-net`/`edge-net`. Ephemeral task containers sit on `runner-net` and have **no network route to Port 3000**.
- **Server-Side Token-Class Verification (Topology C & Defense-in-Depth)**: The `POST /api/v1/tasks/{id}/resume` endpoint requires an authenticated **`OPERATOR_SESSION_TOKEN`** (human admin JWT/cookie). The handler strictly inspects the token claims and **rejects `RELAY_AUTH_TOKEN` with HTTP 403 Forbidden**.
- **Governor Hard Caps**:
  - `maxResumesPerTask`: Hard ceiling of **2 resumes** per task. Further budget increases require manual task re-creation.
  - `orgSpendLimitHardCapUSD`: Global workspace hard cap; no task resume can exceed the monthly workspace budget ceiling.

---

## 6. Non-Committing Git Operations

### 6.1 Allowed Git Commands

| Command | Purpose | Allowed? | Notes |
| :--- | :--- | :---: | :--- |
| `git status` | Inspect worktree state | ✅ | Reads index on tmpfs + worktree |
| `git diff` | Inspect unstaged work | ✅ | Worktree vs tmpfs index |
| `git diff --cached` | Inspect staged work | ✅ | tmpfs index vs read-only HEAD |
| `git diff --binary HEAD` | Generate full patch | ✅ | Captures ALL staged + unstaged changes including binaries |
| `git add` | Stage changes for patch generation | ✅ | Writes loose objects to scratch disk; updates tmpfs index |
| `git log` | Read commit history for context | ✅ | Reads read-only `.git/objects` and `HEAD` |
| `git blame` | Attribution analysis | ✅ | Read-only context query |
| `git checkout -- <file>` | Revert local changes during retry | ✅ | Restores from tmpfs index or read-only HEAD |

### 6.2 Blocked Git Commands (Hard-Blocked at Kernel and Wrapper Layers)

| Command | Reason | Enforcement |
| :--- | :--- | :--- |
| `git commit` | Non-committing invariant | Prohibited: cannot update `refs/heads/` (read-only filesystem) |
| `git push` | Non-committing invariant | Prohibited: network egress blocked + shell interceptor |
| `git merge` | Could corrupt worktree state | Prohibited: requires commit / ref update |
| `git rebase` | Could corrupt worktree state | Prohibited: requires commit / ref update |
| `git stash` | Modifies `refs/stash` and creates commits | Prohibited: use `relay_stash` tool (§6.4) |
| `git remote add/set-url` | Prevent exfiltration to rogue remote | Prohibited: wrapper interceptor + read-only `.git/config` |

### 6.3 Enforcement Mechanism: Triple-Layer Defense (ADR-047, N9)

```
┌────────────────────────────────────────────────────────────────────────────┐
│ LAYER 1: OS-LEVEL FILESYSTEM IMMUTABILITY (Kernel Invariant)               │
│ - /workspace/.git is mounted READ-ONLY (chmod -R 555 / :ro bind mount)    │
│ - Kernel denies writing to .git/refs/ or .git/HEAD with EROFS              │
│ - Physical impossibility: NO binary can commit, regardless of UID          │
└─────────────────────────────────────┬──────────────────────────────────────┘
                                      │
                                      ▼
┌────────────────────────────────────────────────────────────────────────────┐
│ LAYER 2: ISOLATED INDEX (TMPFS) & OBJECT STORE (SCRATCH DISK VOLUME)       │
│ - Container exports:                                                       │
│     GIT_INDEX_FILE=/tmp/graywolf/git/index          (tmpfs, RAM fast)      │
│     GIT_OBJECT_DIRECTORY=/scratch/git/objects       (scratch disk volume)  │
│     GIT_ALTERNATE_OBJECT_DIRECTORIES=/workspace/.git/objects               │
│ - Staging writes loose objects to disk volume, preventing RAM-backed OOM   │
│ - Pre-flight size guard: Staging payloads > 256MB are blocked & escalated  │
│ - Auto deny-globs: dist/**, build/**, node_modules/**, vendor/**, *.node   │
└─────────────────────────────────────┬──────────────────────────────────────┘
                                      │
                                      ▼
┌────────────────────────────────────────────────────────────────────────────┐
│ LAYER 3: HARDENED ARGUMENT & EXECUTION GUARD (/usr/local/bin/git)          │
│ - Strips global flags (-c, --git-dir, -C, etc.) to extract real subcommand│
│ - Catches and politely rejects blocked commands (exit code 128)            │
│ - Note: Setuid helpers are NOT used (disabled by no-new-privileges:true    │
│   and --cap-drop=ALL); security rests unconditionally on Layer 1 & Layer 2 │
└────────────────────────────────────────────────────────────────────────────┘
```

#### The Disk-Backed Scratch Object Store (N9):
Storing Git loose objects in memory-backed tmpfs created a critical failure mode: staging large build outputs or assets consumed container RAM, causing Playwright or compiler OOM kills (`exit 137`). Graywolf cleanly separates index and object storage:
1. `GIT_INDEX_FILE=/tmp/graywolf/git/index`: Keeps the index binary tree in RAM for sub-millisecond status checks.
2. `GIT_OBJECT_DIRECTORY=/scratch/git/objects`: Relocates loose object storage to an isolated, disk-backed scratch volume mounted with `noexec,nodev`. Sized to 10GB per container, completely uncoupling staging size from the container's 4GB RAM ceiling.
3. `GIT_ALTERNATE_OBJECT_DIRECTORIES=/workspace/.git/objects`: Reads historical commits from the read-only mount.
4. **Staging Pre-Flight Guard**: If an agent attempts `git add -A` and the proposed blob size exceeds **256 MB**, the wrapper blocks execution:
   `[GRAYWOLF RELAY] STAGING_SIZE_EXCEEDED: Staging payload would write 850MB of objects. Ensure build outputs (dist/, build/) are in .gitignore.`

### 6.4 Dedicated Stash Tool: `relay_stash` (N13)

Because `git stash` is strictly blocked by ADR-047 (read-only `.git` kernel mount prevents writing `refs/stash`), agents attempting to set aside unverified work or test alternative hypotheses require a dedicated, kernel-compliant stashing primitive. Under deterministic guard pressure (F12 suppressions, static AST gates), agents without a sanctioned stash mechanism inevitably improvise unsafe workarounds (e.g. copying files into temp directories or abandoning half-finished diffs).

The in-container relay exposes the tool `relay_stash`:

```typescript
export interface RelayStashOptions {
  action: 'save' | 'pop' | 'list' | 'drop';
  id?: string;               // Required for drop, optional for pop (defaults to latest)
  message?: string;          // Human-readable stash description for 'save'
  includeUntracked?: boolean;// Stash untracked files as well as modified (default: true)
}

export interface StashEntry {
  id: string;                // e.g. 'stash_1726531200_a1f9'
  message: string;           // e.g. 'WIP: Refactoring auth middleware'
  timestamp: string;         // ISO 8601
  fileCount: number;         // Total files captured
  files: string[];           // Relative file paths
  tarballPath: string;       // '/scratch/stash/stash_1726531200_a1f9.tar.gz'
}
```

#### Behavioral Invariants:
1. **`action: 'save'`**:
   - Queries dirty files via `git status --porcelain` (capturing unstaged, staged in tmpfs index, and untracked files if enabled).
   - Generates a unique stash identifier: `stash_${Date.now()}_${randomHex(4)}`.
   - Packages all target files into `/scratch/stash/{id}.tar.gz` on the disk-backed scratch volume (never in RAM-backed tmpfs).
   - Records metadata in `/scratch/stash/stash_index.json`.
   - Reverts the worktree to clean HEAD state: runs `git checkout -- .`, unlinks stashed untracked files, and clears the tmpfs Git index (`rm -f /tmp/graywolf/git/index`).
2. **`action: 'pop'`**:
   - Resolves target stash (latest if unspecified).
   - Verifies the current worktree is clean or contains no overlapping modifications with the archive. If collisions exist, halts with error `STASH_CONFLICT: Uncommitted changes conflict with stash contents`.
   - Extracts the tarball directly into `/workspace`.
   - Purges the tarball and removes the entry from `stash_index.json`.
3. **`action: 'list'`**:
   - Reads `/scratch/stash/stash_index.json` and returns all shelved entries with timestamps, file tallies, and descriptions.
4. **`action: 'drop'`**:
   - Deletes `/scratch/stash/{id}.tar.gz` and removes the entry from `stash_index.json`.
5. **Isolation Guarantee**: Stashes are strictly scoped to the container's ephemeral `/scratch` disk volume and are destroyed on container teardown. Stashes never leak across tasks or workspaces.

---

### 6.5 Manifest Write Lock Client (F14 Prerequisite)

When package manifests (`package.json`, `package-lock.json`, `go.mod`, `go.sum`, `Cargo.toml`) are in writable scope, concurrent agent tasks could clobber dependencies or create split-brain lockfile conflicts. `relay.mjs` enforces serialization:

1. **Automatic Package Manager Interception**:
   - `relay.mjs` wraps all package manager command invocations (`npm install`, `pnpm add`, `yarn add`, `go get`, `go mod tidy`, `cargo add`).
   - Prior to executing the child process, the relay dispatches an ARP request to the Orchestrator:
     ```json
     {
       "type": "manifest.lock.acquire",
       "payload": {
         "manifestPath": "package.json",
         "timeoutMs": 120000
       }
     }
     ```
2. **Lock Acquisition & Heartbeat**:
   - The relay blocks command execution until `manifest.lock.granted` is received from the Orchestrator with an assigned `lockToken` and a 60-second lease TTL.
   - During long installations, `relay.mjs` emits a 15-second heartbeat to refresh the Redis lease.
   - If the lock request times out after 120 seconds, `relay.mjs` aborts the command with exit code 126 and outputs:
     `[GRAYWOLF RELAY] MANIFEST_LOCK_TIMEOUT: Dependency manifest locked by another active task. Retrying or declare manifest in writableScope at dispatch.`
3. **Integrity Validation & Atomic Release**:
   - Once the installation finishes, `relay.mjs` executes a language-specific integrity check (`go mod verify` or `npm ls`).
   - The relay dispatches `manifest.lock.release` with `{ manifestPath, lockToken, success: true }`.
   - Records the updated manifest and lockfile in the task's `file.mutation` ledger for diff-scoping and review packet compilation.

---

## 7. Output Artifacts & `result.json` Contract

### 7.1 Output Directory Structure

```
.agents/tasks/{TASK_ID}/review/
├── changes.patch              # git diff of all modifications
├── result.json                # Machine-readable execution summary
├── plan.md                    # Dev-Level-1 implementation plan
├── review-signoff.md          # Dev-Level-2 review verdict
├── escalation-request.md      # (If escalated) Human decision request
├── playwright-report/         # (If UI tests ran)
│   └── index.html
├── test-results/              # (If E2E ran)
│   └── *.webm                 # Video recordings
└── screenshots/               # (If UI changes)
    ├── feature_happy_path.png
    └── edge_case_validation.png
```

### 7.2 `result.json` Schema

```typescript
export interface RelayResult {
  $schema: 'https://graywolfsquad.dev/schemas/delegate-relay.result.v1.json';
  version: 'delegate-relay.result.v1';
  taskId: string;
  status: 'completed' | 'failed' | 'escalated' | 'budget_exceeded' | 'cancelled' | 'disconnected';
  exitCode: number;            // 0 = success, 1 = agent error, 137 = OOM
  signal: string | null;       // 'SIGKILL' for OOM, null otherwise
  
  metrics: {
    durationMs: number;
    peakMemoryBytes: number;
    llmCallCount: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    totalCostUsd: number;
    cacheHitRate: number;      // 0.0 - 1.0
    internalReviewAttempts: number;
  };
  
  touchedFiles: string[];      // Paths modified relative to repo root
  
  blastRadius: {
    compliant: boolean;
    violations: string[];      // Empty if compliant
  };
  
  testResults: {
    unitTests: { passed: number; failed: number; skipped: number } | null;
    e2eTests: { passed: number; failed: number; skipped: number } | null;
    coverageDelta: number; // Percentage points change. MUST NOT BE NULL. Relay guarantees execution of `go test -cover` or `npm test -- --coverage` during flush.
  };
  
  agentReport: {
    summary: string;           // Human-readable narrative
    divergenceNotes: string;   // Deviations from plan.md
  };
}
```

---

## 8. Error Handling & Exit Codes

| Exit Code | Meaning | Orchestrator Response |
| :---: | :--- | :--- |
| `0` | Clean completion (check `result.json` for task-level status) | Process `result.json`, transition task state |
| `1` | Unrecoverable relay error (WebSocket failure, config parse error) | Mark task `ESCALATED`, notify human |
| `2` | Blast-radius violation (relay self-halted) | Mark task `ESCALATED`, create escalation subtask |
| `137` | OOM killed by kernel (Docker `--memory` limit exceeded) | Mark task `VERIFICATION_FAILED`, suggest splitting task |
| `143` | SIGTERM received (container being killed by orchestrator) | Mark task as `CANCELLED` |

---

## 9. Open-Source Foundation

| Responsibility | Library | License |
| :--- | :--- | :--- |
| Glob pattern matching (blast-radius) | `picomatch` | MIT |
| Git operations | Native `git` CLI (shell exec) | GPL-2.0 (CLI tool, not linked) |
| File watching (mutation tracking) | `chokidar` | MIT |
| Process management | Native Node.js `child_process` | MIT (Node.js) |
| Patch generation | Native `git diff` | GPL-2.0 (CLI tool, not linked) |
| WebSocket client | `ws` | MIT |

---

## 10. Dev-Level-3 Agent-Computer Interface (ACI) Schema

To achieve state-of-the-art developer ergonomics without importing complex, volatile external meta-frameworks, `relay.mjs` extracts battle-tested tool schemas from reference agent harnesses (DeepSeek Harness, OpenHands, SWE-bench).

To prevent scope creep during the initial proof-of-concept, the ACI is explicitly divided into **v1 (Thin Vertical Slice)** and **v2 (Full Platform Foundation)**.

### 10.1 V1 ACI (Thin Vertical Slice Requirements)

The initial slice requires robust primitives to prevent the agent from hanging on interactive prompts or butchering files:

```typescript
export interface V1AgentToolDefinitions {
  // PTY-Wrapped Sandboxed Shell Execution
  bash_execute: {
    parameters: {
      command: string;
      timeoutIdleMs?: number; // Idle timeout (no new stdout), NOT hard total execution timeout
    };
    execute: (args: { command: string; timeoutIdleMs?: number }) => Promise<{ stdout: string; stderr: string; exitCode: number }>;
    // V1 Enforcement Rules:
    // 1. MUST wrap in a PTY.
    // 2. MUST automatically inject non-interactive baseline: 
    //    `CI=true DEBIAN_FRONTEND=noninteractive GIT_TERMINAL_PROMPT=0 npm config set yes true`
    // 3. MUST auto-truncate output over ~1,000 lines (keeping head and tail).
    // 4. MUST respect network egress allowlists (ADR-028/030).
  };

  // Precise Search/Replace Modification
  edit_file: {
    parameters: {
      filePath: string;
      oldStr: string; // The exact contiguous block to replace
      newStr: string; // The replacement block
    };
    execute: (args: { filePath: string; oldStr: string; newStr: string }) => Promise<{ success: boolean; modifiedLines: number }>;
    // V1 Enforcement Rules:
    // 1. Exact match is the primary path (fails loudly and cheaply if model mis-transcribed whitespace).
    // 2. Fallback to narrow whitespace-normalization if exact match fails.
    // 3. HARD REJECT if `oldStr` matches more than one location in the file. NEVER silently pick the first match.
  };

  // Line-bounded file inspection
  view_file: {
    parameters: { filePath: string; startLine?: number; endLine?: number };
  };

  // Write new file or complete rewrite
  write_file: {
    parameters: { filePath: string; content: string };
  };
}
```

### 10.2 V2 ACI (Deferred to Full Orchestrator)

The following tools and mechanisms are deferred to v2 to keep the vertical slice minimal, but are critical for long-horizon tasks and complex multi-file refactors:

1. **`multi_edit` (Batched Atomicity)**: A tool accepting an array of `{file, search, replace}` operations applied as a single atomic batch, preventing the agent from running broken intermediate test suites during cross-file refactoring.
2. **Synchronous Fast-Path Linter Feedback**: Instead of a heavy `tsserver` LSP daemon, `relay.mjs` uses the project's configured `lintCommand` (`tsc --noEmit`, `eslint`, `ruff`) to run deterministically after edits. The output is fed synchronously back to Dev-Level-3 to catch typos quickly, and doubles as an incremental updater for the Layer 2 symbol index (avoiding full Tree-sitter re-indexes).
3. **Orchestrator-Enforced Scratchpad & Compaction**: 
   - A structural checkpoint forced by the harness every N turns (e.g., 8-10 calls) requiring the agent to summarize state, preventing context drift without relying on the LLM to optionally call a `write_scratchpad` tool.
   - A tool-call history compaction strategy that drops or summarizes older tool outputs as the session progresses, preventing the context window from suffocating on stale bash history.

### 10.3 Structured Trajectory Telemetry

Rather than emitting unstructured text dumps, the in-container runner emits typed trajectory events streamable over WebSocket via `e2c:output` (`payload.stream = 'trajectory'`) and serialized in `execution.log`:

```typescript
export type TrajectoryEvent = 
  | { type: 'thought'; content: string; timestamp: number }
  | { type: 'action'; tool: string; input: Record<string, unknown>; timestamp: number }
  | { type: 'observation'; output: string; durationMs: number; timestamp: number }
  | { type: 'reflection'; verdict: 'continue' | 'retry' | 'complete'; notes?: string; timestamp: number };
```


<!-- END OF FILE: architecture/relay-mjs-contract.md -->

---


<!-- START OF FILE: architecture/relay-protocol-and-websocket-contract.md -->

# Source: architecture/relay-protocol-and-websocket-contract.md

# Graywolf Squad — Deep-Dive Architecture: Relay Protocol & WebSocket Contract

## 1. Executive Summary & The Missing Wire Contract

Every architecture document in Graywolf references the bidirectional link between the **Control Plane** (Fastify orchestrator, PostgreSQL, Valkey/BullMQ) and the **Execution Plane** (ephemeral Docker sandbox containers running `relay.mjs`). Despite being the nervous system of the entire platform, this link has no formal protocol specification — message formats, lifecycle phases, reconnection policy, and backpressure strategy were implied but never defined.

This document specifies the **Agent Relay Protocol (ARP)** — the WebSocket-based wire contract governing all communication between the orchestrator and task sandbox containers.

---

## 2. Transport Layer

### 2.1 Internal (Topology A & B: Local / Self-Hosted)

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│ Isolated Execution Network: runner-net (ADR-040 Segmentation)                          │
│                                                                                        │
│   ┌───────────────────────────────┐       ┌───────────────────────────────────────┐   │
│   │ Orchestrator (Fastify)        │◄─────►│ runner-{TASK_ID} (relay.mjs)          │   │
│   │ ws://orchestrator:3001/relay  │  WS   │ Connects on startup, drops on exit    │   │
│   │ (Dedicated Port 3001 ONLY)    │       │ (Zero route to Port 3000 / DB)        │   │
│   └───────────────────────────────┘       └───────────────────────────────────────┘   │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

- **Protocol**: `ws://` over internal Docker bridge network (no TLS needed — traffic never leaves the host).
- **Endpoint**: `ws://orchestrator:3001/relay?taskId={TASK_ID}&token={EPHEMERAL_JWT}`
- **Authentication**: Short-lived JWT (5-minute TTL) generated by the orchestrator at container spawn time and injected via environment variable `RELAY_AUTH_TOKEN`.

### 2.2 External (Topology C: Hybrid SaaS / BYOC Runner)

```
┌─────────────────────────────────────┐        ┌──────────────────────────────────────┐
│ Graywolf Cloud SaaS (Control Plane) │◄──────►│ Customer VPC Runner (Execution Plane)│
│ wss://relay.graywolf.io/v1          │  WSS   │ Outbound-only, no inbound ports      │
│ mTLS / TLS 1.3                      │        │                                      │
└─────────────────────────────────────┘        └──────────────────────────────────────┘
```

- **Protocol**: `wss://` with TLS 1.3 minimum. Optional mutual TLS (mTLS) for enterprise deployments.
- **Endpoint**: `wss://relay.graywolf.io/v1?runnerId={RUNNER_ID}`
- **Authentication**: Runner registration token (long-lived, rotatable via dashboard) + per-task ephemeral JWT.
- **Connection Direction**: Always **outbound from runner to SaaS** (customer never opens inbound firewall ports, per ADR-015).

---

## 3. Message Envelope Format

All messages follow a single JSON envelope schema over WebSocket text frames:

```typescript
export interface RelayEnvelope {
  // Header
  v: 1;                              // Protocol version (semver major only)
  id: string;                        // UUIDv7 message ID (time-ordered)
  ts: string;                        // ISO 8601 timestamp
  taskId: string;                    // 'TASK-104'
  workspaceId: string;               // UUID
  
  // Routing
  direction: 'c2e' | 'e2c';         // control-to-execution | execution-to-control
  type: RelayMessageType;            // Discriminated union tag
  
  // Payload
  payload: Record<string, unknown>;  // Type-specific payload
  
  // Flow Control
  ack?: string;                      // Message ID being acknowledged (for reliable delivery)
  seq?: number;                      // Monotonically increasing sequence number per connection
}
```

### 3.1 Message Types (Control → Execution: `c2e`)

| Type | Purpose | Payload Schema |
| :--- | :--- | :--- |
| `task.dispatch` | Initial task brief + context bundle delivery | `{ brief: TaskBrief, contextBundle: ContextBundle, config: ProjectConfig }` |
| `task.cancel` | Graceful cancellation request (container has 10s to clean up) | `{ reason: string, gracePeriodMs: 10000 }` |
| `task.inject` | Mid-flight minor change injection (stay IN_PROGRESS) | `{ delta: string, files?: string[] }` |
| `clarification.response` | Human answer to a blocking clarification subtask | `{ subtaskId: string, answer: string }` |
| `review.feedback` | PR review comments from human/webhook for iterative revision | `{ comments: ReviewComment[], prUrl: string }` |
| `budget.warning` | Token spend approaching limit (80% threshold) | `{ currentSpendUsd: number, limitUsd: number }` |
| `budget.exceeded` | Hard budget halt — container must stop | `{ currentSpendUsd: number, limitUsd: number }` |
| `manifest.lock.granted` | Manifest write lock acquired by orchestrator (F14) | `{ manifestPath: string, lockToken: string, leaseTtlMs: number }` |
| `manifest.lock.rejected` | Manifest lock request timed out or denied | `{ manifestPath: string, reason: string }` |
| `heartbeat.ping` | Liveness probe from orchestrator | `{ nonce: number }` |

### 3.2 Message Types (Execution → Control: `e2c`)

| Type | Purpose | Payload Schema |
| :--- | :--- | :--- |
| `status.update` | Task state transition notification | `{ from: TaskStatus, to: TaskStatus }` |
| `event.stream` | Agent event for the Unified Event Stream (narrative timeline) | `{ event: AgentEvent }` (schema from observability-and-telemetry.md §2.1) |
| `terminal.chunk` | Raw stdout/stderr chunk for Xterm.js ground-truth rendering | `{ stream: 'stdout' \| 'stderr', data: string, encoding: 'utf-8' }` |
| `cost.delta` | LLM call cost increment for real-time spend tracking | `{ callId: string, model: string, inputTokens: number, outputTokens: number, costUsd: number }` |
| `file.mutation` | File create/modify/delete notification + base64 snapshot for crash reconstruction (N10) | `{ path: string, op: 'create' \| 'modify' \| 'delete', contentBase64?: string, isSnapshot: boolean, linesAdded: number, linesRemoved: number }` |
| `manifest.lock.acquire` | Request workspace-level mutex before mutating dependency manifest (F14) | `{ manifestPath: string, timeoutMs?: number }` |
| `manifest.lock.release` | Release held manifest mutex after package install/verify (F14) | `{ manifestPath: string, lockToken: string, success: boolean }` |
| `clarification.request` | Agent needs human input — triggers BLOCKED state | `{ subtaskId: string, questions: string[], maxQuestions: 5 }` |
| `escalation.emit` | Blast-radius violation or security concern detected | `{ type: EscalationType, detail: string }` |
| `artifact.ready` | Task artifact uploaded and ready for review | `{ artifactType: string, path: string, hash: string }` |
| `result.final` | Terminal message — task complete, container will exit | `{ result: RelayResult }` (schema from data-model.md §1.2) |
| `heartbeat.pong` | Liveness response to orchestrator ping | `{ nonce: number, uptimeMs: number, memoryUsedBytes: number }` |

---

## 4. Connection Lifecycle

```
Phase 1: HANDSHAKE
─────────────────────────────────────────────────────────────────
[Container Boot]
  │
  ▼
relay.mjs connects to ws://orchestrator:3001/relay?taskId=...&token=...
  │
  ▼
Orchestrator validates JWT, checks taskId exists and is QUEUED
  │
  ├── [Valid] → Sends `task.dispatch` message with full context bundle
  │              Connection state: ACTIVE
  │
  └── [Invalid] → Sends close frame (4001: Unauthorized) or (4004: Task Not Found)
                   Container exits with code 1

Phase 2: EXECUTION
─────────────────────────────────────────────────────────────────
[Bidirectional message exchange]
  │
  ├── relay.mjs streams: event.stream, terminal.chunk, cost.delta, file.mutation
  ├── Orchestrator may send: task.inject, clarification.response, budget.warning
  │
  ├── Heartbeat exchange every 15 seconds:
  │    Orchestrator sends heartbeat.ping → relay.mjs responds heartbeat.pong
  │    If 3 consecutive pings missed → Orchestrator marks task STALE
  │
  └── [Budget exceeded] → Orchestrator sends budget.exceeded → relay.mjs halts

Phase 3: TEARDOWN
─────────────────────────────────────────────────────────────────
[relay.mjs sends result.final]
  │
  ▼
Orchestrator acknowledges with close frame (1000: Normal Closure)
  │
  ▼
relay.mjs closes WebSocket, writes result.json, exits container with code 0
  │
  ▼
Orchestrator garbage-collects container, git worktree, and ephemeral DB
```

---

## 5. Reliable Delivery & Acknowledgment

### 5.1 At-Least-Once Delivery for Critical Messages

Not all messages require delivery guarantees. The protocol distinguishes:

| Delivery Guarantee | Message Types | Mechanism |
| :--- | :--- | :--- |
| **Fire-and-Forget** | `terminal.chunk`, `heartbeat.ping/pong`, `event.stream` | No ack. Lost chunks are acceptable (terminal is best-effort UX). |
| **At-Least-Once** | `task.dispatch`, `result.final`, `clarification.request/response`, `escalation.emit`, `cost.delta`, `file.mutation`, `artifact.ready` | Sender retries with exponential backoff until `ack` received. Max 3 retries, then circuit-break. Essential for N10 crash reconstruction and zero phase-3 artifact loss. |

### 5.2 Sequence Numbers, Gap Detection & Idempotent Ingest

Each connection maintains a monotonically increasing `seq` counter per direction.

1. **Idempotent Ingestion by `(taskId, seq, path)`**:
   - At-least-once delivery guarantees duplicates on network retransmits.
   - The orchestrator ingest pipeline keys incoming `file.mutation` events on `(taskId, seq)`. Duplicate `seq` frames are acknowledged immediately and dropped as no-ops without double-applying base64 snapshots to the staging reconstruction cache.
2. **Reconstruction Fidelity Attribution (`complete` vs `gapped`)**:
   - `seq` is strictly monotonic per stream.
   - If an ack-timeout circuit-break triggers or network drop forces a gap that replay cannot resolve, the surviving mutation set contains holes.
   - The reconstructed patch written on the host MUST stamp its provenance metadata block with:
     ```json
     {
       "reconstructionFidelity": "complete" | "gapped",
       "missingSequences": [43, 44],
       "salvagedFilesCount": 14
     }
     ```
     Operator review and attestation checks inspect `reconstructionFidelity` directly to assess salvage confidence before patch ingestion.
3. **Persist-Before-Ack (Crash Consistency)**:
   - To guarantee partial history survival if the relay or host crashes mid-stream, the orchestrator MUST `fsync` the mutation snapshot payload to disk *before* transmitting the WebSocket `ack` frame back to `relay.mjs`.

---

## 6. Backpressure Strategy & Spill-to-Disk Buffer

When the orchestrator cannot consume `e2c` messages fast enough (e.g., high-velocity `terminal.chunk` streams or rapid bursts of 256 KB base64 file snapshots):

1. **WebSocket Flow Control**: The orchestrator stops reading from the WebSocket, causing TCP backpressure to naturally throttle the sender (relay.mjs).
2. **Client-Side Buffering & Scratch Spill-to-Disk**:
   - `relay.mjs` maintains an in-memory ring buffer (max 1000 messages / 10MB).
   - If the in-memory buffer fills, oldest `terminal.chunk` messages are dropped first (they are fire-and-forget).
   - **Never-Dropped Guarantees**: `file.mutation`, `artifact.ready`, `cost.delta`, and `result.final` are **NEVER dropped**.
   - **Spill-to-Disk (`/scratch/spill/`)**: To prevent "never-dropped" snapshots from exhausting container RAM and triggering a V8 heap OOM on chatty tasks, overflow messages spill to the dedicated disk-backed scratch volume (`/scratch/spill/`, mounted `noexec,nodev`). If the 10GB scratch volume itself is exhausted, N10's unrecoverable path fallback triggers, sealing available state and raising an escalation.
3. **Slow Consumer Alert**: If backpressure persists for > 30 seconds, the orchestrator emits a warning to the event stream: *"Execution Plane output is being throttled. Live terminal view may lag."*

---

## 7. Reconnection Policy (BYOC / Topology C)

For Topology C (Hybrid SaaS) where network partitions are possible:

| Scenario | Behavior |
| :--- | :--- |
| **Clean disconnect (1000)** | Task completed normally. No reconnection. |
| **Abnormal disconnect (1006, network drop)** | Runner retries connection with exponential backoff: 1s, 2s, 4s, 8s, 16s, max 60s. Resumes from last acknowledged `seq`. |
| **Reconnection succeeds** | Orchestrator replays any unacknowledged `c2e` messages since last `ack`. |
| **Reconnection fails after 5 minutes** | Runner marks task as STALE, writes partial `result.json` with `status: "disconnected"`, exits. Orchestrator transitions task to `ESCALATED`. |

### 7.1 Session Resumption

On reconnection, the runner sends a `session.resume` frame:

```typescript
{
  v: 1,
  type: 'session.resume',
  taskId: 'TASK-104',
  lastAckedSeq: 847,   // Last c2e seq the runner processed
  lastSentSeq: 1203    // Last e2c seq the runner sent
}
```

The orchestrator replays any `c2e` messages with `seq > 847` and deduplicates any `e2c` messages it already received.

---

## 8. WebSocket Close Codes (Custom)

| Code | Meaning |
| :---: | :--- |
| `1000` | Normal closure — task completed |
| `4001` | Authentication failed (invalid or expired JWT) |
| `4002` | Budget exceeded — hard stop |
| `4003` | Task cancelled by human |
| `4004` | Task not found or already completed |
| `4005` | Protocol version mismatch |
| `4010` | Stale connection (heartbeat timeout) |

---

## 9. Security Considerations

1. **JWT Scope**: The ephemeral JWT injected at container spawn is scoped to exactly one `taskId` and one `workspaceId`. It cannot be reused for other tasks.
2. **Message Validation**: All incoming `e2c` messages are validated against a JSON Schema before processing. Malformed messages are logged and dropped.
3. **Terminal Scrubbing**: `terminal.chunk` payloads pass through the regex secret scrubber (ADR-018, security-and-secrets.md §4) before being written to the event stream or Xterm.js.
4. **Rate Limiting**: The orchestrator enforces a per-connection rate limit of 100 messages/second for `e2c` messages. Exceeding this triggers a `4010` close (prevents a compromised container from flooding the control plane).

---

## 10. Open-Source Foundation

| Responsibility | Library | License |
| :--- | :--- | :--- |
| WebSocket Server (Orchestrator) | `ws` (Node.js) | MIT |
| WebSocket Client (relay.mjs) | `ws` (Node.js) | MIT |
| JSON Schema Validation | `ajv` | MIT |
| UUID v7 Generation | `uuidv7` | MIT |
| JWT Signing/Verification | `jose` | MIT |


<!-- END OF FILE: architecture/relay-protocol-and-websocket-contract.md -->

---


<!-- START OF FILE: architecture/resource-admission-and-limits.md -->

# Source: architecture/resource-admission-and-limits.md

# Graywolf Squad — Deep-Dive Architecture: Resource Admission Control & Constrained Hardware Profiles

## 1. Executive Summary & The Edge Paradox

Graywolf Squad explicitly supports **Topology A: Local / Solo Self-Hosted** running on developer laptops, small cloud VMs, and single-board computers like the **Raspberry Pi 5 (8GB)**. 

At the same time, Graywolf mandates high-fidelity validation including **ephemeral PostgreSQL template database clones** and **headless Playwright Chromium browser runs**.

Running three concurrent Docker sandboxes, each spawning Chromium and a PostgreSQL clone alongside the Control Plane (Fastify, PostgreSQL 16 + `pgvector`, Valkey, BullMQ), easily demands **12GB–16GB of RAM**. On an 8GB Raspberry Pi or budget VPS, naive execution results in immediate kernel Out-Of-Memory (OOM) panics, frozen tasks, and system crashes.

Graywolf resolves this through **Dynamic Host Profiling & Resource Admission Control**.

---

## 2. Dynamic Host Hardware Profiler

Upon orchestrator boot, the platform probes host hardware metrics via Node's `os` subsystem and Docker Engine capabilities:

```typescript
export interface HostCapacity {
  totalMemoryBytes: number;
  freeMemoryBytes: number;
  cpuCores: number;
  hardwareProfile: 'constrained' | 'standard' | 'enterprise';
  maxResourceTokens: number;
  defaultConcurrencyCap: number;
}
```

### 2.1 Hardware Profile Matrix

| Hardware Tier | Memory / CPU Threshold | Profile Key | Max Concurrent Tasks | Playwright Strategy | Default Container Limits |
| :--- | :--- | :---: | :---: | :--- | :--- |
| **Constrained** | $\le$ 8GB RAM or $\le$ 4 vCPUs | `constrained` | **1** | Serialized; Headless with `--single-process --disable-gpu` or mock API tests unless tagged `mandatory-e2e` | `--memory=2.0g --cpus=1.5` |
| **Standard** | 16GB – 32GB RAM & 6–12 vCPUs | `standard` | **3** | Full parallel Chromium E2E suites | `--memory=4.0g --cpus=2.0` |
| **Enterprise** | $\ge$ 64GB RAM & 16+ vCPUs | `enterprise` | **8+** | Distributed multi-browser parallel matrix | `--memory=8.0g --cpus=4.0` |

---

## 3. Weighted Resource Admission Scheduler

Tasks do not consume identical resources. A documentation update or frontend style tweak (Tier 0) consumes negligible CPU and RAM, whereas a full database migration with automated Playwright UI recording (Tier 2) requires substantial memory.

Graywolf introduces a **Token-Bucket Admission Scheduler**:

```
                                  [Task Queued for Dispatch]
                                              │
                                              ▼
                             ┌──────────────────────────────────┐
                             │ Pre-Flight Resource Evaluator    │
                             │ Calculates required Task Tokens  │
                             └────────────────┬─────────────────┘
                                              │
                                              ▼
                      ┌─────────────────────────────────────────────────┐
                      │ Host Admission Gatekeeper                       │
                      │ Checks: (ActiveTokens + TaskTokens) <= MaxTokens│
                      └───────────────────────┬─────────────────────────┘
                                              │
                         ┌────────────────────┴────────────────────┐
                         ▼                                         ▼
                 [CAPACITY AVAILABLE]                     [CAPACITY SATURATED]
                         │                                         │
                         ▼                                         ▼
            Acquire Tokens & Launch Docker            Keep in QUEUED / READY State
            Sandbox with cgroup limits                Wait for active task to release
```

### 3.1 Task Token Weights

```typescript
export function calculateTaskTokens(task: TaskBrief, config: ProjectConfig): number {
  let tokens = 1.0; // Base: Worktree + Node.js/Python relay

  // Database Weight
  if (task.dbTier === 'isolated') {
    tokens += 1.0; // Template DB clone overhead
  }

  // Visual E2E Browser Weight
  if (task.tags.includes('ui-change') || task.tags.includes('mandatory-e2e')) {
    tokens += 1.5; // Chromium headless process allocation
  }

  return tokens;
}
```

- On a **Constrained Host (Max Tokens = 2.5)**:
  - A Tier 0 frontend task (1.0 token) and a documentation task (1.0 token) can run concurrently.
  - A full Tier 2 task with Playwright (3.5 tokens) will run strictly solo, and the scheduler temporarily throttles background lockfile cache-baking until the task completes.

---

## 4. Container cgroup Enforcement (OOM Containment)

To ensure an unruly build script (e.g. `npm build` running out of memory during Webpack bundle optimization) never crashes the host OS:
1. **Hard Memory Caps**: Every ephemeral container is spawned with `--memory` and `--memory-swap` set identically to prevent host thrashing.
2. **PID Limits**: `--pids-limit=512` prevents fork bombs during test iterations.
3. **Graceful OOM Handling**: If a task hits an OOM error (Docker exit code `137`), `relay.mjs` catches the SIGKILL signal and emits a structured `result.json` noting:
   > *"Container exceeded memory ceiling (2.0GB). Task halted gracefully. Recommend splitting into smaller modules or increasing host memory allocation."*


<!-- END OF FILE: architecture/resource-admission-and-limits.md -->

---


<!-- START OF FILE: architecture/review-gates-and-guardrails.md -->

# Source: architecture/review-gates-and-guardrails.md

# Graywolf Squad — Deep-Dive Architecture: Review Gates, Guardrails & Human Autonomy

## 1. Executive Summary

Autonomous coding agents must balance **high internal autonomy** (so developers are not spammed with intermediate questions) with **absolute external safety** (so the agent cannot unilaterally alter critical architecture or break production).

Graywolf Squad enforces a strict principle:
> **"Unconstrained autonomy inside the task sandbox; rigorous, standard-based gating at the system boundaries."**

Instead of building a proprietary in-app code review interface, Graywolf Squad leverages **industry-standard Pull/Merge Requests (GitHub, GitLab, Bitbucket via `repo-sdk`)** as the primary review vehicle, paired with **Blocking Clarification Subtasks** on the Kanban board for mid-flight questions.

---

## 2. The Line of Autonomy: What Is Autonomous vs. What Is Gated

```
┌──────────────────────────────────────────────┐       ┌────────────────────────────────────────────────┐
│      FULLY AUTONOMOUS (Inside Sandbox)       │       │         MANDATORY HUMAN APPROVAL GATES         │
├──────────────────────────────────────────────┤       ├────────────────────────────────────────────────┤
│ • Code synthesis & refactoring               │       │ 1. Blast-Radius Boundary Escalation            │
│ • Local file creation within Writable scope  │       │ 2. Irreversible / Destructive DDL Operations   │
│ • Package installation inside sandbox test   │ ────► │ 3. Security Vulnerability / Secret Exposure     │
│ • Internal build, lint, and test iterations  │       │ 4. Final Upstream Merge to Protected Branches  │
│ • Playwright headless browser E2E runs       │       │ 5. Task Cost / Token Budget Threshold Exceeded │
│ • Reviewer persona automated sign-offs       │       │ 6. Two-Strike Internal Review Failure          │
└──────────────────────────────────────────────┘       └────────────────────────────────────────────────┘
```

### 2.1 The 6 Mandatory Human Approval Gates

**CRITICAL RULE: "Progressive Trust" (e.g., granting an agent Writable scope elevation for 2 hours) CANNOT bypass these six gates.** Trust elevation only expands the Writable domain scope. These six gates remain atomic, per-instance approvals regardless of trust elevation.

1. **Blast-Radius Scope Escape**:
   - If a brownfield task is restricted to `src/modules/billing/**`, but the agent determines it must modify `src/core/auth/jwt.ts` or `.github/workflows/ci.yml`.
   - **Action**: Hard halt. Emits `escalation-request.md` and generates a blocking subtask assigned to human.
2. **Destructive / Irreversible Operations**:
   - Any SQL containing `DROP TABLE`, `DROP COLUMN`, `TRUNCATE`, destructive migrations, or modifications to cloud infrastructure definitions.
3. **Security, Licensing & Secret Violations**:
   - Inclusion of hard-coded credentials/keys detected via static regex scanners.
   - Introduction of packages with copyleft licenses (GPL/AGPL in non-GPL repos) or Critical/High CVEs.
4. **Final Upstream Merge**:
   - The agent never pushes directly to `main` or `release/*`. All output is delivered via Pull/Merge Request.
5. **Token / Monetary Budget Exceeded**:
   - If a task exceeds its allocated spend cap (`spendLimitUSD`, e.g. $3.00), execution halts immediately.
6. **Two-Strike Review Rejection**:
   - If in-container Dev-Level-2 Reviewer rejects the implementation twice, the loop breaks and escalates to human review.

### 2.2 Dynamic Configuration (`project.config.json`)

```jsonc
{
  "blastRadius": {
    "forbidden": [
      ".github/**",
      "src/core/auth/**",
      "**/migrations/**",
      "package.json"
    ]
  },
  "taskTags": {
    "db-migration": { "requireHumanPlanApproval": true },
    "security": { "requireHumanPlanApproval": true }
  },
  "limits": {
    "dailySpendCapUSD": 20.00,
    "internalReviewMaxAttempts": 2,
    "maxAutonomousRevisionsPerTask": 5,
    "webhookDebounceMs": 180000
  }
}
```

---

## 3. The 60-Second Review Gate: Standard PRs + Executive Review Packet

### 3.1 Why Native Pull Requests (GitHub / GitLab)?
- **Zero UI Friction**: Developers already live in GitHub / GitLab PR interfaces with inline diff commenting, code owners, and mobile review apps.
- **CI/CD Alignment**: Native PRs automatically trigger external enterprise CI/CD checks (SonarQube, CircleCI, GitLab CI).
- **Universal Audit Trail**: Keeps the exact commit history and approvals in the customer's enterprise VCS.

### 3.2 The 60-Second "Executive Review Packet" (PR Body Schema)

When Graywolf finishes a task, the orchestrator opens a Draft PR via `repo-sdk` with an auto-generated description structured for rapid scanning:

```markdown
## 🐺 Graywolf Squad — Task Summary: [TASK-104] Add Egyptian VAT 14% Calculation

### ⚡ Executive Overview (10-Second Read)
- **Objective**: Implement 14% VAT computation for physical goods checkout flow.
- **Affected Domain**: Billing & Invoicing (`src/modules/billing/**`).
- **Blast-Radius Compliance**: ✅ 100% compliant. 3 files modified, 0 protected files touched.
- **Cost & Turns**: $0.42 LiteLLM spend | 3 virtual turns | 0 review strikes.

---

### 🛡️ Quality & Security Gates
| Gate | Status | Details |
| :--- | :--- | :--- |
| **Blast Radius** | 🟢 PASSED | All edits confined to `src/modules/billing/**` |
| **Unit Tests** | 🟢 PASSED | 14/14 passed (+4 new tests, 0 regressions) |
| **Playwright E2E** | 🟢 PASSED | 2/2 scenarios passed (Checkout Flow) |
| **Security / Secret Scan** | 🟢 PASSED | 0 secrets found, 0 high/critical CVEs |
| **License Check** | 🟢 PASSED | All dependencies MIT / Apache 2.0 |

---

### 📸 Visual Proof (Playwright Artifacts)
| Checkout Calculation State | VAT Breakdown Modal |
| :---: | :---: |
| ![Checkout Screenshot](https://raw.githubusercontent.com/.../screenshot_checkout.png) | ![Modal Screenshot](https://raw.githubusercontent.com/.../screenshot_modal.png) |

> 🎥 **[Click to View Automated Playwright Flow Recording (.webm)](https://...)**

---

### 📂 Blast-Radius, Files Changed & Confidence Scores
*Agent confidence scores (ADR-033) are surfaced per-file to explicitly highlight where human scrutiny is most needed, especially in polyglot repos where the human reviewer may not be an expert in the target language. Ambiguous patterns (e.g. unverified query builders without provably scoped ORM wrappers) automatically trigger confidence penalties.*

- `[NEW]` `src/modules/billing/vat-calculator.ts` (+82 lines) — 🟢 **High Confidence (98%)** (Deterministic types matched, robust tests)
- `[MOD]` `src/backend/go/checkout_worker.go` (+14 lines) — 🟡 **Medium Confidence (75%)** (Concurrency channels added, please review mutex placement)
- `[MOD]` `src/backend/repository/invoice_repo.go` (+28 lines) — 🔴 **Low Confidence (55%) — Human Review Urged** (Query modified without provably-scoped wrapper; check multi-tenant `org_id` predicate!)
- `[NEW]` `tests/modules/billing/vat-calculator.spec.ts` (+44 lines) — 🟢 **High Confidence (100%)**
```

### 3.3 The 60-Second Review Mental Model:
1. **0–15s**: Read Executive Overview & verify green Quality Gate badges.
2. **15–30s**: Inspect embedded Playwright UI screenshot to verify visual correctness.
3. **30–50s**: Review the scoped 3-file diff in GitHub/GitLab's native diff viewer.
4. **50–60s**: Click **"Approve & Merge"**.

---

## 4. Ambiguity Resolution: Blocking Clarification Subtasks

When the agent requires human input, it does not stop the entire project or spew questions into an unstructured terminal log.

### 4.1 The Subtask Pattern on the Kanban Board
1. **Parent Task State**: Transitions from `IN_PROGRESS` to `BLOCKED` (`AWAITING_CLARIFICATION`).
2. **Child Subtask Generation**: The orchestrator spawns a high-priority child subtask:
   - **ID**: `TASK-104.1`
   - **Title**: `[CLARIFICATION REQUIRED] VAT rate for professional services vs goods`
   - **Assignee**: Assigned directly to the human developer.
   - **Description**: Contains the exact concise questions (max 5) formulated by `Dev-Level-1 Planner` in `clarification-request.md`.
3. **Cockpit Alert**: Pushed immediately to the Chat Cockpit:
   > *"Task 104 is blocked: Waiting for your answer on VAT rate categorization in TASK-104.1."*

### 4.2 Resuming Execution
- The human answers via:
  - Natural language in the **Chat Cockpit** (*"Services are 10%, physical goods are 14%"*), OR
  - Marking `TASK-104.1` complete with comments on the Kanban card.
- The subtask is marked `RESOLVED`.
- The parent task unblocks, injects the user's answers into `plan.md`, and resumes sandbox execution without cold-booting.

### 4.3 Two-Strike Review Escalations: The Decision Memo (ADR-050)

When a task triggers a **Two-Strike Review Escalation** (Dev-Level-2 rejects Dev-Level-3 twice consecutively), the platform must NOT dump raw Git diffs or technical model debates onto operators who may not be experts in the target language.

#### Neutral Arbiter Authorship (N8):
To prevent structural conflicts of interest (e.g. if Dev-Level-1 was a party to the architectural disagreement or authored the rejected plan), the memo is synthesized by an independent **Neutral Arbiter Model Profile** (LiteLLM alias `agent-arbiter` / Orchestrator PM tier). The arbiter reads the task brief, the two strike rejection logs, and the patch diff, producing an objective, unbiased **Escalation Decision Memo** (`escalation-memo.md`):

```markdown
## ⚖️ Escalation Decision Memo: [TASK-112] Go Error Wrapping vs Custom Structs

### 📝 The Core Dispute in Plain English
Dev-Level-3 implemented error handling using a custom struct type `AppError`. Dev-Level-2 rejected this twice, arguing that standard library `fmt.Errorf("...: %w", err)` error wrapping is the established convention in `pkg/errors/errors.go` and is required for `errors.Is` to work in upstream handlers.

### 🔍 Trade-offs & Consequences
- **Option A (Dev-Level-2's Proposal — Recommended)**:
  - *Action*: Refactor to use `fmt.Errorf("...: %w", err)` with typed sentinel errors.
  - *Pro*: 100% consistent with the rest of your Go backend; preserves call-stack unwrapping.
  - *Risk*: Takes ~1 additional minute and $0.15 in tokens to adjust 3 call sites.
- **Option B (Dev-Level-3's Proposal)**:
  - *Action*: Keep `AppError` struct as written.
  - *Pro*: Immediately ready to merge.
  - *Risk*: Creates architectural drift; callers cannot easily inspect underlying network errors.

### 🎯 Architect Recommendation
**Option A**. It preserves long-term codebase consistency.

---
[ 🟢 Proceed with Option A (Recommended) ]  [ 🟡 Accept Option B ]  [ 💬 Discuss in Cockpit ]
```

#### Async Notification & Non-Blocking Pipeline:
1. **Async Push Dispatch**: Pushes an immediate notification via webhook (Slack, Discord, Email, Mobile Push) so overnight escalations never stall the developer until morning.
2. **Non-Blocking Execution**: While the parent task awaits human input on Option A/B, other non-dependent tasks in the project DAG continue executing in parallel; the squad does not deadlock.
3. **Explicit Decision Attribution in Audit Trail (N14)**: When an operator makes a selection (e.g. clicking "Proceed with Recommended Default"), the resulting Pull Request compliance table and task audit ledger record the exact election:
   `| Escalation Resolution | 🟢 RESOLVED | ESC-112 resolved via Operator Default-Proceed (Option A) by @tarek (Audit #op-91a-c4) |`
   This ensures complete auditability and eliminates the "decision with no decision-maker" blind spot.
4. **Historical Workspace Spend Estimator (N14)**: When configuring `orgSpendLimitHardCapUSD`, the settings dashboard analyzes historical project telemetry to recommend informed limits:
   > *"Based on your historical burn ($32.00/day across 61 tasks), recommended monthly workspace cap is $150.00–$250.00."*

---

## 5. The PR Review Feedback Loop (Iterative Revision via Comments)

If the human developer reviews the PR on GitHub/GitLab and requests changes:

```
[Human leaves PR Review comment on GitHub/GitLab]
                     │
                     ▼
[repo-sdk Webhook receives pull_request_review event]
                     │
                     ▼
[Orchestrator awakens Task Container in Worktree]
                     │
                     ▼
[Injects review comments into Dev-Level-1 / Dev-Level-3]
                     │
                     ▼
[Agent applies revisions + re-runs unit & Playwright tests]
                     │
                     ▼
[Pushes new commit to existing PR branch + updates PR summary & screenshots]
```

This makes Graywolf feel like a real junior-to-mid developer sitting in the team: you comment on their PR, they push updates to the branch, and they update the screenshots automatically.

### 5.1 Webhook Debounce & DoW Mitigation

To prevent **Denial of Wallet (DoW)** attacks or accidental budget exhaustion from rapid-fire PR comments:
- **Webhook Debounce**: The orchestrator enforces a configurable debounce period (`webhookDebounceMs`, default 3 minutes). It will aggregate all incoming PR comments into a single revision task dispatch rather than spinning up a new container for every individual comment.
- **Revision Count Ceiling**: The `maxAutonomousRevisionsPerTask` (default 5) puts a hard upper limit on how many times an agent will respond to external webhook comments. If this limit is exceeded, the orchestrator ignores further webhooks for that PR until a human lead explicitly unblocks it via the dashboard.

---

## 6. The "Panic Button" (Graceful Stop/Cancel)

A critical component of operator trust is the ability to immediately halt a runaway agent. If a user clicks "Cancel" on a task in the Cockpit, the orchestrator MUST perform a multi-layered teardown, rather than simply dropping the web socket connection.

### 6.1 Teardown Sequence
1. **Container Process Group Kill**: A `SIGTERM` (followed by `SIGKILL` if timeout) must be sent to the container's process group, ensuring child processes (e.g., `npm install`, Playwright dev servers) are destroyed, freeing bound ports and memory.
2. **LLM Abort**: Any pending outbound requests to the LiteLLM Proxy are aborted to prevent stranded token spend.
3. **Database Drop**: Any ephemeral PostgreSQL template databases (e.g., `task_{id}`) created for the sandbox are explicitly dropped (`DROP DATABASE task_{id}`).
4. **Worktree Revert**: Uncommitted file changes in the task's worktree are wiped (`git restore . && git clean -fd`).
5. **State Update**: The task is marked as `CANCELLED_BY_USER` in the orchestrator database.

---

## 7. Static Analysis & Architectural Guardrails

To prevent architectural drift and ensure production safety in a polyglot environment, Graywolf Squad enforces deterministic static analysis gates during the CI and Review phases. These guards operate independently of the agent's LLM reasoning and cannot be bypassed.

### 7.0 Systemic Diff-Scoping & Taxonomy (Brownfield Protection)
- **CRITICAL RULE**: Static analysis rules MUST be scoped to prevent red-walling existing brownfield codebases. The baseline is always **the task's base SHA** (the worktree checkout point).
- **Scoping Taxonomy**:
  1. **Line-Scoped**: Applies only to changed hunks (e.g., `ripgrep` or `ast-grep` catching a new `console.log`).
  2. **File-Scoped**: Whole-file rules for new or modified files (e.g., migration safety).
  3. **Path-Scoped**: Structural bans (e.g., Gap 15) evaluated against new/moved files only.
- **Move-Attribution Quirk**: Tools like `golangci-lint --new-from-rev` re-attribute moved code as new. The platform MUST suppress move-attribution (or explicitly document it) to prevent drive-by refactors from triggering red-walls on unmodified legacy code.

### 7.1 Go Error Wrapping Guard (`ripgrep` + `errorlint`)
- **Gap Addressed**: Loss of error chains and `errors.Is`/`errors.As` support.
- **Implementation**: 
  - `ripgrep` acts as a **cheap high-recall pre-filter** to detect `%v` inside `fmt.Errorf`.
  - `errorlint` (via `golangci-lint`) acts as the **deterministic authority**. It performs proper SSA analysis to verify whether an actual `error` type is being wrapped with `%v` instead of `%w` (preventing false positives like `fmt.Errorf("user %v not found", userID)`).

### 7.2 Unbounded Goroutine Spawn Guard (`ast-grep`)
- **Gap Addressed**: Goroutine leaks from unbounded concurrency leading to task hang and orchestrator timeout.
- **Rule**: An `ast-grep` policy enforces that `go func()` spawns must be bound to a synchronization primitive (e.g., `errgroup.Group`) or explicitly pass a `context.Context` to handle cancellation.
- **Implementation**: The pipeline uses tree-sitter AST queries with relational rules (e.g., `inside` a function declaration with a `ctx` parameter) to reliably detect context passing, rejecting raw `go func() { ... }()` calls lacking bounded context logic.

### 7.3 Banned `context.Background()` Usage (`ast-grep`)
- **Gap Addressed**: Accidental breaks in trace propagation and timeout deadlines.
- **Rule**: Explicitly bans `context.Background()` inside any function that accepts a `ctx` parameter.
- **Implementation**: Handled via relational `ast-grep` rules.
- **Exception Scope**: Graceful shutdown and cleanup paths explicitly require a fresh `context.Background()`-derived timeout; these paths are exempted from the rule.

### 7.4 TypeScript Trust Boundary Assertions (`ast-grep`)
- **Gap Addressed**: Blanket type assertions hiding data shape drift.
- **Rule**: Bans `as Foo` assertions strictly at trust boundaries. **Configuration Requirement (F16)**: The specific trust-boundary anchor list (e.g., `response.json()`, `JSON.parse`, `localStorage`, `postMessage`, WebSocket frames) MUST be dynamically seeded by the recon pass as constitution variables, not hardcoded. Idiomatic usage like `event.target as HTMLInputElement` stays warn-level.

### 7.5 Path-Scoped Banning (e.g., Database Connections)
- **Gap Addressed**: Database logic leaking into arbitrary application layers.
- **Rule**: Forbids invoking connection pools like `sql.Open` outside of the sanctioned database module. **Configuration Requirement (F16)**: The sanctioned path (e.g., `internal/database/**`) MUST be seeded by the recon pass as a constitution variable. This allows the guard to adapt to any repo layout without fighting it.

### 7.6 Redis Namespacing (Gap 15 Pattern)
- **Gap Addressed**: Tenant collision vectors in shared KV stores.
- **Rule**: The literal-key lint (e.g. `redis.Set("shipment:123", ...)`) is bypassable by dynamic strings (e.g. `fmt.Sprintf`). Therefore, the primary deterministic enforcement relies on the **Gap 15 Pattern**: direct Redis client imports are **banned** outside of the sanctioned cache module (e.g., `internal/cache/**`, recon-seeded). The keybuilder encapsulating the workspace ID must live inside that module. The literal lint stays as a cheap auxiliary check.

### 7.7 Schema-Aware SQL Validator
- **Gap Addressed**: Drift between Go structs (or TS interfaces) and the actual database schema columns.
- **Rule**: An automated validation step intercepts inline SQL and query builders in the codebase. It statically cross-references projected/inserted columns against the canonical PostgreSQL schema defined in `data-model.md` or the live database schema definition.

### 7.8 Migration Safety Analyzer (ADR-047 Collision Resolution)
- **Gap Addressed**: Backward-incompatible database changes breaking live deployments.
- **Rule**: The migration pipeline intercepts all generated SQL migrations (triggered strictly by `**/migrations/**` path hits or migration-directory ledger hits).
- **Implementation**: 
  - **Syntactic**: Uses parsed AST (`pg_query_go`) to deterministically block destructive DDL operations like `DROP COLUMN` and `RENAME COLUMN`.
  - **Behavioral (Orchestrator Prepares, Sandbox Executes)**: 
    - The Orchestrator resolves the baseline ref (previous release tag) and materializes it via `git archive` into a read-only `/baseline` volume, mounted into the Sandbox.
    - The Sandbox applies the migration to the Tier 2 ephemeral DB and runs the `/baseline` test suite against it. Baseline tests failing proves backward incompatibility. Emits `backward_compat_results.json` as a mandatory artifact.
  - **Cost Control**: Scoped to integration/repository-layer tests only, utilizing `-short` flags, time-boxed via the idle-timeout machinery, and the budget estimator is informed.
  - **Concurrency Precedence**: Recon discovers runner mode (`transactionalMigrations: true|false`). If `true`, `CONCURRENTLY` is invalid (errors inside transactions). If `false`, plain `CREATE INDEX` warns with lock-table rationale. Each rule binds strictly to the runner mode.

### 7.9 Polyglot Contract Registry (Gap 4, N11b Integration)
- **Gap Addressed**: Silent contract drift across language boundaries for non-HTTP asynchronous payloads (e.g., BullMQ queue jobs, Redis Pub/Sub messages, WebSocket broadcast frames). Unlike HTTP endpoints (which are governed by OpenAPI contracts via ADR-049), asynchronous event envelopes traditionally lack cross-language compile-time safety between Go backend workers and TypeScript frontend/worker services.
- **Registry Specification**:
  - **Location & Format**: Language-agnostic canonical schemas are maintained in `.agents/contracts/` using JSON Schema (Draft 2020-12) or Protobuf (`.proto`).
  - **Type Derivation**: Neither Go nor TypeScript owns the source of truth. Types are generated via deterministic toolchains (`quicktype` for Go structs in `pkg/contracts/`, `json-schema-to-typescript` for TypeScript interfaces in `src/contracts/`).
- **Severity Classification (N11b Enforcement)**:
  - When a task touches messaging contracts, the orchestrator generates a diff against the baseline schema and assigns an explicit severity tier:
    1. **Breaking Contract Changes (Hard Red-Gate Block)**:
       - Deleting fields from an existing payload schema.
       - Changing primitive types (e.g., `string` to `number`).
       - Converting an optional property into a required field.
       - Renaming queue topic names, event discriminators, or WebSocket message types.
       - *Enforcement*: Hard failure in Tier 2 deterministic guard. Emits `.agents/tasks/{TASK_ID}/review/contract_violation.json`. Halts autonomous merging and requires human operator sign-off in the Executive Review Packet.
    2. **Additive Contract Changes (Green Informational Pass)**:
       - Adding new optional fields with backwards-compatible defaults.
       - Registering new event topics or message types that do not alter existing listener contracts.
       - *Enforcement*: Non-blocking green pass. Logged as `additive_schema_evolution` in the PR summary.
- **Diff-Scoping (F11)**:
  - Contract validation is strictly scoped to schemas modified or added within the task's patch relative to the base commit. Legacy brownfield payloads outside the active blast radius are never red-walled.

### 7.10 Sanctioned Suppression & Inverse Guard
- **Gap Addressed**: Without a front door, suppressions get improvised. 
- **Rule**: A standard suppression pattern is sanctioned: `// graywolf:ignore(<rule-id>) <reason> @ <YYYY-MM-DD>`. 
- **Mechanism**: Suppressions have a **90-day expiry**. Older suppressions will re-flag. All suppressions are surfaced explicitly in the Executive Review Packet.
- **Inverse Guard**: Naked suppressions (e.g., `//nolint`, `eslint-disable`, `# type: ignore`) in *new code* are explicitly targeted and banned by the guards.

### 7.11 Shadow Mode (Guardrail Incubation)
- **Gap Addressed**: Flawed new guards (false positives) train agents to route around the guard tier entirely.
- **Rule**: Every newly added deterministic guard runs in **report-only (shadow) mode** for its first 20 tasks, or until its measured false-positive rate falls below 10%. Only then does it flip to block severity.


<!-- END OF FILE: architecture/review-gates-and-guardrails.md -->

---


<!-- START OF FILE: architecture/sandbox-and-testing.md -->

# Source: architecture/sandbox-and-testing.md

# Graywolf Squad — Deep-Dive Architecture: Execution Sandbox & Real-World Testing

## 1. Problem Statement

An agent that writes a full-stack feature (database migration + API endpoint + React UI) must be able to **prove its work is correct** before a human or AI-PM reviewer ever sees it. Doing this wrong causes either:
- **State Pollution**: Schema migrations from concurrent tasks corrupt each other's test data.
- **False Confidence**: Shallow mocked tests pass in isolation but fail in integration.
- **Cost Explosion**: Provisioning a full cloud database per task burns budget and adds 30–60 seconds to every task startup.

The solution is an **Adaptive Sandbox Matrix** where the orchestrator selects the minimum viable isolation level required by each task, with the human retaining full override authority.

---

## 2. Industry Art Survey

| Platform | Sandbox Strategy | Lesson Extracted |
| :--- | :--- | :--- |
| **Devin (Cognition Labs)** | Full persistent cloud VM per session | Expensive; great for long sessions but overkill per-task |
| **OpenHands (OpenDevin)** | Docker container per task + terminal; optional remote backend | Proves ephemeral containers + in-process terminals are sufficient |
| **Daytona / Gitpod** | Pre-built dev environment snapshots (Dev Container spec); fast clone | Pre-warmed base images drastically reduce cold-start time |
| **GitHub Actions** | Service containers (real Postgres/Redis sidecars); ephemeral per workflow run | Ephemeral sidecar databases are reliable for CI and agent testing |
| **Railway / Render PR Envs** | Temporary environment per Git branch including full DB clone | Postgres `CREATE DATABASE ... TEMPLATE` pattern works at real scale |

**Synthesis**: Best systems combine fast ephemeral containers (OpenHands) + pre-warmed images (Gitpod) + real sidecar databases only when needed (GitHub Actions).

---

## 3. The Adaptive Sandbox Matrix

### 3.1 Three-Tier Database Isolation Strategy

```
                   [Task Dispatched to Orchestrator]
                                  │
                                  ▼
            ┌──────────────────────────────────────────┐
            │   Pre-Flight Isolation Analyzer           │
            │   Inspects:                               │
            │   • plan.md touched file paths            │
            │   • Migration file pattern matches        │
            │   • Task tags (e.g. "db-migration")      │
            │   • project.config.json overrides        │
            └──────────────────────────────────────────┘
                                  │
      ┌───────────────────────────┼───────────────────────────┐
      ▼                           ▼                           ▼
  ISOLATION TIER 0: MOCK       ISOLATION TIER 1: SHARED       ISOLATION TIER 2: ISOLATED
  No DB attached.              Connects to shared dev DB      Dedicated DB per-task.
  Pure unit test               with per-task schema           Dropped on exit.
  mock stubs only.             namespace.                     

  Triggers:                    Triggers:                      Triggers:
  • Frontend-only tasks        • Read/CRUD queries            • Any migration file
  • Docs, styles               • No schema changes            • Schema alterations
  • Pure algorithm tasks       • Stateless API calls          • Extension installs

### 3.1.2 Provisioning Engines (For Tier 2 Isolation)
When Tier 2 (Isolated) is required, Graywolf provisions the database using one of two engines:
1. **Fast-Clone Engine**: Native snapshot/template capabilities (e.g., PostgreSQL `CREATE DATABASE ... TEMPLATE`). Sub-300ms boot. Default if the target stack uses Postgres.
2. **Generic Engine**: Uses Testcontainers to provision a fresh container. Used for MongoDB, MySQL, Redis, Kafka, etc. Slower boot (seconds) but universal Docker support.
```

### 3.2 The Fast-Clone Engine (Postgres Template Cloning)

PostgreSQL ships a native, battle-tested feature — **template databases**:

```sql
-- Done ONCE during project onboarding:
CREATE DATABASE graywolf_template WITH TEMPLATE template0;
\i schema/baseline.sql  -- apply all migrations to template

-- Per task at container start (~150–300ms):
CREATE DATABASE task_abc123 TEMPLATE graywolf_template;

-- At container teardown:
DROP DATABASE task_abc123;
```

**Properties**:
- **Speed**: Complete clone in under 300ms (filesystem-level copy inside PostgreSQL).
- **Fidelity**: 100% real PostgreSQL including `pgvector`, JSONB, triggers, custom types.
- **Cost**: Zero external cloud cost — runs inside a Postgres sidecar on the host Docker network.

### 3.3 The Generic Engine (Testcontainers + Pluggable Providers)

For any database engine lacking a native sub-300ms template-clone feature (MongoDB, MySQL, Redis, Kafka), Graywolf adopts **Testcontainers** as the generic provisioning backbone. Rather than building a bespoke lifecycle manager for every possible tech stack, Graywolf provides an adapter from Testcontainers into the sandbox lifecycle.

**Provider Plugin Manifest**:
A unified Plugin system handles this (ADR-046). Providers are defined in `.agents/sandbox-providers/`:
- **Built-ins**: Postgres, MySQL, MongoDB, Redis (scrutinized, digest-pinned).
- **Custom**: Developers can drop a manifest defining the Docker image, wait-strategy/healthcheck, seed hook, and clone strategy (`template` | `fresh`). Community plugins undergo strict supply-chain scrutiny (same as Skills).

### 3.4 Zero-Friction Onboarding (Configuration Schema)

The genericity does not compromise first-run simplicity:
1. **Auto-Detect**: Brownfield Recon's Phase 1 parses `docker-compose.yml`. If it finds `mongo`, it maps it to the built-in Mongo Provider Plugin. The developer does nothing.
2. **Tier 0 Default**: If there is no compose file and no `.agents/project.config.json` override, the system defaults to Isolation Tier 0 (Mock, no DB) to avoid assuming Postgres.
3. **Ambiguity Fallback**: Only if recon is ambiguous does the UI onboarding wizard ask what the app depends on.

```jsonc
{
  "sandbox": {
    "defaultDbTier": "auto",          // "auto" | "mock" | "fast-clone" | "generic"
    "providers": ["mongodb", "redis"], // Auto-detected from docker-compose.yml
    "allowAgentDecision": true
  }
}
```

---

## 4. Playwright Headless E2E Testing in the Sandbox

### 4.1 Why Headless E2E Testing Is Non-Negotiable

An agent that only runs unit tests before submitting is like a developer who writes code without refreshing the browser. Full-stack features break in ways unit tests never catch:
- React component renders blank because the API response shape changed.
- A modal closes unexpectedly due to CSS `z-index` conflict after branch merge.
- A form submission silently fails on HTTP 422 with no user-facing error.

Playwright inside the sandbox catches **all of these before any human ever sees the code**.

### 4.2 Multi-Language Runner Image Composition

The Phase 1 Brownfield Recon detects manifests (e.g., `package.json`, `go.mod`, `Cargo.toml`) in the target repository. If a polyglot stack is detected (e.g., Node + Go), the orchestrator dynamically composes a custom multi-toolchain runner image on the fly, caching the result.

This ensures tools like `npm run lint`, `go test -race`, and `cargo clippy` can execute side-by-side in a single sandbox without falling back to host execution. 

Playwright and its Chromium binary are pre-installed in the base image layer to eliminate 400MB downloads per task:

```dockerfile
# Dynamically Composed Polyglot Image (e.g. Node + Go)
FROM node:20-slim AS base
RUN npx -y playwright@latest install-deps chromium
RUN npx -y playwright@latest install chromium

# Re-layered based on detected manifests (go.mod detected)
COPY --from=golang:1.22-alpine /usr/local/go/ /usr/local/go/
ENV PATH="/usr/local/go/bin:${PATH}"

# ... rg, git, tree-sitter, relay.mjs
```

### 4.3 Full-Stack E2E Test Flow Inside the Container

When a task is tagged `ui-change` or `api-change`, **Dev-Level-2 (Reviewer)** executes the full-stack validation loop. Rather than assuming hardcoded npm scripts, dev-server commands and readiness probes are read dynamically from `.agents/project.config.json`:

```json
// .agents/project.config.json (Polyglot Example: Go REST API + Vite/React Frontend)
{
  "devServers": {
    "backend": {
      "command": "go run ./cmd/server",
      "cwd": ".",
      "readinessProbe": { "type": "http", "url": "http://127.0.0.1:8080/health", "timeoutMs": 30000 }
    },
    "frontend": {
      "command": "npm run dev",
      "cwd": "./web",
      "readinessProbe": { "type": "stdout_match", "regex": "ready in [0-9]+", "timeoutMs": 15000 }
    }
  },
  "e2e": {
    "command": "npx playwright test tests/e2e/ --reporter=json,html"
  }
}
```

The in-container orchestration flow executes:

```
1. Boot backend server (if declared in devServers.backend):
   $ ${devServers.backend.command} &
   (poll readinessProbe.url → 200 OK, or wait for stdout_match, timeout from config)

2. Boot frontend server (if declared in devServers.frontend):
   $ ${devServers.frontend.command} &
   (poll readinessProbe.url or listen for stdout_match, e.g. Vite "ready in Xms")

3. Run Playwright suite:
   $ ${e2e.command}

4. Collect artifacts into Review Packet:
   .agents/tasks/<TASK_ID>/review/
   ├── changes.patch
   ├── result.json
   ├── review-signoff.md
   ├── playwright-report/index.html
   ├── test-results/*.webm          (video recordings)
   └── screenshots/
       ├── feature_happy_path.png
       └── edge_case_validation.png
```

### 4.4 The Review Packet: Visual Proof for Humans and AI-PM

When the task reaches the Gate (human, AI-PM, or auto-approve), the reviewer sees:
- **Code diff** (`changes.patch`) — what changed
- **Test results** — pass/fail counts, duration, coverage delta
- **Embedded screenshots** of actual UI states after the change
- **Video playback** of the automated user flow for complex features

This is the same proven pattern used by **Chromatic** (Storybook visual diffing), **Percy.io**, and **Argos CI** — all of which embed visual diffs directly into PR review workflows.

### 4.5 Agent-Written vs. Pre-Existing E2E Tests

| Mode | Behavior |
| :--- | :--- |
| **Pre-existing tests exist** | Agent runs `tests/e2e/` as-is. Failures block task completion. |
| **No E2E tests for the feature** | Dev-Level-3 writes a Playwright spec covering the happy-path user flow. Dev-Level-2 runs and validates it. |

**Rule**: The agent always writes E2E tests for any `ui-change` tagged task if none exist.

---

## 5. QA Agent Persona (Extension Point)

The architecture natively supports a **QA Specialist Agent** (`Dev-Level-4: QA`) that:
- Generates adversarial Playwright scenarios (invalid inputs, race conditions, auth edge cases).
- Runs accessibility audits via `@axe-core/playwright`.
- Produces visual regression diffs against baseline screenshots using `pixelmatch`.

Invoked on tasks tagged `qa-intensive` or configured as mandatory for release-blocking features.

---

## 6. Open-Source Foundation

| Responsibility | Library | License |
| :--- | :--- | :--- |
| Generic Database Provisioning | `testcontainers` | MIT / Apache 2.0 |
| Ephemeral Postgres template cloning | Native PostgreSQL `CREATE DATABASE ... TEMPLATE` | PostgreSQL License |
| Container lifecycle management | `dockerode` | Apache 2.0 |
| Headless browser testing | `@playwright/test` | Apache 2.0 |
| Accessibility testing | `@axe-core/playwright` | MPL 2.0 |
| Visual regression diffing | `pixelmatch` | MIT |

---

## 7. Docker Network Topology (ADR-040 Segmentation)

```
Multi-Bridge Network Segmentation (ADR-040 / local-development-topology.md):

├── edge-net (Bridge — Host published ports only)
│   ├── dashboard (React UI :5173 / :80)
│   └── orchestrator (Fastify Client REST API :3000)
│
├── control-net (Internal Bridge: internal: true — No runner route)
│   ├── orchestrator (Control plane Fastify core)
│   ├── postgres-shared (Postgres 16 + pgvector :5432 — Tier 1)
│   ├── valkey (BullMQ / Session Cache :6379)
│   └── litellm-proxy (Model gateway :4000)
│
├── daemon-net (Internal Bridge: internal: true — 2 members only)
│   ├── orchestrator
│   └── docker-proxy (tecnativa/docker-socket-proxy :2375)
│
└── runner-net (Isolated Execution Plane — Per-Task ephemeral sandboxes)
    ├── orchestrator:3001 (ARP WebSocket listener ONLY — no route to :3000)
    ├── runner-{TASK_ID}
    │   ├── /workspace → git worktree (read-write)
    │   ├── /app.readonly → source mount (read-only, brownfield)
    │   └── relay.mjs (non-commit harness)
    └── postgres-{TASK_ID} (Tier 2 only)
        └── DB: task_{TASK_ID} (cloned from graywolf_template)
```

---

## 8. Permanent CI Adversarial Regression Suite (`relay.mjs` & Sandbox Security)

To prevent security regressions and ensure the physical guarantees of ADR-047 and ADR-048 remain intact, every PR touching the runner container image, `relay.mjs`, or Git interceptors MUST pass the following automated test suite (`tests/security/sandbox-regression.spec.ts`):

```typescript
describe('Sandbox & Relay Adversarial Regression Suite', () => {
  // 1. PATH bypass attempt
  it('T01: denies direct execution of /usr/bin/git.real commit with EROFS', async () => {
    const res = await execInSandbox('/usr/bin/git.real commit -m "bypass"');
    expect(res.exitCode).not.toBe(0);
    expect(res.stderr).toMatch(/Read-only file system|prohibited/);
  });

  // 2. Global flag obfuscation
  it('T02: denies flag-obfuscated git -c user.name=evil commit', async () => {
    const res = await execInSandbox('git -c user.name=evil commit -m "bypass"');
    expect(res.exitCode).toBe(128);
    expect(res.stderr).toContain('SECURITY_BLOCKED');
  });

  // 3. Stash commit block
  it('T03: denies git stash as a ref-updating commit operation', async () => {
    const res = await execInSandbox('git stash');
    expect(res.exitCode).toBe(128);
    expect(res.stderr).toContain('SECURITY_BLOCKED');
  });

  // 4. Safe staging via three-variable tmpfs
  it('T04: allows git add without EROFS by writing loose objects to tmpfs', async () => {
    await execInSandbox('echo "hello" > test.txt');
    const res = await execInSandbox('git add test.txt');
    expect(res.exitCode).toBe(0);
    const indexStat = await statInSandbox('/tmp/graywolf/git/index');
    expect(indexStat.size).toBeGreaterThan(0);
  });

  // 5. Composite patch capture
  it('T05: generates unified changes.patch covering both staged and unstaged edits via git diff HEAD', async () => {
    await execInSandbox('echo "staged" > staged.txt && git add staged.txt');
    await execInSandbox('echo "unstaged" > unstaged.txt');
    const patch = await execInSandbox('git diff HEAD');
    expect(patch.stdout).toContain('staged.txt');
    expect(patch.stdout).toContain('unstaged.txt');
  });

  // 6. Emergency budget flush
  it('T06: flushes emergency patch and checkpoint on budget_exceeded', async () => {
    const result = await simulateTaskBreach({ limitUsd: 0.10 });
    expect(result.status).toBe('budget_exceeded');
    expect(result.checkpointAvailable).toBe(true);
    expect(result.patchSaved).toBe(true);
  });

  // 7. Token-class IDOR defense on resumption
  it('T07: rejects /resume calls authenticated with RELAY_AUTH_TOKEN (HTTP 403)', async () => {
    const res = await request(app)
      .post('/api/v1/tasks/task-123/resume')
      .set('Authorization', `Bearer ${RELAY_AUTH_TOKEN}`)
      .send({ additionalSpendLimitUSD: 5.00 });
    expect(res.status).toBe(403);
  });

  // 8. Governor hard ceiling on resumes
  it('T08: rejects a 3rd consecutive task resume with maxResumesPerTask limit', async () => {
    await resumeTask('task-123', 1);
    await resumeTask('task-123', 2);
    const res = await resumeTask('task-123', 3);
    expect(res.status).toBe(429);
  });

  // 9. Polyglot route prefix concatenation
  it('T09: reconstructs canonical route from nested chi/gin route groups', async () => {
    const symbols = await parseFileSymbols('testdata/chi_routes.go');
    expect(symbols.routes).toContain('/api/v1/orgs/:id/members');
  });

  // 10. Container security posture verification
  it('T10: enforces no-new-privileges and drops all Linux capabilities', async () => {
    const inspect = await docker.getContainer('runner-test').inspect();
    expect(inspect.HostConfig.SecurityOpt).toContain('no-new-privileges:true');
    expect(inspect.HostConfig.CapDrop).toContain('ALL');
  });
});
```


<!-- END OF FILE: architecture/sandbox-and-testing.md -->

---


<!-- START OF FILE: architecture/sandbox-hardening-and-network-egress.md -->

# Source: architecture/sandbox-hardening-and-network-egress.md

# Graywolf Squad — Deep-Dive Architecture: Sandbox Container Hardening & Network Egress Allowlisting

## 1. Executive Summary & Attack Surface

An autonomous coding agent executing inside a Docker container runs shell commands (`run_command`), installs third-party packages (`npm install`, `pip install`), executes unit tests, and compiles binaries. 

Without rigorous OS-level container hardening, a compromised dependency (typosquatting, malicious postinstall script) or an over-eager agent could:
1. **Escape the Container**: Exploit kernel vulnerabilities or Docker daemon socket mounts to gain root access to the host machine.
2. **Exfiltrate Code or Credentials**: Open outbound sockets to arbitrary internet command-and-control (C2) servers.
3. **Lateral Movement**: Attack other containers, databases, or local host services on the internal bridge network.

Graywolf enforces **Three Pillars of Container Hardening**: Rootless execution, strict kernel attack-surface reduction (seccomp/AppArmor/no-new-privileges), and **Default-Deny Network Egress Allowlisting**.

---

## 2. Container Isolation & Privilege De-escalation

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│ Host Operating System (Linux Kernel 5.15+ / 6.x)                                      │
│                                                                                        │
│   ┌──────────────────────────────────────────────────────────────────────────────────┐ │
│   │ Ephemeral Runner Container (Docker / Podman)                                     │ │
│   │                                                                                  │ │
│   │ • User: non-root `graywolf` (UID 10001, GID 10001)                               │ │
│   │ • Capabilities: Dropped ALL (`--cap-drop=ALL`), added none                       │ │
│   │ • Security Opts: `no-new-privileges:true` (prevents setuid binary elevation)    │ │
│   │ • Read-Only Rootfs: `/` is mounted READ-ONLY (`--read-only`)                     │ │
│   │ • Ephemeral Tmpfs: `/tmp` and `/run` mounted tmpfs with `noexec,nosuid,nodev`    │ │
│   │ • Writable Mounts: ONLY `/workspace` (Git worktree) and package caches           │ │
│   │ • Seccomp Profile: Custom JSON blocking 40+ dangerous syscalls                   │ │
│   └──────────────────────────────────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

### 2.1 Syscall Filtering (Custom Seccomp Profile)
The runner runs under a strict seccomp profile blocking:
- Kernel module loading (`init_module`, `finit_module`, `delete_module`).
- Namespace manipulation (`clone` with `CLONE_NEWUSER` flags, `unshare`, `setns`).
- Obsolete or dangerous syscalls (`ptrace`, `sys_chroot`, `kexec_load`, `bpf`).

---

## 3. Network Egress Allowlisting (Default-Deny)

Containers do NOT have unrestricted access to the public internet. By default, every sandbox operates on an **Egress Allowlist Firewall** enforced via container-specific `iptables` / `nftables` chains:

```
[Agent Container] ────► [Packet Filter / Egress Proxy]
                                  │
      ┌───────────────────────────┼───────────────────────────┐
      ▼                           ▼                           ▼
[ALLOWED: Port 4000]       [ALLOWED: Git Remote]       [ALLOWED: Package Registries]
Internal LiteLLM Proxy     Declared in project.config  registry.npmjs.org (443)
(Model Prompts)            (github.com, gitlab.com)    pypi.org / files.pythonhosted (443)
      │                           │                           │
      └───────────────────────────┼───────────────────────────┘
                                  │
                                  ▼ (ALL OTHER EGRESS: 0.0.0.0/0)
                        ❌ REJECT & LOG ALERT
```

### 3.1 Default Egress Rule Matrix

| Destination | Port / Protocol | Rationale | Enforcement Mechanism |
| :--- | :--- | :--- | :--- |
| **LiteLLM Proxy** | `4000/TCP` (Internal) | Agent prompt and completion calls | Internal Docker network DNS alias |
| **Secrets Broker Socket** | `/var/run/secrets.sock` | Local Unix domain socket proxy | Mounted volume socket (no IP routing) |
| **Declared Git Remote** | `443/TCP` (e.g. `github.com`) | Fetching branches and pushing patch branches | IP / Hostname allowlist via forward proxy |
| **Package Registries** | `443/TCP` (npm, PyPI, Cargo) | Permitted package installations | Domain-level egress filter via local proxy |
| **Arbitrary Public IPs** | **ALL** | Prevent data exfiltration or malware downloads | **BLOCKED (Default Deny)** |

### 3.2 Testing Third-Party APIs (Test Exception)
If a task explicitly requires testing an external third-party API (e.g., calling Stripe Sandbox or Twilio Test API):
- The task brief must declare `networkAccess: ["api.stripe.com"]`.
- Dev-Level-1 Planner validates that the domain is a known test endpoint.
- Outbound traffic must pass through the **Secrets Broker Sidecar** (§13.2) to ensure secrets are injected out-of-band and never exposed in plaintext.


<!-- END OF FILE: architecture/sandbox-hardening-and-network-egress.md -->

---


<!-- START OF FILE: architecture/security-and-secrets.md -->

# Source: architecture/security-and-secrets.md

# Graywolf Squad — Deep-Dive Architecture: Security & Secret Management

## 1. Executive Summary & Problem Statement

Autonomous multi-agent platforms face unique security hazards that conventional CI/CD or developer tooling never encounters:
1. **Agent Context Leaks**: An agent troubleshooting a failed API call or debugging tests may casually execute `console.log(process.env)` or print HTTP headers, inadvertently committing secrets, API keys, or Git tokens to the agent's LLM context, terminal logs, or git patches.
2. **Database At-Rest Vulnerability**: Standard PostgreSQL installations in self-hosted `docker compose` environments frequently lack filesystem-level encryption, exposing raw credentials in database volume dumps (`pg_dump`) or disk backups.
3. **Friction vs. Security Trade-off**: Forcing developers to enter a master decryption password every time the application boots or spins up a container violates the fundamental **"< 1 second boot, zero-config"** principle defined in ADR-015.

Graywolf Squad implements a zero-trust, out-of-band secret architecture combining **zero-prompt column-level envelope encryption**, an **isolated secrets proxy / sidecar broker**, and **automated regex secret scrubbing**.

---

## 2. Zero-Prompt Column-Level Envelope Encryption

Instead of relying solely on full-disk encryption (which fails if a database dump is leaked) or prompting the user for a master passphrase on boot (which breaks unattended automation), Graywolf implements **Envelope Encryption** at the column level via `pgcrypto` (AES-256):

```
┌────────────────────────────────────────────────────────────────────────┐
│ PostgreSQL 16 (Relational & Secret Vault)                              │
│                                                                        │
│  TABLE: secret_vault                                                   │
│  ├── id: UUID                                                          │
│  ├── workspace_id: UUID (RLS Scoped)                                   │
│  ├── secret_name: VARCHAR ('GIT_PAT', 'STRIPE_TEST_KEY')               │
│  └── encrypted_value: BYTEA (AES-256 encrypted via DEK)                │
│  └── encrypted_dek: BYTEA (DEK encrypted via external KEK)             │
└───────────────────────────────────▲────────────────────────────────────┘
                                    │ Decrypts DEK using KEK
┌───────────────────────────────────┴────────────────────────────────────┐
│ Key Encryption Key (KEK) Storage (Kept OUTSIDE PostgreSQL)              │
│                                                                        │
│ • Local / Solo Mode:                                                   │
│   ~/.graywolf/master.key (chmod 600, generated silently on first boot) │
│                                                                        │
│ • Enterprise / Hybrid SaaS:                                            │
│   HashiCorp Vault / AWS KMS / GCP Cloud KMS plugin                     │
└────────────────────────────────────────────────────────────────────────┘
```

### 2.1 Benefits
- **Zero Friction**: On initial boot (`docker compose up`), the system creates `~/.graywolf/master.key` with strict filesystem permissions (`chmod 600`). Solo developers never see a password prompt.
- **Backup Safety**: A stolen `pg_dump` or PostgreSQL snapshot does NOT contain the KEK; encrypted secrets cannot be decrypted without physical access to the host's protected key file.
- **Enterprise Ready**: Seamlessly transitions to HashiCorp Vault or Cloud KMS for enterprise teams without altering the database schema.

---

## 3. Out-of-Band Sandbox Secrets Proxy (Zero Environment Exposure)

**The Core Rule**: Real secret values are **NEVER** injected as standard environment variables inside the agent's task sandbox. 

Instead, credentials are provided out-of-band through specialized proxies and local broker sockets:

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│ Task Container Sandbox (Ephemeral)                                                     │
│                                                                                        │
│  ┌─────────────────────────────────┐       ┌──────────────────────────────────────┐   │
│  │ Agent Process (Dev-Level-1/2/3) │       │ Secrets Broker Sidecar (Local Unix)  │   │
│  │                                 │       │                                      │   │
│  │ Calls:                          │       │ Socket: /var/run/secrets.sock        │   │
│  │ git clone / push                │──────►│ Authenticates via short-lived token  │   │
│  │ (via credential.helper)         │       │                                      │   │
│  │                                 │       │ Rewrites outgoing test requests      │   │
│  │ curl -H "X-Mock: stripe-test"   │──────►│ Injects real STRIPE_TEST_KEY         │   │
│  │                                 │       │ Strips secrets from error responses  │   │
│  └─────────────────────────────────┘       └──────────────────────────────────────┘   │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

### 3.1 Git Credentials (Git PATs)
- Git operations within the sandbox rely on Git's native `credential.helper`.
- When `git` requires credentials, it queries a local Unix socket managed by the orchestrator.
- The orchestrator provides an ephemeral, short-lived scoped token.
- The agent process never inspects or prints the raw token string.

### 3.2 Model Provider Keys (LiteLLM)
- Governed by ADR-005 (Technology Stack) and ADR-018 (Secrets Architecture). The agent process is configured with:
  ```bash
  OPENAI_BASE_URL=http://litellm-proxy:4000
  OPENAI_API_KEY=sk-graywolf-internal-proxy-token
  ```
- The actual Anthropic, OpenAI, or Gemini provider keys remain strictly within the control plane server and never enter the sandbox container.

### 3.3 Third-Party Test API Keys (Secrets Broker Sidecar)
- For tasks requiring integration testing against third-party sandboxes (e.g. Stripe, SendGrid, Twilio test environments), the task container routes outbound requests through a **Secrets Broker Sidecar** attached to the container network namespace.
- The agent uses placeholder credentials (`sk_test_placeholder_stripe`).
- The broker substitutes the real encrypted credential in-flight on the outbound request, and filters it out of returned headers or stack traces on responses.

---

## 4. Automated Regex Secret Scrubber (Defense-in-Depth)

Even with proxies, an agent or a build tool might output a secret found in a repository `.env.example` or test fixture.

To prevent leaks:
1. **Real-Time Stream Scrubbing**: All terminal stdout/stderr emitted by sandbox containers passes through a high-throughput streaming regex scrubber before being written to disk, sent to Xterm.js, or bundled into PR Review Packets.
2. **Detection Signatures**:
   - High-entropy strings matching common API key patterns (GitHub PATs, AWS Access Keys, OpenAI keys, Slack webhooks, Private Keys).
   - Any secret string currently registered in the project's `secret_vault`.
3. **Replacement**: Detected matches are replaced with `[REDACTED_SECRET_BY_GRAYWOLF]`.


<!-- END OF FILE: architecture/security-and-secrets.md -->

---


<!-- START OF FILE: architecture/session-token-and-cockpit-rbac.md -->

# Source: architecture/session-token-and-cockpit-rbac.md

# Graywolf Squad — Deep-Dive Architecture: Session, Identity & Cockpit RBAC

## 1. Executive Summary & Core Security Posture

Graywolf Squad operates as an autonomous multi-agent platform where humans interact via a graphical dashboard and a natural-language **Chat Cockpit** possessing tool-calling authority over the orchestration engine. 

Securing this system introduces two unique challenges:
1. **Dynamic Human Authority**: If an Owner demotes a Developer or revokes their workspace membership mid-session, all subsequent actions—including tool calls executed via the Chat Cockpit on that user's behalf—must be revoked **immediately**, without waiting for stateless tokens to expire.
2. **Untrusted Agent Code Isolation**: Sandboxed runner containers execute arbitrary code generated by LLMs and install third-party dependencies (`npm`, `pip`). Containers must be structurally barred from calling back into the Graywolf Control Plane REST/GraphQL management APIs.

To satisfy these requirements at **$0 platform cost**, Graywolf implements **ADR-039**:
- **Better-Auth (MIT)** for authentication and identity management.
- **Valkey (BSD-3-Clause)** for stateful, sub-millisecond session validation and instant revocation.
- **PostgreSQL 16 Row-Level Security (RLS)** context injection on every request.
- **Cryptographic Team Invites** via salted SHA-256 tokens.
- **Server-Authoritative RBAC Gateway** intercepting all Chat Cockpit tool calls.
- **Absolute Sandbox Isolation Invariant**: Sandboxes communicate exclusively via typed WebSocket frames under the Agent Relay Protocol (ARP), with server-enforced tenancy and IDOR protection.

---

## 2. Identity & Session Architecture

```
                    ┌────────────────────────────────────────┐
                    │ Browser Client / assistant-ui Cockpit  │
                    └───────────────────┬────────────────────┘
                                        │
                         Cookie: __session=<opaque_token>
                                        │
                                        ▼
               ┌──────────────────────────────────────────────────┐
               │ Fastify API Gateway Authentication Pre-Handler   │
               └────────────────────────┬─────────────────────────┘
                                        │
                        1. Query Session (Sub-1ms)
                                        │
                                        ▼
                           ┌────────────────────────┐
                           │ Valkey Session Cache   │
                           │ Key: session:<token>   │
                           └────────────┬───────────┘
                                        │
                                        ▼ Hit
                 ┌──────────────────────────────────────────────┐
                 │ Context: { userId, workspaceId, role }       │
                 └──────────────────────┬───────────────────────┘
                                        │
                        2. Inject DB RLS Context
                                        │
                                        ▼
                 ┌──────────────────────────────────────────────┐
                 │ PostgreSQL 16 (RLS Session)                  │
                 │ SET LOCAL app.current_workspace_id = '...'   │
                 └──────────────────────────────────────────────┘
```

### 2.1 Session Storage & Valkey Caching

Sessions are stateful and managed via **Better-Auth**:
- **Client Storage**: An opaque, cryptographically random session token (32 bytes, base64url-encoded) stored in an `HttpOnly`, `Secure`, `SameSite=Lax` cookie (`__session`).
- **Database Persistence**: Backed by the `sessions` table in PostgreSQL:
  ```sql
  CREATE TABLE sessions (
      id VARCHAR(128) PRIMARY KEY,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      token_hash VARCHAR(64) NOT NULL UNIQUE,
      expires_at TIMESTAMPTZ NOT NULL,
      ip_address VARCHAR(45),
      user_agent TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  ```
- **Valkey Fast Path**: To avoid hitting PostgreSQL on every single API request, active sessions are cached in Valkey under the key `session:{token_hash}` with a TTL matching session expiration (default: 7 days, sliding window):
  ```json
  {
    "userId": "u_987654321",
    "workspaceId": "ws_123456789",
    "orgId": "org_555555555",
    "role": "developer",
    "status": "active"
  }
  ```

### 2.2 Instant Revocation Mechanism
Unlike stateless JWTs, stateful Valkey sessions enable **instantaneous revocation**:
1. When an Owner removes a member from a workspace or changes their role in the UI:
   ```typescript
   // On member demotion or ejection:
   await db.update(workspaceMembers).set({ role: newRole }).where(eq(workspaceMembers.userId, userId));
   
   // Invalidate all active session keys in Valkey immediately:
   const userSessionKeys = await valkey.keys(`session:user:${userId}:*`);
   if (userSessionKeys.length > 0) {
     await valkey.del(...userSessionKeys);
   }
   ```
2. The next API request or Chat Cockpit tool call made by that client encounters a cache miss, re-evaluates against the database, detects the role change or ejection, and rejects the action immediately.

---

## 3. Cryptographic Team Invite Protocol

Transitioning an organization from local solo mode to team collaboration requires zero `.env` file modifications or server restarts.

### 3.1 Data Schema

```sql
CREATE TABLE workspace_invites (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    invited_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash VARCHAR(64) NOT NULL UNIQUE, -- SHA-256(raw_invite_token)
    target_role VARCHAR(32) NOT NULL DEFAULT 'developer', -- 'developer' | 'viewer'
    max_uses INT NOT NULL DEFAULT 1,
    uses_count INT NOT NULL DEFAULT 0,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_workspace_invites_hash ON workspace_invites(token_hash);
```

### 3.2 Invite Lifecycle Flow

```
[Owner/Admin]                                             [Invitee]
      │                                                       │
      ├─ 1. POST /api/v1/workspaces/:id/invites               │
      │     (targetRole: 'developer', maxUses: 5)             │
      │                                                       │
      ▼                                                       │
[Fastify Server]                                              │
      │ 2. Generate rawToken = crypto.randomBytes(32)         │
      │ 3. Compute hash = SHA-256(rawToken)                   │
      │ 4. INSERT INTO workspace_invites (hash, role, ...)    │
      │ 5. Return link: /invite/join?token={rawToken}         │
      │                                                       │
      ▼                                                       │
[Owner delivers link to invitee]                              │
      ───────────────────────────────────────────────────────►│
                                                              ├─ 6. GET /invite/join?token={rawToken}
                                                              │
                                                              ▼
                                                        [Fastify Server]
                                                              │ 7. Compute hash = SHA-256(rawToken)
                                                              │ 8. SELECT * FROM workspace_invites WHERE hash = $1
                                                              │    AND expires_at > NOW() AND uses_count < max_uses;
                                                              │ 9. If not logged in: redirect to auth with return_url
                                                              │ 10. INSERT INTO workspace_members (user, ws, role)
                                                              │ 11. UPDATE workspace_invites SET uses_count = uses_count + 1
                                                              │ 12. Create session & redirect to /workspace/:id
                                                              ▼
                                                        [Joined Workspace]
```

---

## 4. Chat Cockpit RBAC & Tool-Calling Authority

The conversational Chat Cockpit (built with `assistant-ui`) allows developers and managers to interact with the platform using natural language. The underlying LLM emits function calls (`tool_call`).

> [!IMPORTANT]
> **Zero Model Trust**: The AI model has no intrinsic authorization authority. It does not decide if an operation is permissible. All authorization is enforced **server-authoritatively** by Fastify prior to dispatching any tool execution.

### 4.1 Tool-Calling RBAC Matrix

| Tool Name | Operation Description | Minimum Role Required | Behavior on Violation |
| :--- | :--- | :---: | :--- |
| `query_task_status` | Read task board state, progress, and metrics | `viewer` | Permitted for all workspace members |
| `read_task_logs` | Stream historical logs or active Xterm output | `viewer` | Permitted for all workspace members |
| `create_task` | Create new backlog task with initial brief | `developer` | Synthetic `403 Forbidden` tool output |
| `reorder_backlog` | Modify DAG dependencies or task queue priority | `developer` | Synthetic `403 Forbidden` tool output |
| `answer_clarification` | Submit answers to unblock `AWAITING_CLARIFICATION` | `developer` | Synthetic `403 Forbidden` tool output |
| `pause_task` | Pause execution in runner container | `developer` | Synthetic `403 Forbidden` tool output |
| `cancel_task` | Terminate runner container and mark task CANCELLED | `lead_dev` | Synthetic `403 Forbidden` tool output |
| `approve_pr_merge` | Approve gate and trigger VCS pull request merge | `lead_dev` | Synthetic `403 Forbidden` tool output |
| `modify_blast_radius` | Change Writable/Read-Only/Forbidden globs | `lead_dev` | Synthetic `403 Forbidden` tool output |
| `manage_project_keys` | Update LLM provider keys or LiteLLM budget caps | `owner` | Synthetic `403 Forbidden` tool output |

### 4.2 Gateway Interceptor Implementation Pattern

When the Fastify `/api/v1/chat/turn` endpoint processes a tool call generated by the chat agent:

```typescript
export async function handleCockpitToolCall(
  toolCall: { name: string; args: Record<string, unknown> },
  sessionContext: { userId: string; workspaceId: string; role: WorkspaceRole }
): Promise<{ success: boolean; result?: unknown; error?: string }> {
  
  const requiredRole = TOOL_ROLE_REQUIREMENTS[toolCall.name];
  
  if (!requiredRole || !hasSufficientPrivilege(sessionContext.role, requiredRole)) {
    // Return synthetic error frame to model without executing the action
    return {
      success: false,
      error: `PERMISSION_DENIED: Role '${sessionContext.role}' is not authorized to execute tool '${toolCall.name}'. Requires '${requiredRole}'. Explain this constraint politely to the user.`
    };
  }

  // Permitted — execute tool with user context
  return await orchestratorDispatcher.execute(toolCall.name, toolCall.args, sessionContext);
}
```

---

## 5. WebSocket Telemetry Security (Ticket-Granting Token)

The web dashboard consumes live streaming stdout/stderr, Xterm.js terminal feeds, and React Flow DAG state updates via persistent WebSockets.

Browsers cannot attach custom authorization headers (e.g. `Authorization: Bearer ...`) during the standard WebSocket handshake (`new WebSocket(...)`). Passing long-lived session cookies in query parameters exposes session tokens in server access logs and browser histories.

### 5.1 Ticket-Granting Token (TGT) Protocol

```
[Browser]                                               [Fastify Server]             [Valkey]
   │                                                           │                        │
   ├─ 1. POST /api/v1/telemetry/ws-ticket ────────────────────►│                        │
   │     (Cookie: __session)                                   │                        │
   │                                                           ├─ 2. Validate Session ──►
   │                                                           │     Generate tgtUUID   │
   │                                                           ├─ 3. SETEX tgt:{uuid} 5s 
   │                                                           │     { userId, role, ws }
   │◄─ 4. Return { ticket: tgtUUID, ttlSeconds: 5 } ───────────┤                        │
   │                                                           │                        │
   ├─ 5. Connect: wss://host/stream?ticket=tgtUUID ───────────►│                        │
   │                                                           ├─ 6. GETDEL tgt:{uuid} ─►
   │                                                           │     (Atomic Consume)   │
   │                                                           │                        │
   │◄─ 7. Connection Accepted (Duplex Stream Established) ─────┤                        │
```

- **Tight TTL with Server-Side Grace Window**: The ticket has a client validity window of **10 seconds** with a **5-second server-side clock-skew / network latency grace window** (15 seconds total absolute cutoff from server mint timestamp). If not consumed within 15 seconds, it is automatically purged.
- **Single-Use (`GETDEL`)**: The ticket is atomically read and deleted from Valkey on first connection, preventing replay attacks.
- **Task Scoping**: If streaming container logs for `TASK-101`, the ticket payload explicitly verifies the user has access to that specific task's workspace before upgrading the socket.

---

## 6. Physical Sandbox Network Isolation & IDOR Protection

Runner containers execute untrusted code in Docker sandboxes. Under **ADR-039** and **ADR-040**, the sandbox isolation boundary is enforced at both the network layer and protocol layer:

### 6.1 Network & Credential Isolation Invariants

1. **Physical Port & Network Separation**:
   - The Orchestrator Fastify process binds **two distinct network interfaces and ports**:
     - **Port 3000 (Control Plane REST/GraphQL & Admin API)**: Attached strictly to `control-net` and `edge-net`.
     - **Port 3001 (Agent Relay Protocol WebSocket)**: Attached strictly to `runner-net`.
   - The runner container attached to `runner-net` can **only route packets to `orchestrator:3001`**. Port 3000, PostgreSQL (5432), Valkey (6379), LiteLLM (4000), and Docker Socket Proxy (2375) are unreachable at the Docker bridge routing layer.
2. **Zero Control Plane Bearer Tokens**: Sandboxes receive **zero** HTTP bearer tokens, session tokens, or platform API credentials.
3. **Task-Bound Container Token**: The container connects to ARP over Port 3001 using a single-use, task-scoped `containerToken`:
   - **Single-Connection Bound**: Cannot be replayed from another socket or another IP.
   - **Revoked on Teardown**: Immediately invalidated upon task exit or container stop.
   - **Minimal Blast Radius**: If printed to stdout via accidental `console.log(process.env)`, the token only permits sending ARP frames for that specific task ID. It grants zero access to any other task, database, or project.


### 6.2 Tenancy Resolution & IDOR Guard on `e2c:query_context`

When an agent needs to retrieve context (such as symbol definitions, architectural rules, or past lessons) via ARP:

```
[relay.mjs inside Container]                           [Control Plane Orchestrator]
             │                                                        │
             ├─ e2c:query_context ───────────────────────────────────►│
             │  { query: "TaxCalculator interface" }                  │
             │                                                        │
             │  ⚠️ UNTRUSTED PAYLOAD ⚠️                                │
             │  (Container CANNOT supply workspaceId or projectId)     │
             │                                                        │
             │                                                        ├─ 1. Authenticate containerToken
             │                                                        ├─ 2. Resolve Task from Database
             │                                                        │     taskId = token.taskId
             │                                                        │     workspaceId = task.workspaceId
             │                                                        │     projectId = task.projectId
             │                                                        │
             │                                                        ├─ 3. Query Repo Map / Code Symbols
             │                                                        │     WHERE workspace_id = task.workspaceId
             │                                                        │     AND project_id = task.projectId
             │                                                        │
             │◄─ c2e:context_chunk ───────────────────────────────────┤
             │   { symbols: [...] }                                   │
```

> [!CAUTION]
> **Strict IDOR Guard**: The orchestrator **strictly resolves tenancy server-side from the task record bound to `containerToken` at mint time**. Even if a malicious prompt injection inside the container forces `relay.mjs` to transmit `{ workspace_id: "victim-corp-workspace" }`, the orchestrator **completely ignores** payload-supplied tenant IDs, preventing Insecure Direct Object Reference (IDOR) attacks across workspaces.

---

## 7. Open-Source Component Selection ($0 Cost)

| Responsibility | Selected Technology | License | Justification |
| :--- | :--- | :--- | :--- |
| Authentication & Identity Engine | **Better-Auth** | MIT | TypeScript-native, built-in multi-tenant/organization support, stateful sessions, zero external SaaS dependencies. |
| Session & Rate Limiting Cache | **Valkey 7.2+** | BSD-3-Clause | 100% open-source, high-performance in-memory cache for instant session validation and token revocation. |
| Multi-Tenant Authorization | **Casbin (Node-Casbin)** | Apache-2.0 | Battle-tested, lightweight ACL/RBAC policy engine evaluated at the API route and tool-call boundary. |
| Database RLS Enforcement | **Native PostgreSQL 16 RLS** | PostgreSQL License | Hardware-level database tenancy guarantees via `SET LOCAL app.current_workspace_id`. |
| Cryptography | **Node.js Native `crypto`** | MIT (Node.js) | Native `crypto.randomBytes` and `crypto.createHash('sha256')` for zero-dependency invite links. |
| Docker Daemon Isolation | **tecnativa/docker-socket-proxy** | MIT / HAProxy | Scoped Docker daemon proxy eliminating raw socket exposure to the orchestrator container. |



<!-- END OF FILE: architecture/session-token-and-cockpit-rbac.md -->

---


<!-- START OF FILE: architecture/virtual-developer-tiers.md -->

# Source: architecture/virtual-developer-tiers.md

# Graywolf Squad — Deep-Dive Architecture: Virtual Developer Tiers & Cognitive Handoff

## 1. Executive Summary & Problem Statement

Autonomous multi-agent platforms that execute code typically suffer from two architectural extremes:
1. **The Heavy Multi-Container Antipattern**: Spawning separate Docker containers for each persona (one container for the architect, one for the developer, one for the QA engineer). This introduces massive host RAM overhead, network latency, volume-locking deadlocks, and slow task execution loops.
2. **The Monolithic Prompt Trap**: Asking a single generic LLM to plan, write, test, and critique its own code in one continuous conversation. Models exhibit strong self-confirmation bias—they rarely catch their own subtle syntax mistakes, logical regressions, or architectural boundary escapes.

Graywolf Squad solves this through **Cognitive Virtual Developer Tiering inside a Single Ephemeral Container**. Rather than moving containers around, the task execution container runs a sequential, typed handoff between specialized virtual developer personas, each paired with an optimal model caliber.

---

## 2. Tier Definitions & Model Caliber Routing

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│ Task Container (Single Ephemeral Docker Sandbox)                                       │
│                                                                                        │
│  ┌──────────────────────────────────────────────────────────────────────────────────┐  │
│  │ Dev-Level-1: Lead Architect / Planner                                            │  │
│  │ • Caliber: Frontier Reasoning (Claude 3.5 Sonnet, Gemini 1.5 Pro, Qwen-2.5-72B)   │  │
│  │ • Input: Task brief, Topological Repo Map, Constitution, Past Lessons            │  │
│  │ • Emits: plan.md, designated implementer/reviewer tiers, requiredDbTier          │  │
│  └──────────────────────────────────────────┬───────────────────────────────────────┘  │
│                                             │ handoff.json (Phase 1 -> Phase 2)        │
│                                             ▼                                          │
│  ┌──────────────────────────────────────────────────────────────────────────────────┐  │
│  │ Dev-Level-3: Senior Software Engineer / Implementer                              │  │
│  │ • Caliber: Fast, High-Throughput Code Synthesis (DeepSeek-V3, Haiku, Qwen-Coder) │  │
│  │ • Input: plan.md, surgical file slices, symbol definitions                       │  │
│  │ • Emits: edits, unit tests, candidate patch diff                                 │  │
│  └──────────────────────────────────────────┬───────────────────────────────────────┘  │
│                                             │ handoff.json (Phase 2 -> Phase 3)        │
│                                             ▼                                          │
│  ┌──────────────────────────────────────────────────────────────────────────────────┐  │
│  │ Dev-Level-2: Rigorous Code Reviewer / Quality Gate                               │  │
│  │ • Caliber: High-Precision Analytical (Claude 3.5 Sonnet, GPT-4o, DeepSeek-V3)    │  │
│  │ • Input: plan.md, git patch diff, test execution suite                          │  │
│  │ • Executes: Unit tests, Playwright E2E suites, AST lint checks                   │  │
│  │ • Emits: review-signoff.md OR rejection notes (max 2 strikes)                    │  │
│  └──────────────────────────────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Cognitive Handoff Protocol (`handoff.json`)

To prevent context bloat and token-spend explosion, personas **do not pass raw conversational history** to each other. Instead, each persona transition is mediated by a typed, compact `handoff.json` contract managed by the in-container harness (`relay.mjs`).

### 3.1 Handoff Contract Schema

```typescript
export interface CognitiveHandoff {
  version: "graywolf.handoff.v1";
  taskId: string;
  timestamp: string;
  fromTier: "dev-level-1" | "dev-level-2" | "dev-level-3";
  toTier: "dev-level-1" | "dev-level-2" | "dev-level-3" | "orchestrator";
  phase: "planning" | "implementation" | "review" | "revision";
  artifacts: {
    briefPath: string;           // .agents/tasks/<id>/brief.md
    planPath: string;            // .agents/tasks/<id>/plan.md
    patchPath?: string;          // .agents/tasks/<id>/candidate.patch
    signoffPath?: string;        // .agents/tasks/<id>/review-signoff.md
  };
  iterationContext: {
    strikeCount: number;         // 0, 1, or 2 (escalates at 2)
    rejectionReason?: "test_failure" | "boundary_violation" | "plan_deviation" | "syntax_error";
    reviewerNotes?: string;      // Targeted delta feedback from Dev-Level-2
    failedTestOutput?: string;   // Extracted failure message (last 50 lines)
  };
}
```

---

## 4. The Two-Strike Rejection & Revision Loop

When Dev-Level-2 (Reviewer) rejects an implementation, it does not restart the task from scratch or re-run the Planner. It initiates a targeted revision pass:

```
                  ┌──────────────────────────────────────────────┐
                  │ Dev-Level-3 (Implementer) writes code        │
                  └──────────────────────┬───────────────────────┘
                                         │ Emits candidate.patch
                                         ▼
                  ┌──────────────────────────────────────────────┐
                  │ Dev-Level-2 (Reviewer) runs test suite       │
                  └──────────────────────┬───────────────────────┘
                                         │
                        Tests Fail / Deviates from Plan
                                         │
                                         ▼
                             Strike Count Check (< 2?)
                            /                         \
                     YES (Strike 1)              NO (Strike 2)
                           /                             \
                          ▼                               ▼
      ┌──────────────────────────────────────┐  ┌───────────────────────────────────┐
      │ Construct Revision handoff.json      │  │ Task State:                       │
      │ • strikeCount: 1                     │  │ INTERNAL_REVIEW_FAILED            │
      │ • reviewerNotes: targeted fix        │  │ • Halt execution immediately      │
      │ • failedTestOutput: sanitized errors │  │ • Save worktree snapshot          │
      └──────────────────┬───────────────────┘  │ • Alert Human via Cockpit & Kanban│
                         │                      └───────────────────────────────────┘
                         ▼
      ┌──────────────────────────────────────┐
      │ Dev-Level-3 receives revision packet │
      │ Reads ONLY: plan.md + reviewerNotes  │
      │ Applies surgical fix & re-submits    │
      └──────────────────────────────────────┘
```

### 4.1 Why Token Replay Is Banned
In naive agent loops, retrying an implementation passes the entire previous conversational turn history back into the LLM. By turn 4, the input prompt reaches 80,000+ tokens, costing $0.50–$1.50 per attempt and causing the model to get confused by its own past discarded code.

Under Graywolf's protocol:
- Dev-Level-3 on Strike 1 receives **only**:
  1. The original `plan.md`.
  2. The current `candidate.patch`.
  3. The `reviewerNotes` and the exact failed test output slice.
- Working context remains locked at **~12,000–18,000 tokens**, keeping revision costs negligible and focus pin-sharp.

---

## 5. Specialist Personas (Extension Tiers)

Beyond the core triad (Dev-Level-1, Dev-Level-3, Dev-Level-2), the planner can designate specialized personas for high-risk domains:

| Tier | Role | Trigger / Tag | Specialized Capabilities |
| :--- | :--- | :--- | :--- |
| **Dev-Level-4: QA Specialist** | Automated testing scenarios | `qa-intensive` | Adversarial Playwright, accessibility audits, visual regression diffs |
| **Dev-Level-5: Security Auditor** | Security & Secret Scan | `security`, `auth`, `crypto` | AST taint analysis, secret detection, CVE remediation |
| **Dev-Level-6: DB Architect** | Database Migration Specialist | `db-migration`, `schema-change` | Backward compatibility checks, non-blocking DDL indices, rollback script authoring |
| **Dev-Level-7: Performance Engineer** | Profiler & Optimizer | `performance`, `heavy-query` | EXPLAIN ANALYZE interpretation, memory leak profiling, benchmark assertions |

---

## 6. Execution Lifecycle Paths

1. **Standard Feature Path**:
   `Dev-Level-1 (Plan)` $\rightarrow$ `Dev-Level-3 (Implement)` $\rightarrow$ `Dev-Level-2 (Review)` $\rightarrow$ Quality Guards $\rightarrow$ PR Review Gate.
2. **Fast Bugfix Path (`skipPlanning: true`)**:
   Tasks tagged `simplebugs` or `css-fix` bypass Dev-Level-1 entirely. `Dev-Level-3` directly inspects the error trace and generates a fix, verified by `Dev-Level-2`.
3. **Mandatory Human Plan Gate (`requireHumanPlanApproval: true`)**:
   For database schema migrations or core architectural shifts, execution pauses after Dev-Level-1 generates `plan.md`. The plan is presented in the Chat Cockpit for human sign-off before any code is written.


<!-- END OF FILE: architecture/virtual-developer-tiers.md -->

---


<!-- START OF FILE: decisions.md -->

# Source: decisions.md

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




<!-- END OF FILE: decisions.md -->

---
