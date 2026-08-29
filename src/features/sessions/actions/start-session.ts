'use server';

import { revalidatePath } from 'next/cache';

import { requireUser } from '@/features/auth/current-user';
import { startSessionSchema } from '@/features/sessions/schemas/session-actions-schema';
import { startWorkoutSessionUseCase } from '@/features/sessions/services';
import { sessionPathFromFormData } from '@/features/sessions/session-path';
import type { SessionActionState } from '@/features/sessions/types/session-action-state';

/**
 * Starts a workout session for the authenticated user's enrollment.
 *
 * The UserId comes exclusively from the trusted session — the form carries
 * only the program route coordinates. Expected failures are returned as
 * typed action state; unexpected errors propagate to the error boundary.
 */
export async function startSessionAction(formData: FormData): Promise<SessionActionState> {
  const user = await requireUser(sessionPathFromFormData(formData) ?? '/programs');

  const raw = {
    programSlug: formData.get('programSlug'),
    weekNumber: formData.get('weekNumber'),
    workoutOrder: formData.get('workoutOrder'),
  };

  const parsed = startSessionSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid session input.' } };
  }

  const result = await startWorkoutSessionUseCase.execute({ ...parsed.data, userId: user.id });
  if (!result.ok) {
    return { ok: false, error: { code: result.error.code, message: result.error.message } };
  }

  const sessionPath = sessionPathFromFormData(formData);
  if (sessionPath !== null) {
    revalidatePath(sessionPath);
  }

  return { ok: true };
}

