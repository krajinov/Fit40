'use server';

import { revalidatePath } from 'next/cache';

import { requireUser } from '@/features/auth/current-user';
import { completeSessionSchema } from '@/features/sessions/schemas/session-actions-schema';
import { completeWorkoutSessionUseCase } from '@/features/sessions/services';
import {
  programPathFromSlug,
  sessionPathFromFormData,
  sessionPathFromRoute,
} from '@/features/sessions/session-path';
import type { SessionActionState } from '@/features/sessions/types/session-action-state';

/**
 * Completes the authenticated user's in-progress workout session.
 *
 * The UserId comes exclusively from the trusted session and the only trusted
 * form field is the session id. Completing a session changes the owning
 * enrollment's progress, so both the session page and the owning program page
 * are revalidated. Both targets come from the use case, derived from trusted
 * session data — never from form fields — so forged route coordinates can
 * neither revalidate nor leave stale the wrong page.
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

  // Both revalidation targets derive from trusted server-side data resolved
  // by the use case from the session's own scheduled workout — client-supplied
  // route coordinates are never authoritative. When the owning occurrence can
  // no longer be resolved there is no trustworthy page to revalidate, so
  // neither target is touched.
  const route = result.data.route;
  if (route !== null) {
    revalidatePath(programPathFromSlug(route.programSlug));
    revalidatePath(sessionPathFromRoute(route));
  }

  return { ok: true };
}

