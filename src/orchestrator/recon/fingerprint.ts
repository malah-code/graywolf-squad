import * as fs from 'node:fs/promises';
import * as path from 'node:path';

/**
 * Phase 1 — Repository Fingerprint (0 LLM tokens).
 * Deterministic filesystem detection of languages, frameworks, ORMs, test
 * runners, package managers, and CI/CD / container / env-template control
 * files (FR-001). No network, no model calls.
 */

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

const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'coverage',
  '.agents',
  '.snapshots',
  '.next',
  '.cache',
  'target',
  '__pycache__',
  '.venv',
]);

const EXTENSION_LANGUAGES: Record<string, string> = {
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.mts': 'typescript',
  '.cts': 'typescript',
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.py': 'python',
  '.go': 'go',
  '.rs': 'rust',
  '.java': 'java',
  '.rb': 'ruby',
  '.php': 'php',
  '.cs': 'csharp',
  '.swift': 'swift',
  '.kt': 'kotlin',
};

const FRAMEWORK_PACKAGES: ReadonlyArray<readonly [string, readonly string[]]> = [
  ['fastify', ['fastify']],
  ['express', ['express']],
  ['koa', ['koa']],
  ['@hapi/hapi', ['hapi']],
  ['@nestjs/core', ['nestjs']],
  ['next', ['next.js']],
  ['nuxt', ['nuxt']],
  ['react', ['react']],
  ['react-dom', ['react']],
  ['vue', ['vue']],
  ['svelte', ['svelte']],
  ['@angular/core', ['angular']],
];

const ORM_PACKAGES: ReadonlyArray<readonly [string, readonly string[]]> = [
  ['prisma', ['prisma']],
  ['@prisma/client', ['prisma']],
  ['typeorm', ['typeorm']],
  ['sequelize', ['sequelize']],
  ['mongoose', ['mongoose']],
  ['drizzle-orm', ['drizzle-orm']],
  ['knex', ['knex']],
  ['@mikro-orm/core', ['mikro-orm']],
];

const TEST_RUNNER_PACKAGES: ReadonlyArray<readonly [string, readonly string[]]> = [
  ['vitest', ['vitest']],
  ['jest', ['jest']],
  ['mocha', ['mocha']],
  ['@playwright/test', ['playwright']],
  ['cypress', ['cypress']],
  ['@vue/test-utils', ['vue-test-utils']],
];

interface PackageJsonLike {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  scripts?: Record<string, string>;
}

async function walkFiles(repoRoot: string, dir: string, acc: string[]): Promise<void> {
  let entries: import('node:fs').Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '.git') continue;
      // Skip dot-directories except CI config dirs (.github, .circleci)
      if (entry.name.startsWith('.') && entry.name !== '.github' && entry.name !== '.circleci') {
        continue;
      }
      if (SKIP_DIRS.has(entry.name)) continue;
      await walkFiles(repoRoot, abs, acc);
    } else if (entry.isFile()) {
      acc.push(path.relative(repoRoot, abs).split(path.sep).join('/'));
    }
  }
}

function detectPackageManager(rootFiles: Set<string>, packageJson: PackageJsonLike | null): RepoFingerprint['packageManager'] {
  if (rootFiles.has('pnpm-lock.yaml')) return 'pnpm';
  if (rootFiles.has('yarn.lock')) return 'yarn';
  if (rootFiles.has('package-lock.json')) return 'npm';
  if (rootFiles.has('go.mod')) return 'go';
  if (rootFiles.has('Cargo.toml')) return 'cargo';
  if (rootFiles.has('poetry.lock')) return 'poetry';
  if (rootFiles.has('requirements.txt') || rootFiles.has('pyproject.toml')) return 'pip';
  if (packageJson) return 'npm';
  return 'unknown';
}

function matchesAny(depName: string, table: ReadonlyArray<readonly [string, readonly string[]]>): string[] {
  const out: string[] = [];
  for (const [pkg, labels] of table) {
    if (depName === pkg || depName.startsWith(`${pkg}/`)) out.push(...labels);
  }
  return out;
}

