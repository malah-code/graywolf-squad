import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import Fastify, { FastifyInstance, FastifyServerOptions } from 'fastify';
import fastifyWebsocket from '@fastify/websocket';
import { WebSocket } from 'ws';
import {
  RelayEnvelope,
  validateRelayEnvelope,
  verifyRelayJwt,
} from '../schemas/arp-envelope';
import {
  acquireManifestLock,
  releaseManifestLock,
} from './manifest-lock';

export interface ReconstructionMetadata {
  reconstructionFidelity: 'complete' | 'gapped';
  missingSequences: number[];
  salvagedFilesCount: number;
}

export interface ArpServerOptions extends FastifyServerOptions {
  baseDir?: string;
  heartbeatIntervalMs?: number;
  requireAuth?: boolean;
  validateTaskExists?: (taskId: string) => Promise<boolean> | boolean;
  onHeartbeatTimeout?: (taskId: string) => void | Promise<void>;
  onEnvelope?: (envelope: RelayEnvelope, socket: WebSocket) => void | Promise<void>;
  onConnection?: (socket: WebSocket, taskId?: string) => void;
}

interface TaskArpState {
  taskId: string;
  workspaceId: string;
  seenSeqs: Set<number>;
  maxSeq: number;
  salvagedFiles: Set<string>;
  missedPings: number;
}

const taskStates = new Map<string, TaskArpState>();

export function getTaskReconstructionMetadata(taskId: string): ReconstructionMetadata {
  const state = taskStates.get(taskId);
  if (!state || state.maxSeq === 0) {
    return {
      reconstructionFidelity: 'complete',
      missingSequences: [],
      salvagedFilesCount: state ? state.salvagedFiles.size : 0,
    };
  }

  const missing: number[] = [];
  for (let i = 1; i <= state.maxSeq; i++) {
    if (!state.seenSeqs.has(i)) {
      missing.push(i);
    }
  }

  return {
    reconstructionFidelity: missing.length === 0 ? 'complete' : 'gapped',
    missingSequences: missing,
    salvagedFilesCount: state.salvagedFiles.size,
  };
}

export function resetTaskReconstructionMetadata(taskId?: string): void {
  if (taskId) {
    taskStates.delete(taskId);
  } else {
    taskStates.clear();
  }
}

