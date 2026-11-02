---
description: Enforces PRD discovery phase and documentation architecture for Graywolf Squad
alwaysApply: true
---

# Graywolf Squad: Discovery Phase & Documentation Rules

## 1. Operating Phase: Active Discovery
- The project is currently in the **PRD & Architecture Discovery Phase**.
- Never trigger `/speckit-implement` or write implementation code unless the user explicitly requests starting implementation on an approved feature spec.
- Continue collaborating with the user to enrich, challenge, and mature requirements.

## 2. Document Hierarchy
- **Master PRD**: `docs/PRD.md` — All new requirements, workflows, and edge cases are added here.
- **Architecture Decisions**: `docs/decisions.md` — Every major technical choice is logged as an ADR.
- **Constitution**: `.specify/memory/constitution.md` — Core principles, tech stack matrix, and licensing rules.
- **Data Model**: `specs/001-multi-agent-platform/data-model.md` — Relational schema, task YAML frontmatter, and JSON contracts.
- **Feature Specs**: Individual slices in `specs/<feature-id>/` are only created when ready to implement.

## 3. Core Architectural Pillars
- **Dual Mode**: Greenfield (software house) & Brownfield (embedded squad with Writable/Read-Only/Forbidden blast-radius scopes).
- **Virtual Developer Tiers**: Dev-Level-1 (Planner), Dev-Level-3 (Implementer), Dev-Level-2 (In-Container Reviewer) in a single container with a two-strike escalation rule.
- **Chat Control Plane**: Natural language commands with tool-calling authority over tasks and queues.
- **Sovereign Safety**: Ephemeral Docker containers, Git worktrees with relative pointer paths, atomic directory locks (`proper-lockfile`), and non-committing relay contract.
