# Implementation Plan: Software Factory & Pluggable `@graywolf/addon-sdk`

**Branch**: `002-addon-sdk` | **Date**: 2026-11-01 | **Spec**: [spec.md](file:///home/tarikelmallah/Projects/GraywolfSquad/specs/002-addon-sdk/spec.md)  
**Input**: Feature specification from `/specs/002-addon-sdk/spec.md` & canonical stubs from `/specs/002-addon-sdk/addon-interfaces.ts`

## Summary

Productionize the Pluggable Addon SDK (`@graywolf/addon-sdk`, ADR-080, PRD §17) across 3 core subsystems:
1. **Task 15.1 (`src/orchestrator/addons/sdk.ts`, `src/orchestrator/addons/sanitization.ts`)**: Capability-scoped `GraywolfRelayContext` isolating `SignalAddon` vs `CockpitAddon` methods and `meta.requiredSecrets`, Valkey signal deduplication (`signal:{workspaceId}:{fingerprintHash}`, 180s cooldown, ADR-044), and `<untrusted_signal_payload>` XML prompt-injection sanitization (ADR-025/038).
2. **Task 15.2 (`src/orchestrator/addons/registry.ts`, `src/orchestrator/addons/shadow-lifecycle.ts`, `src/orchestrator/addons/identity-binding.ts`)**: Two-Tier Addon Registry enforcing Topology A slot caps (`3 Signal + 1 Cockpit` $\rightarrow$ `ADDON_SLOT_LIMIT_EXCEEDED` 429) and Tier 2 SHA-256 `contentHash` fail-closed lock (`ADDON_HASH_MISMATCH` 403), Shadow Mode graduation lifecycle (`shadow -> graduated -> deprecated`), and External Identity Binding (`workspace_member_identities` $\rightarrow$ `ADDON_UNLINKED_EXTERNAL_USER` 403).
3. **Task 15.3 (`src/orchestrator/addons/builtin/sentry-signal.ts`, `src/orchestrator/addons/builtin/github-issues-signal.ts`, `src/orchestrator/addons/builtin/discord-cockpit.ts`)**: Three official Tier 1 reference Fastify plugins using TypeBox validation and constant-time HMAC-SHA256 verification via `relay.readSecret()` with zero `@sentry/node` imports and zero `setInterval`/`setTimeout` calls.

## Technical Context

**Language/Version**: TypeScript 5.x (Node.js 20+)  
**Primary Dependencies**: Fastify 5.x, `@sinclair/typebox`, `node:crypto`, PostgreSQL (`pg` via `withTenantContext`), Valkey (`ioredis` / injectable Valkey interface)  
**Storage**: PostgreSQL 16 (`workspace_member_identities`, `secret_vault`) + Valkey (`signal:{workspaceId}:{fingerprintHash}`)  
**Testing**: Vitest (`tests/unit/addon-sdk.test.ts`, `tests/unit/addon-registry-shadow-identity.test.ts`, `tests/integration/addons-builtin.test.ts`)  
**Target Platform**: Linux server (Orchestrator Control Plane)  
**Project Type**: Backend Fastify plugin boundary & SDK modules  
**Performance Goals**: `< 5ms` HMAC + TypeBox validation + Valkey deduplication check per webhook; 0 duplicate Kanban cards during 180s crash storms  
**Constraints**: Zero `@sentry/node` SDK imports; zero `setInterval` / `setTimeout` timers inside addons; closed 41-code ADR-042 `ERROR_CODES` preserved  
**Scale/Scope**: 8 source files under `src/orchestrator/addons/` + 3 test suites (`2` unit + `1` integration)

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design.*

1. **Human Sovereignty & Non-Committing Relay Contract**: **PASS** — Addons cannot execute shell commands, access git worktrees, or invoke `relay.mjs`; Shadow Mode requires `>= 20` runs (`< 10%` discard rate) and explicit `lead_dev`/`owner` promotion before creating Kanban tasks, and Kanban tasks still require human or policy gates before execution.
2. **Zero Runtime Lock-In & Permissive Licensing First**: **PASS** — Built using standard Fastify plugins, TypeBox, and Node `node:crypto` without proprietary SDK dependencies.
3. **Single ACID Relational & Vector Baseline**: **PASS** — External identity bindings use PostgreSQL `workspace_member_identities` with `withTenantContext` RLS isolation.
4. **Headless Execution & Observability**: **PASS** — Every addon receives a scoped structured logger (`relay.log`) and Shadow Mode maintains an append-only audit log of deliveries and operator feedback.
5. **Dual Operational Mode (Greenfield & Brownfield)**: **PASS** — Untrusted external signals are wrapped in `<untrusted_signal_payload>` XML tags before entering Brownfield/Greenfield planning prompts.
6. **Virtual Developer Tier Handoff Protocol**: **PASS** — Addons only submit triage signals or relay human intents; they never bypass the Planner $\rightarrow$ Implementer $\rightarrow$ Reviewer pipeline.
7. **Chat as Active Control Plane (Cockpit Rule)**: **PASS** — `CockpitAddon` enforces verified External Identity Binding (`workspace_member_identities`) before translating any Discord/Slack command into a control-plane intent (`ADDON_UNLINKED_EXTERNAL_USER` 403).
8. **Blast-Radius and Dependency Integrity**: **PASS** — Tier 2 community addons are locked by SHA-256 `contentHash` (`ADDON_HASH_MISMATCH` 403 fail-closed), and Topology A slot caps (`3 Signal + 1 Cockpit`) prevent host resource exhaustion.
9. **Zero-Cost Open Source Foundation ($0 Platform License)**: **PASS** — 100% self-hosted webhook receivers and HMAC verification with zero third-party SaaS middleware fees.

## Project Structure

### Documentation (this feature)

```text
specs/002-addon-sdk/
├── addon-interfaces.ts  # Canonical TypeBox interface reference (pre-existing)
├── spec.md              # Feature specification with 5 clarifications encoded
├── plan.md              # This file
├── research.md          # Phase 0 architectural research decisions
├── data-model.md        # Phase 1 entities, state machine & DB mappings
├── quickstart.md        # Phase 1 runnable verification scenarios
├── checklists/
│   └── requirements.md  # 16/16 passing quality checklist
└── contracts/
    └── addon-sdk.md     # TypeScript module & route contracts
```

### Source Code (repository root)

```text
src/orchestrator/addons/
├── sdk.ts                        # Task 15.1: Scoped GraywolfRelayContext & Valkey signal deduplication
├── sanitization.ts               # Task 15.1: <untrusted_signal_payload> XML wrapper & injection scrubber
├── registry.ts                   # Task 15.2: Topology A slot caps, SHA-256 contentHash lock & banned pattern guard
├── shadow-lifecycle.ts           # Task 15.2: Shadow Mode graduation (>=20 runs, <10% discard) & 5-discard deprecation
├── identity-binding.ts           # Task 15.2: workspace_member_identities lookup & intent parser
└── builtin/
    ├── sentry-signal.ts          # Task 15.3: @graywolf/addon-sentry official Tier 1 SignalAddon
    ├── github-issues-signal.ts   # Task 15.3: @graywolf/addon-github-issues official Tier 1 SignalAddon
    └── discord-cockpit.ts        # Task 15.3: @graywolf/addon-discord-cockpit official Tier 1 CockpitAddon

tests/
├── unit/
│   ├── addon-sdk.test.ts                         # Task 15.1 unit tests
│   └── addon-registry-shadow-identity.test.ts    # Task 15.2 unit tests
└── integration/
    └── addons-builtin.test.ts                    # Task 15.3 Fastify integration tests
```

**Structure Decision**: Matches the exact file paths and module decomposition specified in `docs/implementation-plan-detailed.md` Phase 15 (Tasks 15.1, 15.2, and 15.3).

## Complexity Tracking

No Constitution violations or complexity exceptions required.
