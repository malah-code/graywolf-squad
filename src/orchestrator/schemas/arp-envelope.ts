import crypto from 'node:crypto';
import { Type, Static } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import { GraywolfAppError } from '../errors/taxonomy';
import { env } from '../config/env';

export const C2EMessageTypeSchema = Type.Union([
  Type.Literal('task.dispatch'),
  Type.Literal('task.cancel'),
  Type.Literal('task.inject'),
  Type.Literal('clarification.response'),
  Type.Literal('review.feedback'),
  Type.Literal('budget.warning'),
  Type.Literal('budget.exceeded'),
  Type.Literal('manifest.lock.granted'),
  Type.Literal('manifest.lock.rejected'),
  Type.Literal('heartbeat.ping'),
]);

export const E2CMessageTypeSchema = Type.Union([
  Type.Literal('status.update'),
  Type.Literal('event.stream'),
  Type.Literal('terminal.chunk'),
  Type.Literal('cost.delta'),
  Type.Literal('file.mutation'),
  Type.Literal('manifest.lock.acquire'),
  Type.Literal('manifest.lock.release'),
  Type.Literal('clarification.request'),
  Type.Literal('escalation.emit'),
  Type.Literal('artifact.ready'),
  Type.Literal('result.final'),
  Type.Literal('heartbeat.pong'),
]);

export const RelayMessageTypeSchema = Type.Union([
  C2EMessageTypeSchema,
  E2CMessageTypeSchema,
]);

export const RelayEnvelopeSchema = Type.Object(
  {
    v: Type.Literal(1),
    id: Type.String({ minLength: 1 }),
    ts: Type.String({ minLength: 1 }),
    taskId: Type.String({ pattern: '^TASK-[0-9A-Z-]+$' }),
    workspaceId: Type.String({ minLength: 1 }),
    direction: Type.Union([Type.Literal('c2e'), Type.Literal('e2c')]),
    type: RelayMessageTypeSchema,
    payload: Type.Record(Type.String(), Type.Unknown()),
    ack: Type.Optional(Type.String()),
    seq: Type.Optional(Type.Integer({ minimum: 1 })),
  },
  { additionalProperties: true }
);

export type C2EMessageType = Static<typeof C2EMessageTypeSchema>;
export type E2CMessageType = Static<typeof E2CMessageTypeSchema>;
export type RelayMessageType = Static<typeof RelayMessageTypeSchema>;
export type RelayEnvelope = Static<typeof RelayEnvelopeSchema>;

export function validateRelayEnvelope(raw: unknown): RelayEnvelope {
  if (!Value.Check(RelayEnvelopeSchema, raw)) {
    const errors = [...Value.Errors(RelayEnvelopeSchema, raw)].map((err) => ({
      path: err.path,
      message: err.message,
    }));
    throw new GraywolfAppError('ACI_VALIDATION_FAILED', 'Invalid RelayEnvelope format', {
      errors,
      raw,
    });
  }
  return raw as RelayEnvelope;
}

function base64UrlEncode(data: string | Buffer): string {
  const buf = typeof data === 'string' ? Buffer.from(data, 'utf8') : data;
  return buf
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function base64UrlDecode(str: string): string {
  let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4 !== 0) {
    base64 += '=';
  }
  return Buffer.from(base64, 'base64').toString('utf8');
}

export function mintRelayJwt(input: {
  taskId: string;
  workspaceId: string;
  ttlSeconds?: number;
  secret?: string;
}): string {
  const secret = input.secret ?? env.RELAY_JWT_SECRET;
  const now = Math.floor(Date.now() / 1000);
  const ttl = input.ttlSeconds ?? 300; // default 5 minutes

  const header = { alg: 'HS256', typ: 'JWT' };
  const payload = {
    taskId: input.taskId,
    workspaceId: input.workspaceId,
    iat: now,
    exp: now + ttl,
  };

  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const dataToSign = `${encodedHeader}.${encodedPayload}`;

  const signature = crypto
    .createHmac('sha256', secret)
    .update(dataToSign)
    .digest();
  const encodedSignature = base64UrlEncode(signature);

  return `${dataToSign}.${encodedSignature}`;
}

export function verifyRelayJwt(
  token: string,
  expectedTaskId?: string,
  secret?: string
): { taskId: string; workspaceId: string; exp: number } {
  if (!token || typeof token !== 'string') {
    throw new GraywolfAppError('AUTH_SESSION_MISSING', 'Relay JWT token is missing or empty');
  }

  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new GraywolfAppError('AUTH_SESSION_MISSING', 'Malformed Relay JWT format (expected 3 parts)');
  }

  const [encodedHeader, encodedPayload, encodedSignature] = parts;
  const signingSecret = secret ?? env.RELAY_JWT_SECRET;
  const dataToSign = `${encodedHeader}.${encodedPayload}`;

  const expectedSignatureBuf = crypto
    .createHmac('sha256', signingSecret)
    .update(dataToSign)
    .digest();
  const actualSignatureBuf = Buffer.from(
    encodedSignature.replace(/-/g, '+').replace(/_/g, '/'),
    'base64'
  );

  if (
    expectedSignatureBuf.length !== actualSignatureBuf.length ||
    !crypto.timingSafeEqual(expectedSignatureBuf, actualSignatureBuf)
  ) {
    throw new GraywolfAppError('AUTH_SESSION_MISSING', 'Invalid Relay JWT signature');
  }

  let payload: { taskId: string; workspaceId: string; iat?: number; exp?: number };
  try {
    payload = JSON.parse(base64UrlDecode(encodedPayload));
  } catch {
    throw new GraywolfAppError('AUTH_SESSION_MISSING', 'Failed to parse Relay JWT payload JSON');
  }

  if (!payload.taskId || !payload.exp) {
    throw new GraywolfAppError('AUTH_SESSION_MISSING', 'Relay JWT payload missing required claims');
  }

  if (payload.exp * 1000 <= Date.now()) {
    throw new GraywolfAppError(
      'AUTH_SESSION_EXPIRED',
      `Relay JWT token expired at ${new Date(payload.exp * 1000).toISOString()}`,
      { expiredAt: payload.exp }
    );
  }

  if (expectedTaskId && payload.taskId !== expectedTaskId) {
    throw new GraywolfAppError(
      'AUTH_SESSION_MISSING',
      `Relay JWT taskId '${payload.taskId}' does not match expected taskId '${expectedTaskId}'`,
      { tokenTaskId: payload.taskId, expectedTaskId }
    );
  }

  return {
    taskId: payload.taskId,
    workspaceId: payload.workspaceId,
    exp: payload.exp,
  };
}
