/**
 * Use case: start a new workout session for a scheduled workout occurrence.
 *
 * A session can only be started by a user who is enrolled in the program:
 * the session is owned by that user and attached to their enrollment, which
 * is what makes per-user program progress possible. The userId must come
 * from the trusted authenticated session at the presentation layer, never
 * from client form data.
 *
 * This use case builds and validates the Domain aggregate; it does NOT persist
 * it. Persistence goes through the enrollment-serialized mutation authority
 * (`RunOccurrenceWriteRepository.createSessionForOccurrence`), which locks the
 * run's enrollment row first and only then decides, in this exact order, whether
 * the run still exists and whether the occurrence was recorded as not performed
 * (M17 Slice 6). That single serialization point is what makes START and RECORD
 * mutually exclusive — a session can never be manufactured beside a settled
 * occurrence, and an in-progress session can never appear where a not-performed
 * fact already won the race.
 *
 * At most one session exists per (enrollment, scheduled workout) pair: the
 * database's unique constraint remains the final authority, and the authority's
 * INSERT reports a duplicate as the established typed duplicate outcome. A
 * concurrent leave can delete the enrollment before the insert; the authority
 * reports that as `run-vanished` (or its FK backstop), which is re-checked here
 * against current state: a missing enrollment resolves to the typed NOT_ENROLLED
 * outcome, a replacement enrollment (leave followed by a rejoin) gets the
 * session re-pointed and created exactly once through the SAME serialized
 * authority, and an unchanged enrollment means the outcome contradicts
 * observable state and is rethrown rather than swallowed. If the single bounded
 * retry itself loses its enrollment, current state is re-checked once more
 * without creating again: a missing enrollment resolves to NOT_ENROLLED, a
 * further replacement to the typed ENROLLMENT_CHANGED conflict, and an unchanged
 * enrollment is rethrown as contradictory.
 */

