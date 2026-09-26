/**
 * Presentation view assembly for the M15 current-week schedule (Slice 6).
 *
 * Pure and presentational: it groups the schedule DTO's planned workouts onto
 * the seven canonical dates of the Monday–Sunday week containing `today`,
 * using string equality on canonical `YYYY-MM-DD` values. No scheduling rule
 * is recreated here — the week boundaries come from the domain's own
 * `startOfPlannedWeek` / `addDaysToPlannedDate` helpers, and every status
 * arrives pre-derived on the DTO.
 *
 * Week boundaries are the approved M15/UTC model: `startOfPlannedWeek` is the
 * same Monday-start rule the weekly insights use.
 */

import type { EnrollmentScheduleDto, PlannedWorkoutDto } from '@/application/dto/schedule';
import {
  addDaysToPlannedDate,
  createPlannedDate,
  startOfPlannedWeek,
} from '@/domain/value-objects/planned-date';
import type { PlannedWorkoutStatus } from '@/domain/services/schedule-focus';
import { formatPlannedDateLabel } from '@/lib/dates';

/** One day position of the current-week calendar. */
export interface WeekDaySlotView {
  /** Canonical `YYYY-MM-DD` of this slot (Monday-first). */
  readonly date: string;
  /** ISO weekday abbreviation: Mon … Sun. */
  readonly dayLabel: string;
  /** Human label, e.g. `Sep 28` (component-based, never instant-parsed). */
  readonly dateLabel: string;
  readonly isToday: boolean;
  /** The run's one planned workout for this date, or null when none. */
  readonly item: PlannedWorkoutDto | null;
}

/** Monday-first ISO weekday labels; slot index 0 is Monday by construction. */
const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

/** Display labels for the DTO's four statuses (never recomputed here). */
const STATUS_LABELS: Record<PlannedWorkoutStatus, string> = {
  completed: 'Completed',
  'in-progress': 'In progress',
  'past-due': 'Past due',
  planned: 'Planned',
};

/** Presentation label for a status the application already resolved. */
export function plannedStatusLabel(status: PlannedWorkoutStatus): string {
  return STATUS_LABELS[status];
}

/**
 * Builds the seven Monday–Sunday slots of the week containing `schedule.today`.
 *
 * Returns null — meaning "this schedule cannot render a truthful week" — when
 * `today` is not a canonical date or the week arithmetic leaves the supported
 * calendar range. The DTO's `today` is produced by the application (always
 * canonical), so null is a corrupt-data path: callers degrade the schedule
 * section only, never the rest of the page, and never invent dates.
 */
export function buildWeekSlots(
  schedule: EnrollmentScheduleDto,
): ReadonlyArray<WeekDaySlotView> | null {
  // The DTO strips the PlannedDate brand (DTOs carry plain strings); rebuild
  // it through the value object — never a cast. Failure → null, degrade.
  const todayResult = createPlannedDate(schedule.today);
  if (!todayResult.ok) {
    return null;
  }

  const monday = startOfPlannedWeek(todayResult.data);
  if (!monday.ok) {
    return null;
  }

  // At most one planned workout per date per run is a Slice 2 database
  // invariant; a corrupt duplicate keeps the first in calendar order so the
  // slot choice stays deterministic (multi-workout-per-day is never invented).
  const byDate = new Map<string, PlannedWorkoutDto>();
  for (const item of schedule.items) {
    if (!byDate.has(item.plannedDate)) {
      byDate.set(item.plannedDate, item);
    }
  }

  const slots: WeekDaySlotView[] = [];
  let cursor = monday.data;

  for (let index = 0; index < DAY_LABELS.length; index += 1) {
    const dayLabel = DAY_LABELS[index];
    if (dayLabel === undefined) {
      // Unreachable: DAY_LABELS has exactly seven entries (requireItem pattern).
      return null;
    }

    slots.push({
      date: cursor,
      dayLabel,
      dateLabel: formatPlannedDateLabel(cursor),
      isToday: cursor === schedule.today,
      item: byDate.get(cursor) ?? null,
    });

    if (index < DAY_LABELS.length - 1) {
      const next = addDaysToPlannedDate(cursor, 1);
      if (!next.ok) {
        return null;
      }
      cursor = next.data;
    }
  }

  return slots;
}