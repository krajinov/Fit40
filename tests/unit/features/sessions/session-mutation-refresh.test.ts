/**
 * Focused regression tests for the centralized swap-panel reload predicate
 * (PR #12 Codex P2): a failed substitution/restore must reload the page only
 * when the error means the page's session view is stale — never for ordinary
 * request/input failures. Both the substitute and the restore path of
 * `SessionExerciseSwapPanel` share this one predicate; their form-action
 * wiring is covered separately by `session-exercise-swap-panel.test.ts`.
 */

import { describe, expect, it } from 'vitest';

import { shouldRefreshAfterSessionMutationError } from '@/features/sessions/session-mutation-refresh';

describe('shouldRefreshAfterSessionMutationError', () => {
  it.each([
    'SESSION_MODIFIED',
    'SUBSTITUTION_NO_CHANGE',
    'ADJUSTMENT_NO_CHANGE',
    'EXERCISE_HAS_LOGGED_SETS',
    'SESSION_ALREADY_COMPLETED',
    'NOT_ENROLLED',
  ] as const)('refreshes on stale server-state outcome %s', (code) => {
    expect(shouldRefreshAfterSessionMutationError(code)).toBe(true);
  });

  it.each([
    'INVALID_INPUT',
    'EXERCISE_NOT_FOUND',
    'EXERCISE_LOG_NOT_FOUND',
    'FORBIDDEN',
  ] as const)('does not refresh on ordinary request/input failure %s', (code) => {
    expect(shouldRefreshAfterSessionMutationError(code)).toBe(false);
  });

  it.each(['SESSION_NOT_FOUND', 'VALIDATION_ERROR'] as const)(
    'does not refresh on other expected failures (deliberate exclusions) %s',
    (code) => {
      expect(shouldRefreshAfterSessionMutationError(code)).toBe(false);
    },
  );
});
