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
 * One authored occurrence of the run that carries a not-performed record but
 * has NO current `planned_workouts` row (M17 Slice 8).
 *
 * This is a projection of execution truth, never calendar intent: no `PlannedDate`
 * exists for it (the row is gone — regenerated away, or never re-created), and the
 * read model must not invent one. It is horizon-independent (no week window, no
 * past/future rule) and it is NOT an orphan fact: the occurrence is an authored
 * occurrence of the run's own program, which is why its authored labels are
 * available here.
 */
export interface UnplacedNotPerformedWorkoutDto {
  /** The authored occurrence identity — a stable render key, like `PlannedWorkoutDto`. */
  readonly scheduledWorkoutId: string;
  readonly weekNumber: number;
  readonly workoutOrder: number;
  readonly workoutName: string;
  /** ISO-8601 instant the user recorded the fact (never a planned date). */
  readonly recordedAtIso: string;
}

/**
 * The run's calendar focus.
 *
 * - `today` — the planned item dated exactly today, whatever its status (a
 *   workout already completed today is still today's workout), or null.
 * - `next` — the earliest item strictly after today that is settled by neither a
 *   session nor a not-performed record, or null.
 * - `pastDue` — the not-completed, not-in-progress, not-recorded items before
 *   today, or null when nothing is behind.
 * - `notPerformedRecorded` — the factual count of recorded items among the run's
 *   current planned rows (never actionable, never a catch-up total).
 */
export interface ScheduleFocusDto {
  readonly today: PlannedWorkoutDto | null;
  readonly next: PlannedWorkoutDto | null;
  readonly pastDue: PastDueScheduleDto | null;
  readonly notPerformedRecorded: number;
}

/**
 * The authenticated user's training calendar for one program run.
 *
 * A run with no planned rows has no current calendar: `configured` is false and
 * `items` is empty, so the caller offers the training-days setup rather than
 * rendering an invented calendar. The use case returns `ok(null)` when
 * the user is not enrolled — there is no run, hence no schedule.
 *
 * `unplacedNotPerformedWorkouts` is populated in BOTH states: a recorded fact
 * whose planned row no longer exists must never be erased by the calendar model,
 * so the caller can still reach it (and undo it) while no row exists.
 */
export interface EnrollmentScheduleDto {
  readonly programSlug: string;
  readonly configured: boolean;
  /** The UTC calendar date this schedule was read for (the request clock's day). */
  readonly today: string;
  /** Every planned workout of the run, in calendar order. */
  readonly items: ReadonlyArray<PlannedWorkoutDto>;
  /**
   * The run's recorded-not-performed occurrences that currently hold no planned
   * row, in authored program order (week, then order). Never dated, never
   * counted as `items`, and never removed by a time horizon.
   */
  readonly unplacedNotPerformedWorkouts: ReadonlyArray<UnplacedNotPerformedWorkoutDto>;
  readonly focus: ScheduleFocusDto;
}

/**
 * The outcome of one schedule read, for presentation (M15 Slice 6).
 *
 * - `loaded` carries the DTO. Inside it `configured: false` means the run was
 *   never set up — a real state rendered as the training-days setup surface.
 * - `unavailable` is a FAILED read (typed rejection or unexpected throw) and
 *   must never be rendered as "unconfigured": absence of data is not absence
 *   of configuration. The failure is logged at the read site.
 *
 * Shared by the dashboard (Slice 5, exported there as
 * `DashboardScheduleState`) and the program-detail surface (Slice 6).
 */
export type ScheduleReadState =
  | { readonly status: 'loaded'; readonly schedule: EnrollmentScheduleDto }
  | { readonly status: 'unavailable' };
