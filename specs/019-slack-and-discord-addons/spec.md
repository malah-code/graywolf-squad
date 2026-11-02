# Feature Specification: Expanded First-Party Addons (`@graywolf/addon-slack-cockpit`, `@graywolf/addon-discord-signal`, `@graywolf/addon-msteams-cockpit`)

**Feature Branch**: `019-slack-and-discord-addons`

**Created**: 2026-11-01

**Status**: Draft

**Input**: User description: "Phase 18 — Expanded First-Party Addons (@graywolf/addon-slack-cockpit, @graywolf/addon-discord-signal, @graywolf/addon-msteams-cockpit): Complete the PRD §17.8 First-Party Addon Roadmap by implementing the remaining P2 and P3 official Tier 1 plugins conforming strictly to @graywolf/addon-sdk (ADR-080): @graywolf/addon-slack-cockpit (Slack Block Kit HITL triage & interactive intents), @graywolf/addon-discord-signal (Discord community bug/crash signal ingestion), and @graywolf/addon-msteams-cockpit (Microsoft Teams Adaptive Cards HITL triage)."

## Clarifications

### Session 2026-11-01

- Q: How should `@graywolf/addon-slack-cockpit` compute and verify Slack webhook signatures and replay windows? → A: Compute `v0=` + `HMAC-SHA256(SLACK_SIGNING_SECRET, "v0:" + timestamp + ":" + rawBody)` compared via `crypto.timingSafeEqual`, and require `Math.abs(nowEpochSec - Number(timestamp)) <= 300` seconds (`x-slack-request-timestamp`).
- Q: How should Slack Block Kit interactive button payloads and direct intent payloads be supported at `POST /addons/slack/interactions`? → A: Support both direct normalized `{ externalMessageId, intentText, actorExternalId }` payloads and native Slack interactive `actions` payloads (`user.id`, `container.message_ts`, `actions[0].value` e.g. `approve TASK-101`), routing both through `relay.receiveHumanIntent()`.
- Q: How should `@graywolf/addon-discord-signal` classify message severity and construct deduplication fingerprints? → A: Classify `kind` as `'crash'` when stack traces/crash keywords or `kind: 'crash'` are present (else `'bug'` or `'community_feedback'`), map severity (`critical` | `high` | `medium` | `low`), and set `meta.fingerprint = "discord-signal-" + (threadId || channelId + "-" + messageId)`.
- Q: How should `@graywolf/addon-msteams-cockpit` verify Microsoft Teams webhook signatures? → A: Verify constant-time HMAC-SHA256 using `MSTEAMS_WEBHOOK_SECRET` against either `x-msteams-signature-sha256` (hex) or `authorization: HMAC <base64>` header formats.
- Q: How does Topology A slot enforcement interact when testing all 3 new addons together? → A: Topology A allows 3 `SignalAddon` (`@graywolf/addon-sentry`, `@graywolf/addon-github-issues`, `@graywolf/addon-discord-signal`) + 1 `CockpitAddon` per `AddonRegistry` instance; each CockpitAddon (`discord`, `slack`, `msteams`) is mounted in its workspace's configured `CockpitAddon` slot.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Slack Cockpit HITL Triage & Interactive Block Kit Actions (Priority: P1)

An engineering team using Slack as their primary collaboration workspace wants to receive rich Slack Block Kit notifications for Task Briefs, Escalations, and 60-Second Executive Review Packets, and wants their Lead Developers to approve, reject, or escalate tasks directly from interactive Slack buttons or slash commands with cryptographic signature verification and identity binding.

**Why this priority**: Slack is the most widely requested enterprise collaboration channel (`P2` on the PRD §17.8 roadmap); enabling interactive Block Kit approvals allows Lead Developers to govern the Software Factory without context-switching.

