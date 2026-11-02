# Module Contracts: Brownfield Reconnaissance, 8-Layer Context Engine & Virtual Developer Tiers

**Feature**: `011-recon-context-and-dev-tiers`  
**Phase**: Phase 9

## 1. 5-Phase Brownfield Reconnaissance (`src/orchestrator/recon/*`)

```typescript
// Phase 1: fingerprint.ts
export interface RepoFingerprint {
  languages: string[];
  frameworks: string[];
  orms: string[];
  testRunners: string[];
  packageManager: 'pnpm' | 'npm' | 'yarn' | 'go' | 'pip' | 'poetry' | 'cargo' | 'unknown';
  defaultTestCommand: string;
  defaultLintCommand: string;
  ciFiles: string[];
  containerFiles: string[];
  envTemplates: string[];
}
export function fingerprintRepository(repoRoot: string): Promise<RepoFingerprint>;

// Phase 2: ast-indexer.ts
export interface ExtractedSymbol {
  name: string;
  kind: 'function' | 'class' | 'interface' | 'type' | 'method' | 'route' | 'variable';
  filePath: string;
  lineStart: number;
  lineEnd: number;
  exported: boolean;
  signature: string;
  hash: string; // SHA-256 of file content
}
export interface ExtractedFileIndex {
  filePath: string;
  hash: string;
  symbols: ExtractedSymbol[];
  imports: string[];        // resolved relative file paths or package specifiers
  routeCalls: string[];     // normalized API paths e.g. '/api/v1/orgs/:id/members'
}
export function indexRepositoryAst(repoRoot: string, filePaths?: string[]): Promise<ExtractedFileIndex[]>;
export function normalizeRoutePath(rawRoute: string): string;

// Phase 3: pagerank.ts
export interface DependencyGraph {
  nodes: string[];
   outgoingImports: Record<string, string[]>; // file -> imported files
  incomingDependents: Record<string, string[]>; // file -> files that import it
}
export function buildDependencyGraph(fileIndices: ExtractedFileIndex[]): DependencyGraph;
export function computePageRank(
  graph: DependencyGraph,
  options?: { damping?: number; iterations?: number; tolerance?: number }
): Record<string, number>;

// Phase 4: blast-radius.ts
export const RULE_0_FORBIDDEN_GLOBS: readonly string[];
export interface BlastRadiusProposal {
  writableScope: string[];
  readOnlyScope: string[];
  forbiddenScope: string[];
  downstreamWatchlist: string[]; // direct dependents beyond the top-20 PageRank cap
}
export function proposeBlastRadius(options: {
  featureKeywords: string[];
  graph: DependencyGraph;
  pageRankScores: Record<string, number>;
  additionalForbiddenGlobs?: string[];
  maxDownstreamFiles?: number; // default: 20
}): BlastRadiusProposal;

// Phase 5: constitution-loader.ts & pipeline.ts
export interface LoadedConventions {
  sourcesFound: string[]; // ordered by ADR-038 precedence: AGENTS.md, CLAUDE.md, .cursorrules, .windsurfrules
  mergedRulesMarkdown: string;
}
export function loadProjectConventions(repoRoot: string): Promise<LoadedConventions>;
export function runReconPipeline(options: {
  repoRoot: string;
  featureKeywords?: string[];
  writeArtifacts?: boolean; // writes .agents/recon-report.md, .agents/recon-report.json, .agents/constitution.md
}): Promise<{
  fingerprint: RepoFingerprint;
  fileIndices: ExtractedFileIndex[];
  pageRankScores: Record<string, number>;
  blastRadius: BlastRadiusProposal;
  conventions: LoadedConventions;
  reconReportMarkdown: string;
  constitutionMarkdown: string;
}>;
```

---

## 2. 8-Layer Context Bundle & Exploration Engine (`src/orchestrator/context/*`)

