import type { ExerciseSummaryDto } from '@/application/dto/exercise';
import { SelectableRadioCard } from '@/components/shared/SelectableRadioCard';

import { formatAddableExerciseMeta } from '@/features/sessions/add-exercise-views';

interface AddExerciseCatalogOptionsProps {
  /** The catalog entries currently displayed (already filtered for display). */
  readonly exercises: ReadonlyArray<ExerciseSummaryDto>;
  /** Honest empty-state copy chosen by the caller (empty catalog vs no match). */
  readonly emptyLabel: string;
}

/**
 * The catalog options of the Add Exercise picker: one native radio card per
 * displayed exercise, posting its stable `exerciseId`. Presentational only —
 * the caller owns the search/filter state and the form action, so selecting an
 * option is an ordinary native radio submission and never a client-side
 * mutation. Nothing is preselected: the user must explicitly choose.
 *
 * The radios are intentionally uncontrolled, exactly like the M9 swap
 * picker's: the authoritative validation (exercise selected? known?) is the
 * server-side Zod schema, and a native `required` flag would only duplicate it.
 */
export function AddExerciseCatalogOptions({
  exercises,
  emptyLabel,
}: AddExerciseCatalogOptionsProps) {
  if (exercises.length === 0) {
    return <p className="text-[13px] text-ink-3">{emptyLabel}</p>;
  }

  return (
    <fieldset>
      <legend className="sr-only">Exercise</legend>
      <div className="flex max-h-72 flex-col gap-2 overflow-y-auto pr-1">
        {exercises.map((exercise) => (
          <SelectableRadioCard
            key={exercise.id}
            name="exerciseId"
            value={exercise.id}
            label={exercise.name}
            hint={formatAddableExerciseMeta(exercise)}
          />
        ))}
      </div>
    </fieldset>
  );
}
