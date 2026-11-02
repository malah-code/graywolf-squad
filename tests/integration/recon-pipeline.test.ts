import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';

import {
  indexRepositoryAst,
  normalizeRoutePath,
  computeSha256,
} from '../../src/orchestrator/recon/ast-indexer';
import { buildDependencyGraph, computePageRank } from '../../src/orchestrator/recon/pagerank';
import {
  proposeBlastRadius,
  RULE_0_FORBIDDEN_GLOBS,
} from '../../src/orchestrator/recon/blast-radius';
import { loadProjectConventions } from '../../src/orchestrator/recon/constitution-loader';
import { runReconPipeline } from '../../src/orchestrator/recon/pipeline';

/**
 * Task 9.1 — 5-Phase Brownfield Reconnaissance Pipeline integration tests
 * against a multi-module TypeScript fixture repository (FR-001, FR-002, SC-001).
 * Phases 1–4 are pure deterministic functions consuming 0 LLM tokens.
 */

const BILLING_SERVICE = `import { logMessage } from '../../shared/logger';

export interface Invoice {
  id: string;
  total: number;
}

export function createInvoice(id: string, total: number): Invoice {
  logMessage(\`invoice \${id}\`);
  return { id, total };
}

function internalHelper(): void {
  console.error('noop');
}
`;

const BILLING_ROUTES = `import { createInvoice } from './service';

export function registerBillingRoutes(app: { get: (r: string, h: unknown) => void; post: (r: string, h: unknown) => void }): void {
  app.get('/api/v1/orgs/:id/members', () => null);
  app.post('/api/v1/orgs/{orgId}/invoices', () => createInvoice('r', 0));
}
`;

const AUTH_SERVICE = `import { logMessage } from '../../shared/logger';

export function authenticate(user: string): boolean {
  logMessage(\`auth \${user}\`);
  return user.length > 0;
}
`;

const SHARED_LOGGER = `export function logMessage(message: string): void {
  console.error(\`[log] \${message}\`);
}
`;

const INVENTORY_SERVICE = `import { createInvoice } from '../billing/service';

export function restockInvoices(): string[] {
  return [createInvoice('i', 2).id];
}
`;

const INVENTORY_API = `import { restockInvoices } from './service';

export function inventoryEndpoint(): string[] {
  return restockInvoices();
}
`;

async function writeFixtureFile(repoRoot: string, relativePath: string, content: string): Promise<void> {
  const absolute = path.join(repoRoot, relativePath);
  await fs.mkdir(path.dirname(absolute), { recursive: true });
  await fs.writeFile(absolute, content, 'utf8');
}

