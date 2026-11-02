import { describe, it, expect } from 'vitest';
import {
  BlastRadiusGuard,
  BlastRadiusViolationError,
} from '../../src/relay/blast-radius-guard.mjs';

describe('Synchronous BlastRadiusGuard (US2)', () => {
  it('enforces Rule 0 protected system files even when writableGlobs is permissive', () => {
    const guard = new BlastRadiusGuard({
      writableGlobs: ['**/*'],
      readonlyGlobs: [],
      forbiddenGlobs: [],
    });

    const rule0Files = [
      '.git/config',
      'sub/.git/HEAD',
      '.agents/project.config.json',
      '.agents/constitution.md',
      'relay.mjs',
      'nested/relay.mjs',
      '/workspace/.git/index',
      './.agents/project.config.json',
    ];

    for (const file of rule0Files) {
      expect(() => guard.evaluate(file, 'write')).toThrow(BlastRadiusViolationError);
      try {
        guard.evaluate(file, 'write');
      } catch (err: unknown) {
        const error = err as BlastRadiusViolationError;
        expect(error.code).toBe('RELAY_BLAST_RADIUS_VIOLATION');
        expect(error.exitCode).toBe(2);
        expect(error.reason).toContain('Rule 0: Protected system file');
      }
    }
  });

  it('rejects path traversal escaping the workspace root', () => {
    const guard = new BlastRadiusGuard({
      writableGlobs: ['src/**'],
    });

    const traversalPaths = [
      '../etc/passwd',
      'src/../../secret.key',
      '/workspace/../../root.txt',
    ];

    for (const p of traversalPaths) {
      expect(() => guard.evaluate(p, 'write')).toThrow(BlastRadiusViolationError);
    }
  });

  it('evaluates custom forbiddenGlobs with hard halt exitCode 2', () => {
    const guard = new BlastRadiusGuard({
      writableGlobs: ['src/**'],
      forbiddenGlobs: ['src/critical-security/**'],
    });

    expect(() => guard.evaluate('src/critical-security/keys.ts', 'write')).toThrow(
      BlastRadiusViolationError
    );

    try {
      guard.evaluate('src/critical-security/keys.ts', 'write');
    } catch (err: unknown) {
      const error = err as BlastRadiusViolationError;
      expect(error.code).toBe('RELAY_BLAST_RADIUS_VIOLATION');
      expect(error.exitCode).toBe(2);
      expect(error.reason).toContain('Matched forbiddenGlobs');
    }
  });

  it('returns allow for writableGlobs, escalate for readonlyGlobs, and escalate for default-deny', () => {
    const guard = new BlastRadiusGuard({
      writableGlobs: ['src/features/**/*.ts', 'docs/**'],
      readonlyGlobs: ['package.json', 'src/core/**'],
      forbiddenGlobs: ['secrets/**'],
    });

    // Allowed writable paths
    expect(guard.evaluate('src/features/login.ts', 'write')).toBe('allow');
    expect(guard.evaluate('/workspace/docs/readme.md', 'write')).toBe('allow');

    // Escalated read-only paths
    expect(guard.evaluate('package.json', 'write')).toBe('escalate');
    expect(guard.evaluate('src/core/kernel.ts', 'write')).toBe('escalate');

    // Escalated default-deny paths (unmatched)
    expect(guard.evaluate('scripts/deploy.sh', 'write')).toBe('escalate');
    expect(guard.evaluate('tests/e2e.test.ts', 'write')).toBe('escalate');
  });
});
