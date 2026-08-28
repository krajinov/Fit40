'use server';

import { revalidatePath } from 'next/cache';

import { requireUser } from '@/features/auth/current-user';
import {
  echoProfileFormData,
  flattenFieldErrors,
  parseProfileFormData,
  profileFormSchema,
  toProfileFormOutput,
} from '@/features/profile/schemas/profile-schemas';
import { updateUserProfileUseCase } from '@/features/profile/services';
import type { ProfileActionState } from '@/features/profile/types/profile-action-state';

/**
 * Updates the authenticated user's existing profile.
 *
 * The UserId comes exclusively from the trusted session — any userId field in
 * the form data is ignored by design. Expected failures are returned as typed
 * action state (with submitted values preserved); unexpected errors propagate
 * to the error boundary. On success the profile route is revalidated so the
 * form re-renders with the persisted values.
 */
export async function updateProfileAction(formData: FormData): Promise<ProfileActionState> {
  const user = await requireUser('/profile');

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

  const result = await updateUserProfileUseCase.execute({
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

  revalidatePath('/profile');
  return { ok: true, saved: true };
}
