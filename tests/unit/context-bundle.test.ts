import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import * as crypto from 'node:crypto';

import { indexRepositoryAst } from '../../src/orchestrator/recon/ast-indexer';
import { buildDependencyGraph, computePageRank } from '../../src/orchestrator/recon/pagerank';
import { generateTopologicalRepoMap } from '../../src/orchestrator/context/repo-map';
import { SymbolGraphEngine } from '../../src/orchestrator/context/symbol-graph';
import { fuseWithRRF } from '../../src/orchestrator/context/hybrid-search';
import { viewFileRange, replaceFileContent } from '../../src/orchestrator/context/surgical-slice';
import { assembleImmutableContextBundle } from '../../src/orchestrator/context/bundle';

/**
 * Task 9.2 — 8-Layer Context Bundle & Hybrid Exploration Engine unit tests
 * (FR-003, SC-002).
 */

const LOGGER_TS = `export function logMessage(message: string): void {
  console.error(\`[log] \${message}\`);
}

export function formatPrefix(tag: string): string {
  logMessage(tag);
  return \`[\${tag}]\`;
}
`;

const INVOICE_TS = `import { logMessage } from './logger';

export interface Invoice {
  id: string;
  total: number;
}

export function createInvoice(id: string, total: number): Invoice {
  logMessage(\`invoice \${id}\`);
  return { id, total };
}
`;

async function writeFixtureFile(repoRoot: string, relativePath: string, content: string): Promise<void> {
  const absolute = path.join(repoRoot, relativePath);
  await fs.mkdir(path.dirname(absolute), { recursive: true });
  await fs.writeFile(absolute, content, 'utf8');
}

