'use server';

import { revalidatePath } from 'next/cache';

import { requireUser } from '@/features/auth/current-user';
import { deleteSetSchema } from '@/features/sessions/schemas/session-actions-schema';
import { deleteSessionSetUseCase } from '@/features/sessions/services';
import { sessionPathFromFormData } from '@/features/sessions/session-path';
import type { SessionActionState } from '@/features/sessions/types/session-action-state';

/**
 * Deletes a set from the authenticated user's in-progress session. The
 * UserId comes exclusively from the trusted session — never from the form
 * data.
 */
export async function deleteSetAction(formData: FormData): Promise<SessionActionState> {
  const user = await requireUser(sessionPathFromFormData(formData) ?? '/programs');

  const raw = {
    sessionId: formData.get('sessionId'),
    exerciseOrder: formData.get('exerciseOrder'),
    setNumber: formData.get('setNumber'),
  };

  const parsed = deleteSetSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid set input.' } };
  }

  const result = await deleteSessionSetUseCase.execute({ ...parsed.data, userId: user.id });
  if (!result.ok) {
    return { ok: false, error: { code: result.error.code, message: result.error.message } };
  }

  const sessionPath = sessionPathFromFormData(formData);
  if (sessionPath !== null) {
    revalidatePath(sessionPath);
  }

  return { ok: true };
}

