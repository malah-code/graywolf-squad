# Contracts: Expanded First-Party Addons (`019-slack-and-discord-addons`)

## 1. `@graywolf/addon-slack-cockpit` (`src/orchestrator/addons/builtin/slack-cockpit.ts`)

- **Metadata**:
  - `name`: `'@graywolf/addon-slack-cockpit'`
  - `version`: `'1.0.0'`
  - `requiredSecrets`: `['SLACK_SIGNING_SECRET']`
  - `platform`: `'slack'`
- **Exports**:
  - `slackCockpitAddon: CockpitAddon`
  - `verifySlackSignature(rawBody: string, secret: string, sigHeader: string | undefined, timestampHeader: string | undefined, nowEpochSec?: number): boolean`
  - `buildSlackBlockKitMessage(input: SlackOutboundNotify): SlackBlockKitMessage`
- **Routes**:
  - `POST /addons/slack/interactions`:
    - Verifies `x-slack-signature` (`v0=<hex>`) and `x-slack-request-timestamp` ($\le 300$s replay window) using `SLACK_SIGNING_SECRET`. Returns `401 AUTH_SESSION_MISSING` on failure.
    - Validates body against `SlackInteractionPayloadSchema` (`400 ACI_VALIDATION_FAILED` on invalid schema).
    - Calls `relay.receiveHumanIntent({ externalMessageId, intentText, actorExternalId })` (which enforces `workspace_member_identities` lookup for `platform: 'slack'` and throws `403 ADDON_UNLINKED_EXTERNAL_USER` if unlinked).
  - `POST /addons/slack/notify`:
    - Validates body against `SlackOutboundNotifySchema` (`brief` or `escalation`).
    - Invokes `relay.postTaskBrief(...)` or `relay.postEscalation(...)`.
    - Returns `200 { delivered: true, blockKit: buildSlackBlockKitMessage(body) }`.

---

## 2. `@graywolf/addon-discord-signal` (`src/orchestrator/addons/builtin/discord-signal.ts`)

- **Metadata**:
  - `name`: `'@graywolf/addon-discord-signal'`
  - `version`: `'1.0.0'`
  - `requiredSecrets`: `['DISCORD_SIGNAL_SECRET']`
  - `requiresPolling`: `false`
- **Exports**:
  - `discordSignalAddon: SignalAddon`
- **Routes**:
  - `POST /addons/discord-signal/webhook`:
    - Verifies `x-discord-signature-sha256` against `DISCORD_SIGNAL_SECRET` via `crypto.timingSafeEqual` (`401 AUTH_SESSION_MISSING` on failure).
    - Validates body against `DiscordSignalWebhookPayloadSchema` (`400 ACI_VALIDATION_FAILED` on invalid schema).
    - Normalizes into `GraywolfSignalEnvelope` with `source: '@graywolf/addon-discord-signal'`, `meta.fingerprint: payload.threadId ? 'discord-thread-' + payload.threadId : 'discord-msg-' + payload.channelId + '-' + payload.messageId`.
    - Calls `await relay.submitSignal(envelope)` (sanitizing `title` and `description` inside `<untrusted_signal_payload>` XML tags and deduplicating in Valkey for `180` seconds).
    - Returns `202` with `{ accepted, deduplicated, fingerprintHash }`.

---

## 3. `@graywolf/addon-msteams-cockpit` (`src/orchestrator/addons/builtin/msteams-cockpit.ts`)

- **Metadata**:
  - `name`: `'@graywolf/addon-msteams-cockpit'`
  - `version`: `'1.0.0'`
  - `requiredSecrets`: `['MSTEAMS_WEBHOOK_SECRET']`
  - `platform`: `'msteams'`
- **Exports**:
  - `msteamsCockpitAddon: CockpitAddon`
  - `verifyMsTeamsSignature(rawBody: string, secret: string, sigHeader: string | undefined): boolean`
  - `buildMsTeamsAdaptiveCard(input: MsTeamsOutboundNotify): MsTeamsAdaptiveCard`
- **Routes**:
  - `POST /addons/msteams/interactions`:
    - Verifies `x-msteams-signature-sha256` or `authorization: HMAC <base64>` against `MSTEAMS_WEBHOOK_SECRET` (`401 AUTH_SESSION_MISSING` on failure).
    - Validates body against `MsTeamsInteractionPayloadSchema` (`400 ACI_VALIDATION_FAILED` on invalid schema).
    - Calls `relay.receiveHumanIntent({ externalMessageId, intentText, actorExternalId })` (enforcing `workspace_member_identities` for `platform: 'msteams'`).
  - `POST /addons/msteams/notify`:
    - Validates body against `MsTeamsOutboundNotifySchema` (`brief` or `escalation`).
    - Invokes `relay.postTaskBrief(...)` or `relay.postEscalation(...)`.
    - Returns `200 { delivered: true, adaptiveCard: buildMsTeamsAdaptiveCard(body) }`.

