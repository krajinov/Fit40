/**
 * PostgreSQL error inspection helpers shared by Drizzle repositories.
 *
 * postgres-js wraps driver errors; the SQLSTATE code may live on the error or
 * anywhere down its `cause` chain.
 */

export function errorCode(error: unknown): unknown {
  if (typeof error !== 'object' || error === null) {
    return undefined;
  }

  const candidate = error as { code?: unknown; cause?: unknown };
  if (candidate.code !== undefined) {
    return candidate.code;
  }

  return errorCode(candidate.cause);
}

/**
 * SQLSTATE 23505: unique_violation.
 */
export function isUniqueViolation(error: unknown): boolean {
  return errorCode(error) === '23505';
}
