---
description: "Task list for Phase 18 — Expanded First-Party Addons (@graywolf/addon-slack-cockpit, @graywolf/addon-discord-signal, @graywolf/addon-msteams-cockpit)"
---

# Tasks: Expanded First-Party Addons (`@graywolf/addon-slack-cockpit`, `@graywolf/addon-discord-signal`, `@graywolf/addon-msteams-cockpit`)

**Input**: Design documents from `/specs/019-slack-and-discord-addons/`

**Prerequisites**: `plan.md` (required), `spec.md` (required for user stories), `research.md`, `data-model.md`, `contracts/addons-track-b.md`, `quickstart.md`

**Tests**: Automated unit and integration test suites are explicitly included per `FR-008` and `SC-004`.

**Organization**: Tasks are grouped by user story (`US1` `@graywolf/addon-slack-cockpit`, `US2` `@graywolf/addon-discord-signal`, `US3` `@graywolf/addon-msteams-cockpit`) so each addon can be implemented and verified independently.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (`[US1]`, `[US2]`, `[US3]`)
- Exact file paths and verbatim constraints are included in every task description

---

## Phase 1: User Story 1 - `@graywolf/addon-slack-cockpit` (Block Kit Triage, Interactive Actions & Signature Verification) (Priority: P1) 🎯 MVP (Task 18.1)

**Goal**: Implement `@graywolf/addon-slack-cockpit` conforming to `CockpitAddon` (`platform: 'slack'`, `requiredSecrets: ['SLACK_SIGNING_SECRET']`), enforcing Slack `v0=<hex>` HMAC-SHA256 signature verification and 300-second `x-slack-request-timestamp` replay protection, formatting Task Briefs and Escalations as Slack Block Kit messages, and routing both normalized and native Block Kit `block_actions` payloads through `relay.receiveHumanIntent()`.

**Independent Test**: `pnpm test tests/unit/addon-slack-cockpit.test.ts`

### Implementation for User Story 1

- [x] T001 [P] [US1] Implement `verifySlackSignature(rawBody, secret, sigHeader, timestampHeader, nowEpochSec)` and TypeBox schemas (`SlackDirectInteractionSchema`, `SlackBlockActionsPayloadSchema`, `SlackInteractionPayloadSchema`, `SlackOutboundNotifySchema`) in `src/orchestrator/addons/builtin/slack-cockpit.ts` verifying `v0=` HMAC-SHA256 over `"v0:" + timestamp + ":" + rawBody` via `crypto.timingSafeEqual` and rejecting requests with `Math.abs(nowEpochSec - Number(timestamp)) > 300` (`FR-001`, `FR-002`, `SC-001`)
- [x] T002 [US1] Implement `buildSlackBlockKitMessage(input)` and `slackCockpitAddon: CockpitAddon` (`POST /addons/slack/interactions` and `POST /addons/slack/notify`) in `src/orchestrator/addons/builtin/slack-cockpit.ts` rendering `header`, `section` (`mrkdwn`), and `actions` buttons (`Approve`, `Reject`, `Escalate` carrying `"approve " + taskId`, `"reject " + taskId`, `"escalate " + taskId`), normalizing `block_actions` (`user.id`, `container.message_ts`, `actions[0].value`) into `relay.receiveHumanIntent()`, and maintaining zero `@sentry/node` imports and zero `setInterval`/`setTimeout` calls (`FR-001`, `FR-002`, `FR-003`, `FR-007`)
- [x] T003 [US1] Create unit test suite in `tests/unit/addon-slack-cockpit.test.ts` verifying `verifySlackSignature` (valid `v0=` signature, tampered signature `401 AUTH_SESSION_MISSING`, expired `> 300s` timestamp `401 AUTH_SESSION_MISSING`), `buildSlackBlockKitMessage` (`brief` and `escalation` Block Kit output), native `block_actions` + direct intent routing via `POST /addons/slack/interactions`, and `403 ADDON_UNLINKED_EXTERNAL_USER` rejection for unlinked Slack users (`FR-001`, `FR-002`, `FR-003`, `FR-007`, `FR-008`, `SC-001`, `SC-002`)

**Checkpoint**: User Story 1 (`Task 18.1`) is independently complete and verified via `tests/unit/addon-slack-cockpit.test.ts`.

---

## Phase 2: User Story 2 - `@graywolf/addon-discord-signal` (Community Bug/Issue Channel Monitor) (Priority: P1) (Task 18.2)

**Goal**: Implement `@graywolf/addon-discord-signal` conforming to `SignalAddon` (`requiredSecrets: ['DISCORD_SIGNAL_SECRET']`, `requiresPolling: false`), verifying `x-discord-signature-sha256` HMAC digests, normalizing Discord bug/crash channel messages into `GraywolfSignalEnvelope` objects with thread/message fingerprints, wrapping untrusted content in `<untrusted_signal_payload>` XML tags, and deduplicating crash storms in Valkey (`180s` TTL).

**Independent Test**: `pnpm test tests/unit/addon-discord-signal.test.ts`

### Implementation for User Story 2

