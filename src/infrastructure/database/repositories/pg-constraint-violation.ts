/**
 * PostgreSQL constraint-violation detection.
 *
 * Lives in infrastructure on purpose: repositories turn these driver-level facts
 * into the persistence-neutral conflict results their ports declare, so no
 * SQLSTATE or driver error ever reaches the application layer.
 */

/** PostgreSQL error code for unique_violation. */
const UNIQUE_VIOLATION = '23505';

/**
 * Structural shape of the errors postgres.js surfaces for constraint violations.
 * The cast in `matchesUniqueViolation` is the minimal way to read those fields
 * off an `unknown` catch value; the package does not export the error class as a
 * type-only import.
 */
interface PostgresConstraintViolation {
  readonly code?: unknown;
  readonly constraint_name?: unknown;
}

/**
 * True when PostgreSQL rejected a write with a unique violation on a constraint
 * whose name starts with `constraintPrefix`.
 *
 * Drizzle wraps driver errors in a "Failed query" error and keeps the original
 * PostgresError in `cause`, so both levels are inspected.
 */
export function isUniqueViolation(error: unknown, constraintPrefix: string): boolean {
  return (
    matchesUniqueViolation(error, constraintPrefix) ||
    (error instanceof Error && matchesUniqueViolation(error.cause, constraintPrefix))
  );
}

function matchesUniqueViolation(candidate: unknown, constraintPrefix: string): boolean {
  const { code, constraint_name: constraintName } =
    (candidate ?? {}) as PostgresConstraintViolation;

  return (
    code === UNIQUE_VIOLATION &&
    typeof constraintName === 'string' &&
    constraintName.startsWith(constraintPrefix)
  );
}