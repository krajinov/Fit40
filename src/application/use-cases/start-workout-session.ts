/**
 * Use case: start a new workout session for a scheduled workout occurrence.
 *
 * Resolves the program and scheduled occurrence, checks for an existing session,
 * creates exercise logs eagerly, and persists the new session.
 */

import crypto from 'crypto';

import type { ProgramRepository } from '@/application/ports/program-repository';
import type { WorkoutSessionRepository } from '@/application/ports/workout-session-repository';
import { toWorkoutSessionDto, type WorkoutSessionDto } from '@/application/dto/workout-session';
import { createWorkoutSession, type CreateExerciseLogInput } from '@/domain/entities/workout-session';
import { findScheduledWorkoutOccurrence } from '@/domain/services/scheduled-workout';
import { err, ok, type Result } from '@/lib/result';

export type StartWorkoutSessionError =
  | { readonly code: 'PROGRAM_NOT_FOUND'; readonly slug: string; readonly message: string }
  | {
      readonly code: 'SCHEDULED_WORKOUT_NOT_FOUND';
      readonly programSlug: string;
      readonly weekNumber: number;
      readonly workoutOrder: number;
      readonly message: string;
    }
  | { readonly code: 'SESSION_ALREADY_EXISTS'; readonly scheduledWorkoutId: string; readonly message: string }
  | { readonly code: 'INVALID_WORKOUT_SESSION'; readonly message: string; readonly field?: string };

export interface StartWorkoutSessionInput {
  readonly programSlug: string;
  readonly weekNumber: number;
  readonly workoutOrder: number;
}

export class StartWorkoutSessionUseCase {
  constructor(
    private readonly programRepository: ProgramRepository,
    private readonly sessionRepository: WorkoutSessionRepository,
  ) {}

  async execute(
    input: StartWorkoutSessionInput,
  ): Promise<Result<WorkoutSessionDto, StartWorkoutSessionError>> {
    const program = await this.programRepository.findBySlug(input.programSlug);
    if (program === null) {
      return err({
        code: 'PROGRAM_NOT_FOUND',
        slug: input.programSlug,
        message: `Program "${input.programSlug}" not found`,
      });
    }

    const occurrence = findScheduledWorkoutOccurrence(
      program,
      input.weekNumber,
      input.workoutOrder,
    );

    if (occurrence === null) {
      return err({
        code: 'SCHEDULED_WORKOUT_NOT_FOUND',
        programSlug: input.programSlug,
        weekNumber: input.weekNumber,
        workoutOrder: input.workoutOrder,
        message: `Scheduled workout not found for week ${input.weekNumber}, order ${input.workoutOrder}`,
      });
    }

    const existing = await this.sessionRepository.findByScheduledWorkoutId(occurrence.scheduled.id);
    if (existing !== null) {
      return err({
        code: 'SESSION_ALREADY_EXISTS',
        scheduledWorkoutId: occurrence.scheduled.id,
        message: `A session already exists for scheduled workout "${occurrence.scheduled.id}"`,
      });
    }

    const exerciseLogInputs: ReadonlyArray<CreateExerciseLogInput> = occurrence.workout.exercises.map(
      (exercise) => ({
        exerciseId: exercise.exerciseId,
        order: exercise.order,
        prescription: exercise.prescription,
        restSeconds: exercise.restSeconds,
      }),
    );

    const sessionId = crypto.randomUUID();

    const sessionResult = createWorkoutSession({
      id: sessionId,
      scheduledWorkoutId: occurrence.scheduled.id,
      workoutId: occurrence.workout.id,
      startedAt: new Date(),
      exerciseLogs: exerciseLogInputs,
    });

    if (!sessionResult.ok) {
      return err({
        code: 'INVALID_WORKOUT_SESSION',
        message: sessionResult.error.message,
        field: sessionResult.error.field,
      });
    }

    await this.sessionRepository.save(sessionResult.data);

    return ok(toWorkoutSessionDto(sessionResult.data));
  }
}