**Independent Test**: Can be independently tested by mounting `@graywolf/addon-slack-cockpit` on a Fastify instance and verifying Slack `v0=` HMAC-SHA256 signature + 300s timestamp replay checks, Block Kit payload formatting (`header`, `section`, `actions` buttons), and verified human intent routing via `relay.receiveHumanIntent()`.

**Acceptance Scenarios**:

1. **Given** an inbound Slack interaction or slash command request at `/addons/slack/interactions`, **When** the `x-slack-signature` (`v0=<hex>`) and `x-slack-request-timestamp` headers are valid (within 300 seconds) and the Slack user ID is linked in `workspace_member_identities`, **Then** the addon translates the interactive action or command into `relay.receiveHumanIntent()` and returns the resolved `{ taskId, intent, actorUserId }` with HTTP `200`.
2. **Given** an inbound Slack request with a tampered signature or a timestamp older than 300 seconds, **When** it arrives at `/addons/slack/interactions`, **Then** the addon rejects the request with HTTP `401` (`AUTH_SESSION_MISSING`) before parsing or executing any intent.
3. **Given** an outbound notification request at `/addons/slack/notify` for a Task Brief or Escalation, **When** the payload passes TypeBox schema validation, **Then** the addon dispatches the notification via `relay.postTaskBrief()` or `relay.postEscalation()` and returns the rendered Slack Block Kit structure (`blocks`) with HTTP `200`.

---

### User Story 2 - Discord Community Bug & Crash Signal Ingestion (Priority: P1)

An open-source or product engineering team wants to monitor designated Discord bug-report and support channels so that community-reported crashes and bug threads are automatically normalized into sanitized `GraywolfSignalEnvelope` objects, deduplicated against message storms, and queued for HITL triage.

**Why this priority**: Completes the Discord omni-channel loop alongside `@graywolf/addon-discord-cockpit` (`P2` on the PRD §17.8 roadmap), turning community bug reports into structured engineering tasks while preventing prompt-injection attacks.

**Independent Test**: Can be independently tested by mounting `@graywolf/addon-discord-signal` and sending signed and unsigned Discord message/thread webhook payloads to `/addons/discord-signal/webhook`, verifying HMAC validation, `<untrusted_signal_payload>` XML wrapping, and Valkey 180s crash-storm deduplication.

**Acceptance Scenarios**:

1. **Given** a signed Discord channel bug/crash webhook payload at `/addons/discord-signal/webhook`, **When** `x-discord-signature-sha256` matches `DISCORD_SIGNAL_SECRET` and the payload passes TypeBox validation, **Then** the addon normalizes the message into a `GraywolfSignalEnvelope` (`kind: 'crash' | 'bug' | 'community_feedback'`), sanitizes untrusted strings via `relay.submitSignal()`, and returns HTTP `202` with `{ accepted: true, deduplicated: false }`.
2. **Given** duplicate Discord reports for the same bug thread or fingerprint within the 180-second cooldown window, **When** submitted to `/addons/discord-signal/webhook`, **Then** `relay.submitSignal()` deduplicates the repeat signal and returns `{ accepted: false, deduplicated: true }`.
3. **Given** a Discord message containing prompt-injection instructions (`Ignore previous instructions` or `</untrusted_signal_payload>`), **When** ingested by `@graywolf/addon-discord-signal`, **Then** the resulting envelope description is safely neutralized and wrapped inside `<untrusted_signal_payload>` tags (ADR-025/038).

---

### User Story 3 - Microsoft Teams Adaptive Cards Cockpit Triage (Priority: P2)

An enterprise organization standardized on Microsoft Teams wants to receive Adaptive Card v1.5 Task Briefs and Escalations and allow authorized Azure AD / Teams leads to submit `approve`, `reject`, or `escalate` intents via `Action.Submit` webhooks verified by HMAC-SHA256 and `workspace_member_identities`.

**Why this priority**: Completes the full PRD §17.8 First-Party Addon table (`P3` priority) so enterprise Microsoft 365 teams have feature parity with Discord and Slack cockpits.

