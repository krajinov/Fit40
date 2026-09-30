'use server';

import { revalidatePath } from 'next/cache';

import { requireUser } from '@/features/auth/current-user';
import {
  parseAuthoredOccurrenceFormData,
  programRedirectTarget,
  undoNotPerformedSchema,
} from '@/features/schedule/schemas/schedule-actions-schema';
import { undoNotPerformedUseCase } from '@/features/schedule/services';
import type { ScheduleActionState } from '@/features/schedule/types/schedule-action-state';

/**
 * Undoes one authored occurrence's not-performed settlement (M17 Slice 11).
 *
 * Same boundary rules as recording: trusted-session UserId, authored route
 * coordinates only, and NO clock — undo is a deletion of an existing fact, so
 * there is nothing to attest. It delegates to the Slice 7 undo use case, which
 * removes the fact and nothing else (no calendar regeneration, no planned row,
 * no resurrected session, no start); this action therefore revalidates the
 * same two paths so the occurrence reappears as not started on both the
 * program calendar and the dashboard.
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

  revalidatePath(`/programs/${parsed.data.programSlug}`);
  revalidatePath('/dashboard');

  return { ok: true };
}
