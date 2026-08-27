import { describe, expect, it } from 'vitest';

// The guard lives with the destructive harness it protects; it is pure, so it is
// exercised by the unit suite instead of requiring a database.
import {
  assertSafeTestDatabaseUrl,
} from '../../../integration/database/test-database-url';

const TEST_URL = 'postgres://fit40:secret@localhost:5432/fit40_kimi_test';

describe('assertSafeTestDatabaseUrl', () => {
  it('returns a test-suffixed connection string unchanged', () => {
    expect(assertSafeTestDatabaseUrl({ testUrl: TEST_URL })).toBe(TEST_URL);
  });

  it('rejects a missing connection string', () => {
    expect(() => assertSafeTestDatabaseUrl({ testUrl: undefined })).toThrow(
      /TEST_DATABASE_URL is required/,
    );
  });

  it('rejects a blank connection string', () => {
    expect(() => assertSafeTestDatabaseUrl({ testUrl: '   ' })).toThrow(
      /TEST_DATABASE_URL is required/,
    );
  });

  it('rejects a database that is not obviously disposable', () => {
    expect(() =>
      assertSafeTestDatabaseUrl({ testUrl: 'postgres://localhost:5432/fit40_kimi' }),
    ).toThrow(/not suffixed with "_test"/);
  });

  it('rejects a connection string without a database name', () => {
    expect(() => assertSafeTestDatabaseUrl({ testUrl: 'postgres://localhost:5432' })).toThrow(
      /must include a database name/,
    );
  });

  it('rejects reusing the development connection string', () => {
    expect(() =>
      assertSafeTestDatabaseUrl({ testUrl: TEST_URL, developmentUrl: TEST_URL }),
    ).toThrow(/must not be the same connection string as DATABASE_URL/);
  });

  it('rejects malformed URLs without echoing credentials', () => {
    const unsafe = 'postgres://fit40:secret@h ost/fit40_kimi_test';

    expect(() => assertSafeTestDatabaseUrl({ testUrl: unsafe })).toThrow(
      /^TEST_DATABASE_URL is not a valid connection URL: \*\*\*@<host>$/,
    );
  });
});