**Independent Test**: Can be independently tested by mounting `@graywolf/addon-msteams-cockpit`, testing Base64/Hex HMAC verification on `/addons/msteams/interactions`, verifying Adaptive Card v1.5 JSON output on `/addons/msteams/notify`, and confirming unlinked Azure AD users are rejected with `ADDON_UNLINKED_EXTERNAL_USER` (HTTP 403).

**Acceptance Scenarios**:

1. **Given** a valid Microsoft Teams `Action.Submit` interaction at `/addons/msteams/interactions` with a valid HMAC signature (`MSTEAMS_WEBHOOK_SECRET`), **When** the actor's Teams/AAD ID is linked in `workspace_member_identities`, **Then** the addon executes `relay.receiveHumanIntent()` and returns HTTP `200`.
2. **Given** a Microsoft Teams interaction from an unlinked external user, **When** `relay.receiveHumanIntent()` is invoked, **Then** the request is rejected with `ADDON_UNLINKED_EXTERNAL_USER` (HTTP `403`).
3. **Given** a Task Brief or Escalation notification sent to `/addons/msteams/notify`, **When** validated, **Then** the addon invokes `relay.postTaskBrief()` / `relay.postEscalation()` and returns a valid Adaptive Card (`$schema: "http://adaptivecards.io/schemas/adaptive-card.json"`, `version: "1.5"`) with interactive `Action.Submit` buttons.

---

### Edge Cases

- **Slack Timestamp Replay Attack (> 300 seconds)**: If `x-slack-request-timestamp` differs from the server clock by more than `300` seconds (or is non-numeric), `@graywolf/addon-slack-cockpit` MUST reject the request with HTTP `401` (`AUTH_SESSION_MISSING`) even if the HMAC digest is mathematically valid.
- **Unlinked External User Across Slack or MS Teams**: If a Slack or MS Teams user clicks an Approve/Reject button without an entry in `workspace_member_identities` for `(workspace_id, 'slack' | 'msteams', actorExternalId)`, the gateway MUST reject the intent with `ADDON_UNLINKED_EXTERNAL_USER` (HTTP `403`).
- **Topology A Slot Cap Enforcement (`maxCockpitAddons: 1`, `maxSignalAddons: 3`)**: Mounting multiple CockpitAddons simultaneously on a single `AddonRegistry` instance MUST enforce the Topology A slot cap (`ADDON_SLOT_LIMIT_EXCEEDED` HTTP `429`), while separate workspace registries or sequential registrations within slot limits succeed cleanly.
- **Zero Banned Timers or Vendor SDKs**: Scanning the source code of `slack-cockpit.ts`, `discord-signal.ts`, and `msteams-cockpit.ts` via `AddonRegistry.assertNoBannedPatterns()` MUST find zero occurrences of `@sentry/node`, `setInterval(`, or `setTimeout(`.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: `@graywolf/addon-slack-cockpit` (`src/orchestrator/addons/builtin/slack-cockpit.ts`) MUST implement `CockpitAddon` (`platform: 'slack'`, `requiredSecrets: ['SLACK_SIGNING_SECRET']`), exposing `POST /addons/slack/interactions` and `POST /addons/slack/notify` validated by TypeBox schemas.
- **FR-002**: `@graywolf/addon-slack-cockpit` MUST verify Slack's versioned HMAC-SHA256 signature (`v0=` over `v0:${timestamp}:${rawBody}`) using `crypto.timingSafeEqual` and enforce a `300`-second replay window on `x-slack-request-timestamp`, returning HTTP `401` (`AUTH_SESSION_MISSING`) on failure.
- **FR-003**: `@graywolf/addon-slack-cockpit` MUST provide a deterministic Block Kit formatter (`buildSlackBlockKitMessage`) that renders Task Briefs and Escalations into Slack Block Kit blocks (`header`, `section`, and `actions` with `Approve`, `Reject`, and `Escalate` buttons carrying `TASK-<id>` values).
- **FR-004**: `@graywolf/addon-discord-signal` (`src/orchestrator/addons/builtin/discord-signal.ts`) MUST implement `SignalAddon` (`requiredSecrets: ['DISCORD_SIGNAL_SECRET']`, `requiresPolling: false`), exposing `POST /addons/discord-signal/webhook` with constant-time `x-discord-signature-sha256` HMAC verification.
- **FR-005**: `@graywolf/addon-discord-signal` MUST normalize Discord bug/crash channel messages into `GraywolfSignalEnvelope` objects with deterministic fingerprint metadata (`discord-msg-${channelId}-${messageId}` or thread ID), delegating `<untrusted_signal_payload>` sanitization and 180s Valkey deduplication to `relay.submitSignal()`.
- **FR-006**: `@graywolf/addon-msteams-cockpit` (`src/orchestrator/addons/builtin/msteams-cockpit.ts`) MUST implement `CockpitAddon` (`platform: 'msteams'`, `requiredSecrets: ['MSTEAMS_WEBHOOK_SECRET']`), exposing `POST /addons/msteams/interactions` (with constant-time HMAC-SHA256 verification) and `POST /addons/msteams/notify` (rendering Adaptive Cards v1.5 via `buildMsTeamsAdaptiveCard`).
- **FR-007**: All three addons MUST contain zero `@sentry/node` imports and zero `setInterval` / `setTimeout` timers, and MUST enforce `workspace_member_identities` RBAC on all human intents (`ADDON_UNLINKED_EXTERNAL_USER` HTTP `403` when unlinked).
- **FR-008**: System MUST provide automated unit and integration test suites (`tests/unit/addon-slack-cockpit.test.ts`, `tests/unit/addon-discord-signal.test.ts`, and `tests/integration/addons-track-b.test.ts`) verifying all three addons.

