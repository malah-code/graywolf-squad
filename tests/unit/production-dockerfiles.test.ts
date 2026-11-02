import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Production Dockerfiles and Build Hygiene Suite (Task 17.1, FR-001, FR-002, FR-003, SC-001)', () => {
  const rootDir = path.resolve(__dirname, '../../');
  const dockerignorePath = path.join(rootDir, '.dockerignore');
  const orchDockerfilePath = path.join(rootDir, 'docker/orchestrator/Dockerfile.prod');
  const dashDockerfilePath = path.join(rootDir, 'docker/dashboard/Dockerfile.prod');
  const nginxConfPath = path.join(rootDir, 'docker/dashboard/nginx.conf');

  it('validates .dockerignore exists and excludes secrets, devDependencies, and test caches', () => {
    expect(fs.existsSync(dockerignorePath)).toBe(true);
    const content = fs.readFileSync(dockerignorePath, 'utf8');

    expect(content).toContain('node_modules/');
    expect(content).toContain('.git/');
    expect(content).toContain('.env');
    expect(content).toContain('.env.production');
    expect(content).toContain('.graywolf/');
    expect(content).toContain('storage/');
    expect(content).toContain('.agents/dataset/');
    expect(content).toContain('.agent_evidence.db');
  });

  it('validates docker/orchestrator/Dockerfile.prod multi-stage build, non-root user, and asset bundling', () => {
    expect(fs.existsSync(orchDockerfilePath)).toBe(true);
    const content = fs.readFileSync(orchDockerfilePath, 'utf8');

    // Multi-stage verification
    expect(content).toMatch(/FROM\s+node:20-alpine\s+AS\s+builder/i);
    expect(content).toMatch(/FROM\s+node:20-alpine\s+AS\s+runner/i);

    // Non-root graywolf user (uid: 1001)
    expect(content).toContain('addgroup -g 1001 -S graywolf');
    expect(content).toContain('adduser -u 1001 -S graywolf -G graywolf');
    expect(content).toContain('USER graywolf');

    // Bundles required runtime assets
    expect(content).toContain('COPY --from=builder /app/dist ./dist');
    expect(content).toContain('COPY migrations/ ./migrations/');
    expect(content).toContain('COPY src/relay/ ./src/relay/');
    expect(content).toContain('COPY scripts/db-migrate-init.sh ./scripts/db-migrate-init.sh');

    // Exposes dual ports 3000 and 3001
    expect(content).toContain('EXPOSE 3000 3001');

    // Production healthcheck probe
    expect(content).toContain('HEALTHCHECK');
    expect(content).toContain('http://localhost:3000/api/v1/health');
  });

  it('validates docker/dashboard/Dockerfile.prod multi-stage build and Nginx configuration', () => {
    expect(fs.existsSync(dashDockerfilePath)).toBe(true);
    const content = fs.readFileSync(dashDockerfilePath, 'utf8');

    // Multi-stage builder & nginx runner
    expect(content).toMatch(/FROM\s+node:20-alpine\s+AS\s+builder/i);
    expect(content).toMatch(/FROM\s+nginx:1\.27-alpine\s+AS\s+runner/i);
    expect(content).toContain('pnpm --filter graywolf-dashboard build');
    expect(content).toContain('COPY docker/dashboard/nginx.conf /etc/nginx/conf.d/default.conf');
    expect(content).toContain('COPY --from=builder /app/src/dashboard/dist /usr/share/nginx/html');
    expect(content).toContain('EXPOSE 80');
    expect(content).toContain('http://localhost:80/healthz');
  });

  it('validates docker/dashboard/nginx.conf SPA fallback routing, gzip, and security headers', () => {
    expect(fs.existsSync(nginxConfPath)).toBe(true);
    const content = fs.readFileSync(nginxConfPath, 'utf8');

    // SPA client-side routing fallback
    expect(content).toContain('try_files $uri $uri/ /index.html;');

    // Healthcheck endpoint
    expect(content).toContain('location = /healthz');

    // Hardened Security Headers
    expect(content).toContain('X-Frame-Options "DENY"');
    expect(content).toContain('X-Content-Type-Options "nosniff"');
    expect(content).toContain('Referrer-Policy "strict-origin-when-cross-origin"');
    expect(content).toContain('Content-Security-Policy');

    // Immutable assets caching
    expect(content).toContain('location /assets/');
    expect(content).toContain('immutable');
  });
});

