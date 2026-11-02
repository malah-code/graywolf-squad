import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Production Compose Topology and Auto-Migration Suite (Task 17.2, FR-004, FR-005, FR-006, SC-002)', () => {
  const rootDir = path.resolve(__dirname, '../../');
  const composePath = path.join(rootDir, 'docker-compose.prod.yml');
  const envExamplePath = path.join(rootDir, '.env.production.example');
  const migrateScriptPath = path.join(rootDir, 'scripts/db-migrate-init.sh');

  it('validates docker-compose.prod.yml 4-network physical segmentation and proxy isolation', () => {
    expect(fs.existsSync(composePath)).toBe(true);
    const content = fs.readFileSync(composePath, 'utf8');

    // 4 segmented networks exist
    expect(content).toContain('edge-net:');
    expect(content).toContain('control-net:');
    expect(content).toContain('daemon-net:');
    expect(content).toContain('runner-net:');

    // Internal flags on control-net and daemon-net
    expect(content).toMatch(/control-net:\s+driver:\s+bridge\s+internal:\s+true/m);
    expect(content).toMatch(/daemon-net:\s+driver:\s+bridge\s+internal:\s+true/m);

    // Docker socket proxy restrictions (EXEC=0, VOLUMES=0)
    expect(content).toContain('EXEC=0');
    expect(content).toContain('VOLUMES=0');
    expect(content).toContain('/var/run/docker.sock:/var/run/docker.sock:ro');
  });

  it('validates db-migrate one-shot service and orchestrator dependency gating', () => {
    const content = fs.readFileSync(composePath, 'utf8');

    // db-migrate service exists with restart: "no"
    expect(content).toContain('db-migrate:');
    expect(content).toMatch(/container_name:\s+graywolf-prod-db-migrate/);
    expect(content).toMatch(/restart:\s+["']?no["']?/);
    expect(content).toContain('command: ["sh", "/app/scripts/db-migrate-init.sh"]');

    // orchestrator depends on db-migrate condition: service_completed_successfully
    expect(content).toMatch(/db-migrate:\s+condition:\s+service_completed_successfully/);

    // Persistent named volume for master.key (graywolf_keys)
    expect(content).toContain('graywolf_keys:/home/graywolf/.graywolf');
    expect(content).toContain('graywolf_prod_keys');
  });

  it('validates scripts/db-migrate-init.sh script handles dry-run, failure, and execution commands', () => {
    expect(fs.existsSync(migrateScriptPath)).toBe(true);
    const script = fs.readFileSync(migrateScriptPath, 'utf8');

    expect(script).toContain('--dry-run');
    expect(script).toContain('DATABASE_URL');
    expect(script).toContain('node-pg-migrate');
    expect(script).toContain('exit 0');
    expect(script).toContain('exit 1');
  });

  it('validates .env.production.example variable parity and safe defaults', () => {
    expect(fs.existsSync(envExamplePath)).toBe(true);
    const envContent = fs.readFileSync(envExamplePath, 'utf8');

    const expectedVars = [
      'NODE_ENV=production',
      'DEPLOYMENT_TOPOLOGY=',
      'PORT_CONTROL=',
      'PORT_ARP=',
      'DASHBOARD_PORT=',
      'POSTGRES_USER=',
      'POSTGRES_PASSWORD=',
      'POSTGRES_DB=',
      'VALKEY_MAXMEMORY=',
      'MAX_CONCURRENT_CONTAINERS=',
      'CONTAINER_MEMORY_LIMIT=',
      'GRAYWOLF_KEK_PATH=',
      'GRAYWOLF_MASTER_KEY_PATH=',
      'RELAY_JWT_SECRET=',
      'LITELLM_MASTER_KEY=',
      'OTEL_ENABLED=',
      'OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT=false',
    ];

    for (const v of expectedVars) {
      expect(envContent).toContain(v);
    }

    // Zero live secrets checked in
    expect(envContent).not.toContain('password123');
    expect(envContent).toContain('CHANGE_ME_GENERATED_BY_INSTALLER');
  });
});

