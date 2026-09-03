import { Chip } from '@/components/shared/Chip';
import { SectionCard } from '@/components/shared/SectionCard';

import { PHYSICAL_CONSIDERATION_VALUES } from '@/domain/types/exercise';
import { EQUIPMENT_OPTIONS } from '@/features/exercises/exercise-labels';
import { ProfileFieldErrors } from '@/features/profile/components/ProfileFieldErrors';
import type { ProfileFormValues } from '@/features/profile/profile-form-values';
import { PHYSICAL_CONSIDERATION_LABELS } from '@/features/profile/profile-labels';
import { ProfileTrainingFields } from '@/features/profile/components/ProfileTrainingFields';
import { ProfileUnitInput } from '@/features/profile/components/ProfileUnitInput';
import { ProfileWeightField } from '@/features/profile/components/ProfileWeightField';

interface ProfileFormSectionsProps {
  readonly values: ProfileFormValues;
  readonly fieldErrors: Readonly<Record<string, ReadonlyArray<string>>>;
}

const CARD_CLASS = 'scroll-mt-24 p-5 md:scroll-mt-28 md:p-8';

/**
 * The five locked profile sections (01 Personal details ... 05 Considerations)
 * as SectionCards. Rendered INSIDE the owning <form> so every native control
 * participates in one submission. Shared by /profile and /onboarding.
 */
export function ProfileFormSections({ values, fieldErrors }: ProfileFormSectionsProps) {
  const equipmentErrors = fieldErrors.availableEquipment;
  const considerationErrors = fieldErrors.physicalConsiderations;

  return (
    <div className="space-y-5 md:space-y-6">
      <SectionCard
        id="personal"
        eyebrow="01 · PERSONAL DETAILS"
        title="Personal details"
        className={CARD_CLASS}
      >
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:gap-6">
          <ProfileUnitInput
            id="birthYear"
            name="birthYear"
            label="Birth year"
            defaultValue={values.birthYear}
            placeholder="e.g. 1980"
            inputMode="numeric"
            autoComplete="bday-year"
            errors={fieldErrors.birthYear}
            className="md:w-[280px]"
          />
          <p className="hidden max-w-[400px] text-sm text-ink-3 md:block">
            Your age shapes training intensity and recovery guidance.
          </p>
        </div>
      </SectionCard>

      <SectionCard id="training" eyebrow="02 · TRAINING" title="Training" className={CARD_CLASS}>
        <ProfileTrainingFields values={values} fieldErrors={fieldErrors} />
      </SectionCard>

      <SectionCard
        id="body-metrics"
        eyebrow="03 · BODY METRICS"
        title="Body metrics"
        className={CARD_CLASS}
      >
        {/*
          Responsive body-metrics grid: mobile stacks Height above a
          field+unit row (unit bottom-aligned with the input); desktop uses
          the locked 280/280/180 columns with top-aligned labels. The unit
          cell is the single weightUnit radio group from ProfileWeightField.
        */}
        <div className="grid grid-cols-[1fr_120px] items-end gap-4 md:grid-cols-[minmax(0,280px)_minmax(0,280px)_minmax(0,180px)] md:items-start md:gap-6">
          <ProfileUnitInput
            id="heightCm"
            name="heightCm"
            label="Height"
            optional
            unit="cm"
            defaultValue={values.heightCm}
            placeholder="e.g. 178"
            inputMode="numeric"
            errors={fieldErrors.heightCm}
            className="col-span-2 md:col-span-1"
          />
          <ProfileWeightField
            weightValue={values.weightValue}
            weightUnit={values.weightUnit}
            errors={fieldErrors.weight}
          />
        </div>
        <p className="mt-4 text-[13px] text-ink-3 md:text-sm">
          Pounds are converted to kilograms automatically.
        </p>
      </SectionCard>

      <SectionCard
        id="equipment"
        eyebrow="04 · EQUIPMENT"
        title="Equipment"
        className={CARD_CLASS}
      >
        <fieldset
          aria-describedby={
            equipmentErrors !== undefined && equipmentErrors.length > 0
              ? 'availableEquipment-error'
              : undefined
          }
        >
          <legend className="sr-only">Available equipment</legend>
          <p className="text-[13px] text-ink-3 md:text-sm">
            <span className="md:hidden">Programs only use what you have. Pick at least one.</span>
            <span className="hidden md:inline">
              Select everything you can train with — programs only use what you have. Pick at
              least one.
            </span>
          </p>
          <div className="mt-4 flex flex-wrap gap-2.5 md:gap-3">
            {EQUIPMENT_OPTIONS.map((option) => (
              <Chip
                key={option.value}
                name="availableEquipment"
                value={option.value}
                label={option.label}
                defaultChecked={values.availableEquipment.includes(option.value)}
              />
            ))}
          </div>
          <ProfileFieldErrors id="availableEquipment-error" messages={equipmentErrors} />
        </fieldset>
      </SectionCard>

      <SectionCard
        id="considerations"
        eyebrow="05 · CONSIDERATIONS"
        title="Considerations"
        className={CARD_CLASS}
      >
        <fieldset
          aria-describedby={
            considerationErrors !== undefined && considerationErrors.length > 0
              ? 'physicalConsiderations-error'
              : undefined
          }
        >
          <legend className="sr-only">Physical considerations</legend>
          <p className="text-[13px] text-ink-3 md:text-sm">
            Optional. Exercises that may need caution or a safer alternative get flagged for you.
          </p>
          <div className="mt-4 flex flex-wrap gap-2.5 md:gap-3">
            {PHYSICAL_CONSIDERATION_VALUES.map((value) => (
              <Chip
                key={value}
                name="physicalConsiderations"
                value={value}
                label={PHYSICAL_CONSIDERATION_LABELS[value]}
                defaultChecked={values.physicalConsiderations.includes(value)}
              />
            ))}
          </div>
          <ProfileFieldErrors id="physicalConsiderations-error" messages={considerationErrors} />
        </fieldset>
      </SectionCard>
    </div>
  );
}
