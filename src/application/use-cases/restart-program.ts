/**
 * Use case: restart the authenticated user's COMPLETED program run as a fresh
 * one (M14 Slice 5).
 *
 * The mutation is all-or-nothing: exactly ONE persistence call — Slice 3's
 * atomic compare-and-replace — swaps the current completed enrollment for a
 * freshly identified one, so there is never a committed state in which the
 * user is unenrolled. This use case never composes `LeaveProgramUseCase` or
 * `EnrollInProgramUseCase`, never deletes or creates separately, and never
 * retries: a failed CAS is mapped from a read-only re-check of current truth.
 *
 * Ownership: the enrollment is loaded server-side from the trusted `userId` +
 * program pair. The caller never supplies the expected `EnrollmentId` — a
 * client value could address another run's enrollment, so restart authority is
 * always the row the current state resolves to.
 *
 * Completion gate: the Domain's `isProgramComplete` over the enrollment's
 * completed scheduled-workout ids — the single authoritative rule (which also
 * reports a zero-schedule program as not complete). Preview state, dashboard
 * state, persisted status, the completion-summary DTO and client input are
 * never consulted.
 *
 * Fresh run: a new `EnrollmentId` from the `IdGenerator`, the same user and
 * program, and the current instant as `enrolledAt` (the repository's use-case
 * convention: the domain owns time). Progress starts at zero by construction:
 * the old sessions are detached by the FK and never reattached, and their
 * user-global truth (Training History, exercise history, M8 progression
 * inputs, M12 records, M13 insights) is untouched.
 */

import type { IdGenerator } from '@/application/ports/id-generator';
import {
  EnrollmentAlreadyExistsError,
  type ProgramEnrollmentRepository,
} from '@/application/ports/program-enrollment-repository';
import type { ProgramRepository } from '@/application/ports/program-repository';
import type { WorkoutSessionRepository } from '@/application/ports/workout-session-repository';
import { createProgramEnrollment } from '@/domain/entities/program-enrollment';
import type { TrainingProgram } from '@/domain/entities/training-program';
import { isProgramComplete } from '@/domain/services/program-progress';
import { createUserId, type EnrollmentId, type UserId } from '@/domain/types/ids';
import { err, ok, type Result } from '@/domain/types/result';

export type RestartProgramError =
  | { readonly code: 'PROGRAM_NOT_FOUND'; readonly slug: string; readonly message: string }
  | { readonly code: 'NOT_ENROLLED'; readonly programSlug: string; readonly message: string }
  | { readonly code: 'PROGRAM_NOT_COMPLETE'; readonly programSlug: string; readonly message: string }
  | { readonly code: 'ENROLLMENT_CHANGED'; readonly programSlug: string; readonly message: string }
  | { readonly code: 'ALREADY_ENROLLED'; readonly programSlug: string; readonly message: string }
  | { readonly code: 'INVALID_ENROLLMENT'; readonly message: string; readonly field?: string };

export interface RestartProgramInput {
  readonly userId: string;
  readonly programSlug: string;
}

export class RestartProgramUseCase {
  constructor(
    private readonly programRepository: ProgramRepository,
    private readonly enrollmentRepository: ProgramEnrollmentRepository,
    private readonly sessionRepository: WorkoutSessionRepository,
    private readonly idGenerator: IdGenerator,
  ) {}

  async execute(input: RestartProgramInput): Promise<Result<void, RestartProgramError>> {
    const userIdResult = createUserId(input.userId);
    if (!userIdResult.ok) {
      return err({
        code: 'INVALID_ENROLLMENT',
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

    // The authoritative completion gate: nothing is written when the run is
    // not complete (a zero-schedule program is never complete).
    if (!(await this.isEnrollmentComplete(program, enrollment.id))) {
      return err(programNotComplete(program.slug));
    }

    const freshResult = createProgramEnrollment({
      id: this.idGenerator.generate(),
      userId,
      programId: program.id,
      enrolledAt: new Date(),
    });
    if (!freshResult.ok) {
      return err({
        code: 'INVALID_ENROLLMENT',
        message: freshResult.error.message,
        field: freshResult.error.field,
      });
    }

    // The ONE write. The expected id is the enrollment this use case loaded,
    // so a stale request can never replace or delete a newer enrollment.
    let replaced: boolean;
    try {
      replaced = await this.enrollmentRepository.replaceExpectedWithNew(
        enrollment.id,
        freshResult.data,
      );
    } catch (error) {
      if (error instanceof EnrollmentAlreadyExistsError) {
        // The atomic replacement rolled back: the old enrollment and its
        // session attribution are exactly as they were. No retry.
        return err(alreadyEnrolled(program.slug));
      }
      throw error;
    }

    if (replaced) {
      return ok(undefined);
    }

    // The expected enrollment vanished before its replacement: report the
    // actual current state. Read-only — never a second write.
    return err(await this.mapStaleOutcome(program, userId));
  }

  /** Slice 1's rule over the enrollment's own completed occurrence ids. */
  private async isEnrollmentComplete(
    program: TrainingProgram,
    enrollmentId: EnrollmentId,
  ): Promise<boolean> {
    const completedIds = await this.sessionRepository.listCompletedScheduledWorkoutIds(
      enrollmentId,
    );
    return isProgramComplete(program, completedIds);
  }

  /**
   * Truthful mapping of a stale CAS (it returned false), from ONE read-only
   * re-check of the user's current enrollment for this program:
   * - none → NOT_ENROLLED (a concurrent leave won);
   * - a current enrollment that is not complete → PROGRAM_NOT_COMPLETE (a
   *   concurrent restart already produced a fresh, unstarted run);
   * - a current enrollment that IS complete → ENROLLMENT_CHANGED (the state
   *   moved again; restarting again from fresh state is legitimate).
   * Completeness is decided by the same authoritative rule — never inferred
   * from the enrollment's age or identity.
   */
  private async mapStaleOutcome(
    program: TrainingProgram,
    userId: UserId,
  ): Promise<RestartProgramError> {
    const current = await this.enrollmentRepository.findByUserAndProgram(userId, program.id);
    if (current === null) {
      return notEnrolled(program.slug);
    }

    return (await this.isEnrollmentComplete(program, current.id))
      ? enrollmentChanged(program.slug)
      : programNotComplete(program.slug);
  }
}

function notEnrolled(programSlug: string): RestartProgramError {
  return {
    code: 'NOT_ENROLLED',
    programSlug,
    message: 'You are not enrolled in this program.',
  };
}

function programNotComplete(programSlug: string): RestartProgramError {
  return {
    code: 'PROGRAM_NOT_COMPLETE',
    programSlug,
    message: 'This program run is not complete yet, so it cannot be restarted.',
  };
}

function enrollmentChanged(programSlug: string): RestartProgramError {
  return {
    code: 'ENROLLMENT_CHANGED',
    programSlug,
    message: 'Your enrollment changed while restarting the program. Please reload and try again.',
  };
}

function alreadyEnrolled(programSlug: string): RestartProgramError {
  return {
    code: 'ALREADY_ENROLLED',
    programSlug,
    message: 'You already have an active enrollment in this program. Please reload and try again.',
  };
}
