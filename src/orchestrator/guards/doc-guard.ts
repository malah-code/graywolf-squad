import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { SingleGuardResult } from './guard-types';
import { evaluateCleanCodeGuard, parsePatchAddedLines } from './clean-code-guard';
import { evaluateTestGuard } from './test-guard';
import { VerificationEvidenceEntry } from './evidence-ledger';
import { TaskStatus } from '../schemas/task';
import { assertValidTaskTransition } from '../services/state-machine';

/**
 * Deterministic Documentation Guard (Task 10.2c, ADR-083, FR-004) and the
 * reactive guard-suite orchestrator (FR-005): emits the canonical
 * `.agents/tasks/<TASK_ID>/verification.md` (data-model §1.3) and drives the
 * `GUARD_VERIFYING` ➔ `QA_FIXING` (up to qaMaxRetries = 3) ➔
 * `VERIFICATION_FAILED` / `HUMAN_REVIEW_GATE` task state transitions.
 */

const PROCESS_ENV_KEY_RE = /process\.env\.([A-Z_][A-Z0-9_]*)/g;
const BACKTICK_TOKEN_RE = /`([^`\n]+)`/g;
const CLI_FLAG_RE = /(--[a-z][a-z0-9-]*)/g;
const DOC_FILE_RE = /(?:^|\/)(?:README|CONTRIBUTING|CHANGELOG)[^/]*\.md$|\.md$|^docs\//;
const ENV_EXAMPLE_RE = /\.env(?:\.[^/]*)?$/;
const TEST_FILE_RE = /(?:\.test|\.spec|__tests__\/)[^/]*\.[cm]?[jt]sx?$|\/__tests__\//;

/** Common primitives, language keywords, and CLI tools that should not be flagged as missing code symbols. */
const BUILTIN_DOC_TOKENS: ReadonlySet<string> = new Set([
  'string', 'number', 'boolean', 'any', 'unknown', 'void', 'null', 'undefined', 'never', 'object',
  'true', 'false', 'pnpm', 'npm', 'yarn', 'git', 'node', 'bash', 'ts', 'js', 'json', 'yaml', 'yml',
  'http', 'https', 'GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS',
]);

function collectMatches(content: string, regex: RegExp): string[] {
  const out: string[] = [];
  for (const match of content.matchAll(new RegExp(regex.source, 'g'))) {
    if (match[1]) out.push(match[1]);
  }
  return [...new Set(out)];
}

function renderVerdictLine(guard: SingleGuardResult): string {
  return guard.passed ? '**Result**: PASSED' : '**Result**: FAILED';
}

function renderChecksTable(guard: SingleGuardResult): string {
  return [
    '| Check | Status |',
    '|---|---|',
    ...guard.checks.map((check) => `| ${check.label} | ${check.passed ? '✅' : '❌'} |`),
  ].join('\n');
}

function renderViolations(guard: SingleGuardResult): string {
  if (guard.violations.length === 0) return '_None — no violations detected._';
  return guard.violations
    .map(
      (violation) =>
        `- \`${violation.rule}\`${violation.filePath ? ` — \`${violation.filePath}\`${violation.line ? `:L${violation.line}` : ''}` : ''}: ${violation.message}`
    )
    .join('\n');
}

export function evaluateDocGuard(options: {
  patchContent: string;
  prDescription?: string;
  /** Keys documented in `.env.example`. */
  documentedEnvKeys?: string[];
  exportedSymbols?: string[];
}): SingleGuardResult {
  const { patchContent, prDescription, documentedEnvKeys, exportedSymbols } = options;
  const files = parsePatchAddedLines(patchContent);

  // --- 1. Newly referenced process.env.* keys in code must be documented ---
  const codeEnvKeys = new Set<string>();
  for (const file of files) {
    // Test files frequently declare test fixtures or mock environments — ignore test files
    if (TEST_FILE_RE.test(file.filePath)) continue;
    for (const added of file.addedLines) {
      for (const key of collectMatches(added.text, PROCESS_ENV_KEY_RE)) {
        codeEnvKeys.add(key);
      }
    }
  }
  const undocumentedEnvKeys: string[] =
    documentedEnvKeys && documentedEnvKeys.length >= 0
      ? [...codeEnvKeys].filter((key) => !documentedEnvKeys.includes(key))
      : [];

  // --- 2. Documentation references must exist in the code / patch ---
  const docContentParts: string[] = [];
  if (prDescription) docContentParts.push(prDescription);
  for (const file of files) {
    if (DOC_FILE_RE.test(file.filePath) || ENV_EXAMPLE_RE.test(file.filePath)) {
      docContentParts.push(file.addedLines.map((added) => added.text).join('\n'));
    }
  }
  const docContent = docContentParts.join('\n');

  const referencedEnvKeys = collectMatches(docContent, PROCESS_ENV_KEY_RE);
  const referencedCliFlags = collectMatches(docContent, CLI_FLAG_RE);
  const referencedTokens =
    docContent.length > 0
      ? collectMatches(docContent, BACKTICK_TOKEN_RE).filter(
          (token) =>
            // Skip obvious non-symbol tokens (prose fragments) and CLI flags
            // (handled by the dedicated flag check)
            !token.includes(' ') && !token.startsWith('-') && token.length > 1 && token.length < 80
        )
      : [];

  const violations: SingleGuardResult['violations'] = [];

  for (const key of undocumentedEnvKeys) {
    violations.push({
      rule: 'GUARD_DOC_FAILED:undocumented-env-key',
      message: `Newly introduced process.env.${key} is not documented in .env.example`,
    });
  }

  for (const key of referencedEnvKeys) {
    const existsInPatch = codeEnvKeys.has(key) || patchContent.includes(`process.env.${key}`);
    const existsInEnvExample = documentedEnvKeys?.includes(key) ?? false;
    if (!existsInPatch && !existsInEnvExample) {
      violations.push({
        rule: 'GUARD_DOC_FAILED:doc-env-key-missing',
        message: `Documentation references process.env.${key} which does not exist in the code or patch`,
      });
    }
  }

  for (const flag of referencedCliFlags) {
    if (!patchContent.includes(flag)) {
      violations.push({
        rule: 'GUARD_DOC_FAILED:doc-cli-flag-missing',
        message: `Documentation references CLI flag ${flag} which does not exist in the code or patch`,
      });
    }
  }

  for (const token of referencedTokens) {
    if (BUILTIN_DOC_TOKENS.has(token)) continue;
    const looksLikePathOrCommand = /[/.]/.test(token) || token.startsWith('-');
    if (looksLikePathOrCommand) {
      if (!patchContent.includes(token)) {
        violations.push({
          rule: 'GUARD_DOC_FAILED:doc-reference-missing',
          message: `Documentation references \`${token}\` which does not exist in the code or patch`,
        });
      }
      continue;
    }
    const inExportedSymbols = exportedSymbols?.includes(token) ?? false;
    const inPatch = patchContent.includes(token);
    if (!inExportedSymbols && !inPatch) {
      violations.push({
        rule: 'GUARD_DOC_FAILED:doc-symbol-missing',
        message: `Documentation references symbol \`${token}\` which is neither exported by the patch nor present in the codebase`,
      });
    }
  }

  const envCheckSkipped = !documentedEnvKeys;
  return {
    guard: 'doc',
    passed: violations.length === 0,
    checks: [
      {
        label: envCheckSkipped
          ? 'env-keys-documented (skipped — no .env.example keys provided)'
          : 'env-keys-documented',
        passed: envCheckSkipped ? true : undocumentedEnvKeys.length === 0,
      },
      { label: 'doc-references-exist-in-code', passed: violations.length === 0 },
    ],
    violations,
  };
}

