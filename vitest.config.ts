import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    exclude: ['reference-opensources/**', 'node_modules/**', 'dist/**'],
    environment: 'node',
  },
});
