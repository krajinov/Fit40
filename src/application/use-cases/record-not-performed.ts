/**
 * Use case: record one authored occurrence of the current run as NOT PERFORMED
 * (M17 Slice 7).
 *
 * A settlement is an explicit execution fact about calendar intent, so it is
 * addressed the way every M15 schedule mutation is: by the authored route
 * coordinates (`programSlug` + `weekNumber` + `workoutOrder`), resolved to the
 * authored occurrence server-side. A caller never supplies an `EnrollmentId` or
 * a `ScheduledWorkoutId`, so a browser cannot address another user's run.
 *
 * This use case is a TRANSLATOR over the run-occurrence mutation authority. It
 * resolves identity and maps outcomes; it never decides settlement policy:
 * - the authoritative rule (`decideRecordNotPerformed`) is evaluated inside
 *   `DrizzleRunOccurrenceWrites`, exactly once, under the run's enrollment lock;
 * - nothing about the occurrence's session, logged work or existing fact is read
 *   here. A pre-read would be a stale copy of the very facts the locked
 *   transaction decides on, and recording from it could contradict a start that
 *   committed in between;
 * - exactly ONE mutation call is issued. There is no retry: a lost race is
 *   reported as a typed outcome, never resolved by writing again.
 *
 * The caller supplies `recordedAt` (the attestation instant): the Server Action
 * boundary owns the request clock, and the instant is never derived from a
 * planned date, a session or a clock read in this layer.
 *
 * Outcomes: `record` → success. The three Domain refusals keep their own typed
 * conflicts (`OCCURRENCE_ALREADY_PERFORMED`, `OCCURRENCE_HAS_LOGGED_WORK`,
 * `OCCURRENCE_ALREADY_RECORDED`). `run-vanished` is disambiguated by ONE
 * read-only re-check of the caller's current enrollment: no run → NOT_ENROLLED,
 * a replacement run → ENROLLMENT_CHANGED, the same run still observable → a
 * contract failure, because a run that vanished under the lock cannot reappear
 * with the same identity. `contract-violation` is thrown, never converted into a
 * business Result: the database refusing a write the Domain authorized is an
 * invariant breach, not an outcome.
 */

import {
  NotPerformedWriteContractViolationError,
  type RunOccurrenceWriteRepository,
} from '@/application/ports/run-occurrence-write-repository';
import type { ProgramEnrollmentRepository } from '@/application/ports/program-enrollment-repository';
import type { ProgramRepository } from '@/application/ports/program-repository';
import type { TrainingProgram } from '@/domain/entities/training-program';
import { RecordNotPerformedRefusal } from '@/domain/services/not-performed-decision';
import { findScheduledWorkoutOccurrence } from '@/domain/services/scheduled-workout';
import { createUserId, type EnrollmentId, type UserId } from '@/domain/types/ids';
import { err, ok, type Result } from '@/domain/types/result';

export type RecordNotPerformedError =
  | { readonly code: 'INVALID_INPUT'; readonly message: string; readonly field?: string }
  | { readonly code: 'PROGRAM_NOT_FOUND'; readonly slug: string; readonly message: string }
  | {
      readonly code: 'SCHEDULED_WORKOUT_NOT_FOUND';
      readonly programSlug: string;
      readonly weekNumber: number;
      readonly workoutOrder: number;
      readonly message: string;
    }
  | { readonly code: 'NOT_ENROLLED'; readonly programSlug: string; readonly message: string }
  | {
      readonly code: 'OCCURRENCE_ALREADY_RECORDED';
      readonly programSlug: string;
      readonly scheduledWorkoutId: string;
      readonly message: string;
    }
  | {
      readonly code: 'OCCURRENCE_ALREADY_PERFORMED';
      readonly programSlug: string;
      readonly scheduledWorkoutId: string;
      readonly message: string;
    }
  | {
      readonly code: 'OCCURRENCE_HAS_LOGGED_WORK';
      readonly programSlug: string;
      readonly scheduledWorkoutId: string;
      readonly message: string;
    }
  | { readonly code: 'ENROLLMENT_CHANGED'; readonly programSlug: string; readonly message: string };

export interface RecordNotPerformedInput {
  readonly userId: string;
  readonly programSlug: string;
  /** Authored route coordinates of the occurrence being settled. */
  readonly weekNumber: number;
  readonly workoutOrder: number;
  /** The attestation instant, supplied by the caller's clock. */
  readonly recordedAt: Date;
}

export class RecordNotPerformedUseCase {
  constructor(
    private readonly programRepository: ProgramRepository,
    private readonly enrollmentRepository: ProgramEnrollmentRepository,
    private readonly runOccurrenceWrites: RunOccurrenceWriteRepository,
  ) {}

