'use server';

import { revalidatePath } from 'next/cache';

import { requireUser } from '@/features/auth/current-user';
import {
  configureTrainingDaysSchema,
  parseConfigureTrainingDaysFormData,
  programRedirectTarget,
} from '@/features/schedule/schemas/schedule-actions-schema';
import { configureTrainingDaysUseCase } from '@/features/schedule/services';
import type { ScheduleActionState } from '@/features/schedule/types/schedule-action-state';

/**
 * Sets or changes the authenticated user's training days for the current run.
 *
 * The UserId comes exclusively from the trusted session, and the route
 * coordinates (program slug) are validated against the public slug convention;
 * an EnrollmentId never travels in the form data or the DOM. The server owns
 * the request clock: `now` is created HERE and passed to the use case, so the
 * schedule's "today" can never be supplied by a browser.
 *
 * The use case is authoritative for every scheduling rule (TrainingDays
 * validation, generation, the single atomic replacement, stale-run mapping and
 * the no-retry contract). Expected failures are returned as typed action state;
 * unexpected errors propagate to the error boundary. On success the program
 * detail and the dashboard are revalidated — the calendar is server-rendered,
 * so the new schedule appears without a redirect and without a client-side
 * schedule cache. History, progression, PR and insight routes are deliberately
 * NOT revalidated: setting training days changes future intent only.
 */
export async function configureTrainingDaysAction(
  formData: FormData,
): Promise<ScheduleActionState> {
  const user = await requireUser(programRedirectTarget(formData));

  const parsed = configureTrainingDaysSchema.safeParse(
    parseConfigureTrainingDaysFormData(formData),
  );
  if (!parsed.success) {
    return {
      ok: false,
      error: { code: 'VALIDATION_ERROR', message: configureValidationMessage(parsed.error) },
    };
  }

  const now = new Date();

  const result = await configureTrainingDaysUseCase.execute({
    userId: user.id,
    programSlug: parsed.data.programSlug,
    weekdays: parsed.data.weekdays,
    now,
  });
  if (!result.ok) {
    return { ok: false, error: { code: result.error.code, message: result.error.message } };
  }

  revalidatePath(`/programs/${parsed.data.programSlug}`);
  revalidatePath('/dashboard');

  return { ok: true };
}

/**
 * Concise, truthful validation wording: a weekday problem is described as
 * such, anything else is treated as an invalid program (the enrollment-action
 * convention's wording).
 */
function configureValidationMessage(error: {
  readonly issues: ReadonlyArray<{ readonly path: ReadonlyArray<PropertyKey> }>;
}): string {
  const weekdayIssue = error.issues.some((issue) => issue.path[0] === 'weekdays');
  return weekdayIssue ? 'Choose at least one training day.' : 'Invalid program.';
}