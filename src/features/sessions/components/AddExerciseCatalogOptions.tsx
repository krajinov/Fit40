import type { ExerciseSummaryDto } from '@/application/dto/exercise';
import { SelectableRadioCard } from '@/components/shared/SelectableRadioCard';

import { formatAddableExerciseMeta } from '@/features/sessions/add-exercise-views';

interface AddExerciseCatalogOptionsProps {
  /** The catalog entries currently displayed (already filtered for display). */
  readonly exercises: ReadonlyArray<ExerciseSummaryDto>;
  /** Honest empty-state copy chosen by the caller (empty catalog vs no match). */
  readonly emptyLabel: string;
  /** The Add draft's selected exercise id (`null` = nothing selected). */
  readonly selectedExerciseId: string | null;
  /** Records the user's explicit selection in the parent-owned Add draft. */
  readonly onSelectExercise: (exerciseId: string) => void;
}

/**
 * Form-field name of the VISIBLE catalog card radio group.
 *
 * Deliberately NOT `exerciseId`: the cards are selection UI only, and a radio
 * disappears from FormData the moment search filters it out of the list (native
 * serialization only reads mounted successful controls). The authoritative
 * `exerciseId` is serialized exactly once by the panel's draft-owned hidden
 * input (PR #14 review finding), so the visible group carries its own
 * display-only name to keep native radio semantics — one tab stop, arrow-key
 * navigation — without ever creating a second `exerciseId` entry. The Server
 * Action's Zod schema never reads this field.
 */
export const ADD_EXERCISE_CATALOG_GROUP_NAME = 'catalogExerciseId';

/**
 * The catalog options of the Add Exercise picker: one native radio card per
 * displayed exercise. Presentational only — the caller owns the search/filter
 * state, the SELECTION (the parent-owned Add draft's `selectedExerciseId`) and
 * the form action, so choosing an option records draft state and never triggers
 * a client-side mutation.
 *
 * The radios are CONTROLLED and are NOT the serialization source (PR #14 review
 * findings): React 19 resets a form's DOM after its action resolves — including
 * error resolutions — so an uncontrolled selection would be wiped by a failed
 * submit, and a filtered-out selected card is unmounted entirely. The draft is
 * the single source of truth for both the visible selection and the submitted
 * `exerciseId`. Nothing is preselected: the user must explicitly choose. The
 * group is not `required`, because the authoritative validation (exercise
 * selected? known?) is the server-side Zod schema.
 */
export function AddExerciseCatalogOptions({
  exercises,
  emptyLabel,
  selectedExerciseId,
  onSelectExercise,
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
            name={ADD_EXERCISE_CATALOG_GROUP_NAME}
            value={exercise.id}
            label={exercise.name}
            hint={formatAddableExerciseMeta(exercise)}
            checked={selectedExerciseId === exercise.id}
            onChange={() => onSelectExercise(exercise.id)}
          />
        ))}
      </div>
    </fieldset>
  );
}
