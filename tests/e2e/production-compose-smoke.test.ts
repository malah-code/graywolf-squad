import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import { healthRoutes } from '../../src/orchestrator/routes/health';
import { parseEnv } from '../../src/orchestrator/config/env';
import { LocalFileKekProvider } from '../../src/orchestrator/security/kek-vault';

describe('Production Bootstrap Installer and Cold-Boot Smoke Suite (Task 17.3, FR-007, FR-008, SC-003, SC-004)', () => {
  const rootDir = path.resolve(__dirname, '../../');
  const installScriptPath = path.join(rootDir, 'scripts/install.sh');
  const migrateScriptPath = path.join(rootDir, 'scripts/db-migrate-init.sh');

  it('runs scripts/install.sh --dry-run for Standard host profile (> 8192 MB RAM) successfully', () => {
    const output = execSync(`sh "${installScriptPath}" --dry-run --ram-mb 16384 --arch x86_64`, {
      encoding: 'utf8',
      cwd: rootDir,
    });

    expect(output).toContain('Detected Architecture : x86_64');
    expect(output).toContain('Detected Memory       : 16384 MB');
    expect(output).toContain('Selected Profile      : standard (max containers: 3, valkey: 512mb)');
    expect(output).toContain('Verification passed successfully');
  });

  it('runs scripts/install.sh --dry-run for Constrained host profile (<= 8192 MB RAM / Raspberry Pi 5) successfully', () => {
    const output = execSync(`sh "${installScriptPath}" --dry-run --ram-mb 8192 --arch arm64`, {
      encoding: 'utf8',
      cwd: rootDir,
    });

    expect(output).toContain('Detected Architecture : arm64');
    expect(output).toContain('Detected Memory       : 8192 MB');
    expect(output).toContain('Selected Profile      : constrained (Raspberry Pi 5 / Edge) (max containers: 1, valkey: 256mb)');
    expect(output).toContain('Verification passed successfully');
  });

  it('proves scripts/install.sh generates .env.production (passing parseEnv) and 32-byte 0600 master.key (passing LocalFileKekProvider), and preserves existing state byte-for-byte on re-run', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'graywolf-install-test-'));

    try {
      // First installation run with --skip-prereq-check in sandbox test runner
      const firstRunOutput = execSync(`sh "${installScriptPath}" --target-dir "${tempDir}" --ram-mb 8192 --skip-prereq-check`, {
        encoding: 'utf8',
        cwd: rootDir,
      });

      expect(firstRunOutput).toContain('Generating new production configuration');
      expect(firstRunOutput).toContain('Initializing master Key Encryption Key');

      const envFile = path.join(tempDir, '.env.production');
      const keyFile = path.join(tempDir, '.graywolf/master.key');

      expect(fs.existsSync(envFile)).toBe(true);
      expect(fs.existsSync(keyFile)).toBe(true);

      const envContentBefore = fs.readFileSync(envFile, 'utf8');
      const keyBufferBefore = fs.readFileSync(keyFile);

      // Verify permissions on master.key (0600) and exact 32-byte binary length for LocalFileKekProvider
      const stats = fs.statSync(keyFile);
      const modeOctal = (stats.mode & 0o777).toString(8);
      expect(modeOctal).toBe('600');
      expect(keyBufferBefore.length).toBe(32);

      const kekProvider = new LocalFileKekProvider({ masterKeyPath: keyFile });
      const loadedKey = await kekProvider.ensureMasterKey();
      expect(loadedKey.equals(keyBufferBefore)).toBe(true);

      // Verify constrained profile parameters & parseEnv compatibility in generated .env.production
      expect(envContentBefore).toContain('MAX_CONCURRENT_CONTAINERS=1');
      expect(envContentBefore).toContain('VALKEY_MAXMEMORY=256mb');
      expect(envContentBefore).not.toContain('CHANGE_ME_GENERATED_BY_INSTALLER');
      expect(envContentBefore).not.toContain('CHANGE_ME_RELAY_JWT_GENERATED_BY_INSTALLER');

      const parsedEnvMap: Record<string, string> = {};
      for (const line of envContentBefore.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx > 0) {
          parsedEnvMap[trimmed.slice(0, eqIdx)] = trimmed.slice(eqIdx + 1);
        }
      }
      const validatedEnv = parseEnv(parsedEnvMap);
      expect(validatedEnv.NODE_ENV).toBe('production');
      expect(validatedEnv.RELAY_JWT_SECRET.length).toBeGreaterThanOrEqual(32);

      // Second installation run (idempotency check)
      const secondRunOutput = execSync(`sh "${installScriptPath}" --target-dir "${tempDir}" --ram-mb 16384 --skip-prereq-check`, {
        encoding: 'utf8',
        cwd: rootDir,
      });

      expect(secondRunOutput).toContain('Existing configuration found');
      expect(secondRunOutput).toContain('Existing master key found');

      const envContentAfter = fs.readFileSync(envFile, 'utf8');
      const keyBufferAfter = fs.readFileSync(keyFile);

      // Byte-for-byte identical verification
      expect(envContentAfter).toBe(envContentBefore);
      expect(keyBufferAfter.equals(keyBufferBefore)).toBe(true);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('validates scripts/db-migrate-init.sh dry-run and missing-DATABASE_URL error exit codes', () => {
    // Dry-run should succeed
    const dryRunOutput = execSync(`sh "${migrateScriptPath}" --dry-run`, {
      encoding: 'utf8',
      cwd: rootDir,
    });
    expect(dryRunOutput).toContain('migrations directory verified');

    // Missing DATABASE_URL should fail cleanly with exit code 1
    let failed = false;
    try {
      execSync(`env -u DATABASE_URL sh "${migrateScriptPath}"`, {
        cwd: rootDir,
        stdio: 'pipe',
      });
    } catch (err: unknown) {
      failed = true;
      const execErr = err as { status?: number };
      expect(execErr.status).toBe(1);
    }
    expect(failed).toBe(true);
  });

  it('verifies Fastify Control Plane /health, /api/v1/healthz, and /api/v1/health probes respond with 200 OK', async () => {
    const app = Fastify();
    await app.register(healthRoutes);

    for (const url of ['/health', '/api/v1/healthz', '/api/v1/health']) {
      const response = await app.inject({
        method: 'GET',
        url,
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.ok).toBe(true);
      expect(typeof body.timestamp).toBe('string');
    }

    await app.close();
  });
});
