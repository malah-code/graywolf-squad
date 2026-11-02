import * as crypto from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

/**
 * Phase 2 — AST Symbol & Reference Extractor (0 LLM tokens).
 * Deterministic line-oriented extraction of exported/non-exported symbols,
 * import references, call references, and normalized API route literals
 * aligned with the `code_symbols` / `code_references` canonical tables.
 */

export interface ExtractedSymbol {
  name: string;
  kind: 'function' | 'class' | 'interface' | 'type' | 'method' | 'route' | 'variable';
  filePath: string;
  lineStart: number;
  lineEnd: number;
  exported: boolean;
  signature: string;
  /** SHA-256 of the containing file's content at index time. */
  hash: string;
}

export interface ExtractedCallReference {
  name: string;
  line: number;
}

export interface ExtractedFileIndex {
  filePath: string;
  hash: string;
  symbols: ExtractedSymbol[];
  /** Resolved relative file paths (in-repo) or bare package specifiers. */
  imports: string[];
  /** Normalized API paths, e.g. '/api/v1/orgs/:id/members'. */
  routeCalls: string[];
  /** Imported binding invocations (reference_type = 'call'). */
  callReferences: ExtractedCallReference[];
}

export interface CodeReferenceRecord {
  filePath: string;
  target: string;
  referenceType: 'import' | 'call' | 'route_fetch';
  line?: number;
}

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);
const SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  'build',
  'coverage',
  '.agents',
  '.snapshots',
  '.next',
  '.cache',
  'target',
]);

const METHOD_KEYWORD_BLACKLIST = new Set([
  'if', 'for', 'while', 'switch', 'catch', 'return', 'else', 'do', 'try',
  'new', 'typeof', 'await', 'yield', 'delete', 'void', 'function', 'super',
]);

/** `:id` / `{id}` / `<id>` / `${id}` -> `:id` (colon param form, name preserved). */
export function normalizeRoutePath(rawRoute: string): string {
  let route = rawRoute.trim();
  const queryIndex = route.indexOf('?');
  if (queryIndex >= 0) route = route.slice(0, queryIndex);
  return route
    .split('/')
    .map((segment) => {
      if (segment === '') return '';
      if (/^\$\{[^{}]*\}$/.test(segment)) {
        const inner = segment.slice(2, -1).trim();
        const identifier = inner.match(/[A-Za-z_$][\w$]*$/)?.[0] ?? 'param';
        return `:${identifier}`;
      }
      if (/^\{[^{}]*\}$/.test(segment)) return `:${segment.slice(1, -1)}`;
      if (/^<[^<>]*>$/.test(segment)) return `:${segment.slice(1, -1)}`;
      return segment;
    })
    .join('/');
}

export function computeSha256(content: string): string {
  return crypto.createHash('sha256').update(content, 'utf8').digest('hex');
}

