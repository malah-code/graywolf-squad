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
import { AddonRegistry } from '../../src/orchestrator/addons/registry';
import { executeVerifiedHumanIntent } from '../../src/orchestrator/addons/identity-binding';
import { sentrySignalAddon } from '../../src/orchestrator/addons/builtin/sentry-signal';
import { githubIssuesSignalAddon } from '../../src/orchestrator/addons/builtin/github-issues-signal';
import { discordCockpitAddon } from '../../src/orchestrator/addons/builtin/discord-cockpit';

function signHmacHex(rawBody: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');
}

describe('First-Party Reference Addons Integration Suite (Task 15.3, ADR-080)', () => {
  const secrets: Record<string, string> = {
    SENTRY_WEBHOOK_HMAC_SECRET: 'sentry-test-secret-key',
    GITHUB_WEBHOOK_HMAC_SECRET: 'github-test-secret-key',
    DISCORD_WEBHOOK_SECRET: 'discord-test-secret-key',
  };

  it('mounts @graywolf/addon-sentry, @graywolf/addon-github-issues, and @graywolf/addon-discord-cockpit and verifies HMAC, deduplication, and identity binding', async () => {
    const app = Fastify();
    app.setErrorHandler(createGlobalErrorHandler());

    const acceptedSignals: GraywolfSignalEnvelope[] = [];
    const briefsPosted: Array<{ taskId: string; title: string }> = [];
    const escalationsPosted: Array<{ taskId: string; reason: string }> = [];
    const valkeyStore = new Map<string, string>();

    const registry = new AddonRegistry();
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
    registry.registerCockpitAddon(discordCockpitAddon, {
      package: '@graywolf/addon-discord-cockpit',
      type: 'cockpit',
      tier: 'official',
      shadowState: 'graduated',
    });

    await registry.mountAll(app, (addonName, addonType, requiredSecrets, platform) =>
      createScopedRelayContext({
        workspaceId: 'ws-int-1',
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
            workspaceId: 'ws-int-1',
            platform: 'discord',
            externalMessageId: raw.externalMessageId,
            intentText: raw.intentText,
            actorExternalId: raw.actorExternalId,
            lookupOverride: async (q) =>
              q.actorExternalId === 'linked-discord-lead'
                ? 'graywolf-user-lead-1'
                : null,
          }),
      })
    );

    // 1. Sentry webhook: invalid signature -> 401
    const sentryBody = {
      action: 'created',
      data: {
        issue: {
          id: '98765',
          title: 'ReferenceError: window is not defined',
          culprit: 'src/ssr/render.ts',
          level: 'fatal',
          permalink: 'https://sentry.io/issues/98765',
        },
      },
    };
    const badSentryRes = await app.inject({
      method: 'POST',
      url: '/addons/sentry/webhook',
      headers: { 'x-sentry-hook-signature': 'deadbeef' },
      payload: sentryBody,
    });
    expect(badSentryRes.statusCode).toBe(401);

    // Valid Sentry signature -> 202 + deduplication on 2nd storm call
    const sentrySig = signHmacHex(
      JSON.stringify(sentryBody),
      secrets.SENTRY_WEBHOOK_HMAC_SECRET
    );
    const okSentryRes1 = await app.inject({
      method: 'POST',
      url: '/addons/sentry/webhook',
      headers: { 'x-sentry-hook-signature': sentrySig },
      payload: sentryBody,
    });
    expect(okSentryRes1.statusCode).toBe(202);
    expect(okSentryRes1.json().deduplicated).toBe(false);
    expect(acceptedSignals).toHaveLength(1);
    expect(acceptedSignals[0].kind).toBe('crash');
    expect(acceptedSignals[0].severity).toBe('critical');

    const okSentryRes2 = await app.inject({
      method: 'POST',
      url: '/addons/sentry/webhook',
      headers: { 'x-sentry-hook-signature': sentrySig },
      payload: sentryBody,
    });
    expect(okSentryRes2.statusCode).toBe(202);
    expect(okSentryRes2.json().deduplicated).toBe(true);
    expect(acceptedSignals).toHaveLength(1);

    // 2. GitHub Issues webhook: valid sha256=<hex> signature -> 202
    const ghBody = {
      action: 'opened',
      issue: {
        number: 42,
        title: 'Bug: OAuth callback fails on Safari',
        body: 'Steps to reproduce...',
        html_url: 'https://github.com/org/repo/issues/42',
        labels: [{ name: 'bug' }],
      },
    };
    const ghSig = `sha256=${signHmacHex(
      JSON.stringify(ghBody),
      secrets.GITHUB_WEBHOOK_HMAC_SECRET
    )}`;
    const ghRes = await app.inject({
      method: 'POST',
      url: '/addons/github-issues/webhook',
      headers: { 'x-hub-signature-256': ghSig },
      payload: ghBody,
    });
    expect(ghRes.statusCode).toBe(202);
    expect(acceptedSignals).toHaveLength(2);
    expect(acceptedSignals[1].kind).toBe('bug-report');

    // 3. Discord Cockpit: unlinked user -> 403 ADDON_UNLINKED_EXTERNAL_USER
    const unlinkedDiscordBody = {
      externalMessageId: 'discord-msg-1',
      intentText: '/approve TASK-900',
      actorExternalId: 'unlinked-discord-user',
    };
    const unlinkedSig = signHmacHex(
      JSON.stringify(unlinkedDiscordBody),
      secrets.DISCORD_WEBHOOK_SECRET
    );
    const unlinkedRes = await app.inject({
      method: 'POST',
      url: '/addons/discord/interactions',
      headers: { 'x-discord-signature-sha256': unlinkedSig },
      payload: unlinkedDiscordBody,
    });
    expect(unlinkedRes.statusCode).toBe(403);
    expect(unlinkedRes.json().code).toBe('ADDON_UNLINKED_EXTERNAL_USER');

    // Linked Discord user -> 200 approve intent
    const linkedDiscordBody = {
      externalMessageId: 'discord-msg-2',
      intentText: '/approve TASK-900',
      actorExternalId: 'linked-discord-lead',
    };
    const linkedSig = signHmacHex(
      JSON.stringify(linkedDiscordBody),
      secrets.DISCORD_WEBHOOK_SECRET
    );
    const linkedRes = await app.inject({
      method: 'POST',
      url: '/addons/discord/interactions',
      headers: { 'x-discord-signature-sha256': linkedSig },
      payload: linkedDiscordBody,
    });
    expect(linkedRes.statusCode).toBe(200);
    expect(linkedRes.json()).toEqual({
      taskId: 'TASK-900',
      intent: 'approve',
      actorUserId: 'graywolf-user-lead-1',
    });

    // Outbound brief & escalation notify routes
    const notifyBriefRes = await app.inject({
      method: 'POST',
      url: '/addons/discord/notify',
      payload: {
        kind: 'brief',
        taskId: 'TASK-900',
        title: 'Fix Safari OAuth',
        summaryMarkdown: 'Ready for review',
        severity: 'high',
        links: [],
      },
    });
    expect(notifyBriefRes.statusCode).toBe(200);
    expect(briefsPosted).toHaveLength(1);

    await app.close();
  });

  it('verifies all built-in addon source files contain zero @sentry/node imports and zero setInterval/setTimeout timers', async () => {
    const builtinDir = path.resolve('src/orchestrator/addons/builtin');
    const files = [
      'sentry-signal.ts',
      'github-issues-signal.ts',
      'discord-cockpit.ts',
    ];

    for (const file of files) {
      const content = await fs.readFile(path.join(builtinDir, file), 'utf8');
      expect(content).not.toMatch(/@sentry\/node\b/);
      expect(content).not.toMatch(/\b(?:setInterval|setTimeout)\s*\(/);
    }
  });
});
