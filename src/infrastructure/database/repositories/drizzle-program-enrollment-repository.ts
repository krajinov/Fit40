import { and, asc, eq } from 'drizzle-orm';

import {
  EnrollmentAlreadyExistsError,
  type ProgramEnrollmentRepository,
} from '@/application/ports/program-enrollment-repository';
import type { ProgramEnrollment } from '@/domain/entities/program-enrollment';
import type { EnrollmentId, ProgramId, UserId } from '@/domain/types/ids';

import type { Database } from '../client';
import {
  mapProgramEnrollmentToRow,
  mapRowToProgramEnrollment,
} from '../mappers/enrollment-mapper';
import { isUniqueViolation } from '../pg-error';
import { programEnrollments } from '../schema';

/**
 * Drizzle implementation of the ProgramEnrollmentRepository port.
 *
 * The (user_id, program_id) unique constraint keeps at most one enrollment
 * per user per program: a create racing that constraint surfaces as
 * EnrollmentAlreadyExistsError so use cases can map it to the
 * ALREADY_ENROLLED business outcome without seeing database details. Delete
 * returns whether a row was matched, so an enrollment that vanished between
 * the ownership check and the write is handled as expected data.
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
}
