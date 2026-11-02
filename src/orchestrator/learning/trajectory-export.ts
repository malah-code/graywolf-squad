import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import {
  compressConversationContext,
  type ConversationTurn,
} from './compression';

/**
 * Opt-In Fine-Tuning Trajectory Exporter (Task 14.4c, ADR-064, PRD §9.11, FR-007).
 *
 * Rules:
 * 1. Opt-in only (`datasetCollectEnabled === true`, default `false`).
 * 2. Exports only 0-strike successful trajectories (`strikes === 0 && agreedHighSeverityFindings === 0`).
 * 3. Compresses middle turns using Protect-Head / Protect-Tail / Summarize-Middle.
 * 4. Applies deterministic multi-pattern scrubber across all turns (redacting API keys, Bearer/JWT tokens,
 *    database URLs, PEM private keys, .env secret assignments, and replacing sensitiveIdentifiers with `<REDACTED_PROJECT>`).
 * 5. Writes OpenAI-compatible JSONL to `.agents/dataset/trajectories/YYYY-MM/<taskId>.jsonl`.
 */

export interface TrajectoryJsonlEntry {
  messages: Array<{
    role: 'system' | 'user' | 'assistant' | 'tool';
    content: string;
  }>;
  metadata: {
    taskId: string;
    modelAlias: string;
    strikes: 0;
    compressed: boolean;
    redactionCount: number;
    exportedAt: string;
  };
}

const SECRET_SCRUB_PATTERNS: Array<{ regex: RegExp; replacement: string }> = [
  // OpenAI, GitHub, GitLab, Slack, Anthropic style keys
  {
    regex: /\b(?:sk-[a-zA-Z0-9_-]{12,}|ghp_[a-zA-Z0-9]{12,}|glpat-[a-zA-Z0-9_-]{12,}|xox[baprs]-[a-zA-Z0-9-]{10,})\b/g,
    replacement: '<REDACTED_SECRET>',
  },
  // Bearer / JWT Authorization tokens
  {
    regex: /\bBearer\s+[A-Za-z0-9\-._~+/]+=*/gi,
    replacement: 'Bearer <REDACTED_TOKEN>',
  },
  // PostgreSQL / Redis / Valkey connection URLs with credentials
  {
    regex: /\b(?:postgres(?:ql)?|redis|valkey):\/\/[^\s"'`]+/gi,
    replacement: '<REDACTED_DB_URL>',
  },
  // PEM private key blocks
  {
    regex: /-----BEGIN [A-Z0-9\s]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9\s]*PRIVATE KEY-----/g,
    replacement: '<REDACTED_PRIVATE_KEY>',
  },
  // .env style secret assignments (API_KEY=..., SECRET=..., PASSWORD=..., TOKEN=...)
  {
    regex: /\b([A-Z0-9_]*(?:SECRET|PASSWORD|TOKEN|API_KEY|PRIVATE_KEY)[A-Z0-9_]*)\s*=\s*['"]?[^\s'"\n]+['"]?/g,
    replacement: '$1=<REDACTED_SECRET>',
  },
];

/**
 * Scrubs credentials, tokens, connection strings, PEM blocks, and project-sensitive identifiers.
 */
export function scrubTrajectorySecrets(
  rawText: string,
  sensitiveIdentifiers?: string[]
): { scrubbedText: string; redactionCount: number } {
  let text = rawText;
  let redactionCount = 0;

  for (const { regex, replacement } of SECRET_SCRUB_PATTERNS) {
    const matches = text.match(regex);
    if (matches && matches.length > 0) {
      redactionCount += matches.length;
      text = text.replace(regex, replacement);
    }
  }

  if (sensitiveIdentifiers && sensitiveIdentifiers.length > 0) {
    for (const identifier of sensitiveIdentifiers) {
      const clean = identifier.trim();
      if (clean.length < 2) continue;
      const escaped = clean.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const prefixBoundary = /^\w/.test(clean) ? '\\b' : '';
      const suffixBoundary = /\w$/.test(clean) ? '\\b' : '';
      const idRegex = new RegExp(`${prefixBoundary}${escaped}${suffixBoundary}`, 'gi');
      const matches = text.match(idRegex);
      if (matches && matches.length > 0) {
        redactionCount += matches.length;
        text = text.replace(idRegex, '<REDACTED_PROJECT>');
      }
    }
  }

  return { scrubbedText: text, redactionCount };
}

/**
 * Exports a 0-strike successful task trajectory as OpenAI-compatible JSONL when dataset.collect = true.
 */
export async function exportFineTuningTrajectory(input: {
  taskId: string;
  modelAlias: string;
  datasetCollectEnabled: boolean;
  strikes: number;
  agreedHighSeverityFindings: number;
  systemPrompt: string;
  taskBrief: string;
  turns: ConversationTurn[];
  sensitiveIdentifiers?: string[];
  outputBaseDir?: string;
  now?: Date;
}): Promise<{
  exported: boolean;
  filePath: string | null;
  entry: TrajectoryJsonlEntry | null;
  reason?: string;
}> {
  if (!input.datasetCollectEnabled) {
    return {
      exported: false,
      filePath: null,
      entry: null,
      reason: 'dataset.collect is disabled (default false).',
    };
  }

  if (input.strikes > 0 || input.agreedHighSeverityFindings > 0) {
    return {
      exported: false,
      filePath: null,
      entry: null,
      reason: 'Task incurred strikes or P0/P1 findings; only 0-strike trajectories qualify.',
    };
  }

  // Compress middle turns if > 10 turns
  const compressionResult = await compressConversationContext({
    systemPrompt: input.systemPrompt,
    taskBrief: input.taskBrief,
    turns: input.turns,
    contextWindowTokens: 1000,
    forceCompact: input.turns.length > 10,
  });

  let totalRedactions = 0;
  const scrub = (val: string): string => {
    const res = scrubTrajectorySecrets(val, input.sensitiveIdentifiers);
    totalRedactions += res.redactionCount;
    return res.scrubbedText;
  };

  const messages: TrajectoryJsonlEntry['messages'] = [
    {
      role: 'system',
      content: scrub(`${input.systemPrompt}\n\n${input.taskBrief}`),
    },
    ...compressionResult.reconstructedTurns.map((t) => ({
      role: t.role,
      content: scrub(t.content),
    })),
  ];

  const now = input.now ?? new Date();
  const yearMonth = now.toISOString().slice(0, 7); // YYYY-MM
  const baseDir = input.outputBaseDir ?? path.join('.agents', 'dataset', 'trajectories');
  const monthDir = path.join(baseDir, yearMonth);
  await fs.mkdir(monthDir, { recursive: true });

  const entry: TrajectoryJsonlEntry = {
    messages,
    metadata: {
      taskId: input.taskId,
      modelAlias: input.modelAlias,
      strikes: 0,
      compressed: compressionResult.compressed,
      redactionCount: totalRedactions,
      exportedAt: now.toISOString(),
    },
  };

  const filePath = path.join(monthDir, `${input.taskId}.jsonl`);
  await fs.writeFile(filePath, `${JSON.stringify(entry)}\n`, 'utf8');

  return {
    exported: true,
    filePath,
    entry,
  };
}

