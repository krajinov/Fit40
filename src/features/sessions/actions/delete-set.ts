'use server';

import { revalidatePath } from 'next/cache';

import { deleteSetSchema } from '@/features/sessions/schemas/session-actions-schema';
import { deleteSessionSetUseCase } from '@/features/sessions/services';

export async function deleteSetAction(formData: FormData): Promise<void> {
  const raw = {
    sessionId: formData.get('sessionId'),
    exerciseOrder: formData.get('exerciseOrder'),
    setNumber: formData.get('setNumber'),
  };

  const parsed = deleteSetSchema.safeParse(raw);
  if (!parsed.success) {
    return;
  }

  const result = await deleteSessionSetUseCase.execute(parsed.data);

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