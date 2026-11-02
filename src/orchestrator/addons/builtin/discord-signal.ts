import * as crypto from 'node:crypto';
import { Type, type Static } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import { type FastifyPluginAsync } from 'fastify';
import {
  computeSignalFingerprint,
  type GraywolfRelayContext,
  type GraywolfSignalEnvelope,
  type SignalAddon,
} from '../sdk';

/**
 * First-Party Official Addon: `@graywolf/addon-discord-signal`
 * (Task 18.2, ADR-044, ADR-080, PRD §17.8, FR-004, FR-005, FR-006, SC-003, SC-004).
 *
 * Ingests bug, crash, and triage signals from Discord webhooks into the Graywolf
 * Relay pipeline with HMAC-SHA256 signature verification, untrusted XML payload
 * wrapping, and 180s Valkey deduplication.
 */

export const DiscordSignalWebhookPayloadSchema = Type.Object({
  channelId: Type.String({ minLength: 1 }),
  messageId: Type.String({ minLength: 1 }),
  threadId: Type.Optional(Type.String({ minLength: 1 })),
  content: Type.String({ minLength: 1, maxLength: 8192 }),
  author: Type.Object({
    id: Type.String({ minLength: 1 }),
    username: Type.String({ minLength: 1 }),
  }),
  kind: Type.Optional(
    Type.Union([
      Type.Literal('crash'),
      Type.Literal('bug-report'),
      Type.Literal('feature'),
      Type.Literal('community'),
      Type.Literal('custom'),
    ])
  ),
  severity: Type.Optional(
    Type.Union([
      Type.Literal('critical'),
      Type.Literal('high'),
      Type.Literal('medium'),
      Type.Literal('low'),
      Type.Literal('unknown'),
    ])
  ),
  rawMessage: Type.Optional(
    Type.Record(
      Type.String(),
      Type.Union([Type.String(), Type.Number(), Type.Boolean(), Type.Null()])
    )
  ),
});

export type DiscordSignalWebhookPayload = Static<
  typeof DiscordSignalWebhookPayloadSchema
>;

/**
 * Verifies Discord HMAC-SHA256 signature header (`x-discord-signature-sha256`,
 * `x-signature-sha256`, or `x-discord-signature`) in constant time.
 */
export function verifyDiscordSignature(
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

export const discordSignalAddon: SignalAddon = {
  meta: {
    name: '@graywolf/addon-discord-signal',
    version: '1.0.0',
    description: 'Ingests bug/crash signals from Discord channels and webhooks.',
    requiredSecrets: ['DISCORD_SIGNAL_SECRET'],
    requiresPolling: false,
  },

  create(relay: GraywolfRelayContext): FastifyPluginAsync {
    return async (fastify) => {
      fastify.post('/addons/discord-signal/webhook', async (request, reply) => {
        const secret = await relay.readSecret('DISCORD_SIGNAL_SECRET');
        const sigHeader =
          request.headers['x-discord-signature-sha256'] ??
          request.headers['x-signature-sha256'] ??
          request.headers['x-discord-signature'];
        const signature = Array.isArray(sigHeader) ? sigHeader[0] : sigHeader;
        const rawBody = JSON.stringify(request.body ?? {});

        if (!verifyDiscordSignature(rawBody, secret, signature)) {
          return reply.code(401).send({
            code: 'AUTH_SESSION_MISSING',
            message: 'Invalid or missing Discord webhook signature',
          });
        }

        if (!Value.Check(DiscordSignalWebhookPayloadSchema, request.body)) {
          return reply.code(400).send({
            code: 'ACI_VALIDATION_FAILED',
            message: 'Invalid Discord signal webhook payload schema',
          });
        }

        const payload = request.body;
        const nowIso = new Date().toISOString();
        const firstLine =
          payload.content
            .split('\n')
            .map((line) => line.trim())
            .find((line) => line.length > 0) || 'Discord Signal';
        const title = firstLine.slice(0, 200);

        const description = [
          `**Discord Author**: ${payload.author.username} (\`${payload.author.id}\`)`,
          `**Channel ID**: \`${payload.channelId}\``,
          payload.threadId ? `**Thread ID**: \`${payload.threadId}\`` : '',
          '',
          payload.content,
        ]
          .filter(Boolean)
          .join('\n')
          .slice(0, 4096);

        const targetId = payload.threadId ?? payload.messageId;
        const linkUrl = `https://discord.com/channels/${encodeURIComponent(payload.channelId)}/${encodeURIComponent(targetId)}`;

        const fingerprint = payload.threadId
          ? `discord-thread-${payload.threadId}`
          : `discord-msg-${payload.channelId}-${payload.messageId}`;

        const envelope: GraywolfSignalEnvelope = {
          id: crypto.randomUUID(),
          source: '@graywolf/addon-discord-signal',
          kind: payload.kind ?? 'bug-report',
          title,
          description,
          links: [{ label: 'Discord Message', url: linkUrl }],
          severity: payload.severity ?? 'medium',
          occurredAt: nowIso,
          ingestedAt: nowIso,
          raw: rawBody.slice(0, 65536),
          meta: {
            fingerprint,
            discordChannelId: payload.channelId,
            discordMessageId: payload.messageId,
            discordThreadId: payload.threadId ?? null,
          },
        };

        const fingerprintHash = computeSignalFingerprint(envelope);
        const result = await relay.submitSignal(envelope);

        return reply.code(202).send({
          ...result,
          fingerprintHash,
        });
      });
    };
  },
};

