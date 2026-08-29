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

/**
 * SQLSTATE 23503: foreign_key_violation.
 */
export function isForeignKeyViolation(error: unknown): boolean {
  return errorCode(error) === '23503';
}

/**
 * The constraint name for a PostgreSQL constraint violation, resolved through
 * the same `cause` chain as {@link errorCode}.
 *
 * postgres.js exposes the name as `constraint_name`; the native libpq-based
 * drivers use `constraint`. We accept either.
 */
export function pgConstraintName(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) {
    return undefined;
  }

  const candidate = error as {
    constraint?: unknown;
    constraint_name?: unknown;
    cause?: unknown;
  };

  if (typeof candidate.constraint_name === 'string') {
    return candidate.constraint_name;
  }
  if (typeof candidate.constraint === 'string') {
    return candidate.constraint;
  }

  return pgConstraintName(candidate.cause);
}
