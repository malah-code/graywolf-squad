import { describe, it, expect, beforeEach } from 'vitest';
import {
  mintWsTicket,
  consumeWsTicket,
  TGT_CLIENT_TTL_SECONDS,
  TGT_SERVER_GRACE_SECONDS,
} from '../../src/orchestrator/auth/tgt';
import {
  setValkeyClient,
  InMemoryValkeyStore,
} from '../../src/orchestrator/auth/better-auth';
import { GraywolfAppError } from '../../src/orchestrator/errors/taxonomy';

describe('Single-Use WebSocket Ticket-Granting Token (TGT) (Unit Tests)', () => {
  let memoryStore: InMemoryValkeyStore;

  beforeEach(() => {
    memoryStore = new InMemoryValkeyStore();
    setValkeyClient(memoryStore);
  });

  it('mints a valid WebSocket ticket with 10s client TTL and 5s server grace', async () => {
    const minted = await mintWsTicket({
      userId: '11111111-1111-1111-1111-111111111111',
      workspaceId: '22222222-2222-2222-2222-222222222222',
      role: 'developer',
      streamType: 'logs',
      taskId: 'TASK-101',
    });

    expect(minted.ticket).toBeDefined();
    expect(minted.ttlSeconds).toBe(TGT_CLIENT_TTL_SECONDS);
    expect(minted.graceSeconds).toBe(TGT_SERVER_GRACE_SECONDS);
    expect(new Date(minted.expiresAt).getTime()).toBeGreaterThan(Date.now());
  });

  it('consumes a valid ticket on first use and returns the ticket payload', async () => {
    const minted = await mintWsTicket({
      userId: 'u_12345',
      workspaceId: 'ws_67890',
      role: 'developer',
      streamType: 'xterm',
      taskId: 'TASK-202',
    });

    const payload = await consumeWsTicket(minted.ticket);

    expect(payload.ticket).toBe(minted.ticket);
    expect(payload.userId).toBe('u_12345');
    expect(payload.workspaceId).toBe('ws_67890');
    expect(payload.role).toBe('developer');
    expect(payload.streamType).toBe('xterm');
    expect(payload.taskId).toBe('TASK-202');
  });

  it('throws AUTH_TGT_ALREADY_USED (401) on immediate replay attempt', async () => {
    const minted = await mintWsTicket({
      userId: 'u_12345',
      workspaceId: 'ws_67890',
      streamType: 'telemetry',
    });

    // 1st consumption: success
    const firstUse = await consumeWsTicket(minted.ticket);
    expect(firstUse).toBeDefined();

    // 2nd consumption: replay rejection
    try {
      await consumeWsTicket(minted.ticket);
      expect.unreachable('Expected AUTH_TGT_ALREADY_USED error');
    } catch (err) {
      expect(err).toBeInstanceOf(GraywolfAppError);
      const appErr = err as GraywolfAppError;
      expect(appErr.code).toBe('AUTH_TGT_ALREADY_USED');
      expect(appErr.httpStatus).toBe(401);
      expect(appErr.retryable).toBe(false);
    }
  });

  it('throws AUTH_TGT_EXPIRED (401) when consuming an unminted ticket', async () => {
    try {
      await consumeWsTicket('00000000-0000-0000-0000-000000000000');
      expect.unreachable('Expected AUTH_TGT_EXPIRED error');
    } catch (err) {
      expect(err).toBeInstanceOf(GraywolfAppError);
      const appErr = err as GraywolfAppError;
      expect(appErr.code).toBe('AUTH_TGT_EXPIRED');
      expect(appErr.httpStatus).toBe(401);
      expect(appErr.retryable).toBe(true);
    }
  });

  it('throws AUTH_TGT_EXPIRED (401) when ticket has expired in Valkey', async () => {
    const minted = await mintWsTicket({
      userId: 'u_expired',
      workspaceId: 'ws_expired',
      streamType: 'logs',
      ttlSeconds: -1, // Expired immediately
    });

    try {
      await consumeWsTicket(minted.ticket);
      expect.unreachable('Expected AUTH_TGT_EXPIRED error');
    } catch (err) {
      expect(err).toBeInstanceOf(GraywolfAppError);
      const appErr = err as GraywolfAppError;
      expect(appErr.code).toBe('AUTH_TGT_EXPIRED');
      expect(appErr.httpStatus).toBe(401);
      expect(appErr.retryable).toBe(true);
    }
  });

  it('throws AUTH_TGT_EXPIRED when ticket string is missing or empty', async () => {
    await expect(consumeWsTicket('')).rejects.toMatchObject({
      code: 'AUTH_TGT_EXPIRED',
      httpStatus: 401,
    });
    await expect(consumeWsTicket('   ')).rejects.toMatchObject({
      code: 'AUTH_TGT_EXPIRED',
      httpStatus: 401,
    });
  });
});
