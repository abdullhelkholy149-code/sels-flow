import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

/**
 * Integration tests run against a REAL PostgreSQL database (TEST_DATABASE_URL).
 * They truncate tables between tests, so files must not run in parallel.
 * Run with `npm run test:int`.
 */
export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/integration/**/*.test.ts'],
    globalSetup: ['./tests/setup/global.ts'],
    setupFiles: ['./tests/setup/integration.ts'],
    fileParallelism: false,
    pool: 'forks',
    poolOptions: {
      forks: { singleFork: true },
    },
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
