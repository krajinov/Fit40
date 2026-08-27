'use server';

import { revalidatePath } from 'next/cache';

import { startSessionSchema } from '@/features/sessions/schemas/session-actions-schema';
import { startWorkoutSessionUseCase } from '@/features/sessions/services';
import type { SessionActionState } from '@/features/sessions/types/session-action-state';

export async function startSessionAction(formData: FormData): Promise<SessionActionState> {
  const raw = {
    programSlug: formData.get('programSlug'),
    weekNumber: formData.get('weekNumber'),
    workoutOrder: formData.get('workoutOrder'),
  };

  const parsed = startSessionSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid session input.' } };
  }

  const result = await startWorkoutSessionUseCase.execute(parsed.data);
  if (!result.ok) {
    return { ok: false, error: { code: result.error.code, message: result.error.message } };
  }

  revalidatePath(
    `/programs/${parsed.data.programSlug}/weeks/${parsed.data.weekNumber}/workouts/${parsed.data.workoutOrder}/session`,
  );

  return { ok: true };
}
