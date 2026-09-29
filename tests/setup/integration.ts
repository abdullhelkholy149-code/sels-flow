/**
 * Per test-file setup for the integration suite.
 *
 * Points the application code at the test database, and only ever at the test
 * database: if DATABASE_URL was already set to something else, fail loudly.
 */
const testUrl = process.env.TEST_DATABASE_URL;

if (!testUrl) {
  throw new Error('TEST_DATABASE_URL is required for integration tests. See .env.example.');
}

if (process.env.DATABASE_URL && process.env.DATABASE_URL !== testUrl) {
  throw new Error('DATABASE_URL must equal TEST_DATABASE_URL while running integration tests.');
}

process.env.DATABASE_URL = testUrl;
