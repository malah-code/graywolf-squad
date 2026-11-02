# Implementation Plan: Expanded First-Party Addons (`@graywolf/addon-slack-cockpit`, `@graywolf/addon-discord-signal`, `@graywolf/addon-msteams-cockpit`)

**Branch**: `019-slack-and-discord-addons` | **Date**: 2026-11-01 | **Spec**: [spec.md](file:///home/tarikelmallah/Projects/GraywolfSquad/specs/019-slack-and-discord-addons/spec.md)  
**Input**: Feature specification from `/specs/019-slack-and-discord-addons/spec.md` & `docs/implementation-plan-detailed.md` Phase 18

## Summary

Complete Phase 18 (Track B Initiative B2 — PRD §17.8 First-Party Addon Roadmap) by implementing the remaining three official Tier 1 plugins on `@graywolf/addon-sdk` (ADR-080):
1. **Task 18.1 (`src/orchestrator/addons/builtin/slack-cockpit.ts`, `tests/unit/addon-slack-cockpit.test.ts`)**: `@graywolf/addon-slack-cockpit` (`CockpitAddon`, `platform: 'slack'`) verifying Slack `v0=<hex>` HMAC-SHA256 signatures and 300s `x-slack-request-timestamp` replay windows, rendering Task Briefs and Escalations as Slack Block Kit messages (`buildSlackBlockKitMessage`), and routing interactive button/slash-command intents through `relay.receiveHumanIntent()` with `workspace_member_identities` RBAC enforcement.
2. **Task 18.2 (`src/orchestrator/addons/builtin/discord-signal.ts`, `tests/unit/addon-discord-signal.test.ts`)**: `@graywolf/addon-discord-signal` (`SignalAddon`) ingesting community bug/crash reports from Discord channels/threads at `POST /addons/discord-signal/webhook`, verifying `x-discord-signature-sha256` via `relay.readSecret('DISCORD_SIGNAL_SECRET')`, wrapping untrusted message bodies in `<untrusted_signal_payload>` XML tags (ADR-025/038), and deduplicating crash storms in Valkey (180s cooldown, ADR-044).
3. **Task 18.3 (`src/orchestrator/addons/builtin/msteams-cockpit.ts`, `tests/integration/addons-track-b.test.ts`)**: `@graywolf/addon-msteams-cockpit` (`CockpitAddon`, `platform: 'msteams'`) verifying Microsoft Teams HMAC signatures (`x-msteams-signature-sha256` or `authorization: HMAC <base64>`), rendering Adaptive Cards v1.5 (`buildMsTeamsAdaptiveCard`) with `Action.Submit` intents, and enforcing `workspace_member_identities` RBAC for Azure AD / Teams user IDs.

## Technical Context

**Language/Version**: TypeScript 5.x (Node.js 20+)  
**Primary Dependencies**: `node:crypto` (`createHmac`, `timingSafeEqual`), `@sinclair/typebox`, Fastify 5.x, `@graywolf/addon-sdk` (`src/orchestrator/addons/sdk.ts`, `registry.ts`, `identity-binding.ts`, `sanitization.ts`)  
**Storage**: PostgreSQL 16 (`workspace_member_identities` via `withTenantContext`) + Valkey (`signal:{workspaceId}:{fingerprint}` 180s TTL deduplication)  
**Testing**: Vitest (`tests/unit/addon-slack-cockpit.test.ts`, `tests/unit/addon-discord-signal.test.ts`, `tests/integration/addons-track-b.test.ts`)  
**Target Platform**: Linux server & constrained ARM64 edge host (Topology A lazy-loaded Fastify webhook routes)  
**Project Type**: Backend Fastify plugins conforming to `@graywolf/addon-sdk`  
**Performance Goals**: `< 1ms` HMAC verification and Block Kit / Adaptive Card serialization; near-zero idle RAM  
**Constraints**: Zero `@sentry/node` imports; zero `setInterval` or `setTimeout` timers; strict capability scoping (`SignalAddon` cannot post briefs; `CockpitAddon` cannot submit signals or execute shell commands)  
**Scale/Scope**: 3 builtin addon modules + 3 automated test suites (2 unit, 1 integration)

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design.*

1. **Human Sovereignty & Non-Committing Relay Contract**: **PASS** — `CockpitAddon` instances (`slack-cockpit`, `msteams-cockpit`) have zero access to `executeCommand()`, git worktrees, or `relay.mjs`; they only relay briefs, escalations, and verified human approval intents.
2. **Zero Runtime Lock-In & Permissive Licensing First**: **PASS** — Implemented with native `node:crypto` and `@sinclair/typebox` without proprietary vendor SDK lock-in.
3. **Single ACID Relational & Vector Baseline**: **PASS** — Uses PostgreSQL `workspace_member_identities` with `withTenantContext` RLS isolation.
4. **Headless Execution & Observability**: **PASS** — Structured ADR-042 error envelopes (`AUTH_SESSION_MISSING`, `ACI_VALIDATION_FAILED`, `ADDON_UNLINKED_EXTERNAL_USER`).
5. **Dual Operational Mode (Greenfield & Brownfield)**: **PASS** — Software Factory signals and HITL cockpit approvals operate identically across Greenfield and Brownfield projects.
6. **Virtual Developer Tier Handoff Protocol**: **PASS** — Approved signals enter the standard Dev-Level-1 $\rightarrow$ Dev-Level-3 $\rightarrow$ Dev-Level-2 pipeline.
7. **Chat as Active Control Plane (Cockpit Rule)**: **PASS** — Enforces verified `workspace_member_identities` mapping before any external Slack or MS Teams user can trigger a control-plane intent.
8. **Blast-Radius and Dependency Integrity**: **PASS** — Untrusted Discord signal strings are strictly wrapped in `<untrusted_signal_payload>` XML tags (ADR-025/038) and deduplicated in Valkey (ADR-044).
9. **Zero-Cost Open Source Foundation ($0 Platform License)**: **PASS** — All 6 first-party addons in PRD §17.8 are bundled free in the open-source core under ELv2.

## Project Structure

### Documentation (this feature)

```text
specs/019-slack-and-discord-addons/
├── spec.md                              # Feature specification with 5 clarifications encoded
├── plan.md                              # This file
├── research.md                          # Phase 0 architectural research decisions
├── data-model.md                        # Phase 1 TypeBox schemas & Block Kit / Adaptive Card models
├── quickstart.md                        # Phase 1 runnable verification guide
├── checklists/
│   └── requirements.md                  # 16/16 passing quality checklist
└── contracts/
    └── addons-track-b.md                # Route, signature, and formatter contracts
```

### Source Code (repository root)

```text
src/orchestrator/addons/builtin/
├── slack-cockpit.ts                     # Task 18.1: @graywolf/addon-slack-cockpit (v0 HMAC, 300s replay, Block Kit)
├── discord-signal.ts                    # Task 18.2: @graywolf/addon-discord-signal (HMAC, sanitization, deduplication)
└── msteams-cockpit.ts                   # Task 18.3: @graywolf/addon-msteams-cockpit (HMAC, Adaptive Cards v1.5)

tests/
├── unit/
│   ├── addon-slack-cockpit.test.ts      # Task 18.1 unit tests
│   └── addon-discord-signal.test.ts     # Task 18.2 unit tests
└── integration/
    └── addons-track-b.test.ts           # Task 18.3 integration tests (all 6 PRD §17.8 addons & Topology A slots)
```

**Structure Decision**: Matches the exact file paths and verification suites specified in `docs/implementation-plan-detailed.md` Phase 18 (Tasks 18.1, 18.2, and 18.3).

## Complexity Tracking

No Constitution violations or complexity exceptions required.
