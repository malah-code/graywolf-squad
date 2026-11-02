import path from 'node:path';
import picomatch from 'picomatch';

export class BlastRadiusViolationError extends Error {
  constructor(filePath, operation, reason) {
    super(`Blast radius violation on '${filePath}' during '${operation}': ${reason}`);
    this.name = 'BlastRadiusViolationError';
    this.code = 'RELAY_BLAST_RADIUS_VIOLATION';
    this.exitCode = 2;
    this.filePath = filePath;
    this.operation = operation;
    this.reason = reason;
  }
}

const RULE_0_ALWAYS_FORBIDDEN = [
  '.git',
  '.git/**',
  '**/.git/**',
  '.agents/project.config.json',
  '**/.agents/project.config.json',
  '.agents/constitution.md',
  '**/.agents/constitution.md',
  'relay.mjs',
  '**/relay.mjs',
];

const isRule0Match = picomatch(RULE_0_ALWAYS_FORBIDDEN, { dot: true });

export class BlastRadiusGuard {
  constructor(options = {}) {
    this.writableGlobs = options.writableGlobs || [];
    this.readonlyGlobs = options.readonlyGlobs || [];
    this.forbiddenGlobs = options.forbiddenGlobs || [];

    this.isForbidden = picomatch(this.forbiddenGlobs, { dot: true });
    this.isWritable = picomatch(this.writableGlobs, { dot: true });
    this.isReadonly = picomatch(this.readonlyGlobs, { dot: true });
  }

  normalizePath(rawPath) {
    if (!rawPath || typeof rawPath !== 'string') {
      throw new BlastRadiusViolationError(String(rawPath), 'unknown', 'Invalid or missing file path');
    }

    let p = rawPath.replace(/\\/g, '/');

    // Strip leading /workspace/ or /workspace or ./
    if (p.startsWith('/workspace/')) {
      p = p.slice('/workspace/'.length);
    } else if (p === '/workspace') {
      p = '';
    } else if (p.startsWith('./')) {
      p = p.slice(2);
    } else if (p.startsWith('/')) {
      p = p.slice(1);
    }

    const normalized = path.posix.normalize(p);
    if (normalized === '..' || normalized.startsWith('../')) {
      throw new BlastRadiusViolationError(rawPath, 'access', 'Path traversal outside workspace root');
    }

    return normalized;
  }

  evaluate(filePath, operation = 'write') {
    const normalized = this.normalizePath(filePath);

    // Rule 0: Always-forbidden system files (hard halt)
    if (isRule0Match(normalized)) {
      throw new BlastRadiusViolationError(filePath, operation, 'Rule 0: Protected system file');
    }

    // Rule 1: Custom forbiddenGlobs (hard halt)
    if (this.isForbidden(normalized)) {
      throw new BlastRadiusViolationError(filePath, operation, 'Matched forbiddenGlobs');
    }

    // Rule 2: Writable scope (allow)
    if (this.isWritable(normalized)) {
      return 'allow';
    }

    // Rule 3: Read-only scope (escalate)
    if (this.isReadonly(normalized)) {
      return 'escalate';
    }

    // Rule 4: Default deny (escalate)
    return 'escalate';
  }
}
