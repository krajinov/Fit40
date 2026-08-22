/**
 * Data transfer objects for exercise data crossing layer boundaries.
 *
 * DTOs are plain, serializable shapes. Branded IDs are stripped to plain strings.
 */

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