### Key Entities

- **Slack Block Kit Payload (`SlackBlockKitMessage`)**: Structured Slack UI message containing `header`, `section` markdown summary, context metadata, and interactive `actions` buttons (`approve`, `reject`, `escalate`).
- **Discord Signal Webhook Payload (`DiscordSignalWebhookPayload`)**: Inbound Discord channel/thread bug report containing `channelId`, `messageId`, `threadId`, `author`, `content`, and optional `tags` / `severity`.
- **MS Teams Adaptive Card (`MsTeamsAdaptiveCard`)**: Adaptive Card v1.5 JSON payload (`type: "AdaptiveCard"`, `version: "1.5"`, `body`, `actions` with `Action.Submit` intent payloads).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of unsigned, tampered, or replay-expired (> 300s) webhook/interaction requests across `@graywolf/addon-slack-cockpit`, `@graywolf/addon-discord-signal`, and `@graywolf/addon-msteams-cockpit` are rejected with HTTP `401` (`AUTH_SESSION_MISSING`).
- **SC-002**: 100% of human intents triggered by unlinked Slack or Microsoft Teams users are blocked with HTTP `403` (`ADDON_UNLINKED_EXTERNAL_USER`).
- **SC-003**: 100% of untrusted Discord community bug descriptions are wrapped in `<untrusted_signal_payload>` XML tags with prompt-injection patterns neutralized and repeat crash storms deduplicated within the 180s window.
- **SC-004**: 100% of unit and integration tests for Phase 18 pass with zero regressions across the 500-test repository baseline.

## Assumptions

- Slack interactions are delivered as JSON payloads to `/addons/slack/interactions` (either directly or normalized by the Fastify JSON parser) signed with `SLACK_SIGNING_SECRET`.
- Microsoft Teams outbound webhooks / workflow card actions sign payloads with `MSTEAMS_WEBHOOK_SECRET` using HMAC-SHA256 in the `x-msteams-signature-sha256` or `authorization: HMAC <sig>` header.

