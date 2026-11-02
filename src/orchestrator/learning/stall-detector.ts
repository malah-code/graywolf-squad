import * as crypto from 'node:crypto';

/**
 * Tool-Loop Stall Detection Guardrails (Task 14.3a, ADR-058, PRD §6 & §9.8, FR-004).
 *
 * Normalizes volatile output tokens (ISO timestamps, millisecond durations, PIDs, /tmp/ random suffixes)
 * before computing SHA-256 signatures and enforces 4 deterministic loop detectors:
 * 1. Exact-failure streak (exitCode !== 0): warn at 3x, hard-interrupt at 5x.
 * 2. Multi-call cycle (A -> B -> A -> B of period 2..4): warn at 3 laps, hard-interrupt at 5 laps.
 * 3. Per-turn command cap: > 50 commands in a single turn -> turn_cap_nudge.
 * 4. PRD §6 stuck heuristics: 4 identical action-observations or 3 identical git diffs -> hard-interrupt.
 */

export type StallDetectorKind =
  | 'exact_failure_streak'
  | 'multi_call_cycle'
  | 'per_turn_command_cap'
  | 'identical_action_observation'
  | 'identical_diff_streak';

export interface StallReport {
  taskId: string;
  detector: StallDetectorKind;
  streakOrLapCount: number;
  normalizedSignatures: string[];
  recentCommands: string[];
  detectedAt: string;
}

export interface StallCheckResult {
  action: 'none' | 'warn' | 'hard_interrupt' | 'turn_cap_nudge';
  detectorTriggered: StallDetectorKind | null;
  streakOrLapCount: number;
  taskStatus: 'STALL_ESCALATED' | null;
  strikeIncrement: 0 | 1;
  nudgeMessage: string | null;
  stallReport: StallReport | null;
}

export interface StallDetectorOptions {
  failureWarnThreshold?: number;      // default: 3
  failureInterruptThreshold?: number; // default: 5
  cycleWarnLaps?: number;             // default: 3
  cycleInterruptLaps?: number;        // default: 5
  maxCyclePeriod?: number;            // default: 4
  perTurnCommandCap?: number;         // default: 50
  identicalActionObsCap?: number;     // default: 4
  identicalDiffCap?: number;          // default: 3
}

/**
 * Strips volatile tokens (ISO timestamps, epoch ms, PIDs, durations, /tmp/ random paths)
 * and collapses whitespace so identical failures/diffs produce identical SHA-256 signatures.
 */
export function normalizeVolatileOutput(raw: string): string {
  return raw
    // Strip ISO-8601 timestamps (e.g. 2026-11-01T09:45:12.345Z)
    .replace(/\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})\b/g, '<TS>')
    // Strip PID references (e.g. pid=12345, pid: 12345, [pid 12345])
    .replace(/\bpid[\s=:]+(\d+)\b/gi, 'pid=<PID>')
    // Strip millisecond and second duration timers (e.g. 124ms, 1.45s, 32.1 ms)
    .replace(/\b\d+(?:\.\d+)?\s*(?:ms|s|sec|seconds)\b/gi, '<DUR>')
    // Strip /tmp/ random suffixes (e.g. /tmp/vitest-abc123xyz/file.ts -> /tmp/<TMP>/file.ts)
    .replace(/\/tmp\/[a-zA-Z0-9._-]+/g, '/tmp/<TMP>')
    // Strip 13-digit epoch millisecond numbers
    .replace(/\b1[7-9]\d{11}\b/g, '<EPOCH>')
    // Normalize whitespace
    .replace(/\s+/g, ' ')
    .trim();
}

