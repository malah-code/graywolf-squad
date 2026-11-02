import * as crypto from 'node:crypto';
import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { createGlobalErrorHandler } from '../../src/orchestrator/errors/error-handler';
import { GraywolfAppError } from '../../src/orchestrator/errors/taxonomy';
import { createScopedRelayContext } from '../../src/orchestrator/addons/sdk';
import {
  buildSlackBlockKitMessage,
  slackCockpitAddon,
  verifySlackSignature,
} from '../../src/orchestrator/addons/builtin/slack-cockpit';

function signSlackV0(rawBody: string, secret: string, timestamp: number): string {
  const baseString = `v0:${timestamp}:${rawBody}`;
  const hmacHex = crypto
    .createHmac('sha256', secret)
    .update(baseString, 'utf8')
    .digest('hex');
  return `v0=${hmacHex}`;
}

describe('@graywolf/addon-slack-cockpit Unit Test Suite (Task 18.1, FR-001, FR-002, FR-003, SC-001, SC-002)', () => {
  const testSecret = 'slack-test-signing-secret-key-123';

  it('validates verifySlackSignature with valid signature, tampered signature, and replay timestamp expiry', () => {
    const rawBody = JSON.stringify({ hello: 'world' });
    const nowSec = 1793500000;
    const validSig = signSlackV0(rawBody, testSecret, nowSec);

    // 1. Valid signature and current timestamp
    expect(
      verifySlackSignature(rawBody, testSecret, validSig, String(nowSec), nowSec)
    ).toBe(true);

    // 2. Tampered signature
    const tamperedSig = validSig.replace(/[0-9a-f]$/, '0');
    expect(
      verifySlackSignature(rawBody, testSecret, tamperedSig, String(nowSec), nowSec)
    ).toBe(false);

    // 3. Expired timestamp (> 300 seconds)
    const expiredTimestamp = nowSec - 301;
    const expiredSig = signSlackV0(rawBody, testSecret, expiredTimestamp);
    expect(
      verifySlackSignature(rawBody, testSecret, expiredSig, String(expiredTimestamp), nowSec)
    ).toBe(false);

    // 4. Future timestamp (> 300 seconds)
    const futureTimestamp = nowSec + 301;
    const futureSig = signSlackV0(rawBody, testSecret, futureTimestamp);
    expect(
      verifySlackSignature(rawBody, testSecret, futureSig, String(futureTimestamp), nowSec)
    ).toBe(false);

    // 5. Missing headers
    expect(
      verifySlackSignature(rawBody, testSecret, undefined, String(nowSec), nowSec)
    ).toBe(false);
    expect(
      verifySlackSignature(rawBody, testSecret, validSig, undefined, nowSec)
    ).toBe(false);
  });

  it('generates valid Slack Block Kit structures for Task Brief and Escalation notifications', () => {
    // Brief
    const briefMessage = buildSlackBlockKitMessage({
      kind: 'brief',
      taskId: 'TASK-SLACK-001',
      title: 'Fix Payment Retry Glitch',
      summaryMarkdown: 'Detailed summary of payment retry glitch fix',
      severity: 'high',
      links: [{ label: 'PR #42', url: 'https://github.com/org/repo/pull/42' }],
    });

    expect(briefMessage.text).toContain('TASK-SLACK-001');
    expect(briefMessage.blocks.length).toBe(3);
    expect(briefMessage.blocks[0]).toMatchObject({
      type: 'header',
      text: { text: '🐺 Task Brief: TASK-SLACK-001' },
    });
    expect(briefMessage.blocks[2]).toMatchObject({
      type: 'actions',
    });

    // Escalation
    const escalationMessage = buildSlackBlockKitMessage({
      kind: 'escalation',
      taskId: 'TASK-SLACK-002',
      reason: 'Sandbox container timed out after 3 retries',
      evidenceLedgerUrl: 'https://cockpit.graywolf.local/evidence/TASK-SLACK-002',
    });

    expect(escalationMessage.text).toContain('TASK-SLACK-002');
    expect(escalationMessage.blocks[0]).toMatchObject({
      type: 'header',
      text: { text: '🚨 Task Escalation: TASK-SLACK-002' },
    });
  });

  it('processes verified Slack interactions (direct and block_actions) and rejects unlinked external users with 403', async () => {
    const app = Fastify();
    app.setErrorHandler(createGlobalErrorHandler());

    const registeredSecrets: Record<string, string> = {
      SLACK_SIGNING_SECRET: testSecret,
    };

    const linkedIdentities: Record<string, string> = {
      'slack:U_LEAD_SLACK': 'user-lead-1',
    };

    const relay = createScopedRelayContext({
      workspaceId: 'ws-slack-test',
      addonName: '@graywolf/addon-slack-cockpit',
      addonType: 'cockpit',
      requiredSecrets: ['SLACK_SIGNING_SECRET'],
      secretReader: async (key) => registeredSecrets[key] ?? '',
      onReceiveHumanIntent: async (raw) => {
        const actorUserId = linkedIdentities[`slack:${raw.actorExternalId}`];
        if (!actorUserId) {
          throw new GraywolfAppError(
            'ADDON_UNLINKED_EXTERNAL_USER',
            `Slack external user ${raw.actorExternalId} is not linked to any workspace member`
          );
        }
        const parts = raw.intentText.split(' ');
        return {
          taskId: parts[1] || 'TASK-UNKNOWN',
          intent: (parts[0] ?? 'unknown') as 'approve' | 'reject' | 'escalate' | 'unknown',
          actorUserId,
        };
      },
    });

    await app.register(slackCockpitAddon.create(relay));

    const nowSec = Math.floor(Date.now() / 1000);

    // 1. Direct normalized interaction by linked user
    const directPayload = {
      externalMessageId: 'msg-direct-101',
      intentText: 'approve TASK-101',
      actorExternalId: 'U_LEAD_SLACK',
    };
    const directBody = JSON.stringify(directPayload);
    const directSig = signSlackV0(directBody, testSecret, nowSec);

    const directRes = await app.inject({
      method: 'POST',
      url: '/addons/slack/interactions',
      headers: {
        'content-type': 'application/json',
        'x-slack-signature': directSig,
        'x-slack-request-timestamp': String(nowSec),
      },
      payload: directBody,
    });

    expect(directRes.statusCode).toBe(200);
    const directResult = directRes.json();
    expect(directResult).toEqual({
      taskId: 'TASK-101',
      intent: 'approve',
      actorUserId: 'user-lead-1',
    });

    // 2. Native Slack block_actions button click by linked user
    const buttonPayload = {
      type: 'block_actions' as const,
      user: { id: 'U_LEAD_SLACK', username: 'leaddev' },
      container: { message_ts: '1793500123.000100' },
      actions: [
        {
          action_id: 'slack_approve_TASK-202',
          value: 'approve TASK-202',
        },
      ],
    };
    const buttonBody = JSON.stringify(buttonPayload);
    const buttonSig = signSlackV0(buttonBody, testSecret, nowSec);

    const buttonRes = await app.inject({
      method: 'POST',
      url: '/addons/slack/interactions',
      headers: {
        'content-type': 'application/json',
        'x-slack-signature': buttonSig,
        'x-slack-request-timestamp': String(nowSec),
      },
      payload: buttonBody,
    });

    expect(buttonRes.statusCode).toBe(200);
    const buttonResult = buttonRes.json();
    expect(buttonResult).toEqual({
      taskId: 'TASK-202',
      intent: 'approve',
      actorUserId: 'user-lead-1',
    });

    // 3. Unlinked Slack user click -> 403 ADDON_UNLINKED_EXTERNAL_USER
    const unlinkedPayload = {
      externalMessageId: 'msg-unlinked',
      intentText: 'approve TASK-303',
      actorExternalId: 'U_UNKNOWN_STRANGER',
    };
    const unlinkedBody = JSON.stringify(unlinkedPayload);
    const unlinkedSig = signSlackV0(unlinkedBody, testSecret, nowSec);

    const unlinkedRes = await app.inject({
      method: 'POST',
      url: '/addons/slack/interactions',
      headers: {
        'content-type': 'application/json',
        'x-slack-signature': unlinkedSig,
        'x-slack-request-timestamp': String(nowSec),
      },
      payload: unlinkedBody,
    });

    expect(unlinkedRes.statusCode).toBe(403);
    const unlinkedErr = unlinkedRes.json();
    expect(unlinkedErr.code).toBe('ADDON_UNLINKED_EXTERNAL_USER');

    // 4. Tampered Slack signature -> 401 AUTH_SESSION_MISSING
    const tamperedRes = await app.inject({
      method: 'POST',
      url: '/addons/slack/interactions',
      headers: {
        'content-type': 'application/json',
        'x-slack-signature': 'v0=0000000000000000000000000000000000000000000000000000000000000000',
        'x-slack-request-timestamp': String(nowSec),
      },
      payload: directBody,
    });

    expect(tamperedRes.statusCode).toBe(401);
    expect(tamperedRes.json().code).toBe('AUTH_SESSION_MISSING');

    // 5. Outbound notify dispatch test
    const notifyRes = await app.inject({
      method: 'POST',
      url: '/addons/slack/notify',
      payload: {
        kind: 'brief',
        taskId: 'TASK-NOTIFY-1',
        title: 'Notify Test',
        summaryMarkdown: 'Summary',
        severity: 'low',
        links: [],
      },
    });

    expect(notifyRes.statusCode).toBe(200);
    expect(notifyRes.json().delivered).toBe(true);
    expect(notifyRes.json().blockKit.blocks).toBeDefined();

    await app.close();
  });
});
