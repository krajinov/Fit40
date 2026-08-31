'use client';

import Link from 'next/link';
import { useActionState } from 'react';

import { buttonVariants } from '@/components/ui/button';
import type { UserProfileDto } from '@/application/dto/user-profile';
import { updateProfileAction } from '@/features/profile/actions/update-profile';
import { ProfileActionErrorMessage } from '@/features/profile/components/ProfileActionError';
import { ProfileFormSections } from '@/features/profile/components/ProfileFormSections';
import { ProfileSubmitButton } from '@/features/profile/components/ProfileSubmitButton';
import {
  profileToFormValues,
  resolveFormValues,
} from '@/features/profile/profile-form-values';
import type { ProfileActionState } from '@/features/profile/types/profile-action-state';

const initialState: ProfileActionState = { ok: true };

interface ProfileFormProps {
  readonly profile: UserProfileDto;
}

export function ProfileForm({ profile }: ProfileFormProps) {
  async function submitAction(
    _prev: ProfileActionState,
    formData: FormData,
  ): Promise<ProfileActionState> {
    return updateProfileAction(formData);
  }

  const [state, formAction] = useActionState(submitAction, initialState);
  const values = resolveFormValues(state, profileToFormValues(profile));
  const fieldErrors = state.ok ? {} : (state.error.fieldErrors ?? {});

  return (
    <form action={formAction} noValidate>
      <ProfileFormSections values={values} fieldErrors={fieldErrors} />

      <div className="pt-6 md:pt-8">
        {state.ok && state.saved === true && (
          <p
            role="status"
            className="mb-6 rounded-callout border border-accent-tint-border bg-accent-tint px-4 py-3 text-sm font-medium text-accent-strong"
          >
            Profile saved.
          </p>
        )}
        {!state.ok && <ProfileActionErrorMessage error={state.error} className="mb-6" />}

        <div className="flex items-center gap-4">
          <ProfileSubmitButton
            label="Save changes"
            pendingLabel="Saving…"
            className="w-full md:w-auto"
          />
          <Link
            href="/dashboard"
            className={`${buttonVariants({ variant: 'ghost', size: 'sm' })} hidden md:inline-flex`}
          >
            Cancel
          </Link>
        </div>
      </div>
    </form>
  );
}
