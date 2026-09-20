/**
 * PURE reload decision for session mutation action results (M9): which
 * expected error codes of a substitution/restore submit mean the page's
 * rendered session no longer matches the persisted one, so the caller must
 * `router.refresh()` instead of keeping obsolete controls visible.
 *
 * Two staleness families, both observable only server-side:
 * - Concurrent mutation lost the race: `SESSION_MODIFIED` (optimistic-
 *   concurrency version conflict), `SUBSTITUTION_NO_CHANGE` (another tab
 *   already applied the same swap/restore), `ADJUSTMENT_NO_CHANGE` (another
 *   tab already applied the same skip/unskip, M10) and `MOVE_OUT_OF_RANGE`
 *   (another tab already moved the occurrence to or past the boundary this
 *   move targets, M10).
 * - Server-side guards fired before the save: another tab logged a set on
 *   the occurrence (`EXERCISE_HAS_LOGGED_SETS`), completed the session
 *   (`SESSION_ALREADY_COMPLETED`), or left the program (`NOT_ENROLLED`) —
 *   this tab's controls and eligibility are outdated until it reloads.
 *
 * Ordinary request/input failures (`INVALID_INPUT`, `EXERCISE_NOT_FOUND`,
 * `EXERCISE_LOG_NOT_FOUND`, `FORBIDDEN`, …) say nothing about the page's
 * freshness and must NOT trigger a reload. The substitute, restore, skip,
 * unskip and move paths share this one predicate; user-facing copy that
 * promises a reload ("Reloading the latest state…") is only allowed for
 * codes listed here.
 */

import type { SessionActionErrorCode } from '@/features/sessions/types/session-action-state';

const STALE_SERVER_STATE_CODES: ReadonlySet<SessionActionErrorCode> = new Set<SessionActionErrorCode>([
  'SESSION_MODIFIED',
  'SUBSTITUTION_NO_CHANGE',
  'ADJUSTMENT_NO_CHANGE',
  'MOVE_OUT_OF_RANGE',
  'EXERCISE_HAS_LOGGED_SETS',
  'SESSION_ALREADY_COMPLETED',
  'NOT_ENROLLED',
]);

/**
 * Whether a failed session mutation means the caller's page shows a stale
 * view of the session and should `router.refresh()`.
 */
export function shouldRefreshAfterSessionMutationError(code: SessionActionErrorCode): boolean {
  return STALE_SERVER_STATE_CODES.has(code);
}
