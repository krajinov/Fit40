/**
 * Domain-local Result contract for expected failures.
 *
 * The domain layer must not depend on src/lib or any outer layer, so the
 * minimal Result contract used by domain entities and value objects lives
 * here. It is structurally identical to the shared Result in
 * src/lib/result.ts, so values produced by domain functions flow into
 * application-layer Result handling unchanged (structural typing).
 *
 * Keep this minimal: only what the domain actually needs (the type plus its
 * two constructors). Richer combinators (map, flatMap, unwrapOr, …) remain
 * application/lib concerns.
 */

export type Result<T, E = Error> =
  | { readonly ok: true; readonly data: T }
  | { readonly ok: false; readonly error: E };

/**
 * Creates a successful Result.
 */
export function ok<T>(data: T): Result<T, never> {
  return { ok: true, data };
}

/**
 * Creates a failed Result.
 */
export function err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}