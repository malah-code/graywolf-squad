import * as crypto from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { createGlobalErrorHandler } from '../../src/orchestrator/errors/error-handler';
import {
  createScopedRelayContext,
  type GraywolfSignalEnvelope,
} from '../../src/orchestrator/addons/sdk';
import {
  AddonRegistry,
  assertNoBannedAddonPatterns,
} from '../../src/orchestrator/addons/registry';
import { executeVerifiedHumanIntent } from '../../src/orchestrator/addons/identity-binding';
import { sentrySignalAddon } from '../../src/orchestrator/addons/builtin/sentry-signal';
import { githubIssuesSignalAddon } from '../../src/orchestrator/addons/builtin/github-issues-signal';
import { discordSignalAddon } from '../../src/orchestrator/addons/builtin/discord-signal';
import {
  buildMsTeamsAdaptiveCard,
  msteamsCockpitAddon,
  verifyMsTeamsSignature,
} from '../../src/orchestrator/addons/builtin/msteams-cockpit';
import { slackCockpitAddon } from '../../src/orchestrator/addons/builtin/slack-cockpit';

function signHmacHex(rawBody: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');
}

function signHmacBase64(rawBody: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(rawBody, 'utf8').digest('base64');
}

describe('Track B Expanded Addons Integration Suite (Tasks 18.1, 18.2, 18.3, ADR-080, PRD §17.8)', () => {
  const secrets: Record<string, string> = {
    DISCORD_SIGNAL_SECRET: 'discord-signal-secret-key-1',
    MSTEAMS_WEBHOOK_SECRET: 'msteams-webhook-secret-key-2',
    SLACK_SIGNING_SECRET: 'slack-signing-secret-key-3',
    SENTRY_WEBHOOK_HMAC_SECRET: 'sentry-secret-key',
    GITHUB_WEBHOOK_HMAC_SECRET: 'github-secret-key',
  };

  it('enforces Topology A slot limits: max 3 SignalAddons, max 1 CockpitAddon', () => {
    const registry = new AddonRegistry({ maxSignalAddons: 3, maxCockpitAddons: 1 });

    // Register 3 SignalAddons (allowed)
    registry.registerSignalAddon(sentrySignalAddon, {
      package: '@graywolf/addon-sentry',
      type: 'signal',
      tier: 'official',
      shadowState: 'graduated',
    });
    registry.registerSignalAddon(githubIssuesSignalAddon, {
      package: '@graywolf/addon-github-issues',
      type: 'signal',
      tier: 'official',
      shadowState: 'graduated',
    });
    registry.registerSignalAddon(discordSignalAddon, {
      package: '@graywolf/addon-discord-signal',
      type: 'signal',
      tier: 'official',
      shadowState: 'graduated',
    });

    // Attempt 4th SignalAddon -> 429 ADDON_SLOT_LIMIT_EXCEEDED
    expect(() =>
      registry.registerSignalAddon(discordSignalAddon, {
        package: '@graywolf/addon-extra-signal',
        type: 'signal',
        tier: 'official',
        shadowState: 'graduated',
      })
    ).toThrowError(/Maximum SignalAddon slots/i);

    // Register 1 CockpitAddon (allowed)
    registry.registerCockpitAddon(msteamsCockpitAddon, {
      package: '@graywolf/addon-msteams-cockpit',
      type: 'cockpit',
      tier: 'official',
      shadowState: 'graduated',
    });

    // Attempt 2nd CockpitAddon -> 429 ADDON_SLOT_LIMIT_EXCEEDED
    expect(() =>
      registry.registerCockpitAddon(slackCockpitAddon, {
        package: '@graywolf/addon-slack-cockpit',
        type: 'cockpit',
        tier: 'official',
        shadowState: 'graduated',
      })
    ).toThrowError(/Maximum CockpitAddon slots/i);
  });

  it('mounts Track B addons, validates MS Teams Adaptive Cards, HMAC auth, and Azure AD identity binding', async () => {
    const app = Fastify();
    app.setErrorHandler(createGlobalErrorHandler());

    const acceptedSignals: GraywolfSignalEnvelope[] = [];
    const briefsPosted: Array<{ taskId: string; title: string }> = [];
    const escalationsPosted: Array<{ taskId: string; reason: string }> = [];
    const valkeyStore = new Map<string, string>();

    const registry = new AddonRegistry();
    registry.registerSignalAddon(discordSignalAddon, {
      package: '@graywolf/addon-discord-signal',
      type: 'signal',
      tier: 'official',
      shadowState: 'graduated',
    });
    registry.registerCockpitAddon(msteamsCockpitAddon, {
      package: '@graywolf/addon-msteams-cockpit',
      type: 'cockpit',
      tier: 'official',
      shadowState: 'graduated',
    });

    await registry.mountAll(app, (addonName, addonType, requiredSecrets, platform) =>
      createScopedRelayContext({
        workspaceId: 'ws-track-b',
        addonName,
        addonType,
        requiredSecrets,
        platform,
        secretReader: async (k) => secrets[k] ?? '',
        valkeyStore: {
          async get(k) {
            return valkeyStore.get(k) ?? null;
          },
          async set(k, v) {
            valkeyStore.set(k, v);
          },
          async del(k) {
            valkeyStore.delete(k);
          },
        },
        onSignalAccepted: (env) => {
          acceptedSignals.push(env);
        },
        onPostTaskBrief: (b) => {
          briefsPosted.push({ taskId: b.taskId, title: b.title });
        },
        onPostEscalation: (e) => {
          escalationsPosted.push({ taskId: e.taskId, reason: e.reason });
        },
        onReceiveHumanIntent: async (raw) =>
          executeVerifiedHumanIntent({
            workspaceId: 'ws-track-b',
            platform: 'msteams',
            externalMessageId: raw.externalMessageId,
            intentText: raw.intentText,
            actorExternalId: raw.actorExternalId,
            lookupOverride: async (q) =>
              q.actorExternalId === 'aad-lead-user-1'
                ? 'graywolf-user-lead-azure'
                : null,
          }),
      })
    );

    // 1. Test Discord Signal Webhook
    const discordPayload = {
      channelId: 'discord-channel-qa',
      messageId: 'discord-msg-qa-1',
      content: 'Critical memory leak observed on staging node 4',
      author: {
        id: 'discord-qa-agent',
        username: 'qa_agent',
      },
      kind: 'crash' as const,
      severity: 'critical' as const,
    };
    const discordBody = JSON.stringify(discordPayload);
    const discordSig = signHmacHex(discordBody, secrets.DISCORD_SIGNAL_SECRET);

    const discordRes = await app.inject({
      method: 'POST',
      url: '/addons/discord-signal/webhook',
      headers: {
        'content-type': 'application/json',
        'x-discord-signature-sha256': discordSig,
      },
      payload: discordBody,
    });

    expect(discordRes.statusCode).toBe(202);
    expect(acceptedSignals).toHaveLength(1);
    expect(acceptedSignals[0].title).toBe('Critical memory leak observed on staging node 4');

    // 2. Test Microsoft Teams Adaptive Card Webhook with HMAC header
    const teamsCardPayload = {
      type: 'message' as const,
      id: 'teams-msg-interaction-1',
      from: {
        id: 'teams-user-guid-001',
        name: 'Azure DevOps Lead',
        aadObjectId: 'aad-lead-user-1',
      },
      value: {
        intentText: 'approve TASK-777',
        taskId: 'TASK-777',
      },
    };
    const teamsBody = JSON.stringify(teamsCardPayload);
    const teamsB64Sig = signHmacBase64(teamsBody, secrets.MSTEAMS_WEBHOOK_SECRET);

    // 2a. Successful verification with authorization: HMAC <base64>
    const teamsRes1 = await app.inject({
      method: 'POST',
      url: '/addons/msteams/interactions',
      headers: {
        'content-type': 'application/json',
        authorization: `HMAC ${teamsB64Sig}`,
      },
      payload: teamsBody,
    });

    expect(teamsRes1.statusCode).toBe(200);
    expect(teamsRes1.json()).toEqual({
      taskId: 'TASK-777',
      intent: 'approve',
      actorUserId: 'graywolf-user-lead-azure',
    });

    // 2b. Successful verification with x-msteams-signature-sha256 (hex)
    const teamsHexSig = signHmacHex(teamsBody, secrets.MSTEAMS_WEBHOOK_SECRET);
    const teamsRes2 = await app.inject({
      method: 'POST',
      url: '/addons/msteams/interactions',
      headers: {
        'content-type': 'application/json',
        'x-msteams-signature-sha256': teamsHexSig,
      },
      payload: teamsBody,
    });
    expect(teamsRes2.statusCode).toBe(200);

    // 2c. Unlinked Azure AD user -> 403 ADDON_UNLINKED_EXTERNAL_USER
    const unlinkedPayload = {
      ...teamsCardPayload,
      from: {
        id: 'teams-unknown-user',
        aadObjectId: 'aad-unlinked-unknown',
      },
    };
    const unlinkedBody = JSON.stringify(unlinkedPayload);
    const unlinkedSig = signHmacBase64(unlinkedBody, secrets.MSTEAMS_WEBHOOK_SECRET);

    const unlinkedRes = await app.inject({
      method: 'POST',
      url: '/addons/msteams/interactions',
      headers: {
        'content-type': 'application/json',
        authorization: `HMAC ${unlinkedSig}`,
      },
      payload: unlinkedBody,
    });

    expect(unlinkedRes.statusCode).toBe(403);
    expect(unlinkedRes.json().code).toBe('ADDON_UNLINKED_EXTERNAL_USER');

    // 2d. Invalid signature -> 401 AUTH_SESSION_MISSING
    const badSigRes = await app.inject({
      method: 'POST',
      url: '/addons/msteams/interactions',
      headers: {
        'content-type': 'application/json',
        authorization: 'HMAC bad-signature-data',
      },
      payload: teamsBody,
    });
    expect(badSigRes.statusCode).toBe(401);
    expect(badSigRes.json().code).toBe('AUTH_SESSION_MISSING');

    // 3. Test Microsoft Teams Outbound Notification (Adaptive Card generation)
    const briefNotifyRes = await app.inject({
      method: 'POST',
      url: '/addons/msteams/notify',
      payload: {
        kind: 'brief',
        taskId: 'TASK-888',
        title: 'Track B Teams Integration',
        summaryMarkdown: 'PR ready for review',
        severity: 'high',
        links: [{ label: 'GitHub PR', url: 'https://github.com/org/repo/pull/1' }],
      },
    });

    expect(briefNotifyRes.statusCode).toBe(200);
    const briefJson = briefNotifyRes.json();
    expect(briefJson.delivered).toBe(true);
    expect(briefJson.adaptiveCard.type).toBe('AdaptiveCard');
    expect(briefJson.adaptiveCard.version).toBe('1.5');
    expect(briefsPosted).toHaveLength(1);

    const escalationNotifyRes = await app.inject({
      method: 'POST',
      url: '/addons/msteams/notify',
      payload: {
        kind: 'escalation',
        taskId: 'TASK-888',
        reason: 'Two strike failure in verification test',
        evidenceLedgerUrl: 'https://graywolf.local/evidence/TASK-888',
      },
    });

    expect(escalationNotifyRes.statusCode).toBe(200);
    const escalationJson = escalationNotifyRes.json();
    expect(escalationJson.delivered).toBe(true);
    expect(escalationJson.adaptiveCard.version).toBe('1.5');
    expect(escalationsPosted).toHaveLength(1);

    await app.close();
  });

  it('validates verifyMsTeamsSignature with base64, hex, and invalid formats and tests buildMsTeamsAdaptiveCard', () => {
    const raw = JSON.stringify({ ping: 'pong' });
    const sec = 'secret123';
    const b64 = signHmacBase64(raw, sec);
    const hex = signHmacHex(raw, sec);

    expect(verifyMsTeamsSignature(raw, sec, `HMAC ${b64}`)).toBe(true);
    expect(verifyMsTeamsSignature(raw, sec, b64)).toBe(true);
    expect(verifyMsTeamsSignature(raw, sec, hex)).toBe(true);
    expect(verifyMsTeamsSignature(raw, sec, `sha256=${hex}`)).toBe(true);
    expect(verifyMsTeamsSignature(raw, sec, 'invalid-sig')).toBe(false);
    expect(verifyMsTeamsSignature(raw, '', hex)).toBe(false);

    // Direct buildMsTeamsAdaptiveCard verification
    const card = buildMsTeamsAdaptiveCard({
      kind: 'brief',
      taskId: 'TASK-1',
      title: 'Test',
      summaryMarkdown: 'Summary',
      severity: 'medium',
      links: [],
    });
    expect(card.type).toBe('AdaptiveCard');
    expect(card.version).toBe('1.5');
  });

  it('verifies all Track B built-in addon source files contain zero banned patterns', async () => {
    const builtinDir = path.resolve('src/orchestrator/addons/builtin');
    const trackBFiles = [
      'slack-cockpit.ts',
      'discord-signal.ts',
      'msteams-cockpit.ts',
    ];

    for (const file of trackBFiles) {
      const content = await fs.readFile(path.join(builtinDir, file), 'utf8');
      expect(content).not.toMatch(/@sentry\/node\b/);
      expect(content).not.toMatch(/\b(?:setInterval|setTimeout)\s*\(/);
      expect(() => assertNoBannedAddonPatterns(file, content)).not.toThrow();
    }
  });
});
