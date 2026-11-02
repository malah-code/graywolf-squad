import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';

import { evaluateCleanCodeGuard } from '../../src/orchestrator/guards/clean-code-guard';
import { evaluateTestGuard } from '../../src/orchestrator/guards/test-guard';
import { evaluateDocGuard, runReactiveGuardSuite } from '../../src/orchestrator/guards/doc-guard';
import { VerificationEvidenceEntry } from '../../src/orchestrator/guards/evidence-ledger';

/**
 * Task 10.2 — Deterministic Clean-Code, Test & Documentation Guards
 * (FR-002..FR-005, SC-002, ADR-083, ADR-062, F14).
 */

function evidence(overrides: Partial<VerificationEvidenceEntry> = {}): VerificationEvidenceEntry {
  return {
    id: `ev-${Math.random().toString(36).slice(2, 10)}`,
    taskId: 'TASK-GUARDS-01',
    workspaceId: 'ws-guards',
    commandType: 'test',
    command: 'pnpm vitest run',
    exitCode: 0,
    durationMs: 900,
    createdAt: new Date('2026-10-25T10:00:00.000Z').toISOString(),
    ...overrides,
  };
}

const CLEAN_PATCH = `--- a/src/modules/billing/service.ts
+++ b/src/modules/billing/service.ts
@@ -1,3 +1,11 @@
 import { pool } from '../db/client';
+
+export function createInvoice(total: number): string {
+  try {
+    return saveInvoice(pool, total);
+  } catch (error) {
+    throw new Error(\`save failed: \${String(error)}\`);
+  }
+}
--- a/tests/billing.test.ts
+++ b/tests/billing.test.ts
@@ -0,0 +1,4 @@
+import { createInvoice } from '../src/modules/billing/service';
+
+it('creates an invoice', () => {
+  expect(createInvoice(5)).toBeTruthy();
+});
`;

const DEFECTIVE_PATCH = `--- a/src/modules/billing/service.ts
+++ b/src/modules/billing/service.ts
@@ -1,3 +1,24 @@
+import lodash from 'lodash';
+import { pool } from '../db/client';
+
+// const legacyCalculateTotal = function (items) {
+//   var total = 0;
+//   for (var i = 0; i < items.length; i++) {
+//     total = total + items[i].amount;
+// }
+
+export function syncInvoice() {
+  try {
+    return saveInvoice(pool, 1);
+  } catch (error) {
+  }
+}
+
+export function refreshAsync() {
+  fetchTotals().then((rows) => renderRows(rows));
+}
--- a/tests/billing.test.ts
+++ b/tests/billing.test.ts
@@ -0,0 +1,6 @@
+import { syncInvoice } from '../src/modules/billing/service';
+
+vi.mock('../services/billing');
+vi.mock('pg');
+
+it('works', () => {
+  syncInvoice();
+});
`;

