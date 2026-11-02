import picomatch from 'picomatch';
import { DependencyGraph } from './pagerank';

/**
 * Phase 4 — Blast-Radius Boundary Algorithm (0 LLM tokens, FR-002).
 * Rule 0 immutable Forbidden defaults, keyword feature roots -> writable,
 * transitive upstream imports -> read-only, and bounded downstream dependents
 * (depth <= 1, max 20 files by PageRank) -> read-only + watchlist.
 */

export const CANONICAL_RULE_0_GLOBS: readonly string[] = Object.freeze([
  '.git/**',
  '.github/**',
  '.gitlab-ci.yml',
  'bitbucket-pipelines.yml',
  'Dockerfile*',
  'helm/**',
  'docker-compose*.yml',
  'relay.mjs',
  '.agents/constitution.md',
  '.agents/project.config.json',
]);

export const RULE_0_FORBIDDEN_GLOBS: readonly string[] = Object.freeze([
  '.git',
  '.git/**',
  '**/.git/**',
  '.github/**',
  '**/.github/**',
  '.gitlab-ci.yml',
  'bitbucket-pipelines.yml',
  '.circleci/**',
  'Jenkinsfile',
  'Dockerfile*',
  '**/Dockerfile*',
  'helm/**',
  '**/helm/**',
  'docker-compose*.yml',
  '**/docker-compose*.yml',
  'docker-compose*.yaml',
  '**/docker-compose*.yaml',
  'relay.mjs',
  '**/relay.mjs',
  '.agents/constitution.md',
  '**/.agents/constitution.md',
  '.agents/project.config.json',
  '**/.agents/project.config.json',
]);

export interface BlastRadiusProposal {
  writableScope: string[];
  readOnlyScope: string[];
  forbiddenScope: string[];
  /** Direct dependents beyond the top-N PageRank cap. */
  downstreamWatchlist: string[];
}

export interface ProposeBlastRadiusOptions {
  featureKeywords: string[];
  graph: DependencyGraph;
  pageRankScores: Record<string, number>;
  additionalForbiddenGlobs?: string[];
  /** Default: 20 (FR-002). */
  maxDownstreamFiles?: number;
}

export function proposeBlastRadius(options: ProposeBlastRadiusOptions): BlastRadiusProposal {
  const {
    featureKeywords,
    graph,
    pageRankScores,
    additionalForbiddenGlobs = [],
    maxDownstreamFiles = 20,
  } = options;

  const forbiddenGlobs = [...RULE_0_FORBIDDEN_GLOBS, ...additionalForbiddenGlobs];
  const isForbidden = picomatch(forbiddenGlobs as string[], { dot: true });

  // --- Rule 0 forbidden scope: canonical Rule 0 globs + additional globs + matched graph nodes ---
  const forbiddenNodes = new Set<string>([
    ...CANONICAL_RULE_0_GLOBS,
    ...additionalForbiddenGlobs,
  ]);
  for (const node of graph.nodes) {
    if (isForbidden(node)) forbiddenNodes.add(node);
  }

  // --- Writable scope: keyword-matched feature & test files ---
  const keywords = featureKeywords.map((keyword) => keyword.toLowerCase()).filter(Boolean);
  const writableScope = graph.nodes.filter((node) => {
    if (forbiddenNodes.has(node)) return false;
    const lowered = node.toLowerCase();
    return keywords.some((keyword) => lowered.includes(keyword));
  });

  const writableSet = new Set(writableScope);

  // --- Read-only scope: transitive upstream imports of the writable roots ---
  const readOnlySet = new Set<string>();
  const upstreamQueue = [...writableScope];
  const visitedUpstream = new Set<string>(writableScope);
  while (upstreamQueue.length > 0) {
    const current = upstreamQueue.shift() as string;
    for (const imported of graph.outgoingImports[current] ?? []) {
      if (visitedUpstream.has(imported)) continue;
      visitedUpstream.add(imported);
      upstreamQueue.push(imported);
      if (!writableSet.has(imported) && !forbiddenNodes.has(imported)) {
        readOnlySet.add(imported);
      }
    }
  }

  // --- Bounded downstream dependents (depth <= 1, top-N by PageRank) ---
  const downstreamCandidates = new Set<string>();
  for (const writable of writableScope) {
    for (const dependent of graph.incomingDependents[writable] ?? []) {
      if (writableSet.has(dependent) || forbiddenNodes.has(dependent)) continue;
      downstreamCandidates.add(dependent);
    }
  }
  const rankedDownstream = [...downstreamCandidates].sort((a, b) => {
    const scoreDelta = (pageRankScores[b] ?? 0) - (pageRankScores[a] ?? 0);
    if (scoreDelta !== 0) return scoreDelta;
    return a.localeCompare(b);
  });
  const downstreamInScope = rankedDownstream.slice(0, maxDownstreamFiles);
  const downstreamWatchlist = rankedDownstream.slice(maxDownstreamFiles);
  for (const dependent of downstreamInScope) readOnlySet.add(dependent);

  return {
    writableScope: [...writableScope].sort(),
    readOnlyScope: [...readOnlySet].sort(),
    forbiddenScope: [...forbiddenNodes].sort(),
    downstreamWatchlist,
  };
}