export interface RunReactiveGuardSuiteOptions {
  taskId: string;
  currentStatus: TaskStatus;
  qaAttempts: number;
  qaMaxRetries?: number;
  patchContent: string;
  evidenceEntries: VerificationEvidenceEntry[];
  allowedDependencies?: string[];
  prDescription?: string;
  documentedEnvKeys?: string[];
  exportedSymbols?: string[];
  writeReportToPath?: string;
}

export interface GuardSuiteOutcome {
  overallVerdict: 'PASS' | 'FAIL';
  cleanCode: SingleGuardResult;
  testGuard: SingleGuardResult;
  docGuard: SingleGuardResult;
  nextStatus: 'HUMAN_REVIEW_GATE' | 'QA_FIXING' | 'VERIFICATION_FAILED';
  nextQaAttempts: number;
  verificationMarkdown: string;
}

export function renderVerificationMarkdown(options: {
  taskId: string;
  overallVerdict: 'PASS' | 'FAIL';
  cleanCode: SingleGuardResult;
  testGuard: SingleGuardResult;
  docGuard: SingleGuardResult;
  nextStatus: GuardSuiteOutcome['nextStatus'];
  nextQaAttempts: number;
  qaMaxRetries: number;
}): string {
  const guardSection = (title: string, guard: SingleGuardResult): string[] => [
    `## ${title}`,
    '',
    renderVerdictLine(guard),
    '',
    renderChecksTable(guard),
    '',
    '**Violations**',
    '',
    renderViolations(guard),
    '',
  ];

  return [
    `# Verification Report: ${options.taskId}`,
    '',
    `- **Evaluation Timestamp**: ${new Date().toISOString()}`,
    `- **Overall Verdict**: ${options.overallVerdict}`,
    '',
    ...guardSection('Guard 1: Clean-Code Guard', options.cleanCode),
    ...guardSection('Guard 2: Test Guard', options.testGuard),
    ...guardSection('Guard 3: Documentation Guard', options.docGuard),
    '## Next Task State',
    '',
    `- Next status: \`${options.nextStatus}\``,
    `- QA attempts: ${options.nextQaAttempts} / ${options.qaMaxRetries} max`,
    '',
  ].join('\n');
}

