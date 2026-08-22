/**
 * Exercise entity and factory.
 *
 * Exercises are immutable reference data used to build training programs.
 * Invariants are enforced at construction via createExercise.
 */

import { err, ok, type Result } from '@/lib/result';

import type { ExerciseId } from '@/domain/types/ids';
import {
  createExerciseId,
} from '@/domain/types/ids';
import type {
  Difficulty,
  EquipmentType,
  MovementPattern,
  MuscleGroup,
  PhysicalConsideration,
  SuitabilityLevel,
} from '@/domain/types/exercise';

/**
 * Guidance for a single physical consideration.
 * Only caution/unsuitable guidance is typically stored; absence means suitable.
 */
export interface ConsiderationGuidance {
  readonly consideration: PhysicalConsideration;
  readonly level: SuitabilityLevel;
}

/**
 * Input accepted by the createExercise factory.
 */
export interface CreateExerciseInput {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly description: string;
  readonly primaryMuscle: MuscleGroup;
  readonly secondaryMuscles: ReadonlyArray<MuscleGroup>;
  readonly equipment: EquipmentType;
  readonly difficulty: Difficulty;
  readonly movementPattern: MovementPattern;
  readonly considerations: ReadonlyArray<ConsiderationGuidance>;
}

/**
 * An Exercise definition.
 */
export interface Exercise {
  readonly id: ExerciseId;
  readonly name: string;
  readonly slug: string;
  readonly description: string;
  readonly primaryMuscle: MuscleGroup;
  readonly secondaryMuscles: ReadonlyArray<MuscleGroup>;
  readonly equipment: EquipmentType;
  readonly difficulty: Difficulty;
  readonly movementPattern: MovementPattern;
  readonly considerations: ReadonlyArray<ConsiderationGuidance>;
}

export interface ExerciseValidationError {
  readonly code: 'INVALID_EXERCISE';
  readonly message: string;
  readonly field?: string;
}

function exerciseValidationError(
  message: string,
  field?: string,
): ExerciseValidationError {
  return { code: 'INVALID_EXERCISE', message, field };
}

const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/**
 * Creates a validated Exercise.
 *
 * Returns an error if any invariant is violated:
 * - id/name/slug/description must be non-empty
 * - slug must be kebab-case
 * - primaryMuscle must not appear in secondaryMuscles
 * - secondaryMuscles must not contain duplicates
 * - considerations must not contain duplicate considerations
 */
export function createExercise(
  input: CreateExerciseInput,
): Result<Exercise, ExerciseValidationError> {
  const name = input.name.trim();
  const slug = input.slug.trim();
  const description = input.description.trim();

  if (input.id.trim().length === 0) {
    return err(exerciseValidationError('id is required', 'id'));
  }

  if (name.length === 0) {
    return err(exerciseValidationError('name is required', 'name'));
  }

  if (slug.length === 0) {
    return err(exerciseValidationError('slug is required', 'slug'));
  }

  if (!SLUG_PATTERN.test(slug)) {
    return err(
      exerciseValidationError(
        'slug must be kebab-case and contain only lowercase letters, numbers, and hyphens',
        'slug',
      ),
    );
  }

  if (description.length === 0) {
    return err(exerciseValidationError('description is required', 'description'));
  }

  if (input.secondaryMuscles.includes(input.primaryMuscle)) {
    return err(
      exerciseValidationError(
        'primaryMuscle must not also appear in secondaryMuscles',
        'secondaryMuscles',
      ),
    );
  }

  const uniqueSecondary = new Set(input.secondaryMuscles);
  if (uniqueSecondary.size !== input.secondaryMuscles.length) {
    return err(
      exerciseValidationError('secondaryMuscles must not contain duplicates', 'secondaryMuscles'),
    );
  }

  const uniqueConsiderations = new Set(input.considerations.map((c) => c.consideration));
  if (uniqueConsiderations.size !== input.considerations.length) {
    return err(
      exerciseValidationError('considerations must not contain duplicates', 'considerations'),
    );
  }

  const idResult = createExerciseId(input.id);
  if (!idResult.ok) {
    return err(exerciseValidationError(idResult.error.message, 'id'));
  }

  const exercise: Exercise = {
    id: idResult.data,
    name,
    slug,
    description,
    primaryMuscle: input.primaryMuscle,
    secondaryMuscles: input.secondaryMuscles,
    equipment: input.equipment,
    difficulty: input.difficulty,
    movementPattern: input.movementPattern,
    considerations: input.considerations,
  };

  return ok(exercise);
}