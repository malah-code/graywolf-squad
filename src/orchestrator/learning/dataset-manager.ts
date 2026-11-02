import * as fs from 'node:fs/promises';
import * as path from 'node:path';

/**
 * Multi-Layer Privacy Redactor, Monthly JSONL Rotation, Retention Pruner & Dataset Exporter
 * (Phase 19, Task 19.2, ADR-064, ADR-079, FR-004, FR-005, FR-006, SC-003).
 */

export interface PersistedTrajectoryMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: {
      name: string;
      arguments: string;
    };
  }>;
  tool_call_id?: string;
}

export interface PersistedTrajectoryRecord {
  messages: PersistedTrajectoryMessage[];
  metadata: {
    taskId: string;
    projectId: string;
    workspaceId: string;
    modelAlias: string;
    split: 'train' | 'eval';
    strikes: 0;
    agreedP0P1Findings: 0;
    compressed: boolean;
    compressedMiddleTurnCount: number;
    tokensBefore: number;
    tokensAfter: number;
    compressionRatio: number;
    redactionCount: number;
    harvestedAt: string;
  };
}

export interface ShareGptTrajectoryRecord {
  conversations: Array<{
    from: 'system' | 'human' | 'gpt';
    value: string;
  }>;
  metadata: PersistedTrajectoryRecord['metadata'];
}

export interface DatasetStatsSummary {
  projectId: string;
  totalTrajectories: number;
  trainCount: number;
  evalCount: number;
  months: Array<{
    month: string;
    count: number;
  }>;
  totalTokensBefore: number;
  totalTokensAfter: number;
  totalRedactions: number;
}

