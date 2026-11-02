/**
 * Hermes-Faithful Trajectory Compressor (Phase 19, Task 19.1, ADR-064, FR-002, FR-003, SC-002).
 *
 * Implements the Hermes `trajectory_compressor.py` strategy for SFT dataset generation:
 * 1. Protected Head: System prompt + initial task brief + first assistant turn.
 * 2. Protected Tail: Configurable last N turns (default `protectTailTurns = 4`), expanded
 *    backwards if the boundary lands on a `role === 'tool'` turn so tool-call / tool-result
 *    pairs are never orphaned across compression boundaries.
 * 3. Summarize Middle: Compresses intermediate tool-call sequences into a compact semantic
 *    narration turn using an optional auxiliary summarizer or deterministic fallback.
 */

export interface TrajectoryToolCall {
  id: string;
  name: string;
  arguments: string;
}

export interface TrajectoryTurn {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  toolCalls?: TrajectoryToolCall[];
  toolCallId?: string;
  toolNames?: string[];
  turnIndex?: number;
}

export interface HermesCompressionOptions {
  systemPrompt: string;
  taskBrief: string;
  turns: TrajectoryTurn[];
  protectTailTurns?: number;
  auxiliarySummarizer?: (middleTurns: TrajectoryTurn[]) => Promise<string>;
}

export interface HermesCompressedTrajectory {
  compressed: boolean;
  usedFallback: boolean;
  protectedHead: {
    systemPrompt: string;
    taskBrief: string;
    firstAssistantTurns: TrajectoryTurn[];
  };
  middleSummary: string | null;
  compressedMiddleTurnCount: number;
  protectedTail: TrajectoryTurn[];
  messages: TrajectoryTurn[];
  tokensBefore: number;
  tokensAfter: number;
  compressionRatio: number;
}

/**
 * Estimates token count (~4 characters per token) across system prompt, brief, and turns.
 */
export function estimateTrajectoryTokens(turns: TrajectoryTurn[]): number {
  let totalChars = 0;
  for (const turn of turns) {
    totalChars += turn.content.length + 12;
    if (turn.toolCalls && turn.toolCalls.length > 0) {
      for (const tc of turn.toolCalls) {
        totalChars += tc.name.length + tc.arguments.length + 16;
      }
    }
    if (turn.toolNames && turn.toolNames.length > 0) {
      totalChars += turn.toolNames.join(',').length;
    }
  }
  return Math.max(1, Math.ceil(totalChars / 4));
}

/**
 * Deterministic fallback narration builder for middle tool-call turns.
 */
export function buildHermesMiddleNarration(middleTurns: TrajectoryTurn[]): string {
  const lines = middleTurns.map((turn, idx) => {
    const turnNumber = turn.turnIndex ?? idx + 2;
    const callNames =
      turn.toolCalls && turn.toolCalls.length > 0
        ? turn.toolCalls.map((tc) => tc.name)
        : turn.toolNames ?? [];
    const toolsLabel = callNames.length > 0 ? callNames.join(', ') : 'none';
    const compactSnippet = turn.content.replace(/\s+/g, ' ').trim().slice(0, 140);
    return `- [Turn ${turnNumber} | ${turn.role} | tools: ${toolsLabel}] ${compactSnippet}`;
  });

  return `[Hermes Compressed Middle Trajectory (${middleTurns.length} turns)]\n${lines.join('\n')}`;
}

/**
 * Compresses a task trajectory using the Hermes Protect-Head / Protect-Tail / Summarize-Middle pattern.
 */
export async function compressHermesTrajectory(
  options: HermesCompressionOptions
): Promise<HermesCompressedTrajectory> {
  const protectTailTurns = Math.max(1, options.protectTailTurns ?? 4);
  const turns = options.turns;

  const baseHeadMessages: TrajectoryTurn[] = [
    { role: 'system', content: options.systemPrompt },
    { role: 'user', content: options.taskBrief },
  ];

  const allUncompressedMessages: TrajectoryTurn[] = [
    ...baseHeadMessages,
    ...turns,
  ];
  const tokensBefore = estimateTrajectoryTokens(allUncompressedMessages);

  if (turns.length === 0) {
    return {
      compressed: false,
      usedFallback: false,
      protectedHead: {
        systemPrompt: options.systemPrompt,
        taskBrief: options.taskBrief,
        firstAssistantTurns: [],
      },
      middleSummary: null,
      compressedMiddleTurnCount: 0,
      protectedTail: [],
      messages: allUncompressedMessages,
      tokensBefore,
      tokensAfter: tokensBefore,
      compressionRatio: 1,
    };
  }

  // Head includes up to and including the first assistant turn (minimum 1 turn)
  const firstAssistantIdx = turns.findIndex((t) => t.role === 'assistant');
  const headEnd = firstAssistantIdx >= 0 ? firstAssistantIdx + 1 : 1;

  // Tail starts at turns.length - protectTailTurns, expanded backwards if it lands on a 'tool' turn
  let tailStart = Math.max(headEnd, turns.length - protectTailTurns);
  while (tailStart > headEnd && turns[tailStart]?.role === 'tool') {
    tailStart -= 1;
  }

  const firstAssistantTurns = turns.slice(0, headEnd);
  const middleTurns = turns.slice(headEnd, tailStart);
  const protectedTail = turns.slice(tailStart);

  // If no middle turns remain to compress, return verbatim
  if (middleTurns.length === 0) {
    return {
      compressed: false,
      usedFallback: false,
      protectedHead: {
        systemPrompt: options.systemPrompt,
        taskBrief: options.taskBrief,
        firstAssistantTurns,
      },
      middleSummary: null,
      compressedMiddleTurnCount: 0,
      protectedTail,
      messages: allUncompressedMessages,
      tokensBefore,
      tokensAfter: tokensBefore,
      compressionRatio: 1,
    };
  }

  let middleSummary: string;
  let usedFallback = false;

  if (options.auxiliarySummarizer) {
    try {
      const candidateSummary = await options.auxiliarySummarizer(middleTurns);
      if (candidateSummary && candidateSummary.trim().length > 0) {
        middleSummary = candidateSummary.trim();
      } else {
        usedFallback = true;
        middleSummary = buildHermesMiddleNarration(middleTurns);
      }
    } catch {
      usedFallback = true;
      middleSummary = buildHermesMiddleNarration(middleTurns);
    }
  } else {
    usedFallback = true;
    middleSummary = buildHermesMiddleNarration(middleTurns);
  }

  const summaryTurn: TrajectoryTurn = {
    role: 'assistant',
    content: middleSummary,
  };

  const compressedMessages: TrajectoryTurn[] = [
    ...baseHeadMessages,
    ...firstAssistantTurns,
    summaryTurn,
    ...protectedTail,
  ];

  const tokensAfter = estimateTrajectoryTokens(compressedMessages);
  const compressionRatio = Number((tokensAfter / tokensBefore).toFixed(4));

  return {
    compressed: true,
    usedFallback,
    protectedHead: {
      systemPrompt: options.systemPrompt,
      taskBrief: options.taskBrief,
      firstAssistantTurns,
    },
    middleSummary,
    compressedMiddleTurnCount: middleTurns.length,
    protectedTail,
    messages: compressedMessages,
    tokensBefore,
    tokensAfter,
    compressionRatio,
  };
}

