import { GraywolfAppError } from '../errors/taxonomy';

/**
 * Anti-Self-Grading & Selector Hygiene E2E Authoring Guard (Task 13.1, ADR-075, FR-001).
 *
 * Enforces:
 * 1. Semantic Playwright locators (getByRole, getByLabel, getByPlaceholder, getByText, getByTestId).
 * 2. Rejection of brittle CSS chains, raw XPath, and positional :nth-child/:nth-of-type selectors.
 * 3. 3-signal deterministic financial/billing/tax scope detection.
 * 4. Mandatory deterministic expect(...) assertions for financial/calculation scopes (Anti-Self-Grading rule).
 */

export const FINANCIAL_SCOPE_TAGS: readonly string[] = Object.freeze([
  'financial',
  'billing',
  'tax',
  'payment',
  'pricing',
  'ledger',
  'invoice',
  'calculation',
]);

export const FINANCIAL_FILE_REGEX =
  /(billing|tax|invoice|payment|ledger|pricing|checkout|currency|discount|vat|payroll)/i;

export const CURRENCY_EXPECT_REGEX =
  /[$€£¥]|total|subtotal|tax|vat|invoice|balance/i;

export type E2eAuthoringGuardViolation =
  | { type: 'BRITTLE_SELECTOR'; detail: string }
  | { type: 'MISSING_DETERMINISTIC_EXPECT'; scope: 'financial' | 'billing' | 'tax' | 'payment' | 'pricing' | 'calculation' }
  | { type: 'NON_SEMANTIC_GET_BY_TEXT'; reason: string }
  | { type: 'POSITIVISTIC_AGENT_ASSERT_ONLY'; tool: string };

export interface E2eAuthoringGuardResult {
  passed: boolean;
  isFinancialOrCalculationScope: boolean;
  hasDeterministicExpect: boolean;
  violations: E2eAuthoringGuardViolation[];
  evaluatedAt: string;
}

export interface EvaluateE2eAuthoringGuardInput {
  diffPatch: string;
  touchedFiles: string[];
  briefMarkdown?: string;
  taskTags?: string[];
}

