'use client';

import { EXPERIENCE_LEVEL_VALUES } from '@/domain/types/profile';
import { EXPERIENCE_LEVEL_LABELS } from '@/features/profile/profile-labels';
import type { ProfileFormValues } from '@/features/profile/profile-form-values';
import { ProfilePreferenceFields } from '@/features/profile/components/ProfilePreferenceFields';

interface ProfileFormFieldsProps {
  readonly values: ProfileFormValues;
  readonly fieldErrors: Readonly<Record<string, ReadonlyArray<string>>>;
}

function FieldErrors({ messages }: { readonly messages?: ReadonlyArray<string> }) {
  if (!messages || messages.length === 0) return null;
  return (
    <ul className="mt-1 list-inside list-disc text-sm text-destructive">
      {messages.map((message) => (
        <li key={message}>{message}</li>
      ))}
    </ul>
  );
}

export function ProfileFormFields({ values, fieldErrors }: ProfileFormFieldsProps) {
  return (
    <div className="space-y-5">
      <div className="space-y-1">
        <label htmlFor="birthYear" className="block text-sm font-medium">
          Birth year
        </label>
        <input
          id="birthYear"
          name="birthYear"
          type="text"
          inputMode="numeric"
          autoComplete="bday-year"
          placeholder="e.g. 1980"
          defaultValue={values.birthYear}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
        />
        <FieldErrors messages={fieldErrors.birthYear} />
      </div>

      <fieldset>
        <legend className="block text-sm font-medium">Training experience</legend>
        <div className="mt-3 space-y-2">
          {EXPERIENCE_LEVEL_VALUES.map((level) => (
            <label
              key={level}
              className="flex items-center gap-2 rounded-md border border-input px-3 py-2 text-sm"
            >
              <input
                type="radio"
                name="experienceLevel"
                value={level}
                defaultChecked={values.experienceLevel === level}
                className="h-4 w-4"
              />
              {EXPERIENCE_LEVEL_LABELS[level]}
            </label>
          ))}
        </div>
        <FieldErrors messages={fieldErrors.experienceLevel} />
      </fieldset>

      <ProfilePreferenceFields values={values} fieldErrors={fieldErrors} />
    </div>
  );
}
