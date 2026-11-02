import { describe, it, expect } from 'vitest';
import {
  evaluateE2eAuthoringGuard,
  evaluateFinancialScope,
  enforceNoLlmSelfGrading,
} from '../../src/orchestrator/e2e/authoring-guard';
import { GraywolfAppError } from '../../src/orchestrator/errors/taxonomy';

describe('E2E Authoring Guard & Anti-Self-Grading Rule (Task 13.1, ADR-075)', () => {
  describe('Semantic Locator & Selector Hygiene', () => {
    it('accepts clean semantic Playwright locators', () => {
      const cleanDiff = `
        test('user submits form', async ({ page }) => {
          await page.getByRole('button', { name: 'Submit' }).click();
          await page.getByLabel('Email Address').fill('test@example.com');
          await page.getByPlaceholder('Enter password').fill('secret');
          await page.getByTestId('profile-card').isVisible();
          expect(page.getByText('Welcome back')).toBeVisible();
        });
      `;

      const result = evaluateE2eAuthoringGuard({
        diffPatch: cleanDiff,
        touchedFiles: ['src/components/UserProfile.tsx'],
        taskTags: ['ui'],
      });

      expect(result.passed).toBe(true);
      expect(result.violations).toHaveLength(0);
    });

    it('rejects raw XPath selectors in test diffs', () => {
      const xpathDiff = `
        test('broken xpath', async ({ page }) => {
          await page.locator("xpath=//div[@class='container']//button").click();
        });
      `;

      const result = evaluateE2eAuthoringGuard({
        diffPatch: xpathDiff,
        touchedFiles: ['src/components/UserProfile.tsx'],
      });

      expect(result.passed).toBe(false);
      expect(result.violations).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'BRITTLE_SELECTOR',
            detail: expect.stringContaining('XPath'),
          }),
        ])
      );
    });

    it('rejects positional CSS (:nth-child, :nth-of-type, :first-child)', () => {
      const positionalDiff = `
        test('brittle positional', async ({ page }) => {
          await page.locator('ul.items > li:nth-child(3)').click();
        });
      `;

      const result = evaluateE2eAuthoringGuard({
        diffPatch: positionalDiff,
        touchedFiles: ['src/components/List.tsx'],
      });

      expect(result.passed).toBe(false);
      expect(result.violations).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'BRITTLE_SELECTOR',
            detail: expect.stringContaining('positional CSS'),
          }),
        ])
      );
    });

    it('rejects brittle CSS class chains', () => {
      const classChainDiff = `
        test('class chain', async ({ page }) => {
          await page.locator('.btn.btn-primary.btn-sm').click();
        });
      `;

      const result = evaluateE2eAuthoringGuard({
        diffPatch: classChainDiff,
        touchedFiles: ['src/components/Button.tsx'],
      });

      expect(result.passed).toBe(false);
      expect(result.violations).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'BRITTLE_SELECTOR',
            detail: expect.stringContaining('CSS class chain'),
          }),
        ])
      );
    });

    it('rejects raw ID selectors without semantic alternatives', () => {
      const idDiff = `
        test('raw id', async ({ page }) => {
          await page.locator('#submit-button').click();
        });
      `;

      const result = evaluateE2eAuthoringGuard({
        diffPatch: idDiff,
        touchedFiles: ['src/components/Button.tsx'],
      });

      expect(result.passed).toBe(false);
      expect(result.violations).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'BRITTLE_SELECTOR',
            detail: expect.stringContaining('ID selector'),
          }),
        ])
      );
    });
  });

  describe('3-Signal Financial Scope Detection', () => {
    it('detects scope via Signal 1: task tags or brief keywords', () => {
      const byTag = evaluateFinancialScope({
        touchedFiles: ['src/views/Settings.tsx'],
        taskTags: ['billing', 'ui'],
      });
      expect(byTag.isFinancialScope).toBe(true);
      expect(byTag.matchedSignals).toContain('tag:billing');

      const byBrief = evaluateFinancialScope({
        touchedFiles: ['src/views/Settings.tsx'],
        briefMarkdown: 'Calculate monthly tax invoice for user account',
      });
      expect(byBrief.isFinancialScope).toBe(true);
      expect(byBrief.matchedSignals).toContain('brief:tax');
    });

    it('detects scope via Signal 2: touched files path regex', () => {
      const byFile = evaluateFinancialScope({
        touchedFiles: [
          'src/services/payment-gateway.ts',
          'src/utils/helpers.ts',
        ],
      });
      expect(byFile.isFinancialScope).toBe(true);
      expect(byFile.matchedSignals).toContain('touchedFile:src/services/payment-gateway.ts');
    });

    it('detects scope via Signal 3: diff asserting currency or monetary values', () => {
      const byDiff = evaluateFinancialScope({
        touchedFiles: ['src/views/General.tsx'],
        diffPatch: `expect(page.getByTestId('total-due')).toHaveText('$99.95');`,
      });
      expect(byDiff.isFinancialScope).toBe(true);
      expect(byDiff.matchedSignals).toContain('diff:currency_or_monetary_keyword');
    });

    it('returns false when no financial signals are present', () => {
      const nonFinancial = evaluateFinancialScope({
        touchedFiles: ['src/views/AboutUs.tsx'],
        taskTags: ['docs', 'marketing'],
        briefMarkdown: 'Update company mission statement on the about page',
      });
      expect(nonFinancial.isFinancialScope).toBe(false);
      expect(nonFinancial.matchedSignals).toHaveLength(0);
    });
  });

  describe('Anti-Self-Grading Rule (ADR-075)', () => {
    it('fails closed when a financial task uses only agent.assert without deterministic expect', () => {
      const selfGradingDiff = `
        test('verify checkout total', async ({ page, agent }) => {
          await page.getByRole('button', { name: 'Checkout' }).click();
          await agent.assert('The total invoice looks reasonable and tax is included');
        });
      `;

      const result = evaluateE2eAuthoringGuard({
        diffPatch: selfGradingDiff,
        touchedFiles: ['src/modules/billing/invoice.ts'],
        taskTags: ['billing'],
      });

      expect(result.passed).toBe(false);
      expect(result.isFinancialOrCalculationScope).toBe(true);
      expect(result.hasDeterministicExpect).toBe(false);
      expect(result.violations).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'MISSING_DETERMINISTIC_EXPECT',
            scope: 'billing',
          }),
          expect.objectContaining({
            type: 'POSITIVISTIC_AGENT_ASSERT_ONLY',
            tool: 'agent.assert',
          }),
        ])
      );

      expect(() => enforceNoLlmSelfGrading(result)).toThrowError(GraywolfAppError);
      try {
        enforceNoLlmSelfGrading(result);
      } catch (err: unknown) {
        expect((err as GraywolfAppError).code).toBe('RELAY_DETERMINISTIC_LINTER_FAILED');
      }
    });

    it('passes when a financial task includes at least one deterministic expect(...) assertion', () => {
      const compliantDiff = `
        test('verify checkout total', async ({ page, agent }) => {
          await page.getByRole('button', { name: 'Checkout' }).click();
          await agent.assert('Check visual toast styling');
          expect(page.getByTestId('total-price')).toHaveText('$49.99');
        });
      `;

      const result = evaluateE2eAuthoringGuard({
        diffPatch: compliantDiff,
        touchedFiles: ['src/modules/billing/invoice.ts'],
        taskTags: ['billing'],
      });

      expect(result.passed).toBe(true);
      expect(result.isFinancialOrCalculationScope).toBe(true);
      expect(result.hasDeterministicExpect).toBe(true);
      expect(result.violations).toHaveLength(0);
      expect(() => enforceNoLlmSelfGrading(result)).not.toThrow();
    });

    it('allows agent.assert without expect on non-financial qualitative UI tasks', () => {
      const nonFinancialDiff = `
        test('verify banner aesthetics', async ({ page, agent }) => {
          await page.getByRole('button', { name: 'Dismiss' }).click();
          await agent.assert('The banner has smoothly faded out and toast is displayed');
        });
      `;

      const result = evaluateE2eAuthoringGuard({
        diffPatch: nonFinancialDiff,
        touchedFiles: ['src/components/Banner.tsx'],
        taskTags: ['ui', 'cosmetic'],
      });

      expect(result.passed).toBe(true);
      expect(result.isFinancialOrCalculationScope).toBe(false);
      expect(() => enforceNoLlmSelfGrading(result)).not.toThrow();
    });
  });
});
