# AGENTS.md — Graywolf Squad Project Instructions & Rules

## Project Operating Mode: Discovery & Architecture Phase

**CRITICAL DIRECTIVE FOR ALL AGENTS AND CHAT SESSIONS:**

1. **DO NOT RUSH INTO IMPLEMENTATION OR TASK EXECUTION:**
   - We are in the **PRD & Architecture Discovery Phase**.
   - Do NOT run `/speckit-implement`, do NOT execute code synthesis, and do NOT create micro-task execution branches unless the user EXPLICITLY commands to begin implementation on a matured domain.

2. **SOURCE OF TRUTH DOCUMENTS:**
   - **`docs/PRD.md`**: The living, growing master Product Requirements Document organized by domain. All discussions, requirement clarifications, workflow designs, and feature ideas MUST be consolidated here.
   - **`docs/decisions.md`**: Architecture Decision Records (ADRs) capturing *why* choices were made, alternatives considered, and consequences.
   - **`.specify/memory/constitution.md`**: Core non-negotiable architectural principles, technology stack standards, and governance rules.
   - **`specs/001-multi-agent-platform/data-model.md`**: Canonical data schemas (PostgreSQL, YAML frontmatter, JSON contracts, state machine).

3. **SPEC KIT & FEATURE EXTRACTION WORKFLOW:**
   - When the user decides a domain in `docs/PRD.md` is complete and ready to be built, extract a focused slice into an independent feature spec in `specs/` (e.g. `specs/001-platform-foundation/spec.md`).
   - Only then do we proceed with feature-level planning, task generation, and isolated execution.

4. **SPEC KIT PROGRESS TRACKING (MANDATORY — AUTO READ & AUTO UPDATE):**
   - **`temp/tools/speckit-progress.md`** is the authoritative Spec Kit progress tracker for the phased plan in `docs/implementation-plan-detailed.md`.
   - **On every session start** working on platform phases: READ `temp/tools/speckit-progress.md` first.
   - **When the user asks "what is the next step?" / "continue" / "where are we?"**: follow the Reply Protocol in that file §3 — find the first unchecked checkbox in the Phase Progress Board, and answer using its exact compact output format.
   - **After completing ANY workflow step** (specify / clarify / plan / tasks / analyze / human approval / implement / converge): follow the Update Protocol in that file §4 IMMEDIATELY in the same session — tick the checkbox, set the phase's Final Phase Status, and append one line to the Progress Log. Never defer updates to a later session.
   - **Step 7 Human Gate**: `/speckit-implement` is forbidden for a phase until the human explicitly approves that phase's `spec.md` / `plan.md` / `tasks.md`. This is an extension of rule 1 above.

5. **KEY ARCHITECTURAL PILLARS TO RESPECT IN ALL CONVERSATIONS:**
   - **Dual Modes**: Greenfield (autonomous software house) vs. Brownfield (embedded squad with strict blast-radius: Writable, Read-Only, Forbidden scopes).
   - **Virtual Developer Tiers**: Dev-Level-1 (Planner / Frontier model) ➔ Dev-Level-3 (Implementer / Fast code model) ➔ Dev-Level-2 (Reviewer / Analytical model) inside a *single* ephemeral container. Two-strike failure escalation rule.
   - **Chat as Active Cockpit**: Natural language chat has tool-calling authority over tasks, scheduling, dependencies (`blockedBy`), and container execution.
   - **Non-Committing Relay Contract**: Agents NEVER commit to Git upstream directly. All work ends in a verified patch diff and test report.
   - **Stack Baseline**: Fastify (TS), PostgreSQL 16 + `pgvector`, Valkey + BullMQ, LiteLLM Proxy, React + Vite + Tailwind + Shadcn + React Flow.
   - **Track C: Attention & Operational Mastery (Phases 20–23)**:
     - **P20 (`specs/021-attention-firewall`)**: Attention Firewall, 0-token deterministic gate, bounded Assessor (Gate 5), Observe mode ("Needs You" triage), SHA-256 versioned policy, immutable task mandates, and live `policyEffects()`.
     - **P21 (`specs/022-capacity-and-threads`)**: Concurrency management, `maxWorkers + 1` reserved human interactive slot, durable thread subscriptions (`owner` vs `context`), pass-through PR comment routing, and worker `handback()` tool.
     - **P22 (`specs/023-relay-ergonomics`)**: 5-second auto-backgrounding shell state machine in `relay.mjs`, and Spill-at-Write context recall pointers (`recall_<uuid>.log`) preserving ADR-061 prompt cache prefix immutability.
     - **P23 (`specs/024-semantic-watchdog`)**: Out-of-band BullMQ progress watchdog detecting semantic deadlocks / non-decreasing test failures with ARP `watchdog.nudge` or level-1 escalation.

<!-- SPECKIT START -->
For additional context about technologies to be used, project structure,
shell commands, and other important information, read the current plan at `specs/021-attention-firewall/plan.md`
<!-- SPECKIT END -->