export function buildArpServer(opts: ArpServerOptions = {}): FastifyInstance {
  const server = Fastify({
    logger: opts.logger ?? {
      level: process.env.LOG_LEVEL || 'info',
    },
    ...opts,
  });

  server.register(fastifyWebsocket, {
    options: {
      maxPayload: 20 * 1024 * 1024, // 20MB for patches / terminal frames
    },
  });

  server.register(async (fastify) => {
    fastify.get('/relay', { websocket: true }, async (socket, request) => {
      request.log.info('ARP connection attempt received at /relay');

      let parsedUrl: URL;
      try {
        parsedUrl = new URL(request.url, 'http://localhost');
      } catch {
        socket.close(4001, 'Unauthorized');
        return;
      }

      const taskIdParam = parsedUrl.searchParams.get('taskId');
      const tokenParam = parsedUrl.searchParams.get('token');

      // Check if authentication should be enforced
      const shouldAuthenticate = Boolean(opts.requireAuth || taskIdParam || tokenParam);

      let authenticatedTaskId = taskIdParam ?? undefined;
      let authenticatedWorkspaceId = 'default-workspace';

      if (shouldAuthenticate) {
        if (!tokenParam || !taskIdParam) {
          socket.close(4001, 'Unauthorized');
          return;
        }

        try {
          const verified = verifyRelayJwt(tokenParam, taskIdParam);
          authenticatedTaskId = verified.taskId;
          authenticatedWorkspaceId = verified.workspaceId;
        } catch {
          socket.close(4001, 'Unauthorized');
          return;
        }

        if (opts.validateTaskExists) {
          const exists = await opts.validateTaskExists(authenticatedTaskId);
          if (!exists) {
            socket.close(4004, 'Task Not Found');
            return;
          }
        }
      }

      // Initialize or retrieve per-task state
      let state: TaskArpState | undefined;
      if (authenticatedTaskId) {
        state = taskStates.get(authenticatedTaskId);
        if (!state) {
          state = {
            taskId: authenticatedTaskId,
            workspaceId: authenticatedWorkspaceId,
            seenSeqs: new Set<number>(),
            maxSeq: 0,
            salvagedFiles: new Set<string>(),
            missedPings: 0,
          };
          taskStates.set(authenticatedTaskId, state);
        } else {
          state.missedPings = 0;
        }
      }

      // Send initial protocol handshake confirmation (preserves backward compatibility)
      socket.send(
        JSON.stringify({
          type: 'arp.handshake.ack',
          protocolVersion: '1.0.0',
          timestamp: new Date().toISOString(),
          taskId: authenticatedTaskId,
        })
      );

      if (opts.onConnection) {
        opts.onConnection(socket, authenticatedTaskId);
      }

      // Setup Heartbeat Ping timer if task is authenticated
      const heartbeatInterval = opts.heartbeatIntervalMs ?? 15000;
      let heartbeatTimer: NodeJS.Timeout | null = null;

      if (authenticatedTaskId && state) {
        heartbeatTimer = setInterval(async () => {
          if (!state) return;
          if (state.missedPings >= 3) {
            request.log.warn({ taskId: state.taskId }, 'Heartbeat timeout: missed 3 consecutive pings');
            if (heartbeatTimer) clearInterval(heartbeatTimer);
            socket.close(4010, 'SANDBOX_HEARTBEAT_TIMEOUT');
            try {
              await opts.onHeartbeatTimeout?.(state.taskId);
            } catch (err) {
              request.log.error(err, 'Error in onHeartbeatTimeout hook');
            }
            return;
          }

          state.missedPings++;
          const pingFrame: RelayEnvelope = {
            v: 1,
            id: crypto.randomUUID(),
            ts: new Date().toISOString(),
            taskId: state.taskId,
            workspaceId: state.workspaceId,
            direction: 'c2e',
            type: 'heartbeat.ping',
            payload: {},
          };

          if (socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify(pingFrame));
          }
        }, heartbeatInterval);

        if (typeof heartbeatTimer.unref === 'function') {
          heartbeatTimer.unref();
        }
      }

      socket.on('message', async (data: Buffer | string) => {
        let envelope: RelayEnvelope;
        try {
          const raw = JSON.parse(data.toString());
          envelope = validateRelayEnvelope(raw);
        } catch {
          // If message is not a valid RelayEnvelope, log and ignore or handle basic frame
          try {
            const rawBasic = JSON.parse(data.toString());
            request.log.debug({ messageType: rawBasic.type }, 'Basic frame received');
          } catch {
            request.log.warn('Malformed non-JSON frame received on ARP socket');
          }
          return;
        }

        request.log.debug({ messageType: envelope.type, seq: envelope.seq }, 'ARP envelope received');

        // Reset heartbeat pong
        if (envelope.type === 'heartbeat.pong') {
          if (state) {
            state.missedPings = 0;
          }
        }

        // Handle file.mutation with idempotent fsync-before-ack
        if (envelope.type === 'file.mutation') {
          const seq = envelope.seq;
          if (state && seq && state.seenSeqs.has(seq)) {
            // Duplicate seq: send ack immediately without disk write
            const duplicateAck: RelayEnvelope = {
              v: 1,
              id: crypto.randomUUID(),
              ts: new Date().toISOString(),
              taskId: envelope.taskId,
              workspaceId: envelope.workspaceId,
              direction: 'c2e',
              type: 'status.update',
              payload: { acked: true, duplicate: true },
              ack: envelope.id,
              seq,
            };
            if (socket.readyState === WebSocket.OPEN) {
              socket.send(JSON.stringify(duplicateAck));
            }
            return;
          }

          // Ingest mutation and fsync before acking
          const baseDir = opts.baseDir ?? path.join(process.cwd(), '.agents/tasks');
          const taskLedgerDir = path.join(baseDir, envelope.taskId, 'ledger');
          await fs.promises.mkdir(taskLedgerDir, { recursive: true });
          const mutationLogPath = path.join(taskLedgerDir, 'mutation_stream.log');

          const mutationLine = `${JSON.stringify(envelope)}\n`;
          const fileHandle = await fs.promises.open(mutationLogPath, 'a');
          try {
            await fileHandle.write(mutationLine);
            await fileHandle.sync(); // fsync to disk
          } finally {
            await fileHandle.close();
          }

          if (state && seq) {
            state.seenSeqs.add(seq);
            if (seq > state.maxSeq) {
              state.maxSeq = seq;
            }
          }

          if (state && envelope.payload?.path) {
            state.salvagedFiles.add(String(envelope.payload.path));
          }

          // Send ack frame back to container
          const ackFrame: RelayEnvelope = {
            v: 1,
            id: crypto.randomUUID(),
            ts: new Date().toISOString(),
            taskId: envelope.taskId,
            workspaceId: envelope.workspaceId,
            direction: 'c2e',
            type: 'status.update',
            payload: { acked: true },
            ack: envelope.id,
            seq,
          };
          if (socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify(ackFrame));
          }
        }

        // Handle manifest.lock.acquire
        if (envelope.type === 'manifest.lock.acquire') {
          const manifestPath = String(envelope.payload.manifestPath || '');
          const leaseTtlMs = typeof envelope.payload.leaseTtlMs === 'number' ? envelope.payload.leaseTtlMs : undefined;
          const timeoutMs = typeof envelope.payload.timeoutMs === 'number' ? envelope.payload.timeoutMs : undefined;

          const lockResult = await acquireManifestLock({
            workspaceId: envelope.workspaceId,
            manifestPath,
            taskId: envelope.taskId,
            leaseTtlMs,
            timeoutMs,
          });

          if (lockResult.granted) {
            const grantedFrame: RelayEnvelope = {
              v: 1,
              id: crypto.randomUUID(),
              ts: new Date().toISOString(),
              taskId: envelope.taskId,
              workspaceId: envelope.workspaceId,
              direction: 'c2e',
              type: 'manifest.lock.granted',
              payload: {
                lockKey: lockResult.lockKey,
                lockToken: lockResult.lockToken,
                leaseTtlMs: lockResult.leaseTtlMs,
              },
              ack: envelope.id,
            };
            if (socket.readyState === WebSocket.OPEN) {
              socket.send(JSON.stringify(grantedFrame));
            }
          } else {
            const rejectedFrame: RelayEnvelope = {
              v: 1,
              id: crypto.randomUUID(),
              ts: new Date().toISOString(),
              taskId: envelope.taskId,
              workspaceId: envelope.workspaceId,
              direction: 'c2e',
              type: 'manifest.lock.rejected',
              payload: {
                lockKey: lockResult.lockKey,
                reason: lockResult.reason,
              },
              ack: envelope.id,
            };
            if (socket.readyState === WebSocket.OPEN) {
              socket.send(JSON.stringify(rejectedFrame));
            }
          }
        }

        // Handle manifest.lock.release
        if (envelope.type === 'manifest.lock.release') {
          const manifestPath = String(envelope.payload.manifestPath || '');
          const lockToken = String(envelope.payload.lockToken || '');

          const released = await releaseManifestLock({
            workspaceId: envelope.workspaceId,
            manifestPath,
            lockToken,
          });

          const releaseAckFrame: RelayEnvelope = {
            v: 1,
            id: crypto.randomUUID(),
            ts: new Date().toISOString(),
            taskId: envelope.taskId,
            workspaceId: envelope.workspaceId,
            direction: 'c2e',
            type: 'status.update',
            payload: { released },
            ack: envelope.id,
          };
          if (socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify(releaseAckFrame));
          }
        }

        // Handle result.final or other at-least-once deliveries
        if (
          envelope.type === 'result.final' ||
          envelope.type === 'artifact.ready' ||
          envelope.type === 'cost.delta' ||
          envelope.type === 'clarification.request' ||
          envelope.type === 'escalation.emit'
        ) {
          const ackFrame: RelayEnvelope = {
            v: 1,
            id: crypto.randomUUID(),
            ts: new Date().toISOString(),
            taskId: envelope.taskId,
            workspaceId: envelope.workspaceId,
            direction: 'c2e',
            type: 'status.update',
            payload: { acked: true },
            ack: envelope.id,
          };
          if (socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify(ackFrame));
          }
        }

        try {
          await opts.onEnvelope?.(envelope, socket);
        } catch (err) {
          request.log.error(err, 'Error in onEnvelope handler');
        }
      });

      socket.on('close', (code, reason) => {
        if (heartbeatTimer) clearInterval(heartbeatTimer);
        request.log.info({ code, reason: reason.toString() }, 'ARP runner disconnected');
      });

      socket.on('error', (err) => {
        if (heartbeatTimer) clearInterval(heartbeatTimer);
        request.log.error(err, 'ARP socket error encountered');
      });
    });

    // Health check on ARP port for runner-net diagnostic checks
    fastify.get('/health', async (_req, reply) => {
      return reply.status(200).send({
        ok: true,
        service: 'arp-server',
        timestamp: new Date().toISOString(),
      });
    });
  });

  return server;
}
