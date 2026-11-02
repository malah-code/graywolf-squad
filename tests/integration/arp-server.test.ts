import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import WebSocket from 'ws';
import type { AddressInfo } from 'node:net';
import { FastifyInstance } from 'fastify';
import {
  buildArpServer,
  getTaskReconstructionMetadata,
  resetTaskReconstructionMetadata,
} from '../../src/orchestrator/arp/server';
import {
  mintRelayJwt,
  RelayEnvelope,
} from '../../src/orchestrator/schemas/arp-envelope';

describe('ARP WebSocket Server & F14 Manifest Mutex Integration (US1)', () => {
  let arpServer: FastifyInstance;
  let arpPort: number;
  let testBaseDir: string;

  beforeEach(async () => {
    resetTaskReconstructionMetadata();
    testBaseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'graywolf-arp-test-'));
  });

  afterEach(async () => {
    if (arpServer) {
      await arpServer.close();
    }
    try {
      await fs.rm(testBaseDir, { recursive: true, force: true });
    } catch {
      // Ignore
    }
  });

  it('validates JWT handshake: succeeds on valid JWT, closes 4001 on invalid/expired, closes 4004 on unknown task', async () => {
    arpServer = buildArpServer({
      logger: false,
      requireAuth: true,
      validateTaskExists: (taskId) => taskId === 'TASK-EXISTS-1',
    });
    await arpServer.listen({ port: 0, host: '127.0.0.1' });
    arpPort = (arpServer.server.address() as AddressInfo).port;

    // 1. Valid handshake
    const validToken = mintRelayJwt({ taskId: 'TASK-EXISTS-1', workspaceId: 'ws-1' });
    const validWs = new WebSocket(`ws://127.0.0.1:${arpPort}/relay?taskId=TASK-EXISTS-1&token=${validToken}`);

    const handshakeAck = await new Promise<{ type: string; protocolVersion: string }>((resolve, reject) => {
      validWs.on('message', (data) => {
        resolve(JSON.parse(data.toString()));
      });
      validWs.on('error', reject);
    });

    expect(handshakeAck.type).toBe('arp.handshake.ack');
    validWs.close();

    // 2. Invalid signature token -> close 4001
    const invalidWs = new WebSocket(`ws://127.0.0.1:${arpPort}/relay?taskId=TASK-EXISTS-1&token=bad.jwt.token`);
    const closeCodeInvalid = await new Promise<number>((resolve) => {
      invalidWs.on('close', (code) => resolve(code));
    });
    expect(closeCodeInvalid).toBe(4001);

    // 3. Expired token -> close 4001
    const expiredToken = mintRelayJwt({ taskId: 'TASK-EXISTS-1', workspaceId: 'ws-1', ttlSeconds: -10 });
    const expiredWs = new WebSocket(`ws://127.0.0.1:${arpPort}/relay?taskId=TASK-EXISTS-1&token=${expiredToken}`);
    const closeCodeExpired = await new Promise<number>((resolve) => {
      expiredWs.on('close', (code) => resolve(code));
    });
    expect(closeCodeExpired).toBe(4001);

    // 4. Unknown task -> close 4004
    const unknownToken = mintRelayJwt({ taskId: 'TASK-UNKNOWN-9', workspaceId: 'ws-1' });
    const unknownWs = new WebSocket(`ws://127.0.0.1:${arpPort}/relay?taskId=TASK-UNKNOWN-9&token=${unknownToken}`);
    const closeCodeUnknown = await new Promise<number>((resolve) => {
      unknownWs.on('close', (code) => resolve(code));
    });
    expect(closeCodeUnknown).toBe(4004);
  });

  it('ingests file.mutation with fsync-before-ack, enforces idempotency on duplicate seq, and tracks reconstruction gaps', async () => {
    arpServer = buildArpServer({
      logger: false,
      baseDir: testBaseDir,
    });
    await arpServer.listen({ port: 0, host: '127.0.0.1' });
    arpPort = (arpServer.server.address() as AddressInfo).port;

    const taskId = 'TASK-MUTATION-1';
    const token = mintRelayJwt({ taskId, workspaceId: 'ws-100' });
    const ws = new WebSocket(`ws://127.0.0.1:${arpPort}/relay?taskId=${taskId}&token=${token}`);

    await new Promise<void>((resolve, reject) => {
      ws.on('open', () => resolve());
      ws.on('error', reject);
    });

    const sendEnvelopeAndWaitAck = (env: RelayEnvelope): Promise<RelayEnvelope> => {
      return new Promise((resolve) => {
        const handler = (data: WebSocket.Data) => {
          const parsed = JSON.parse(data.toString());
          if (parsed.ack === env.id) {
            ws.off('message', handler);
            resolve(parsed);
          }
        };
        ws.on('message', handler);
        ws.send(JSON.stringify(env));
      });
    };

    // Send Seq 1
    const mut1: RelayEnvelope = {
      v: 1,
      id: 'env-1',
      ts: new Date().toISOString(),
      taskId,
      workspaceId: 'ws-100',
      direction: 'e2c',
      type: 'file.mutation',
      payload: { path: 'src/index.ts', action: 'write', diff: '+console.log(1);' },
      seq: 1,
    };
    const ack1 = await sendEnvelopeAndWaitAck(mut1);
    expect(ack1.type).toBe('status.update');
    expect(ack1.payload.acked).toBe(true);
    expect(ack1.payload.duplicate).toBeUndefined();

    // Send Duplicate Seq 1
    const dupAck1 = await sendEnvelopeAndWaitAck(mut1);
    expect(dupAck1.payload.duplicate).toBe(true);

    // Send Seq 3 (missing seq 2)
    const mut3: RelayEnvelope = {
      v: 1,
      id: 'env-3',
      ts: new Date().toISOString(),
      taskId,
      workspaceId: 'ws-100',
      direction: 'e2c',
      type: 'file.mutation',
      payload: { path: 'src/utils.ts', action: 'write', diff: '+export const a = 1;' },
      seq: 3,
    };
    const ack3 = await sendEnvelopeAndWaitAck(mut3);
    expect(ack3.payload.acked).toBe(true);

    // Check gap detection
    const metaBefore = getTaskReconstructionMetadata(taskId);
    expect(metaBefore.reconstructionFidelity).toBe('gapped');
    expect(metaBefore.missingSequences).toEqual([2]);
    expect(metaBefore.salvagedFilesCount).toBe(2);

    // Send Seq 2 -> gap resolves to 'complete'
    const mut2: RelayEnvelope = {
      v: 1,
      id: 'env-2',
      ts: new Date().toISOString(),
      taskId,
      workspaceId: 'ws-100',
      direction: 'e2c',
      type: 'file.mutation',
      payload: { path: 'src/helper.ts', action: 'write', diff: '+export const b = 2;' },
      seq: 2,
    };
    await sendEnvelopeAndWaitAck(mut2);

    const metaAfter = getTaskReconstructionMetadata(taskId);
    expect(metaAfter.reconstructionFidelity).toBe('complete');
    expect(metaAfter.missingSequences).toEqual([]);
    expect(metaAfter.salvagedFilesCount).toBe(3);

    // Verify disk content contains exactly 3 entries (seq 1 only written once despite duplicate)
    const logPath = path.join(testBaseDir, taskId, 'ledger', 'mutation_stream.log');
    const content = await fs.readFile(logPath, 'utf8');
    const lines = content.trim().split('\n').filter(Boolean);
    expect(lines).toHaveLength(3);

    ws.close();
  });

  it('heartbeat monitor triggers 4010 and SANDBOX_HEARTBEAT_TIMEOUT after 3 missed pings', async () => {
    let timeoutTaskId = '';
    arpServer = buildArpServer({
      logger: false,
      heartbeatIntervalMs: 50, // fast heartbeat for tests
      onHeartbeatTimeout: (id) => {
        timeoutTaskId = id;
      },
    });
    await arpServer.listen({ port: 0, host: '127.0.0.1' });
    arpPort = (arpServer.server.address() as AddressInfo).port;

    const taskId = 'TASK-HEARTBEAT-1';
    const token = mintRelayJwt({ taskId, workspaceId: 'ws-1' });
    const ws = new WebSocket(`ws://127.0.0.1:${arpPort}/relay?taskId=${taskId}&token=${token}`);

    // Receive pings but DO NOT reply with pong
    let pingCount = 0;
    ws.on('message', (data) => {
      try {
        const parsed = JSON.parse(data.toString());
        if (parsed.type === 'heartbeat.ping') {
          pingCount++;
        }
      } catch {
        // Ignore
      }
    });

    const closeCode = await new Promise<number>((resolve) => {
      ws.on('close', (code) => resolve(code));
    });

    expect(pingCount).toBeGreaterThanOrEqual(3);
    expect(closeCode).toBe(4010);
    expect(timeoutTaskId).toBe(taskId);
  });

  it('F14 manifest.lock.acquire grants lock, rejects contender on timeout, and grants after release', async () => {
    arpServer = buildArpServer({
      logger: false,
    });
    await arpServer.listen({ port: 0, host: '127.0.0.1' });
    arpPort = (arpServer.server.address() as AddressInfo).port;

    const tokenA = mintRelayJwt({ taskId: 'TASK-A', workspaceId: 'ws-alpha' });
    const wsA = new WebSocket(`ws://127.0.0.1:${arpPort}/relay?taskId=TASK-A&token=${tokenA}`);

    const tokenB = mintRelayJwt({ taskId: 'TASK-B', workspaceId: 'ws-alpha' });
    const wsB = new WebSocket(`ws://127.0.0.1:${arpPort}/relay?taskId=TASK-B&token=${tokenB}`);

    await Promise.all([
      new Promise<void>((res) => wsA.on('open', () => res())),
      new Promise<void>((res) => wsB.on('open', () => res())),
    ]);

    const sendEnvelope = (ws: WebSocket, env: RelayEnvelope): Promise<RelayEnvelope> => {
      return new Promise((resolve) => {
        const handler = (data: WebSocket.Data) => {
          const parsed = JSON.parse(data.toString());
          if (parsed.ack === env.id) {
            ws.off('message', handler);
            resolve(parsed);
          }
        };
        ws.on('message', handler);
        ws.send(JSON.stringify(env));
      });
    };

    // 1. Task A acquires manifest lock
    const acquireA: RelayEnvelope = {
      v: 1,
      id: 'acq-a',
      ts: new Date().toISOString(),
      taskId: 'TASK-A',
      workspaceId: 'ws-alpha',
      direction: 'e2c',
      type: 'manifest.lock.acquire',
      payload: { manifestPath: 'package.json', timeoutMs: 100, leaseTtlMs: 5000 },
    };
    const resA = await sendEnvelope(wsA, acquireA);
    expect(resA.type).toBe('manifest.lock.granted');
    const lockTokenA = String(resA.payload.lockToken);
    expect(lockTokenA).toBeDefined();

    // 2. Task B attempts to acquire while locked with short timeout (100ms) -> rejected
    const acquireB: RelayEnvelope = {
      v: 1,
      id: 'acq-b',
      ts: new Date().toISOString(),
      taskId: 'TASK-B',
      workspaceId: 'ws-alpha',
      direction: 'e2c',
      type: 'manifest.lock.acquire',
      payload: { manifestPath: 'package.json', timeoutMs: 100, leaseTtlMs: 5000 },
    };
    const resB = await sendEnvelope(wsB, acquireB);
    expect(resB.type).toBe('manifest.lock.rejected');

    // 3. Task A releases lock
    const releaseA: RelayEnvelope = {
      v: 1,
      id: 'rel-a',
      ts: new Date().toISOString(),
      taskId: 'TASK-A',
      workspaceId: 'ws-alpha',
      direction: 'e2c',
      type: 'manifest.lock.release',
      payload: { manifestPath: 'package.json', lockToken: lockTokenA },
    };
    const relResA = await sendEnvelope(wsA, releaseA);
    expect(relResA.payload.released).toBe(true);

    // 4. Task B can now acquire successfully
    const acquireB2: RelayEnvelope = {
      v: 1,
      id: 'acq-b-2',
      ts: new Date().toISOString(),
      taskId: 'TASK-B',
      workspaceId: 'ws-alpha',
      direction: 'e2c',
      type: 'manifest.lock.acquire',
      payload: { manifestPath: 'package.json', timeoutMs: 200, leaseTtlMs: 5000 },
    };
    const resB2 = await sendEnvelope(wsB, acquireB2);
    expect(resB2.type).toBe('manifest.lock.granted');

    wsA.close();
    wsB.close();
  });
});