```typescript
// Layer 1: repo-map.ts
export function generateTopologicalRepoMap(options: {
  fileIndices: ExtractedFileIndex[];
  pageRankScores: Record<string, number>;
  maxTokens?: number; // default: 1500 (~4 chars/token heuristic)
}): { markdown: string; estimatedTokens: number; includedFiles: string[] };

// Layer 2: symbol-graph.ts
export class SymbolGraphEngine {
  constructor(repoRoot: string, initialIndices?: ExtractedFileIndex[]);
  public findSymbolDefinition(symbolName: string, contextFile?: string): Promise<ExtractedSymbol[]>;
  public findSymbolReferences(symbolOrRoute: string): Promise<Array<{ filePath: string; line: number; snippet: string }>>;
}

// Layer 3: hybrid-search.ts
export interface RankedSearchHit {
  id: string;
  filePath: string;
  snippet: string;
  rrfScore: number;
  lexicalRank?: number;
  vectorRank?: number;
}
export function fuseWithRRF(
  lexicalHits: Array<{ id: string; filePath: string; snippet: string }>,
  vectorHits: Array<{ id: string; filePath: string; snippet: string }>,
  k?: number // default: 60
): RankedSearchHit[];

// Layer 4: surgical-slice.ts
export function viewFileRange(repoRoot: string, filePath: string, startLine: number, endLine: number): Promise<{
  filePath: string;
  startLine: number;
  endLine: number;
  totalLines: number;
  content: string;
}>;
export function replaceFileContent(
  repoRoot: string,
  filePath: string,
  targetContent: string,
  replacementContent: string
): Promise<{ updated: boolean; newHash: string }>;

// Layers 1-8 Assembler: bundle.ts
export interface ContextBundle {
  readonly prefixHash: string;
  readonly createdAt: string;
  readonly layer1RepoMap: string;
  readonly layer2SymbolSummary: string;
  readonly layer3SearchHints: string[];
  readonly layer4SurgicalTools: readonly string[];
  readonly layer5ProjectState: string;
  readonly layer6ProjectLessons: readonly string[];
  readonly layer7ArchitectureContext: string;
  readonly layer8InternetSearchPolicy: { readonly enabled: boolean; readonly auditLog: readonly string[] };
}
export function assembleImmutableContextBundle(input: {
  layer1RepoMap: string;
  layer2SymbolSummary?: string;
  layer3SearchHints?: string[];
  layer5ProjectState: string;
  layer6ProjectLessons?: string[];
  layer7ArchitectureContext: string;
  internetSearchEnabled?: boolean;
}): ContextBundle;
```

---

## 3. Virtual Developer Tiers & 3-Pass Adversarial Review (`src/orchestrator/tiers/*`)

```typescript
// Dev-Level-1: planner.ts
export type AccessModePill = 'plan-read-only' | 'plan-gate' | 'full-factory';
export type SupportedLocale = 'en' | 'ar' | 'fr' | 'tr';

export function runPlannerTier(options: {
  taskId: string;
  briefMarkdown: string;
  accessMode: AccessModePill;
  locale?: SupportedLocale;
  skipPlanningForSimpleBug?: boolean;
  isSimpleBug?: boolean;
  plannedTargetFiles: string[];
  blastRadiusGuard: BlastRadiusGuard;
  litellmClient?: LiteLLMClient;
}): Promise<{
  skipped: boolean;
  awaitingHumanPlanApproval: boolean;
  planMarkdown: string;
  validatedFiles: string[];
}>;

// Dev-Level-3: implementer.ts
export function wrapUntrustedBrowserObservation(rawDomOrText: string, url: string, allowedOrigin: string): string;
export function runImplementerTier(options: {
  taskId: string;
  planMarkdown: string;
  tags?: string[];
  previewServerOrigin?: string;
  litellmClient?: LiteLLMClient;
}): Promise<{
  status: 'completed';
  usedBrowserMcp: boolean;
  summary: string;
}>;

// Dev-Level-2: reviewer.ts & arbiter.ts
export interface EvidenceRecord {
  commandType: 'test' | 'lint' | 'typecheck' | 'build' | 'browser-test';
  command: string;
  exitCode: number;
}
export function evaluateAdversarialReview(options: {
  taskId: string;
  pass1: FindingsV1;
  pass2: DebateV1;
  pass3: FinalV1;
  evidenceLedger: EvidenceRecord[];
  previousConsecutiveStrikes: number;
}): {
  finalPacket: FinalV1;
  approved: boolean;
  consecutiveStrikes: number;
  shouldEscalateToArbiter: boolean;
  reviewSignoffMarkdown?: string;
};

export function runNeutralArbiter(options: {
  taskId: string;
  strikeCount: number;
  finalPacket: FinalV1;
  litellmClient?: LiteLLMClient;
}): Promise<EscalationMemo>;
```
