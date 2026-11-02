import * as crypto from 'node:crypto';
import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { createGlobalErrorHandler } from '../../src/orchestrator/errors/error-handler';
import { createScopedRelayContext } from '../../src/orchestrator/addons/sdk';
import {
  discordSignalAddon,
  verifyDiscordSignature,
} from '../../src/orchestrator/addons/builtin/discord-signal';

function signDiscordSha256(rawBody: string, secret: string): string {
  return crypto
    .createHmac('sha256', secret)
    .update(rawBody, 'utf8')
    .digest('hex');
}

describe('@graywolf/addon-discord-signal Unit Test Suite (Task 18.2, FR-004, FR-005, FR-006, SC-003, SC-004)', () => {
  const testSecret = 'discord-webhook-secret-key-456';

  it('validates verifyDiscordSignature with valid, tampered, and missing inputs', () => {
    const rawBody = JSON.stringify({ hello: 'discord' });
    const validSig = signDiscordSha256(rawBody, testSecret);

    // 1. Valid signature
    expect(verifyDiscordSignature(rawBody, testSecret, validSig)).toBe(true);
    expect(verifyDiscordSignature(rawBody, testSecret, `sha256=${validSig}`)).toBe(true);

    // 2. Tampered signature
    const tampered = validSig.replace(/^./, validSig[0] === 'a' ? 'b' : 'a');
    expect(verifyDiscordSignature(rawBody, testSecret, tampered)).toBe(false);

    // 3. Missing or empty values
    expect(verifyDiscordSignature(rawBody, '', validSig)).toBe(false);
    expect(verifyDiscordSignature(rawBody, testSecret, undefined)).toBe(false);
    expect(verifyDiscordSignature(rawBody, testSecret, 'too-short')).toBe(false);
  });

  it('ingests Discord webhook, verifies signature, sanitizes payload in XML tags, and enforces 180s deduplication', async () => {
    const app = Fastify();
    app.setErrorHandler(createGlobalErrorHandler());

    const registeredSecrets: Record<string, string> = {
      DISCORD_SIGNAL_SECRET: testSecret,
    };

    const relay = createScopedRelayContext({
      workspaceId: 'ws-discord-signal-test',
      addonName: '@graywolf/addon-discord-signal',
      addonType: 'signal',
      requiredSecrets: ['DISCORD_SIGNAL_SECRET'],
      secretReader: async (key) => registeredSecrets[key] ?? '',
    });

    await app.register(discordSignalAddon.create(relay));

    const validPayload = {
      channelId: '9876543210',
      messageId: '1122334455',
      content: 'Production panic: null pointer dereference in auth middleware\nStack: at auth.ts:42',
      author: {
        id: 'user-discord-99',
        username: 'alice_oncall',
      },
      kind: 'crash' as const,
      severity: 'critical' as const,
    };

    const rawBody = JSON.stringify(validPayload);
    const validSig = signDiscordSha256(rawBody, testSecret);

    // 1. First submission -> 202 Accepted, deduplicated = false
    const res1 = await app.inject({
      method: 'POST',
      url: '/addons/discord-signal/webhook',
      headers: {
        'content-type': 'application/json',
        'x-discord-signature-sha256': validSig,
      },
      payload: rawBody,
    });

    expect(res1.statusCode).toBe(202);
    const body1 = res1.json();
    expect(body1.signalId).toBeDefined();
    expect(body1.deduplicated).toBe(false);
    expect(body1.fingerprintHash).toBeDefined();
    expect(body1.xmlWrappedPayload).toContain('<untrusted_signal_payload');
    expect(body1.xmlWrappedPayload).toContain('</untrusted_signal_payload>');
    expect(body1.xmlWrappedPayload).toContain('Production panic');

    // 2. Immediate duplicate within 180s cooldown -> 202 Accepted, deduplicated = true
    const res2 = await app.inject({
      method: 'POST',
      url: '/addons/discord-signal/webhook',
      headers: {
        'content-type': 'application/json',
        'x-discord-signature-sha256': validSig,
      },
      payload: rawBody,
    });

    expect(res2.statusCode).toBe(202);
    const body2 = res2.json();
    expect(body2.signalId).toBe(body1.signalId);
    expect(body2.deduplicated).toBe(true);

    // 3. Thread-based fingerprint isolation
    const threadPayload = {
      ...validPayload,
      messageId: '5566778899',
      threadId: 'thread-998877',
      content: 'Different bug in separate thread\nDetails here',
    };
    const threadBody = JSON.stringify(threadPayload);
    const threadSig = signDiscordSha256(threadBody, testSecret);

    const resThread = await app.inject({
      method: 'POST',
      url: '/addons/discord-signal/webhook',
      headers: {
        'content-type': 'application/json',
        'x-discord-signature-sha256': threadSig,
      },
      payload: threadBody,
    });

    expect(resThread.statusCode).toBe(202);
    const bodyThread = resThread.json();
    expect(bodyThread.signalId).not.toBe(body1.signalId);
    expect(bodyThread.deduplicated).toBe(false);

    // 4. Tampered signature -> 401 AUTH_SESSION_MISSING
    const resTampered = await app.inject({
      method: 'POST',
      url: '/addons/discord-signal/webhook',
      headers: {
        'content-type': 'application/json',
        'x-discord-signature-sha256': '0000000000000000000000000000000000000000000000000000000000000000',
      },
      payload: rawBody,
    });

    expect(resTampered.statusCode).toBe(401);
    expect(resTampered.json().code).toBe('AUTH_SESSION_MISSING');

    // 5. Malformed payload -> 400 ACI_VALIDATION_FAILED
    const invalidPayload = {
      channelId: '9876543210',
      // missing messageId, content, author
    };
    const invalidBody = JSON.stringify(invalidPayload);
    const invalidSig = signDiscordSha256(invalidBody, testSecret);

    const resInvalid = await app.inject({
      method: 'POST',
      url: '/addons/discord-signal/webhook',
      headers: {
        'content-type': 'application/json',
        'x-discord-signature-sha256': invalidSig,
      },
      payload: invalidBody,
    });

    expect(resInvalid.statusCode).toBe(400);
    expect(resInvalid.json().code).toBe('ACI_VALIDATION_FAILED');

    await app.close();
  });
});
