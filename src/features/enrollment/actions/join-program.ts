'use server';

import { revalidatePath } from 'next/cache';

import { requireUser } from '@/features/auth/current-user';
import { enrollmentFormSchema } from '@/features/enrollment/schemas/enrollment-actions-schema';
import { enrollInProgramUseCase } from '@/features/enrollment/services';
import type { EnrollmentActionState } from '@/features/enrollment/types/enrollment-action-state';
import { SESSION_PAGE_PATH_TEMPLATE } from '@/features/sessions/session-path';

/**
 * Enrolls the authenticated user in a program.
 *
 * The UserId comes exclusively from the trusted session — any userId field
 * in the form data is ignored by design. Expected failures are returned as
 * typed action state; unexpected errors propagate to the error boundary. On
 * success the program catalog, detail, and nested session routes are
 * revalidated so every view — including a session page left open from before
 * the join — reflects the new state. The session route is revalidated by its
 * dynamic template because the form carries only the program slug, while the
 * affected pages span every week and workout of the program.
 */
export async function joinProgramAction(formData: FormData): Promise<EnrollmentActionState> {
  const user = await requireUser(programRedirectTarget(formData));

  const parsed = enrollmentFormSchema.safeParse({ programSlug: formData.get('programSlug') });
  if (!parsed.success) {
    return { ok: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid program.' } };
  }

  const result = await enrollInProgramUseCase.execute({
    userId: user.id,
    programSlug: parsed.data.programSlug,
  });
  if (!result.ok) {
    return { ok: false, error: { code: result.error.code, message: result.error.message } };
  }

  revalidatePath('/programs');
  revalidatePath(`/programs/${parsed.data.programSlug}`);
  revalidatePath(SESSION_PAGE_PATH_TEMPLATE, 'page');

  return { ok: true };
}

/**
 * Resolves the post-login redirect target for unauthenticated callers: the
 * program page when the submitted slug is well-formed, the catalog otherwise.
 */
function programRedirectTarget(formData: FormData): string {
  const parsed = enrollmentFormSchema.safeParse({ programSlug: formData.get('programSlug') });
  return parsed.success ? `/programs/${parsed.data.programSlug}` : '/programs';
}