export async function runReactiveGuardSuite(
  options: RunReactiveGuardSuiteOptions
): Promise<GuardSuiteOutcome> {
  const {
    taskId,
    currentStatus,
    qaAttempts,
    qaMaxRetries = 3,
    patchContent,
    evidenceEntries,
    allowedDependencies,
    prDescription,
    documentedEnvKeys,
    exportedSymbols,
    writeReportToPath,
  } = options;

  const cleanCode = evaluateCleanCodeGuard({ patchContent, allowedDependencies });
  const testGuard = evaluateTestGuard({ patchContent, evidenceEntries });
  const docGuard = evaluateDocGuard({
    patchContent,
    prDescription,
    documentedEnvKeys,
    exportedSymbols,
  });

  const overallVerdict: GuardSuiteOutcome['overallVerdict'] =
    cleanCode.passed && testGuard.passed && docGuard.passed ? 'PASS' : 'FAIL';

  let nextStatus: GuardSuiteOutcome['nextStatus'];
  let nextQaAttempts: number;
  if (overallVerdict === 'PASS') {
    nextStatus = 'HUMAN_REVIEW_GATE';
    nextQaAttempts = qaAttempts;
  } else {
    nextQaAttempts = qaAttempts + 1;
    nextStatus = nextQaAttempts >= qaMaxRetries ? 'VERIFICATION_FAILED' : 'QA_FIXING';
  }

  // Canonical 16-state lifecycle enforcement (ADR-042)
  assertValidTaskTransition(currentStatus, nextStatus, taskId);

  const verificationMarkdown = renderVerificationMarkdown({
    taskId,
    overallVerdict,
    cleanCode,
    testGuard,
    docGuard,
    nextStatus,
    nextQaAttempts,
    qaMaxRetries,
  });

  if (writeReportToPath) {
    await fs.mkdir(path.dirname(writeReportToPath), { recursive: true });
    await fs.writeFile(writeReportToPath, verificationMarkdown, 'utf8');
  }

  return {
    overallVerdict,
    cleanCode,
    testGuard,
    docGuard,
    nextStatus,
    nextQaAttempts,
    verificationMarkdown,
  };
}