// Patterns detecting brittle selectors in code diffs or test files
const XPATH_PATTERNS = [
  /['"`]xpath=[^'"`]+['"`]/i,
  /(?:page\.locator|\$|\$\$)\(\s*['"`]\/\/[^'"`]+['"`]\s*\)/i,
  /(?:page\.locator|\$|\$\$)\(\s*['"`]\/html\/[^'"`]+['"`]\s*\)/i,
  /\$x\(\s*['"`]/i,
];

const POSITIONAL_CSS_PATTERNS = [
  /(?:page\.locator|\$|\$\$)\(\s*['"`][^'"`]*:nth-child\(\s*\d+\s*\)/i,
  /(?:page\.locator|\$|\$\$)\(\s*['"`][^'"`]*:nth-of-type\(\s*\d+\s*\)/i,
  /(?:page\.locator|\$|\$\$)\(\s*['"`][^'"`]*:(?:first|last)-child\b/i,
  /:nth-child\(\s*\d+\s*\)/i,
  /:nth-of-type\(\s*\d+\s*\)/i,
];

// Complex CSS class chains inside locator strings (e.g. page.locator('.btn.btn-primary.btn-sm'))
const CLASS_CHAIN_PATTERN = /(?:page\.locator|\$|\$\$)\(\s*['"`][^'"`]*\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+[^'"`]*['"`]\s*\)/g;

// Raw id selector without semantic alternative: page.locator('#raw-id') or $('#raw-id')
const BRITTLE_ID_PATTERN = /(?:page\.locator|\$)\(\s*['"`]#[a-zA-Z0-9_-]+['"`]\s*\)/g;

// Deterministic Playwright assertions: expect(...).to... (handles nested locator calls like expect(page.getByTestId('...')).toHaveText(...))
const DETERMINISTIC_EXPECT_PATTERN = /expect\s*\([\s\S]*?\)\s*\.\s*(?:to|not\s*\.\s*to)[a-zA-Z0-9_]+/i;

// Agent-judged probabilistic assertions: agent.assert('...')
const AGENT_ASSERT_PATTERN = /agent\s*\.\s*assert\s*\(/i;

/**
 * 3-Signal Deterministic Financial Scope Detection (FR-001)
 */
export function evaluateFinancialScope(input: {
  touchedFiles: string[];
  briefMarkdown?: string;
  taskTags?: string[];
  diffPatch?: string;
}): { isFinancialScope: boolean; matchedSignals: string[] } {
  const matchedSignals: string[] = [];

  // Signal 1: Task tags or brief contain financial keywords
  const tags = input.taskTags ?? [];
  const brief = input.briefMarkdown ?? '';
  for (const tag of FINANCIAL_SCOPE_TAGS) {
    if (tags.some((t) => t.toLowerCase() === tag.toLowerCase())) {
      matchedSignals.push(`tag:${tag}`);
    } else if (new RegExp(`\\b${tag}\\b`, 'i').test(brief)) {
      matchedSignals.push(`brief:${tag}`);
    }
  }

  // Signal 2: Touched files path regex
  for (const file of input.touchedFiles) {
    if (FINANCIAL_FILE_REGEX.test(file)) {
      matchedSignals.push(`touchedFile:${file}`);
    }
  }

  // Signal 3: Diff patch contains currency symbols or monetary keywords in assertions
  if (input.diffPatch && CURRENCY_EXPECT_REGEX.test(input.diffPatch)) {
    matchedSignals.push('diff:currency_or_monetary_keyword');
  }

  return {
    isFinancialScope: matchedSignals.length > 0,
    matchedSignals,
  };
}

/**
 * Evaluates E2E test code diffs or content for selector hygiene & Anti-Self-Grading rules.
 */
export function evaluateE2eAuthoringGuard(
  input: EvaluateE2eAuthoringGuardInput
): E2eAuthoringGuardResult {
  const { diffPatch, touchedFiles, briefMarkdown, taskTags } = input;
  const violations: E2eAuthoringGuardViolation[] = [];

  // 1. Selector Hygiene Checks
  // Check for raw XPath
  for (const pattern of XPATH_PATTERNS) {
    const match = pattern.exec(diffPatch);
    if (match) {
      violations.push({
        type: 'BRITTLE_SELECTOR',
        detail: `Prohibited raw XPath selector detected: '${match[0]}'`,
      });
    }
  }

  // Check for positional CSS
  for (const pattern of POSITIONAL_CSS_PATTERNS) {
    const match = pattern.exec(diffPatch);
    if (match) {
      violations.push({
        type: 'BRITTLE_SELECTOR',
        detail: `Prohibited positional CSS selector detected: '${match[0]}'`,
      });
    }
  }

  // Check for brittle CSS class chains
  let classMatch: RegExpExecArray | null;
  while ((classMatch = CLASS_CHAIN_PATTERN.exec(diffPatch)) !== null) {
    violations.push({
      type: 'BRITTLE_SELECTOR',
      detail: `Brittle CSS class chain detected: '${classMatch[0]}'. Use semantic locators (getByRole, getByTestId).`,
    });
  }

  // Check for brittle raw ID selectors
  let idMatch: RegExpExecArray | null;
  while ((idMatch = BRITTLE_ID_PATTERN.exec(diffPatch)) !== null) {
    violations.push({
      type: 'BRITTLE_SELECTOR',
      detail: `Brittle ID selector detected: '${idMatch[0]}'. Use getByTestId or getByRole.`,
    });
  }

  // 2. Financial Scope & Assertion Split Analysis
  const scopeEval = evaluateFinancialScope({
    touchedFiles,
    briefMarkdown,
    taskTags,
    diffPatch,
  });

  const hasDeterministicExpect = DETERMINISTIC_EXPECT_PATTERN.test(diffPatch);
  const hasAgentAssert = AGENT_ASSERT_PATTERN.test(diffPatch);

  if (scopeEval.isFinancialScope) {
    if (!hasDeterministicExpect) {
      const scopeName = (taskTags?.find((t) =>
        FINANCIAL_SCOPE_TAGS.includes(t.toLowerCase())
      )?.toLowerCase() ?? 'financial') as 'financial' | 'billing' | 'tax' | 'payment' | 'pricing' | 'calculation';

      violations.push({
        type: 'MISSING_DETERMINISTIC_EXPECT',
        scope: scopeName,
      });

      if (hasAgentAssert) {
        violations.push({
          type: 'POSITIVISTIC_AGENT_ASSERT_ONLY',
          tool: 'agent.assert',
        });
      }
    }
  }

  return {
    passed: violations.length === 0,
    isFinancialOrCalculationScope: scopeEval.isFinancialScope,
    hasDeterministicExpect,
    violations,
    evaluatedAt: new Date().toISOString(),
  };
}

/**
 * Enforces the Anti-Self-Grading rule. Throws RELAY_DETERMINISTIC_LINTER_FAILED
 * when a financial or calculation scope task lacks deterministic expect(...) assertions.
 */
export function enforceNoLlmSelfGrading(guardResult: E2eAuthoringGuardResult): void {
  if (guardResult.isFinancialOrCalculationScope && !guardResult.hasDeterministicExpect) {
    throw new GraywolfAppError(
      'RELAY_DETERMINISTIC_LINTER_FAILED',
      'Anti-Self-Grading rule violation: tests in financial, billing, or calculation scope MUST include at least one deterministic Playwright expect(...) assertion. Probabilistic agent.assert(...) alone is prohibited.',
      {
        violations: guardResult.violations,
        isFinancialOrCalculationScope: guardResult.isFinancialOrCalculationScope,
        hasDeterministicExpect: guardResult.hasDeterministicExpect,
      }
    );
  }
}