export async function fingerprintRepository(repoRoot: string): Promise<RepoFingerprint> {
  const allFiles: string[] = [];
  await walkFiles(repoRoot, repoRoot, allFiles);

  const languages = new Set<string>();
  for (const file of allFiles) {
    const ext = path.extname(file).toLowerCase();
    const language = EXTENSION_LANGUAGES[ext];
    if (language) languages.add(language);
  }

  // package.json analysis (Node ecosystems)
  let packageJson: PackageJsonLike | null = null;
  const packageJsonPath = path.join(repoRoot, 'package.json');
  try {
    packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf8')) as PackageJsonLike;
  } catch {
    packageJson = null;
  }

  const frameworks = new Set<string>();
  const orms = new Set<string>();
  const testRunners = new Set<string>();
  if (packageJson) {
    const depNames = [
      ...Object.keys(packageJson.dependencies ?? {}),
      ...Object.keys(packageJson.devDependencies ?? {}),
    ];
    for (const dep of depNames) {
      for (const framework of matchesAny(dep, FRAMEWORK_PACKAGES)) frameworks.add(framework);
      for (const orm of matchesAny(dep, ORM_PACKAGES)) orms.add(orm);
      for (const runner of matchesAny(dep, TEST_RUNNER_PACKAGES)) testRunners.add(runner);
    }
  }

  // Python / Go / Rust ecosystems
  const rootFiles = new Set(allFiles.filter((f) => !f.includes('/')));
  if (rootFiles.has('go.mod')) {
    languages.add('go');
    testRunners.add('go test');
  }
  if (rootFiles.has('Cargo.toml')) {
    languages.add('rust');
    testRunners.add('cargo test');
  }
  if (rootFiles.has('requirements.txt') || rootFiles.has('pyproject.toml')) {
    const pyDeps = new Set<string>();
    if (rootFiles.has('requirements.txt')) {
      const content = await fs.readFile(path.join(repoRoot, 'requirements.txt'), 'utf8').catch(() => '');
      for (const line of content.split('\n')) {
        const trimmed = line.trim();
        let cut = trimmed.length;
        for (const delimiter of ['=', '>', '<', '~', '!', '[']) {
          const delimiterIndex = trimmed.indexOf(delimiter);
          if (delimiterIndex >= 0 && delimiterIndex < cut) cut = delimiterIndex;
        }
        const name = trimmed.slice(0, cut).trim();
        if (name) pyDeps.add(name.toLowerCase());
      }
    }
    if (pyDeps.has('pytest')) testRunners.add('pytest');
    if (pyDeps.has('django')) frameworks.add('django');
    if (pyDeps.has('flask')) frameworks.add('flask');
    if (pyDeps.has('fastapi')) frameworks.add('fastapi');
  }

  const packageManager = detectPackageManager(rootFiles, packageJson);

  // Default commands — deterministic precedence: npm scripts > detected tooling
  const nodePms: RepoFingerprint['packageManager'][] = ['pnpm', 'npm', 'yarn'];
  const isNodePm = nodePms.includes(packageManager);
  let defaultTestCommand = '';
  let defaultLintCommand = '';
  const testScript = packageJson?.scripts?.test;
  const lintScript = packageJson?.scripts?.lint;
  if (testScript && isNodePm) {
    defaultTestCommand = `${packageManager} run test`;
  } else if (isNodePm) {
    if (testRunners.has('vitest')) defaultTestCommand = `${packageManager} exec vitest run`;
    else if (testRunners.has('jest')) defaultTestCommand = `${packageManager} exec jest`;
    else if (testRunners.has('mocha')) defaultTestCommand = `${packageManager} exec mocha`;
    else if (testRunners.has('playwright')) defaultTestCommand = `${packageManager} exec playwright test`;
    else if (testRunners.has('cypress')) defaultTestCommand = `${packageManager} exec cypress run`;
  } else if (packageManager === 'go') {
    defaultTestCommand = 'go test ./...';
    defaultLintCommand = 'go vet ./...';
  } else if (packageManager === 'cargo') {
    defaultTestCommand = 'cargo test';
    defaultLintCommand = 'cargo clippy';
  } else if (packageManager === 'pip' || packageManager === 'poetry') {
    if (testRunners.has('pytest')) {
      defaultTestCommand = packageManager === 'poetry' ? 'poetry run pytest' : 'pytest';
    }
  }
  if (lintScript && isNodePm) {
    defaultLintCommand = `${packageManager} run lint`;
  } else if (isNodePm && packageJson) {
    const hasEslint =
      'eslint' in (packageJson.devDependencies ?? {}) || 'eslint' in (packageJson.dependencies ?? {});
    if (hasEslint) defaultLintCommand = `${packageManager} exec eslint .`;
  }

  // CI/CD, container, and env-template classification (Rule 0 inputs)
  const ciFiles = allFiles.filter((file) => {
    if (file.startsWith('.github/workflows/') && /\.(yml|yaml)$/.test(file)) return true;
    if (file.startsWith('.circleci/') && file.endsWith('config.yml')) return true;
    return (
      file === '.gitlab-ci.yml' ||
      file === 'bitbucket-pipelines.yml' ||
      file === 'Jenkinsfile' ||
      file === '.travis.yml' ||
      file === 'azure-pipelines.yml' ||
      file === '.drone.yml'
    );
  });

  const containerFiles = allFiles.filter((file) => {
    const base = file.split('/').pop() ?? file;
    if (/^Dockerfile(\..+)?$/.test(base) || /^Containerfile(\..+)?$/.test(base)) return true;
    return /^docker-compose.*\.(yml|yaml)$/.test(base);
  });

  const envTemplates = allFiles.filter((file) => {
    const base = file.split('/').pop() ?? file;
    return /^\.env(\..+)?\.(example|template)$/.test(base) || base === '.env.example';
  });

  return {
    languages: [...languages].sort(),
    frameworks: [...frameworks].sort(),
    orms: [...orms].sort(),
    testRunners: [...testRunners].sort(),
    packageManager,
    defaultTestCommand,
    defaultLintCommand,
    ciFiles: ciFiles.sort(),
    containerFiles: containerFiles.sort(),
    envTemplates: envTemplates.sort(),
  };
}
