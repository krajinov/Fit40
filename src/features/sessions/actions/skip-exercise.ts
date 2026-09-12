'use server';

import { revalidatePath } from 'next/cache';

import { requireUser } from '@/features/auth/current-user';
import { skipExerciseSchema } from '@/features/sessions/schemas/session-actions-schema';
import { skipSessionExerciseUseCase } from '@/features/sessions/services';
import { sessionPathFromFormData } from '@/features/sessions/session-path';
import type { SessionActionState } from '@/features/sessions/types/session-action-state';

/**
 * Marks one occurrence as skipped in the authenticated user's in-progress
 * session (M10).
 *
 * The UserId comes exclusively from the trusted session — never from the
 * form data. The only trusted form fields are the session id and the
 * occurrence order; every skip invariant (ownership, enrollment,
 * logged-set block, already-skipped) is enforced by the use case. The
 * session path is revalidated only on success — skip/unskip never affect
 * program progress, so no other route is revalidated.
 */
export async function skipExerciseAction(formData: FormData): Promise<SessionActionState> {
  const user = await requireUser(sessionPathFromFormData(formData) ?? '/programs');

  const raw = {
    sessionId: formData.get('sessionId'),
    exerciseOrder: formData.get('exerciseOrder'),
    expectedSessionVersion: formData.get('expectedSessionVersion'),
  };

  const parsed = skipExerciseSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid skip input.' } };
  }

  const result = await skipSessionExerciseUseCase.execute({
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