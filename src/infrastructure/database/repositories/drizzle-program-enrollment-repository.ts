import { and, asc, eq } from 'drizzle-orm';

import {
  EnrollmentAlreadyExistsError,
  EnrollmentIdentityMismatchError,
  type ProgramEnrollmentRepository,
} from '@/application/ports/program-enrollment-repository';
import type { ProgramEnrollment } from '@/domain/entities/program-enrollment';
import type { EnrollmentId, ProgramId, UserId } from '@/domain/types/ids';

import type { Database } from '../client';
import {
  mapProgramEnrollmentToRow,
  mapRowToProgramEnrollment,
} from '../mappers/enrollment-mapper';
import { isUniqueViolation, pgConstraintName } from '../pg-error';
import { programEnrollments } from '../schema';

/**
 * The (user_id, program_id) unique constraint created by the enrollments
 * table definition. Unique violations are translated to
 * EnrollmentAlreadyExistsError ONLY when they name this constraint, so a
 * primary-key collision or any unrelated constraint can never masquerade as
 * a duplicate enrollment.
 */
const USER_PROGRAM_UNIQUE_CONSTRAINT = 'program_enrollments_user_program_unique';

/**
 * Drizzle implementation of the ProgramEnrollmentRepository port.
 *
 * The (user_id, program_id) unique constraint keeps at most one enrollment
 * per user per program: a create racing that constraint surfaces as
 * EnrollmentAlreadyExistsError so use cases can map it to the
 * ALREADY_ENROLLED business outcome without seeing database details. Delete
 * returns whether a row was matched, so an enrollment that vanished between
 * the ownership check and the write is handled as expected data.
 *
 * `replaceExpectedWithNew` is the atomic compare-and-replace: a targeted
 * delete of the EXPECTED enrollment and the insert of its replacement run in
 * ONE transaction, so the intermediate state is never observable and any
 * failure rolls the whole replacement back.
 */
export class DrizzleProgramEnrollmentRepository implements ProgramEnrollmentRepository {
  constructor(private readonly db: Database) {}

  async findByUserAndProgram(
    userId: UserId,
    programId: ProgramId,
  ): Promise<ProgramEnrollment | null> {
    const rows = await this.db
      .select()
      .from(programEnrollments)
      .where(
        and(
          eq(programEnrollments.userId, userId),
          eq(programEnrollments.programId, programId),
        ),
      )
      .limit(1);

    const row = rows[0];
    return row === undefined ? null : mapRowToProgramEnrollment(row);
  }

  async listByUserId(userId: UserId): Promise<ReadonlyArray<ProgramEnrollment>> {
    const rows = await this.db
      .select()
      .from(programEnrollments)
      .where(eq(programEnrollments.userId, userId))
      .orderBy(asc(programEnrollments.enrolledAt));

    return rows.map(mapRowToProgramEnrollment);
  }

  async create(enrollment: ProgramEnrollment): Promise<void> {
    try {
      await this.db
        .insert(programEnrollments)
        .values(mapProgramEnrollmentToRow(enrollment));
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new EnrollmentAlreadyExistsError(enrollment.userId, enrollment.programId);
      }
      throw error;
    }
  }

  async delete(id: EnrollmentId): Promise<boolean> {
    // Deleting the row detaches its workout sessions via the
    // workout_sessions_enrollment_id FK's ON DELETE SET NULL.
    const deleted = await this.db
      .delete(programEnrollments)
      .where(eq(programEnrollments.id, id))
      .returning({ id: programEnrollments.id });

    return deleted.length > 0;
  }

  async replaceExpectedWithNew(
    expectedId: EnrollmentId,
    next: ProgramEnrollment,
  ): Promise<boolean> {
    // ONE transaction: the targeted delete and the fresh insert commit
    // together or not at all. Every failure path throws from INSIDE this
    // callback, so `db.transaction` performs the rollback (the delete — and
    // with it the FK's ON DELETE SET NULL of the old sessions — is undone).
    return this.db.transaction(async (tx) => {
      // Compare-and-replace keyed on the EXPECTED id only: a newer enrollment
      // created by a concurrent replacement has a different id and can never
      // match this predicate. RETURNING reads the deleted row's identity so
      // it can be verified in the same transaction, before any insert.
      const deleted = await tx
        .delete(programEnrollments)
        .where(eq(programEnrollments.id, expectedId))
        .returning({
          userId: programEnrollments.userId,
          programId: programEnrollments.programId,
        });

      const removed = deleted[0];
      if (removed === undefined) {
        // Stale expected id: nothing was deleted, so nothing is inserted and
        // no other enrollment is touched. The transaction commits as a no-op.
        return false;
      }

      // Identity invariant: the replaced row must describe the same (user,
      // program) identity as its replacement. A mismatch is an invariant
      // failure (never a business outcome) and rolls the delete back.
      if (removed.userId !== next.userId || removed.programId !== next.programId) {
        throw new EnrollmentIdentityMismatchError(
          expectedId,
          { userId: removed.userId, programId: removed.programId },
          { userId: next.userId, programId: next.programId },
        );
      }

      try {
        await tx.insert(programEnrollments).values(mapProgramEnrollmentToRow(next));
      } catch (error) {
        // Translate ONLY the (user_id, program_id) unique constraint — by
        // name, so a primary-key collision or any unrelated unique violation
        // stays an unexpected error. Throwing inside the transaction is what
        // rolls the delete (and its session detachment) back.
        if (
          isUniqueViolation(error) &&
          pgConstraintName(error) === USER_PROGRAM_UNIQUE_CONSTRAINT
        ) {
          throw new EnrollmentAlreadyExistsError(next.userId, next.programId);
        }
        throw error;
      }

      // Reached only when both statements succeeded; the transaction commits.
      return true;
    });
  }
}
