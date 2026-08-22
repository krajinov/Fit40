'use server';

import { revalidatePath } from 'next/cache';

import { startSessionSchema } from '@/features/sessions/schemas/session-actions-schema';
import { startWorkoutSessionUseCase } from '@/features/sessions/services';

export async function startSessionAction(formData: FormData): Promise<void> {
  const raw = {
    programSlug: formData.get('programSlug'),
    weekNumber: formData.get('weekNumber'),
    workoutOrder: formData.get('workoutOrder'),
  };

  const parsed = startSessionSchema.safeParse(raw);
  if (!parsed.success) {
    return;
  }

  const result = await startWorkoutSessionUseCase.execute(parsed.data);

  if (result.ok) {
    revalidatePath(
      `/programs/${parsed.data.programSlug}/weeks/${parsed.data.weekNumber}/workouts/${parsed.data.workoutOrder}/session`,
    );
  }
}
