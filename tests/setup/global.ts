/**
 * Vitest global setup for the integration suite.
 *
 * Runs once per test run, before any test file is loaded. It validates the
 * target database and applies pending migrations so the schema matches the
 * current `prisma/schema.prisma`.
 */
import { execSync } from 'node:child_process';

export default function setup(): void {
  const url = process.env.TEST_DATABASE_URL;

  if (!url) {
    throw new Error('TEST_DATABASE_URL is required for integration tests. See .env.example.');
  }

  const databaseName = decodeURIComponent(new URL(url).pathname.replace(/^\//, ''));

  if (!/test/i.test(databaseName)) {
    throw new Error(
      `Refusing to run integration tests against database "${databaseName}": the name must contain "test".`,
    );
  }

  execSync('npx prisma migrate deploy', {
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: url },
  });
}
