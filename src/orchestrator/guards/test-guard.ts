import { SingleGuardResult } from './guard-types';
import { parsePatchAddedLines } from './clean-code-guard';
import { VerificationEvidenceEntry } from './evidence-ledger';

/**
 * Deterministic Test Guard (Task 10.2b, ADR-083 & ADR-062, FR-003).
 * Rejects:
 *  (a) mocks (`vi.mock` / `jest.mock`) targeting internal domain modules
 *      (only external infrastructure like DB / Valkey / HTTP may be mocked),
 *  (b) vacuous test blocks with 0 assertions (`expect(` / `assert`),
 *  (c) tasks without at least one passing (`exitCode === 0`) `test`
 *      execution or with unrecovered failing `test` runs in
 *      `<worktree>/.agent_evidence.db`.
 */

/** External infrastructure packages that MAY be mocked (research §2). */
export const DEFAULT_ALLOWED_EXTERNAL_MOCKS: readonly string[] = Object.freeze([
  'pg',
  'ioredis',
  'ws',
  'undici',
  'node-fetch',
  'dockerode',
  'bullmq',
  'nanoid',
  'uuid',
]);

const TEST_FILE_RE = /(?:\.test|\.spec|__tests__\/)[^/]*\.[cm]?[jt]sx?$|\/__tests__\//;
const MOCK_CALL_RE = /(?:vi|jest)\.mock\(\s*['"]([^'"]+)['"]/;
const TEST_BLOCK_OPEN_RE = /^[ \t]*(?:it|test)(?:\.(?:each|skip|only|todo))?\s*\(/;
const ASSERTION_RE = /\bexpect\s*\(|\bassert[ (]/;

function isTestFile(filePath: string): boolean {
  return TEST_FILE_RE.test(filePath) || /(?:\.test|\.spec)\.[cm]?[jt]sx?$/.test(filePath);
}

function findInternalDomainMocks(
  testFilePaths: Map<string, { text: string; line: number }[]>,
  allowedExternalMocks?: string[]
): SingleGuardResult['violations'] {
  const allowed = new Set(allowedExternalMocks ?? DEFAULT_ALLOWED_EXTERNAL_MOCKS);
  const violations: SingleGuardResult['violations'] = [];

  for (const [filePath, lines] of testFilePaths) {
    for (const added of lines) {
      const match = added.text.match(MOCK_CALL_RE);
      if (!match) continue;
      const specifier = match[1];
      // Relative specifiers or internal path aliases (@/, ~/, #) resolve to internal domain modules
      if (
        specifier.startsWith('.') ||
        specifier.startsWith('@/') ||
        specifier.startsWith('~/') ||
        specifier.startsWith('#')
      ) {
        violations.push({
          rule: 'GUARD_TEST_FAILED:internal-domain-mock',
          filePath,
          line: added.line,
          message: `Mock targets internal domain module '${specifier}' — only external infrastructure (DB, Valkey, HTTP) may be mocked`,
        });
        continue;
      }
      if (specifier.startsWith('node:')) continue;
      if (!allowed.has(specifier)) {
        violations.push({
          rule: 'GUARD_TEST_FAILED:non-infrastructure-mock',
          filePath,
          line: added.line,
          message: `Mock targets '${specifier}' which is not in the allowed external infrastructure mock list`,
        });
      }
    }
  }
  return violations;
}

function braceDelta(line: string): number {
  let delta = 0;
  for (const ch of line) {
    if (ch === '{') delta += 1;
    else if (ch === '}') delta -= 1;
  }
  return delta;
}

function findVacuousTests(
  testFilePaths: Map<string, { text: string; line: number }[]>
): SingleGuardResult['violations'] {
  const violations: SingleGuardResult['violations'] = [];

  for (const [filePath, lines] of testFilePaths) {
    let i = 0;
    while (i < lines.length) {
      if (!TEST_BLOCK_OPEN_RE.test(lines[i].text)) {
        i += 1;
        continue;
      }
      // Placeholder it.todo / test.todo tests do not take a test body — skip
      if (/^[ \t]*(?:it|test)\.todo\s*\(/.test(lines[i].text)) {
        i += 1;
        continue;
      }
      // Scan the test block body until braces close
      let depth = 0;
      let opened = false;
      let assertions = 0;
      let j = i;
      for (; j < lines.length; j++) {
        const text = lines[j].text;
        if (ASSERTION_RE.test(text)) assertions += 1;
        const delta = braceDelta(text);
        if (delta > 0 || text.includes('{')) opened = true;
        depth += delta;
        if (opened && depth <= 0) break;
        if (!opened && j > i && delta === 0 && /\)\s*;?\s*$/.test(text)) {
          // Arrow-less one-liner `it('x', () => 0);` with no body braces
          break;
        }
      }
      if (assertions === 0) {
        violations.push({
          rule: 'GUARD_TEST_FAILED:vacuous-test',
          filePath,
          line: lines[i].line,
          message: `Test block at L${lines[i].line} contains 0 assertions (expected expect()/assert calls)`,
        });
      }
      i = Math.max(j + 1, i + 1);
    }
  }
  return violations;
}

function evaluateEvidenceLedgerStatus(
  evidenceEntries: VerificationEvidenceEntry[]
): { hasPassing: boolean; hasUnrecoveredFailure: boolean } {
  const testEntries = evidenceEntries
    .filter((entry) => entry.commandType === 'test')
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  const hasPassing = testEntries.some((entry) => entry.exitCode === 0);
  const lastPassingIndex = testEntries.reduce(
    (last, entry, index) => (entry.exitCode === 0 ? index : last),
    -1
  );
  const hasUnrecoveredFailure = testEntries.some(
    (entry, index) => entry.exitCode !== 0 && index > lastPassingIndex
  );
  return { hasPassing, hasUnrecoveredFailure };
}

export function evaluateTestGuard(options: {
  patchContent: string;
  evidenceEntries: VerificationEvidenceEntry[];
  allowedExternalMocks?: string[];
}): SingleGuardResult {
  const files = parsePatchAddedLines(options.patchContent);
  const testFilePaths = new Map<string, { text: string; line: number }[]>();
  for (const file of files) {
    if (!isTestFile(file.filePath)) continue;
    testFilePaths.set(
      file.filePath,
      file.addedLines.map((added) => ({ text: added.text, line: added.line }))
    );
  }

  const domainMocks = findInternalDomainMocks(testFilePaths, options.allowedExternalMocks);
  const vacuousTests = findVacuousTests(testFilePaths);
  const { hasPassing, hasUnrecoveredFailure } = evaluateEvidenceLedgerStatus(options.evidenceEntries);

  const noPassingViolation: SingleGuardResult['violations'] = hasPassing
    ? []
    : [
        {
          rule: 'GUARD_TEST_FAILED:no-passing-test-execution',
          message:
            'Evidence ledger contains no test execution with exitCode === 0 in <worktree>/.agent_evidence.db (ADR-062)',
        },
      ];
  const unrecoveredViolation: SingleGuardResult['violations'] = hasUnrecoveredFailure
    ? [
        {
          rule: 'GUARD_TEST_FAILED:unrecovered-failing-test',
          message:
            'Evidence ledger ends with an unrecovered failing test execution (no later passing test run)',
        },
      ]
    : [];

  const violations = [...domainMocks, ...vacuousTests, ...noPassingViolation, ...unrecoveredViolation];

  return {
    guard: 'test',
    passed: violations.length === 0,
    checks: [
      { label: 'no-internal-domain-mocks', passed: domainMocks.length === 0 },
      { label: 'no-vacuous-zero-assertion-tests', passed: vacuousTests.length === 0 },
      { label: 'evidence-has-passing-test', passed: hasPassing },
      { label: 'no-unrecovered-failing-test', passed: !hasUnrecoveredFailure },
    ],
    violations,
  };
}
