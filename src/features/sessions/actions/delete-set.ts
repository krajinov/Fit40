'use server';

import { revalidatePath } from 'next/cache';

import { deleteSetSchema } from '@/features/sessions/schemas/session-actions-schema';
import { deleteSessionSetUseCase } from '@/features/sessions/services';
import type { SessionActionState } from '@/features/sessions/types/session-action-state';

export async function deleteSetAction(formData: FormData): Promise<SessionActionState> {
  const raw = {
    sessionId: formData.get('sessionId'),
    exerciseOrder: formData.get('exerciseOrder'),
    setNumber: formData.get('setNumber'),
  };

  const parsed = deleteSetSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid set input.' } };
  }

  const result = await deleteSessionSetUseCase.execute(parsed.data);
  if (!result.ok) {
    return { ok: false, error: { code: result.error.code, message: result.error.message } };
  }

  const programSlug = formData.get('programSlug');
  const weekNumber = formData.get('weekNumber');
  const workoutOrder = formData.get('workoutOrder');
  if (programSlug && weekNumber && workoutOrder) {
    revalidatePath(
      `/programs/${programSlug}/weeks/${weekNumber}/workouts/${workoutOrder}/session`,
    );
  }

  return { ok: true };
}
