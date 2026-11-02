import { SingleGuardResult, GuardCheckViolation } from './guard-types';

/**
 * Deterministic Clean-Code Guard (Task 10.2a, ADR-083 & F14, FR-002).
 * Inspects added lines in `changes.patch` for:
 *  (a) empty `catch` blocks / swallowed errors,
 *  (b) unhandled floating promises (`.then(` without `.catch(` and no await),
 *  (c) zombie commented-out code blocks (`>= 5` consecutive commented lines),
 *  (d) hallucinated/unlisted package imports validated strictly against the
 *      orchestrator-side `recon-report.json` dependency allowlist (F14).
 * Runs with 0 LLM tokens in single-digit milliseconds (SC-002).
 */

export interface PatchAddedLine {
  filePath: string;
  /** 1-based line number in the new file version. */
  line: number;
  /** Added text WITHOUT the leading `+`. */
  text: string;
}

export interface PatchFileInfo {
  filePath: string;
  addedLines: PatchAddedLine[];
}

/**
 * Minimal unified-diff parser: extracts per-file added lines with accurate
 * new-file line numbers from hunk headers. Shared by the three guards.
 */
export function parsePatchAddedLines(patchContent: string): PatchFileInfo[] {
  const files: PatchFileInfo[] = [];
  let current: PatchFileInfo | null = null;
  let newLine = 0;

  for (const rawLine of patchContent.split('\n')) {
    if (rawLine.startsWith('+++ ')) {
      const filePath = rawLine
        .slice(4)
        .replace(/^b\//, '')
        .replace(/^"|"$/g, '')
        .trim();
      current = { filePath, addedLines: [] };
      files.push(current);
      continue;
    }
    if (rawLine.startsWith('@@')) {
      const match = rawLine.match(/\+(\d+)(?:,(\d+))?/);
      newLine = match ? Number(match[1]) : 0;
      continue;
    }
    if (!current) continue;
    if (rawLine.startsWith('\\')) {
      // Diff metadata line (e.g. \ No newline at end of file) — do not advance line cursor
      continue;
    }
    if (rawLine.startsWith('+') && !rawLine.startsWith('+++')) {
      current.addedLines.push({ filePath: current.filePath, line: newLine, text: rawLine.slice(1) });
      newLine += 1;
    } else if (!rawLine.startsWith('-')) {
      // Context line advances the new-file cursor
      newLine += 1;
    }
  }
  return files;
}

const NON_CODE_FILE_RE = /\.(?:md|markdown|txt|json|ya?ml|toml|lock|png|jpe?g|gif|svg|ico)$/i;

const CATCH_OPEN_RE = /catch\s*(?:\([^)]*\))?\s*\{/;
const COMMENT_OR_EMPTY_RE = /^\s*(?:\/\/.*|\/\*.*|\*.*|\*\/.*)?$/;

function isEmptyOrCommentOnly(text: string): boolean {
  return COMMENT_OR_EMPTY_RE.test(text);
}

function findEmptyCatchBlocks(files: PatchFileInfo[]): GuardCheckViolation[] {
  const violations: GuardCheckViolation[] = [];
  for (const file of files) {
    const lines = file.addedLines;
    for (let i = 0; i < lines.length; i++) {
      const text = lines[i].text;
      const catchMatch = text.match(CATCH_OPEN_RE);
      if (!catchMatch) continue;

      const afterOpen = text.slice((catchMatch.index ?? 0) + catchMatch[0].length);
      // Single-line empty catch: `catch (e) {}`
      if (/^\s*\}\s*$/.test(afterOpen)) {
        violations.push({
          rule: 'GUARD_CLEAN_CODE_FAILED:empty-catch-block',
          filePath: file.filePath,
          line: lines[i].line,
          message: 'Empty catch block swallows the error without handling or rethrowing',
        });
        continue;
      }
      // Single-line comment-only catch: `catch (e) { /* ignored */ }`
      if (/^\s*(?:\/\/|\/\*).*\}\s*$/.test(afterOpen) && !/\bthrow\b|\breturn\b|console\./.test(afterOpen)) {
        violations.push({
          rule: 'GUARD_CLEAN_CODE_FAILED:empty-catch-block',
          filePath: file.filePath,
          line: lines[i].line,
          message: 'Comment-only catch block swallows the error without handling',
        });
        continue;
      }
      // Multi-line: scan forward until the block closes
      let j = i + 1;
      let sawRealCode = afterOpen.trim() !== '' && !isEmptyOrCommentOnly(afterOpen);
      let closed = false;
      while (j < lines.length) {
        const body = lines[j].text;
        if (body.includes('}')) {
          const beforeClose = body.slice(0, body.indexOf('}'));
          if (!isEmptyOrCommentOnly(beforeClose)) sawRealCode = true;
          closed = true;
          break;
        }
        if (!isEmptyOrCommentOnly(body)) sawRealCode = true;
        j += 1;
      }
      if (closed && !sawRealCode) {
        violations.push({
          rule: 'GUARD_CLEAN_CODE_FAILED:empty-catch-block',
          filePath: file.filePath,
          line: lines[i].line,
          message: 'Empty or comment-only catch block swallows the error without handling',
        });
      }
    }
  }
  return violations;
}

