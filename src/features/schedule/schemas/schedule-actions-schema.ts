/**
 * Boundary validation for M15 scheduling Server Actions.
 *
 * The only client-supplied fields are the public program slug, the authored
 * route coordinates and the submitted weekday/date values. The user id and the
 * server clock NEVER come from form data — they are supplied by the trusted
 * session and the Server Action itself. Route-coordinate schemas are reused
 * from the sessions schema module (the single source of truth for program
 * route shapes, also used by session-path.ts).
 *
 * Neither schema re-implements scheduling rules: the application use case
 * remains authoritative for the TrainingDays value object, real-calendar
 * validity, past dates, occupancy and session eligibility.
 */

import { z } from 'zod';

import {
  programSlugSchema,
  weekNumberSchema,
  workoutOrderSchema,
} from '@/features/sessions/schemas/session-actions-schema';

/**
 * One submitted weekday: an ISO-8601 weekday number delivered as a FormData
 * string ("1".."7", Monday = 1). An empty value coerces to 0, a non-numeric
 * one to NaN — both fail; duplicates are accepted and normalized by the
 * application's TrainingDays value object.
 */
export const weekdaySchema = z.coerce.number().int().min(1).max(7);

/** Repeated `weekday` checkbox values: at least one training day. */
export const weekdaysSchema = z.array(weekdaySchema).min(1, 'Choose at least one training day.');

export const configureTrainingDaysSchema = z.object({
  programSlug: programSlugSchema,
  weekdays: weekdaysSchema,
});

/**
 * Canonical `YYYY-MM-DD` shape only. The application's `createPlannedDate`
 * owns calendar validity (impossible dates) and `DATE_IN_PAST`.
 */
export const plannedDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const reschedulePlannedWorkoutSchema = z.object({
  programSlug: programSlugSchema,
  weekNumber: weekNumberSchema,
  workoutOrder: workoutOrderSchema,
  date: plannedDateSchema,
});

/** Repeated `weekday` checkbox values as strings (the checkbox-array convention). */
export function parseWeekdayValues(formData: FormData): ReadonlyArray<string> {
  return formData.getAll('weekday').map((value) => (typeof value === 'string' ? value : ''));
}

/** The shape `configureTrainingDaysSchema` expects from a native submission. */
export function parseConfigureTrainingDaysFormData(formData: FormData) {
  return {
    programSlug: formData.get('programSlug'),
    weekdays: parseWeekdayValues(formData),
  };
}

/** The shape `reschedulePlannedWorkoutSchema` expects from a native submission. */
export function parseReschedulePlannedWorkoutFormData(formData: FormData) {
  return {
    programSlug: formData.get('programSlug'),
    weekNumber: formData.get('weekNumber'),
    workoutOrder: formData.get('workoutOrder'),
    date: formData.get('date'),
  };
}

/**
 * Post-login redirect target for unauthenticated callers: the program page
 * when the submitted slug is well-formed, the catalog otherwise (the
 * enrollment-action convention).
 */
export function programRedirectTarget(formData: FormData): string {
  const parsed = programSlugSchema.safeParse(formData.get('programSlug'));
  return parsed.success ? `/programs/${parsed.data}` : '/programs';
}