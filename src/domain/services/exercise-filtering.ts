/**
 * Pure domain service for filtering the exercise catalog.
 *
 * Filtering logic lives here so it is deterministic, testable, and independent
 * of React or the data source.
 */

import type { Exercise } from '@/domain/entities/exercise';
import type { ExerciseFilterCriteria } from '@/domain/types/exercise';

function matchesEquipment(exercise: Exercise, equipment: ReadonlyArray<string>): boolean {
  if (equipment.length === 0) return true;
  return equipment.includes(exercise.equipment);
}

function matchesMuscleGroups(
  exercise: Exercise,
  muscleGroups: ReadonlyArray<string>,
): boolean {
  if (muscleGroups.length === 0) return true;
  return (
    muscleGroups.includes(exercise.primaryMuscle) ||
    exercise.secondaryMuscles.some((muscle) => muscleGroups.includes(muscle))
  );
}

function matchesDifficulty(exercise: Exercise, difficulties: ReadonlyArray<string>): boolean {
  if (difficulties.length === 0) return true;
  return difficulties.includes(exercise.difficulty);
}

/**
 * Returns a new array containing only exercises that match the given criteria.
 *
 * - Empty arrays mean "no filter" for that dimension.
 * - Values within a dimension are OR-ed.
 * - Dimensions are AND-ed.
 * - Primary and secondary muscle groups are both considered when matching muscle groups.
 * - The input array is never mutated.
 */
export function filterExercises(
  exercises: ReadonlyArray<Exercise>,
  criteria: ExerciseFilterCriteria,
): ReadonlyArray<Exercise> {
  return exercises.filter(
    (exercise) =>
      matchesEquipment(exercise, criteria.equipment) &&
      matchesMuscleGroups(exercise, criteria.muscleGroups) &&
      matchesDifficulty(exercise, criteria.difficulties),
  );
}