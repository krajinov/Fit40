'use client';

import { PROGRAM_GOAL_LABELS } from '@/features/programs/program-labels';
import { SESSION_MINUTE_OPTIONS } from '@/features/profile/profile-labels';
import type { ProfileFormValues } from '@/features/profile/profile-form-values';
import { WEIGHT_UNITS } from '@/features/profile/schemas/profile-schemas';

interface ProfilePreferenceFieldsProps {
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

const inputClassName =
  'w-full rounded-md border border-input bg-background px-3 py-2 text-sm';

const DAYS_PER_WEEK = [1, 2, 3, 4, 5, 6, 7];

export function ProfilePreferenceFields({ values, fieldErrors }: ProfilePreferenceFieldsProps) {
  return (
    <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
      <div className="space-y-1">
        <label htmlFor="primaryGoal" className="block text-sm font-medium">
          Primary goal
        </label>
        <select
          id="primaryGoal"
          name="primaryGoal"
          defaultValue={values.primaryGoal}
          className={inputClassName}
        >
          <option value="" disabled>
            Select a goal
          </option>
          {Object.entries(PROGRAM_GOAL_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <FieldErrors messages={fieldErrors.primaryGoal} />
      </div>

      <div className="space-y-1">
        <label htmlFor="preferredDaysPerWeek" className="block text-sm font-medium">
          Training days per week
        </label>
        <select
          id="preferredDaysPerWeek"
          name="preferredDaysPerWeek"
          defaultValue={values.preferredDaysPerWeek}
          className={inputClassName}
        >
          {DAYS_PER_WEEK.map((days) => (
            <option key={days} value={days}>
              {days} {days === 1 ? 'day' : 'days'}
            </option>
          ))}
        </select>
        <FieldErrors messages={fieldErrors.preferredDaysPerWeek} />
      </div>

      <div className="space-y-1">
        <label htmlFor="preferredSessionMinutes" className="block text-sm font-medium">
          Session length
        </label>
        <select
          id="preferredSessionMinutes"
          name="preferredSessionMinutes"
          defaultValue={values.preferredSessionMinutes}
          className={inputClassName}
        >
          {SESSION_MINUTE_OPTIONS.map((minutes) => (
            <option key={minutes} value={minutes}>
              {minutes} minutes
            </option>
          ))}
        </select>
        <FieldErrors messages={fieldErrors.preferredSessionMinutes} />
      </div>

      <div className="space-y-1">
        <label htmlFor="heightCm" className="block text-sm font-medium">
          Height in cm <span className="text-muted-foreground">(optional)</span>
        </label>
        <input
          id="heightCm"
          name="heightCm"
          type="text"
          inputMode="numeric"
          placeholder="e.g. 178"
          defaultValue={values.heightCm}
          className={inputClassName}
        />
        <FieldErrors messages={fieldErrors.heightCm} />
      </div>

      <div className="space-y-1 sm:col-span-2">
        <label htmlFor="weightValue" className="block text-sm font-medium">
          Current weight
        </label>
        <div className="flex gap-2">
          <input
            id="weightValue"
            name="weightValue"
            type="text"
            inputMode="decimal"
            placeholder={values.weightUnit === 'lb' ? 'e.g. 176' : 'e.g. 80'}
            defaultValue={values.weightValue}
            className={inputClassName}
          />
          <select
            aria-label="Weight unit"
            name="weightUnit"
            defaultValue={values.weightUnit}
            className="w-24 rounded-md border border-input bg-background px-3 py-2 text-sm"
          >
            {WEIGHT_UNITS.map((unit) => (
              <option key={unit} value={unit}>
                {unit}
              </option>
            ))}
          </select>
        </div>
        <p className="text-xs text-muted-foreground">
          Pounds are converted to kilograms automatically.
        </p>
        <FieldErrors messages={fieldErrors.weight} />
      </div>
    </div>
  );
}
