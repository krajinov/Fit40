'use client';

import { useActionState } from 'react';

import { completeOnboardingAction } from '@/features/profile/actions/complete-onboarding';
import { ProfileActionErrorMessage } from '@/features/profile/components/ProfileActionError';
import { ProfileFormFields } from '@/features/profile/components/ProfileFormFields';
import { ProfilePreferenceGroups } from '@/features/profile/components/ProfilePreferenceGroups';
import { ProfileSubmitButton } from '@/features/profile/components/ProfileSubmitButton';
import {
  EMPTY_PROFILE_FORM_VALUES,
  resolveFormValues,
} from '@/features/profile/profile-form-values';
import type { ProfileActionState } from '@/features/profile/types/profile-action-state';

const initialState: ProfileActionState = { ok: true };

export function OnboardingForm() {
  async function submitAction(
    _prev: ProfileActionState,
    formData: FormData,
  ): Promise<ProfileActionState> {
    return completeOnboardingAction(formData);
  }

  const [state, formAction] = useActionState(submitAction, initialState);
  const values = resolveFormValues(state, EMPTY_PROFILE_FORM_VALUES);
  const fieldErrors = state.ok ? {} : (state.error.fieldErrors ?? {});

  return (
    <form action={formAction} className="space-y-6" noValidate>
      <ProfileFormFields values={values} fieldErrors={fieldErrors} />
      <ProfilePreferenceGroups
        availableEquipment={values.availableEquipment}
        physicalConsiderations={values.physicalConsiderations}
        fieldErrors={fieldErrors}
      />

      {!state.ok && <ProfileActionErrorMessage error={state.error} />}

      <ProfileSubmitButton label="Finish setup" pendingLabel="Saving…" />
    </form>
  );
}
