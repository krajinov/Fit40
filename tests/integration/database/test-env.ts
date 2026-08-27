/**
 * Resolves the integration-test database URL.
 *
 * Integration tests must never use the development `DATABASE_URL`. They read
 * `TEST_DATABASE_URL` (with a local-test fallback) so a developer can point the
 * suite at a dedicated database without touching the app configuration.
 *
 * Because the suite truncates every table, the target database name must
 * clearly identify a test database: it must end with `_test`. A misconfigured
 * URL pointing at a development or production database is rejected before any
 * destructive statement can run.
 */
const DEFAULT_TEST_DATABASE_URL = 'postgresql://postgres@127.0.0.1:5432/fit40_test';

function databaseNameOf(url: string): string {
  const pathname = new URL(url).pathname;
  return pathname.replace(/^\//, '');
}

export function getTestDatabaseUrl(): string {
  const url = process.env.TEST_DATABASE_URL ?? DEFAULT_TEST_DATABASE_URL;

  const databaseName = databaseNameOf(url);
  if (!databaseName.endsWith('_test')) {
    throw new Error(
      `Refusing to run integration tests: TEST_DATABASE_URL must point to a test database ` +
        `(name ending in "_test"), got "${databaseName}".`,
    );
  }

  return url;
}
