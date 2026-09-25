/**
 * Data transfer objects for M15 workout scheduling.
 *
 * DTOs are plain, serializable shapes. Branded ids are stripped to plain
 * strings, and planned dates stay canonical `YYYY-MM-DD` calendar dates —
 * never JS `Date` instants and never formatted or localized strings. Date
 * formatting and weekday labels belong to the presentation layer, so the view
 * layer never has to reconstruct calendar truth from the UI.
 */

import type { PlannedWorkoutStatus } from '@/domain/services/schedule-focus';

/**
 * One planned workout of a run, carrying its authored occurrence metadata.
 *
 * `scheduledWorkoutId` is the authored occurrence identity (a stable key for
 * the view); the public route coordinates are `weekNumber` + `workoutOrder`,
 * which is what reschedule actions submit.
 */
export interface PlannedWorkoutDto {
  readonly scheduledWorkoutId: string;
  readonly weekNumber: number;
  readonly workoutOrder: number;
  readonly workoutName: string;
  /** Canonical `YYYY-MM-DD` calendar date. */
  readonly plannedDate: string;
  readonly status: PlannedWorkoutStatus;
}

/**
 * How far behind the calendar a run is: how many planned workouts are past
 * due, and the earliest of them (the one to act on first).
 */
export interface PastDueScheduleDto {
  readonly count: number;
  readonly earliest: PlannedWorkoutDto;
}

/**
 * The run's calendar focus.
 *
 * - `today` — the planned item dated exactly today, whatever its status (a
 *   workout already completed today is still today's workout), or null.
 * - `next` — the earliest not-completed item strictly after today, or null.
 * - `pastDue` — the not-completed, not-in-progress items before today, or null
 *   when nothing is behind. In-progress items are never counted as past due.
 */
export interface ScheduleFocusDto {
  readonly today: PlannedWorkoutDto | null;
  readonly next: PlannedWorkoutDto | null;
  readonly pastDue: PastDueScheduleDto | null;
}

/**
 * The authenticated user's training calendar for one program run.
 *
 * A run with no planned rows has never been configured: `configured` is false
 * and `items` is empty, so the caller offers the training-days setup rather
 * than rendering an invented calendar. The use case returns `ok(null)` when
 * the user is not enrolled — there is no run, hence no schedule.
 */
export interface EnrollmentScheduleDto {
  readonly programSlug: string;
  readonly configured: boolean;
  /** The UTC calendar date this schedule was read for (the request clock's day). */
  readonly today: string;
  /** Every planned workout of the run, in calendar order. */
  readonly items: ReadonlyArray<PlannedWorkoutDto>;
  readonly focus: ScheduleFocusDto;
}
