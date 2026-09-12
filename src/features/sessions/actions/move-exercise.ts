'use server';

import { revalidatePath } from 'next/cache';

import { requireUser } from '@/features/auth/current-user';
import { moveExerciseSchema } from '@/features/sessions/schemas/session-actions-schema';
import { moveSessionExerciseUseCase } from '@/features/sessions/services';
import { sessionPathFromFormData } from '@/features/sessions/session-path';
import type { SessionActionState } from '@/features/sessions/types/session-action-state';

/**
 * Swaps one occurrence with its adjacent neighbor (up/down) in the
 * authenticated user's in-progress session (M10).
 *
 * The UserId comes exclusively from the trusted session — never from the
 * form data. The only trusted form fields are the session id, the
 * occurrence order and the direction; every reorder invariant (ownership,
 * enrollment, adjacency boundary) is enforced by the use case. The session
 * path is revalidated only on success — a move never affects program
 * progress, so no other route is revalidated.
 */
export async function moveExerciseAction(formData: FormData): Promise<SessionActionState> {
  const user = await requireUser(sessionPathFromFormData(formData) ?? '/programs');

  const raw = {
    sessionId: formData.get('sessionId'),
    exerciseOrder: formData.get('exerciseOrder'),
    direction: formData.get('direction'),
    expectedSessionVersion: formData.get('expectedSessionVersion'),
  };

  const parsed = moveExerciseSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid move input.' } };
  }

  const result = await moveSessionExerciseUseCase.execute({
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