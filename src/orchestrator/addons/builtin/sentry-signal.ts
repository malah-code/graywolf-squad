import * as crypto from 'node:crypto';
import { Type, type Static } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import { type FastifyPluginAsync } from 'fastify';
import {
  type GraywolfRelayContext,
  type GraywolfSignalEnvelope,
  type SignalAddon,
} from '../sdk';

/**
 * First-Party Official Reference Addon: `@graywolf/addon-sentry`
 * (Task 15.3, ADR-080, FR-007).
 *
 * Uses TypeBox webhook validation and constant-time HMAC-SHA256 verification
 * via `relay.readSecret('SENTRY_WEBHOOK_HMAC_SECRET')` with zero vendor error-SDK imports
 * and zero background timer calls.
 */

export const SentryWebhookPayloadSchema = Type.Object({
  action: Type.Optional(Type.String()),
  data: Type.Object({
    issue: Type.Object({
      id: Type.String({ minLength: 1 }),
      title: Type.String({ minLength: 1 }),
      culprit: Type.Optional(Type.String()),
      level: Type.Optional(Type.String()),
      permalink: Type.Optional(Type.String()),
      firstSeen: Type.Optional(Type.String()),
    }),
  }),
});

export type SentryWebhookPayload = Static<typeof SentryWebhookPayloadSchema>;

function verifyHmacSha256Hex(
  rawBody: string,
  secret: string,
  providedHex: string | undefined
): boolean {
  if (!providedHex || !secret) return false;
  const cleanHex = providedHex.trim().replace(/^sha256=/i, '');
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

function mapSentryLevelToSeverity(
  level: string | undefined
): GraywolfSignalEnvelope['severity'] {
  switch ((level ?? '').toLowerCase()) {
    case 'fatal':
      return 'critical';
    case 'error':
      return 'high';
    case 'warning':
      return 'medium';
    case 'info':
    case 'debug':
      return 'low';
    default:
      return 'high';
  }
}

export const sentrySignalAddon: SignalAddon = {
  meta: {
    name: '@graywolf/addon-sentry',
    version: '1.0.0',
    description: 'Ingests Sentry crash and exception webhooks into Graywolf Kanban triage.',
    requiredSecrets: ['SENTRY_WEBHOOK_HMAC_SECRET'],
    requiresPolling: false,
  },

  create(relay: GraywolfRelayContext): FastifyPluginAsync {
    return async (fastify) => {
      fastify.post('/addons/sentry/webhook', async (request, reply) => {
        const secret = await relay.readSecret('SENTRY_WEBHOOK_HMAC_SECRET');
        const sigHeader = request.headers['x-sentry-hook-signature'];
        const signature = Array.isArray(sigHeader) ? sigHeader[0] : sigHeader;
        const rawBody = JSON.stringify(request.body ?? {});

        if (!verifyHmacSha256Hex(rawBody, secret, signature)) {
          return reply.code(401).send({
            code: 'AUTH_SESSION_MISSING',
            message: 'Invalid or missing x-sentry-hook-signature HMAC digest',
          });
        }

        if (!Value.Check(SentryWebhookPayloadSchema, request.body)) {
          return reply.code(400).send({
            code: 'ACI_VALIDATION_FAILED',
            message: 'Invalid Sentry webhook payload schema',
          });
        }

        const payload = request.body;
        const issue = payload.data.issue;
        const nowIso = new Date().toISOString();

        const envelope: GraywolfSignalEnvelope = {
          id: crypto.randomUUID(),
          source: '@graywolf/addon-sentry',
          kind: 'crash',
          title: issue.title.slice(0, 200),
          description: [
            `**Sentry Issue ID**: \`${issue.id}\``,
            issue.culprit ? `**Culprit**: \`${issue.culprit}\`` : '',
          ]
            .filter(Boolean)
            .join('\n')
            .slice(0, 4096),
          links: issue.permalink
            ? [{ label: 'Sentry Issue', url: issue.permalink }]
            : [],
          severity: mapSentryLevelToSeverity(issue.level),
          occurredAt: issue.firstSeen ?? nowIso,
          ingestedAt: nowIso,
          raw: rawBody.slice(0, 65536),
          meta: {
            fingerprint: `sentry-issue-${issue.id}`,
            sentryIssueId: issue.id,
          },
        };

        const result = await relay.submitSignal(envelope);
        return reply.code(202).send(result);
      });
    };
  },
};

