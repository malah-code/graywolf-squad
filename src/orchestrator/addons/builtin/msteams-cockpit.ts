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
 * First-Party Official Addon: `@graywolf/addon-msteams-cockpit`
 * (Task 18.3, ADR-080, PRD §17.8, FR-007, FR-008, FR-009, SC-005, SC-006).
 *
 * Bridges Microsoft Teams Adaptive Cards v1.5 buttons and outgoing webhooks to the
 * Graywolf Cockpit with HMAC-SHA256 signature verification, Azure AD identity binding,
 * and RBAC-controlled intent dispatch.
 */

export const MsTeamsInteractionPayloadSchema = Type.Union([
  Type.Object({
    externalMessageId: Type.String({ minLength: 1 }),
    intentText: Type.String({ minLength: 1 }),
    actorExternalId: Type.String({ minLength: 1 }),
  }),
  Type.Object({
    type: Type.Literal('message'),
    id: Type.String({ minLength: 1 }),
    from: Type.Object({
      id: Type.String({ minLength: 1 }),
      name: Type.Optional(Type.String()),
      aadObjectId: Type.Optional(Type.String({ minLength: 1 })),
    }),
    value: Type.Object({
      intentText: Type.String({ minLength: 1 }),
      taskId: Type.Optional(Type.String()),
    }),
  }),
]);

export type MsTeamsInteractionPayload = Static<
  typeof MsTeamsInteractionPayloadSchema
>;

