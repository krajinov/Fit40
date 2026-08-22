'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';

import { Button } from '@/components/ui/button';
import {
  DIFFICULTY_OPTIONS,
  EQUIPMENT_OPTIONS,
  MUSCLE_GROUP_OPTIONS,
} from '@/features/exercises/exercise-labels';

function buildUpdatedSearchParams(
  current: URLSearchParams,
  group: 'equipment' | 'muscle' | 'difficulty',
  value: string,
  checked: boolean,
): URLSearchParams {
  const next = new URLSearchParams(current);

  const existing = next.getAll(group);
  next.delete(group);

  const updated = checked
    ? [...existing, value]
    : existing.filter((item) => item !== value);

  for (const item of updated) {
    next.append(group, item);
  }

  return next;
}

function FilterGroup({
  title,
  param,
  options,
  selected,
}: {
  readonly title: string;
  readonly param: 'equipment' | 'muscle' | 'difficulty';
  readonly options: { readonly value: string; readonly label: string }[];
  readonly selected: string[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function handleChange(value: string, checked: boolean) {
    const next = buildUpdatedSearchParams(
      new URLSearchParams(searchParams),
      param,
      value,
      checked,
    );

    router.replace(`${pathname}?${next.toString()}`);
  }

  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium text-foreground">{title}</legend>
      <div className="flex flex-col gap-1.5">
        {options.map((option) => {
          const inputId = `${param}-${option.value}`;
          const isChecked = selected.includes(option.value);

          return (
            <label
              key={option.value}
              htmlFor={inputId}
              className="flex cursor-pointer items-center gap-2 rounded-md py-1 pr-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              <input
                id={inputId}
                type="checkbox"
                value={option.value}
                checked={isChecked}
                onChange={(event) => handleChange(option.value, event.target.checked)}
                className="size-4 rounded border-border text-primary accent-primary focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              />
              <span>{option.label}</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

export function ExerciseFilters() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const selectedEquipment = searchParams.getAll('equipment');
  const selectedMuscle = searchParams.getAll('muscle');
  const selectedDifficulty = searchParams.getAll('difficulty');

  const hasFilters =
    selectedEquipment.length > 0 ||
    selectedMuscle.length > 0 ||
    selectedDifficulty.length > 0;

  function clearFilters() {
    router.replace(pathname);
  }

  return (
    <section aria-label="Exercise filters" className="space-y-4">
      <div className="grid gap-6 sm:grid-cols-3">
        <FilterGroup
          title="Equipment"
          param="equipment"
          options={EQUIPMENT_OPTIONS}
          selected={selectedEquipment}
        />
        <FilterGroup
          title="Muscle group"
          param="muscle"
          options={MUSCLE_GROUP_OPTIONS}
          selected={selectedMuscle}
        />
        <FilterGroup
          title="Difficulty"
          param="difficulty"
          options={DIFFICULTY_OPTIONS}
          selected={selectedDifficulty}
        />
      </div>
      {hasFilters && (
        <Button type="button" variant="outline" size="sm" onClick={clearFilters}>
          Clear filters
        </Button>
      )}
    </section>
  );
}