async function createFixtureRepository(): Promise<string> {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'gw-recon-fixture-'));

  await writeFixtureFile(repoRoot, 'package.json', JSON.stringify({
    name: 'fixture-billing-app',
    private: true,
    scripts: { test: 'vitest run', lint: 'eslint src tests' },
    dependencies: { fastify: '^5.0.0', prisma: '^6.0.0', pg: '^8.0.0' },
    devDependencies: { vitest: '^3.0.0', eslint: '^9.0.0' },
  }, null, 2));
  await writeFixtureFile(repoRoot, 'pnpm-lock.yaml', '# fixture lockfile\n');
  await writeFixtureFile(repoRoot, '.env.example', 'DATABASE_URL=postgres://localhost/fixture\n');
  await writeFixtureFile(repoRoot, '.github/workflows/ci.yml', 'name: CI\n');
  await writeFixtureFile(repoRoot, '.gitlab-ci.yml', 'stages: [test]\n');
  await writeFixtureFile(repoRoot, 'Dockerfile', 'FROM node:20\n');
  await writeFixtureFile(repoRoot, 'docker-compose.yml', 'services: {}\n');
  await writeFixtureFile(repoRoot, 'AGENTS.md', '# Fixture Agents Rules\n\n- Always use typed returns.\n');
  await writeFixtureFile(repoRoot, 'CLAUDE.md', '# Fixture Claude Rules\n\n- Prefer explicit imports.\n');
  await writeFixtureFile(repoRoot, '.cursorrules', 'Always use pnpm.\n');
  await writeFixtureFile(repoRoot, 'relay.mjs', 'export function relayStub() { return 1; }\n');

  await writeFixtureFile(repoRoot, 'src/shared/logger.ts', SHARED_LOGGER);
  await writeFixtureFile(repoRoot, 'src/modules/billing/service.ts', BILLING_SERVICE);
  await writeFixtureFile(repoRoot, 'src/modules/billing/routes.ts', BILLING_ROUTES);
  await writeFixtureFile(repoRoot, 'src/modules/auth/service.ts', AUTH_SERVICE);
  await writeFixtureFile(repoRoot, 'src/modules/inventory/service.ts', INVENTORY_SERVICE);
  await writeFixtureFile(repoRoot, 'src/modules/inventory/api.ts', INVENTORY_API);

  // 25 downstream consumer files (tests the >20 bounded dependents edge case)
  for (let i = 0; i < 25; i++) {
    const padded = String(i).padStart(2, '0');
    await writeFixtureFile(
      repoRoot,
      `consumer/consumer-${padded}.ts`,
      `import { createInvoice } from '../src/modules/billing/service';\n\nexport function consumerFlow${padded}(): string {\n  return createInvoice('c-${padded}', 1).id;\n}\n`
    );
  }

  await writeFixtureFile(
    repoRoot,
    'tests/billing-routes.test.ts',
    `import { createInvoice } from '../src/modules/billing/service';\n\nit('creates', () => {\n  createInvoice('t', 0);\n});\n`
  );

  return repoRoot;
}

