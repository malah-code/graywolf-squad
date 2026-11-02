import * as path from 'node:path';
import pixelmatch from 'pixelmatch';

/**
 * Visual Review Packets & Pixel Diffing (Task 13.3a, ADR-077, FR-004).
 *
 * Captures:
 * 1. HTML reports & console error summaries.
 * 2. Masked screenshot diffs with pixelmatch (0.1% mismatched pixel ceiling = 0.001).
 * 3. Dynamic masking for timestamps, animated, dynamic, and avatar elements.
 * 4. WebM interaction trace metadata.
 * 5. Cached vs. Live execution provenance stamps.
 */

export const DYNAMIC_MASK_SELECTORS: readonly string[] = Object.freeze([
  '[data-testid*="timestamp"]',
  '[data-dynamic]',
  '[data-avatar]',
  '[data-animated]',
]);

export interface MaskedRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface VisualPageArtifacts {
  route: string;
  beforePng: string; // file path or base64
  afterPng: string;  // file path or base64
  screenshotTakenAt: string;
  width?: number;
  height?: number;
  rawBeforeBuffer?: Uint8Array | Buffer;
  rawAfterBuffer?: Uint8Array | Buffer;
  maskedRegions?: MaskedRegion[];
}

export interface ConsoleErrorItem {
  message: string;
  count: number;
  severity: 'error' | 'warning';
}

export interface ConsoleErrorSummary {
  pageRoute: string;
  errors: ConsoleErrorItem[];
}

export interface WebmTraceSummary {
  videoPath: string;
  durationMs: number;
  frameCount: number;
  recordedAt: string;
}

export interface VisualPageReview {
  pageRoute: string;
  beforePngPath: string;
  afterPngPath: string;
  pixelDiffRatio: number;
  isVisualRegression: boolean;
  maskedSelectors: string[];
  provenance: 'cached' | 'live';
  diffPngPath: string;
}

export interface VisualReviewPacket {
  taskId: string;
  generatedAt: string;
  cachedFlowCount: number;
  liveFlowCount: number;
  pages: VisualPageReview[];
  consoleErrors: ConsoleErrorSummary[];
  webmTraces: WebmTraceSummary[];
}

export interface BuildVisualReviewPacketInput {
  taskId: string;
  beforeRun: VisualPageArtifacts[];
  afterRun: VisualPageArtifacts[];
  cacheProvenance: { pageRoute: string; provenance: 'cached' | 'live' }[];
  consoleErrors: ConsoleErrorSummary[];
  webmTraces: WebmTraceSummary[];
  pixelDiffThreshold?: number; // default: 0.001 (0.1%)
  pixelMatchThreshold?: number; // default: 0.1
  dynamicMaskSelectors?: string[];
  outputDir?: string;
}

/**
 * Applies bounding box mask to RGBA buffer by setting alpha channel to 0
 */
export function applyMaskRegionsToRgba(
  rgba: Uint8Array | Buffer,
  width: number,
  height: number,
  regions: MaskedRegion[]
): Uint8Array {
  const masked = new Uint8Array(rgba);
  for (const region of regions) {
    const startX = Math.max(0, Math.floor(region.x));
    const startY = Math.max(0, Math.floor(region.y));
    const endX = Math.min(width, Math.ceil(region.x + region.width));
    const endY = Math.min(height, Math.ceil(region.y + region.height));

    for (let y = startY; y < endY; y++) {
      for (let x = startX; x < endX; x++) {
        const idx = (y * width + x) * 4;
        masked[idx] = 0;     // R
        masked[idx + 1] = 0; // G
        masked[idx + 2] = 0; // B
        masked[idx + 3] = 0; // A = transparent (ignored by pixelmatch)
      }
    }
  }
  return masked;
}

/**
 * Computes pixel diff ratio using pixelmatch
 */