function findFloatingPromises(files: PatchFileInfo[]): GuardCheckViolation[] {
  const violations: GuardCheckViolation[] = [];
  for (const file of files) {
    for (const added of file.addedLines) {
      const text = added.text;
      if (!text.includes('.then(')) continue;
      if (text.includes('.catch(')) continue;
      if (/^\s*(?:await|return|void)\b/.test(text)) continue;
      violations.push({
        rule: 'GUARD_CLEAN_CODE_FAILED:floating-promise',
        filePath: file.filePath,
        line: added.line,
        message: 'Unhandled floating promise: .then() chain without .catch(), await, or return',
      });
    }
  }
  return violations;
}

function findZombieCommentBlocks(files: PatchFileInfo[]): GuardCheckViolation[] {
  const violations: GuardCheckViolation[] = [];
  const ZOMBIE_MIN_LINES = 5;
  for (const file of files) {
    const lines = file.addedLines;
    let runStart = -1;
    let runLength = 0;
    const flush = (endIndex: number): void => {
      if (runLength >= ZOMBIE_MIN_LINES) {
        violations.push({
          rule: 'GUARD_CLEAN_CODE_FAILED:zombie-commented-code',
          filePath: file.filePath,
          line: lines[runStart].line,
          message: `Zombie commented-out code block (${runLength} consecutive commented lines, ends at L${lines[endIndex - 1].line})`,
        });
      }
      runStart = -1;
      runLength = 0;
    };
    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].text.trim();
      if (trimmed.startsWith('//')) {
        if (runStart < 0) runStart = i;
        runLength += 1;
      } else if (runStart >= 0) {
        flush(i);
      }
    }
    if (runStart >= 0) flush(lines.length);
  }
  return violations;
}

const IMPORT_FROM_RE = /^[ \t]*import\b[^;]*?from\s*['"]([^'"]+)['"]/;
const SIDE_EFFECT_IMPORT_RE = /^[ \t]*import\s*['"]([^'"]+)['"]/;
const REQUIRE_SPECIFIER_RE = /require\(\s*['"]([^'"]+)['"]\s*\)/;

/** Extracts the base package name from a bare specifier ('@scope/pkg/sub' -> '@scope/pkg'). */
export function dependencyBaseName(specifier: string): string {
  if (specifier.startsWith('@')) {
    const parts = specifier.split('/');
    return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : specifier;
  }
  return specifier.split('/')[0];
}

function findHallucinatedImports(
  files: PatchFileInfo[],
  allowedDependencies?: string[]
): GuardCheckViolation[] {
  if (!allowedDependencies) return [];
  const allowed = new Set(
    allowedDependencies.map((dep) => dep).concat(allowedDependencies.map((dep) => dependencyBaseName(dep)))
  );
  const violations: GuardCheckViolation[] = [];

  for (const file of files) {
    for (const added of file.addedLines) {
      const text = added.text;
      const match =
        text.match(IMPORT_FROM_RE) ??
        text.match(SIDE_EFFECT_IMPORT_RE) ??
        (REQUIRE_SPECIFIER_RE.test(text) ? text.match(REQUIRE_SPECIFIER_RE) : null);
      if (!match) continue;
      const specifier = match[1];
      // Relative paths are internal modules (not package imports); node: builtins are always allowed
      if (specifier.startsWith('.') || specifier.startsWith('/') || specifier.startsWith('node:')) continue;
      const base = dependencyBaseName(specifier);
      if (allowed.has(specifier) || allowed.has(base)) continue;
      violations.push({
        rule: 'GUARD_CLEAN_CODE_FAILED:hallucinated-import',
        filePath: file.filePath,
        line: added.line,
        message: `Import '${specifier}' is not in the orchestrator-side recon-report.json dependency allowlist (F14)`,
      });
    }
  }
  return violations;
}

export function evaluateCleanCodeGuard(options: {
  patchContent: string;
  /** Sourced strictly from orchestrator-side recon-report.json (F14). */
  allowedDependencies?: string[];
}): SingleGuardResult {
  const files = parsePatchAddedLines(options.patchContent);
  const codeFiles = files.filter((file) => !NON_CODE_FILE_RE.test(file.filePath));

  const emptyCatch = findEmptyCatchBlocks(codeFiles);
  const floatingPromises = findFloatingPromises(codeFiles);
  const zombieCode = findZombieCommentBlocks(codeFiles);
  const hallucinatedImports = findHallucinatedImports(codeFiles, options.allowedDependencies);

  const violations = [...emptyCatch, ...floatingPromises, ...zombieCode, ...hallucinatedImports];

  return {
    guard: 'clean-code',
    passed: violations.length === 0,
    checks: [
      { label: 'no-empty-catch-blocks', passed: emptyCatch.length === 0 },
      { label: 'no-floating-promises', passed: floatingPromises.length === 0 },
      { label: 'no-zombie-commented-code', passed: zombieCode.length === 0 },
      {
        label: options.allowedDependencies
          ? 'imports-within-f14-allowlist'
          : 'imports-within-f14-allowlist (skipped — no allowlist provided)',
        passed: options.allowedDependencies ? hallucinatedImports.length === 0 : true,
      },
    ],
    violations,
  };
}
