import { SelectableRadioCard } from '@/components/shared/SelectableRadioCard';

import { PROGRAM_GOAL_VALUES } from '@/domain/types/program';
import { EXPERIENCE_LEVEL_VALUES } from '@/domain/types/profile';
import { ProfileFieldErrors } from '@/features/profile/components/ProfileFieldErrors';
import { ProfileSegmentedRadios } from '@/features/profile/components/ProfileSegmentedRadios';
import type { ProfileFormValues } from '@/features/profile/profile-form-values';
import {
  EXPERIENCE_LEVEL_LABELS,
  SESSION_MINUTE_OPTIONS,
  formatSessionMinutes,
} from '@/features/profile/profile-labels';
import { PROGRAM_GOAL_LABELS } from '@/features/programs/program-labels';

interface ProfileTrainingFieldsProps {
  readonly values: ProfileFormValues;
  readonly fieldErrors: Readonly<Record<string, ReadonlyArray<string>>>;
}

const DAYS_PER_WEEK = [1, 2, 3, 4, 5, 6, 7] as const;

/**
 * Training section fields (locked design): experience as stacked radio cards,
 * primary goal as a two-column radio-card grid (odd last option spans full
 * width), days/session as compact segmented radios. All native inputs.
 */
export function ProfileTrainingFields({ values, fieldErrors }: ProfileTrainingFieldsProps) {
  const experienceErrors = fieldErrors.experienceLevel;
  const goalErrors = fieldErrors.primaryGoal;

  return (
    <div className="space-y-6 md:space-y-7">
      <fieldset
        aria-describedby={
          experienceErrors !== undefined && experienceErrors.length > 0
            ? 'experienceLevel-error'
            : undefined
        }
      >
        <legend className="mb-3 block text-sm font-medium text-foreground">
          Training experience
        </legend>
        <div className="space-y-3">
          {EXPERIENCE_LEVEL_VALUES.map((level) => (
            <SelectableRadioCard
              key={level}
              name="experienceLevel"
              value={level}
              label={EXPERIENCE_LEVEL_LABELS[level]}
              defaultChecked={values.experienceLevel === level}
            />
          ))}
        </div>
        <ProfileFieldErrors id="experienceLevel-error" messages={experienceErrors} />
      </fieldset>

      <fieldset
        aria-describedby={
          goalErrors !== undefined && goalErrors.length > 0 ? 'primaryGoal-error' : undefined
        }
      >
        <legend className="mb-3 block text-sm font-medium text-foreground">Primary goal</legend>
        <div className="grid grid-cols-2 gap-2.5 md:gap-3">
          {PROGRAM_GOAL_VALUES.map((goal, index) => {
            const spansFullWidth =
              index === PROGRAM_GOAL_VALUES.length - 1 && PROGRAM_GOAL_VALUES.length % 2 === 1;
            return (
              <SelectableRadioCard
                key={goal}
                name="primaryGoal"
                value={goal}
                label={PROGRAM_GOAL_LABELS[goal]}
                defaultChecked={values.primaryGoal === goal}
                className={spansFullWidth ? 'col-span-2' : undefined}
              />
            );
          })}
        </div>
        <ProfileFieldErrors id="primaryGoal-error" messages={goalErrors} />
      </fieldset>

      <ProfileSegmentedRadios
        name="preferredDaysPerWeek"
        legend="Training days per week"
        defaultValue={values.preferredDaysPerWeek}
        options={DAYS_PER_WEEK.map((days) => ({ value: String(days), label: String(days) }))}
        errors={fieldErrors.preferredDaysPerWeek}
      />

      <ProfileSegmentedRadios
        name="preferredSessionMinutes"
        legend="Session length"
        defaultValue={values.preferredSessionMinutes}
        options={SESSION_MINUTE_OPTIONS.map((minutes) => ({
          value: String(minutes),
          label: formatSessionMinutes(minutes),
        }))}
        errors={fieldErrors.preferredSessionMinutes}
      />
    </div>
  );
}
