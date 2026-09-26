/**
 * Weekday vocabulary and the TrainingDays value object (M15 calendar intent).
 *
 * A `TrainingDays` value is the non-empty set of ISO-8601 weekdays a user
 * trains on. It is the *input* to schedule generation
 * (`generatePlannedSchedule`); the generated `PlannedDate` rows are the
 * persisted schedule, so the selection itself is never stored.
 *
 * Canonical form: deduplicated and ascending by ISO weekday. Normalizing
 * rather than rejecting duplicates follows the EmailAddress precedent — every
 * TrainingDays is canonical once constructed, so two selections that differ
 * only in order or repetition are the same value.
 *
 * This module imports nothing but the domain Result contract.
 */

import { err, ok, type Result } from '@/domain/types/result';

/**
 * ISO-8601 weekday numbering, used wherever M15 speaks about days of the week:
 * Monday = 1 … Sunday = 7. It matches the Monday-start calendar week of
 * `training-week.ts`, so a selected weekday and a week window agree.
 */
export const Weekday = {
  Monday: 1,
  Tuesday: 2,
  Wednesday: 3,
  Thursday: 4,
  Friday: 5,
  Saturday: 6,
  Sunday: 7,
} as const;

export type Weekday = (typeof Weekday)[keyof typeof Weekday];

/** Every weekday in canonical (ascending) order. */
export const WEEKDAY_VALUES = Object.values(Weekday) as ReadonlyArray<Weekday>;

/**
 * A validated, canonical, non-empty set of training weekdays.
 *
 * Branded so a raw `number[]` cannot be mistaken for a validated selection.
 */
export type TrainingDays = ReadonlyArray<Weekday> & { readonly __brand: 'TrainingDays' };

export interface TrainingDaysValidationError {
  readonly code: 'INVALID_TRAINING_DAYS';
  readonly message: string;
}

function invalid(message: string): TrainingDaysValidationError {
  return { code: 'INVALID_TRAINING_DAYS', message };
}

/**
 * Creates a validated, canonical TrainingDays from raw weekday numbers.
 *
 * Behavior:
 * - Duplicates are normalized away and the result is ascending, so `[5, 1, 5]`
 *   and `[1, 5]` are the same value.
 * - An empty selection is rejected: a training schedule needs at least one day.
 * - Any value that is not an integer in 1..7 (including `NaN`) is rejected.
 * - The returned array never aliases the input.
 */
export function createTrainingDays(
  values: ReadonlyArray<number>,
): Result<TrainingDays, TrainingDaysValidationError> {
  if (values.length === 0) {
    return err(invalid('select at least one training day'));
  }

  const selected = new Set<Weekday>();
  for (const value of values) {
    const weekday = WEEKDAY_VALUES.find((candidate) => candidate === value);
    if (weekday === undefined) {
      return err(invalid(`${value} is not a weekday between 1 (Monday) and 7 (Sunday)`));
    }
    selected.add(weekday);
  }

  const canonical: ReadonlyArray<Weekday> = WEEKDAY_VALUES.filter((weekday) =>
    selected.has(weekday),
  );

  // Safe: every element is a validated Weekday, duplicates were normalized
  // away, and the array is freshly built, so the value satisfies every
  // TrainingDays invariant; the brand is a compile-time-only marker on a
  // runtime plain array. The cast is required because the brand has no runtime
  // representation (the EmailAddress convention).
  return ok(canonical as TrainingDays);
}

/** True when `weekday` is part of the selection. */
export function includesWeekday(days: TrainingDays, weekday: Weekday): boolean {
  return days.includes(weekday);
}
