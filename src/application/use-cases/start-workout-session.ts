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
 * constraint remains the final authority for a concurrent start race. A
 * concurrent leave can delete the enrollment between the preflight and the
 * insert; the repository surfaces that FK violation as
 * SessionEnrollmentNotFoundError, which is re-checked here against current
 * state: a missing enrollment resolves to the typed NOT_ENROLLED outcome, a
 * replacement enrollment (leave followed by a rejoin) gets the session
 * re-pointed and saved exactly once, and an unchanged enrollment means the
 * error contradicts observable state and is rethrown rather than swallowed.
 * If the retry itself loses its enrollment, current state is re-checked once
 * more without saving again: a missing enrollment resolves to NOT_ENROLLED, a
 * further replacement to the typed ENROLLMENT_CHANGED conflict, and an
 * unchanged enrollment is rethrown as contradictory.
 */

import type { IdGenerator } from '@/application/ports/id-generator';
import type { ProgramEnrollmentRepository } from '@/application/ports/program-enrollment-repository';
import type { ProgramRepository } from '@/application/ports/program-repository';
import {
  SessionAlreadyExistsError,
  SessionEnrollmentNotFoundError,
  type WorkoutSessionRepository,
} from '@/application/ports/workout-session-repository';
import { toWorkoutSessionDto, type WorkoutSessionDto } from '@/application/dto/workout-session';
import type { TrainingProgram } from '@/domain/entities/training-program';
import {
  createWorkoutSession,
  type CreateExerciseLogInput,
  type WorkoutSession,
} from '@/domain/entities/workout-session';
import {
  findScheduledWorkoutOccurrence,
  type ScheduledWorkoutOccurrence,
} from '@/domain/services/scheduled-workout';
import { createUserId, type EnrollmentId, type UserId } from '@/domain/types/ids';
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
  | { readonly code: 'ENROLLMENT_CHANGED'; readonly programSlug: string; readonly message: string }
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
      return err(notEnrolled(input.programSlug));
    }

    const existing = await this.sessionRepository.findByEnrollmentAndScheduledWorkout(
      enrollment.id,
      occurrence.scheduled.id,
    );
    if (existing !== null) {
      return err(sessionAlreadyExists(occurrence.scheduled.id));
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

    return this.saveWithEnrollmentRaceRecovery(sessionResult.data, userId, program, occurrence);
  }

  /**
   * Persists a new session, resolving enrollment races against the database's
   * FK authority. The repository's SessionEnrollmentNotFoundError is
   * re-checked against current state:
   * - enrollment gone -> typed NOT_ENROLLED outcome;
   * - different enrollment (leave + rejoin race) -> the session is re-pointed
   *   at the replacement and saved exactly once; that retry re-checks state
   *   once more without saving if it loses its enrollment too (see
   *   saveForReplacementEnrollment);
   * - same enrollment -> the error contradicts observable state and is
   *   rethrown instead of being converted to a false business outcome.
   */
  private async saveWithEnrollmentRaceRecovery(
    session: WorkoutSession,
    userId: UserId,
    program: TrainingProgram,
    occurrence: ScheduledWorkoutOccurrence,
  ): Promise<Result<WorkoutSessionDto, StartWorkoutSessionError>> {
    try {
      await this.sessionRepository.save(session);
    } catch (error) {
      if (error instanceof SessionAlreadyExistsError) {
        return err(sessionAlreadyExists(occurrence.scheduled.id));
      }
      if (error instanceof SessionEnrollmentNotFoundError) {
        const rechecked = await this.enrollmentRepository.findByUserAndProgram(
          userId,
          program.id,
        );
        if (rechecked === null) {
          return err(notEnrolled(program.slug));
        }
        if (rechecked.id !== error.enrollmentId) {
          return this.saveForReplacementEnrollment(
            session,
            rechecked.id,
            userId,
            program,
            occurrence,
          );
        }
      }
      throw error;
    }
    return ok(toWorkoutSessionDto(session));
  }

  /**
   * A leave-and-rejoin race replaced the enrollment this session was built
   * against. The failed save persisted nothing, so the same entity (same id,
   * same version) is safe to re-point at the replacement enrollment. This is
   * the single bounded retry: if its insert loses the replacement enrollment
   * too, current state is re-checked once and resolved without saving again
   * (missing -> NOT_ENROLLED, replaced again -> ENROLLMENT_CHANGED, unchanged
   * -> rethrown as contradictory). Duplicate failures keep the typed
   * SESSION_ALREADY_EXISTS outcome; unrelated failures propagate.
   */
  private async saveForReplacementEnrollment(
    session: WorkoutSession,
    replacementEnrollmentId: EnrollmentId,
    userId: UserId,
    program: TrainingProgram,
    occurrence: ScheduledWorkoutOccurrence,
  ): Promise<Result<WorkoutSessionDto, StartWorkoutSessionError>> {
    const replacement: WorkoutSession = { ...session, enrollmentId: replacementEnrollmentId };
    try {
      await this.sessionRepository.save(replacement);
    } catch (retryError) {
      if (retryError instanceof SessionAlreadyExistsError) {
        // The occurrence was already started under the replacement
        // enrollment; keep the duplicate-session outcome typed.
        return err(sessionAlreadyExists(occurrence.scheduled.id));
      }
      if (retryError instanceof SessionEnrollmentNotFoundError) {
        // The replacement enrollment was deleted mid-retry. Re-check current
        // state once, but never save again: this recovery stays a single
        // bounded retry.
        const rechecked = await this.enrollmentRepository.findByUserAndProgram(
          userId,
          program.id,
        );
        if (rechecked === null) {
          return err(notEnrolled(program.slug));
        }
        if (rechecked.id !== retryError.enrollmentId) {
          // The enrollment churned yet again. Saving once more would make the
          // recovery unbounded, so surface the race as a typed conflict.
          return err(enrollmentChanged(program.slug));
        }
      }
      throw retryError;
    }
    return ok(toWorkoutSessionDto(replacement));
  }
}

function notEnrolled(programSlug: string): StartWorkoutSessionError {
  return {
    code: 'NOT_ENROLLED',
    programSlug,
    message: 'Join this program before starting its workouts.',
  };
}

function enrollmentChanged(programSlug: string): StartWorkoutSessionError {
  return {
    code: 'ENROLLMENT_CHANGED',
    programSlug,
    message: 'Your enrollment changed while starting the session. Please try again.',
  };
}

function sessionAlreadyExists(scheduledWorkoutId: string): StartWorkoutSessionError {
  return {
    code: 'SESSION_ALREADY_EXISTS',
    scheduledWorkoutId,
    message: `A session already exists for scheduled workout "${scheduledWorkoutId}"`,
  };
}
