import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { describe, it, expect } from 'vitest';

const execFileAsync = promisify(execFile);
const gitGuardPath = path.resolve(process.cwd(), 'src/relay/git-guard.sh');

describe('Structural Git Barrier (src/relay/git-guard.sh) (US2)', () => {
  it('blocks direct git mutation subcommands with exit code 2 and RELAY_GIT_BARRIER_VIOLATION', async () => {
    const forbiddenCommands = [
      ['commit', '-m', 'feat: should fail'],
      ['push', 'origin', 'main'],
      ['merge', 'feat-branch'],
      ['rebase', 'main'],
      ['pull', 'origin', 'main'],
      ['reset', '--hard', 'HEAD~1'],
      ['branch', '-D', 'old-branch'],
      ['checkout', '-b', 'new-branch'],
    ];

    for (const args of forbiddenCommands) {
      let threw = false;
      try {
        await execFileAsync('bash', [gitGuardPath, ...args]);
      } catch (err: unknown) {
        threw = true;
        const execErr = err as { code: number; stderr: string };
        expect(execErr.code).toBe(2);
        expect(execErr.stderr).toContain('RELAY_GIT_BARRIER_VIOLATION');
      }
      expect(threw).toBe(true);
    }
  });

  it('delegates allowed read and staging commands to real git', async () => {
    // git --version
    const versionRes = await execFileAsync('bash', [gitGuardPath, '--version']);
    expect(versionRes.stdout).toContain('git version');

    // git status in repo
    const statusRes = await execFileAsync('bash', [gitGuardPath, 'status', '--short']);
    expect(statusRes.stderr).toBe('');
  });
});