export function computePixelmatchDiff(
  img1: Uint8Array | Buffer,
  img2: Uint8Array | Buffer,
  width: number,
  height: number,
  options?: {
    threshold?: number;
    maskedRegions?: MaskedRegion[];
  }
): { diffPixels: number; totalPixels: number; pixelDiffRatio: number; diffBuffer: Uint8Array } {
  const totalPixels = width * height;
  if (totalPixels === 0) {
    return {
      diffPixels: 0,
      totalPixels: 0,
      pixelDiffRatio: 0,
      diffBuffer: new Uint8Array(0),
    };
  }

  let buf1 = img1;
  let buf2 = img2;

  if (options?.maskedRegions && options.maskedRegions.length > 0) {
    buf1 = applyMaskRegionsToRgba(buf1, width, height, options.maskedRegions);
    buf2 = applyMaskRegionsToRgba(buf2, width, height, options.maskedRegions);
  }

  const diffBuffer = new Uint8Array(totalPixels * 4);
  const diffPixels = pixelmatch(
    buf1,
    buf2,
    diffBuffer,
    width,
    height,
    { threshold: options?.threshold ?? 0.1 }
  );

  const pixelDiffRatio = diffPixels / totalPixels;

  return {
    diffPixels,
    totalPixels,
    pixelDiffRatio,
    diffBuffer,
  };
}

/**
 * Builds Visual Review Packet from test artifacts
 */
export function buildVisualReviewPacket(
  input: BuildVisualReviewPacketInput
): VisualReviewPacket {
  const pixelDiffCeiling = input.pixelDiffThreshold ?? 0.001; // 0.1% ceiling
  const pixelMatchTolerance = input.pixelMatchThreshold ?? 0.1;
  const activeMaskSelectors = (input.dynamicMaskSelectors ?? DYNAMIC_MASK_SELECTORS).slice();

  const provenanceMap = new Map<string, 'cached' | 'live'>();
  for (const item of input.cacheProvenance) {
    provenanceMap.set(item.pageRoute.toLowerCase(), item.provenance);
  }

  let cachedFlowCount = 0;
  let liveFlowCount = 0;

  for (const prov of input.cacheProvenance) {
    if (prov.provenance === 'cached') {
      cachedFlowCount++;
    } else {
      liveFlowCount++;
    }
  }

  const pages: VisualPageReview[] = [];

  // Match before and after artifacts by route
  for (let i = 0; i < input.afterRun.length; i++) {
    const after = input.afterRun[i];
    const before = input.beforeRun.find((b) => b.route === after.route) ?? after;

    let pixelDiffRatio = 0;
    const width = after.width ?? before.width ?? 100;
    const height = after.height ?? before.height ?? 100;

    if (before.rawBeforeBuffer && after.rawAfterBuffer) {
      const diffResult = computePixelmatchDiff(
        before.rawBeforeBuffer,
        after.rawAfterBuffer,
        width,
        height,
        {
          threshold: pixelMatchTolerance,
          maskedRegions: after.maskedRegions ?? before.maskedRegions,
        }
      );
      pixelDiffRatio = diffResult.pixelDiffRatio;
    }

    const isVisualRegression = pixelDiffRatio > pixelDiffCeiling;
    const routeProvenance = provenanceMap.get(after.route.toLowerCase()) ?? 'live';
    const diffPngPath = after.afterPng
      ? after.afterPng.replace(/\.png$/i, '.diff.png')
      : path.join('.agents', 'tasks', input.taskId, 'review', `${after.route.replace(/\W+/g, '_')}.diff.png`);

    pages.push({
      pageRoute: after.route,
      beforePngPath: before.beforePng,
      afterPngPath: after.afterPng,
      pixelDiffRatio,
      isVisualRegression,
      maskedSelectors: activeMaskSelectors,
      provenance: routeProvenance,
      diffPngPath,
    });
  }

  return {
    taskId: input.taskId,
    generatedAt: new Date().toISOString(),
    cachedFlowCount,
    liveFlowCount,
    pages,
    consoleErrors: input.consoleErrors ?? [],
    webmTraces: input.webmTraces ?? [],
  };
}