export const MsTeamsOutboundNotifySchema = Type.Union([
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

export type MsTeamsOutboundNotify = Static<typeof MsTeamsOutboundNotifySchema>;

export interface MsTeamsAdaptiveCard {
  type: 'AdaptiveCard';
  $schema: string;
  version: '1.5';
  body: Array<Record<string, unknown>>;
  actions: Array<Record<string, unknown>>;
}

/**
 * Validates Microsoft Teams HMAC-SHA256 signature header.
 * Supports:
 * - `authorization: HMAC <base64>` (native Teams outgoing webhook)
 * - `x-msteams-signature-sha256: <hex>` (Graywolf test / webhook gateway)
 * - Base64 encoded digest string
 */
export function verifyMsTeamsSignature(
  rawBody: string,
  secret: string,
  sigHeader: string | undefined
): boolean {
  if (!sigHeader || !secret) return false;
  const clean = sigHeader.trim();

  // Case A: Authorization: HMAC <base64>
  if (/^HMAC\s+/i.test(clean)) {
    const providedB64 = clean.replace(/^HMAC\s+/i, '').trim();
    const hmacBuf = crypto
      .createHmac('sha256', secret)
      .update(rawBody, 'utf8')
      .digest();
    const expectedB64 = hmacBuf.toString('base64');
    const bufA = Buffer.from(providedB64, 'utf8');
    const bufB = Buffer.from(expectedB64, 'utf8');
    if (bufA.length !== bufB.length) return false;
    return crypto.timingSafeEqual(bufA, bufB);
  }

  // Case B: Hex digest header (e.g. x-msteams-signature-sha256: <hex>)
  const cleanHex = clean.replace(/^sha256=/i, '');
  if (/^[0-9a-f]{64}$/i.test(cleanHex)) {
    const expectedHex = crypto
      .createHmac('sha256', secret)
      .update(rawBody, 'utf8')
      .digest('hex');
    const bufA = Buffer.from(cleanHex.toLowerCase(), 'utf8');
    const bufB = Buffer.from(expectedHex.toLowerCase(), 'utf8');
    if (bufA.length !== bufB.length) return false;
    return crypto.timingSafeEqual(bufA, bufB);
  }

  // Case C: Base64 digest string
  try {
    const hmacBuf = crypto
      .createHmac('sha256', secret)
      .update(rawBody, 'utf8')
      .digest();
    const expectedB64 = hmacBuf.toString('base64');
    const bufA = Buffer.from(clean, 'utf8');
    const bufB = Buffer.from(expectedB64, 'utf8');
    if (bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB)) {
      return true;
    }
  } catch {
    return false;
  }

  return false;
}

/**
 * Formats Task Briefs and Escalations as Microsoft Teams Adaptive Cards v1.5 JSON.
 */
export function buildMsTeamsAdaptiveCard(
  input: MsTeamsOutboundNotify
): MsTeamsAdaptiveCard {
  if (input.kind === 'brief') {
    return {
      type: 'AdaptiveCard',
      $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
      version: '1.5',
      body: [
        {
          type: 'TextBlock',
          size: 'Medium',
          weight: 'Bolder',
          text: `[Task Brief] ${input.taskId}: ${input.title}`,
        },
        {
          type: 'FactSet',
          facts: [
            { title: 'Task ID', value: input.taskId },
            { title: 'Severity', value: input.severity.toUpperCase() },
          ],
        },
        {
          type: 'TextBlock',
          text: input.summaryMarkdown,
          wrap: true,
        },
      ],
      actions: [
        {
          type: 'Action.Submit',
          title: 'Approve',
          style: 'positive',
          data: {
            intentText: `approve ${input.taskId}`,
            taskId: input.taskId,
          },
        },
        {
          type: 'Action.Submit',
          title: 'Reject',
          style: 'destructive',
          data: {
            intentText: `reject ${input.taskId}`,
            taskId: input.taskId,
          },
        },
        ...input.links.map((link) => ({
          type: 'Action.OpenUrl',
          title: link.label,
          url: link.url,
        })),
      ],
    };
  }

  return {
    type: 'AdaptiveCard',
    $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
    version: '1.5',
    body: [
      {
        type: 'TextBlock',
        size: 'Large',
        weight: 'Bolder',
        color: 'Attention',
        text: `CRITICAL ESCALATION: ${input.taskId}`,
      },
      {
        type: 'TextBlock',
        text: `**Reason**: ${input.reason}`,
        wrap: true,
      },
    ],
    actions: [
      {
        type: 'Action.Submit',
        title: 'Approve Override',
        style: 'positive',
        data: {
          intentText: `approve ${input.taskId}`,
          taskId: input.taskId,
        },
      },
      {
        type: 'Action.Submit',
        title: 'Confirm Rejection',
        style: 'destructive',
        data: {
          intentText: `reject ${input.taskId}`,
          taskId: input.taskId,
        },
      },
      {
        type: 'Action.OpenUrl',
        title: 'View Evidence Ledger',
        url: input.evidenceLedgerUrl,
      },
    ],
  };
}

export const msteamsCockpitAddon: CockpitAddon = {
  meta: {
    name: '@graywolf/addon-msteams-cockpit',
    version: '1.0.0',
    description: 'Bridges Microsoft Teams Adaptive Cards and webhooks to Graywolf Cockpit.',
    requiredSecrets: ['MSTEAMS_WEBHOOK_SECRET'],
    platform: 'msteams',
  },

  create(relay: GraywolfRelayContext): FastifyPluginAsync {
    return async (fastify) => {
      fastify.post('/addons/msteams/interactions', async (request, reply) => {
        const secret = await relay.readSecret('MSTEAMS_WEBHOOK_SECRET');
        const sigHeader =
          request.headers['x-msteams-signature-sha256'] ??
          request.headers['authorization'] ??
          request.headers['x-signature-sha256'];
        const signature = Array.isArray(sigHeader) ? sigHeader[0] : sigHeader;
        const rawBody = JSON.stringify(request.body ?? {});

        if (!verifyMsTeamsSignature(rawBody, secret, signature)) {
          return reply.code(401).send({
            code: 'AUTH_SESSION_MISSING',
            message: 'Invalid or missing Microsoft Teams webhook signature',
          });
        }

        if (!Value.Check(MsTeamsInteractionPayloadSchema, request.body)) {
          return reply.code(400).send({
            code: 'ACI_VALIDATION_FAILED',
            message: 'Invalid Microsoft Teams interaction payload schema',
          });
        }

        const body = request.body as MsTeamsInteractionPayload;
        let normalizedInteraction: {
          externalMessageId: string;
          intentText: string;
          actorExternalId: string;
        };

        if ('type' in body && body.type === 'message') {
          const actorExternalId = body.from.aadObjectId || body.from.id;
          normalizedInteraction = {
            externalMessageId: body.id,
            intentText: body.value.intentText,
            actorExternalId,
          };
        } else if ('externalMessageId' in body) {
          normalizedInteraction = {
            externalMessageId: body.externalMessageId,
            intentText: body.intentText,
            actorExternalId: body.actorExternalId,
          };
        } else {
          return reply.code(400).send({
            code: 'ACI_VALIDATION_FAILED',
            message: 'Invalid Microsoft Teams interaction payload schema',
          });
        }

        const result = await relay.receiveHumanIntent(normalizedInteraction);
        return reply.code(200).send(result);
      });

      fastify.post('/addons/msteams/notify', async (request, reply) => {
        if (!Value.Check(MsTeamsOutboundNotifySchema, request.body)) {
          return reply.code(400).send({
            code: 'ACI_VALIDATION_FAILED',
            message: 'Invalid Microsoft Teams outbound notify payload schema',
          });
        }

        const body = request.body;
        if (body.kind === 'brief') {
          await relay.postTaskBrief({
            taskId: body.taskId,
            title: body.title,
            summaryMarkdown: body.summaryMarkdown,
            severity: body.severity as GraywolfSignalEnvelope['severity'],
            links: body.links.map((link) => ({
              label: link.label,
              url: link.url,
            })),
          });
        } else {
          await relay.postEscalation({
            taskId: body.taskId,
            reason: body.reason,
            evidenceLedgerUrl: body.evidenceLedgerUrl,
          });
        }

        const adaptiveCard = buildMsTeamsAdaptiveCard(body);
        return reply.code(200).send({
          delivered: true,
          adaptiveCard,
        });
      });
    };
  },
};
