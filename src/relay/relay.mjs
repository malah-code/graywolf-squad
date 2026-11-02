import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import process from 'node:process';
import { Buffer } from 'node:buffer';
import WebSocket from 'ws';

export class SpendAccumulator {
  constructor(options = {}) {
    this.limitUsd = Number(options.limitUsd) || 5.0;
    this.warningThreshold = Number(options.warningThreshold) || 0.8;
    this.currentSpendUsd = 0;
    this.warned = false;
    this.onSendEnvelope = options.onSendEnvelope || null;
    this.onInjectSystemMessage = options.onInjectSystemMessage || null;
    this.onEmergencyFlush = options.onEmergencyFlush || null;
  }

  async record(callCostUsd, meta = {}) {
    this.currentSpendUsd += Number(callCostUsd) || 0;

    if (this.onSendEnvelope) {
      await this.onSendEnvelope({
        type: 'cost.delta',
        payload: {
          deltaUsd: callCostUsd,
          totalSpendUsd: this.currentSpendUsd,
          limitUsd: this.limitUsd,
          ...meta,
        },
      });
    }

    if (!this.warned && this.currentSpendUsd >= this.limitUsd * this.warningThreshold) {
      this.warned = true;
      if (this.onSendEnvelope) {
        await this.onSendEnvelope({
          type: 'budget.warning',
          payload: {
            currentSpendUsd: this.currentSpendUsd,
            limitUsd: this.limitUsd,
            percent: (this.currentSpendUsd / this.limitUsd) * 100,
          },
        });
      }
      if (this.onInjectSystemMessage) {
        await this.onInjectSystemMessage(
          `System Alert: 80% budget threshold reached ($${this.currentSpendUsd.toFixed(2)} / $${this.limitUsd.toFixed(2)}). Prioritize task completion.`
        );
      }
    }

    if (this.currentSpendUsd >= this.limitUsd) {
      if (this.onEmergencyFlush) {
        await this.onEmergencyFlush();
      }

      if (this.onSendEnvelope) {
        await this.onSendEnvelope({
          type: 'result.final',
          payload: {
            status: 'circuit_tripped',
            exitCode: 1,
            code: 'RELAY_SPEND_CEILING_HIT',
            reason: `Spend ceiling of $${this.limitUsd} hit`,
            currentSpendUsd: this.currentSpendUsd,
          },
        });
      }

      const err = new Error(`Spend ceiling of $${this.limitUsd} hit`);
      err.code = 'RELAY_SPEND_CEILING_HIT';
      throw err;
    }

    return this.currentSpendUsd;
  }
}

export class RelayRingBuffer {
  static NEVER_DROP_TYPES = new Set([
    'file.mutation',
    'artifact.ready',
    'cost.delta',
    'result.final',
  ]);

  constructor(options = {}) {
    this.maxMessages = Number(options.maxMessages) || 1000;
    this.maxBytes = Number(options.maxBytes) || 10 * 1024 * 1024; // 10MB
    this.spillDir = options.spillDir || '/scratch/spill';
    this.queue = [];
    this.queuedBytes = 0;
  }

  getQueueLength() {
    return this.queue.length;
  }

  getQueuedBytes() {
    return this.queuedBytes;
  }

  async enqueue(envelope) {
    const rawJson = JSON.stringify(envelope);
    const bytes = Buffer.byteLength(rawJson, 'utf8');

    while (
      (this.queue.length >= this.maxMessages || this.queuedBytes + bytes > this.maxBytes) &&
      this.queue.length > 0
    ) {
      // Find oldest message that is NOT in NEVER_DROP_TYPES
      const droppableIndex = this.queue.findIndex(
        (item) => !RelayRingBuffer.NEVER_DROP_TYPES.has(item.envelope.type)
      );

      if (droppableIndex !== -1) {
        const removed = this.queue.splice(droppableIndex, 1)[0];
        this.queuedBytes -= removed.bytes;
      } else {
        // If everything in queue is never-drop, and new message is also never-drop, spill to disk
        break;
      }
    }

    // If still over capacity and envelope is never-drop, spill to disk
    if (this.queue.length >= this.maxMessages || this.queuedBytes + bytes > this.maxBytes) {
      if (RelayRingBuffer.NEVER_DROP_TYPES.has(envelope.type)) {
        await fs.promises.mkdir(this.spillDir, { recursive: true });
        const spillPath = path.join(this.spillDir, 'spill.jsonl');
        await fs.promises.appendFile(spillPath, `${rawJson}\n`, 'utf8');
        return { spilled: true, dropped: false };
      }
      // Non-never-drop message is dropped
      return { spilled: false, dropped: true };
    }

    this.queue.push({ envelope, bytes });
    this.queuedBytes += bytes;
    return { spilled: false, dropped: false };
  }

  dequeue() {
    if (this.queue.length === 0) return null;
    const item = this.queue.shift();
    this.queuedBytes -= item.bytes;
    return item.envelope;
  }
}

