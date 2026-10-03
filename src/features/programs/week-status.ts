/**
 * Authored program-week status (M17 final review).
 *
 * Pure and presentational: the status is resolved from AUTHORED occurrence
 * truth, never from the run's first open occurrence alone. Before M17 a week
 * was "completed" whenever it sat before the next occurrence (or the run was
 * settled), which confused "no open occurrence in this week" with "every
 * workout in this week was completed". After M17 those differ: a week holding
 * only recorded-not-performed occurrences is SETTLED, not completed, and a
 * concluded-but-incomplete run has no completed weeks to claim.
 *
 * Inputs are explicit identities, never dates:
 * - `completedIds` — the enrollment's completed authored occurrence ids (M14
 *   completion truth, the Application's `completedScheduledWorkoutIds`);
 * - `recordedKeys` — the route keys ("week-order") of occurrences recorded as
 *   not performed, built by the caller from the M15 read's planned `not-performed`
 *   items AND its rowless `unplacedNotPerformedWorkouts`;
 * - `upNext` — the run's AUTHORITATIVE first open occurrence (M17 closure
 *   truth), used only to mark the current week.
 *
 * "Completed" is decided ONLY by `completedIds`: a not-performed record never
 * counts as a completion and no `isProgramComplete`/conclusion rule is
 * recomputed here.
 */

/** Lifecycle of one program week for the enrolled visitor. */
export type ProgramWeekStatus = 'completed' | 'in-progress' | 'settled' | 'upcoming';

/** One authored occurrence of the week, in its two presentation identities. */
export interface ProgramWeekOccurrence {
  /** Authored occurrence id — the completed-occurrence identity (M14). */
  readonly scheduledWorkoutId: string;
  /** Authored route key "week-order" — the recorded-occurrence identity (M17). */
  readonly key: string;
}

export interface ProgramWeekStatusInput {
  readonly enrolled: boolean;
  readonly weekNumber: number;
  /** The week's authored occurrences; an empty week claims nothing. */
  readonly occurrences: ReadonlyArray<ProgramWeekOccurrence>;
  readonly completedIds: ReadonlySet<string>;
  readonly recordedKeys: ReadonlySet<string>;
  /** The run's authoritative first open occurrence, or null when none is open. */
  readonly upNext: { readonly weekNumber: number; readonly workoutOrder: number } | null;
}

/**
 * Resolves one week's status.
 *
 * Precedence:
 * 1. not enrolled, or an authored-empty week → `upcoming` (no truth to claim);
 * 2. every authored occurrence completed → `completed` (N never counts);
 * 3. the week holds the run's authoritative first OPEN occurrence → `in-progress`
 *    (an occurrence recorded as not performed is settled, so it never makes its
 *    week current);
 * 4. every authored occurrence settled (completed OR recorded) → `settled`;
 * 5. otherwise → `upcoming`.
 */
export function resolveProgramWeekStatus(input: ProgramWeekStatusInput): ProgramWeekStatus {
  const { occurrences, completedIds, recordedKeys } = input;

  if (!input.enrolled || occurrences.length === 0) {
    return 'upcoming';
  }

  if (occurrences.every((occurrence) => completedIds.has(occurrence.scheduledWorkoutId))) {
    return 'completed';
  }

  const upNext = input.upNext;
  if (
    upNext !== null &&
    upNext.weekNumber === input.weekNumber &&
    !recordedKeys.has(`${upNext.weekNumber}-${upNext.workoutOrder}`)
  ) {
    return 'in-progress';
  }

  const allSettled = occurrences.every(
    (occurrence) =>
      completedIds.has(occurrence.scheduledWorkoutId) || recordedKeys.has(occurrence.key),
  );
  return allSettled ? 'settled' : 'upcoming';
}
