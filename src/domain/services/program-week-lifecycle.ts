/**
 * Authored program-week lifecycle (M17 final review) — DOMAIN-OWNED.
 *
 * Resolves ONE week of an enrolled run into a typed semantic value from
 * BUSINESS FACTS ONLY: the week's authored occurrences, the run's completed
 * occurrence ids, the occurrences recorded as not performed, and the run's
 * authoritative first open occurrence. This is pure Domain logic: it decides
 * MEANING (completed vs settled vs in-progress vs upcoming); rendering that
 * decision — label, badge, icon — belongs to presentation, which must never
 * re-derive it from occurrence sets.
 *
 * Before M17 a week was "completed" whenever it sat before the next
 * occurrence (or the run was settled), which confused "no open occurrence in
 * this week" with "every workout in this week was completed". After M17 those
 * differ: a week holding only recorded-not-performed occurrences is SETTLED,
 * not completed, and a concluded-but-incomplete run has no completed weeks to
 * claim.
 *
 * Inputs are explicit identities, never dates and never route keys:
 * - `completedIds` — the enrollment's completed authored occurrence ids (M14
 *   completion truth, the Application's `completedScheduledWorkoutIds`);
 * - `recordedCoordinates` — occurrences recorded as not performed, by their
 *   authored coordinates (weekNumber + workoutOrder — the coordinates the
 *   presentation's "week-order" route key encodes, never the key itself),
 *   built by the caller from the closure read's `notPerformedInProgramOrder`
 *   (authoritative) or, when that read is unavailable, the M15 read's planned
 *   `not-performed` items AND its rowless `unplacedNotPerformedWorkouts`;
 * - `firstOpen` — the run's AUTHORITATIVE first open occurrence (M17 closure
 *   truth), used only to mark the current week.
 *
 * "Completed" is decided ONLY by `completedIds`: a not-performed record never
 * counts as a completion and no `isProgramComplete`/conclusion rule is
 * recomputed here.
 *
 * Pure: no I/O, no framework, no clock.
 */

/** Lifecycle of one program week for the enrolled visitor. */
export type ProgramWeekLifecycle = 'completed' | 'in-progress' | 'settled' | 'upcoming';

/** One authored occurrence of the week, addressed by completion id and order. */
export interface ProgramWeekOccurrence {
  /** Authored occurrence id — the completed-occurrence identity (M14). */
  readonly scheduledWorkoutId: string;
  /** Order within the resolved week. */
  readonly workoutOrder: number;
}

/** Authored occurrence coordinates: which week, which order inside it. */
export interface OccurrenceCoordinates {
  readonly weekNumber: number;
  readonly workoutOrder: number;
}

export interface ProgramWeekLifecycleInput {
  readonly enrolled: boolean;
  readonly weekNumber: number;
  /** The week's authored occurrences; an empty week claims nothing. */
  readonly occurrences: ReadonlyArray<ProgramWeekOccurrence>;
  readonly completedIds: ReadonlySet<string>;
  /** The run's occurrences recorded as not performed, by authored coordinates. */
  readonly recordedCoordinates: ReadonlyArray<OccurrenceCoordinates>;
  /** The run's authoritative first open occurrence, or null when none is open. */
  readonly firstOpen: OccurrenceCoordinates | null;
}

/** Whether the given authored coordinates hold a not-performed record. */
function isRecorded(
  recordedCoordinates: ReadonlyArray<OccurrenceCoordinates>,
  weekNumber: number,
  workoutOrder: number,
): boolean {
  return recordedCoordinates.some(
    (recorded) => recorded.weekNumber === weekNumber && recorded.workoutOrder === workoutOrder,
  );
}

/**
 * Resolves one week's lifecycle.
 *
 * Precedence:
 * 1. not enrolled, or an authored-empty week → `upcoming` (no truth to claim);
 * 2. every authored occurrence completed → `completed` (a record never counts);
 * 3. the week holds the run's authoritative first OPEN occurrence → `in-progress`
 *    (an occurrence recorded as not performed is settled, so it never makes its
 *    week current);
 * 4. every authored occurrence settled (completed OR recorded) → `settled`;
 * 5. otherwise → `upcoming`.
 */
export function resolveProgramWeekLifecycle(
  input: ProgramWeekLifecycleInput,
): ProgramWeekLifecycle {
  const { occurrences, completedIds, recordedCoordinates } = input;

  if (!input.enrolled || occurrences.length === 0) {
    return 'upcoming';
  }

  if (occurrences.every((occurrence) => completedIds.has(occurrence.scheduledWorkoutId))) {
    return 'completed';
  }

  const firstOpen = input.firstOpen;
  if (
    firstOpen !== null &&
    firstOpen.weekNumber === input.weekNumber &&
    !isRecorded(recordedCoordinates, firstOpen.weekNumber, firstOpen.workoutOrder)
  ) {
    return 'in-progress';
  }

  const allSettled = occurrences.every(
    (occurrence) =>
      completedIds.has(occurrence.scheduledWorkoutId) ||
      isRecorded(recordedCoordinates, input.weekNumber, occurrence.workoutOrder),
  );
  return allSettled ? 'settled' : 'upcoming';
}