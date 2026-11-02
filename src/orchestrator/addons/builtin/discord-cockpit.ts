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
 * First-Party Official Reference Addon: `@graywolf/addon-discord-cockpit`
 * (Task 15.3, ADR-080, FR-007).
 *
 * Bridges Discord interactions and notifications to the Graywolf Control Plane
 * using TypeBox validation, constant-time HMAC-SHA256 verification via
 * `relay.readSecret('DISCORD_WEBHOOK_SECRET')`, and External Identity Binding.
 */

export const DiscordInteractionPayloadSchema = Type.Object({
  externalMessageId: Type.String({ minLength: 1 }),
  intentText: Type.String({ minLength: 1 }),
  actorExternalId: Type.String({ minLength: 1 }),
});

export type DiscordInteractionPayload = Static<
  typeof DiscordInteractionPayloadSchema
>;

export const DiscordOutboundNotifySchema = Type.Union([
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

function verifyDiscordHmac(
  rawBody: string,
  secret: string,
  sigHeader: string | undefined
): boolean {
  if (!sigHeader || !secret) return false;
  const cleanHex = sigHeader.trim().replace(/^sha256=/i, '');
  if (!/^[0-9a-f]{64}$/i.test(cleanHex)) return false;

  const expectedHex = crypto
    .createHmac('sha256', secret)
    .update(rawBody, 'utf8')
    .digest('hex');

  const bufA = Buffer.from(cleanHex.toLowerCase(), 'utf8');
  const bufB = Buffer.from(expectedHex.toLowerCase(), 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

export const discordCockpitAddon: CockpitAddon = {
  meta: {
    name: '@graywolf/addon-discord-cockpit',
    version: '1.0.0',
    description: 'Bridges Discord slash commands and approval buttons to Graywolf Cockpit.',
    requiredSecrets: ['DISCORD_WEBHOOK_SECRET'],
    platform: 'discord',
  },

  create(relay: GraywolfRelayContext): FastifyPluginAsync {
    return async (fastify) => {
      fastify.post('/addons/discord/interactions', async (request, reply) => {
        const secret = await relay.readSecret('DISCORD_WEBHOOK_SECRET');
        const sigHeader = request.headers['x-discord-signature-sha256'];
        const signature = Array.isArray(sigHeader) ? sigHeader[0] : sigHeader;
        const rawBody = JSON.stringify(request.body ?? {});

        if (!verifyDiscordHmac(rawBody, secret, signature)) {
          return reply.code(401).send({
            code: 'AUTH_SESSION_MISSING',
            message: 'Invalid or missing x-discord-signature-sha256 HMAC digest',
          });
        }

        if (!Value.Check(DiscordInteractionPayloadSchema, request.body)) {
          return reply.code(400).send({
            code: 'ACI_VALIDATION_FAILED',
            message: 'Invalid Discord interaction payload schema',
          });
        }

        const result = await relay.receiveHumanIntent(request.body);
        return reply.code(200).send(result);
      });

      fastify.post('/addons/discord/notify', async (request, reply) => {
        if (!Value.Check(DiscordOutboundNotifySchema, request.body)) {
          return reply.code(400).send({
            code: 'ACI_VALIDATION_FAILED',
            message: 'Invalid Discord outbound notification schema',
          });
        }

        const body = request.body;
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

        return reply.code(200).send({ delivered: true });
      });
    };
  },
};

