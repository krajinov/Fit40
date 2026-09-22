'use server';

import { revalidatePath } from 'next/cache';

import { requireUser } from '@/features/auth/current-user';
import { addExerciseSchema } from '@/features/sessions/schemas/session-actions-schema';
import { addSessionExerciseUseCase } from '@/features/sessions/services';
import { sessionPathFromFormData } from '@/features/sessions/session-path';
import type { SessionActionState } from '@/features/sessions/types/session-action-state';

/**
 * Explicitly adds one catalog exercise to the authenticated user's in-progress
 * session (M11).
 *
 * The UserId comes exclusively from the trusted session — never from the form
 * data. The only trusted form fields are the session id, the selected
 * exercise id, the explicit prescription choice (scheme + sets + target) and
 * the rendered session version; every Add invariant (ownership, enrollment,
 * stale intent, catalog existence, completed session, occurrence shape) is
 * enforced by the use case. The session path is revalidated only on success —
 * Add never affects program progress, so no other route is revalidated.
 */
export async function addExerciseAction(formData: FormData): Promise<SessionActionState> {
  const user = await requireUser(sessionPathFromFormData(formData) ?? '/programs');

  const raw = {
    sessionId: formData.get('sessionId'),
    exerciseId: formData.get('exerciseId'),
    scheme: formData.get('scheme'),
    sets: formData.get('sets'),
    targetReps: formData.get('targetReps'),
    durationSeconds: formData.get('durationSeconds'),
    expectedSessionVersion: formData.get('expectedSessionVersion'),
  };

  const parsed = addExerciseSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid add-exercise input.' } };
  }

  const result = await addSessionExerciseUseCase.execute({
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