import type { IdGenerator } from '@/application/ports/id-generator';
import type { ProgramEnrollmentRepository } from '@/application/ports/program-enrollment-repository';
import type { ProgramRepository } from '@/application/ports/program-repository';
import type {
  CreateSessionForOccurrenceOutcome,
  RunOccurrenceWriteRepository,
} from '@/application/ports/run-occurrence-write-repository';
import {
  SessionAlreadyExistsError,
  SessionEnrollmentNotFoundError,
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
import { err, ok, type Result } from '@/domain/types/result';

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
  | {
      /**
       * The occurrence carries a not-performed settlement, so starting it would
       * contradict recorded truth. The user must undo the record first.
       */
      readonly code: 'OCCURRENCE_RECORDED_NOT_PERFORMED';
      readonly scheduledWorkoutId: string;
      readonly message: string;
    }
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
    private readonly runOccurrenceWrites: RunOccurrenceWriteRepository,
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

    const exerciseLogInputs: ReadonlyArray<CreateExerciseLogInput> = occurrence.workout.exercises.map(
      (exercise) => ({
        // A fresh session performs every occurrence as authored; the factory
        // defaults performedExerciseId to this authored id.
        authoredExerciseId: exercise.exerciseId,
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

    return this.createWithEnrollmentRaceRecovery(
      sessionResult.data,
      enrollment.id,
      userId,
      program,
      occurrence,
    );
  }

  /**
   * Creates the session through the enrollment-serialized authority and maps
   * its outcomes. The caller's aggregate is brand new, so the authority's
   * INSERT is the only write attempted:
   * - `created` -> the DTO is built from the PERSISTED aggregate carrying the
   *   committed version, never from the pre-save snapshot (PR #13 Finding 5);
   * - `recorded-not-performed` -> the occurrence is settled, so no session may
   *   exist beside the fact; nothing was written;
   * - `run-vanished` -> the expected enrollment is gone; current state is
   *   re-checked once (see recoverVanishedEnrollment).
   *
   * A duplicate session, a child occurrence-key conflict and unrelated
   * failures keep their established meanings. The FK backstop
   * (SessionEnrollmentNotFoundError) is handled exactly like `run-vanished`:
   * it is the same race, reported by the database instead of the lock.
   */
  private async createWithEnrollmentRaceRecovery(
    session: WorkoutSession,
    enrollmentId: EnrollmentId,
    userId: UserId,
    program: TrainingProgram,
    occurrence: ScheduledWorkoutOccurrence,
  ): Promise<Result<WorkoutSessionDto, StartWorkoutSessionError>> {
    let outcome: CreateSessionForOccurrenceOutcome;
    try {
      outcome = await this.createForOccurrence(session, enrollmentId, occurrence);
    } catch (error) {
      if (error instanceof SessionAlreadyExistsError) {
        return err(sessionAlreadyExists(occurrence.scheduled.id));
      }
      if (error instanceof SessionEnrollmentNotFoundError) {
        return this.recoverVanishedEnrollment(
          error.enrollmentId,
          session,
          userId,
          program,
          occurrence,
        );
      }
      throw error;
    }

    switch (outcome.kind) {
      case 'created':
        return ok(toWorkoutSessionDto(outcome.session));
      case 'recorded-not-performed':
        return err(occurrenceRecordedNotPerformed(occurrence.scheduled.id));
      case 'run-vanished':
        return this.recoverVanishedEnrollment(enrollmentId, session, userId, program, occurrence);
    }
  }

  /** The one call shape every creation attempt uses. */
  private createForOccurrence(
    session: WorkoutSession,
    enrollmentId: EnrollmentId,
    occurrence: ScheduledWorkoutOccurrence,
  ): Promise<CreateSessionForOccurrenceOutcome> {
    return this.runOccurrenceWrites.createSessionForOccurrence({
      enrollmentId,
      scheduledWorkoutId: occurrence.scheduled.id,
      session,
    });
  }

  /**
   * A leave-and-rejoin race deleted the enrollment this session was built
   * against, and the creation authority wrote nothing (or its FK backstop
   * rejected the insert before anything was committed). Current state is
   * re-checked once:
   * - enrollment gone -> typed NOT_ENROLLED outcome;
   * - different enrollment (leave + rejoin race) -> the same brand-new entity is
   *   re-pointed at the replacement and created exactly once through the SAME
   *   serialized authority (see createForReplacementEnrollment); the retry locks
   *   the enrollment it expects, so the mutation authority is never bypassed;
   * - same enrollment -> the outcome contradicts observable state and is
   *   rethrown instead of being converted to a false business outcome.
   */
  private async recoverVanishedEnrollment(
    vanishedEnrollmentId: string,
    session: WorkoutSession,
    userId: UserId,
    program: TrainingProgram,
    occurrence: ScheduledWorkoutOccurrence,
  ): Promise<Result<WorkoutSessionDto, StartWorkoutSessionError>> {
    const rechecked = await this.enrollmentRepository.findByUserAndProgram(userId, program.id);
    if (rechecked === null) {
      return err(notEnrolled(program.slug));
    }
    if (rechecked.id !== vanishedEnrollmentId) {
      return this.createForReplacementEnrollment(session, rechecked.id, userId, program, occurrence);
    }
    throw new SessionEnrollmentNotFoundError(vanishedEnrollmentId);
  }

  /**
   * The single bounded retry: a leave-and-rejoin race replaced the enrollment
   * this brand-new session was built against, and the failed creation persisted
   * nothing, so the same entity (same id, same version) is safe to re-point at
   * the replacement. It is created through the SAME serialized authority, with
   * that enrollment as the expected lock target — there is no second write path.
   *
   * If the retry loses the replacement enrollment too, current state is
   * re-checked once and resolved without creating again (missing ->
   * NOT_ENROLLED, replaced again -> ENROLLMENT_CHANGED, unchanged -> rethrown as
   * contradictory). Duplicate failures keep the typed SESSION_ALREADY_EXISTS
   * outcome; a settled occurrence keeps the typed
   * OCCURRENCE_RECORDED_NOT_PERFORMED outcome; unrelated failures propagate.
   */
  private async createForReplacementEnrollment(
    session: WorkoutSession,
    replacementEnrollmentId: EnrollmentId,
    userId: UserId,
    program: TrainingProgram,
    occurrence: ScheduledWorkoutOccurrence,
  ): Promise<Result<WorkoutSessionDto, StartWorkoutSessionError>> {
    const replacement: WorkoutSession = { ...session, enrollmentId: replacementEnrollmentId };

    let outcome: CreateSessionForOccurrenceOutcome;
    try {
      outcome = await this.createForOccurrence(replacement, replacementEnrollmentId, occurrence);
    } catch (retryError) {
      if (retryError instanceof SessionAlreadyExistsError) {
        // The occurrence was already started under the replacement
        // enrollment; keep the duplicate-session outcome typed.
        return err(sessionAlreadyExists(occurrence.scheduled.id));
      }
      if (retryError instanceof SessionEnrollmentNotFoundError) {
        return this.resolveExhaustedRetry(retryError.enrollmentId, userId, program);
      }
      throw retryError;
    }

    switch (outcome.kind) {
      case 'created':
        return ok(toWorkoutSessionDto(outcome.session));
      case 'recorded-not-performed':
        return err(occurrenceRecordedNotPerformed(occurrence.scheduled.id));
      case 'run-vanished':
        return this.resolveExhaustedRetry(replacementEnrollmentId, userId, program);
    }
  }

  /**
   * The bounded retry lost its enrollment too. Current state is re-checked once
   * and resolved WITHOUT a further creation: this recovery stays single-shot.
   */
  private async resolveExhaustedRetry(
    lostEnrollmentId: string,
    userId: UserId,
    program: TrainingProgram,
  ): Promise<Result<WorkoutSessionDto, StartWorkoutSessionError>> {
    const rechecked = await this.enrollmentRepository.findByUserAndProgram(userId, program.id);
    if (rechecked === null) {
      return err(notEnrolled(program.slug));
    }
    if (rechecked.id !== lostEnrollmentId) {
      // The enrollment churned yet again. Creating once more would make the
      // recovery unbounded, so surface the race as a typed conflict.
      return err(enrollmentChanged(program.slug));
    }
    throw new SessionEnrollmentNotFoundError(lostEnrollmentId);
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

/**
 * The occurrence carries a not-performed settlement, so starting it would
 * contradict recorded truth. The message states the fact only: the recovery
 * copy ("undo it first") is presentation's, not this layer's.
 */
function occurrenceRecordedNotPerformed(scheduledWorkoutId: string): StartWorkoutSessionError {
  return {
    code: 'OCCURRENCE_RECORDED_NOT_PERFORMED',
    scheduledWorkoutId,
    message: `Scheduled workout "${scheduledWorkoutId}" was recorded as not performed`,
  };
}
