'use server';

import { revalidatePath } from 'next/cache';

import { requireUser } from '@/features/auth/current-user';
import { removeExerciseSchema } from '@/features/sessions/schemas/session-actions-schema';
import { removeSessionExerciseUseCase } from '@/features/sessions/services';
import { sessionPathFromFormData } from '@/features/sessions/session-path';
import type { SessionActionState } from '@/features/sessions/types/session-action-state';

/**
 * Removes one user-added occurrence from the authenticated user's in-progress
 * session (M11).
 *
 * The UserId comes exclusively from the trusted session — never from the form
 * data. The only trusted form fields are the session id, the occurrence order
 * and the rendered session version; every removal invariant (ownership,
 * enrollment, stale intent, template-authored protection, logged-set
 * protection, completed session) is enforced by the use case. The session path
 * is revalidated only on success — removal never affects program progress, so
 * no other route is revalidated.
 */
export async function removeExerciseAction(formData: FormData): Promise<SessionActionState> {
  const user = await requireUser(sessionPathFromFormData(formData) ?? '/programs');

  const raw = {
    sessionId: formData.get('sessionId'),
    exerciseOrder: formData.get('exerciseOrder'),
    expectedSessionVersion: formData.get('expectedSessionVersion'),
  };

  const parsed = removeExerciseSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid remove input.' } };
  }

  const result = await removeSessionExerciseUseCase.execute({
    ...parsed.data,
    userId: user.id,
  });
  if (!result.ok) {
    return { ok: false, error: { code: result.error.code, message: result.error.message } };
  }

  const sessionPath = sessionPathFromFormData(formData);
  if (sessionPath !== null) {
    revalidatePath(sessionPath);
  }

  return { ok: true };
}
