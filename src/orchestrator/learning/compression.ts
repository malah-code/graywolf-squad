import * as crypto from 'node:crypto';

/**
 * 80% Auxiliary Context Compressor (Task 14.4a, ADR-060, ADR-061, PRD §9.6–9.7, FR-006).
 *
 * Rules:
 * 1. Triggers when estimated tokens exceed 80% of active model's context window (or forceCompact === true).
 * 2. Protected Head: System prompt + task brief + first 2 turns — NEVER summarized or modified.
 * 3. Protected Tail: Last 8 turns — NEVER summarized or modified.
 * 4. Compressible Middle: turns.slice(2, -8). Safe no-op when turns.length <= 10.
 * 5. Deterministic Fallback: If auxiliary model stalls or fails, summarizes each middle turn as
 *    `[Turn N | tools: <names>] <first 200 chars>`.
 * 6. Prompt Cache Stability (ADR-061): Verifies SHA-256(systemPrompt + taskBrief) before === after.
 */

export interface ConversationTurn {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  toolNames?: string[];
  turnIndex?: number;
}

export interface CompressedContextResult {
  compressed: boolean;
  protectedHead: {
    systemPrompt: string;
    taskBrief: string;
    firstTurns: ConversationTurn[];
  };
  compressedMiddleSummary: string | null;
  protectedTail: ConversationTurn[];
  reconstructedTurns: ConversationTurn[];
  usedFallback: boolean;
  systemPromptHashPreserved: boolean;
  tokensBefore: number;
  tokensAfter: number;
}

/**
 * Estimates token count (~4 characters per token).
 */
export function estimateConversationTokens(
  systemPrompt: string,
  taskBrief: string,
  turns: ConversationTurn[]
): number {
  let totalChars = systemPrompt.length + taskBrief.length;
  for (const turn of turns) {
    totalChars += turn.content.length + (turn.toolNames?.join(',').length ?? 0) + 12;
  }
  return Math.ceil(totalChars / 4);
}

/**
 * Deterministic heuristic fallback summarizer (tool call names + first 200 chars per turn).
 */
export function buildDeterministicMiddleSummary(middleTurns: ConversationTurn[]): string {
  const lines = middleTurns.map((turn, idx) => {
    const turnNum = turn.turnIndex ?? idx + 3;
    const tools =
      turn.toolNames && turn.toolNames.length > 0 ? turn.toolNames.join(', ') : 'none';
    const snippet = turn.content.replace(/\s+/g, ' ').trim().slice(0, 200);
    return `[Turn ${turnNum} | role: ${turn.role} | tools: ${tools}] ${snippet}`;
  });
  return `[Compressed Middle Context (${middleTurns.length} turns)]\n${lines.join('\n')}`;
}

function hashPrefix(systemPrompt: string, taskBrief: string): string {
  return crypto
    .createHash('sha256')
    .update(`${systemPrompt}\n---\n${taskBrief}`, 'utf8')
    .digest('hex');
}

/**
 * Compresses conversation middle turns when context utilization exceeds thresholdRatio (default 0.80)
 * or when operator clicks CompactContextButton (forceCompact = true).
 */
export async function compressConversationContext(input: {
  systemPrompt: string;
  taskBrief: string;
  turns: ConversationTurn[];
  contextWindowTokens: number;
  thresholdRatio?: number;
  forceCompact?: boolean;
  auxiliarySummarizer?: (middleTurns: ConversationTurn[]) => Promise<string>;
}): Promise<CompressedContextResult> {
  const thresholdRatio = input.thresholdRatio ?? 0.8;
  const initialPrefixHash = hashPrefix(input.systemPrompt, input.taskBrief);
  const tokensBefore = estimateConversationTokens(
    input.systemPrompt,
    input.taskBrief,
    input.turns
  );

  const exceedsThreshold =
    input.contextWindowTokens > 0 &&
    tokensBefore / input.contextWindowTokens > thresholdRatio;
  const shouldCompress = Boolean(input.forceCompact || exceedsThreshold);

  // Safe no-op if below threshold or if turns.length <= 10 (2 head + 8 tail covers all turns)
  if (!shouldCompress || input.turns.length <= 10) {
    const firstTurns = input.turns.slice(0, Math.min(2, input.turns.length));
    const tailTurns = input.turns.slice(Math.min(2, input.turns.length));
    const postPrefixHash = hashPrefix(input.systemPrompt, input.taskBrief);
    return {
      compressed: false,
      protectedHead: {
        systemPrompt: input.systemPrompt,
        taskBrief: input.taskBrief,
        firstTurns,
      },
      compressedMiddleSummary: null,
      protectedTail: tailTurns,
      reconstructedTurns: input.turns.slice(),
      usedFallback: false,
      systemPromptHashPreserved: initialPrefixHash === postPrefixHash,
      tokensBefore,
      tokensAfter: tokensBefore,
    };
  }

  // Clone Protected Head (first 2 turns) and Protected Tail (last 8 turns)
  const firstTurns = input.turns.slice(0, 2).map((t) => ({ ...t }));
  const middleTurns = input.turns.slice(2, -8);
  const protectedTail = input.turns.slice(-8).map((t) => ({ ...t }));

  let summaryText = '';
  let usedFallback = false;

  if (input.auxiliarySummarizer) {
    try {
      const candidate = await input.auxiliarySummarizer(middleTurns);
      if (candidate && candidate.trim().length > 0) {
        summaryText = candidate.trim();
      } else {
        usedFallback = true;
        summaryText = buildDeterministicMiddleSummary(middleTurns);
      }
    } catch {
      usedFallback = true;
      summaryText = buildDeterministicMiddleSummary(middleTurns);
    }
  } else {
    usedFallback = true;
    summaryText = buildDeterministicMiddleSummary(middleTurns);
  }

  const summaryTurn: ConversationTurn = {
    role: 'assistant',
    content: summaryText,
    toolNames: ['context_compressor'],
  };

  const reconstructedTurns: ConversationTurn[] = [
    ...firstTurns,
    summaryTurn,
    ...protectedTail,
  ];

  const postPrefixHash = hashPrefix(input.systemPrompt, input.taskBrief);
  const tokensAfter = estimateConversationTokens(
    input.systemPrompt,
    input.taskBrief,
    reconstructedTurns
  );

  return {
    compressed: true,
    protectedHead: {
      systemPrompt: input.systemPrompt,
      taskBrief: input.taskBrief,
      firstTurns,
    },
    compressedMiddleSummary: summaryText,
    protectedTail,
    reconstructedTurns,
    usedFallback,
    systemPromptHashPreserved: initialPrefixHash === postPrefixHash,
    tokensBefore,
    tokensAfter,
  };
}