const PRIVACY_SCRUB_PATTERNS: Array<{ regex: RegExp; replacement: string }> = [
  // PEM private key blocks
  {
    regex: /-----BEGIN [A-Z0-9\s]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9\s]*PRIVATE KEY-----/g,
    replacement: '<REDACTED_PRIVATE_KEY>',
  },
  // PostgreSQL / Redis / Valkey / MySQL / MongoDB connection URLs
  {
    regex: /\b(?:postgres(?:ql)?|redis|valkey|mysql|mongodb(?:\+srv)?):\/\/[^\s"'`]+/gi,
    replacement: '<REDACTED_DB_URL>',
  },
  // Git remote URLs (HTTPS with embedded credentials or .git suffix, or SSH git@host:org/repo.git)
  {
    regex: /\b(?:https?:\/\/[^\s/@"'`]+@[^\s"'`]+\.git|https?:\/\/(?:github\.com|gitlab\.com|bitbucket\.org)\/[^\s"'`]+\.git|git@[a-zA-Z0-9.-]+:[a-zA-Z0-9._/-]+\.git)\b/gi,
    replacement: '<REDACTED_GIT_REMOTE>',
  },
  // OpenAI, Anthropic, GitHub, GitLab, Slack, AWS style API keys & tokens
  {
    regex: /\b(?:sk-[a-zA-Z0-9_-]{12,}|ghp_[a-zA-Z0-9]{12,}|ghs_[a-zA-Z0-9]{12,}|glpat-[a-zA-Z0-9_-]{12,}|xox[baprs]-[a-zA-Z0-9-]{10,}|AKIA[0-9A-Z]{16})\b/g,
    replacement: '<REDACTED_SECRET>',
  },
  // Bearer / JWT Authorization tokens
  {
    regex: /\bBearer\s+[A-Za-z0-9\-._~+/]+=*/gi,
    replacement: 'Bearer <REDACTED_TOKEN>',
  },
  // .env style secret assignments (API_KEY=..., SECRET=..., PASSWORD=..., TOKEN=...)
  {
    regex: /\b([A-Z0-9_]*(?:SECRET|PASSWORD|TOKEN|API_KEY|PRIVATE_KEY)[A-Z0-9_]*)\s*=\s*['"]?[^\s'"\n]+['"]?/g,
    replacement: '$1=<REDACTED_SECRET>',
  },
];

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Multi-layer privacy redaction gate (FR-004, SC-003).
 * Scrubs workspace root prefixes, git remotes, API keys, Bearer tokens, DB URLs,
 * PEM private keys, and project-configured `sensitiveIdentifiers` while preserving
 * relative repository subpaths (e.g. `src/orchestrator/index.ts`).
 */
export function redactTrajectoryPrivacy(
  rawText: string,
  options?: {
    workspaceRoot?: string;
    sensitiveIdentifiers?: string[];
  }
): { scrubbedText: string; redactionCount: number } {
  let text = rawText;
  let redactionCount = 0;

  // 1. Scrub configured workspaceRoot prefix (preserving trailing relative subpath)
  if (options?.workspaceRoot && options.workspaceRoot.trim().length > 1) {
    const cleanRoot = options.workspaceRoot.trim().replace(/\/+$/, '');
    const rootRegex = new RegExp(escapeRegExp(cleanRoot), 'g');
    const matches = text.match(rootRegex);
    if (matches && matches.length > 0) {
      redactionCount += matches.length;
      text = text.replace(rootRegex, '<REDACTED_PATH>');
    }
  }

  // Also scrub standard absolute host/container workspace roots (/workspace/<repo> or /home/<user>/<repo>)
  const defaultAbsPathRegex = /(?:\b|^)\/(?:workspace\/[a-zA-Z0-9._-]+|home\/[a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+)(?=\/|\b)/g;
  const absMatches = text.match(defaultAbsPathRegex);
  if (absMatches && absMatches.length > 0) {
    redactionCount += absMatches.length;
    text = text.replace(defaultAbsPathRegex, '<REDACTED_PATH>');
  }

  // 2. Scrub standard secret, DB URL, git remote, Bearer, and PEM patterns
  for (const { regex, replacement } of PRIVACY_SCRUB_PATTERNS) {
    const matches = text.match(regex);
    if (matches && matches.length > 0) {
      redactionCount += matches.length;
      text = text.replace(regex, replacement);
    }
  }

  // 3. Scrub project-configured sensitiveIdentifiers
  if (options?.sensitiveIdentifiers && options.sensitiveIdentifiers.length > 0) {
    for (const identifier of options.sensitiveIdentifiers) {
      const clean = identifier.trim();
      if (clean.length < 2) continue;
      const escaped = escapeRegExp(clean);
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
 * Converts an OpenAI-compatible `PersistedTrajectoryRecord` into ShareGPT conversation format (FR-006).
 */
export function convertToShareGptFormat(
  record: PersistedTrajectoryRecord
): ShareGptTrajectoryRecord {
  const conversations: ShareGptTrajectoryRecord['conversations'] = record.messages.map(
    (msg) => {
      if (msg.role === 'system') {
        return { from: 'system', value: msg.content };
      }
      if (msg.role === 'user') {
        return { from: 'human', value: msg.content };
      }
      if (msg.role === 'tool') {
        return {
          from: 'gpt',
          value: `<tool_call>{"tool_call_id":${JSON.stringify(msg.tool_call_id ?? 'tool')},"output":${JSON.stringify(msg.content)}}</tool_call>`,
        };
      }
      // assistant role
      if (msg.tool_calls && msg.tool_calls.length > 0) {
        const serializedCalls = msg.tool_calls
          .map(
            (tc) =>
              `<tool_call>${JSON.stringify({
                id: tc.id,
                name: tc.function.name,
                arguments: tc.function.arguments,
              })}</tool_call>`
          )
          .join('\n');
        const combined = [msg.content, serializedCalls].filter(Boolean).join('\n');
        return { from: 'gpt', value: combined };
      }
      return { from: 'gpt', value: msg.content };
    }
  );

  return {
    conversations,
    metadata: record.metadata,
  };
}

/**
 * Persists a scrubbed trajectory record to `.agents/dataset/trajectories/YYYY-MM/<taskId>.jsonl`.
 */
export async function persistTrajectoryRecord(
  record: PersistedTrajectoryRecord,
  options?: {
    outputBaseDir?: string;
    month?: string;
  }
): Promise<{ filePath: string; monthDir: string }> {
  const baseDir =
    options?.outputBaseDir ?? path.join('.agents', 'dataset', 'trajectories');
  const yearMonth =
    options?.month ?? record.metadata.harvestedAt.slice(0, 7);
  const monthDir = path.join(baseDir, yearMonth);

  await fs.mkdir(monthDir, { recursive: true });
  const filePath = path.join(monthDir, `${record.metadata.taskId}.jsonl`);
  await fs.writeFile(filePath, `${JSON.stringify(record)}\n`, 'utf8');

  return { filePath, monthDir };
}

/**
 * Prunes monthly trajectory directories (`YYYY-MM`) older than `retentionMonths` relative to `referenceDate` (FR-005).
 */
export async function pruneExpiredTrajectoryMonths(
  outputBaseDir: string,
  retentionMonths: number,
  referenceDate: Date = new Date()
): Promise<{ prunedMonths: string[]; keptMonths: string[] }> {
  const prunedMonths: string[] = [];
  const keptMonths: string[] = [];

  let entries: string[] = [];
  try {
    entries = await fs.readdir(outputBaseDir);
  } catch {
    return { prunedMonths, keptMonths };
  }

  const refYear = referenceDate.getUTCFullYear();
  const refMonth = referenceDate.getUTCMonth() + 1; // 1..12

  for (const entry of entries.sort()) {
    const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(entry);
    if (!match) continue;

    const dirYear = Number(match[1]);
    const dirMonth = Number(match[2]);
    const monthDiff = (refYear - dirYear) * 12 + (refMonth - dirMonth);

    if (monthDiff >= retentionMonths) {
      await fs.rm(path.join(outputBaseDir, entry), { recursive: true, force: true });
      prunedMonths.push(entry);
    } else {
      keptMonths.push(entry);
    }
  }

  return { prunedMonths, keptMonths };
}

/**
 * Loads all persisted trajectory records for a given project (optionally filtered by `month` and `split`).
 */
export async function loadProjectTrajectoryRecords(options: {
  projectId: string;
  outputBaseDir?: string;
  month?: string;
  split?: 'train' | 'eval' | 'all';
}): Promise<Array<{ month: string; record: PersistedTrajectoryRecord }>> {
  const baseDir =
    options.outputBaseDir ?? path.join('.agents', 'dataset', 'trajectories');

  let monthDirs: string[] = [];
  try {
    monthDirs = (await fs.readdir(baseDir)).filter((d) =>
      /^\d{4}-(0[1-9]|1[0-2])$/.test(d)
    );
  } catch {
    return [];
  }

  if (options.month) {
    monthDirs = monthDirs.filter((d) => d === options.month);
  }

  monthDirs.sort();

  const results: Array<{ month: string; record: PersistedTrajectoryRecord }> = [];

  for (const month of monthDirs) {
    const monthPath = path.join(baseDir, month);
    let files: string[] = [];
    try {
      files = (await fs.readdir(monthPath)).filter((f) => f.endsWith('.jsonl'));
    } catch {
      continue;
    }

    files.sort();
    for (const file of files) {
      const content = await fs.readFile(path.join(monthPath, file), 'utf8');
      for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const parsed = JSON.parse(trimmed) as PersistedTrajectoryRecord;
          if (
            parsed.metadata?.projectId &&
            parsed.metadata.projectId !== options.projectId
          ) {
            continue;
          }
          if (
            options.split &&
            options.split !== 'all' &&
            parsed.metadata?.split !== options.split
          ) {
            continue;
          }
          results.push({ month, record: parsed });
        } catch {
          // Ignore malformed lines
        }
      }
    }
  }

  return results;
}

/**
 * Computes aggregated dataset statistics for a project (FR-007).
 */
export async function getDatasetStats(
  projectId: string,
  outputBaseDir?: string
): Promise<DatasetStatsSummary> {
  const items = await loadProjectTrajectoryRecords({
    projectId,
    outputBaseDir,
  });

  const monthCounts = new Map<string, number>();
  let trainCount = 0;
  let evalCount = 0;
  let totalTokensBefore = 0;
  let totalTokensAfter = 0;
  let totalRedactions = 0;

  for (const { month, record } of items) {
    monthCounts.set(month, (monthCounts.get(month) ?? 0) + 1);
    if (record.metadata.split === 'eval') {
      evalCount += 1;
    } else {
      trainCount += 1;
    }
    totalTokensBefore += record.metadata.tokensBefore ?? 0;
    totalTokensAfter += record.metadata.tokensAfter ?? 0;
    totalRedactions += record.metadata.redactionCount ?? 0;
  }

  const months = Array.from(monthCounts.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, count]) => ({ month, count }));

  return {
    projectId,
    totalTrajectories: items.length,
    trainCount,
    evalCount,
    months,
    totalTokensBefore,
    totalTokensAfter,
    totalRedactions,
  };
}

/**
 * Exports project trajectories as consolidated JSONL in either `openai` or `sharegpt` format (FR-006, FR-007).
 */
export async function exportDatasetJsonl(options: {
  projectId: string;
  format?: 'openai' | 'sharegpt';
  split?: 'train' | 'eval' | 'all';
  month?: string;
  outputBaseDir?: string;
}): Promise<{
  projectId: string;
  format: 'openai' | 'sharegpt';
  split: 'train' | 'eval' | 'all';
  count: number;
  jsonl: string;
}> {
  const format = options.format ?? 'openai';
  const split = options.split ?? 'all';

  const items = await loadProjectTrajectoryRecords({
    projectId: options.projectId,
    outputBaseDir: options.outputBaseDir,
    month: options.month,
    split,
  });

  const lines = items.map(({ record }) => {
    if (format === 'sharegpt') {
      return JSON.stringify(convertToShareGptFormat(record));
    }
    return JSON.stringify(record);
  });

  return {
    projectId: options.projectId,
    format,
    split,
    count: lines.length,
    jsonl: lines.length > 0 ? `${lines.join('\n')}\n` : '',
  };
}

