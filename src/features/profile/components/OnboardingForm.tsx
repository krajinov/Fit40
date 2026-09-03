'use client';

import { useActionState } from 'react';

import { completeOnboardingAction } from '@/features/profile/actions/complete-onboarding';
import { ProfileActionErrorMessage } from '@/features/profile/components/ProfileActionError';
import { ProfileFormSections } from '@/features/profile/components/ProfileFormSections';
import { ProfileSubmitButton } from '@/features/profile/components/ProfileSubmitButton';
import {
  EMPTY_PROFILE_FORM_VALUES,
  resolveFormValues,
} from '@/features/profile/profile-form-values';
import type { ProfileActionState } from '@/features/profile/types/profile-action-state';

const initialState: ProfileActionState = { ok: true };

/**
 * Onboarding shares the exact profile field set with /profile (one schema,
 * one action contract) but keeps its own submit label, no cancel action and
 * the completion redirect performed by the server action.
 */
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
    <form action={formAction} noValidate>
      <ProfileFormSections values={values} fieldErrors={fieldErrors} />

      <div className="pt-6 md:pt-8">
        {!state.ok && <ProfileActionErrorMessage error={state.error} className="mb-6" />}

        <ProfileSubmitButton
          label="Finish setup"
          pendingLabel="Saving…"
          className="w-full md:w-auto"
        />
      </div>
    </form>
  );
}
