# Phase 0 Research: Expanded First-Party Addons (`@graywolf/addon-slack-cockpit`, `@graywolf/addon-discord-signal`, `@graywolf/addon-msteams-cockpit`)

## R1: Slack `v0=` Request Signature & 300s Replay Protection (`@graywolf/addon-slack-cockpit`)

- **Decision**: Implement `verifySlackSignature(rawBody, secret, sigHeader, timestampHeader, nowEpochSec)` in `src/orchestrator/addons/builtin/slack-cockpit.ts`. It parses `timestampHeader` (`x-slack-request-timestamp`) as an integer epoch second, rejects if `Math.abs(nowEpochSec - ts) > 300`, constructs `basestring = "v0:" + ts + ":" + rawBody`, computes `expected = "v0=" + crypto.createHmac("sha256", secret).update(basestring, "utf8").digest("hex")`, and compares buffers using `crypto.timingSafeEqual`.
- **Rationale**: Matches Slack's official v0 request signing specification and mitigates replay attacks within a 5-minute window using zero external SDK dependencies.
- **Alternatives Considered**:
  - *Installing `@slack/bolt`*: Rejected — adds heavy transitive dependencies and custom HTTP receivers that bypass Fastify's TypeBox validation and `AddonRegistry` lifecycle.

## R2: Slack Block Kit & Dual Interaction Payload Normalization

- **Decision**: Provide `buildSlackBlockKitMessage(payload)` returning structured Slack Block Kit `blocks` (`header`, `section` with `mrkdwn`, and `actions` containing `Approve`, `Reject`, and `Escalate` buttons with `value: "approve ${taskId}"`, `"reject ${taskId}"`, `"escalate ${taskId}"`). On `POST /addons/slack/interactions`, accept both normalized `{ externalMessageId, intentText, actorExternalId }` payloads and native Slack interactive `block_actions` payloads (`user.id`, `container.message_ts`, `actions[0].value`).
- **Rationale**: Allows seamless testing with the standard CockpitAddon interaction contract while supporting native Slack Block Kit button click payloads out-of-the-box.

## R3: Discord Community Bug/Crash Signal Normalization (`@graywolf/addon-discord-signal`)

- **Decision**: Implement `discordSignalAddon` (`SignalAddon`) at `POST /addons/discord-signal/webhook` verified by `x-discord-signature-sha256` and `DISCORD_SIGNAL_SECRET`. Normalize channel messages into `GraywolfSignalEnvelope` with `source: '@graywolf/addon-discord-signal'`, `meta.fingerprint = payload.threadId ? "discord-thread-" + payload.threadId : "discord-msg-" + payload.channelId + "-" + payload.messageId`, and pass through `relay.submitSignal(envelope)` which automatically wraps untrusted strings in `<untrusted_signal_payload>` XML tags and deduplicates via Valkey (`180s` TTL).
- **Rationale**: Reuses the battle-tested `createScopedRelayContext` sanitization and Valkey crash-storm deduplicator from Phase 15 (`sdk.ts`).

## R4: Microsoft Teams Adaptive Cards v1.5 & Dual Header HMAC (`@graywolf/addon-msteams-cockpit`)

- **Decision**: Implement `msteamsCockpitAddon` (`CockpitAddon`, `platform: 'msteams'`) verifying `MSTEAMS_WEBHOOK_SECRET` against either `x-msteams-signature-sha256` (hex) or `authorization: HMAC <base64>` headers via `crypto.timingSafeEqual`. Render outbound notifications as Adaptive Cards v1.5 (`$schema: "http://adaptivecards.io/schemas/adaptive-card.json"`, `type: "AdaptiveCard"`, `version: "1.5"`) with `Action.Submit` buttons (`approve ${taskId}`, `reject ${taskId}`, `escalate ${taskId}`).
- **Rationale**: Supports both Azure Bot / Outbound Webhook `Authorization: HMAC <base64>` and standard `x-msteams-signature-sha256` headers while keeping memory footprint near zero on Topology A hosts.

