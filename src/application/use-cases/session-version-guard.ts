/**
 * Shared stale-rendered-intent guard for occurrence-addressed session
 * mutations (PR #13 Finding 1).
 *
 * Occurrence identity is the mutable `exerciseOrder` — `(sessionId,
 * exerciseOrder)`. A tab rendered before a concurrent reorder therefore holds
 * an order that now identifies a DIFFERENT occurrence, and repository-level
 * optimistic concurrency cannot catch it: the use case reloads the latest
 * aggregate and saves with its own fresh version, so the write commits. The
 * fix is intent-level: every occurrence-addressed command carries the session
 * `version` of the snapshot the user SAW, and the use case compares it
 * against the freshly loaded aggregate BEFORE interpreting `exerciseOrder`
 * — a mismatch means the rendered intent is stale and maps to the existing
 * `SESSION_MODIFIED` outcome, leaving the current occupant untouched.
 */

import { err, ok, type Result } from '@/domain/types/result';

/** The guard's failure shape — one per use-case error union member. */
export interface SessionVersionMismatchError {
  readonly code: 'SESSION_MODIFIED';
  readonly message: string;
}

/**
 * Validates the caller-supplied expected version (the domain/session version
 * type is a plain non-negative integer: fresh sessions start at 0 and every
 * successful save bumps it by one).
 */
export function isValidExpectedSessionVersion(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

/**
 * Compares the rendered snapshot's version against the loaded aggregate.
 * MUST be called with the caller's expected version — never the freshly
 * loaded session's own version — and before any occurrence-order mutation.
 */
export function rejectStaleRenderedIntent(
  expectedSessionVersion: number,
  session: { readonly version: number; readonly id: { toString(): string } },
): Result<null, SessionVersionMismatchError> {
  if (session.version !== expectedSessionVersion) {
    return err({
      code: 'SESSION_MODIFIED',
      message: `Session "${session.id.toString()}" changed since it was loaded; reload and retry`,
    });
  }
  return ok(null);
}
