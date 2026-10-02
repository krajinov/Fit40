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
 * Restartability gate: the Domain's `isRunRestartable` over the enrollment's
 * own execution truth — completed scheduled-workout ids (M14) and recorded
 * not-performed facts (M17) — read through the ONE-snapshot closure-facts
 * projection, never two independently mutable reads that could tear across a
 * concurrent Undo→start→complete and manufacture a completed+recorded overlap
 * the persisted state never held. It is the single authoritative rule: complete OR
 * concluded, so a run whose every authored occurrence is settled (completed or
 * explicitly recorded as not performed) may start over even though it is NOT
 * complete, while an open run never can (a zero-schedule program is neither, so
 * it stays not restartable). The same rule is handed INTO the replacement write
 * and re-evaluated there over the CURRENT facts under the enrollment lock, so a
 * run that was settled at the pre-read but had a settlement undone before the
 * replacement acquired authority is refused — the final delete/replace never
 * relies on this pre-read. Preview state, dashboard state, persisted status,
 * the completion-summary DTO and client input are never consulted, and no
 * `complete || concluded` expression is ever written here — the verdict belongs
 * to the Domain.
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
  type LockedRunSettlementFacts,
  type ProgramEnrollmentRepository,
  type ReplaceEnrollmentOutcome,
} from '@/application/ports/program-enrollment-repository';
import type { ProgramRepository } from '@/application/ports/program-repository';
import type { RunClosureFactsRepository } from '@/application/ports/run-closure-facts-repository';
import { createProgramEnrollment } from '@/domain/entities/program-enrollment';
import type { TrainingProgram } from '@/domain/entities/training-program';
import { isProgramComplete } from '@/domain/services/program-progress';
import { isRunConcluded, isRunRestartable } from '@/domain/services/run-closure';
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
    private readonly closureFactsRepository: RunClosureFactsRepository,
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

    // The authoritative restartability gate: nothing is written when the run
    // is still open (a zero-schedule program is neither complete nor
    // concluded, so it can never be restarted).
    if (!(await this.isEnrollmentRestartable(program, enrollment.id))) {
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
    // so a stale request can never replace or delete a newer enrollment. The
    // restartability decision is passed INTO the replacement so it is
    // re-evaluated under that write's own enrollment-lock authority: a run that
    // was settled at the pre-read above but had a settlement undone (an Undo
    // reopening it) before the replacement acquired the lock is refused there,
    // with zero writes — never replaced from the stale pre-read.
    let outcome: ReplaceEnrollmentOutcome;
    try {
      outcome = await this.enrollmentRepository.replaceExpectedWithNew(
        enrollment.id,
        freshResult.data,
        (facts) => this.isRestartable(program, facts),
      );
    } catch (error) {
      if (error instanceof EnrollmentAlreadyExistsError) {
        // The atomic replacement rolled back: the old enrollment and its
        // session attribution are exactly as they were. No retry.
        return err(alreadyEnrolled(program.slug));
      }
      throw error;
    }

    if (outcome.kind === 'not-restartable') {
      // The run stopped being restartable between the pre-read and the
      // replacement's authority acquiring (e.g. Undo reopened it): nothing was
      // written and the old enrollment remains. Same typed outcome an open run
      // gets at the gate — the error vocabulary is unchanged.
      return err(programNotComplete(program.slug));
    }

    if (outcome.kind === 'replaced') {
      return ok(undefined);
    }

    // The expected enrollment vanished before its replacement: report the
    // actual current state. Read-only — never a second write.
    return err(await this.mapStaleOutcome(program, userId));
  }

  /**
   * The Domain's restartability rule over one set of run-scoped settlement
   * facts: completed occurrence ids (M14) and recorded not-performed facts
   * (M17), read together because neither decides whether the other happens.
   *
   * The verdict itself is `isRunRestartable` composing `isProgramComplete` and
   * `isRunConcluded`; this method never writes a `complete || concluded`
   * expression of its own, so Application cannot grow a second restartability
   * policy beside the Domain's. It is the SAME composition the pre-read uses
   * and the SAME one handed to the replacement transaction — one rule, one
   * widened meaning.
   */
  private isRestartable(program: TrainingProgram, facts: LockedRunSettlementFacts): boolean {
    return isRunRestartable({
      programComplete: isProgramComplete(program, facts.completedIds),
      runConcluded: isRunConcluded(program, {
        completedIds: facts.completedIds,
        notPerformedIds: facts.notPerformedIds,
      }),
    });
  }

  /**
   * The pre-write restartability read: the SAME one-snapshot closure-facts
   * projection the summary read uses (never session aggregates, never two
   * independently mutable reads), evaluated through the shared `isRestartable`
   * composition. This is the normal-path gate that produces the typed
   * PROGRAM_NOT_COMPLETE error; the authoritative re-check happens under the
   * replacement transaction's own lock and remains the final write-side
   * authority — this preflight adds no lock and no retry.
   */
  private async isEnrollmentRestartable(
    program: TrainingProgram,
    enrollmentId: EnrollmentId,
  ): Promise<boolean> {
    const facts = await this.closureFactsRepository.listClosureFactsByEnrollment(enrollmentId);

    return this.isRestartable(program, facts);
  }

  /**
   * Truthful mapping of a stale CAS (it returned false), from ONE read-only
   * re-check of the user's current enrollment for this program:
   * - none → NOT_ENROLLED (a concurrent leave won);
   * - a current enrollment that is NOT restartable → PROGRAM_NOT_COMPLETE (a
   *   concurrent restart already produced a fresh, unstarted run);
   * - a current enrollment that IS restartable → ENROLLMENT_CHANGED (the state
   *   moved again; restarting again from settled state is legitimate).
   * Restartability is decided by the same authoritative rule — never inferred
   * from the enrollment's age or identity — so the widening is identical at
   * both evaluation points.
   */
  private async mapStaleOutcome(
    program: TrainingProgram,
    userId: UserId,
  ): Promise<RestartProgramError> {
    const current = await this.enrollmentRepository.findByUserAndProgram(userId, program.id);
    if (current === null) {
      return notEnrolled(program.slug);
    }

    return (await this.isEnrollmentRestartable(program, current.id))
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