describe('8-Layer Context Bundle & Hybrid Exploration Engine (US2, Task 9.2)', () => {
  let repoRoot: string;

  beforeEach(async () => {
    repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'gw-context-bundle-'));
    await writeFixtureFile(repoRoot, 'src/logger.ts', LOGGER_TS);
    await writeFixtureFile(repoRoot, 'src/invoice.ts', INVOICE_TS);
  });

  afterEach(async () => {
    await fs.rm(repoRoot, { recursive: true, force: true });
  });

  it('Layer 1: repo map is PageRank-ordered and strictly capped at <= 1,500 tokens by default', async () => {
    const fileIndices = await indexRepositoryAst(repoRoot);
    const scores = computePageRank(buildDependencyGraph(fileIndices));

    const repoMap = generateTopologicalRepoMap({ fileIndices, pageRankScores: scores });
    expect(repoMap.estimatedTokens).toBeLessThanOrEqual(1500);
    expect(repoMap.estimatedTokens).toBeGreaterThan(0);
    // logger.ts is imported by invoice.ts -> higher PageRank -> listed first
    expect(repoMap.includedFiles[0]).toBe('src/logger.ts');
    expect(repoMap.markdown).toContain('# Repository Map (PageRank-ordered)');
    expect(repoMap.markdown).toContain('src/logger.ts');
    expect(repoMap.markdown).toContain('function `logMessage`');

    // Strict truncation under a tiny budget
    const tiny = generateTopologicalRepoMap({ fileIndices, pageRankScores: scores, maxTokens: 20 });
    expect(tiny.estimatedTokens).toBeLessThanOrEqual(20);
    // Deterministic: same inputs -> same map
    const again = generateTopologicalRepoMap({ fileIndices, pageRankScores: scores });
    expect(again.markdown).toBe(repoMap.markdown);
  });

  it('Layer 2: detects SHA-256 hash mismatch and re-indexes the file before returning symbol coordinates', async () => {
    const initialIndices = await indexRepositoryAst(repoRoot);
    const engine = new SymbolGraphEngine(repoRoot, initialIndices);

    const before = await engine.findSymbolDefinition('createInvoice', 'src/invoice.ts');
    expect(before).toHaveLength(1);
    expect(before[0]).toMatchObject({ lineStart: 8, lineEnd: 11, kind: 'function' });

    // Mid-task edit: prepend two lines, shifting symbol coordinates, and add a new symbol
    const edited = `// edit: shifted header line 1\n// edit: shifted header line 2\n${INVOICE_TS}export function cancelInvoice(id: string): void {\n  logMessage(\`cancel \${id}\`);\n}\n`;
    await writeFixtureFile(repoRoot, 'src/invoice.ts', edited);

    const after = await engine.findSymbolDefinition('createInvoice', 'src/invoice.ts');
    expect(after).toHaveLength(1);
    expect(after[0].lineStart).toBe(10);
    expect(after[0].lineEnd).toBe(13);

    const cancelled = await engine.findSymbolDefinition('cancelInvoice', 'src/invoice.ts');
    expect(cancelled).toHaveLength(1);
    expect(cancelled[0].kind).toBe('function');
  });

  it('Layer 2: findSymbolReferences returns import and usage hits across files', async () => {
    const initialIndices = await indexRepositoryAst(repoRoot);
    const engine = new SymbolGraphEngine(repoRoot, initialIndices);

    const references = await engine.findSymbolReferences('logMessage');
    const referenceFiles = references.map((hit) => hit.filePath);
    expect(referenceFiles).toContain('src/invoice.ts'); // import line + call line
    expect(referenceFiles).toContain('src/logger.ts'); // local usage in formatPrefix

    const importHit = references.find((hit) => hit.filePath === 'src/invoice.ts' && hit.snippet.includes('import'));
    expect(importHit).toBeDefined();

    // Cross-file route reference matching (:id vs {id} vs ${orgId})
    await writeFixtureFile(
      repoRoot,
      'src/client.ts',
      "export async function fetchMembers(orgId: string) {\n  return fetch(`/api/v1/orgs/${orgId}/members`);\n}\n"
    );
    const refreshedIndices = await indexRepositoryAst(repoRoot);
    const routeEngine = new SymbolGraphEngine(repoRoot, refreshedIndices);
    const routeRefs = await routeEngine.findSymbolReferences('/api/v1/orgs/:id/members');
    expect(routeRefs.some((hit) => hit.filePath === 'src/client.ts')).toBe(true);
  });

  it('Layer 3: RRF (k = 60) deterministically fuses lexical and vector ranks', () => {
    const lexicalHits = [
      { id: 'doc-1', filePath: 'src/billing/service.ts', snippet: 'createInvoice' },
      { id: 'doc-2', filePath: 'src/billing/routes.ts', snippet: 'registerBillingRoutes' },
    ];
    const vectorHits = [
      { id: 'doc-2', filePath: 'src/billing/routes.ts', snippet: 'registerBillingRoutes' },
      { id: 'doc-3', filePath: 'src/billing/invoice.ts', snippet: 'Invoice' },
      { id: 'doc-1', filePath: 'src/billing/service.ts', snippet: 'createInvoice' },
    ];

    const fused = fuseWithRRF(lexicalHits, vectorHits);

    // Exact formula: RRF(d) = sum(1 / (60 + rank))
    const expectedDoc1 = 1 / (60 + 1) + 1 / (60 + 3); // lexical rank 1 + vector rank 3
    const expectedDoc2 = 1 / (60 + 2) + 1 / (60 + 1); // lexical rank 2 + vector rank 1
    const expectedDoc3 = 1 / (60 + 2); // vector-only rank 2

    const byId = new Map(fused.map((hit) => [hit.id, hit]));
    expect(byId.get('doc-1')?.rrfScore).toBeCloseTo(expectedDoc1, 12);
    expect(byId.get('doc-2')?.rrfScore).toBeCloseTo(expectedDoc2, 12);
    expect(byId.get('doc-3')?.rrfScore).toBeCloseTo(expectedDoc3, 12);
    expect(byId.get('doc-1')).toMatchObject({ lexicalRank: 1, vectorRank: 3 });
    expect(byId.get('doc-3')?.lexicalRank).toBeUndefined();

    // doc-2 has the highest fused score (rank 1 vector + rank 2 lexical)
    expect(fused[0].id).toBe('doc-2');
    expect(fused.map((hit) => hit.id)).toEqual(['doc-2', 'doc-1', 'doc-3']);

    // Determinism
    expect(fuseWithRRF(lexicalHits, vectorHits)).toEqual(fused);
  });

  it('Layer 4: viewFileRange slices bounded line ranges and rejects invalid input', async () => {
    const view = await viewFileRange(repoRoot, 'src/logger.ts', 2, 4);
    expect(view).toMatchObject({ filePath: 'src/logger.ts', startLine: 2, endLine: 4, totalLines: 9 });
    expect(view.content.split('\n')).toHaveLength(3);
    expect(view.content).toContain('console.error');

    await expect(viewFileRange(repoRoot, 'src/logger.ts', 8, 2)).rejects.toThrow(/Invalid line range/);
    await expect(viewFileRange(repoRoot, 'src/logger.ts', 0, 2)).rejects.toThrow(/Invalid line range/);
    await expect(viewFileRange(repoRoot, '../escape.ts', 1, 1)).rejects.toThrow(/Path traversal/);
    await expect(viewFileRange(repoRoot, 'src/missing.ts', 1, 1)).rejects.toThrow(/File not found/);
  });

  it('Layer 4: replaceFileContent surgically replaces the first occurrence and returns the new hash', async () => {
    const result = await replaceFileContent(
      repoRoot,
      'src/logger.ts',
      'export function logMessage(message: string): void {',
      'export function logMessage(message: string, level = "info"): void {'
    );
    expect(result.updated).toBe(true);
    const updated = await fs.readFile(path.join(repoRoot, 'src/logger.ts'), 'utf8');
    expect(updated).toContain('level = "info"');
    expect(result.newHash).toBe(crypto.createHash('sha256').update(updated, 'utf8').digest('hex'));

    const missed = await replaceFileContent(repoRoot, 'src/logger.ts', 'NOT_PRESENT_TARGET', 'x');
    expect(missed.updated).toBe(false);
    expect(missed.newHash).toBe(crypto.createHash('sha256').update(updated, 'utf8').digest('hex'));

    await expect(replaceFileContent(repoRoot, '../escape.ts', 'a', 'b')).rejects.toThrow(/Path traversal/);
  });

  it('Layers 1-8: ContextBundle is deep-frozen and byte-identical across assembly runs', () => {
    const input = {
      layer1RepoMap: '# Repo Map\n- `src/invoice.ts`',
      layer2SymbolSummary: '42 symbols indexed',
      layer3SearchHints: ['billing', 'invoice'],
      layer5ProjectState: 'Project healthy, 3 open tasks',
      layer6ProjectLessons: ['Never edit migrations after merge'],
      layer7ArchitectureContext: 'Fastify + PostgreSQL + Valkey',
      internetSearchEnabled: true,
    };

    const bundle = assembleImmutableContextBundle(input);
    const twin = assembleImmutableContextBundle(input);

    // Boot-time freeze: root and every nested layer is immutable
    expect(Object.isFrozen(bundle)).toBe(true);
    expect(Object.isFrozen(bundle.layer3SearchHints)).toBe(true);
    expect(Object.isFrozen(bundle.layer6ProjectLessons)).toBe(true);
    expect(Object.isFrozen(bundle.layer8InternetSearchPolicy)).toBe(true);
    expect(Object.isFrozen(bundle.layer8InternetSearchPolicy.auditLog)).toBe(true);
    expect(bundle.layer4SurgicalTools).toEqual(['view_file_range', 'replace_file_content']);

    // Mutating a frozen bundle throws (ES modules are strict mode)
    expect(() => {
      (bundle as unknown as { layer5ProjectState: string }).layer5ProjectState = 'tampered';
    }).toThrow(TypeError);
    expect(() => {
      (bundle.layer3SearchHints as unknown as string[]).push('tampered');
    }).toThrow(TypeError);

    // Byte-identical prefix across turns (ADR-061)
    expect(twin.prefixHash).toBe(bundle.prefixHash);
    const expectedHash = crypto
      .createHash('sha256')
      .update(
        [
          input.layer1RepoMap,
          input.layer2SymbolSummary,
          input.layer3SearchHints.join('\n'),
          ['view_file_range', 'replace_file_content'].join('\n'),
          input.layer5ProjectState,
          input.layer6ProjectLessons.join('\n'),
          input.layer7ArchitectureContext,
          'internetSearchEnabled=true',
        ].join('\u0000'),
        'utf8'
      )
      .digest('hex');
    expect(bundle.prefixHash).toBe(expectedHash);

    // Different content -> different prefix hash
    const mutated = assembleImmutableContextBundle({ ...input, layer5ProjectState: 'changed' });
    expect(mutated.prefixHash).not.toBe(bundle.prefixHash);

    // Defaults: internet search disabled and lessons optional
    const minimal = assembleImmutableContextBundle({
      layer1RepoMap: 'map',
      layer5ProjectState: 'state',
      layer7ArchitectureContext: 'arch',
    });
    expect(minimal.layer8InternetSearchPolicy.enabled).toBe(false);
    expect(minimal.layer6ProjectLessons).toEqual([]);
    expect(minimal.layer2SymbolSummary).toBe('');
  });
});
