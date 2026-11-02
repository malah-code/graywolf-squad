import * as crypto from 'node:crypto';
import { Type, type Static } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import { type FastifyPluginAsync } from 'fastify';
import {
  type CockpitAddon,
  type GraywolfRelayContext,
  type GraywolfSignalEnvelope,
} from '../sdk';

/**
 * First-Party Official Addon: `@graywolf/addon-slack-cockpit`
 * (Phase 18, Task 18.1, ADR-080, PRD §17.8).
 *
 * Bridges Slack Block Kit notifications and interactive buttons / slash commands
 * to Graywolf Cockpit with constant-time v0 HMAC-SHA256 signature verification,
 * 300s replay window enforcement, and External Identity Binding.
 */

export const SlackDirectInteractionSchema = Type.Object({
  externalMessageId: Type.String({ minLength: 1 }),
  intentText: Type.String({ minLength: 1 }),
  actorExternalId: Type.String({ minLength: 1 }),
});

export const SlackBlockActionsPayloadSchema = Type.Object({
  type: Type.Literal('block_actions'),
  user: Type.Object({
    id: Type.String({ minLength: 1 }),
    username: Type.Optional(Type.String()),
  }),
  container: Type.Optional(
    Type.Object({
      message_ts: Type.Optional(Type.String()),
    })
  ),
  message: Type.Optional(
    Type.Object({
      ts: Type.Optional(Type.String()),
    })
  ),
  actions: Type.Array(
    Type.Object({
      action_id: Type.String({ minLength: 1 }),
      value: Type.String({ minLength: 1 }),
    }),
    { minItems: 1 }
  ),
});

export const SlackInteractionPayloadSchema = Type.Union([
  SlackDirectInteractionSchema,
  SlackBlockActionsPayloadSchema,
]);

export type SlackInteractionPayload = Static<
  typeof SlackInteractionPayloadSchema
>;

export const SlackOutboundNotifySchema = Type.Union([
  Type.Object({
    kind: Type.Literal('brief'),
    taskId: Type.String({ minLength: 1 }),
    title: Type.String({ minLength: 1 }),
    summaryMarkdown: Type.String(),
    severity: Type.Union([
      Type.Literal('critical'),
      Type.Literal('high'),
      Type.Literal('medium'),
      Type.Literal('low'),
      Type.Literal('unknown'),
    ]),
    links: Type.Array(
      Type.Object({
        label: Type.String(),
        url: Type.String(),
      })
    ),
  }),
  Type.Object({
    kind: Type.Literal('escalation'),
    taskId: Type.String({ minLength: 1 }),
    reason: Type.String({ minLength: 1 }),
    evidenceLedgerUrl: Type.String({ minLength: 1 }),
  }),
]);

export type SlackOutboundNotify = Static<typeof SlackOutboundNotifySchema>;

export interface SlackBlockKitMessage {
  text: string;
  blocks: Array<Record<string, unknown>>;
}

/**
 * Validates Slack v0 request signature:
 * signature: `v0=` + HMAC-SHA256(secret, `v0:${timestamp}:${rawBody}`)
 * with strict 300-second replay window protection.
 */
