/**
 * Use case: retrieve the current user's workout session for a scheduled
 * workout occurrence, along with whether the user is enrolled in the program.
 *
 * The session is resolved through the user's enrollment, so users never see
 * each other's sessions for the same occurrence. When the user is not
 * enrolled, no session can exist for them and the view reports
 * `enrolled: false` so the presentation layer can offer the join action.
 *
 * This is also the workout detail surface's own read, so it reports the
 * occurrence's M17 not-performed fact as well (`notPerformedRecorded`): the
 * detail header must be able to refuse Start for a settled occurrence without
 * inferring settlement from the absence or state of a session. The session
 * state and the settlement state are mutually exclusive truths of the SAME
 * occurrence, so they are read through ONE coherent snapshot port — never two
 * independent statements, which could pair the old abandoned session with the
 * freshly committed record while `recordNotPerformed` replaces one with the
 * other atomically.
 */

import type { OccurrenceExecutionFactsRepository } from '@/application/ports/occurrence-execution-facts-repository';
import type { ProgramEnrollmentRepository } from '@/application/ports/program-enrollment-repository';
import type { ProgramRepository } from '@/application/ports/program-repository';
import { toWorkoutSessionDto, type WorkoutSessionDto } from '@/application/dto/workout-session';
import type { TrainingProgram } from '@/domain/entities/training-program';
import { findScheduledWorkoutOccurrence } from '@/domain/services/scheduled-workout';
import {
  createEnrollmentId,
  createUserId,
  type ScheduledWorkoutId,
  type UserId,
} from '@/domain/types/ids';
import { err, ok, type Result } from '@/domain/types/result';

export type GetWorkoutSessionError =
  | { readonly code: 'PROGRAM_NOT_FOUND'; readonly slug: string; readonly message: string }
  | {
      readonly code: 'SCHEDULED_WORKOUT_NOT_FOUND';
      readonly programSlug: string;
      readonly weekNumber: number;
      readonly workoutOrder: number;
      readonly message: string;
    }
  | { readonly code: 'INVALID_INPUT'; readonly message: string; readonly field?: string }
  | {
      /**
       * The caller's expected enrollment no longer exists (a concurrent
       * restart/leave replaced the run): the read refuses to compose the
       * caller's old-enrollment parent with a new run's session state.
       */
      readonly code: 'ENROLLMENT_CHANGED';
      readonly message: string;
    };

export interface GetWorkoutSessionInput {
  readonly userId: string;
  readonly programSlug: string;
  readonly weekNumber: number;
  readonly workoutOrder: number;
  /**
   * The SPECIFIC enrollment the caller already loaded and is composing this
   * occurrence's state into (the dashboard's / program detail's enrollment
   * view). When supplied, the read is fenced to exactly that identity: it
   * never re-resolves the current enrollment, so a concurrent restart/leave
   * cannot hand back the replacement run's session state for an old-enrollment
   * preview. Omitted (or undefined), the read resolves the current enrollment
   * as before - the standalone read convention.
   */
  readonly expectedEnrollmentId?: string;
}

export interface WorkoutSessionView {
  readonly enrolled: boolean;
  readonly session: WorkoutSessionDto | null;
  /**
   * Whether the occurrence carries an M17 not-performed record in THIS user's
   * run. Always false when the user is not enrolled (there is no run to settle).
   */
  readonly notPerformedRecorded: boolean;
}

export class GetWorkoutSessionUseCase {
  constructor(
    private readonly programRepository: ProgramRepository,
    private readonly enrollmentRepository: ProgramEnrollmentRepository,
    private readonly occurrenceExecutionFactsRepository: OccurrenceExecutionFactsRepository,
  ) {}

  async execute(
    input: GetWorkoutSessionInput,
  ): Promise<Result<WorkoutSessionView, GetWorkoutSessionError>> {
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

    const userIdResult = createUserId(input.userId);
    if (!userIdResult.ok) {
      return err({
        code: 'INVALID_INPUT',
        message: userIdResult.error.message,
        field: 'userId',
      });
    }

    if (input.expectedEnrollmentId !== undefined) {
      return this.executeFenced(input.expectedEnrollmentId, userIdResult.data, program, occurrence.scheduled.id);
    }

    const enrollment = await this.enrollmentRepository.findByUserAndProgram(
      userIdResult.data,
      program.id,
    );
    if (enrollment === null) {
      return ok({ enrolled: false, session: null, notPerformedRecorded: false });
    }

    // The occurrence's session state and its settlement state from ONE
    // coherent snapshot: mutually exclusive truths of the same occurrence, so
    // a concurrent record/undo transition can never pair the old session with
    // the fresh record (or erase both).
    const facts = await this.occurrenceExecutionFactsRepository.findOccurrenceExecutionFacts(
      enrollment.id,
      occurrence.scheduled.id,
    );

    return ok({
      enrolled: true,
      session: facts.session === null ? null : toWorkoutSessionDto(facts.session),
      notPerformedRecorded: facts.notPerformedRecorded,
    });
  }

  /**
   * The fenced read: ONE snapshot establishes BOTH that the caller's expected
   * enrollment is still this user's run of this program AND that occurrence's
   * session/settlement state. `matched: false` is the typed ENROLLMENT_CHANGED
   * refusal, never the replacement run's session state and never absence - the
   * caller is composing a preview for a run that DID exist. A malformed id is
   * the same refusal.
   */
  private async executeFenced(
    expectedEnrollmentId: string,
    userId: UserId,
    program: TrainingProgram,
    scheduledWorkoutId: ScheduledWorkoutId,
  ): Promise<Result<WorkoutSessionView, GetWorkoutSessionError>> {
    const expectedId = createEnrollmentId(expectedEnrollmentId);
    if (!expectedId.ok) {
      return err({
        code: 'ENROLLMENT_CHANGED',
        message: 'The expected enrollment id is invalid, so the session cannot be read',
      });
    }

    const projection = await this.occurrenceExecutionFactsRepository.findFencedOccurrenceExecutionFacts(
      expectedId.data,
      scheduledWorkoutId,
      userId,
      program.id,
    );
    if (!projection.matched) {
      return err({
        code: 'ENROLLMENT_CHANGED',
        message: 'Your enrollment changed while reading the session. Please reload and try again.',
      });
    }

    const { session, notPerformedRecorded } = projection.facts;
    return ok({
      enrolled: true,
      session: session === null ? null : toWorkoutSessionDto(session),
      notPerformedRecorded,
    });
  }
}
