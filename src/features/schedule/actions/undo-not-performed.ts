'use server';

import { revalidatePath } from 'next/cache';

import { requireUser } from '@/features/auth/current-user';
import {
  parseAuthoredOccurrenceFormData,
  programRedirectTarget,
  undoNotPerformedSchema,
} from '@/features/schedule/schemas/schedule-actions-schema';
import { undoNotPerformedUseCase } from '@/features/schedule/services';
import {
  programPathFromSlug,
  sessionPathFromRoute,
  workoutPathFromRoute,
} from '@/features/sessions/session-path';
import type { ScheduleActionState } from '@/features/schedule/types/schedule-action-state';

/**
 * Undoes one authored occurrence's not-performed settlement (M17 Slice 11).
 *
 * Same boundary rules as recording: trusted-session UserId, authored route
 * coordinates only, and NO clock — undo is a deletion of an existing fact, so
 * there is nothing to attest. It delegates to the Slice 7 undo use case, which
 * removes the fact and nothing else (no calendar regeneration, no planned row,
 * no resurrected session, no start).
 *
 * On success EVERY route that can render this occurrence's recorded state is
 * revalidated, each built from the SAME authored coordinates the schema already
 * validated — never a client-supplied path: the owning program detail, the
 * occurrence's workout-detail route and its session route (both render the
 * recorded CTA band), plus the dashboard. The set is bounded and closed.
 *
 * Contract violations throw in the Application layer and are not caught here.
 */
export async function undoNotPerformedAction(
  formData: FormData,
): Promise<ScheduleActionState> {
  const user = await requireUser(programRedirectTarget(formData));

  const parsed = undoNotPerformedSchema.safeParse(parseAuthoredOccurrenceFormData(formData));
  if (!parsed.success) {
    return {
      ok: false,
      error: { code: 'VALIDATION_ERROR', message: 'Invalid workout request.' },
    };
  }

  const result = await undoNotPerformedUseCase.execute({
    userId: user.id,
    programSlug: parsed.data.programSlug,
    weekNumber: parsed.data.weekNumber,
    workoutOrder: parsed.data.workoutOrder,
  });
  if (!result.ok) {
    // Exhaustive by construction: the Slice 7 undo union must stay assignable
    // to `ScheduleActionErrorCode`.
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
