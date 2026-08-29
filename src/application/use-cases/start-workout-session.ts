/**
 * Use case: start a new workout session for a scheduled workout occurrence.
 *
 * A session can only be started by a user who is enrolled in the program:
 * the session is owned by that user and attached to their enrollment, which
 * is what makes per-user program progress possible. The userId must come
 * from the trusted authenticated session at the presentation layer, never
 * from client form data.
 *
 * At most one session exists per (enrollment, scheduled workout) pair: a
 * friendly preflight covers the common case and the database's unique
 * constraint remains the final authority for a concurrent start race.
 */

import type { IdGenerator } from '@/application/ports/id-generator';
import type { ProgramEnrollmentRepository } from '@/application/ports/program-enrollment-repository';
import type { ProgramRepository } from '@/application/ports/program-repository';
import {
  SessionAlreadyExistsError,
  type WorkoutSessionRepository,
} from '@/application/ports/workout-session-repository';
import { toWorkoutSessionDto, type WorkoutSessionDto } from '@/application/dto/workout-session';
import { createWorkoutSession, type CreateExerciseLogInput } from '@/domain/entities/workout-session';
import { findScheduledWorkoutOccurrence } from '@/domain/services/scheduled-workout';
import { createUserId } from '@/domain/types/ids';
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
  | { readonly code: 'NOT_ENROLLED'; readonly programSlug: string; readonly message: string }
  | { readonly code: 'SESSION_ALREADY_EXISTS'; readonly scheduledWorkoutId: string; readonly message: string }
  | { readonly code: 'INVALID_WORKOUT_SESSION'; readonly message: string; readonly field?: string };

export interface StartWorkoutSessionInput {
  readonly userId: string;
  readonly programSlug: string;
  readonly weekNumber: number;
  readonly workoutOrder: number;
}

export class StartWorkoutSessionUseCase {
  constructor(
    private readonly programRepository: ProgramRepository,
    private readonly sessionRepository: WorkoutSessionRepository,
    private readonly enrollmentRepository: ProgramEnrollmentRepository,
    private readonly idGenerator: IdGenerator,
  ) {}

  async execute(
    input: StartWorkoutSessionInput,
  ): Promise<Result<WorkoutSessionDto, StartWorkoutSessionError>> {
    const userIdResult = createUserId(input.userId);
    if (!userIdResult.ok) {
      return err({
        code: 'INVALID_WORKOUT_SESSION',
        message: userIdResult.error.message,
        field: 'userId',
      });
    }
    const userId = userIdResult.data;

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

    const enrollment = await this.enrollmentRepository.findByUserAndProgram(userId, program.id);
    if (enrollment === null) {
      return err({
        code: 'NOT_ENROLLED',
        programSlug: input.programSlug,
        message: 'Join this program before starting its workouts.',
      });
    }

    const existing = await this.sessionRepository.findByEnrollmentAndScheduledWorkout(
      enrollment.id,
      occurrence.scheduled.id,
    );
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

    const sessionResult = createWorkoutSession({
      id: this.idGenerator.generate(),
      userId,
      enrollmentId: enrollment.id,
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

    try {
      await this.sessionRepository.save(sessionResult.data);
    } catch (error) {
      if (error instanceof SessionAlreadyExistsError) {
        return err({
          code: 'SESSION_ALREADY_EXISTS',
          scheduledWorkoutId: occurrence.scheduled.id,
          message: `A session already exists for scheduled workout "${occurrence.scheduled.id}"`,
        });
      }
      throw error;
    }

    return ok(toWorkoutSessionDto(sessionResult.data));
  }
}
