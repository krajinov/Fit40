/**
 * Use case: retrieve a single scheduled workout occurrence with exercise data
 * enriched from the exercise catalog.
 */

import type { ExerciseRepository } from '@/application/ports/exercise-repository';
import type { ProgramRepository } from '@/application/ports/program-repository';
import type {
  ScheduledWorkoutDetailDto,
  ScheduledWorkoutExerciseDto,
} from '@/application/dto/program';
import type { Exercise } from '@/domain/entities/exercise';
import type { ExerciseId } from '@/domain/types/ids';
import { err, ok, type Result } from '@/domain/types/result';

export type ScheduledWorkoutError =
  | { readonly code: 'PROGRAM_NOT_FOUND'; readonly slug: string; readonly message: string }
  | {
      readonly code: 'SCHEDULED_WORKOUT_NOT_FOUND';
      readonly programSlug: string;
      readonly weekNumber: number;
      readonly workoutOrder: number;
      readonly message: string;
    }
  | {
      readonly code: 'EXERCISE_NOT_FOUND';
      readonly exerciseId: ExerciseId;
      readonly message: string;
    };

export interface GetScheduledWorkoutInput {
  readonly programSlug: string;
  readonly weekNumber: number;
  readonly workoutOrder: number;
}

function toExerciseDto(
  exercise: Exercise,
  workoutExercise: {
    readonly order: number;
    readonly prescription: import('@/domain/value-objects/rep-prescription').RepPrescription;
    readonly restSeconds: number;
    readonly notes: string | null;
  },
): ScheduledWorkoutExerciseDto {
  return {
    order: workoutExercise.order,
    exerciseId: exercise.id,
    exerciseName: exercise.name,
    exerciseSlug: exercise.slug,
    prescription: workoutExercise.prescription,
    restSeconds: workoutExercise.restSeconds,
    notes: workoutExercise.notes,
  };
}

export class GetScheduledWorkoutUseCase {
  constructor(
    private readonly programRepository: ProgramRepository,
    private readonly exerciseRepository: ExerciseRepository,
  ) {}

  async execute(
    input: GetScheduledWorkoutInput,
  ): Promise<Result<ScheduledWorkoutDetailDto, ScheduledWorkoutError>> {
    const program = await this.programRepository.findBySlug(input.programSlug);

    if (program === null) {
      return err({
        code: 'PROGRAM_NOT_FOUND',
        slug: input.programSlug,
        message: `Program "${input.programSlug}" not found`,
      });
    }

    const week = program.weeks.find((w) => w.weekNumber === input.weekNumber);

    if (week === undefined) {
      return err({
        code: 'SCHEDULED_WORKOUT_NOT_FOUND',
        programSlug: input.programSlug,
        weekNumber: input.weekNumber,
        workoutOrder: input.workoutOrder,
        message: `Week ${input.weekNumber} not found in program "${input.programSlug}"`,
      });
    }

    const scheduled = week.scheduledWorkouts.find((s) => s.order === input.workoutOrder);

    if (scheduled === undefined) {
      return err({
        code: 'SCHEDULED_WORKOUT_NOT_FOUND',
        programSlug: input.programSlug,
        weekNumber: input.weekNumber,
        workoutOrder: input.workoutOrder,
        message: `Workout order ${input.workoutOrder} not found in week ${input.weekNumber}`,
      });
    }

    const workout = program.workouts.find((w) => w.id === scheduled.workoutId);

    if (workout === undefined) {
      return err({
        code: 'SCHEDULED_WORKOUT_NOT_FOUND',
        programSlug: input.programSlug,
        weekNumber: input.weekNumber,
        workoutOrder: input.workoutOrder,
        message: `Workout template for scheduled workout not found`,
      });
    }

    const exercises = await this.exerciseRepository.list();
    const exerciseById = new Map<ExerciseId, Exercise>(
      exercises.map((exercise) => [exercise.id, exercise]),
    );

    const enrichedExercises: ScheduledWorkoutExerciseDto[] = [];

    for (const workoutExercise of workout.exercises) {
      const exercise = exerciseById.get(workoutExercise.exerciseId);

      if (exercise === undefined) {
        return err({
          code: 'EXERCISE_NOT_FOUND',
          exerciseId: workoutExercise.exerciseId,
          message: `Exercise ${workoutExercise.exerciseId} referenced by workout ${workout.slug} not found`,
        });
      }

      enrichedExercises.push(toExerciseDto(exercise, workoutExercise));
    }

    return ok({
      programSlug: program.slug,
      programName: program.name,
      weekNumber: week.weekNumber,
      order: scheduled.order,
      workout: {
        id: workout.id,
        name: workout.name,
        slug: workout.slug,
        description: workout.description,
        estimatedDurationMinutes: workout.estimatedDurationMinutes,
        exercises: enrichedExercises,
      },
    });
  }
}