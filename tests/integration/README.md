// Integration tests run against a real PostgreSQL database (TEST_DATABASE_URL).
// They are separate from unit tests on purpose: `npm run test` must stay green
// without any infrastructure, `npm run test:int` needs a database.
