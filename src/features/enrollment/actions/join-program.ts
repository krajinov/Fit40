'use server';

import { revalidatePath } from 'next/cache';

import { requireUser } from '@/features/auth/current-user';
import { enrollmentFormSchema } from '@/features/enrollment/schemas/enrollment-actions-schema';
import { enrollInProgramUseCase } from '@/features/enrollment/services';
import type { EnrollmentActionState } from '@/features/enrollment/types/enrollment-action-state';

/**
 * Enrolls the authenticated user in a program.
 *
 * The UserId comes exclusively from the trusted session — any userId field
 * in the form data is ignored by design. Expected failures are returned as
 * typed action state; unexpected errors propagate to the error boundary. On
 * success the program catalog and detail routes are revalidated so every
 * enrolled view reflects the new state.
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
