'use server';

import { revalidatePath } from 'next/cache';

import { requireUser } from '@/features/auth/current-user';
import { completeSessionSchema } from '@/features/sessions/schemas/session-actions-schema';
import { completeWorkoutSessionUseCase } from '@/features/sessions/services';
import {
  programPathFromFormData,
  sessionPathFromFormData,
} from '@/features/sessions/session-path';
import type { SessionActionState } from '@/features/sessions/types/session-action-state';

/**
 * Completes the authenticated user's in-progress workout session.
 *
 * The UserId comes exclusively from the trusted session — the form carries
 * only the session id and route coordinates. Completing a session changes
 * the owning enrollment's progress, so both the session page and the program
 * detail page are revalidated.
 */
export async function completeSessionAction(formData: FormData): Promise<SessionActionState> {
  const user = await requireUser(sessionPathFromFormData(formData) ?? '/programs');

  const raw = {
    sessionId: formData.get('sessionId'),
  };

  const parsed = completeSessionSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid session input.' } };
  }

  const result = await completeWorkoutSessionUseCase.execute({
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
  // Completion changes the program page's progress and Done markers.
  const programPath = programPathFromFormData(formData);
  if (programPath !== null) {
    revalidatePath(programPath);
  }

  return { ok: true };
}

