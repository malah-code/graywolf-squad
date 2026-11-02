import { ExtractedFileIndex } from '../recon/ast-indexer';

/**
 * Layer 1 — PageRank-sorted topological repository map (FR-003).
 * Files are included strictly in descending PageRank order until the token
 * budget (default 1,500 tokens, ~4 chars/token heuristic) is exhausted.
 */

const CHARS_PER_TOKEN = 4;
const MAX_SYMBOLS_PER_FILE = 10;

export interface TopologicalRepoMapResult {
  markdown: string;
  estimatedTokens: number;
  includedFiles: string[];
}

export function generateTopologicalRepoMap(options: {
  fileIndices: ExtractedFileIndex[];
  pageRankScores: Record<string, number>;
  maxTokens?: number;
}): TopologicalRepoMapResult {
  const maxTokens = options.maxTokens ?? 1500;
  const maxChars = maxTokens * CHARS_PER_TOKEN;

  const files = [...options.fileIndices].sort((a, b) => {
    const delta =
      (options.pageRankScores[b.filePath] ?? 0) - (options.pageRankScores[a.filePath] ?? 0);
    if (delta !== 0) return delta;
    return a.filePath.localeCompare(b.filePath);
  });

  const header = '# Repository Map (PageRank-ordered)';
  const lines: string[] = [header];
  const includedFiles: string[] = [];
  let totalChars = header.length;

  for (const file of files) {
    const score = (options.pageRankScores[file.filePath] ?? 0).toFixed(6);
    const fileLine = `- \`${file.filePath}\` (PR ${score})`;
    const symbolLines = file.symbols
      .slice(0, MAX_SYMBOLS_PER_FILE)
      .map(
        (symbol) =>
          `  - ${symbol.exported ? 'export ' : ''}${symbol.kind} \`${symbol.name}\` L${symbol.lineStart}-L${symbol.lineEnd}`
      );
    if (file.symbols.length > MAX_SYMBOLS_PER_FILE) {
      symbolLines.push(`  - ... (+${file.symbols.length - MAX_SYMBOLS_PER_FILE} more symbols)`);
    }
    const blockChars = [fileLine, ...symbolLines].reduce(
      (sum, line) => sum + line.length + 1,
      0
    );
    if (totalChars + blockChars > maxChars) break;
    totalChars += blockChars;
    lines.push(fileLine, ...symbolLines);
    includedFiles.push(file.filePath);
  }

  return {
    markdown: lines.join('\n'),
    estimatedTokens: Math.ceil(totalChars / CHARS_PER_TOKEN),
    includedFiles,
  };
}