- [x] T004 [P] [US2] Implement `DiscordSignalWebhookPayloadSchema` (`channelId`, `messageId`, optional `threadId`, optional `title`, `content`, `author`, optional `kind: 'crash' | 'bug' | 'community_feedback'`, optional `severity: 'critical' | 'high' | 'medium' | 'low'`, optional `messageUrl`, optional `timestamp`) and `discordSignalAddon: SignalAddon` (`POST /addons/discord-signal/webhook`) in `src/orchestrator/addons/builtin/discord-signal.ts` verifying `x-discord-signature-sha256` via `crypto.timingSafeEqual` against `relay.readSecret('DISCORD_SIGNAL_SECRET')`, setting `meta.fingerprint = payload.threadId ? "discord-thread-" + payload.threadId : "discord-msg-" + payload.channelId + "-" + payload.messageId`, and calling `relay.submitSignal(envelope)` (`FR-004`, `FR-005`, `FR-007`, `SC-001`, `SC-003`)
- [x] T005 [US2] Create unit test suite in `tests/unit/addon-discord-signal.test.ts` verifying valid/invalid `x-discord-signature-sha256` (`401 AUTH_SESSION_MISSING`), invalid payload schema (`400 ACI_VALIDATION_FAILED`), `<untrusted_signal_payload>` prompt-injection neutralization on untrusted Discord message bodies, thread/message fingerprint generation, and 180s Valkey duplicate suppression (`{ accepted: false, deduplicated: true }`) (`FR-004`, `FR-005`, `FR-008`, `SC-001`, `SC-003`)

**Checkpoint**: User Story 2 (`Task 18.2`) is independently complete and verified via `tests/unit/addon-discord-signal.test.ts`.

---

## Phase 3: User Story 3 - `@graywolf/addon-msteams-cockpit` (Adaptive Cards v1.5 Triage & Action.Submit) (Priority: P2) (Task 18.3)

**Goal**: Implement `@graywolf/addon-msteams-cockpit` conforming to `CockpitAddon` (`platform: 'msteams'`, `requiredSecrets: ['MSTEAMS_WEBHOOK_SECRET']`), verifying `x-msteams-signature-sha256` (hex) or `authorization: HMAC <base64>` digests, rendering Adaptive Cards v1.5 (`buildMsTeamsAdaptiveCard`), and routing `Action.Submit` intents through `relay.receiveHumanIntent()` with Azure AD / Teams identity binding.

**Independent Test**: `pnpm test tests/integration/addons-track-b.test.ts`

### Implementation for User Story 3

- [x] T006 [P] [US3] Implement `verifyMsTeamsSignature(rawBody, secret, sigHeader)` (supporting both hex `x-msteams-signature-sha256` and Base64 `authorization: HMAC <base64>`), `MsTeamsInteractionPayloadSchema` (union of normalized intent and Adaptive Card `Action.Submit` `{ id, from: { id, aadObjectId }, value: { intentText, taskId } }`), `MsTeamsOutboundNotifySchema`, `buildMsTeamsAdaptiveCard(input)` (`$schema: "http://adaptivecards.io/schemas/adaptive-card.json"`, `type: "AdaptiveCard"`, `version: "1.5"`), and `msteamsCockpitAddon: CockpitAddon` (`POST /addons/msteams/interactions` and `POST /addons/msteams/notify`) in `src/orchestrator/addons/builtin/msteams-cockpit.ts` (`FR-006`, `FR-007`, `SC-001`, `SC-002`)
- [x] T007 [US3] Create integration test suite in `tests/integration/addons-track-b.test.ts` mounting and verifying `@graywolf/addon-slack-cockpit`, `@graywolf/addon-discord-signal`, and `@graywolf/addon-msteams-cockpit` alongside `AddonRegistry` (verifying Adaptive Cards v1.5 output, Hex and Base64 `HMAC` verification, Azure AD `from.aadObjectId` / `from.id` identity binding + `403 ADDON_UNLINKED_EXTERNAL_USER`, Topology A 3-Signal + 1-Cockpit slot registration with `@graywolf/addon-sentry`, `@graywolf/addon-github-issues`, and `@graywolf/addon-discord-signal`, and `assertNoBannedPatterns` across all 3 new builtin addon source files) (`FR-006`, `FR-007`, `FR-008`, `SC-001`, `SC-002`, `SC-004`)

**Checkpoint**: User Story 3 (`Task 18.3`) is complete and verified via `tests/integration/addons-track-b.test.ts`.

---

## Phase 4: Polish & Cross-Cutting Verification

**Purpose**: Run full repository typecheck, lint, build, and 500+ test suite verification, and mark Tasks 18.1–18.3 complete in `docs/implementation-plan-detailed.md`.

- [x] T008 Run `pnpm typecheck`, `pnpm lint`, `pnpm build`, and `pnpm test` across all repository and dashboard suites, and mark Tasks 18.1–18.3 `[x]` in `docs/implementation-plan-detailed.md` (`SC-004`)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (User Story 1 — `T001`..`T003`)**, **Phase 2 (User Story 2 — `T004`..`T005`)**, and **Phase 3 (`T006`)**: Touch distinct files in `src/orchestrator/addons/builtin/` and can be developed in parallel (`[P]`).
- **Phase 3 Integration (`T007`)**: Exercises all 3 Track B addons together in `tests/integration/addons-track-b.test.ts` and depends on `T002`, `T004`, and `T006`.
- **Phase 4 (Polish — `T008`)**: Depends on `T001`..`T007` passing cleanly.

### Parallel Opportunities

- `T001`/`T002` (`slack-cockpit.ts`), `T004` (`discord-signal.ts`), and `T006` (`msteams-cockpit.ts`) operate on completely independent files and can be implemented in parallel.

