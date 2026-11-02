import * as crypto from 'node:crypto';

/**
 * Layers 1–8 Boot-Time Immutable Context Bundle assembler (FR-003, ADR-061).
 * The assembled bundle is deep-frozen (`Object.freeze`) so the static prefix
 * stays 100% byte-identical across every agent turn within a container
 * session, preserving prompt-cache stability.
 */

export interface ContextBundle {
  readonly prefixHash: string;
  readonly createdAt: string;
  /** Layer 1: PageRank repo map (~1,500 tokens). */
  readonly layer1RepoMap: string;
  /** Layer 2: Symbol graph metadata summary. */
  readonly layer2SymbolSummary: string;
  /** Layer 3: Hybrid search hints. */
  readonly layer3SearchHints: readonly string[];
  /** Layer 4: Surgical tool descriptors. */
  readonly layer4SurgicalTools: readonly string[];
  /** Layer 5: Project State Summary. */
  readonly layer5ProjectState: string;
  /** Layer 6: `project_lessons` anti-patterns. */
  readonly layer6ProjectLessons: readonly string[];
  /** Layer 7: Architecture context. */
  readonly layer7ArchitectureContext: string;
  /** Layer 8: Gated Internet Search policy + audit log. */
  readonly layer8InternetSearchPolicy: {
    readonly enabled: boolean;
    readonly auditLog: readonly string[];
  };
}

export interface AssembleContextBundleInput {
  layer1RepoMap: string;
  layer2SymbolSummary?: string;
  layer3SearchHints?: string[];
  layer5ProjectState: string;
  layer6ProjectLessons?: string[];
  layer7ArchitectureContext: string;
  internetSearchEnabled?: boolean;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.freeze(value);
    for (const nested of Object.values(value as Record<string, unknown>)) {
      deepFreeze(nested);
    }
  }
  return value;
}

export const DEFAULT_LAYER4_SURGICAL_TOOLS: readonly string[] = Object.freeze([
  'view_file_range',
  'replace_file_content',
]);

export function assembleImmutableContextBundle(input: AssembleContextBundleInput): ContextBundle {
  const layer1RepoMap = input.layer1RepoMap;
  const layer2SymbolSummary = input.layer2SymbolSummary ?? '';
  const layer3SearchHints = Object.freeze([...(input.layer3SearchHints ?? [])]);
  const layer4SurgicalTools = DEFAULT_LAYER4_SURGICAL_TOOLS;
  const layer5ProjectState = input.layer5ProjectState;
  const layer6ProjectLessons = Object.freeze([...(input.layer6ProjectLessons ?? [])]);
  const layer7ArchitectureContext = input.layer7ArchitectureContext;
  const layer8InternetSearchPolicy = Object.freeze({
    enabled: input.internetSearchEnabled ?? false,
    auditLog: Object.freeze([] as string[]),
  });

  // Prefix hash covers layer content only (createdAt excluded) so identical
  // inputs always produce an identical prefix hash.
  const prefixMaterial = [
    layer1RepoMap,
    layer2SymbolSummary,
    layer3SearchHints.join('\n'),
    layer4SurgicalTools.join('\n'),
    layer5ProjectState,
    layer6ProjectLessons.join('\n'),
    layer7ArchitectureContext,
    `internetSearchEnabled=${layer8InternetSearchPolicy.enabled}`,
  ].join('\u0000');
  const prefixHash = crypto.createHash('sha256').update(prefixMaterial, 'utf8').digest('hex');

  return deepFreeze({
    prefixHash,
    createdAt: new Date().toISOString(),
    layer1RepoMap,
    layer2SymbolSummary,
    layer3SearchHints,
    layer4SurgicalTools,
    layer5ProjectState,
    layer6ProjectLessons,
    layer7ArchitectureContext,
    layer8InternetSearchPolicy,
  }) as ContextBundle;
}
