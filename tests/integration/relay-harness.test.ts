import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import type { AddressInfo } from 'node:net';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { FastifyInstance } from 'fastify';
import {
  resolveExecutionLane,
  buildLaneCliArgs,
} from '../../src/relay/lanes.mjs';
import {
  SpendAccumulator,
  RelayRingBuffer,
  RelayHarness,
} from '../../src/relay/relay.mjs';
import {
  BlastRadiusGuard,
} from '../../src/relay/blast-radius-guard.mjs';
import {
  buildArpServer,
  resetTaskReconstructionMetadata,
} from '../../src/orchestrator/arp/server';
import { mintRelayJwt } from '../../src/orchestrator/schemas/arp-envelope';

describe('In-Container Relay Harness & Execution Lanes Integration (US3)', () => {
  let testWorkspaceRoot: string;
  let testSpillDir: string;
  let arpServer: FastifyInstance;
  let arpPort: number;

  beforeEach(async () => {
    resetTaskReconstructionMetadata();
    testWorkspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'graywolf-harness-ws-'));
    testSpillDir = await fs.mkdtemp(path.join(os.tmpdir(), 'graywolf-spill-'));
  });

  afterEach(async () => {
    if (arpServer) {
      await arpServer.close();
    }
    try {
      await fs.rm(testWorkspaceRoot, { recursive: true, force: true });
    } catch {
      // Ignore
    }
    try {
      await fs.rm(testSpillDir, { recursive: true, force: true });
    } catch {
      // Ignore
    }
  });

  describe('delegate-fleet.v1 Execution Lanes', () => {
    it('maps task tags and types to execution lanes', () => {
      expect(resolveExecutionLane('feature')).toBe('claude');
      expect(resolveExecutionLane('tests')).toBe('codex');
      expect(resolveExecutionLane('bug-bash-sprint')).toBe('codex');
      expect(resolveExecutionLane('ui')).toBe('opencode');
      expect(resolveExecutionLane('frontend')).toBe('opencode');
      expect(resolveExecutionLane('complex')).toBe('agy');
      expect(resolveExecutionLane('architecture')).toBe('agy');
      expect(resolveExecutionLane('unknown-tag')).toBe('claude');
    });

    it('builds CLI arguments for Strike 1 fresh vs Strike 2 incremental sessions', () => {
      // Strike 1
      const strike1 = buildLaneCliArgs({
        lane: 'feature',
        attempt: 1,
        briefPath: '.agents/tasks/brief.md',
      });
      expect(strike1.cliTool).toBe('claude');
      expect(strike1.args).toEqual(['--brief', '.agents/tasks/brief.md', '--format', 'json-rpc-acp']);

      // Strike 2
      const strike2 = buildLaneCliArgs({
        lane: 'tests',
        attempt: 2,
        sessionId: 'sess-abc-123',
        feedback: 'Fix edge case tests',
      });
      expect(strike2.cliTool).toBe('codex');
      expect(strike2.args).toEqual([
        '--session',
        'sess-abc-123',
        '--feedback',
        'Fix edge case tests',
        '--format',
        'json-rpc-acp',
      ]);

      // Strike 2 without sessionId throws
      expect(() => buildLaneCliArgs({ lane: 'tests', attempt: 2 })).toThrow(
        'sessionId is required'
      );
    });
  });

  describe('SpendAccumulator Budget Enforcement', () => {
    it('emits cost.delta, warns at 80% threshold once, and flushes emergency patch at 100%', async () => {
      const sentEnvelopes: Array<{ type: string; payload: Record<string, unknown> }> = [];
      const injectedMessages: string[] = [];
      const emergencyFlushSpy = vi.fn().mockResolvedValue(undefined);

      const spend = new SpendAccumulator({
        limitUsd: 10.0,
        warningThreshold: 0.8,
        onSendEnvelope: async (env: { type: string; payload: Record<string, unknown> }) => {
          sentEnvelopes.push(env);
        },
        onInjectSystemMessage: async (msg: string) => {
          injectedMessages.push(msg);
        },
        onEmergencyFlush: emergencyFlushSpy,
      });

      // 1. Initial spend $5.00
      await spend.record(5.0);
      expect(spend.currentSpendUsd).toBe(5.0);
      expect(injectedMessages).toHaveLength(0);

      // 2. Spend increases to $8.50 -> 85% exceeds 80% threshold -> budget.warning
      await spend.record(3.5);
      expect(spend.currentSpendUsd).toBe(8.5);
      expect(injectedMessages).toHaveLength(1);
      expect(injectedMessages[0]).toContain('80% budget threshold reached');
      expect(sentEnvelopes.some((e) => e.type === 'budget.warning')).toBe(true);

      // 3. Spend increases beyond $10.00 -> ceiling hit -> emergency flush + RELAY_SPEND_CEILING_HIT
      await expect(spend.record(2.0)).rejects.toThrow('Spend ceiling of $10 hit');
      expect(emergencyFlushSpy).toHaveBeenCalledOnce();
      expect(sentEnvelopes.some((e) => e.type === 'result.final')).toBe(true);
    });
  });

  describe('RelayRingBuffer Overflow & Disk Spilling', () => {
    it('drops oldest terminal.chunk when capacity saturated while spilling never-drop envelopes to disk', async () => {
      const ring = new RelayRingBuffer({
        maxMessages: 3,
        maxBytes: 10000,
        spillDir: testSpillDir,
      });

      // 1. Enqueue 2 droppable terminal.chunk messages and 1 never-drop mutation
      await ring.enqueue({ type: 'terminal.chunk', payload: { chunk: 'line 1' } });
      await ring.enqueue({ type: 'terminal.chunk', payload: { chunk: 'line 2' } });
      await ring.enqueue({ type: 'file.mutation', payload: { path: 'a.ts' } });

      expect(ring.getQueueLength()).toBe(3);

      // 2. Enqueue another never-drop mutation -> terminal.chunk 'line 1' is evicted to make room
      const res1 = await ring.enqueue({ type: 'file.mutation', payload: { path: 'b.ts' } });
      expect(res1.spilled).toBe(false);
      expect(res1.dropped).toBe(false);
      expect(ring.getQueueLength()).toBe(3);

      // 3. Enqueue another never-drop mutation -> terminal.chunk 'line 2' is evicted
      await ring.enqueue({ type: 'file.mutation', payload: { path: 'c.ts' } });
      expect(ring.getQueueLength()).toBe(3);

      // Now all 3 queued messages are never-drop (file.mutation). Next never-drop message MUST spill to disk!
      const resSpill = await ring.enqueue({
        type: 'file.mutation',
        payload: { path: 'spilled.ts' },
      });
      expect(resSpill.spilled).toBe(true);

      // Verify spill file exists on disk with content
      const spillContent = await fs.readFile(path.join(testSpillDir, 'spill.jsonl'), 'utf8');
      expect(spillContent).toContain('spilled.ts');
    });
  });

  describe('End-to-End RelayHarness Execution', () => {
    it('connects to live ARP server, executes workload, streams file.mutation, flushes artifacts, and delivers result.final', async () => {
      arpServer = buildArpServer({
        logger: false,
        baseDir: testWorkspaceRoot,
      });
      await arpServer.listen({ port: 0, host: '127.0.0.1' });
      arpPort = (arpServer.server.address() as AddressInfo).port;

      const taskId = 'TASK-HARNESS-E2E';
      const token = mintRelayJwt({ taskId, workspaceId: 'ws-e2e' });

      const guard = new BlastRadiusGuard({
        writableGlobs: ['src/**'],
        readonlyGlobs: ['package.json'],
      });

      const harness = new RelayHarness({
        taskId,
        workspaceId: 'ws-e2e',
        orchestratorUrl: `ws://127.0.0.1:${arpPort}/relay`,
        authToken: token,
        workspaceRoot: testWorkspaceRoot,
        blastRadiusGuard: guard,
        executeTaskFn: async (h: RelayHarness) => {
          // Record mutation on allowed path
          await h.recordFileMutation('src/core.ts', 'write', '+export const version = 1;');
        },
      });

      const executionResult = await harness.start();
      expect(executionResult.status).toBe('completed');
      expect(executionResult.exitCode).toBe(0);

      // 1. Verify .agent_status.json
      const dotStatusContent = JSON.parse(
        await fs.readFile(path.join(testWorkspaceRoot, '.agent_status.json'), 'utf8')
      );
      expect(dotStatusContent.taskId).toBe(taskId);
      expect(dotStatusContent.status).toBe('COMPLETED');

      // 2. Verify result.json
      const resultJsonContent = JSON.parse(
        await fs.readFile(path.join(testWorkspaceRoot, 'result.json'), 'utf8')
      );
      expect(resultJsonContent.version).toBe('delegate-relay.result.v1');
      expect(resultJsonContent.taskId).toBe(taskId);
      expect(resultJsonContent.status).toBe('completed');
      expect(resultJsonContent.touchedFiles).toContain('src/core.ts');

      // 3. Verify changes.patch
      const patchContent = await fs.readFile(
        path.join(testWorkspaceRoot, 'changes.patch'),
        'utf8'
      );
      expect(patchContent).toContain('src/core.ts');
    });
  });
});
