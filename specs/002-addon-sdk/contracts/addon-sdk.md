# Interface Contracts: Software Factory & Pluggable `@graywolf/addon-sdk`

**Feature**: `specs/002-addon-sdk`  
**Phase**: 15 (`docs/implementation-plan-detailed.md` Tasks 15.1–15.3)

---

## 1. Runtime SDK & Deduplication (`src/orchestrator/addons/sdk.ts`)

```typescript
import { type FastifyPluginAsync } from 'fastify';
import {
  GraywolfSignalEnvelope,
  AddonManifest,
  type GraywolfRelayContext,
  type SignalAddon,
  type SignalAddonMeta,
  type CockpitAddon,
  type CockpitAddonMeta,
} from '../../../specs/002-addon-sdk/addon-interfaces';

export {
  GraywolfSignalEnvelope,
  AddonManifest,
  type GraywolfRelayContext,
  type SignalAddon,
  type SignalAddonMeta,
  type CockpitAddon,
  type CockpitAddonMeta,
};

export function computeSignalFingerprint(envelope: GraywolfSignalEnvelope): string;

export function createScopedRelayContext(options: {
  workspaceId: string;
  addonType: 'signal' | 'cockpit';
  addonName: string;
  requiredSecrets: string[];
  platform?: 'discord' | 'slack' | 'msteams' | 'custom';
  cooldownSeconds?: number; // default: 180
  valkeyStore?: {
    get(key: string): Promise<string | null>;
    set(key: string, value: string, ttlSeconds: number): Promise<void>;
    del(key: string): Promise<void>;
  };
  secretReader?: (key: string) => Promise<string>;
  onSignalAccepted?: (envelope: GraywolfSignalEnvelope) => Promise<void> | void;
  onRepeatableJobScheduled?: (opts: {
    jobKey: string;
    schedule: string | number;
    payload: Record<string, unknown>;
  }) => Promise<void> | void;
  onPostTaskBrief?: (brief: {
    taskId: string;
    title: string;
    summaryMarkdown: string;
    severity: GraywolfSignalEnvelope['severity'];
    links: GraywolfSignalEnvelope['links'];
  }) => Promise<void> | void;
  onPostEscalation?: (alert: {
    taskId: string;
    reason: string;
    evidenceLedgerUrl: string;
  }) => Promise<void> | void;
  identityResolver?: (input: {
    workspaceId: string;
    platform: string;
    actorExternalId: string;
  }) => Promise<string | null>;
}): GraywolfRelayContext;
```

---

## 2. Untrusted Signal Sanitizer (`src/orchestrator/addons/sanitization.ts`)

```typescript
import { type GraywolfSignalEnvelope } from './sdk';

export function sanitizeUntrustedSignalText(raw: string): string;

export function sanitizeSignalEnvelopeForPrompt(envelope: GraywolfSignalEnvelope): {
  sanitizedEnvelope: GraywolfSignalEnvelope;
  xmlWrappedPayload: string;
  redactedInjectionCount: number;
};
```

---

## 3. Two-Tier Addon Registry (`src/orchestrator/addons/registry.ts`)

```typescript
import { type FastifyInstance } from 'fastify';
import { type AddonManifest, type SignalAddon, type CockpitAddon } from './sdk';

export function computeAddonBundleHash(bundleSource: string): string;

export function assertNoBannedAddonPatterns(addonName: string, sourceOrFactoryText: string): void;

export class AddonRegistry {
  constructor(options?: {
    maxSignalAddons?: number;  // default: 3
    maxCockpitAddons?: number; // default: 1
  });

  public validateAndRegisterManifest(
    manifest: AddonManifest,
    bundleSourcesByPackage?: Record<string, string>
  ): void;

  public registerSignalAddon(
    addon: SignalAddon,
    manifestEntry: AddonManifest['installed'][number],
    bundleSource?: string
  ): void;

  public registerCockpitAddon(
    addon: CockpitAddon,
    manifestEntry: AddonManifest['installed'][number],
    bundleSource?: string
  ): void;

  public mountAll(
    fastify: FastifyInstance,
    contextFactory: (addonName: string, addonType: 'signal' | 'cockpit', requiredSecrets: string[], platform?: 'discord' | 'slack' | 'msteams' | 'custom') => import('./sdk').GraywolfRelayContext
  ): Promise<void>;
}
```

