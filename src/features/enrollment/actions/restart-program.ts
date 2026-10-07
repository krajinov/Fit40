'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';

import { requireUser } from '@/features/auth/current-user';
import { enrollmentFormSchema } from '@/features/enrollment/schemas/enrollment-actions-schema';
import { restartProgramUseCase } from '@/features/enrollment/services';
import type { EnrollmentActionState } from '@/features/enrollment/types/enrollment-action-state';
import { SESSION_PAGE_PATH_TEMPLATE } from '@/features/sessions/session-path';

/**
 * Restarts the authenticated user's completed program run.
 *
 * The UserId comes exclusively from the trusted session — any userId field in
 * the form data is ignored by design — and the form carries only the program
 * slug: the expected old EnrollmentId never crosses the client boundary (the
 * use case reads the current enrollment itself for its atomic replace).
 * Expected failures are returned as typed action state; unexpected errors
 * propagate to the error boundary. On success every view the restart affects
 * is revalidated — the catalog, the program detail, the completion page being
 * left, the dashboard, and nested session routes by template — and the user
 * is redirected to the program detail, never back to the completed page.
 */
export async function restartProgramAction(
  formData: FormData,
): Promise<EnrollmentActionState> {
  const user = await requireUser(completedRedirectTarget(formData));

  const parsed = enrollmentFormSchema.safeParse({ programSlug: formData.get('programSlug') });
  if (!parsed.success) {
    return { ok: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid program.' } };
  }

  const result = await restartProgramUseCase.execute({
    userId: user.id,
    programSlug: parsed.data.programSlug,
  });
  if (!result.ok) {
    return { ok: false, error: { code: result.error.code, message: result.error.message } };
  }

  revalidatePath('/programs');
  revalidatePath(`/programs/${parsed.data.programSlug}`);
  revalidatePath(`/programs/${parsed.data.programSlug}/completed`);
  revalidatePath('/dashboard');
  revalidatePath(SESSION_PAGE_PATH_TEMPLATE, 'page');

  redirect(`/programs/${parsed.data.programSlug}`);
}

/**
 * Resolves the post-login redirect target for unauthenticated callers: the
 * completion page (where this form lives) when the submitted slug is
 * well-formed, the catalog otherwise.
 */
function completedRedirectTarget(formData: FormData): string {
  const parsed = enrollmentFormSchema.safeParse({ programSlug: formData.get('programSlug') });
  return parsed.success
    ? `/programs/${parsed.data.programSlug}/completed`
    : '/programs';
}