describe('Clean-Code Guard (US2, Task 10.2a, FR-002, F14)', () => {
  it('accepts a clean synthetic patch', () => {
    const result = evaluateCleanCodeGuard({
      patchContent: CLEAN_PATCH,
      allowedDependencies: ['pg', 'fastify', 'vitest'],
    });
    expect(result.guard).toBe('clean-code');
    expect(result.passed).toBe(true);
    expect(result.violations).toHaveLength(0);
    expect(result.checks.map((check) => check.label)).toContain('imports-within-f14-allowlist');
  });

  it('detects empty catch blocks, zombie code, floating promises, and hallucinated imports (SC-002)', () => {
    const result = evaluateCleanCodeGuard({
      patchContent: DEFECTIVE_PATCH,
      allowedDependencies: ['pg', 'fastify', 'vitest'],
    });

    expect(result.passed).toBe(false);
    const rules = result.violations.map((violation) => violation.rule);
    expect(rules).toContain('GUARD_CLEAN_CODE_FAILED:empty-catch-block');
    expect(rules).toContain('GUARD_CLEAN_CODE_FAILED:zombie-commented-code');
    expect(rules).toContain('GUARD_CLEAN_CODE_FAILED:floating-promise');
    expect(rules).toContain('GUARD_CLEAN_CODE_FAILED:hallucinated-import');

    // Violations carry file paths and line numbers
    const hallucinated = result.violations.find(
      (violation) => violation.rule === 'GUARD_CLEAN_CODE_FAILED:hallucinated-import'
    );
    expect(hallucinated?.filePath).toBe('src/modules/billing/service.ts');
    expect(hallucinated?.line).toBeGreaterThan(0);
    expect(hallucinated?.message).toContain('lodash');
  });

  it('validates imports strictly against the F14 allowlist, ignoring the container package.json', () => {
    const patchWithSmuggledImport = `+++ b/src/x.ts
@@ -0,0 +1,2 @@
+import sneaky from 'not-in-allowlist';
+export const x = sneaky;
`;
    const result = evaluateCleanCodeGuard({
      patchContent: patchWithSmuggledImport,
      allowedDependencies: ['fastify'],
    });
    expect(result.violations.some((v) => v.rule === 'GUARD_CLEAN_CODE_FAILED:hallucinated-import')).toBe(true);

    // Subpath imports resolve to their base dependency name ('@scope/pkg/sub' -> '@scope/pkg')
    const subpathOk = evaluateCleanCodeGuard({
      patchContent: '+++ b/src/y.ts\n@@ -0,0 +1,1\n+import { x } from \'@scope/pkg/sub\';\n',
      allowedDependencies: ['@scope/pkg'],
    });
    expect(subpathOk.passed).toBe(true);

    // Node builtins are always allowed
    const builtinOk = evaluateCleanCodeGuard({
      patchContent: '+++ b/src/z.ts\n@@ -0,0 +1,1\n+import { createHash } from \'node:crypto\';\n',
      allowedDependencies: [],
    });
    expect(builtinOk.passed).toBe(true);
  });
});

describe('Test Guard (US2, Task 10.2b, FR-003, ADR-062)', () => {
  it('rejects internal domain mocks and vacuous 0-assertion tests (SC-002)', () => {
    const result = evaluateTestGuard({
      patchContent: DEFECTIVE_PATCH,
      evidenceEntries: [evidence()],
    });

    expect(result.passed).toBe(false);
    const rules = result.violations.map((violation) => violation.rule);
    expect(rules).toContain('GUARD_TEST_FAILED:internal-domain-mock');
    expect(rules).toContain('GUARD_TEST_FAILED:vacuous-test');
    // vi.mock('pg') is external infrastructure -> allowed (not in violations)
    expect(result.violations.every((v) => !v.message.includes("'pg'"))).toBe(true);
  });

  it('rejects mocks of non-infrastructure packages not in the allowed external list', () => {
    const patch = `+++ b/tests/unit/example.test.ts
@@ -0,0 +1,2 @@
+vi.mock('left-pad');
+it('x', () => { expect(1).toBe(1); });
`;
    const result = evaluateTestGuard({ patchContent: patch, evidenceEntries: [evidence()] });
    expect(
      result.violations.some((v) => v.rule === 'GUARD_TEST_FAILED:non-infrastructure-mock')
    ).toBe(true);
  });

  it('requires a passing test execution and rejects unrecovered failing runs in the evidence ledger', () => {
    // No passing test at all
    const noPassing = evaluateTestGuard({
      patchContent: CLEAN_PATCH,
      evidenceEntries: [evidence({ exitCode: 1 })],
    });
    expect(noPassing.violations.some((v) => v.rule === 'GUARD_TEST_FAILED:no-passing-test-execution')).toBe(true);

    // Failing run recovered by a later passing run -> OK
    const recovered = evaluateTestGuard({
      patchContent: CLEAN_PATCH,
      evidenceEntries: [
        evidence({ exitCode: 1, createdAt: '2026-10-25T10:00:00.000Z' }),
        evidence({ exitCode: 0, createdAt: '2026-10-25T10:05:00.000Z' }),
      ],
    });
    expect(recovered.violations.some((v) => v.rule === 'GUARD_TEST_FAILED:unrecovered-failing-test')).toBe(false);
    expect(recovered.passed).toBe(true);

    // Failing run as the last test execution -> unrecovered
    const unrecovered = evaluateTestGuard({
      patchContent: CLEAN_PATCH,
      evidenceEntries: [
        evidence({ exitCode: 0, createdAt: '2026-10-25T10:00:00.000Z' }),
        evidence({ exitCode: 1, createdAt: '2026-10-25T10:05:00.000Z' }),
      ],
    });
    expect(unrecovered.violations.some((v) => v.rule === 'GUARD_TEST_FAILED:unrecovered-failing-test')).toBe(true);
  });

  it('accepts a clean test patch with real passing evidence', () => {
    const result = evaluateTestGuard({
      patchContent: CLEAN_PATCH,
      evidenceEntries: [evidence()],
    });
    expect(result.passed).toBe(true);
    expect(result.checks.every((check) => check.passed)).toBe(true);
  });
});

