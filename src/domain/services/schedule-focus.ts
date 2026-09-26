/**
 * Planned-workout status and dashboard focus derivation (M15 calendar intent).
 *
 * Pure read-side logic over a run's planned workouts plus the session-derived
 * facts the caller resolved. Status is deliberately honest about precedence:
 * session facts outrank date-derived status, so a workout whose session is
 * completed or in progress is NEVER relabelled by the calendar — an
 * in-progress workout whose planned date has passed is `in-progress`, not
 * `past-due`.
 *
 * Nothing here writes, and nothing here can mark a workout complete: planning
 * is intent, WorkoutSession is the execution truth.
 */

import type { PlannedWorkout } from '@/domain/entities/planned-workout';
import {
  comparePlannedDates,
  isPlannedDateAfter,
  isPlannedDateBefore,
  plannedDatesEqual,
  type PlannedDate,
} from '@/domain/value-objects/planned-date';

/**
 * Lifecycle of one planned workout, in precedence order: `completed`,
 * `in-progress`, then the date-derived `past-due` / `planned`.
 */
export const PlannedWorkoutStatus = {
  Completed: 'completed',
  InProgress: 'in-progress',
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
}

/**
 * Resolves the status of one planned workout.
 *
 * Precedence (locked):
 * 1. a completed session → `completed`
 * 2. a live in-progress session → `in-progress`
 * 3. planned date before today → `past-due`
 * 4. otherwise → `planned`
 */
export function resolvePlannedWorkoutStatus(
  item: PlannedWorkoutFacts,
  today: PlannedDate,
): PlannedWorkoutStatus {
  if (item.hasCompletedSession) {
    return PlannedWorkoutStatus.Completed;
  }
  if (item.hasActiveSession) {
    return PlannedWorkoutStatus.InProgress;
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
}

/**
 * The run's calendar focus: what is planned for today, what comes next, and
 * how far behind the calendar the run is.
 *
 * - `today`: the planned item dated exactly today, whatever its status (a
 *   workout already completed today is still today's workout) — null when
 *   nothing is planned for today.
 * - `next`: the earliest not-completed item strictly after today — null when
 *   nothing is planned in the future.
 * - `pastDue`: the not-completed, not-in-progress items dated before today,
 *   with their count and earliest member — null when nothing is behind.
 *   In-progress items are excluded: the locked precedence says a workout whose
 *   session is live is `in-progress`, never `past-due`.
 *
 * Selection is independent of the caller's input order (earliest date first,
 * then scheduled workout id), so the same facts always yield the same focus.
 */
export function resolveScheduleFocus(
  items: ReadonlyArray<PlannedWorkoutFacts>,
  today: PlannedDate,
): ScheduleFocus {
  const ordered = [...items].sort(compareFactsByDateThenId);

  const todayItem =
    ordered.find((item) => plannedDatesEqual(item.plannedWorkout.plannedDate, today)) ?? null;

  const next =
    ordered.find(
      (item) =>
        !item.hasCompletedSession &&
        isPlannedDateAfter(item.plannedWorkout.plannedDate, today),
    ) ?? null;

  const pastDueItems = ordered.filter(
    (item) =>
      !item.hasCompletedSession &&
      !item.hasActiveSession &&
      isPlannedDateBefore(item.plannedWorkout.plannedDate, today),
  );
  const earliestPastDue = pastDueItems[0];
  const pastDue =
    earliestPastDue === undefined ? null : { count: pastDueItems.length, earliest: earliestPastDue };

  return { today: todayItem, next, pastDue };
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