  async execute(input: RecordNotPerformedInput): Promise<Result<void, RecordNotPerformedError>> {
    const userIdResult = createUserId(input.userId);
    if (!userIdResult.ok) {
      return err({
        code: 'INVALID_INPUT',
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

    const enrollment = await this.enrollmentRepository.findByUserAndProgram(userId, program.id);
    if (enrollment === null) {
      return err(notEnrolled(program.slug));
    }

    // Public coordinates → the authored occurrence. A malformed coordinate
    // simply finds nothing (the `StartWorkoutSessionUseCase` convention).
    const occurrence = findScheduledWorkoutOccurrence(
      program,
      input.weekNumber,
      input.workoutOrder,
    );
    if (occurrence === null) {
      return err({
        code: 'SCHEDULED_WORKOUT_NOT_FOUND',
        programSlug: program.slug,
        weekNumber: input.weekNumber,
        workoutOrder: input.workoutOrder,
        message: `Scheduled workout not found for week ${input.weekNumber}, order ${input.workoutOrder}`,
      });
    }
    const scheduledWorkoutId = occurrence.scheduled.id;

    // THE one mutation: the locked transaction decides, writes at most once and
    // reports what it found. Nothing settlement-related is read before it.
    const outcome = await this.runOccurrenceWrites.recordNotPerformed({
      enrollmentId: enrollment.id,
      scheduledWorkoutId,
      recordedAt: input.recordedAt,
    });

    switch (outcome.kind) {
      case 'record':
        // `deletesAbandonedSession` is the authority's execution detail; the
        // Application never inspects it and never authorizes a deletion.
        return ok(undefined);
      case 'refuse':
        return err(refusal(outcome.reason, program.slug, scheduledWorkoutId));
      case 'run-vanished':
        return err(await this.mapVanishedRun(program, userId, enrollment.id));
      case 'contract-violation':
        throw new NotPerformedWriteContractViolationError(
          'record',
          'the database refused a write the record decision authorized',
        );
    }
  }

  /**
   * Truthful mapping of `run-vanished`, from ONE read-only re-check: no current
   * enrollment means the caller has no run → NOT_ENROLLED; a current enrollment
   * with a DIFFERENT id is the M14 restart replacement → ENROLLMENT_CHANGED (the
   * stale request is never applied to the fresh run). The same enrollment still
   * being observable contradicts the locked result — the run cannot vanish and
   * reappear with the same identity — so it fails loudly instead of being
   * reported as a business outcome.
   */
  private async mapVanishedRun(
    program: TrainingProgram,
    userId: UserId,
    attemptedEnrollmentId: EnrollmentId,
  ): Promise<RecordNotPerformedError> {
    const current = await this.enrollmentRepository.findByUserAndProgram(userId, program.id);
    if (current === null) {
      return notEnrolled(program.slug);
    }
    if (current.id !== attemptedEnrollmentId) {
      return enrollmentChanged(program.slug);
    }
    throw new NotPerformedWriteContractViolationError(
      'record',
      `run ${attemptedEnrollmentId} was reported vanished but is still observable`,
    );
  }
}

/** One total mapping from a Domain refusal to its typed Application conflict. */
function refusal(
  reason: RecordNotPerformedRefusal,
  programSlug: string,
  scheduledWorkoutId: string,
): RecordNotPerformedError {
  switch (reason) {
    case RecordNotPerformedRefusal.AlreadyRecorded:
      return {
        code: 'OCCURRENCE_ALREADY_RECORDED',
        programSlug,
        scheduledWorkoutId,
        message: 'This workout is already recorded as not performed.',
      };
    case RecordNotPerformedRefusal.AlreadyPerformed:
      return {
        code: 'OCCURRENCE_ALREADY_PERFORMED',
        programSlug,
        scheduledWorkoutId,
        message: 'This workout is already completed, so it cannot be recorded as not performed.',
      };
    case RecordNotPerformedRefusal.HasLoggedWork:
      return {
        code: 'OCCURRENCE_HAS_LOGGED_WORK',
        programSlug,
        scheduledWorkoutId,
        message: 'This workout has logged work, so it cannot be recorded as not performed.',
      };
  }
  return unreachable(reason);
}

/** Exhaustiveness guard: a new refusal reason can never be silently ignored. */
function unreachable(value: never): never {
  throw new Error(`Unhandled record refusal: ${String(value)}`);
}

function notEnrolled(programSlug: string): RecordNotPerformedError {
  return { code: 'NOT_ENROLLED', programSlug, message: 'You are not enrolled in this program.' };
}

function enrollmentChanged(programSlug: string): RecordNotPerformedError {
  return {
    code: 'ENROLLMENT_CHANGED',
    programSlug,
    message: 'Your enrollment changed while saving. Please reload and try again.',
  };
}
