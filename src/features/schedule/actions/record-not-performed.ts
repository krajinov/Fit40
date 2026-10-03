'use server';

import { revalidatePath } from 'next/cache';

import { requireUser } from '@/features/auth/current-user';
import {
  parseAuthoredOccurrenceFormData,
  programRedirectTarget,
  recordNotPerformedSchema,
} from '@/features/schedule/schemas/schedule-actions-schema';
import { recordNotPerformedUseCase } from '@/features/schedule/services';
import {
  programPathFromSlug,
  sessionPathFromRoute,
  workoutPathFromRoute,
} from '@/features/sessions/session-path';
import type { ScheduleActionState } from '@/features/schedule/types/schedule-action-state';

/**
 * Records one authored occurrence of the current run as NOT PERFORMED (M17
 * Slice 11).
 *
 * The UserId comes exclusively from the trusted session; the occurrence is
 * addressed by its AUTHORED public coordinates (program slug + week number +
 * workout order) — never by an EnrollmentId, a database ScheduledWorkoutId or
 * a session id — and the attestation instant is created HERE: `recordedAt` is
 * the server's clock, so a browser can never backdate or forward-date a
 * settlement.
 *
 * The use case (and the enrollment-locked authority behind it) is
 * authoritative for eligibility: whether the occurrence is already settled,
 * already performed, or carries logged work. This action duplicates none of
 * it, never inspects sessions, and never retries. Contract violations already
 * throw inside the Application layer and are deliberately NOT caught here —
 * they are invariant breaches, not user outcomes.
 *
 * On success EVERY route that can render this occurrence's recorded state is
 * revalidated, each built from the SAME authored coordinates the schema already
 * validated — never a client-supplied path: the owning program detail, the
 * occurrence's workout-detail route and its session route (both render the
 * recorded CTA band, so a previously visited one must stop offering Start),
 * plus the dashboard. The set is bounded and closed, and no completed-truth
 * route is touched.
 */
export async function recordNotPerformedAction(
  formData: FormData,
): Promise<ScheduleActionState> {
  const user = await requireUser(programRedirectTarget(formData));

  const parsed = recordNotPerformedSchema.safeParse(
    parseAuthoredOccurrenceFormData(formData),
  );
  if (!parsed.success) {
    return {
      ok: false,
      error: { code: 'VALIDATION_ERROR', message: 'Invalid workout request.' },
    };
  }

  // The ONLY clock in this flow, and only for recording: undo takes none.
  const recordedAt = new Date();

  const result = await recordNotPerformedUseCase.execute({
    userId: user.id,
    programSlug: parsed.data.programSlug,
    weekNumber: parsed.data.weekNumber,
    workoutOrder: parsed.data.workoutOrder,
    recordedAt,
  });
  if (!result.ok) {
    // Exhaustive by construction: `result.error.code` is the Slice 7 union,
    // which must stay assignable to `ScheduleActionErrorCode` — a new
    // Application outcome fails type-checking until it is mapped here.
    return { ok: false, error: { code: result.error.code, message: result.error.message } };
  }

  // Every surface that renders this occurrence's recorded state is invalidated
  // from the AUTHORED coordinates the schema already validated — the owning
  // program detail, the occurrence's workout-detail route and its session route
  // (both render the recorded CTA band), plus the dashboard. No path is ever
  // read from FormData, so a forged field can neither redirect nor revalidate
  // the wrong page; the set is bounded and closed.
  revalidatePath(programPathFromSlug(parsed.data.programSlug));
  revalidatePath(workoutPathFromRoute(parsed.data));
  revalidatePath(sessionPathFromRoute(parsed.data));
  revalidatePath('/dashboard');

  return { ok: true };
}
