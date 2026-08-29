'use server';

import { revalidatePath } from 'next/cache';

import { requireUser } from '@/features/auth/current-user';
import { updateSetSchema } from '@/features/sessions/schemas/session-actions-schema';
import { updateSessionSetUseCase } from '@/features/sessions/services';
import { sessionPathFromFormData } from '@/features/sessions/session-path';
import type { SessionActionState } from '@/features/sessions/types/session-action-state';

/**
 * Updates a set in the authenticated user's in-progress session. The UserId
 * comes exclusively from the trusted session — never from the form data.
 */
export async function updateSetAction(formData: FormData): Promise<SessionActionState> {
  const user = await requireUser(sessionPathFromFormData(formData) ?? '/programs');

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
    return { ok: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid set input.' } };
  }

  const result = await updateSessionSetUseCase.execute({ ...parsed.data, userId: user.id });
  if (!result.ok) {
    return { ok: false, error: { code: result.error.code, message: result.error.message } };
  }

  const sessionPath = sessionPathFromFormData(formData);
  if (sessionPath !== null) {
    revalidatePath(sessionPath);
  }

  return { ok: true };
}