describe('Doc Guard (US2, Task 10.2c, FR-004)', () => {
  it('flags undocumented process.env keys introduced in code (SC-002)', () => {
    const patch = `+++ b/src/modules/billing/config.ts
@@ -0,0 +1,2 @@
+const url = process.env.NEW_BILLING_URL;
+export const config = { url };
`;
    const result = evaluateDocGuard({
      patchContent: patch,
      documentedEnvKeys: ['DATABASE_URL'],
    });
    expect(result.passed).toBe(false);
    expect(
      result.violations.some((v) => v.rule === 'GUARD_DOC_FAILED:undocumented-env-key' && v.message.includes('NEW_BILLING_URL'))
    ).toBe(true);
  });

  it('flags documentation references to symbols, env keys, and CLI flags missing from code', () => {
    const result = evaluateDocGuard({
      patchContent: CLEAN_PATCH,
      prDescription: 'Adds `createInvoiceV2` using `process.env.BILLING_TOKEN` and the `--dry-run` flag.',
      documentedEnvKeys: ['DATABASE_URL'],
      exportedSymbols: ['createInvoice'],
    });
    const rules = result.violations.map((violation) => violation.rule);
    expect(rules).toContain('GUARD_DOC_FAILED:doc-symbol-missing');
    expect(rules).toContain('GUARD_DOC_FAILED:doc-env-key-missing');
    expect(rules).toContain('GUARD_DOC_FAILED:doc-cli-flag-missing');
  });

  it('accepts documentation whose references exist in the patch', () => {
    const result = evaluateDocGuard({
      patchContent: CLEAN_PATCH,
      prDescription: 'Adds `createInvoice` for the billing module.',
      exportedSymbols: ['createInvoice'],
      documentedEnvKeys: [],
    });
    expect(result.passed).toBe(true);
  });

  it('ignores non-code assets (e.g. markdown examples) in CleanCodeGuard and ignores test process.env in DocGuard', () => {
    // Markdown patch containing example empty catch and third-party import
    const mdPatch = `+++ b/README.md
@@ -0,0 +1,5 @@
+# Guide
+Use \`pnpm\` to run \`string\` inputs.
+\`\`\`typescript
+import lodash from 'lodash';
+try {} catch (e) {}
+\`\`\`
+`;
    const cleanCode = evaluateCleanCodeGuard({
      patchContent: mdPatch,
      allowedDependencies: ['pg'],
    });
    expect(cleanCode.passed).toBe(true);

    // DocGuard should ignore standard tooling tokens like `pnpm` and `string`
    const docResult = evaluateDocGuard({
      patchContent: mdPatch,
      documentedEnvKeys: [],
    });
    expect(docResult.passed).toBe(true);
  });

  it('TestGuard: recognizes @/ path aliases as internal domain mocks and skips it.todo', () => {
    const patch = `+++ b/tests/unit/sample.test.ts
@@ -0,0 +1,4 @@
+vi.mock('@/modules/auth/service');
+it.todo('unimplemented feature');
+it('valid', () => { expect(true).toBe(true); });
+`;
    const result = evaluateTestGuard({
      patchContent: patch,
      evidenceEntries: [evidence()],
    });
    expect(
      result.violations.some((v) => v.rule === 'GUARD_TEST_FAILED:internal-domain-mock')
    ).toBe(true);
    expect(
      result.violations.some((v) => v.rule === 'GUARD_TEST_FAILED:vacuous-test')
    ).toBe(false);
  });
});