function stripStringsAndComments(line: string): string {
  return line
    .replace(/`[^`]*`/g, '""')
    .replace(/'[^']*'/g, '""')
    .replace(/"[^"]*"/g, '""')
    .replace(/\/\/.*$/, '');
}

function braceDelta(line: string): number {
  let delta = 0;
  for (const ch of stripStringsAndComments(line)) {
    if (ch === '{') delta += 1;
    else if (ch === '}') delta -= 1;
  }
  return delta;
}

/**
 * Finds the 1-based end line of a declaration starting at `startIdx` (0-based),
 * given the brace `depth` at that line. Returns `startIdx + 1` when the
 * declaration never opens a nested block (e.g. `type X = string`).
 */
function findBlockEnd(lines: string[], startIdx: number, depth: number): number {
  let current = depth;
  let openedBeyond = false;
  for (let i = startIdx; i < lines.length; i++) {
    const before = current;
    current += braceDelta(lines[i]);
    if (current > before && current > depth) openedBeyond = true;
    if (openedBeyond && current <= depth) return i + 1;
    if (!openedBeyond && i > startIdx && current < depth) return i + 1;
  }
  return openedBeyond ? lines.length : startIdx + 1;
}

interface ImportStatement {
  specifier: string;
  bindings: string[];
}

const IMPORT_FROM_RE = /^[ \t]*(?:import|export)\s+(?:type\s+)?([\s\S]*?)\s*from\s*['"]([^'"]+)['"]/gm;
const SIDE_EFFECT_IMPORT_RE = /^[ \t]*import\s*['"]([^'"]+)['"]/gm;
const REQUIRE_RE = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
const ROUTE_CALL_RE = /(?:\.(?:get|post|put|patch|delete|head|options|all|route)|\bfetch)\s*\(\s*['"`](\/[^'"`]*)['"`]/g;

const FUNCTION_RE = /^(export\s+)?(default\s+)?(async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/;
const CLASS_RE = /^(export\s+)?(default\s+)?(abstract\s+)?class\s+([A-Za-z_$][\w$]*)/;
const INTERFACE_RE = /^(export\s+)?interface\s+([A-Za-z_$][\w$]*)/;
const TYPE_RE = /^(export\s+)?type\s+([A-Za-z_$][\w$]*)\s*=/;
const VARIABLE_RE = /^(export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)/;
const METHOD_RE = /^(\s+)((?:(?:public|private|protected|static|async|readonly|get|set|override)\s+)*)(\*?\s*)([A-Za-z_$][\w$]*)\s*\(/;

function extractImportBindings(clause: string): string[] {
  const bindings: string[] = [];
  const named = clause.match(/\{([^}]*)\}/);
  if (named) {
    for (const part of named[1].split(',')) {
      const words = part.trim().split(/\s+as\s+/);
      const binding = words[words.length - 1]?.trim();
      if (binding && /^[A-Za-z_$][\w$]*$/.test(binding)) bindings.push(binding);
    }
  }
  const beforeBrace = clause.split('{')[0].replace(/,/g, ' ').trim();
  if (/^[A-Za-z_$][\w$]*$/.test(beforeBrace)) bindings.push(beforeBrace);
  const namespace = clause.match(/\*\s+as\s+([A-Za-z_$][\w$]*)/);
  if (namespace) bindings.push(namespace[1]);
  return [...new Set(bindings)];
}

function parseImports(_lines: string[], content: string): ImportStatement[] {
  const imports: ImportStatement[] = [];
  for (const fromMatch of content.matchAll(IMPORT_FROM_RE)) {
    imports.push({ specifier: fromMatch[2], bindings: extractImportBindings(fromMatch[1]) });
  }
  for (const sideEffect of content.matchAll(SIDE_EFFECT_IMPORT_RE)) {
    imports.push({ specifier: sideEffect[1], bindings: [] });
  }
  for (const match of content.matchAll(REQUIRE_RE)) {
    imports.push({ specifier: match[1], bindings: [] });
  }
  return imports;
}

function resolveImportSpecifier(fromFile: string, specifier: string, knownFiles: Set<string>): string {
  if (!specifier.startsWith('.')) return specifier;
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(fromFile), specifier));
  // ESM/bundler style: './service.js' may reference 'service.ts' on disk
  const extless = base.replace(/\.(js|jsx|mjs|cjs)$/, '');
  const candidates = [
    base,
    `${extless}.ts`,
    `${extless}.tsx`,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.js`,
    `${base}.mjs`,
    `${base}.cjs`,
    `${extless}/index.ts`,
    `${extless}/index.tsx`,
    `${extless}/index.js`,
    `${base}/index.ts`,
    `${base}/index.tsx`,
    `${base}/index.js`,
  ];
  for (const candidate of candidates) {
    if (knownFiles.has(candidate)) return candidate;
  }
  return base;
}

async function walkSourceFiles(repoRoot: string, dir: string, acc: string[]): Promise<void> {
  let entries: import('node:fs').Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // Source indexing skips every dot-directory (incl. .git, .github)
      if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue;
      await walkSourceFiles(repoRoot, abs, acc);
    } else if (entry.isFile()) {
      if (!SOURCE_EXTENSIONS.has(path.extname(entry.name))) continue;
      if (/\.d\.ts$/.test(entry.name)) continue;
      acc.push(path.relative(repoRoot, abs).split(path.sep).join('/'));
    }
  }
}

function indexFileContent(
  filePath: string,
  content: string,
  knownFiles: Set<string>
): ExtractedFileIndex {
  const hash = computeSha256(content);
  const lines = content.split('\n');
  const symbols: ExtractedSymbol[] = [];
  const routeCalls: string[] = [];

  const importStatements = parseImports(lines, content);
  const resolvedImports = [
    ...new Set(
      importStatements.map((imp) => resolveImportSpecifier(filePath, imp.specifier, knownFiles))
    ),
  ];
  const importLines = new Set<number>();
  lines.forEach((line, idx) => {
    if (/^[ \t]*(?:import|export)\b/.test(line)) importLines.add(idx);
  });

  let depth = 0;
  const classStack: Array<{ name: string; exported: boolean; depthAtOpen: number }> = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineDepth = depth;

    // --- symbols ---
    const functionMatch = line.match(FUNCTION_RE);
    const classMatch = line.match(CLASS_RE);
    const interfaceMatch = line.match(INTERFACE_RE);
    const typeMatch = line.match(TYPE_RE);
    const variableMatch = line.match(VARIABLE_RE);
    const methodMatch =
      classStack.length > 0 && /^\s+/.test(line) ? line.match(METHOD_RE) : null;

    if (functionMatch) {
      symbols.push({
        name: functionMatch[4],
        kind: 'function',
        filePath,
        lineStart: i + 1,
        lineEnd: findBlockEnd(lines, i, lineDepth),
        exported: line.trimStart().startsWith('export'),
        signature: line.trim(),
        hash,
      });
    } else if (classMatch) {
      const end = findBlockEnd(lines, i, lineDepth);
      symbols.push({
        name: classMatch[4],
        kind: 'class',
        filePath,
        lineStart: i + 1,
        lineEnd: end,
        exported: line.trimStart().startsWith('export'),
        signature: line.trim(),
        hash,
      });
      classStack.push({ name: classMatch[4], exported: line.trimStart().startsWith('export'), depthAtOpen: lineDepth });
    } else if (interfaceMatch) {
      symbols.push({
        name: interfaceMatch[2],
        kind: 'interface',
        filePath,
        lineStart: i + 1,
        lineEnd: findBlockEnd(lines, i, lineDepth),
        exported: line.trimStart().startsWith('export'),
        signature: line.trim(),
        hash,
      });
    } else if (typeMatch) {
      symbols.push({
        name: typeMatch[2],
        kind: 'type',
        filePath,
        lineStart: i + 1,
        lineEnd: findBlockEnd(lines, i, lineDepth),
        exported: line.trimStart().startsWith('export'),
        signature: line.trim(),
        hash,
      });
    } else if (variableMatch) {
      const afterName = line.slice(variableMatch[0].length);
      const isArrowFunction = /^\s*(?::[^=]+)?=\s*(?:async\s*)[(<]/.test(afterName);
      symbols.push({
        name: variableMatch[2],
        kind: isArrowFunction ? 'function' : 'variable',
        filePath,
        lineStart: i + 1,
        lineEnd: findBlockEnd(lines, i, lineDepth),
        exported: line.trimStart().startsWith('export'),
        signature: line.trim(),
        hash,
      });
    } else if (methodMatch && !METHOD_KEYWORD_BLACKLIST.has(methodMatch[4])) {
      const owner = classStack[classStack.length - 1];
      symbols.push({
        name: `${owner.name}.${methodMatch[4]}`,
        kind: 'method',
        filePath,
        lineStart: i + 1,
        lineEnd: findBlockEnd(lines, i, lineDepth),
        exported: owner.exported,
        signature: line.trim(),
        hash,
      });
    }

    // --- route literals ---
    ROUTE_CALL_RE.lastIndex = 0;
    let routeMatch: RegExpExecArray | null;
    while ((routeMatch = ROUTE_CALL_RE.exec(line)) !== null) {
      const normalized = normalizeRoutePath(routeMatch[1]);
      routeCalls.push(normalized);
      symbols.push({
        name: normalized,
        kind: 'route',
        filePath,
        lineStart: i + 1,
        lineEnd: i + 1,
        exported: true,
        signature: routeMatch[1],
        hash,
      });
    }

    // --- running brace depth & class body tracking ---
    for (const ch of stripStringsAndComments(line)) {
      if (ch === '{') {
        depth += 1;
      } else if (ch === '}') {
        depth -= 1;
        while (classStack.length > 0 && depth <= classStack[classStack.length - 1].depthAtOpen) {
          classStack.pop();
        }
      }
    }
  }

  // --- call references (imported binding invocations, reference_type 'call') ---
  const callReferences: ExtractedCallReference[] = [];
  const importBindingNames = [...new Set(importStatements.flatMap((imp) => imp.bindings))];
  for (let i = 0; i < lines.length; i++) {
    if (importLines.has(i)) continue;
    const cleaned = stripStringsAndComments(lines[i]);
    for (const binding of importBindingNames) {
      if (new RegExp(`\\b${binding}\\s*\\(`).test(cleaned)) {
        callReferences.push({ name: binding, line: i + 1 });
      }
    }
  }

  return { filePath, hash, symbols, imports: resolvedImports, routeCalls, callReferences };
}

/**
 * Indexes repository TypeScript/JavaScript sources (or an explicit subset of
 * relative `filePaths`) into `code_symbols` / `code_references`-shaped
 * in-memory indices. Phases 1–4 of recon run with 0 LLM tokens (FR-001).
 */
export async function indexRepositoryAst(
  repoRoot: string,
  filePaths?: string[]
): Promise<ExtractedFileIndex[]> {
  let files: string[];
  if (filePaths && filePaths.length > 0) {
    files = filePaths.map((f) => f.split(path.sep).join('/'));
  } else {
    files = [];
    await walkSourceFiles(repoRoot, repoRoot, files);
    files.sort();
  }

  const knownFiles = new Set(files);
  const indices: ExtractedFileIndex[] = [];
  for (const filePath of files) {
    let content: string;
    try {
      content = await fs.readFile(path.join(repoRoot, filePath), 'utf8');
    } catch {
      continue;
    }
    const index = indexFileContent(filePath, content, knownFiles);
    indices.push(index);
  }
  return indices;
}

/**
 * Derives DB-shaped `code_references` records (reference_type 'import' |
 * 'call' | 'route_fetch') from extracted file indices.
 */
export function deriveCodeReferenceRecords(fileIndices: ExtractedFileIndex[]): CodeReferenceRecord[] {
  const records: CodeReferenceRecord[] = [];
  for (const file of fileIndices) {
    for (const specifier of file.imports) {
      records.push({ filePath: file.filePath, target: specifier, referenceType: 'import' });
    }
    for (const call of file.callReferences) {
      records.push({ filePath: file.filePath, target: call.name, referenceType: 'call', line: call.line });
    }
    for (const route of file.routeCalls) {
      records.push({ filePath: file.filePath, target: route, referenceType: 'route_fetch' });
    }
  }
  return records;
}
