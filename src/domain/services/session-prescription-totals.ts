/**
 * Domain service: session-level prescription totals adjusted for skip
 * decisions (M10). Split out of the original session-exercise-adjustment
 * service by responsibility (PR #13 Finding 2).
 *
 * Session-level consequences of skip decisions are domain-owned here:
 * `resolveSessionPrescriptionTotals` is the progress denominator — skipped
 * occurrences contribute nothing to it (F5). The completion gate (F6,
 * unchanged by M10) lives on the entity (`resolveSessionCompletionReadiness`
 * in `workout-session.ts`): a session is completable when at least one set
 * is logged somewhere. Skipped occurrences carry no sets, so an all-skipped
 * session stays non-completable through that same gate; there is no stricter
 * every-non-skipped-exercise rule.
 */

import type { WorkoutSession } from '@/domain/entities/workout-session';

/**
 * Session-level prescription totals adjusted for skip decisions. The
 * prescribed-set count is the progress denominator: skipped occurrences
 * contribute nothing to it (F5).
 */
export interface SessionPrescriptionTotals {
  /** Prescribed sets across the non-skipped occurrences. */
  readonly prescribedSets: number;
  /** How many authored occurrences are currently skipped. */
  readonly skippedOccurrences: number;
}

export function resolveSessionPrescriptionTotals(
  session: WorkoutSession,
): SessionPrescriptionTotals {
  let prescribedSets = 0;
  let skippedOccurrences = 0;
  for (const log of session.exerciseLogs) {
    if (log.isSkipped) {
      skippedOccurrences += 1;
      continue;
    }
    prescribedSets += log.prescription.sets;
  }
  return { prescribedSets, skippedOccurrences };
}
