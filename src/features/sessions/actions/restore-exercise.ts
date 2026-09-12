'use server';

import { revalidatePath } from 'next/cache';

import { requireUser } from '@/features/auth/current-user';
import { restoreExerciseSchema } from '@/features/sessions/schemas/session-actions-schema';
import { restoreSessionExerciseUseCase } from '@/features/sessions/services';
import { sessionPathFromFormData } from '@/features/sessions/session-path';
import type { SessionActionState } from '@/features/sessions/types/session-action-state';

/**
 * Restores one substituted occurrence back to performed-as-authored identity
 * in the authenticated user's in-progress session.
 *
 * The UserId comes exclusively from the trusted session — never from the
 * form data. The only trusted form fields are the session id and the
 * occurrence order; every restore invariant (ownership, enrollment,
 * logged-set block, currently-substituted) is enforced by the use case. The
 * session path is revalidated only on success.
 */
export async function restoreExerciseAction(formData: FormData): Promise<SessionActionState> {
  const user = await requireUser(sessionPathFromFormData(formData) ?? '/programs');

  const raw = {
    sessionId: formData.get('sessionId'),
    exerciseOrder: formData.get('exerciseOrder'),
    expectedSessionVersion: formData.get('expectedSessionVersion'),
  };

  const parsed = restoreExerciseSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid restore input.' } };
  }

  const result = await restoreSessionExerciseUseCase.execute({
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
