/**
 * PURE presentation helpers for the M11 "Add exercise" picker.
 *
 * The picker lists the EXISTING exercise catalog (resolved server-side from
 * the Active Workout's single catalog read) and filters it for DISPLAY only:
 * filtering never mutates server state, never changes the selection semantics
 * and never scores or recommends exercises. Exercises already present in the
 * session remain listed — duplicates are valid occurrences.
 */

import type { ExerciseSummaryDto } from '@/application/dto/exercise';
import {
  EQUIPMENT_LABELS,
  MUSCLE_GROUP_LABELS,
} from '@/features/exercises/exercise-labels';

/** Disclosure summary of the Add panel. */
export const ADD_EXERCISE_LABEL = 'Add exercise';

/** Submit label of the Add form (explicit user action, never automatic). */
export const ADD_EXERCISE_SUBMIT_LABEL = 'Add to workout';

/** Honest empty state when the search matches nothing. */
export const ADD_EXERCISE_EMPTY_LABEL = 'No exercises match your search.';

/** Honest empty state when the catalog itself is empty. */
export const ADD_EXERCISE_NO_CATALOG_LABEL = 'The exercise catalog is unavailable right now.';

/** Muted meta line of one catalog option (mirrors the swap-candidate meta). */
export function formatAddableExerciseMeta(exercise: ExerciseSummaryDto): string {
  return `${EQUIPMENT_LABELS[exercise.equipment]} · ${MUSCLE_GROUP_LABELS[exercise.primaryMuscle]}`;
}

/**
 * Filters the addable catalog by a free-text query over the exercise name and
 * its meta line (equipment + primary muscle). An empty/whitespace query
 * returns the catalog unchanged, preserving the repository's order.
 */
export function filterAddableExercises(
  exercises: ReadonlyArray<ExerciseSummaryDto>,
  query: string,
): ReadonlyArray<ExerciseSummaryDto> {
  const normalized = query.trim().toLowerCase();
  if (normalized.length === 0) {
    return exercises;
  }
  return exercises.filter((exercise) =>
    `${exercise.name} ${formatAddableExerciseMeta(exercise)}`.toLowerCase().includes(normalized),
  );
}
