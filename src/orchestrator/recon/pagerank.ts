import { ExtractedFileIndex } from './ast-indexer';

/**
 * Phase 3 — Directed Dependency Graph & PageRank Centrality (0 LLM tokens).
 * Iterative PageRank with damping 0.85 and uniform dangling-mass
 * redistribution, aligned with ADR-031 shared-module centrality ranking.
 */

export interface DependencyGraph {
  nodes: string[];
  /** file -> imported files */
  outgoingImports: Record<string, string[]>;
  /** file -> files that import it */
  incomingDependents: Record<string, string[]>;
}

export interface PageRankOptions {
  damping?: number;
  iterations?: number;
  tolerance?: number;
}

export function buildDependencyGraph(fileIndices: ExtractedFileIndex[]): DependencyGraph {
  const nodes = [...new Set(fileIndices.map((file) => file.filePath))].sort();
  const nodeSet = new Set(nodes);
  const outgoingImports: Record<string, string[]> = {};
  const incomingDependents: Record<string, string[]> = {};
  for (const node of nodes) {
    outgoingImports[node] = [];
    incomingDependents[node] = [];
  }
  for (const file of fileIndices) {
    const seen = new Set<string>();
    for (const specifier of file.imports) {
      if (!nodeSet.has(specifier) || specifier === file.filePath || seen.has(specifier)) continue;
      seen.add(specifier);
      outgoingImports[file.filePath].push(specifier);
      incomingDependents[specifier].push(file.filePath);
    }
  }
  return { nodes, outgoingImports, incomingDependents };
}

export function computePageRank(
  graph: DependencyGraph,
  options?: PageRankOptions
): Record<string, number> {
  const damping = options?.damping ?? 0.85;
  const iterations = options?.iterations ?? 100;
  const tolerance = options?.tolerance ?? 1e-6;
  const nodes = graph.nodes;
  const n = nodes.length;
  if (n === 0) return {};

  let scores: Record<string, number> = {};
  for (const node of nodes) scores[node] = 1 / n;

  for (let iteration = 0; iteration < iterations; iteration++) {
    const contributions: Record<string, number> = {};
    for (const node of nodes) contributions[node] = 0;

    // Pass 1: distribute each node's rank across its outgoing imports
    let danglingMass = 0;
    for (const node of nodes) {
      const out = graph.outgoingImports[node] ?? [];
      if (out.length > 0) {
        const share = scores[node] / out.length;
        for (const target of out) contributions[target] += share;
      } else {
        danglingMass += scores[node];
      }
    }

    // Pass 2: teleportation + damped contributions + uniform dangling mass
    let maxDelta = 0;
    const next: Record<string, number> = {};
    for (const node of nodes) {
      next[node] =
        (1 - damping) / n + damping * (contributions[node] + danglingMass / n);
      maxDelta = Math.max(maxDelta, Math.abs(next[node] - scores[node]));
    }
    scores = next;
    if (maxDelta < tolerance) break;
  }
  return scores;
}
