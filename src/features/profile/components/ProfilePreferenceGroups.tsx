'use client';

import { PHYSICAL_CONSIDERATION_VALUES } from '@/domain/types/exercise';
import { EQUIPMENT_OPTIONS } from '@/features/exercises/exercise-labels';
import { PHYSICAL_CONSIDERATION_LABELS } from '@/features/profile/profile-labels';

interface CheckboxGroupProps {
  readonly name: string;
  readonly legend: string;
  readonly hint?: string;
  readonly options: ReadonlyArray<{ readonly value: string; readonly label: string }>;
  readonly selected: ReadonlyArray<string>;
  readonly errors?: ReadonlyArray<string>;
}

function CheckboxGroup({ name, legend, hint, options, selected, errors }: CheckboxGroupProps) {
  return (
    <fieldset>
      <legend className="block text-sm font-medium">{legend}</legend>
      {hint && <p className="mt-1 text-sm text-muted-foreground">{hint}</p>}
      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
        {options.map((option) => (
          <label
            key={option.value}
            className="flex items-center gap-2 rounded-md border border-input px-3 py-2 text-sm"
          >
            <input
              type="checkbox"
              name={name}
              value={option.value}
              defaultChecked={selected.includes(option.value)}
              className="h-4 w-4"
            />
            {option.label}
          </label>
        ))}
      </div>
      {errors && errors.length > 0 && (
        <ul className="mt-2 list-inside list-disc text-sm text-destructive">
          {errors.map((message) => (
            <li key={message}>{message}</li>
          ))}
        </ul>
      )}
    </fieldset>
  );
}

interface PreferenceGroupsProps {
  readonly availableEquipment: ReadonlyArray<string>;
  readonly physicalConsiderations: ReadonlyArray<string>;
  readonly fieldErrors: Readonly<Record<string, ReadonlyArray<string>>>;
}

export function ProfilePreferenceGroups({
  availableEquipment,
  physicalConsiderations,
  fieldErrors,
}: PreferenceGroupsProps) {
  const considerationOptions = PHYSICAL_CONSIDERATION_VALUES.map((value) => ({
    value,
    label: PHYSICAL_CONSIDERATION_LABELS[value],
  }));

  return (
    <div className="space-y-6">
      <CheckboxGroup
        name="availableEquipment"
        legend="Available equipment"
        hint="Choose everything you can train with. Select at least one."
        options={EQUIPMENT_OPTIONS}
        selected={availableEquipment}
        errors={fieldErrors.availableEquipment}
      />
      <CheckboxGroup
        name="physicalConsiderations"
        legend="Physical considerations"
        hint="Optional. Used to flag exercises that may need caution or alternatives. Leave all unchecked if none apply."
        options={considerationOptions}
        selected={physicalConsiderations}
        errors={fieldErrors.physicalConsiderations}
      />
    </div>
  );
}
