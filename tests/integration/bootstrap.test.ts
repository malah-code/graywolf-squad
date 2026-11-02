import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import WebSocket from 'ws';
import type { AddressInfo } from 'node:net';
import { buildApp } from '../../src/orchestrator/app';
import { buildArpServer } from '../../src/orchestrator/arp/server';
import { startServers } from '../../src/orchestrator/index';
import { FastifyInstance } from 'fastify';

interface ArpHandshakeAck {
  type: string;
  protocolVersion: string;
  timestamp: string;
}

describe('Dual-Port Orchestrator Bootstrap & Health Integration', () => {
  let controlPlane: FastifyInstance;
  let arpServer: FastifyInstance;
  let controlPort: number;
  let arpPort: number;

  beforeAll(async () => {
    // Build instances with ephemeral free ports (port 0)
    controlPlane = buildApp({
      logger: false,
    });
    arpServer = buildArpServer({
      logger: false,
    });

    const controlAddress = await controlPlane.listen({ port: 0, host: '127.0.0.1' });
    const arpAddress = await arpServer.listen({ port: 0, host: '127.0.0.1' });

    controlPort = (controlPlane.server.address() as AddressInfo).port;
    arpPort = (arpServer.server.address() as AddressInfo).port;

    expect(controlAddress).toBeDefined();
    expect(arpAddress).toBeDefined();
    expect(controlPort).toBeGreaterThan(0);
    expect(arpPort).toBeGreaterThan(0);
  });

  afterAll(async () => {
    await Promise.all([controlPlane.close(), arpServer.close()]);
  });

  it('GET /health on Control Plane returns 200 OK with timestamp', async () => {
    const res = await controlPlane.inject({
      method: 'GET',
      url: '/health',
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload) as { ok: boolean; timestamp: string };
    expect(body.ok).toBe(true);
    expect(body.timestamp).toBeDefined();
  });

  it('GET /api/v1/healthz on Control Plane returns 200 OK with timestamp', async () => {
    const res = await controlPlane.inject({
      method: 'GET',
      url: '/api/v1/healthz',
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload) as { ok: boolean; timestamp: string };
    expect(body.ok).toBe(true);
    expect(body.timestamp).toBeDefined();
  });

  it('connects to ARP WebSocket on /relay and receives handshake ack', async () => {
    const wsUrl = `ws://127.0.0.1:${arpPort}/relay`;
    const socket = new WebSocket(wsUrl);

    const receivedMessage = await new Promise<ArpHandshakeAck>((resolve, reject) => {
      const timeout = setTimeout(() => {
        socket.close();
        reject(new Error('ARP WebSocket handshake timed out after 3s'));
      }, 3000);

      socket.on('message', (data) => {
        clearTimeout(timeout);
        try {
          const parsed = JSON.parse(data.toString()) as ArpHandshakeAck;
          resolve(parsed);
        } catch (err) {
          reject(err);
        } finally {
          socket.close();
        }
      });

      socket.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });

    expect(receivedMessage).toBeDefined();
    expect(receivedMessage.type).toBe('arp.handshake.ack');
    expect(receivedMessage.protocolVersion).toBe('1.0.0');
    expect(receivedMessage.timestamp).toBeDefined();
  });

  it('startServers() boots both servers with port overrides and cleans up via shutdown()', async () => {
    const started = await startServers({
      portControl: 0,
      portArp: 0,
      host: '127.0.0.1',
      registerSignals: false,
      exitOnFailure: false,
      closePoolOnShutdown: false,
    });

    expect(started.controlAddress).toBeDefined();
    expect(started.arpAddress).toBeDefined();

    const res = await started.controlPlane.inject({
      method: 'GET',
      url: '/health',
    });
    expect(res.statusCode).toBe(200);

    await expect(started.shutdown('TEST')).resolves.not.toThrow();
  });

  it('startServers() rolls back control plane if ARP port cannot bind', async () => {
    // Occupy a port first with a dummy server
    const dummyServer = buildArpServer({ logger: false });
    await dummyServer.listen({ port: 0, host: '127.0.0.1' });
    const occupiedPort = (dummyServer.server.address() as AddressInfo).port;

    await expect(
      startServers({
        portControl: 0,
        portArp: occupiedPort,
        host: '127.0.0.1',
        registerSignals: false,
        exitOnFailure: false,
        closePoolOnShutdown: false,
      })
    ).rejects.toThrow();

    await dummyServer.close();
  });
});
