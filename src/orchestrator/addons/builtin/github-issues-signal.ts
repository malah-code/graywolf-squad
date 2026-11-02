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
 * First-Party Official Reference Addon: `@graywolf/addon-github-issues`
 * (Task 15.3, ADR-080, FR-007).
 *
 * Uses TypeBox webhook validation and constant-time HMAC-SHA256 verification
 * via `relay.readSecret('GITHUB_WEBHOOK_HMAC_SECRET')` with zero background timer calls.
 */

export const GitHubIssuesWebhookPayloadSchema = Type.Object({
  action: Type.String(),
  issue: Type.Object({
    number: Type.Integer({ minimum: 1 }),
    title: Type.String({ minLength: 1 }),
    body: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    html_url: Type.String({ minLength: 1 }),
    created_at: Type.Optional(Type.String()),
    labels: Type.Optional(
      Type.Array(
        Type.Object({
          name: Type.String(),
        })
      )
    ),
  }),
});

export type GitHubIssuesWebhookPayload = Static<
  typeof GitHubIssuesWebhookPayloadSchema
>;

function verifyGitHubHmac(
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

export const githubIssuesSignalAddon: SignalAddon = {
  meta: {
    name: '@graywolf/addon-github-issues',
    version: '1.0.0',
    description: 'Ingests GitHub issue webhooks as bug-report or feature signals.',
    requiredSecrets: ['GITHUB_WEBHOOK_HMAC_SECRET'],
    requiresPolling: false,
  },

  create(relay: GraywolfRelayContext): FastifyPluginAsync {
    return async (fastify) => {
      fastify.post('/addons/github-issues/webhook', async (request, reply) => {
        const secret = await relay.readSecret('GITHUB_WEBHOOK_HMAC_SECRET');
        const sigHeader = request.headers['x-hub-signature-256'];
        const signature = Array.isArray(sigHeader) ? sigHeader[0] : sigHeader;
        const rawBody = JSON.stringify(request.body ?? {});

        if (!verifyGitHubHmac(rawBody, secret, signature)) {
          return reply.code(401).send({
            code: 'AUTH_SESSION_MISSING',
            message: 'Invalid or missing x-hub-signature-256 HMAC digest',
          });
        }

        if (!Value.Check(GitHubIssuesWebhookPayloadSchema, request.body)) {
          return reply.code(400).send({
            code: 'ACI_VALIDATION_FAILED',
            message: 'Invalid GitHub Issues webhook payload schema',
          });
        }

        const payload = request.body;
        const labelNames = (payload.issue.labels ?? []).map((l) =>
          l.name.toLowerCase()
        );
        const isBug = labelNames.some((n) => n.includes('bug') || n.includes('crash'));
        const kind: GraywolfSignalEnvelope['kind'] = isBug
          ? 'bug-report'
          : 'feature';
        const nowIso = new Date().toISOString();

        const envelope: GraywolfSignalEnvelope = {
          id: crypto.randomUUID(),
          source: '@graywolf/addon-github-issues',
          kind,
          title: payload.issue.title.slice(0, 200),
          description: (payload.issue.body ?? '').slice(0, 4096),
          links: [{ label: `GitHub #${payload.issue.number}`, url: payload.issue.html_url }],
          severity: isBug ? 'high' : 'medium',
          occurredAt: payload.issue.created_at ?? nowIso,
          ingestedAt: nowIso,
          raw: rawBody.slice(0, 65536),
          meta: {
            fingerprint: `github-issue-${payload.issue.number}`,
            issueNumber: payload.issue.number,
            action: payload.action,
          },
        };

        const result = await relay.submitSignal(envelope);
        return reply.code(202).send(result);
      });
    };
  },
};

