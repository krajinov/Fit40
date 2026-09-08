/**
 * Data transfer objects for exercise data crossing layer boundaries.
 *
 * DTOs are plain, serializable shapes. Branded IDs are stripped to plain strings.
 */

import type { NextExerciseTarget } from '@/domain/services/exercise-progression';
import type { Exercise } from '@/domain/entities/exercise';
import type {
  Difficulty,
  EquipmentType,
  MovementPattern,
  MuscleGroup,
  PhysicalConsideration,
  SuitabilityLevel,
} from '@/domain/types/exercise';

/**
 * Exercise data shown in the catalog list view.
 */
export interface ExerciseSummaryDto {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly primaryMuscle: MuscleGroup;
  readonly equipment: EquipmentType;
  readonly difficulty: Difficulty;
  readonly movementPattern: MovementPattern;
}

/**
 * Maps one catalog exercise to its presentation-neutral summary shape.
 * Exported for the batched ids lookup (GetExercisesByIds), which composes
 * the same summary without duplicating the field projection.
 */
export function toExerciseSummaryDto(exercise: Exercise): ExerciseSummaryDto {
  return {
    id: exercise.id,
    name: exercise.name,
    slug: exercise.slug,
    primaryMuscle: exercise.primaryMuscle,
    equipment: exercise.equipment,
    difficulty: exercise.difficulty,
    movementPattern: exercise.movementPattern,
  };
}

/**
 * Single consideration guidance attached to an exercise.
 */
export interface ExerciseConsiderationDto {
  readonly consideration: PhysicalConsideration;
  readonly level: SuitabilityLevel;
}

/**
 * Exercise data shown in the detail view.
 */
export interface ExerciseDetailDto {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly description: string;
  readonly primaryMuscle: MuscleGroup;
  readonly secondaryMuscles: ReadonlyArray<MuscleGroup>;
  readonly equipment: EquipmentType;
  readonly difficulty: Difficulty;
  readonly movementPattern: MovementPattern;
  readonly considerations: ReadonlyArray<ExerciseConsiderationDto>;
}

/**
 * Next-workout load recommendation for one requested exercise, computed by
 * the progressive overload engine.
 *
 * `exerciseId` mirrors the corresponding request entry (brand stripped), so
 * callers can zip requests and results by position. `target` is the engine's
 * serializable decision; its `basis` states why the load was chosen.
 *
 * `previousSets` carries the considered sets (the first `prescription.sets`
 * logged sets) of the newest history occurrence, so presentation can render
 * truthful "Last time" context — e.g. "Last time · 60 kg × 10, 10, 10". It is
 * null when the engine had no comparable newest occurrence (no history at
 * all, or history earned under a different prescription): no context is
 * fabricated then. RPE is not part of this projection — recommendations
 * never read it.
 */
export interface ExerciseTargetDto {
  readonly exerciseId: string;
  readonly target: NextExerciseTarget;
  readonly previousSets: ReadonlyArray<PreviousExerciseSetDto> | null;
}

/** One considered set of the previous occurrence, for "Last time" context. */
export type PreviousExerciseSetDto =
  | {
      readonly type: 'reps';
      readonly reps: number;
      readonly weightKg: number | null;
    }
  | {
      readonly type: 'duration';
      readonly durationSeconds: number;
      readonly weightKg: number | null;
    };