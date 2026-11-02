import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  compressHermesTrajectory,
  type TrajectoryTurn,
} from '../../src/orchestrator/learning/trajectory-compressor';
import {
  computeTrajectorySplit,
  evaluateTrajectoryEligibility,
  harvestEligibleTrajectory,
  type CandidateTaskTrajectory,
} from '../../src/orchestrator/learning/trajectory-harvester';

function buildSampleTurns(count: number): TrajectoryTurn[] {
  const turns: TrajectoryTurn[] = [];
  for (let i = 0; i < count; i += 1) {
    turns.push({
      role: i % 2 === 0 ? 'assistant' : 'user',
      content: `Turn ${i + 1} detailed execution trace with extended diagnostic output: ${'x'.repeat(180)}`,
      toolNames: i % 2 === 0 ? ['read_file', 'grep_search'] : undefined,
      turnIndex: i + 1,
    });
  }
  return turns;
}

describe('Phase 19 Task 19.1: Eligible Trajectory Harvester & Hermes Compressor Unit Suite (ADR-064, ADR-079, FR-001..FR-003, SC-001, SC-002)', () => {
  it('filters candidate trajectories strictly for COMPLETED status, 0 strikes, 0 agreed P0/P1 findings, and dataset.collect = true', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gw-harvester-unit-'));

    const baseCandidate: CandidateTaskTrajectory = {
      taskId: 'TASK-ELIGIBLE-1',
      projectId: 'proj-alpha',
      workspaceId: 'ws-alpha',
      status: 'COMPLETED',
      strikes: 0,
      agreedP0P1Findings: 0,
      modelAlias: 'dev-level-3',
      systemPrompt: 'You are Dev-Level-3 Implementer.',
      taskBrief: 'Implement feature X with unit tests.',
      turns: buildSampleTurns(6),
    };

    try {
      // 1. dataset.collect = false (default opt-out) -> rejected
      const disabledRes = await harvestEligibleTrajectory(
        baseCandidate,
        { collect: false },
        { outputBaseDir: tmpDir }
      );
      expect(disabledRes.harvested).toBe(false);
      expect(disabledRes.reason).toMatch(/dataset\.collect is disabled/i);

      // 2. Non-completed status (FAILED / ESCALATED / CANCELLED) -> rejected
      for (const status of ['FAILED', 'ESCALATED', 'CANCELLED'] as const) {
        const res = evaluateTrajectoryEligibility(
          { ...baseCandidate, status },
          { collect: true }
        );
        expect(res.eligible).toBe(false);
      }

      // 3. Strikes > 0 -> rejected
      const strikeRes = evaluateTrajectoryEligibility(
        { ...baseCandidate, strikes: 1 },
        { collect: true }
      );
      expect(strikeRes.eligible).toBe(false);
      expect(strikeRes.reason).toMatch(/strike/i);

      // 4. Agreed P0/P1 findings > 0 -> rejected
      const findingRes = evaluateTrajectoryEligibility(
        { ...baseCandidate, agreedP0P1Findings: 2 },
        { collect: true }
      );
      expect(findingRes.eligible).toBe(false);
      expect(findingRes.reason).toMatch(/P0\/P1/i);

      // 5. Eligible 0-defect completed task -> harvested
      const okRes = await harvestEligibleTrajectory(
        baseCandidate,
        { collect: true },
        { outputBaseDir: tmpDir }
      );
      expect(okRes.harvested).toBe(true);
      expect(okRes.filePath).toBeTruthy();
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('compresses a 12-turn trajectory using Hermes Protect-Head (1st assistant turn), Summarize-Middle (7 turns), and Protect-Tail (last 4 turns)', async () => {
    const turns = buildSampleTurns(12);
    const systemPrompt = 'System: Follow project constitution.';
    const taskBrief = 'Task Brief: Fix race condition in worker lock.';

    const result = await compressHermesTrajectory({
      systemPrompt,
      taskBrief,
      turns,
      protectTailTurns: 4,
    });

    expect(result.compressed).toBe(true);
    expect(result.usedFallback).toBe(true);
    expect(result.protectedHead.firstAssistantTurns).toHaveLength(1);
    expect(result.protectedHead.firstAssistantTurns[0].content).toBe(turns[0].content);
    expect(result.compressedMiddleTurnCount).toBe(7);
    expect(result.protectedTail).toHaveLength(4);
    expect(result.protectedTail.map((t) => t.content)).toEqual(
      turns.slice(8).map((t) => t.content)
    );
    expect(result.tokensAfter).toBeLessThan(result.tokensBefore);

    // Total messages: system + user(brief) + 1 head assistant + 1 middle summary + 4 tail = 8
    expect(result.messages).toHaveLength(8);
    expect(result.messages[3].content).toContain(
      '[Hermes Compressed Middle Trajectory (7 turns)]'
    );
  });

  it('expands Protected Tail backwards when the tail cutoff lands on a tool response turn so assistant->tool pairs are never split', async () => {
    const turns: TrajectoryTurn[] = [
      { role: 'assistant', content: 'Turn 1: Initial plan' },
      { role: 'user', content: 'Turn 2: Proceed' },
      { role: 'assistant', content: 'Turn 3: Reading config' },
      {
        role: 'assistant',
        content: 'Turn 4: Calling run_test tool',
        toolCalls: [{ id: 'call-99', name: 'run_test', arguments: '{}' }],
      },
      // With 8 turns and protectTailTurns = 4, tailStart would normally be index 4 (Turn 5), which is role === 'tool'
      {
        role: 'tool',
        content: 'Turn 5: Test output passed',
        toolCallId: 'call-99',
      },
      { role: 'assistant', content: 'Turn 6: Analyzing results' },
      { role: 'user', content: 'Turn 7: Looks good' },
      { role: 'assistant', content: 'Turn 8: Final patch ready' },
    ];

    const result = await compressHermesTrajectory({
      systemPrompt: 'System prompt',
      taskBrief: 'Brief',
      turns,
      protectTailTurns: 4,
    });

    expect(result.compressed).toBe(true);
    // Tail expanded backwards from 4 to 5 turns to include Turn 4 (parent assistant tool call)
    expect(result.protectedTail).toHaveLength(5);
    expect(result.protectedTail[0].content).toBe('Turn 4: Calling run_test tool');
    expect(result.protectedTail[1].role).toBe('tool');
    expect(result.compressedMiddleTurnCount).toBe(2); // Turns 2 and 3
  });

  it('performs a safe no-op when trajectory length is at or below Head + Tail threshold, and falls back cleanly if auxiliarySummarizer throws', async () => {
    const shortTurns = buildSampleTurns(5); // 1 head + 4 tail = 5 -> 0 middle turns
    const noOpResult = await compressHermesTrajectory({
      systemPrompt: 'Sys',
      taskBrief: 'Brief',
      turns: shortTurns,
      protectTailTurns: 4,
    });

    expect(noOpResult.compressed).toBe(false);
    expect(noOpResult.compressedMiddleTurnCount).toBe(0);
    expect(noOpResult.tokensAfter).toBe(noOpResult.tokensBefore);

    // Auxiliary summarizer throwing error -> deterministic fallback
    const longTurns = buildSampleTurns(10);
    const fallbackResult = await compressHermesTrajectory({
      systemPrompt: 'Sys',
      taskBrief: 'Brief',
      turns: longTurns,
      protectTailTurns: 4,
      auxiliarySummarizer: async () => {
        throw new Error('Auxiliary SLM offline');
      },
    });

    expect(fallbackResult.compressed).toBe(true);
    expect(fallbackResult.usedFallback).toBe(true);
    expect(fallbackResult.middleSummary).toContain(
      '[Hermes Compressed Middle Trajectory (5 turns)]'
    );
  });

  it('computes a deterministic ~90/10 train/eval split from taskId', () => {
    let evalCount = 0;
    let trainCount = 0;
    for (let i = 1; i <= 200; i += 1) {
      const split = computeTrajectorySplit(`TASK-BENCH-${i}`);
      // Must be deterministic on repeated calls
      expect(computeTrajectorySplit(`TASK-BENCH-${i}`)).toBe(split);
      if (split === 'eval') evalCount += 1;
      else trainCount += 1;
    }

    expect(evalCount).toBeGreaterThan(5);
    expect(evalCount).toBeLessThan(40);
    expect(trainCount + evalCount).toBe(200);
  });
});

