/**
 * Workout template entity and factory.
 *
 * A Workout is a reusable definition (name, exercises, prescription) that can be
 * scheduled multiple times inside a program. It is part of the TrainingProgram
 * aggregate; there is no standalone Workout repository in this slice.
 */

import { err, ok, type Result } from '@/domain/types/result';

import type { ExerciseId } from '@/domain/types/ids';
import { createWorkoutId, type WorkoutId } from '@/domain/types/ids';
import type { RepPrescription } from '@/domain/value-objects/rep-prescription';

export interface WorkoutExercise {
  readonly exerciseId: ExerciseId;
  readonly order: number;
  readonly prescription: RepPrescription;
  readonly restSeconds: number;
  readonly notes: string | null;
}

export interface Workout {
  readonly id: WorkoutId;
  readonly name: string;
  readonly slug: string;
  readonly description: string;
  readonly estimatedDurationMinutes: number;
  readonly exercises: ReadonlyArray<WorkoutExercise>;
}

export interface CreateWorkoutInput {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly description: string;
  readonly estimatedDurationMinutes: number;
  readonly exercises: ReadonlyArray<{
    readonly exerciseId: ExerciseId;
    readonly order: number;
    readonly prescription: RepPrescription;
    readonly restSeconds: number;
    readonly notes?: string | null;
  }>;
}

export interface WorkoutValidationError {
  readonly code: 'INVALID_WORKOUT';
  readonly message: string;
  readonly field?: string;
}

function workoutValidationError(message: string, field?: string): WorkoutValidationError {
  return { code: 'INVALID_WORKOUT', message, field };
}

const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export function createWorkout(input: CreateWorkoutInput): Result<Workout, WorkoutValidationError> {
  const name = input.name.trim();
  const slug = input.slug.trim();
  const description = input.description.trim();

  if (input.id.trim().length === 0) {
    return err(workoutValidationError('id is required', 'id'));
  }

  if (name.length === 0) {
    return err(workoutValidationError('name is required', 'name'));
  }

  if (slug.length === 0) {
    return err(workoutValidationError('slug is required', 'slug'));
  }

  if (!SLUG_PATTERN.test(slug)) {
    return err(
      workoutValidationError(
        'slug must be kebab-case and contain only lowercase letters, numbers, and hyphens',
        'slug',
      ),
    );
  }

  if (description.length === 0) {
    return err(workoutValidationError('description is required', 'description'));
  }

  if (!Number.isInteger(input.estimatedDurationMinutes) || input.estimatedDurationMinutes <= 0) {
    return err(
      workoutValidationError('estimatedDurationMinutes must be a positive integer', 'estimatedDurationMinutes'),
    );
  }

  if (input.exercises.length === 0) {
    return err(workoutValidationError('workout must contain at least one exercise', 'exercises'));
  }

  const expectedOrders = Array.from({ length: input.exercises.length }, (_, index) => index + 1);
  const actualOrders = input.exercises.map((exercise) => exercise.order).sort((a, b) => a - b);
  const ordersValid =
    expectedOrders.length === actualOrders.length &&
    expectedOrders.every((value, index) => value === actualOrders[index]);

  if (!ordersValid) {
    return err(
      workoutValidationError(
        'exercise orders must be unique and sequential starting at 1',
        'exercises',
      ),
    );
  }

  for (const exercise of input.exercises) {
    if (exercise.restSeconds < 0) {
      return err(workoutValidationError('restSeconds cannot be negative', 'exercises'));
    }
  }

  const idResult = createWorkoutId(input.id);
  if (!idResult.ok) {
    return err(workoutValidationError(idResult.error.message, 'id'));
  }

  const exercises: ReadonlyArray<WorkoutExercise> = input.exercises.map((exercise) => ({
    exerciseId: exercise.exerciseId,
    order: exercise.order,
    prescription: exercise.prescription,
    restSeconds: exercise.restSeconds,
    notes: exercise.notes ?? null,
  }));

  return ok({
    id: idResult.data,
    name,
    slug,
    description,
    estimatedDurationMinutes: input.estimatedDurationMinutes,
    exercises,
  });
}