import { describe, it, expect } from 'vitest';
import { parseEnv } from '../../src/orchestrator/config/env';

describe('Environment Configuration (env.ts)', () => {
  it('loads valid defaults for development environment', () => {
    const config = parseEnv({});
    expect(config.NODE_ENV).toBe('development');
    expect(config.PORT_CONTROL).toBe(3000);
    expect(config.PORT_ARP).toBe(3001);
    expect(config.DOCKER_HOST).toBe('tcp://localhost:2375');
    expect(config.DATABASE_URL).toContain('postgresql://graywolf');
    expect(config.VALKEY_URL).toBe('redis://localhost:6379');
    expect(config.RUNNER_DOCKER_NETWORK).toBe('graywolf-squad_runner-net');
  });

  it('coerces port strings to numbers', () => {
    const config = parseEnv({
      PORT_CONTROL: '8080',
      PORT_ARP: '8081',
    });
    expect(config.PORT_CONTROL).toBe(8080);
    expect(config.PORT_ARP).toBe(8081);
  });

  it('fails if invalid NODE_ENV is provided', () => {
    expect(() =>
      parseEnv({
        NODE_ENV: 'staging' as unknown as 'development',
      })
    ).toThrow();
  });

  it('enforces production secret requirements', () => {
    // Should fail with default dev secret in production
    expect(() =>
      parseEnv({
        NODE_ENV: 'production',
        RELAY_JWT_SECRET: 'graywolf_dev_jwt_secret_must_be_32_chars_long!!',
      })
    ).toThrow();

    // Should fail if secret is too short in production
    expect(() =>
      parseEnv({
        NODE_ENV: 'production',
        RELAY_JWT_SECRET: 'short_secret_under_32_chars',
      })
    ).toThrow();

    // Should succeed with robust 32+ character secret in production
    const validProd = parseEnv({
      NODE_ENV: 'production',
      RELAY_JWT_SECRET: 'super_secret_production_key_random_string_1234567890',
    });
    expect(validProd.NODE_ENV).toBe('production');
    expect(validProd.RELAY_JWT_SECRET).toBe('super_secret_production_key_random_string_1234567890');
  });
});
