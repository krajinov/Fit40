/**
 * Guard for the integration test database connection string.
 *
 * The integration setup drops and recreates the `public` schema, so the suite
 * must only ever run against a disposable database. This module performs that
 * check without touching the network, which keeps it unit-testable and makes
 * misconfiguration fail before a single connection is opened.
 */

/** A database name must end with this suffix to be treated as disposable. */
export const TEST_DATABASE_SUFFIX = '_test';

export interface TestDatabaseUrlGuardInput {
  /** Value of `TEST_DATABASE_URL`. */
  readonly testUrl: string | undefined;
  /** Value of `DATABASE_URL`, used only to reject accidental reuse. */
  readonly developmentUrl?: string | undefined;
}

/**
 * Validates the integration test connection string and returns it unchanged.
 *
 * Throws when the URL is missing, malformed, not obviously a test database, or
 * identical to the development database. There is deliberately no fallback to
 * `DATABASE_URL`, a local default, or an in-memory database.
 */
export function assertSafeTestDatabaseUrl({
  testUrl,
  developmentUrl,
}: TestDatabaseUrlGuardInput): string {
  if (testUrl === undefined || testUrl.trim() === '') {
    throw new Error(
      'TEST_DATABASE_URL is required for integration tests. It is not derived from ' +
        'DATABASE_URL or any default because the integration setup drops the public schema.',
    );
  }

  const databaseName = readDatabaseName(testUrl);

  if (!databaseName.endsWith(TEST_DATABASE_SUFFIX)) {
    throw new Error(
      `TEST_DATABASE_URL points at database "${databaseName}", which is not suffixed with ` +
        `"${TEST_DATABASE_SUFFIX}". Refusing to run destructive integration setup against it.`,
    );
  }

  if (developmentUrl !== undefined && developmentUrl.trim() === testUrl.trim()) {
    throw new Error(
      'TEST_DATABASE_URL must not be the same connection string as DATABASE_URL.',
    );
  }

  return testUrl;
}

/** Extracts the database name from a PostgreSQL connection URL. */
function readDatabaseName(connectionString: string): string {
  let url: URL;

  try {
    url = new URL(connectionString);
  } catch {
    throw new Error(`TEST_DATABASE_URL is not a valid connection URL: ${redact(connectionString)}`);
  }

  const name = decodeURIComponent(url.pathname.replace(/^\//, ''));

  if (name === '') {
    throw new Error('TEST_DATABASE_URL must include a database name.');
  }

  return name;
}

/** Hides credentials when an invalid connection string has to be reported. */
function redact(connectionString: string): string {
  const [credentials] = connectionString.split('@');
  return credentials === undefined ? connectionString : '***@<host>';
}
