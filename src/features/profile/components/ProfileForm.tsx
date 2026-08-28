'use client';

import { useActionState } from 'react';

import type { UserProfileDto } from '@/application/dto/user-profile';
import { updateProfileAction } from '@/features/profile/actions/update-profile';
import { ProfileActionErrorMessage } from '@/features/profile/components/ProfileActionError';
import { ProfileFormFields } from '@/features/profile/components/ProfileFormFields';
import { ProfilePreferenceGroups } from '@/features/profile/components/ProfilePreferenceGroups';
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
    <form action={formAction} className="space-y-6" noValidate>
      <ProfileFormFields values={values} fieldErrors={fieldErrors} />
      <ProfilePreferenceGroups
        availableEquipment={values.availableEquipment}
        physicalConsiderations={values.physicalConsiderations}
        fieldErrors={fieldErrors}
      />

      {state.ok && state.saved === true && (
        <p className="text-sm font-medium text-muted-foreground" role="status">
          Profile saved.
        </p>
      )}
      {!state.ok && <ProfileActionErrorMessage error={state.error} />}

      <ProfileSubmitButton label="Save changes" pendingLabel="Saving…" />
    </form>
  );
}
