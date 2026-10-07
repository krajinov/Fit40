/**
 * Planned-workout status and dashboard focus derivation (M15 calendar intent).
 *
 * Pure read-side logic over a run's planned workouts plus the session-derived
 * facts and the M17 not-performed facts the caller resolved. Status is
 * deliberately honest about precedence: execution facts outrank date-derived
 * status, so a workout whose session is completed or in progress is NEVER
 * relabelled by the calendar — an in-progress workout whose planned date has
 * passed is `in-progress`, not `past-due`.
 *
 * `not-performed` is an explicit execution fact, never a date consequence: a
 * past-due date on its own stays `past-due`, and a dated occurrence carrying the
 * fact is `not-performed` wherever it sits on the calendar. A live session still
 * outranks the fact (a fact never relabels work that is happening now), while a
 * completed session together with the fact is contradictory execution truth that
 * throws (M17 I1) instead of being reconciled.
 *
 * Nothing here writes, and nothing here can mark a workout complete: planning
 * is intent, WorkoutSession is the execution truth.
 */

import type { PlannedWorkout } from '@/domain/entities/planned-workout';
import { assertOccurrenceSettlementIsConsistent } from '@/domain/services/occurrence-settlement';
import {
  comparePlannedDates,
  isPlannedDateAfter,
  isPlannedDateBefore,
  plannedDatesEqual,
  type PlannedDate,
} from '@/domain/value-objects/planned-date';

/**
 * Lifecycle of one planned workout, in precedence order: `completed`,
 * `in-progress`, `not-performed`, then the date-derived `past-due` / `planned`.
 */
export const PlannedWorkoutStatus = {
  Completed: 'completed',
  InProgress: 'in-progress',
  NotPerformed: 'not-performed',
  PastDue: 'past-due',
  Planned: 'planned',
} as const;

export type PlannedWorkoutStatus = (typeof PlannedWorkoutStatus)[keyof typeof PlannedWorkoutStatus];

/**
 * One planned workout plus the session facts resolved for its occurrence.
 * Facts are supplied by the caller; this module never reads sessions.
 */
export interface PlannedWorkoutFacts {
  readonly plannedWorkout: PlannedWorkout;
  readonly hasCompletedSession: boolean;
  readonly hasActiveSession: boolean;
  /**
   * The occurrence's explicit M17 not-performed record.
   *
   * Optional so every pre-M17 caller keeps its exact behavior: absent means
   * "no record", which is the only value M15 could supply before M17. The M17
   * read slices supply it explicitly.
   */
  readonly hasNotPerformedRecord?: boolean;
}

/**
 * Resolves the status of one planned workout.
 *
 * Precedence (locked):
 * 1. a completed session → `completed` (with a not-performed record as well
 *    this is contradictory execution truth and throws — M17 I1)
 * 2. a live in-progress session → `in-progress`
 * 3. an explicit not-performed record → `not-performed` (never date-derived, so
 *    a recorded occurrence is `not-performed` on a past, today or future date)
 * 4. planned date before today → `past-due`
 * 5. otherwise → `planned`
 */
export function resolvePlannedWorkoutStatus(
  item: PlannedWorkoutFacts,
  today: PlannedDate,
): PlannedWorkoutStatus {
  const hasNotPerformedRecord = item.hasNotPerformedRecord ?? false;

  assertOccurrenceSettlementIsConsistent({
    scheduledWorkoutId: item.plannedWorkout.scheduledWorkoutId,
    hasCompletedSession: item.hasCompletedSession,
    hasNotPerformedRecord,
  });

  if (item.hasCompletedSession) {
    return PlannedWorkoutStatus.Completed;
  }
  if (item.hasActiveSession) {
    return PlannedWorkoutStatus.InProgress;
  }
  if (hasNotPerformedRecord) {
    return PlannedWorkoutStatus.NotPerformed;
  }
  if (isPlannedDateBefore(item.plannedWorkout.plannedDate, today)) {
    return PlannedWorkoutStatus.PastDue;
  }
  return PlannedWorkoutStatus.Planned;
}

