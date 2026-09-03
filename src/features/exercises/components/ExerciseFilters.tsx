'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';

import { Chip } from '@/components/shared/Chip';
import { Button } from '@/components/ui/button';
import {
  DIFFICULTY_OPTIONS,
  EQUIPMENT_OPTIONS,
  MUSCLE_GROUP_OPTIONS,
} from '@/features/exercises/exercise-labels';

type FilterParam = 'equipment' | 'muscle' | 'difficulty';

function buildUpdatedSearchParams(
  current: URLSearchParams,
  group: FilterParam,
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
  readonly param: FilterParam;
  readonly options: ReadonlyArray<{ readonly value: string; readonly label: string }>;
  readonly selected: string[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function handleCheckedChange(value: string, checked: boolean) {
    const next = buildUpdatedSearchParams(
      new URLSearchParams(searchParams),
      param,
      value,
      checked,
    );

    router.replace(`${pathname}?${next.toString()}`);
  }

  return (
    <fieldset className="min-w-0">
      <legend className="mb-3 text-sm font-semibold text-foreground">{title}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => (
          <Chip
            key={option.value}
            name={param}
            value={option.value}
            label={option.label}
            checked={selected.includes(option.value)}
            onCheckedChange={(checked) => handleCheckedChange(option.value, checked)}
          />
        ))}
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
    <section
      aria-label="Exercise filters"
      className="rounded-card border border-border bg-card p-5 md:p-6"
    >
      <div className="flex flex-col gap-5 md:grid md:grid-cols-3 md:gap-6">
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
        <div className="mt-5 border-t border-border pt-4 md:mt-6">
          <Button type="button" variant="outline" size="sm" onClick={clearFilters}>
            Clear filters
          </Button>
        </div>
      )}
    </section>
  );
}