/**
 * ProgramEnrollment entity and factory.
 *
 * A ProgramEnrollment links one user to one training program. It is the
 * ownership anchor for per-user program progress: a user's completed workout
 * sessions reference the enrollment they were performed under, so progress is
 * always computed within a single enrollment and never leaks between users.
 *
 * Identity is a surrogate EnrollmentId rather than the (UserId, ProgramId)
 * pair on purpose: leaving a program deletes the enrollment, and rejoining
 * creates a NEW enrollment identity, so the fresh enrollment starts with zero
 * progress and cannot inherit the previous enrollment's completed sessions.
 *
 * Deliberately minimal: there is no status, completedAt, or progress field.
 * Program completion is derivable from the enrollment's completed sessions
 * versus the program's scheduled workouts; persisting it would create a
 * duplicate source of truth.
 *
 * Invariants enforced at construction:
 * - id must be a valid branded EnrollmentId
 * - userId must be a valid branded UserId
 * - programId must be a valid branded ProgramId
 * - enrolledAt must be a valid Date
 */

import { err, ok, type Result } from '@/domain/types/result';

import type { ProgramId, UserId } from '@/domain/types/ids';
import {
  createEnrollmentId,
  createProgramId,
  createUserId,
  type EnrollmentId,
} from '@/domain/types/ids';

export interface ProgramEnrollment {
  readonly id: EnrollmentId;
  readonly userId: UserId;
  readonly programId: ProgramId;
  readonly enrolledAt: Date;
}

export interface CreateProgramEnrollmentInput {
  readonly id: string;
  readonly userId: string;
  readonly programId: string;
  readonly enrolledAt: Date;
}

export interface EnrollmentValidationError {
  readonly code: 'INVALID_ENROLLMENT';
  readonly message: string;
  readonly field?: 'id' | 'userId' | 'programId' | 'enrolledAt';
}

export function createProgramEnrollment(
  input: CreateProgramEnrollmentInput,
): Result<ProgramEnrollment, EnrollmentValidationError> {
  const idResult = createEnrollmentId(input.id);
  if (!idResult.ok) {
    return err({ code: 'INVALID_ENROLLMENT', message: idResult.error.message, field: 'id' });
  }

  const userIdResult = createUserId(input.userId);
  if (!userIdResult.ok) {
    return err({ code: 'INVALID_ENROLLMENT', message: userIdResult.error.message, field: 'userId' });
  }

  const programIdResult = createProgramId(input.programId);
  if (!programIdResult.ok) {
    return err({
      code: 'INVALID_ENROLLMENT',
      message: programIdResult.error.message,
      field: 'programId',
    });
  }

  if (!(input.enrolledAt instanceof Date) || Number.isNaN(input.enrolledAt.getTime())) {
    return err({
      code: 'INVALID_ENROLLMENT',
      message: 'enrolledAt must be a valid Date',
      field: 'enrolledAt',
    });
  }

  return ok({
    id: idResult.data,
    userId: userIdResult.data,
    programId: programIdResult.data,
    enrolledAt: input.enrolledAt,
  });
}