---

## 4. Shadow Mode Lifecycle Manager (`src/orchestrator/addons/shadow-lifecycle.ts`)

```typescript
import { type GraywolfSignalEnvelope } from './sdk';

export interface AddonShadowRecord {
  addonPackage: string;
  shadowState: 'shadow' | 'graduated' | 'deprecated';
  shadowRunCount: number;
  discardedShadowCount: number;
  shadowDiscardRate: number;
  consecutivePostGradDiscards: number;
  auditLog: Array<{
    signalId: string;
    recordedAt: string;
    discarded: boolean;
    forwardedToKanban: boolean;
  }>;
}

export class ShadowLifecycleManager {
  public registerAddon(addonPackage: string, initialState?: 'shadow' | 'graduated' | 'deprecated'): AddonShadowRecord;
  public recordSignalDelivery(addonPackage: string, envelope: GraywolfSignalEnvelope): {
    forwardedToKanban: boolean;
    shadowState: 'shadow' | 'graduated' | 'deprecated';
  };
  public recordOperatorFeedback(addonPackage: string, signalId: string, decision: 'accepted' | 'discarded'): AddonShadowRecord;
  public promoteAddon(addonPackage: string, actorRole: 'owner' | 'lead_dev' | 'developer' | 'viewer', actorUserId: string): AddonShadowRecord;
  public getAddonState(addonPackage: string): AddonShadowRecord;
}
```

---

## 5. External Identity Binding (`src/orchestrator/addons/identity-binding.ts`)

```typescript
export function parseHumanIntentText(intentText: string, fallbackTaskId?: string): {
  taskId: string;
  intent: 'approve' | 'reject' | 'escalate' | 'unknown';
};

export async function resolveAndVerifyExternalIdentity(input: {
  workspaceId: string;
  platform: 'discord' | 'slack' | 'msteams' | 'custom';
  actorExternalId: string;
  lookupOverride?: (q: { workspaceId: string; platform: string; actorExternalId: string }) => Promise<string | null>;
}): Promise<{ actorUserId: string }>;
```

---

## 6. Built-In Reference Addons (`src/orchestrator/addons/builtin/*.ts`)

1. **`src/orchestrator/addons/builtin/sentry-signal.ts`**:
   - Exports `sentrySignalAddon: SignalAddon` (`name: '@graywolf/addon-sentry'`, `requiredSecrets: ['SENTRY_WEBHOOK_HMAC_SECRET']`).
   - Route: `POST /addons/sentry/webhook` (verifies `x-sentry-hook-signature` HMAC-SHA256 hex digest).
2. **`src/orchestrator/addons/builtin/github-issues-signal.ts`**:
   - Exports `githubIssuesSignalAddon: SignalAddon` (`name: '@graywolf/addon-github-issues'`, `requiredSecrets: ['GITHUB_WEBHOOK_HMAC_SECRET']`).
   - Route: `POST /addons/github-issues/webhook` (verifies `x-hub-signature-256` `sha256=<hex>` digest).
3. **`src/orchestrator/addons/builtin/discord-cockpit.ts`**:
   - Exports `discordCockpitAddon: CockpitAddon` (`name: '@graywolf/addon-discord-cockpit'`, `platform: 'discord'`, `requiredSecrets: ['DISCORD_WEBHOOK_SECRET']`).
   - Route: `POST /addons/discord/interactions` (verifies `x-discord-signature-sha256` HMAC-SHA256 hex digest and calls `relay.receiveHumanIntent`) and `POST /addons/discord/notify` (dispatches `postTaskBrief` / `postEscalation`).

