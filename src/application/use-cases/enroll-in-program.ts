/**
 * Use case: enroll the authenticated user in a training program.
 *
 * The userId must come from the trusted authenticated session at the
 * presentation layer, never from client form data. Already-enrolled is an
 * expected business outcome: a friendly preflight check catches the common
 * case, and the (user_id, program_id) unique constraint remains the final
 * authority for a concurrent join race.
 */

import type { IdGenerator } from '@/application/ports/id-generator';
import {
  EnrollmentAlreadyExistsError,
  type ProgramEnrollmentRepository,
} from '@/application/ports/program-enrollment-repository';
import type { ProgramRepository } from '@/application/ports/program-repository';
import { createProgramEnrollment } from '@/domain/entities/program-enrollment';
import { createUserId } from '@/domain/types/ids';
import { err, ok, type Result } from '@/lib/result';

export type EnrollInProgramError =
  | { readonly code: 'PROGRAM_NOT_FOUND'; readonly slug: string; readonly message: string }
  | { readonly code: 'ALREADY_ENROLLED'; readonly programSlug: string; readonly message: string }
  | { readonly code: 'INVALID_ENROLLMENT'; readonly message: string; readonly field?: string };

export interface EnrollInProgramInput {
  readonly userId: string;
  readonly programSlug: string;
}

export class EnrollInProgramUseCase {
  constructor(
    private readonly programRepository: ProgramRepository,
    private readonly enrollmentRepository: ProgramEnrollmentRepository,
    private readonly idGenerator: IdGenerator,
  ) {}

  async execute(input: EnrollInProgramInput): Promise<Result<void, EnrollInProgramError>> {
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

    // Friendly preflight. The unique constraint is the final authority for
    // the race between this check and the insert below.
    const existing = await this.enrollmentRepository.findByUserAndProgram(userId, program.id);
    if (existing !== null) {
      return err(alreadyEnrolled(input.programSlug));
    }

    const enrollmentResult = createProgramEnrollment({
      id: this.idGenerator.generate(),
      userId,
      programId: program.id,
      enrolledAt: new Date(),
    });
    if (!enrollmentResult.ok) {
      return err({
        code: 'INVALID_ENROLLMENT',
        message: enrollmentResult.error.message,
        field: enrollmentResult.error.field,
      });
    }

    try {
      await this.enrollmentRepository.create(enrollmentResult.data);
    } catch (error) {
      if (error instanceof EnrollmentAlreadyExistsError) {
        return err(alreadyEnrolled(input.programSlug));
      }
      throw error;
    }

    return ok(undefined);
  }
}

function alreadyEnrolled(programSlug: string): EnrollInProgramError {
  return {
    code: 'ALREADY_ENROLLED',
    programSlug,
    message: 'You have already joined this program.',
  };
}
