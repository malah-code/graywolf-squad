import { describe, it, expect, vi } from 'vitest';
import {
  buildVisualReviewPacket,
  computePixelmatchDiff,
} from '../../src/orchestrator/e2e/visual-packet';
import {
  runExploreSmokeGate,
  evaluateNoReproAttribution,
  type ExploreFinding,
} from '../../src/orchestrator/e2e/explore-smoke';
import type { IntentRuntime } from '../../src/orchestrator/e2e/intent-runtime';

describe('Visual Review Packets & Bounded Explore Smoke Gate (Task 13.3, ADR-076, ADR-077)', () => {
  describe('Visual Review Packets & Pixelmatch Diffing', () => {
    const width = 100;
    const height = 100;
    const totalPixels = width * height; // 10,000 pixels

    // Helper: generate uniform solid RGBA image
    function createSolidRgba(r: number, g: number, b: number, a = 255): Uint8Array {
      const buf = new Uint8Array(totalPixels * 4);
      for (let i = 0; i < buf.length; i += 4) {
        buf[i] = r;
        buf[i + 1] = g;
        buf[i + 2] = b;
        buf[i + 3] = a;
      }
      return buf;
    }

    it('reports zero diff for identical screenshot buffers', () => {
      const img1 = createSolidRgba(255, 255, 255);
      const img2 = createSolidRgba(255, 255, 255);

      const result = computePixelmatchDiff(img1, img2, width, height);

      expect(result.diffPixels).toBe(0);
      expect(result.pixelDiffRatio).toBe(0);
    });

    it('detects visual regression when pixel diff ratio exceeds 0.1% ceiling (> 0.001)', () => {
      const img1 = createSolidRgba(255, 255, 255);
      const img2 = createSolidRgba(255, 255, 255);

      // Modify 20 pixels out of 10,000 (0.2% ratio > 0.1% ceiling)
      for (let i = 0; i < 20 * 4; i += 4) {
        img2[i] = 0; // Black instead of white
        img2[i + 1] = 0;
        img2[i + 2] = 0;
      }

      const packet = buildVisualReviewPacket({
        taskId: 'TASK-200',
        beforeRun: [
          {
            route: '/billing',
            beforePng: '/tmp/before.png',
            afterPng: '/tmp/after.png',
            screenshotTakenAt: new Date().toISOString(),
            width,
            height,
            rawBeforeBuffer: img1,
          },
        ],
        afterRun: [
          {
            route: '/billing',
            beforePng: '/tmp/before.png',
            afterPng: '/tmp/after.png',
            screenshotTakenAt: new Date().toISOString(),
            width,
            height,
            rawAfterBuffer: img2,
          },
        ],
        cacheProvenance: [{ pageRoute: '/billing', provenance: 'live' }],
        consoleErrors: [],
        webmTraces: [],
      });

      expect(packet.pages).toHaveLength(1);
      const pageReview = packet.pages[0];
      expect(pageReview.pixelDiffRatio).toBeGreaterThan(0.001);
      expect(pageReview.isVisualRegression).toBe(true);
      expect(pageReview.provenance).toBe('live');
    });

    it('tolerates minor variations below 0.1% ceiling (<= 0.001)', () => {
      const img1 = createSolidRgba(255, 255, 255);
      const img2 = createSolidRgba(255, 255, 255);

      // Modify only 5 pixels out of 10,000 (0.05% ratio <= 0.1% ceiling)
      for (let i = 0; i < 5 * 4; i += 4) {
        img2[i] = 0;
        img2[i + 1] = 0;
        img2[i + 2] = 0;
      }

      const diffResult = computePixelmatchDiff(img1, img2, width, height);
      expect(diffResult.pixelDiffRatio).toBe(0.0005); // 0.05%
      expect(diffResult.pixelDiffRatio).toBeLessThanOrEqual(0.001);

      const packet = buildVisualReviewPacket({
        taskId: 'TASK-200',
        beforeRun: [
          {
            route: '/home',
            beforePng: 'before.png',
            afterPng: 'after.png',
            screenshotTakenAt: new Date().toISOString(),
            width,
            height,
            rawBeforeBuffer: img1,
          },
        ],
        afterRun: [
          {
            route: '/home',
            beforePng: 'before.png',
            afterPng: 'after.png',
            screenshotTakenAt: new Date().toISOString(),
            width,
            height,
            rawAfterBuffer: img2,
          },
        ],
        cacheProvenance: [{ pageRoute: '/home', provenance: 'cached' }],
        consoleErrors: [],
        webmTraces: [],
      });

      expect(packet.pages[0].isVisualRegression).toBe(false);
      expect(packet.pages[0].provenance).toBe('cached');
      expect(packet.cachedFlowCount).toBe(1);
      expect(packet.liveFlowCount).toBe(0);
    });

    it('masks dynamic regions (timestamps/avatars) to prevent false visual alarms', () => {
      const img1 = createSolidRgba(255, 255, 255);
      const img2 = createSolidRgba(255, 255, 255);

      // Alter pixels within a 10x10 timestamp region in the top-left (100 pixels altered = 1.0% diff!)
      for (let y = 0; y < 10; y++) {
        for (let x = 0; x < 10; x++) {
          const idx = (y * width + x) * 4;
          img2[idx] = 0;
          img2[idx + 1] = 0;
          img2[idx + 2] = 0;
        }
      }

      // Without masking: triggers regression
      const unmaskedDiff = computePixelmatchDiff(img1, img2, width, height);
      expect(unmaskedDiff.diffPixels).toBe(100);
      expect(unmaskedDiff.pixelDiffRatio).toBe(0.01); // 1.0%

      // With dynamic masking: region is zeroed out in alpha, so pixelmatch ignores it
      const maskedDiff = computePixelmatchDiff(img1, img2, width, height, {
        maskedRegions: [{ x: 0, y: 0, width: 10, height: 10 }],
      });
      expect(maskedDiff.diffPixels).toBe(0);
      expect(maskedDiff.pixelDiffRatio).toBe(0);
    });

    it('records console error summaries and WebM traces in the packet', () => {
      const packet = buildVisualReviewPacket({
        taskId: 'TASK-201',
        beforeRun: [],
        afterRun: [],
        cacheProvenance: [],
        consoleErrors: [
          {
            pageRoute: '/dashboard',
            errors: [{ message: 'Network request 500', count: 2, severity: 'error' }],
          },
        ],
        webmTraces: [
          {
            videoPath: '.agents/tasks/TASK-201/review/browser-trace.webm',
            durationMs: 4200,
            frameCount: 126,
            recordedAt: new Date().toISOString(),
          },
        ],
      });

      expect(packet.consoleErrors).toHaveLength(1);
      expect(packet.consoleErrors[0].errors[0].message).toBe('Network request 500');
      expect(packet.webmTraces).toHaveLength(1);
      expect(packet.webmTraces[0].videoPath).toContain('browser-trace.webm');
    });
  });

  describe('Bounded e2e explore Smoke Gate & "No Repro, No Bug"', () => {
    it('enforces hard cap of maxTurns = 6 turns and halts cleanly', async () => {
      const mockIntentRuntime = {
        agentAct: vi.fn().mockResolvedValue({
          taskId: 'TASK-300',
          kind: 'act',
          resolvedLocator: "getByRole('button')",
          resolvedValue: null,
          ariaSnapshotHash: 'h1',
          tokensUsed: 100,
          finished: true,
          wrappedObservation: '...',
        }),
      } as unknown as IntentRuntime;

      // Provide 10 simulated turns
      const simulatedTurns = Array.from({ length: 10 }, (_, i) => ({
        pageUrl: `http://localhost:3000/step-${i}`,
        ariaSnapshot: `<main>Step ${i}</main>`,
        intent: `Explore step ${i}`,
      }));

      const outcome = await runExploreSmokeGate({
        taskId: 'TASK-300',
        briefGoal: 'Stress test navigation',
        touchedFiles: ['src/routes/home.tsx'],
        changePatch: 'diff...',
        intentRuntime: mockIntentRuntime,
        options: { maxTurns: 6, spendLimitUSD: 0.50 },
        simulatedTurns,
      });

      expect(outcome.turnsUsed).toBe(6);
      expect(mockIntentRuntime.agentAct).toHaveBeenCalledTimes(6);
      expect(outcome.spendUsd).toBeLessThanOrEqual(0.50);
      expect(outcome.evidenceRecorded).toBe(true);
    });

    it('enforces "No Repro, No Bug": unconfirmed finding downgrades to P2 advisory with 0 strikes', () => {
      const finding: ExploreFinding = {
        id: 'find-1',
        taskId: 'TASK-301',
        pageRoute: '/checkout',
        severity: 'P0',
        expected: 'Payment succeeds',
        observed: 'Toast error displayed',
        reproSteps: ['Click pay'],
        discoveredAtTurn: 2,
        evidenceEventId: 'ev-1',
      };

      // Repro test passed (could NOT reproduce the bug)
      const unconfirmed = evaluateNoReproAttribution({
        finding,
        changePatch: '...',
        touchedFiles: ['src/components/Checkout.tsx'],
        reproFailedAsExpected: false,
      });

      expect(unconfirmed.status).toBe('UNCONFIRMED');
      expect(unconfirmed.effectiveSeverity).toBe('P2');
      expect(unconfirmed.strikeAdded).toBe(false);
      expect(unconfirmed.preExistingDefects).toContain('find-1');
    });

    it('enforces "No Repro, No Bug": confirmed P0 failure in touched code causes a Strike', () => {
      const finding: ExploreFinding = {
        id: 'find-2',
        taskId: 'TASK-302',
        pageRoute: '/cart',
        severity: 'P0',
        expected: 'Item added',
        observed: 'Unhandled 500 error',
        reproSteps: ['Click add to cart'],
        discoveredAtTurn: 3,
        evidenceEventId: 'ev-2',
      };

      // Repro test failed as expected, and stack trace intersects touched file
      const confirmed = evaluateNoReproAttribution({
        finding,
        changePatch: '...',
        touchedFiles: ['src/modules/cart/cart-service.ts'],
        reproFailedAsExpected: true,
        reproFailure: {
          stackTrace: 'Error: unhandled at CartService.add (src/modules/cart/cart-service.ts:45:10)',
          failedRoute: '/cart',
        },
      });

      expect(confirmed.status).toBe('CONFIRMED');
      expect(confirmed.effectiveSeverity).toBe('P0');
      expect(confirmed.attributionIntersectsPatch).toBe(true);
      expect(confirmed.strikeAdded).toBe(true);
      expect(confirmed.preExistingDefects).toHaveLength(0);
    });

    it('enforces "No Repro, No Bug": confirmed failure in untouched code is a pre-existing defect (0 strikes)', () => {
      const finding: ExploreFinding = {
        id: 'find-3',
        taskId: 'TASK-303',
        pageRoute: '/legacy-export',
        severity: 'P1',
        expected: 'Export downloads',
        observed: '500 Internal Error',
        reproSteps: ['Click export CSV'],
        discoveredAtTurn: 1,
        evidenceEventId: 'ev-3',
      };

      // Task only touched UI button
      const preExisting = evaluateNoReproAttribution({
        finding,
        changePatch: '...',
        touchedFiles: ['src/components/Button.tsx'],
        reproFailedAsExpected: true,
        reproFailure: {
          stackTrace: 'Error in LegacyExporter at src/backend/legacy/exporter.ts:102:5',
          failedRoute: '/legacy-export',
        },
      });

      expect(preExisting.status).toBe('UNCONFIRMED');
      expect(preExisting.effectiveSeverity).toBe('P2'); // Downgraded to P2 advisory
      expect(preExisting.attributionIntersectsPatch).toBe(false);
      expect(preExisting.strikeAdded).toBe(false); // 0 strikes against Dev-Level-3!
      expect(preExisting.preExistingDefects).toContain('find-3');
    });

    it('ISSUE-3 fix: does not false-positive on generic basename (index.ts) shared with node_modules', () => {
      // touchedFiles has 'src/modules/cart/index.ts' but the stack trace is from a node_modules file
      // that also happens to end in 'index.ts'. Before the fix, baseName='index.ts' would match
      // the node_modules stack entry, producing a false-positive strike.
      const finding: ExploreFinding = {
        id: 'find-4',
        taskId: 'TASK-304',
        pageRoute: '/cart',
        severity: 'P0',
        expected: 'Cart loads',
        observed: 'Crash on init',
        reproSteps: ['Navigate to /cart'],
        discoveredAtTurn: 1,
        evidenceEventId: 'ev-4',
      };

      const falsePositiveCheck = evaluateNoReproAttribution({
        finding,
        changePatch: '...',
        touchedFiles: ['src/modules/cart/index.ts'], // generic basename: index.ts
        reproFailedAsExpected: true,
        reproFailure: {
          // Stack trace is entirely in node_modules — unrelated to touchedFiles
          stackTrace: 'Error at Object.<anonymous> (/node_modules/some-lib/index.ts:45:10)',
          failedRoute: '/cart',
        },
      });

      // Must be UNCONFIRMED (pre-existing defect), not a strike — generic basename should not match
      expect(falsePositiveCheck.status).toBe('UNCONFIRMED');
      expect(falsePositiveCheck.strikeAdded).toBe(false);
      expect(falsePositiveCheck.attributionIntersectsPatch).toBe(false);
    });
  });
});