/** The run's past-due position: how many, and the earliest one. */
export interface PastDueSummary {
  readonly count: number;
  readonly earliest: PlannedWorkoutFacts;
}

/** The run's calendar focus: today's item, the next one, and the past-due count. */
export interface ScheduleFocus {
  readonly today: PlannedWorkoutFacts | null;
  readonly next: PlannedWorkoutFacts | null;
  readonly pastDue: PastDueSummary | null;
  /**
   * How many of the run's items carry an explicit not-performed record — a
   * FACTUAL count, never an actionable one. A recorded occurrence is settled, so
   * it is deliberately absent from `pastDue` (it is not behind, and never
   * counted as work to catch up on) and from `next` (it will not be performed).
   * `today` still exposes it: a recorded workout dated today is still what
   * today's calendar holds.
   */
  readonly notPerformedRecorded: number;
}

/**
 * The run's calendar focus: what is planned for today, what comes next, and
 * how far behind the calendar the run is.
 *
 * - `today`: the planned item dated exactly today, whatever its status (a
 *   workout already completed today is still today's workout) — null when
 *   nothing is planned for today.
 * - `next`: the earliest item strictly after today that is settled by neither a
 *   session nor a not-performed record — null when nothing is planned in the
 *   future. A recorded occurrence is settled, so it is never "next up".
 * - `pastDue`: the items dated before today that are neither completed nor live
 *   nor recorded, with their count and earliest member — null when nothing is
 *   behind. In-progress items are excluded: the locked precedence says a workout
 *   whose session is live is `in-progress`, never `past-due`. Recorded items are
 *   excluded too: `not-performed` is its own factual state, never past due.
 * - `notPerformedRecorded`: the factual count of recorded items (above).
 *
 * Selection is independent of the caller's input order (earliest date first,
 * then scheduled workout id), so the same facts always yield the same focus.
 *
 * A completed session together with a not-performed record (M17 I1) is
 * contradictory execution truth and throws rather than being reconciled, for
 * every supplied item — including items the focus does not select.
 */
export function resolveScheduleFocus(
  items: ReadonlyArray<PlannedWorkoutFacts>,
  today: PlannedDate,
): ScheduleFocus {
  for (const item of items) {
    assertOccurrenceSettlementIsConsistent({
      scheduledWorkoutId: item.plannedWorkout.scheduledWorkoutId,
      hasCompletedSession: item.hasCompletedSession,
      hasNotPerformedRecord: item.hasNotPerformedRecord ?? false,
    });
  }

  const ordered = [...items].sort(compareFactsByDateThenId);

  const todayItem =
    ordered.find((item) => plannedDatesEqual(item.plannedWorkout.plannedDate, today)) ?? null;

  const next =
    ordered.find(
      (item) =>
        !item.hasCompletedSession &&
        !(item.hasNotPerformedRecord ?? false) &&
        isPlannedDateAfter(item.plannedWorkout.plannedDate, today),
    ) ?? null;

  const pastDueItems = ordered.filter(
    (item) =>
      !item.hasCompletedSession &&
      !item.hasActiveSession &&
      !(item.hasNotPerformedRecord ?? false) &&
      isPlannedDateBefore(item.plannedWorkout.plannedDate, today),
  );
  const earliestPastDue = pastDueItems[0];
  const pastDue =
    earliestPastDue === undefined ? null : { count: pastDueItems.length, earliest: earliestPastDue };

  const notPerformedRecorded = ordered.filter(
    (item) => item.hasNotPerformedRecord ?? false,
  ).length;

  return { today: todayItem, next, pastDue, notPerformedRecorded };
}

/** Total order for deterministic selection: date first, then occurrence id. */
function compareFactsByDateThenId(a: PlannedWorkoutFacts, b: PlannedWorkoutFacts): number {
  const byDate = comparePlannedDates(a.plannedWorkout.plannedDate, b.plannedWorkout.plannedDate);
  if (byDate !== 0) {
    return byDate;
  }

  const idA = a.plannedWorkout.scheduledWorkoutId;
  const idB = b.plannedWorkout.scheduledWorkoutId;
  if (idA === idB) {
    return 0;
  }
  return idA < idB ? -1 : 1;
}
