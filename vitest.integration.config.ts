import path from 'path';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/integration/**/*.test.ts'],
    globals: false,
    // Integration tests share one PostgreSQL database, so run files sequentially
    // to avoid parallel shared-database interference.
    fileParallelism: false,
    globalSetup: ['tests/integration/database/global-setup.ts'],
    hookTimeout: 30_000,
    testTimeout: 30_000,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
