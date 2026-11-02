import { z } from 'zod';

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT_CONTROL: z.coerce.number().int().positive().default(3000),
  PORT_ARP: z.coerce.number().int().positive().default(3001),
  DOCKER_HOST: z.string().default('tcp://localhost:2375'),
  DATABASE_URL: z.string().default('postgresql://graywolf:graywolf_dev_secret@localhost:5432/graywolf_db'),
  VALKEY_URL: z.string().default('redis://localhost:6379'),
  LITELLM_URL: z.string().default('http://localhost:4000'),
  RUNNER_DOCKER_NETWORK: z.string().default('graywolf-squad_runner-net'),
  STORAGE_ROOT: z.string().default('./.agents'),
  RELAY_JWT_SECRET: z.string().default('graywolf_dev_jwt_secret_must_be_32_chars_long!!'),
}).refine(
  (data) => {
    if (data.NODE_ENV === 'production') {
      return (
        data.RELAY_JWT_SECRET &&
        data.RELAY_JWT_SECRET.length >= 32 &&
        data.RELAY_JWT_SECRET !== 'graywolf_dev_jwt_secret_must_be_32_chars_long!!'
      );
    }
    return true;
  },
  {
    message: 'RELAY_JWT_SECRET must be at least 32 characters and non-default in production',
    path: ['RELAY_JWT_SECRET'],
  }
);

export type Env = z.infer<typeof envSchema>;

export function parseEnv(rawEnv: Record<string, string | undefined> = process.env): Env {
  return envSchema.parse(rawEnv);
}

export const env: Env = parseEnv();
