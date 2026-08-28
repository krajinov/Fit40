'use server';

import { redirect } from 'next/navigation';

import { requireUser } from '@/features/auth/current-user';
import {
  echoProfileFormData,
  flattenFieldErrors,
  parseProfileFormData,
  profileFormSchema,
  toProfileFormOutput,
} from '@/features/profile/schemas/profile-schemas';
import { completeOnboardingUseCase } from '@/features/profile/services';
import type { ProfileActionState } from '@/features/profile/types/profile-action-state';

/**
 * Completes fitness onboarding for the authenticated user and redirects to the
 * dashboard.
 *
 * The UserId comes exclusively from the trusted session — any userId field in
 * the form data is ignored by design. Expected failures are returned as typed
 * action state (with submitted values preserved); unexpected errors propagate
 * to the error boundary. On success this never returns: `redirect` throws
 * NEXT_REDIRECT, which must not be caught.
 */
export async function completeOnboardingAction(formData: FormData): Promise<ProfileActionState> {
  const user = await requireUser('/onboarding');

  const parsed = profileFormSchema.safeParse(parseProfileFormData(formData));
  if (!parsed.success) {
    return {
      ok: false,
      values: echoProfileFormData(formData),
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Please fix the errors below.',
        fieldErrors: flattenFieldErrors(parsed.error),
      },
    };
  }

  const result = await completeOnboardingUseCase.execute({
    userId: user.id,
    ...toProfileFormOutput(parsed.data),
  });

  if (!result.ok) {
    return {
      ok: false,
      values: echoProfileFormData(formData),
      error: {
        code: result.error.code,
        message: result.error.message,
        fieldErrors:
          result.error.code === 'INVALID_PROFILE' && result.error.field
            ? { [result.error.field]: [result.error.message] }
            : undefined,
      },
    };
  }

  redirect('/dashboard');
}
