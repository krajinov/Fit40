'use server';

import { revalidatePath } from 'next/cache';

import { requireUser } from '@/features/auth/current-user';
import {
  parseReschedulePlannedWorkoutFormData,
  programRedirectTarget,
  reschedulePlannedWorkoutSchema,
} from '@/features/schedule/schemas/schedule-actions-schema';
import { reschedulePlannedWorkoutUseCase } from '@/features/schedule/services';
import type { ScheduleActionState } from '@/features/schedule/types/schedule-action-state';

/**
 * Moves one planned workout of the current run to another calendar date.
 *
 * The UserId comes exclusively from the trusted session; the planned workout is
 * addressed by its AUTHORED public coordinates (program slug + week number +
 * workout order) — never by an EnrollmentId, a database ScheduledWorkoutId or a
 * session id — and the target date is the canonical `YYYY-MM-DD` string the
 * native date input submits. The server owns the request clock: `now` is
 * created HERE and passed to the use case.
 *
 * The use case is authoritative for eligibility (completed / in-progress
 * blocks), date validity, past-date rejection, occupancy conflicts and stale
 * run mapping; this action duplicates none of it and never retries. Expected
 * failures are returned as typed action state; unexpected errors propagate to
 * the error boundary. On success the program detail and the dashboard are
 * revalidated so the server-rendered calendar and dashboard schedule reflect
 * the move — no redirect, and no completed-truth route is touched.
 */
export async function reschedulePlannedWorkoutAction(
  formData: FormData,
): Promise<ScheduleActionState> {
  const user = await requireUser(programRedirectTarget(formData));

  const parsed = reschedulePlannedWorkoutSchema.safeParse(
    parseReschedulePlannedWorkoutFormData(formData),
  );
  if (!parsed.success) {
    return {
      ok: false,
      error: { code: 'VALIDATION_ERROR', message: rescheduleValidationMessage(parsed.error) },
    };
  }

  const now = new Date();

  const result = await reschedulePlannedWorkoutUseCase.execute({
    userId: user.id,
    programSlug: parsed.data.programSlug,
    weekNumber: parsed.data.weekNumber,
    workoutOrder: parsed.data.workoutOrder,
    date: parsed.data.date,
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
 * Concise, truthful validation wording: a malformed target date is described
 * as such; malformed coordinates are an invalid move request. Calendar
 * validity itself is never judged here — the use case owns it.
 */
function rescheduleValidationMessage(error: {
  readonly issues: ReadonlyArray<{ readonly path: ReadonlyArray<PropertyKey> }>;
}): string {
  const dateIssue = error.issues.some((issue) => issue.path[0] === 'date');
  return dateIssue ? 'Enter a valid date.' : 'Invalid move request.';
}