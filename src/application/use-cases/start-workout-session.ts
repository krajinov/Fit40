/**
 * Use case: start a new workout session for a scheduled workout occurrence.
 *
 * Resolves the program and scheduled occurrence, creates exercise logs eagerly,
 * and persists the new session. A session that already exists for the same
 * occurrence — either found up front or rejected by the repository's unique
 * constraint when two requests race — is reported as `SESSION_ALREADY_EXISTS`.
 */

import crypto from 'crypto';

import type { ProgramRepository } from '@/application/ports/program-repository';
import type {
  WorkoutSessionRepository,
  WorkoutSessionSaveConflict,
} from '@/application/ports/workout-session-repository';
import { toWorkoutSessionDto, type WorkoutSessionDto } from '@/application/dto/workout-session';
import { createWorkoutSession, type CreateExerciseLogInput } from '@/domain/entities/workout-session';
import type { ScheduledWorkoutId } from '@/domain/types/ids';
import type { Workout } from '@/domain/entities/workout';
import { findScheduledWorkoutOccurrence } from '@/domain/services/scheduled-workout';
import { err, ok, type Result } from '@/lib/result';
import {
  toSessionModifiedError,
  type SessionModifiedError,
} from '@/application/use-cases/session-save-conflict';

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
  | SessionModifiedError
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
      return err(sessionAlreadyExistsError(occurrence.scheduled.id));
    }

    const sessionResult = createWorkoutSession({
      id: crypto.randomUUID(),
      scheduledWorkoutId: occurrence.scheduled.id,
      workoutId: occurrence.workout.id,
      startedAt: new Date(),
      exerciseLogs: buildExerciseLogInputs(occurrence.workout),
    });

    if (!sessionResult.ok) {
      return err({
        code: 'INVALID_WORKOUT_SESSION',
        message: sessionResult.error.message,
        field: sessionResult.error.field,
      });
    }

    // Saving enforces both persistence rules atomically: "one session per
    // scheduled workout" and "the stored revision must still be the one loaded".
    // Losing the occurrence race is the ordinary outcome of two overlapping
    // starts; a revision conflict means the id this session was given was already
    // taken, which the caller is told about as a stale-write conflict.
    const saved = await this.sessionRepository.save(sessionResult.data);
    if (!saved.ok) {
      return err(toStartSaveError(saved.error, occurrence.scheduled.id));
    }

    return ok(toWorkoutSessionDto({ ...sessionResult.data, version: saved.data }));
  }
}

/**
 * Maps a rejected start onto the code callers already understand: the occurrence
 * is taken, or this particular session could not be written because a session with
 * its id is already stored.
 */
function toStartSaveError(
  conflict: WorkoutSessionSaveConflict,
  scheduledWorkoutId: ScheduledWorkoutId,
): StartWorkoutSessionError {
  if (conflict.reason === 'concurrent-modification') {
    return toSessionModifiedError(conflict, conflict.sessionId);
  }

  return sessionAlreadyExistsError(scheduledWorkoutId);
}

/** Exercise log inputs mirroring the workout template, in template order. */
function buildExerciseLogInputs(workout: Workout): ReadonlyArray<CreateExerciseLogInput> {
  return workout.exercises.map((exercise) => ({
    exerciseId: exercise.exerciseId,
    order: exercise.order,
    prescription: exercise.prescription,
    restSeconds: exercise.restSeconds,
  }));
}

function sessionAlreadyExistsError(
  scheduledWorkoutId: ScheduledWorkoutId,
): StartWorkoutSessionError {
  return {
    code: 'SESSION_ALREADY_EXISTS',
    scheduledWorkoutId,
    message: `A session already exists for scheduled workout "${scheduledWorkoutId}"`,
  };
}