export function verifySlackSignature(
  rawBody: string,
  secret: string,
  sigHeader: string | undefined,
  timestampHeader: string | undefined,
  nowEpochSec = Math.floor(Date.now() / 1000)
): boolean {
  if (!sigHeader || !secret || !timestampHeader) return false;

  const timestamp = Number.parseInt(timestampHeader.trim(), 10);
  if (Number.isNaN(timestamp)) return false;

  // 300-second replay window check
  if (Math.abs(nowEpochSec - timestamp) > 300) {
    return false;
  }

  const cleanSig = sigHeader.trim();
  if (!cleanSig.startsWith('v0=')) return false;

  const baseString = `v0:${timestamp}:${rawBody}`;
  const expectedHash = crypto
    .createHmac('sha256', secret)
    .update(baseString, 'utf8')
    .digest('hex');
  const expectedSig = `v0=${expectedHash}`;

  const bufA = Buffer.from(cleanSig.toLowerCase(), 'utf8');
  const bufB = Buffer.from(expectedSig.toLowerCase(), 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Formats Task Briefs and Escalations as rich Slack Block Kit structures.
 */
export function buildSlackBlockKitMessage(
  input: SlackOutboundNotify
): SlackBlockKitMessage {
  if (input.kind === 'brief') {
    return {
      text: `[Task Brief] ${input.taskId}: ${input.title}`,
      blocks: [
        {
          type: 'header',
          text: {
            type: 'plain_text',
            text: `🐺 Task Brief: ${input.taskId}`,
            emoji: true,
          },
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*${input.title}*\nSeverity: \`${input.severity}\`\n\n${input.summaryMarkdown}`,
          },
        },
        {
          type: 'actions',
          elements: [
            {
              type: 'button',
              text: { type: 'plain_text', text: 'Approve' },
              style: 'primary',
              action_id: `slack_approve_${input.taskId}`,
              value: `approve ${input.taskId}`,
            },
            {
              type: 'button',
              text: { type: 'plain_text', text: 'Reject' },
              style: 'danger',
              action_id: `slack_reject_${input.taskId}`,
              value: `reject ${input.taskId}`,
            },
            {
              type: 'button',
              text: { type: 'plain_text', text: 'Escalate' },
              action_id: `slack_escalate_${input.taskId}`,
              value: `escalate ${input.taskId}`,
            },
          ],
        },
      ],
    };
  }

  return {
    text: `[Escalation] ${input.taskId}: ${input.reason}`,
    blocks: [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: `🚨 Task Escalation: ${input.taskId}`,
          emoji: true,
        },
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Reason*: ${input.reason}\n\nEvidence: <${input.evidenceLedgerUrl}|Evidence Ledger>`,
        },
      },
      {
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: { type: 'plain_text', text: 'Approve Override' },
            style: 'primary',
            action_id: `slack_approve_override_${input.taskId}`,
            value: `approve ${input.taskId}`,
          },
          {
            type: 'button',
            text: { type: 'plain_text', text: 'Confirm Rejection' },
            style: 'danger',
            action_id: `slack_reject_confirm_${input.taskId}`,
            value: `reject ${input.taskId}`,
          },
        ],
      },
    ],
  };
}

export const slackCockpitAddon: CockpitAddon = {
  meta: {
    name: '@graywolf/addon-slack-cockpit',
    version: '1.0.0',
    description: 'Bridges Slack Block Kit buttons and slash commands to Graywolf Cockpit.',
    requiredSecrets: ['SLACK_SIGNING_SECRET'],
    platform: 'slack',
  },

  create(relay: GraywolfRelayContext): FastifyPluginAsync {
    return async (fastify) => {
      fastify.post('/addons/slack/interactions', async (request, reply) => {
        const secret = await relay.readSecret('SLACK_SIGNING_SECRET');
        const sigHeader = request.headers['x-slack-signature'];
        const tsHeader = request.headers['x-slack-request-timestamp'];

        const signature = Array.isArray(sigHeader) ? sigHeader[0] : sigHeader;
        const timestamp = Array.isArray(tsHeader) ? tsHeader[0] : tsHeader;
        const rawBody = JSON.stringify(request.body ?? {});

        if (!verifySlackSignature(rawBody, secret, signature, timestamp)) {
          return reply.code(401).send({
            code: 'AUTH_SESSION_MISSING',
            message: 'Invalid or expired Slack v0 request signature',
          });
        }

        if (!Value.Check(SlackInteractionPayloadSchema, request.body)) {
          return reply.code(400).send({
            code: 'ACI_VALIDATION_FAILED',
            message: 'Invalid Slack interaction payload schema',
          });
        }

        const body = request.body;
        let normalizedInteraction: {
          externalMessageId: string;
          intentText: string;
          actorExternalId: string;
        };

        if ('type' in body && body.type === 'block_actions') {
          const action = body.actions[0];
          const msgId =
            body.container?.message_ts ??
            body.message?.ts ??
            `slack-${Date.now()}`;
          normalizedInteraction = {
            externalMessageId: msgId,
            intentText: action.value,
            actorExternalId: body.user.id,
          };
        } else {
          normalizedInteraction = body as {
            externalMessageId: string;
            intentText: string;
            actorExternalId: string;
          };
        }

        const result = await relay.receiveHumanIntent(normalizedInteraction);
        return reply.code(200).send(result);
      });

      fastify.post('/addons/slack/notify', async (request, reply) => {
        if (!Value.Check(SlackOutboundNotifySchema, request.body)) {
          return reply.code(400).send({
            code: 'ACI_VALIDATION_FAILED',
            message: 'Invalid Slack outbound notification schema',
          });
        }

        const body = request.body;
        const blockKitMessage = buildSlackBlockKitMessage(body);

        if (body.kind === 'brief') {
          await relay.postTaskBrief({
            taskId: body.taskId,
            title: body.title,
            summaryMarkdown: body.summaryMarkdown,
            severity: body.severity as GraywolfSignalEnvelope['severity'],
            links: body.links,
          });
        } else {
          await relay.postEscalation({
            taskId: body.taskId,
            reason: body.reason,
            evidenceLedgerUrl: body.evidenceLedgerUrl,
          });
        }

        return reply
          .code(200)
          .send({ delivered: true, blockKit: blockKitMessage });
      });
    };
  },
};