describe('5-Phase Brownfield Reconnaissance Pipeline (US1, Task 9.1)', () => {
  let repoRoot: string;

  beforeEach(async () => {
    repoRoot = await createFixtureRepository();
  });

  afterEach(async () => {
    await fs.rm(repoRoot, { recursive: true, force: true });
  });

  it('Phase 1 fingerprints the stack with 0 LLM tokens and detects CI/CD control files', async () => {
    const { fingerprintRepository } = await import('../../src/orchestrator/recon/fingerprint');
    const fingerprint = await fingerprintRepository(repoRoot);

    expect(fingerprint.languages).toContain('typescript');
    expect(fingerprint.frameworks).toContain('fastify');
    expect(fingerprint.orms).toContain('prisma');
    expect(fingerprint.testRunners).toContain('vitest');
    expect(fingerprint.packageManager).toBe('pnpm');
    expect(fingerprint.defaultTestCommand).toBe('pnpm run test');
    expect(fingerprint.defaultLintCommand).toBe('pnpm run lint');
    expect(fingerprint.ciFiles).toContain('.github/workflows/ci.yml');
    expect(fingerprint.ciFiles).toContain('.gitlab-ci.yml');
    expect(fingerprint.containerFiles).toContain('Dockerfile');
    expect(fingerprint.containerFiles).toContain('docker-compose.yml');
    expect(fingerprint.envTemplates).toContain('.env.example');
  });

  it('Phase 2 extracts symbols, line ranges, SHA-256 hashes, imports, and normalized route literals', async () => {
    const fileIndices = await indexRepositoryAst(repoRoot);
    const byPath = new Map(fileIndices.map((index) => [index.filePath, index]));

    const service = byPath.get('src/modules/billing/service.ts');
    expect(service).toBeDefined();

    const content = await fs.readFile(path.join(repoRoot, 'src/modules/billing/service.ts'), 'utf8');
    const expectedHash = computeSha256(content);
    expect(service?.hash).toBe(expectedHash);

    const invoice = service?.symbols.find((symbol) => symbol.name === 'Invoice');
    expect(invoice).toMatchObject({
      kind: 'interface',
      lineStart: 3,
      lineEnd: 6,
      exported: true,
      hash: expectedHash,
    });

    const createInvoice = service?.symbols.find((symbol) => symbol.name === 'createInvoice');
    expect(createInvoice).toMatchObject({ kind: 'function', lineStart: 8, lineEnd: 11, exported: true });

    const internalHelper = service?.symbols.find((symbol) => symbol.name === 'internalHelper');
    expect(internalHelper).toMatchObject({ lineStart: 13, lineEnd: 15, exported: false });

    expect(service?.imports).toContain('src/shared/logger.ts');

    const routes = byPath.get('src/modules/billing/routes.ts');
    expect(routes?.symbols.some((symbol) => symbol.kind === 'route' && symbol.name === '/api/v1/orgs/:id/members')).toBe(true);
    expect(routes?.routeCalls).toContain('/api/v1/orgs/:id/members');
    expect(routes?.routeCalls).toContain('/api/v1/orgs/:orgId/invoices');
  });

  it('normalizes :id / {id} / <id> route param literals', () => {
    expect(normalizeRoutePath('/api/v1/orgs/{id}/members')).toBe('/api/v1/orgs/:id/members');
    expect(normalizeRoutePath('/api/v1/orgs/<id>/members')).toBe('/api/v1/orgs/:id/members');
    expect(normalizeRoutePath('/api/v1/orgs/:id/members')).toBe('/api/v1/orgs/:id/members');
    expect(normalizeRoutePath('/api/v1/orgs/:id/members?verbose=true')).toBe('/api/v1/orgs/:id/members');
  });

  it('Phase 3 ranks core shared modules above leaf modules via PageRank', async () => {
    const fileIndices = await indexRepositoryAst(repoRoot);
    const graph = buildDependencyGraph(fileIndices);
    const scores = computePageRank(graph);

    expect(scores['src/shared/logger.ts']).toBeGreaterThan(scores['src/modules/billing/routes.ts']);
    expect(scores['src/modules/billing/service.ts']).toBeGreaterThan(scores['src/modules/billing/routes.ts']);
    expect(scores['src/modules/inventory/service.ts']).toBeGreaterThan(scores['consumer/consumer-00.ts']);

    const total = Object.values(scores).reduce((sum, score) => sum + score, 0);
    expect(total).toBeGreaterThan(0);
  });

  it('Phase 4 proposes bounded blast radius: keyword writable, upstream read-only, <= 20 downstream, Rule 0 forbidden', async () => {
    const fileIndices = await indexRepositoryAst(repoRoot);
    const graph = buildDependencyGraph(fileIndices);
    const scores = computePageRank(graph);
    const proposal = proposeBlastRadius({ featureKeywords: ['billing'], graph, pageRankScores: scores });

    expect(proposal.writableScope).toContain('src/modules/billing/service.ts');
    expect(proposal.writableScope).toContain('src/modules/billing/routes.ts');
    expect(proposal.writableScope).toContain('tests/billing-routes.test.ts');
    expect(proposal.writableScope).not.toContain('relay.mjs');

    // Transitive upstream imports -> read-only
    expect(proposal.readOnlyScope).toContain('src/shared/logger.ts');

    // Depth <= 1: direct dependents only; inventory/api.ts is depth 2 and excluded
    expect(proposal.readOnlyScope).toContain('src/modules/inventory/service.ts');
    expect(proposal.readOnlyScope).not.toContain('src/modules/inventory/api.ts');
    expect(proposal.downstreamWatchlist).not.toContain('src/modules/inventory/api.ts');

    // Bounded downstream: 26 direct dependents -> top 20 in readOnly, 6 overflow watchlisted
    const downstreamSourced = proposal.readOnlyScope.filter(
      (file) => file.startsWith('consumer/') || file === 'src/modules/inventory/service.ts'
    );
    expect(downstreamSourced.length).toBeLessThanOrEqual(20);
    expect(proposal.downstreamWatchlist.length).toBe(6);
    expect(proposal.downstreamWatchlist.every((file) => file.startsWith('consumer/'))).toBe(true);

    // Rule 0: relay.mjs node match lands in forbidden scope
    expect(proposal.forbiddenScope).toContain('relay.mjs');
    for (const fr002Glob of ['.git/**', '.github/**', '.gitlab-ci.yml', 'bitbucket-pipelines.yml', 'Dockerfile*', 'helm/**', 'docker-compose*.yml', 'relay.mjs', '.agents/constitution.md', '.agents/project.config.json']) {
      expect(RULE_0_FORBIDDEN_GLOBS).toContain(fr002Glob);
    }
  });

  it('Phase 5 loads the ADR-038 convention cascade in precedence order', async () => {
    const conventions = await loadProjectConventions(repoRoot);
    expect(conventions.sourcesFound).toEqual(['AGENTS.md', 'CLAUDE.md', '.cursorrules']);
    expect(conventions.mergedRulesMarkdown).toContain('Always use typed returns.');
    expect(conventions.mergedRulesMarkdown).toContain('Prefer explicit imports.');
    expect(conventions.mergedRulesMarkdown).toContain('Always use pnpm.');
  });

  it('end-to-end pipeline emits .agents/recon-report.md, recon-report.json (F14), and constitution.md', async () => {
    const result = await runReconPipeline({ repoRoot, featureKeywords: ['billing'] });

    // Rule 0 system-level: CI/CD + container control files always forbidden
    for (const controlFile of ['.github/workflows/ci.yml', '.gitlab-ci.yml', 'Dockerfile', 'docker-compose.yml', 'relay.mjs']) {
      expect(result.blastRadius.forbiddenScope).toContain(controlFile);
    }
    expect(result.blastRadius.writableScope).toContain('src/modules/billing/service.ts');
    expect(result.blastRadius.readOnlyScope).toContain('src/shared/logger.ts');

    const reportPath = path.join(repoRoot, '.agents', 'recon-report.md');
    const jsonPath = path.join(repoRoot, '.agents', 'recon-report.json');
    const constitutionPath = path.join(repoRoot, '.agents', 'constitution.md');

    const reportMarkdown = await fs.readFile(reportPath, 'utf8');
    expect(reportMarkdown).toContain('# Brownfield Reconnaissance Report');
    expect(reportMarkdown).toContain('## 3. Proposed Blast Radius (Phase 4)');
    expect(reportMarkdown).toContain('### Downstream Regression Watchlist');

    const reportJson = JSON.parse(await fs.readFile(jsonPath, 'utf8')) as {
      schemaVersion: string;
      fingerprint: { packageManager: string };
      blastRadius: { forbiddenScope: string[]; downstreamWatchlist: string[] };
      conventionsSources: string[];
    };
    expect(reportJson.schemaVersion).toBe('recon-report.v1');
    expect(reportJson.fingerprint.packageManager).toBe('pnpm');
    expect(reportJson.blastRadius.forbiddenScope).toContain('Dockerfile');
    expect(reportJson.blastRadius.downstreamWatchlist.length).toBe(6);
    expect(reportJson.conventionsSources).toEqual(['AGENTS.md', 'CLAUDE.md', '.cursorrules']);

    const constitutionMarkdown = await fs.readFile(constitutionPath, 'utf8');
    expect(constitutionMarkdown).toContain('## Rule 0 — Immutable Forbidden Scope');
    expect(constitutionMarkdown).toContain('Always use typed returns.');
  });

  it('Phases 1-4 remain deterministic across repeated runs (0 tokens, byte-stable scopes)', async () => {
    const first = await runReconPipeline({ repoRoot, featureKeywords: ['billing'], writeArtifacts: false });
    const second = await runReconPipeline({ repoRoot, featureKeywords: ['billing'], writeArtifacts: false });
    expect(first.blastRadius.writableScope).toEqual(second.blastRadius.writableScope);
    expect(first.blastRadius.readOnlyScope).toEqual(second.blastRadius.readOnlyScope);
    expect(first.blastRadius.forbiddenScope).toEqual(second.blastRadius.forbiddenScope);
    expect(first.blastRadius.downstreamWatchlist).toEqual(second.blastRadius.downstreamWatchlist);
    expect(first.pageRankScores['src/shared/logger.ts']).toBe(second.pageRankScores['src/shared/logger.ts']);
  });
});
