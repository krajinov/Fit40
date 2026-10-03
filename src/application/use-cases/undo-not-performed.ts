/**
 * Use case: undo one authored occurrence's not-performed settlement (M17
 * Slice 7).
 *
 * Addressed exactly like `RecordNotPerformedUseCase`: by the authored route
 * coordinates (`programSlug` + `weekNumber` + `workoutOrder`), resolved to the
 * authored occurrence server-side. A caller never supplies an `EnrollmentId` or
 * a `ScheduledWorkoutId`.
 *
 * This use case is a TRANSLATOR over the run-occurrence mutation authority. It
 * resolves identity and maps outcomes; it never decides settlement policy:
 * - the authoritative rule (`decideUndoNotPerformed`) is evaluated inside
 *   `DrizzleRunOccurrenceWrites`, exactly once, under the run's enrollment lock;
 * - nothing about the occurrence's fact is read here, so the decision can never
 *   be made from a stale copy of it;
 * - exactly ONE mutation call is issued, and there is no retry.
 *
 * Undo removes the recorded fact and NOTHING else: it never recreates a deleted
 * zero-set session, never regenerates the calendar, never inserts a planned row
 * and never touches session history — all of that is the authority's locked
 * contract, and this layer has no capability to do any of it.
 *
 * Outcomes: `undo` → success; the Domain refusal maps to
 * `OCCURRENCE_NOT_RECORDED`; `run-vanished` is disambiguated by ONE read-only
 * re-check of the caller's current enrollment (no run → NOT_ENROLLED, a
 * replacement run → ENROLLMENT_CHANGED, the same run still observable → a
 * contract failure); `contract-violation` is thrown, never converted into a
 * business Result.
 */

import {
  NotPerformedWriteContractViolationError,
  type RunOccurrenceWriteRepository,
} from '@/application/ports/run-occurrence-write-repository';
import type { ProgramEnrollmentRepository } from '@/application/ports/program-enrollment-repository';
import type { ProgramRepository } from '@/application/ports/program-repository';
import type { TrainingProgram } from '@/domain/entities/training-program';
import { UndoNotPerformedRefusal } from '@/domain/services/not-performed-decision';
import { findScheduledWorkoutOccurrence } from '@/domain/services/scheduled-workout';
import { createUserId, type EnrollmentId, type UserId } from '@/domain/types/ids';
import { err, ok, type Result } from '@/domain/types/result';

export type UndoNotPerformedError =
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
      readonly code: 'OCCURRENCE_NOT_RECORDED';
      readonly programSlug: string;
      readonly scheduledWorkoutId: string;
      readonly message: string;
    }
  | { readonly code: 'ENROLLMENT_CHANGED'; readonly programSlug: string; readonly message: string };

export interface UndoNotPerformedInput {
  readonly userId: string;
  readonly programSlug: string;
  /** Authored route coordinates of the occurrence being un-settled. */
  readonly weekNumber: number;
  readonly workoutOrder: number;
}


export class UndoNotPerformedUseCase {
  constructor(
    private readonly programRepository: ProgramRepository,
    private readonly enrollmentRepository: ProgramEnrollmentRepository,
    private readonly runOccurrenceWrites: RunOccurrenceWriteRepository,
  ) {}

  async execute(input: UndoNotPerformedInput): Promise<Result<void, UndoNotPerformedError>> {
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

    // THE one mutation: the locked transaction removes the fact if it is there,
    // and nothing else. Nothing settlement-related is read before it.
    const outcome = await this.runOccurrenceWrites.undoNotPerformed({
      enrollmentId: enrollment.id,
      scheduledWorkoutId,
    });

    switch (outcome.kind) {
      case 'undo':
        return ok(undefined);
      case 'refuse':
        return err(refusal(outcome.reason, program.slug, scheduledWorkoutId));
      case 'run-vanished':
        return err(await this.mapVanishedRun(program, userId, enrollment.id));
      case 'contract-violation':
        throw new NotPerformedWriteContractViolationError(
          'undo',
          'the database refused a delete the undo decision authorized',
        );
    }
  }

  /**
   * Truthful mapping of `run-vanished`, from ONE read-only re-check: no current
   * enrollment means the caller has no run → NOT_ENROLLED; a current enrollment
   * with a DIFFERENT id is the M14 restart replacement → ENROLLMENT_CHANGED (the
   * stale request is never applied to the fresh run, whose settlement set is
   * empty by construction). The same enrollment still being observable
   * contradicts the locked result, so it fails loudly rather than being reported
   * as a business outcome.
   */
  private async mapVanishedRun(
    program: TrainingProgram,
    userId: UserId,
    attemptedEnrollmentId: EnrollmentId,
  ): Promise<UndoNotPerformedError> {
    const current = await this.enrollmentRepository.findByUserAndProgram(userId, program.id);
    if (current === null) {
      return notEnrolled(program.slug);
    }
    if (current.id !== attemptedEnrollmentId) {
      return enrollmentChanged(program.slug);
    }
    throw new NotPerformedWriteContractViolationError(
      'undo',
      `run ${attemptedEnrollmentId} was reported vanished but is still observable`,
    );
  }
}

/** One total mapping from a Domain refusal to its typed Application conflict. */
function refusal(
  reason: UndoNotPerformedRefusal,
  programSlug: string,
  scheduledWorkoutId: string,
): UndoNotPerformedError {
  switch (reason) {
    case UndoNotPerformedRefusal.NotRecorded:
      return {
        code: 'OCCURRENCE_NOT_RECORDED',
        programSlug,
        scheduledWorkoutId,
        message: 'This workout is not recorded as not performed.',
      };
  }
  return unreachable(reason);
}

/** Exhaustiveness guard: a new refusal reason can never be silently ignored. */
function unreachable(value: never): never {
  throw new Error(`Unhandled undo refusal: ${String(value)}`);
}

function notEnrolled(programSlug: string): UndoNotPerformedError {
  return { code: 'NOT_ENROLLED', programSlug, message: 'You are not enrolled in this program.' };
}

function enrollmentChanged(programSlug: string): UndoNotPerformedError {
  return {
    code: 'ENROLLMENT_CHANGED',
    programSlug,
    message: 'Your enrollment changed while saving. Please reload and try again.',
  };
}
