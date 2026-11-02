# Quickstart & Verification Guide: Software Factory & Pluggable `@graywolf/addon-sdk`

**Feature**: `specs/002-addon-sdk`  
**Phase**: 15 (`docs/implementation-plan-detailed.md` Tasks 15.1–15.3)

---

## 1. Prerequisites

- Node.js 20+ and `pnpm` installed
- Dependencies installed (`pnpm install`)

---

## 2. Verification Commands

### Task 15.1 — `@graywolf/addon-sdk` Runtime Context, Valkey Deduplication & Sanitization

```bash
pnpm vitest run tests/unit/addon-sdk.test.ts
```

**Expected Outcomes**:
- `SignalAddon` contexts allow `submitSignal` and `scheduleRepeatableJob`, while throwing `RBAC_INSUFFICIENT_ROLE` (`details.reason: 'ADDON_FORBIDDEN_CAPABILITY'`) on `postTaskBrief`, `postEscalation`, and `receiveHumanIntent`.
- `CockpitAddon` contexts allow `postTaskBrief`, `postEscalation`, and `receiveHumanIntent`, while throwing `RBAC_INSUFFICIENT_ROLE` on `submitSignal` and `scheduleRepeatableJob`.
- Undeclared `readSecret(key)` throws `RBAC_INSUFFICIENT_ROLE` (`details.reason: 'ADDON_FORBIDDEN_CAPABILITY'`).
- Duplicate crash signals within the 180s Valkey cooldown (`signal:{workspaceId}:{fingerprintHash}`) are suppressed.
- `sanitizeSignalEnvelopeForPrompt` strips `</untrusted_signal_payload>` breakout attempts and prompt-injection directives (`IGNORE PREVIOUS INSTRUCTIONS`) and wraps fields in `<untrusted_signal_payload>`.

---

### Task 15.2 — Two-Tier Addon Registry, Shadow Mode Lifecycle & External Identity Binding

```bash
pnpm vitest run tests/unit/addon-registry-shadow-identity.test.ts
```

**Expected Outcomes**:
- Registering `> 3` `SignalAddon`s or `> 1` `CockpitAddon` throws `ADDON_SLOT_LIMIT_EXCEEDED` (HTTP 429).
- Tier 2 `community` addon with missing or mismatched SHA-256 `contentHash` throws `ADDON_HASH_MISMATCH` (HTTP 403 fail-closed).
- Addons containing `@sentry/node`, `setInterval(`, or `setTimeout(` are rejected at registration.
- Shadow Mode starts in `'shadow'` (audit-log only), promotes to `'graduated'` only when `shadowRunCount >= 20` and `shadowDiscardRate < 0.10` with `'lead_dev'`/`'owner'` approval, and auto-deprecates to `'deprecated'` after `5` consecutive post-graduation discards.
- `receiveHumanIntent` rejects unlinked Discord/Slack users with `ADDON_UNLINKED_EXTERNAL_USER` (HTTP 403) and resolves linked users from `workspace_member_identities`.

---

### Task 15.3 — First-Party Reference Addons (`@graywolf/addon-sentry`, `@graywolf/addon-github-issues`, `@graywolf/addon-discord-cockpit`)

```bash
pnpm vitest run tests/integration/addons-builtin.test.ts
```

**Expected Outcomes**:
- `POST /addons/sentry/webhook` verifies `x-sentry-hook-signature` HMAC-SHA256, validates payload via TypeBox, and submits normalized `crash` signals.
- `POST /addons/github-issues/webhook` verifies `x-hub-signature-256` (`sha256=<hex>`), classifies `bug-report` vs `feature` issues, and submits normalized signals.
- `POST /addons/discord/interactions` verifies `x-discord-signature-sha256` and routes intents through `receiveHumanIntent`.
- Static source verification confirms zero `@sentry/node` imports and zero `setInterval`/`setTimeout` calls across `src/orchestrator/addons/builtin/*.ts`.