describe('Reactive Guard Suite & verification.md (US2, Task 10.2d, FR-005)', () => {
  it('emits verification.md and transitions GUARD_VERIFYING -> HUMAN_REVIEW_GATE on pass', async () => {
    const outcome = await runReactiveGuardSuite({
      taskId: 'TASK-GUARDS-01',
      currentStatus: 'GUARD_VERIFYING',
      qaAttempts: 0,
      patchContent: CLEAN_PATCH,
      evidenceEntries: [evidence()],
      allowedDependencies: ['pg', 'vitest'],
    });

    expect(outcome.overallVerdict).toBe('PASS');
    expect(outcome.nextStatus).toBe('HUMAN_REVIEW_GATE');
    expect(outcome.nextQaAttempts).toBe(0);

    const md = outcome.verificationMarkdown;
    expect(md).toContain('# Verification Report: TASK-GUARDS-01');
    expect(md).toContain('- **Overall Verdict**: PASS');
    expect(md).toContain('## Guard 1: Clean-Code Guard');
    expect(md).toContain('**Result**: PASSED');
    expect(md).toContain('## Guard 2: Test Guard');
    expect(md).toContain('## Guard 3: Documentation Guard');
    expect(md).toContain('- Next status: `HUMAN_REVIEW_GATE`');
  });

  it('transitions defective patches to QA_FIXING until retry exhaustion, then VERIFICATION_FAILED (SC-002)', async () => {
    // First failure -> QA_FIXING (attempt 1 of 3)
    const first = await runReactiveGuardSuite({
      taskId: 'TASK-GUARDS-01',
      currentStatus: 'GUARD_VERIFYING',
      qaAttempts: 0,
      patchContent: DEFECTIVE_PATCH,
      evidenceEntries: [evidence()],
      allowedDependencies: ['pg', 'vitest'],
    });
    expect(first.overallVerdict).toBe('FAIL');
    expect(first.nextStatus).toBe('QA_FIXING');
    expect(first.nextQaAttempts).toBe(1);
    expect(first.verificationMarkdown).toContain('- **Overall Verdict**: FAIL');
    expect(first.verificationMarkdown).toContain('GUARD_CLEAN_CODE_FAILED:empty-catch-block');
    expect(first.verificationMarkdown).toContain('GUARD_TEST_FAILED:internal-domain-mock');

    // Second failure -> QA_FIXING (attempt 2 of 3)
    const second = await runReactiveGuardSuite({
      taskId: 'TASK-GUARDS-01',
      currentStatus: 'QA_FIXING',
      qaAttempts: 1,
      patchContent: DEFECTIVE_PATCH,
      evidenceEntries: [evidence()],
    });
    expect(second.nextStatus).toBe('QA_FIXING');
    expect(second.nextQaAttempts).toBe(2);

    // Third consecutive failure -> VERIFICATION_FAILED (retry exhaustion edge case)
    const third = await runReactiveGuardSuite({
      taskId: 'TASK-GUARDS-01',
      currentStatus: 'QA_FIXING',
      qaAttempts: 2,
      patchContent: DEFECTIVE_PATCH,
      evidenceEntries: [evidence()],
    });
    expect(third.nextStatus).toBe('VERIFICATION_FAILED');
    expect(third.nextQaAttempts).toBe(3);
  });

  it('honors a custom qaMaxRetries and writes verification.md to the target path', async () => {
    const worktree = await fs.mkdtemp(path.join(os.tmpdir(), 'gw-guards-'));
    const reportPath = path.join(worktree, '.agents', 'tasks', 'TASK-GUARDS-01', 'verification.md');

    const outcome = await runReactiveGuardSuite({
      taskId: 'TASK-GUARDS-01',
      currentStatus: 'GUARD_VERIFYING',
      qaAttempts: 1,
      qaMaxRetries: 2,
      patchContent: DEFECTIVE_PATCH,
      evidenceEntries: [evidence()],
      writeReportToPath: reportPath,
    });
    expect(outcome.nextStatus).toBe('VERIFICATION_FAILED');

    const written = await fs.readFile(reportPath, 'utf8');
    expect(written).toBe(outcome.verificationMarkdown);
    expect(written).toContain('# Verification Report: TASK-GUARDS-01');

    await fs.rm(worktree, { recursive: true, force: true });
  });

  it('enforces the canonical state machine on guard transitions (ADR-042)', async () => {
    await expect(
      runReactiveGuardSuite({
        taskId: 'TASK-GUARDS-01',
        currentStatus: 'BACKLOG',
        qaAttempts: 0,
        patchContent: DEFECTIVE_PATCH,
        evidenceEntries: [evidence()],
      })
    ).rejects.toThrow(/Cannot transition task/);
  });
});
