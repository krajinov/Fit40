'use server';

import { revalidatePath } from 'next/cache';

import { completeSessionSchema } from '@/features/sessions/schemas/session-actions-schema';
import { completeWorkoutSessionUseCase } from '@/features/sessions/services';

export async function completeSessionAction(formData: FormData): Promise<void> {
  const raw = {
    sessionId: formData.get('sessionId'),
  };

  const parsed = completeSessionSchema.safeParse(raw);
  if (!parsed.success) {
    return;
  }

  const result = await completeWorkoutSessionUseCase.execute(parsed.data);

  if (result.ok) {
    const programSlug = formData.get('programSlug');
    const weekNumber = formData.get('weekNumber');
    const workoutOrder = formData.get('workoutOrder');
    if (programSlug && weekNumber && workoutOrder) {
      revalidatePath(
        `/programs/${programSlug}/weeks/${weekNumber}/workouts/${workoutOrder}/session`,
      );
    }
  }
}