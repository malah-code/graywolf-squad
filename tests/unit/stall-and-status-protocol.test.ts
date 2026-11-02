import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  normalizeVolatileOutput,
  StallDetector,
} from '../../src/orchestrator/learning/stall-detector';
import { verifyTerminalStatusProtocol } from '../../src/orchestrator/learning/status-protocol';

describe('Stall Detection Guardrails & Terminal-State Protocol (Task 14.3, ADR-058, ADR-059)', () => {
  let tempWorktree: string;

  beforeEach(async () => {
    tempWorktree = await fs.mkdtemp(path.join(os.tmpdir(), 'graywolf-status-protocol-'));
  });

  afterEach(async () => {
    await fs.rm(tempWorktree, { recursive: true, force: true });
  });

  describe('Volatile Output Normalization (normalizeVolatileOutput)', () => {
    it('strips ISO timestamps, PIDs, durations, and /tmp/ suffixes to produce identical normalized strings', () => {
      const out1 =
        '2026-11-01T09:40:00.123Z [pid 44102] FAIL /tmp/vitest-run-991a/auth.test.ts in 142ms';
      const out2 =
        '2026-11-01T09:41:55.987Z [pid 99811] FAIL /tmp/vitest-run-b72c/auth.test.ts in 89ms';

      expect(normalizeVolatileOutput(out1)).toBe(normalizeVolatileOutput(out2));
    });
  });

  describe('StallDetector Guardrails (StallDetector)', () => {
    it('warns at 3x and hard-interrupts at 5x consecutive exact-failure streak despite changing timestamps', () => {
      const detector = new StallDetector();

      for (let i = 1; i <= 5; i++) {
        const res = detector.recordCommandExecution({
          taskId: 'TASK-STALL-1',
          turnIndex: i,
          command: 'pnpm test',
          exitCode: 1,
          stdoutStderr: `2026-11-01T10:00:0${i}Z pid=${1000 + i} Error: connection refused in ${i * 15}ms`,
        });

        if (i < 3) {
          expect(res.action).toBe('none');
        } else if (i === 3) {
          expect(res.action).toBe('warn');
          expect(res.detectorTriggered).toBe('exact_failure_streak');
          expect(res.strikeIncrement).toBe(0);
        } else if (i === 5) {
          expect(res.action).toBe('hard_interrupt');
          expect(res.detectorTriggered).toBe('exact_failure_streak');
          expect(res.taskStatus).toBe('STALL_ESCALATED');
          expect(res.strikeIncrement).toBe(1);
          expect(res.stallReport).not.toBeNull();
        }
      }
    });

    it('warns at 3 laps and hard-interrupts at 5 laps of a multi-call cycle (A -> B -> A -> B, period <= 4)', () => {
      const detector = new StallDetector();

      for (let lap = 1; lap <= 5; lap++) {
        detector.recordCommandExecution({
          taskId: 'TASK-CYCLE-1',
          turnIndex: lap,
          command: 'grep -n foo src/a.ts',
          exitCode: 0,
          stdoutStderr: '12: const foo = 1;',
        });
        const resB = detector.recordCommandExecution({
          taskId: 'TASK-CYCLE-1',
          turnIndex: lap,
          command: 'grep -n bar src/b.ts',
          exitCode: 0,
          stdoutStderr: '24: const bar = 2;',
        });

        if (lap === 3) {
          expect(resB.action).toBe('warn');
          expect(resB.detectorTriggered).toBe('multi_call_cycle');
          expect(resB.streakOrLapCount).toBe(3);
        } else if (lap === 5) {
          expect(resB.action).toBe('hard_interrupt');
          expect(resB.detectorTriggered).toBe('multi_call_cycle');
          expect(resB.taskStatus).toBe('STALL_ESCALATED');
          expect(resB.strikeIncrement).toBe(1);
        }
      }
    });

    it('triggers turn_cap_nudge when > 50 commands execute in a single turn', () => {
      const detector = new StallDetector();
      let lastRes = detector.recordCommandExecution({
        taskId: 'TASK-CAP-1',
        turnIndex: 1,
        command: 'echo 1',
        exitCode: 0,
        stdoutStderr: '1',
      });

      for (let i = 2; i <= 51; i++) {
        lastRes = detector.recordCommandExecution({
          taskId: 'TASK-CAP-1',
          turnIndex: 1,
          command: `echo ${i}`,
          exitCode: 0,
          stdoutStderr: `${i}`,
        });
      }

      expect(lastRes.action).toBe('turn_cap_nudge');
      expect(lastRes.detectorTriggered).toBe('per_turn_command_cap');
      expect(lastRes.streakOrLapCount).toBe(51);
    });

    it('enforces PRD §6 stuck heuristics: 4 identical action-observations and 3 identical git diffs', () => {
      const detector = new StallDetector();

      // 4 identical passing action-observations
      let obsRes = detector.recordCommandExecution({
        taskId: 'TASK-OBS-1',
        turnIndex: 1,
        command: 'cat README.md',
        exitCode: 0,
        stdoutStderr: '# Graywolf',
      });
      for (let i = 2; i <= 4; i++) {
        obsRes = detector.recordCommandExecution({
          taskId: 'TASK-OBS-1',
          turnIndex: i,
          command: 'cat README.md',
          exitCode: 0,
          stdoutStderr: '# Graywolf',
        });
      }
      expect(obsRes.action).toBe('hard_interrupt');
      expect(obsRes.detectorTriggered).toBe('identical_action_observation');
      expect(obsRes.taskStatus).toBe('STALL_ESCALATED');

      // 3 identical git diffs
      detector.recordDiffSnapshot({ taskId: 'TASK-DIFF-1', diffPatch: '+ const a = 1;' });
      detector.recordDiffSnapshot({ taskId: 'TASK-DIFF-1', diffPatch: '+ const a = 1;' });
      const diff3 = detector.recordDiffSnapshot({
        taskId: 'TASK-DIFF-1',
        diffPatch: '+ const a = 1;',
      });

      expect(diff3.action).toBe('hard_interrupt');
      expect(diff3.detectorTriggered).toBe('identical_diff_streak');
      expect(diff3.taskStatus).toBe('STALL_ESCALATED');
      expect(diff3.strikeIncrement).toBe(1);
    });
  });

  describe('Container Terminal-State Protocol (verifyTerminalStatusProtocol)', () => {
    it('accepts a valid .agent_status.json when container exits rc=0', async () => {
      await fs.writeFile(
        path.join(tempWorktree, '.agent_status.json'),
        JSON.stringify({
          status: 'patch_ready',
          summary: 'Completed implementation and unit tests.',
          artifacts: ['changes.patch'],
          exit_reason: 'All tests passing',
        }),
        'utf8'
      );

      const res = await verifyTerminalStatusProtocol({
        taskId: 'TASK-PROTO-1',
        worktreeDir: tempWorktree,
        exitCode: 0,
        previousNudges: 0,
      });

      expect(res.valid).toBe(true);
      expect(res.protocolStatus).toBe('patch_ready');
      expect(res.nudgeRequired).toBe(false);
      expect(res.strikeIncrement).toBe(0);
      expect(res.escalated).toBe(false);
    });

    it('issues Nudge 1 and Nudge 2 on missing/invalid .agent_status.json, then escalates as protocol_violation with 1 strike', async () => {
      // Nudge 1 (previousNudges = 0)
      const nudge1 = await verifyTerminalStatusProtocol({
        taskId: 'TASK-PROTO-2',
        worktreeDir: tempWorktree,
        exitCode: 0,
        previousNudges: 0,
      });
      expect(nudge1.valid).toBe(false);
      expect(nudge1.protocolStatus).toBe('nudge_retry');
      expect(nudge1.nudgeRequired).toBe(true);
      expect(nudge1.nudgeCount).toBe(1);
      expect(nudge1.strikeIncrement).toBe(0);

      // Write malformed JSON and test Nudge 2 (previousNudges = 1)
      await fs.writeFile(
        path.join(tempWorktree, '.agent_status.json'),
        '{ invalid json ',
        'utf8'
      );
      const nudge2 = await verifyTerminalStatusProtocol({
        taskId: 'TASK-PROTO-2',
        worktreeDir: tempWorktree,
        exitCode: 0,
        previousNudges: 1,
      });
      expect(nudge2.valid).toBe(false);
      expect(nudge2.protocolStatus).toBe('nudge_retry');
      expect(nudge2.nudgeRequired).toBe(true);
      expect(nudge2.nudgeCount).toBe(2);
      expect(nudge2.strikeIncrement).toBe(0);

      // After 2 failed nudges (previousNudges = 2) -> protocol_violation + strike + escalate
      const finalViolation = await verifyTerminalStatusProtocol({
        taskId: 'TASK-PROTO-2',
        worktreeDir: tempWorktree,
        exitCode: 0,
        previousNudges: 2,
      });
      expect(finalViolation.valid).toBe(false);
      expect(finalViolation.protocolStatus).toBe('protocol_violation');
      expect(finalViolation.nudgeRequired).toBe(false);
      expect(finalViolation.strikeIncrement).toBe(1);
      expect(finalViolation.escalated).toBe(true);
    });
  });
});