export class RelayHarness {
  constructor(options = {}) {
    this.taskId = options.taskId;
    this.workspaceId = options.workspaceId || 'default-workspace';
    this.orchestratorUrl = options.orchestratorUrl || 'ws://orchestrator:3001/relay';
    this.authToken = options.authToken;
    this.workspaceRoot = options.workspaceRoot || process.cwd();
    this.blastRadiusGuard = options.blastRadiusGuard || null;
    this.spendAccumulator = options.spendAccumulator || null;
    this.executeTaskFn = options.executeTaskFn || null;
    this.socketFactory = options.socketFactory || null;

    this.socket = null;
    this.seqCounter = 0;
    this.touchedFiles = new Set();
    this.pendingAcks = new Map();
  }

  nextSeq() {
    this.seqCounter++;
    return this.seqCounter;
  }

  async sendEnvelope(type, payload = {}, options = {}) {
    const id = options.id || crypto.randomUUID();
    const seq = options.seq !== undefined ? options.seq : this.nextSeq();

    const envelope = {
      v: 1,
      id,
      ts: new Date().toISOString(),
      taskId: this.taskId,
      workspaceId: this.workspaceId,
      direction: 'e2c',
      type,
      payload,
      seq,
    };

    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      const ackPromise = new Promise((resolve) => {
        this.pendingAcks.set(id, resolve);
      });
      this.socket.send(JSON.stringify(envelope));
      return ackPromise;
    }

    return null;
  }

  async recordFileMutation(filePath, action = 'write', diff = '') {
    if (this.blastRadiusGuard) {
      const decision = this.blastRadiusGuard.evaluate(filePath, action);
      if (decision === 'escalate') {
        await this.sendEnvelope('escalation.emit', {
          filePath,
          action,
          reason: 'Path requires blast radius escalation',
        });
      }
    }

    this.touchedFiles.add(filePath);
    return await this.sendEnvelope('file.mutation', {
      path: filePath,
      action,
      diff,
    });
  }

  async flushArtifacts(startTime, status = 'completed', exitCode = 0) {
    const durationMs = Date.now() - startTime;
    const dotStatusPath = path.join(this.workspaceRoot, '.agent_status.json');
    const resultJsonPath = path.join(this.workspaceRoot, 'result.json');
    const patchPath = path.join(this.workspaceRoot, 'changes.patch');

    // 1. Write .agent_status.json
    const agentStatus = {
      taskId: this.taskId,
      status: status.toUpperCase(),
      timestamp: new Date().toISOString(),
    };
    await fs.promises.writeFile(dotStatusPath, JSON.stringify(agentStatus, null, 2), 'utf8');

    // 2. Write changes.patch (stub or diff content)
    let patchContent = '';
    for (const f of this.touchedFiles) {
      patchContent += `--- a/${f}\n+++ b/${f}\n@@ -0,0 +1 @@\n+# modified by task\n`;
    }
    await fs.promises.writeFile(patchPath, patchContent, 'utf8');

    // 3. Write result.json
    const resultJson = {
      version: 'delegate-relay.result.v1',
      taskId: this.taskId,
      status,
      exitCode,
      metrics: {
        durationMs,
        peakMemoryBytes: process.memoryUsage().rss,
      },
      touchedFiles: Array.from(this.touchedFiles),
      agentReport: {
        summary: `Task ${this.taskId} execution ${status}`,
      },
    };
    await fs.promises.writeFile(resultJsonPath, JSON.stringify(resultJson, null, 2), 'utf8');

    return { agentStatus, resultJson, patchContent };
  }

  async start() {
    const wsUrl = `${this.orchestratorUrl}?taskId=${encodeURIComponent(this.taskId)}&token=${encodeURIComponent(
      this.authToken
    )}`;

    this.socket = this.socketFactory ? this.socketFactory(wsUrl) : new WebSocket(wsUrl);

    await new Promise((resolve, reject) => {
      this.socket.on('open', resolve);
      this.socket.on('error', reject);
    });

    const startTime = Date.now();

    this.socket.on('message', async (data) => {
      try {
        const frame = JSON.parse(data.toString());

        if (frame.ack && this.pendingAcks.has(frame.ack)) {
          const resolver = this.pendingAcks.get(frame.ack);
          this.pendingAcks.delete(frame.ack);
          resolver(frame);
        }

        if (frame.type === 'heartbeat.ping') {
          const pongEnvelope = {
            v: 1,
            id: crypto.randomUUID(),
            ts: new Date().toISOString(),
            taskId: this.taskId,
            workspaceId: this.workspaceId,
            direction: 'e2c',
            type: 'heartbeat.pong',
            payload: {},
          };
          this.socket.send(JSON.stringify(pongEnvelope));
        }
      } catch {
        // Ignore unparseable
      }
    });

    // Execute task function or mock workload
    let exitCode = 0;
    let status = 'completed';

    try {
      if (this.executeTaskFn) {
        await this.executeTaskFn(this);
      }
    } catch {
      exitCode = 1;
      status = 'failed';
    }

    // Phase 3 Teardown
    await this.flushArtifacts(startTime, status, exitCode);

    // Send result.final and wait for ack
    await this.sendEnvelope('result.final', {
      taskId: this.taskId,
      status,
      exitCode,
      touchedFiles: Array.from(this.touchedFiles),
    });

    if (this.socket.readyState === WebSocket.OPEN) {
      this.socket.close(1000);
    }

    return { status, exitCode };
  }
}
