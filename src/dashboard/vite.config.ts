/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  plugins: [react() as any],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    target: 'esnext',
    outDir: 'dist',
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (id.includes('@monaco-editor') || id.includes('monaco-editor')) {
            return 'monaco-vendor';
          }
          if (id.includes('@xterm')) {
            return 'xterm-vendor';
          }
          if (id.includes('reactflow')) {
            return 'reactflow-vendor';
          }
          if (id.includes('/tabs/CommitsTab')) {
            return 'tab-commits';
          }
          if (id.includes('/tabs/TerminalTab')) {
            return 'tab-terminal';
          }
          if (id.includes('/tabs/BrowserTab')) {
            return 'tab-browser';
          }
          if (id.includes('/tabs/FilesTab')) {
            return 'tab-files';
          }
          if (id.includes('/tabs/PlannerTab')) {
            return 'tab-planner';
          }
          if (id.includes('/tabs/UsageTab')) {
            return 'tab-usage';
          }
        },
      },
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any);
