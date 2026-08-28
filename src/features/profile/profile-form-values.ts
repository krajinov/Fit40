/**
 * View-model helpers for the profile forms.
 *
 * The forms are rendered from plain string values so the same field markup
 * works for onboarding (empty defaults) and editing (profile-derived
 * defaults). After an expected action error, the echoed submitted values from
 * the action state take precedence so the user's input is preserved.
 */

import type { UserProfileDto } from '@/application/dto/user-profile';

import type { ProfileActionState } from './types/profile-action-state';

export interface ProfileFormValues {
  readonly birthYear: string;
  readonly experienceLevel: string;
  readonly primaryGoal: string;
  readonly availableEquipment: ReadonlyArray<string>;
  readonly physicalConsiderations: ReadonlyArray<string>;
  readonly preferredDaysPerWeek: string;
  readonly preferredSessionMinutes: string;
  readonly heightCm: string;
  readonly weightValue: string;
  readonly weightUnit: string;
}

export const EMPTY_PROFILE_FORM_VALUES: ProfileFormValues = {
  birthYear: '',
  experienceLevel: '',
  primaryGoal: '',
  availableEquipment: [],
  physicalConsiderations: [],
  preferredDaysPerWeek: '3',
  preferredSessionMinutes: '60',
  heightCm: '',
  weightValue: '',
  weightUnit: 'kg',
};

export function profileToFormValues(profile: UserProfileDto): ProfileFormValues {
  return {
    birthYear: String(profile.birthYear),
    experienceLevel: profile.experienceLevel,
    primaryGoal: profile.primaryGoal,
    availableEquipment: [...profile.availableEquipment],
    physicalConsiderations: [...profile.physicalConsiderations],
    preferredDaysPerWeek: String(profile.preferredDaysPerWeek),
    preferredSessionMinutes: String(profile.preferredSessionMinutes),
    heightCm: profile.heightCm === null ? '' : String(profile.heightCm),
    // Weight is always stored canonically in kilograms; the unit selector is
    // a presentation-only input convenience and resets to kg between edits.
    weightValue: String(profile.weightKg),
    weightUnit: 'kg',
  };
}

/**
 * Returns the echoed submitted values when the last action failed with
 * expected errors, otherwise the provided defaults.
 */
export function resolveFormValues(
  state: ProfileActionState,
  fallback: ProfileFormValues,
): ProfileFormValues {
  if (state.ok || state.values === undefined) {
    return fallback;
  }

  return state.values;
}
