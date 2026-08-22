'use server';

import { revalidatePath } from 'next/cache';

import { updateSetSchema } from '@/features/sessions/schemas/session-actions-schema';
import { updateSessionSetUseCase } from '@/features/sessions/services';

export async function updateSetAction(formData: FormData): Promise<void> {
  const raw = {
    sessionId: formData.get('sessionId'),
    exerciseOrder: formData.get('exerciseOrder'),
    setNumber: formData.get('setNumber'),
    type: formData.get('type'),
    reps: formData.get('reps'),
    durationSeconds: formData.get('durationSeconds'),
    weightKg: formData.get('weightKg'),
    rpe: formData.get('rpe'),
  };

  const parsed = updateSetSchema.safeParse(raw);
  if (!parsed.success) {
    return;
  }

  const result = await updateSessionSetUseCase.execute(parsed.data);

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