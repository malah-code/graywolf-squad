/**
 * Layer 3 — Hybrid Search Rank Fusion (FR-003).
 * Lexical (`ripgrep`) and dense (`pgvector` 768-dim) hit lists are merged
 * deterministically via Reciprocal Rank Fusion:
 *   RRF_Score(d) = Σ_m 1 / (k + rank_m(d))   with k = 60.
 */

export interface SearchHitInput {
  id: string;
  filePath: string;
  snippet: string;
}

export interface RankedSearchHit {
  id: string;
  filePath: string;
  snippet: string;
  rrfScore: number;
  lexicalRank?: number;
  vectorRank?: number;
}

const DEFAULT_K = 60;

export function fuseWithRRF(
  lexicalHits: SearchHitInput[],
  vectorHits: SearchHitInput[],
  k: number = DEFAULT_K
): RankedSearchHit[] {
  const fused = new Map<string, RankedSearchHit>();

  const accumulate = (hits: SearchHitInput[], list: 'lexicalRank' | 'vectorRank'): void => {
    hits.forEach((hit, index) => {
      const rank = index + 1; // 1-based rank
      const contribution = 1 / (k + rank);
      const existing = fused.get(hit.id);
      if (existing) {
        existing.rrfScore += contribution;
        existing[list] = rank;
      } else {
        fused.set(hit.id, {
          id: hit.id,
          filePath: hit.filePath,
          snippet: hit.snippet,
          rrfScore: contribution,
          [list]: rank,
        });
      }
    });
  };

  accumulate(lexicalHits, 'lexicalRank');
  accumulate(vectorHits, 'vectorRank');

  return [...fused.values()].sort((a, b) => {
    if (b.rrfScore !== a.rrfScore) return b.rrfScore - a.rrfScore;
    return a.id.localeCompare(b.id);
  });
}
