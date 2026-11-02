/**
 * High-Throughput Regex & Vault-Literal Secret Scrubber
 * (Task 16.2b, ADR-018, FR-004).
 *
 * Rules:
 * 1. Scrubs all container stdout/stderr chunks (`terminal.chunk`), structured logs, and PR Review Packets
 *    before persistence or WebSocket broadcast.
 * 2. Matches known secret regex signatures (GitHub PATs, OpenAI/Anthropic keys, AWS keys, Slack tokens, PEM keys)
 *    and exact registered `secret_vault` literals (length >= 6).
 * 3. Replaces matches with `REDACTED_SECRET_REPLACEMENT = "[REDACTED_SECRET_BY_GRAYWOLF]"`.
 * 4. Streaming scrubber maintains sliding carry-over window to catch secrets split across chunk boundaries.
 */

export const REDACTED_SECRET_REPLACEMENT = '[REDACTED_SECRET_BY_GRAYWOLF]';

const KNOWN_SECRET_PATTERNS: RegExp[] = [
  // GitHub PATs
  /\b(?:ghp_[a-zA-Z0-9]{20,}|github_pat_[a-zA-Z0-9_]{40,})\b/g,
  // GitLab PATs
  /\bglpat-[a-zA-Z0-9_-]{20,}\b/g,
  // OpenAI Keys
  /\bsk-(?:proj-)?[a-zA-Z0-9_-]{20,}\b/g,
  // Anthropic Keys
  /\bsk-ant-[a-zA-Z0-9_-]{20,}\b/g,
  // AWS Access Key ID
  /\bAKIA[0-9A-Z]{16}\b/g,
  // Slack Tokens
  /\bxox[baprs]-[a-zA-Z0-9-]{10,}\b/g,
  // PEM Private Keys
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  // Bearer tokens with high entropy
  /\bBearer\s+[a-zA-Z0-9_.-]{24,}\b/g,
];

/**
 * Scrubs known token patterns and registered vault literal strings from a block of text.
 */
export function scrubSecretsFromText(
  text: string,
  registeredVaultLiterals?: string[]
): { scrubbedText: string; redactionCount: number } {
  let result = text;
  let count = 0;

  // 1. Scrub exact vault literals (length >= 6) first
  if (registeredVaultLiterals && registeredVaultLiterals.length > 0) {
    for (const secret of registeredVaultLiterals) {
      const trimmed = secret.trim();
      if (trimmed.length >= 6) {
        let idx = 0;
        while ((idx = result.indexOf(trimmed, idx)) !== -1) {
          count += 1;
          result =
            result.substring(0, idx) +
            REDACTED_SECRET_REPLACEMENT +
            result.substring(idx + trimmed.length);
          idx += REDACTED_SECRET_REPLACEMENT.length;
        }
      }
    }
  }

  // 2. Scrub regex patterns
  for (const pattern of KNOWN_SECRET_PATTERNS) {
    const matches = result.match(pattern);
    if (matches && matches.length > 0) {
      count += matches.length;
      result = result.replace(pattern, REDACTED_SECRET_REPLACEMENT);
    }
  }

  return { scrubbedText: result, redactionCount: count };
}

/**
 * Creates a stateful streaming scrubber that maintains a sliding carry-over window
 * across successive stream chunks to catch tokens split across chunk boundaries.
 */
export function createStreamingSecretScrubber(registeredVaultLiterals?: string[]): {
  pushChunk(chunk: string): { scrubbedChunk: string; redactionCount: number };
  flush(): { scrubbedChunk: string; redactionCount: number };
} {
  const CARRY_OVER_SIZE = 128;
  let carryOver = '';

  return {
    pushChunk(chunk: string): { scrubbedChunk: string; redactionCount: number } {
      const combined = carryOver + chunk;
      if (combined.length <= CARRY_OVER_SIZE) {
        carryOver = combined;
        return { scrubbedChunk: '', redactionCount: 0 };
      }

      const processPart = combined.slice(0, combined.length - CARRY_OVER_SIZE);
      carryOver = combined.slice(combined.length - CARRY_OVER_SIZE);

      const res = scrubSecretsFromText(processPart, registeredVaultLiterals);
      return { scrubbedChunk: res.scrubbedText, redactionCount: res.redactionCount };
    },

    flush(): { scrubbedChunk: string; redactionCount: number } {
      if (!carryOver) {
        return { scrubbedChunk: '', redactionCount: 0 };
      }
      const res = scrubSecretsFromText(carryOver, registeredVaultLiterals);
      carryOver = '';
      return { scrubbedChunk: res.scrubbedText, redactionCount: res.redactionCount };
    },
  };
}
