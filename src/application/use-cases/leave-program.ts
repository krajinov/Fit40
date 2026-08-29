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
 */

import type { ProgramEnrollmentRepository } from '@/application/ports/program-enrollment-repository';
import type { ProgramRepository } from '@/application/ports/program-repository';
import { createUserId } from '@/domain/types/ids';
import { err, ok, type Result } from '@/lib/result';

export type LeaveProgramError =
  | { readonly code: 'PROGRAM_NOT_FOUND'; readonly slug: string; readonly message: string }
  | { readonly code: 'NOT_ENROLLED'; readonly programSlug: string; readonly message: string }
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
    if (!deleted) {
      // The enrollment vanished between the ownership check and the delete
      // (e.g. a concurrent leave): the end state is "not enrolled".
      return err(notEnrolled(input.programSlug));
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