function sha256Hex(text: string): string {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

export class StallDetector {
  private readonly opts: Required<StallDetectorOptions>;
  private readonly historyByTask = new Map<
    string,
    {
      signatures: Array<{ sig: string; cmdLabel: string; exitCode: number }>;
      turnCounts: Map<number, number>;
      diffSignatures: string[];
    }
  >();

  constructor(options?: StallDetectorOptions) {
    this.opts = {
      failureWarnThreshold: options?.failureWarnThreshold ?? 3,
      failureInterruptThreshold: options?.failureInterruptThreshold ?? 5,
      cycleWarnLaps: options?.cycleWarnLaps ?? 3,
      cycleInterruptLaps: options?.cycleInterruptLaps ?? 5,
      maxCyclePeriod: options?.maxCyclePeriod ?? 4,
      perTurnCommandCap: options?.perTurnCommandCap ?? 50,
      identicalActionObsCap: options?.identicalActionObsCap ?? 4,
      identicalDiffCap: options?.identicalDiffCap ?? 3,
    };
  }

  private getTaskState(taskId: string) {
    let state = this.historyByTask.get(taskId);
    if (!state) {
      state = {
        signatures: [],
        turnCounts: new Map<number, number>(),
        diffSignatures: [],
      };
      this.historyByTask.set(taskId, state);
    }
    return state;
  }

  /**
   * Checks if the tail of `sigs` forms a repeating cycle of period `2 .. maxCyclePeriod`
   * with at least 2 distinct signatures in the cycle period.
   */
  private detectMultiCallCycleLaps(sigs: string[]): { period: number; laps: number } | null {
    for (let period = 2; period <= this.opts.maxCyclePeriod; period++) {
      if (sigs.length < period * 2) continue;

      const pattern = sigs.slice(sigs.length - period);
      const uniqueInPattern = new Set(pattern);
      if (uniqueInPattern.size < 2) continue; // Period-1 streak is handled by streak detectors

      let laps = 1;
      let cursor = sigs.length - period * 2;
      while (cursor >= 0) {
        const candidate = sigs.slice(cursor, cursor + period);
        const matches = candidate.every((val, idx) => val === pattern[idx]);
        if (matches) {
          laps++;
          cursor -= period;
        } else {
          break;
        }
      }

      if (laps >= this.opts.cycleWarnLaps) {
        return { period, laps };
      }
    }
    return null;
  }

  public recordCommandExecution(input: {
    taskId: string;
    turnIndex: number;
    command: string;
    args?: string[];
    exitCode: number;
    stdoutStderr: string;
  }): StallCheckResult {
    const state = this.getTaskState(input.taskId);
    const cmdLabel = [input.command.trim(), ...(input.args ?? []).map((a) => a.trim())]
      .filter(Boolean)
      .join(' ');
    const normalizedOut = normalizeVolatileOutput(input.stdoutStderr);
    const sig = sha256Hex(`${cmdLabel}|${input.exitCode}|${normalizedOut}`);

    state.signatures.push({ sig, cmdLabel, exitCode: input.exitCode });
    const prevTurnCount = state.turnCounts.get(input.turnIndex) ?? 0;
    const currentTurnCount = prevTurnCount + 1;
    state.turnCounts.set(input.turnIndex, currentTurnCount);

    // Count consecutive identical signatures at the tail
    let consecutiveIdentical = 0;
    for (let i = state.signatures.length - 1; i >= 0; i--) {
      if (state.signatures[i].sig === sig) {
        consecutiveIdentical++;
      } else {
        break;
      }
    }

    // 1. Evaluate all terminal hard-interrupt conditions first (highest priority)
    if (input.exitCode !== 0 && consecutiveIdentical >= this.opts.failureInterruptThreshold) {
      return this.buildHardInterrupt(
        input.taskId,
        'exact_failure_streak',
        consecutiveIdentical,
        state.signatures
      );
    }

    if (input.exitCode === 0 && consecutiveIdentical >= this.opts.identicalActionObsCap) {
      return this.buildHardInterrupt(
        input.taskId,
        'identical_action_observation',
        consecutiveIdentical,
        state.signatures
      );
    }

    const rawSigs = state.signatures.map((s) => s.sig);
    const cycle = this.detectMultiCallCycleLaps(rawSigs);
    if (cycle && cycle.laps >= this.opts.cycleInterruptLaps) {
      return this.buildHardInterrupt(
        input.taskId,
        'multi_call_cycle',
        cycle.laps,
        state.signatures
      );
    }

    // 2. Per-turn command flood hard-cap (> 50 commands in one turn)
    if (currentTurnCount > this.opts.perTurnCommandCap) {
      return {
        action: 'turn_cap_nudge',
        detectorTriggered: 'per_turn_command_cap',
        streakOrLapCount: currentTurnCount,
        taskStatus: null,
        strikeIncrement: 0,
        nudgeMessage: `Per-turn command cap exceeded (${currentTurnCount} > ${this.opts.perTurnCommandCap}). Synthesize findings and conclude the current turn.`,
        stallReport: null,
      };
    }

    // 3. Evaluate warning nudges (3x failure streak or 3-lap multi-call cycle)
    if (input.exitCode !== 0 && consecutiveIdentical === this.opts.failureWarnThreshold) {
      return {
        action: 'warn',
        detectorTriggered: 'exact_failure_streak',
        streakOrLapCount: consecutiveIdentical,
        taskStatus: null,
        strikeIncrement: 0,
        nudgeMessage: `Warning: Command '${cmdLabel}' has failed ${consecutiveIdentical} consecutive times with identical output. Change approach before reaching ${this.opts.failureInterruptThreshold}x hard-interrupt.`,
        stallReport: null,
      };
    }

    if (cycle && cycle.laps === this.opts.cycleWarnLaps) {
      return {
        action: 'warn',
        detectorTriggered: 'multi_call_cycle',
        streakOrLapCount: cycle.laps,
        taskStatus: null,
        strikeIncrement: 0,
        nudgeMessage: `Warning: Detected repeating multi-call cycle (period ${cycle.period}) for ${cycle.laps} consecutive laps. Break the cycle before ${this.opts.cycleInterruptLaps} laps.`,
        stallReport: null,
      };
    }

    return {
      action: 'none',
      detectorTriggered: null,
      streakOrLapCount: consecutiveIdentical,
      taskStatus: null,
      strikeIncrement: 0,
      nudgeMessage: null,
      stallReport: null,
    };
  }

  /**
   * Records a git diff snapshot and enforces PRD §6 stuck heuristic (3 consecutive identical diffs -> hard-interrupt).
   */
  public recordDiffSnapshot(input: { taskId: string; diffPatch: string }): StallCheckResult {
    const state = this.getTaskState(input.taskId);
    const normalizedDiff = normalizeVolatileOutput(input.diffPatch);
    const diffSig = sha256Hex(normalizedDiff);
    state.diffSignatures.push(diffSig);

    let consecutiveDiffs = 0;
    for (let i = state.diffSignatures.length - 1; i >= 0; i--) {
      if (state.diffSignatures[i] === diffSig) {
        consecutiveDiffs++;
      } else {
        break;
      }
    }

    if (consecutiveDiffs >= this.opts.identicalDiffCap) {
      const report: StallReport = {
        taskId: input.taskId,
        detector: 'identical_diff_streak',
        streakOrLapCount: consecutiveDiffs,
        normalizedSignatures: state.diffSignatures.slice(-consecutiveDiffs),
        recentCommands: ['git diff (identical snapshot)'],
        detectedAt: new Date().toISOString(),
      };
      return {
        action: 'hard_interrupt',
        detectorTriggered: 'identical_diff_streak',
        streakOrLapCount: consecutiveDiffs,
        taskStatus: 'STALL_ESCALATED',
        strikeIncrement: 1,
        nudgeMessage: `Hard-interrupt: ${consecutiveDiffs} consecutive turns produced an identical git diff.`,
        stallReport: report,
      };
    }

    return {
      action: 'none',
      detectorTriggered: null,
      streakOrLapCount: consecutiveDiffs,
      taskStatus: null,
      strikeIncrement: 0,
      nudgeMessage: null,
      stallReport: null,
    };
  }

  private buildHardInterrupt(
    taskId: string,
    detector: StallDetectorKind,
    count: number,
    history: Array<{ sig: string; cmdLabel: string; exitCode: number }>
  ): StallCheckResult {
    const recent = history.slice(-10);
    const report: StallReport = {
      taskId,
      detector,
      streakOrLapCount: count,
      normalizedSignatures: recent.map((r) => r.sig),
      recentCommands: recent.map((r) => r.cmdLabel),
      detectedAt: new Date().toISOString(),
    };
    return {
      action: 'hard_interrupt',
      detectorTriggered: detector,
      streakOrLapCount: count,
      taskStatus: 'STALL_ESCALATED',
      strikeIncrement: 1,
      nudgeMessage: `Hard-interrupt triggered by ${detector} (count: ${count}). Task escalated as STALL_ESCALATED.`,
      stallReport: report,
    };
  }
}

