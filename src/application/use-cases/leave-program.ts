/**
 * Use case: leave a training program the authenticated user is enrolled in.
 *
 * The userId must come from the trusted authenticated session at the
 * presentation layer, never from client form data. Ownership is established
 * by loading the enrollment through the (userId, programId) pair: a user can
 * only ever address their own enrollment.
 *
 * Leaving deletes the enrollment row. The user's workout sessions are NOT
 * deleted — the database detaches them from the enrollment (enrollment_id
 * becomes null), so they remain user-owned history but no longer count
 * toward any program's progress. Rejoining creates a fresh enrollment with
 * zero progress.
 *
 * A concurrent leave-and-rejoin race is resolved at the delete boundary: if
 * the loaded enrollment is already gone, the current enrollment is re-checked
 * once and the replacement is deleted exactly once — a bounded sequence with
 * the enrollment-changed conflict surfaced if the state moves again.
 */

import type { ProgramEnrollmentRepository } from '@/application/ports/program-enrollment-repository';
import type { ProgramRepository } from '@/application/ports/program-repository';
import { createUserId } from '@/domain/types/ids';
import { err, ok, type Result } from '@/domain/types/result';

export type LeaveProgramError =
  | { readonly code: 'PROGRAM_NOT_FOUND'; readonly slug: string; readonly message: string }
  | { readonly code: 'NOT_ENROLLED'; readonly programSlug: string; readonly message: string }
  | { readonly code: 'ENROLLMENT_CHANGED'; readonly programSlug: string; readonly message: string }
  | { readonly code: 'INVALID_ENROLLMENT'; readonly message: string; readonly field?: string };

export interface LeaveProgramInput {
  readonly userId: string;
  readonly programSlug: string;
}

export class LeaveProgramUseCase {
  constructor(
    private readonly programRepository: ProgramRepository,
    private readonly enrollmentRepository: ProgramEnrollmentRepository,
  ) {}

  async execute(input: LeaveProgramInput): Promise<Result<void, LeaveProgramError>> {
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
      return err(notEnrolled(input.programSlug));
    }

    const deleted = await this.enrollmentRepository.delete(enrollment.id);
    if (deleted) {
      return ok(undefined);
    }

    // The enrollment vanished between the ownership check and the delete —
    // most commonly the leave-and-rejoin race: another tab deleted A and the
    // rejoin created a new enrollment identity. Re-check current state once
    // and attempt to delete the replacement exactly once. The handling stays
    // bounded (no retry loop) and never reports NOT_ENROLLED while an
    // enrollment still exists.
    const replacement = await this.enrollmentRepository.findByUserAndProgram(userId, program.id);
    if (replacement === null) {
      return err(notEnrolled(input.programSlug));
    }

    const replacementDeleted = await this.enrollmentRepository.delete(replacement.id);
    if (!replacementDeleted) {
      // The replacement disappeared or was replaced again within the single
      // bounded retry: surface the existing enrollment-changed conflict so
      // the caller retries against fresh state instead of looping here.
      return err(enrollmentChanged(input.programSlug));
    }

    return ok(undefined);
  }
}

function notEnrolled(programSlug: string): LeaveProgramError {
  return {
    code: 'NOT_ENROLLED',
    programSlug,
    message: 'You are not enrolled in this program.',
  };
}

function enrollmentChanged(programSlug: string): LeaveProgramError {
  return {
    code: 'ENROLLMENT_CHANGED',
    programSlug,
    message: 'Your enrollment changed while leaving the program. Please try again.',
  };
}
