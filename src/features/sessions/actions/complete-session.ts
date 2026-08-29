'use server';

import { revalidatePath } from 'next/cache';

import { requireUser } from '@/features/auth/current-user';
import { completeSessionSchema } from '@/features/sessions/schemas/session-actions-schema';
import { completeWorkoutSessionUseCase } from '@/features/sessions/services';
import { sessionPathFromFormData } from '@/features/sessions/session-path';
import type { SessionActionState } from '@/features/sessions/types/session-action-state';

/**
 * Completes the authenticated user's in-progress workout session.
 *
 * The UserId comes exclusively from the trusted session — the form carries
 * only the session id and route coordinates. Completing a session changes
 * the owning enrollment's progress, so both the session page and the owning
 * program page are revalidated. The program page target comes from the use
 * case, derived from trusted session data — never from form fields — so a
 * forged programSlug cannot revalidate (or leave stale) the wrong page.
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
  // Completion changes the owning program page's progress and Done markers.
  // The slug is trusted data resolved by the use case from the session's
  // scheduled workout — the client-supplied programSlug is never authoritative.
  const programSlug = result.data.programSlug;
  if (programSlug !== null) {
    revalidatePath(`/programs/${programSlug}`);
  }

  return { ok: true };
}

