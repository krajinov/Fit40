'use server';

import { revalidatePath } from 'next/cache';

import { logSetSchema } from '@/features/sessions/schemas/session-actions-schema';
import { logSessionSetUseCase } from '@/features/sessions/services';

export async function logSetAction(formData: FormData): Promise<void> {
  const raw = {
    sessionId: formData.get('sessionId'),
    exerciseOrder: formData.get('exerciseOrder'),
    type: formData.get('type'),
    reps: formData.get('reps'),
    durationSeconds: formData.get('durationSeconds'),
    weightKg: formData.get('weightKg'),
    rpe: formData.get('rpe'),
  };

  const parsed = logSetSchema.safeParse(raw);
  if (!parsed.success) {
    return;
  }

  const result = await logSessionSetUseCase.execute(parsed.data);

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