import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import {
  ExtractedFileIndex,
  ExtractedSymbol,
  computeSha256,
  indexRepositoryAst,
  normalizeRoutePath,
} from '../recon/ast-indexer';

/**
 * Layer 2 — Symbol Graph lookup (FR-003).
 * `findSymbolDefinition` / `findSymbolReferences` verify the SHA-256 content
 * hash of each target file on disk and synchronously re-parse it before
 * returning up-to-date line numbers (mid-task edit edge case, ADR-061 context).
 */

export interface SymbolReferenceHit {
  filePath: string;
  line: number;
  snippet: string;
}

function routesMatch(a: string, b: string): boolean {
  const normA = normalizeRoutePath(a);
  const normB = normalizeRoutePath(b);
  if (normA === normB) return true;
  const segA = normA.split('/');
  const segB = normB.split('/');
  if (segA.length !== segB.length) return false;
  for (let i = 0; i < segA.length; i++) {
    if (segA[i] === segB[i]) continue;
    if (segA[i].startsWith(':') && segB[i].startsWith(':')) continue;
    return false;
  }
  return true;
}

function lineContainsRouteMatch(line: string, targetRoute: string): boolean {
  if (line.includes(targetRoute)) return true;
  const routeLiteralRe = /['"`](\/[A-Za-z0-9_\-/:{}<>$?.=&]+)['"`]/g;
  let match: RegExpExecArray | null;
  while ((match = routeLiteralRe.exec(line)) !== null) {
    if (routesMatch(match[1], targetRoute)) return true;
  }
  return false;
}

export class SymbolGraphEngine {
  private readonly repoRoot: string;
  private readonly indices: Map<string, ExtractedFileIndex> = new Map();

  constructor(repoRoot: string, initialIndices?: ExtractedFileIndex[]) {
    this.repoRoot = repoRoot;
    for (const index of initialIndices ?? []) {
      this.indices.set(index.filePath, index);
    }
  }

  /** Known indexed files (useful for tests and diagnostics). */
  public get indexedFiles(): string[] {
    return [...this.indices.keys()].sort();
  }

  /**
   * Returns the freshest index for `filePath`: reads the file from disk,
   * compares its SHA-256 against the indexed hash, and re-parses the file
   * on mismatch (on-demand re-indexing) before returning.
   */
  private async ensureFreshIndex(filePath: string): Promise<ExtractedFileIndex | null> {
    let content: string;
    try {
      content = await fs.readFile(path.join(this.repoRoot, filePath), 'utf8');
    } catch {
      return this.indices.get(filePath) ?? null;
    }

    const existing = this.indices.get(filePath);
    if (!existing) {
      const [fresh] = await indexRepositoryAst(this.repoRoot, [filePath]);
      if (fresh) this.indices.set(filePath, fresh);
      return fresh ?? null;
    }
    if (computeSha256(content) !== existing.hash) {
      const [fresh] = await indexRepositoryAst(this.repoRoot, [filePath]);
      if (fresh) {
        this.indices.set(filePath, fresh);
        return fresh;
      }
    }
    return existing;
  }

  private async readFileContent(filePath: string): Promise<string | null> {
    try {
      return await fs.readFile(path.join(this.repoRoot, filePath), 'utf8');
    } catch {
      return null;
    }
  }

  public async findSymbolDefinition(
    symbolName: string,
    contextFile?: string
  ): Promise<ExtractedSymbol[]> {
    if (contextFile) {
      const contextIndex = await this.ensureFreshIndex(contextFile);
      const localMatches =
        contextIndex?.symbols.filter((symbol) => symbol.name === symbolName) ?? [];
      if (localMatches.length > 0) return localMatches;
    }

    const results: ExtractedSymbol[] = [];
    for (const filePath of this.indexedFiles) {
      const index = await this.ensureFreshIndex(filePath);
      for (const symbol of index?.symbols ?? []) {
        if (symbol.name === symbolName) results.push(symbol);
      }
    }
    return results;
  }

  public async findSymbolReferences(
    symbolOrRoute: string
  ): Promise<SymbolReferenceHit[]> {
    // Refresh every known file first so references come from live content
    for (const filePath of this.indexedFiles) {
      await this.ensureFreshIndex(filePath);
    }

    const isRoute = symbolOrRoute.startsWith('/');
    const routeLiteral = isRoute ? normalizeRoutePath(symbolOrRoute) : symbolOrRoute;
    const escapedSymbol = symbolOrRoute.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const identifierPattern = new RegExp(`\\b${escapedSymbol}\\s*[(.]`);
    const importLinePattern = new RegExp(`^\\s*(?:import|export)\\s.*\\b${escapedSymbol}\\b`);

    const hits: SymbolReferenceHit[] = [];
    for (const filePath of this.indexedFiles) {
      const content = await this.readFileContent(filePath);
      if (content === null) continue;
      const lines = content.split('\n');

      // Declaration lines of the symbol itself are not "references"
      const declarationLines = new Set<number>();
      for (const symbol of this.indices.get(filePath)?.symbols ?? []) {
        if (symbol.name === symbolOrRoute || symbol.name === routeLiteral) {
          declarationLines.add(symbol.lineStart);
        }
      }

      for (let i = 0; i < lines.length; i++) {
        if (declarationLines.has(i + 1)) continue;
        const line = lines[i];
        const isIdentifierUse =
          !isRoute && (identifierPattern.test(line) || importLinePattern.test(line));
        const isRouteUse = isRoute && lineContainsRouteMatch(line, routeLiteral);
        if (isIdentifierUse || isRouteUse) {
          hits.push({ filePath, line: i + 1, snippet: line.trim().slice(0, 160) });
        }
      }
    }
    return hits;
  }
}
