// eslint-disable-next-line import/no-unresolved
import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    pool: 'forks',
    singleFork: true,
    setupFiles: ['./vitest.setup.ts'],
    // Renderer tests opt into happy-dom via the `@vitest-environment happy-dom`
    // pragma at the top of the file; everything else stays on Node so backend
    // tests (better-sqlite3, fs, etc.) keep their fast native runtime.
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts', 'src/**/*.tsx'],
      exclude: [
        'node_modules/',
        'dist/',
        'out/',
        '**/*.config.*',
        '**/preload.ts',
        '**/*.test.*',
        '**/__tests__/**',
      ],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
