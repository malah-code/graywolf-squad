# Quickstart & Verification Guide: Phase 18 Expanded First-Party Addons

## 1. Run `@graywolf/addon-slack-cockpit` Unit Suite (Task 18.1)

```bash
pnpm test tests/unit/addon-slack-cockpit.test.ts
```

**Expected Outcome**: Verifies Slack `v0=` HMAC-SHA256 signature validation, 300s timestamp replay rejection, Block Kit message construction (`header`, `section`, `actions` buttons), and verified vs. unlinked (`403 ADDON_UNLINKED_EXTERNAL_USER`) Slack user intent execution.

## 2. Run `@graywolf/addon-discord-signal` Unit Suite (Task 18.2)

```bash
pnpm test tests/unit/addon-discord-signal.test.ts
```

**Expected Outcome**: Verifies `x-discord-signature-sha256` HMAC validation, `<untrusted_signal_payload>` XML prompt-injection sanitization, thread/message fingerprint generation, and 180s Valkey crash-storm deduplication.

## 3. Run `@graywolf/addon-msteams-cockpit` & Full Track B Addons Integration Suite (Task 18.3)

```bash
pnpm test tests/integration/addons-track-b.test.ts
```

**Expected Outcome**: Verifies `@graywolf/addon-msteams-cockpit` Adaptive Cards v1.5 generation, Hex/Base64 HMAC verification, Azure AD external identity binding, Topology A 3-Signal + 1-Cockpit slot registration (`@graywolf/addon-sentry`, `@graywolf/addon-github-issues`, `@graywolf/addon-discord-signal` + Cockpit), and zero banned patterns (`@sentry/node`, `setInterval`, `setTimeout`) across all builtin addons.

