import crypto from 'node:crypto';
import pino from 'pino';
import { GraywolfAppError } from '../errors/taxonomy';
import { getValkeyStore } from './better-auth';

const logger = pino({ name: 'auth:tgt' });

export interface MintWsTicketInput {
  userId: string;
  workspaceId: string;
  role?: string;
  streamType: string;
  taskId?: string;
  ttlSeconds?: number;
}

export interface MintedWsTicket {
  ticket: string;
  ttlSeconds: number;
  graceSeconds: number;
  expiresAt: string;
}

export interface WsTicketPayload {
  ticket: string;
  userId: string;
  workspaceId: string;
  role?: string;
  streamType: string;
  taskId?: string;
  mintedAt: number;
  expiresAt: number;
}

export const TGT_CLIENT_TTL_SECONDS = 10;
export const TGT_SERVER_GRACE_SECONDS = 5;
export const TGT_TOMBSTONE_TTL_SECONDS = 60;

/**
 * Mints a single-use WebSocket Ticket-Granting Token (TGT).
 * Stores the ticket payload in Valkey with a 15-second TTL (10s client + 5s server grace).
 */
export async function mintWsTicket(input: MintWsTicketInput): Promise<MintedWsTicket> {
  const ticket = crypto.randomUUID();
  const clientTtl = input.ttlSeconds ?? TGT_CLIENT_TTL_SECONDS;
  const totalTtl = clientTtl <= 0 ? 0 : clientTtl + TGT_SERVER_GRACE_SECONDS;
  const now = Date.now();
  const expiresAtMs = now + clientTtl * 1000;

  const payload: WsTicketPayload = {
    ticket,
    userId: input.userId,
    workspaceId: input.workspaceId,
    role: input.role,
    streamType: input.streamType,
    taskId: input.taskId,
    mintedAt: now,
    expiresAt: expiresAtMs,
  };

  const store = getValkeyStore();
  await store.set(`tgt:${ticket}`, JSON.stringify(payload), 'EX', totalTtl);

  logger.debug(
    { ticket, streamType: input.streamType, taskId: input.taskId, totalTtl },
    'Minted WebSocket TGT'
  );

  return {
    ticket,
    ttlSeconds: clientTtl,
    graceSeconds: TGT_SERVER_GRACE_SECONDS,
    expiresAt: new Date(expiresAtMs).toISOString(),
  };
}

/**
 * Atomically consumes a WebSocket Ticket-Granting Token:
 * - Uses Valkey GETDEL (or atomic script) to retrieve and delete the ticket
 * - If found: records a 60-second tombstone key tgt_used:{ticket} and returns the payload
 * - If not found: checks for tombstone -> throws AUTH_TGT_ALREADY_USED (401) if tombstone exists,
 *   or AUTH_TGT_EXPIRED (401) if ticket expired or was never minted.
 */
export async function consumeWsTicket(ticket: string): Promise<WsTicketPayload> {
  if (!ticket || ticket.trim().length === 0) {
    throw new GraywolfAppError('AUTH_TGT_EXPIRED', 'WebSocket ticket is missing or empty');
  }

  const trimmedTicket = ticket.trim();
  const store = getValkeyStore();

  // 1. Atomically get and delete ticket
  const rawPayload = await store.getdel(`tgt:${trimmedTicket}`);

  if (rawPayload) {
    try {
      const payload = JSON.parse(rawPayload) as WsTicketPayload;
      if (payload.expiresAt + TGT_SERVER_GRACE_SECONDS * 1000 <= Date.now()) {
        throw new GraywolfAppError('AUTH_TGT_EXPIRED', 'WebSocket ticket has expired');
      }

      // Write 60-second tombstone to catch replays
      await store.set(`tgt_used:${trimmedTicket}`, '1', 'EX', TGT_TOMBSTONE_TTL_SECONDS);
      logger.debug({ ticket: trimmedTicket, streamType: payload.streamType }, 'Consumed WebSocket TGT');
      return payload;
    } catch (err) {
      if (err instanceof GraywolfAppError) throw err;
      logger.error({ err, ticket: trimmedTicket }, 'Failed to parse TGT payload');
      throw new GraywolfAppError('AUTH_TGT_EXPIRED', 'Invalid TGT payload format');
    }
  }

  // 2. Ticket not in Valkey: check for tombstone
  const isUsed = await store.get(`tgt_used:${trimmedTicket}`);
  if (isUsed) {
    logger.warn({ ticket: trimmedTicket }, 'Replay attack or duplicate TGT consumption detected');
    throw new GraywolfAppError('AUTH_TGT_ALREADY_USED', 'WebSocket ticket has already been used');
  }

  logger.warn({ ticket: trimmedTicket }, 'TGT expired or never minted');
  throw new GraywolfAppError('AUTH_TGT_EXPIRED', 'WebSocket ticket has expired or does not exist');
}
