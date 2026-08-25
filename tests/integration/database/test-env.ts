/**
 * Resolves the integration-test database URL.
 *
 * Integration tests must never use the development `DATABASE_URL`. They read
 * `TEST_DATABASE_URL` (with a local-test fallback) so a developer can point the
 * suite at a dedicated database without touching the app configuration.
 */
const DEFAULT_TEST_DATABASE_URL = 'postgresql://postgres@127.0.0.1:5432/fit40_test';

export function getTestDatabaseUrl(): string {
  return process.env.TEST_DATABASE_URL ?? DEFAULT_TEST_DATABASE_URL;
}
