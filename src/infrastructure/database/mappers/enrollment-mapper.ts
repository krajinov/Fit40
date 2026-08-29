import {
  createProgramEnrollment,
  type ProgramEnrollment,
} from '@/domain/entities/program-enrollment';

import type { programEnrollments } from '../schema/enrollments';

type EnrollmentRow = typeof programEnrollments.$inferSelect;

/**
 * Reconstructs a domain ProgramEnrollment from a persisted row. Throws when
 * the row cannot satisfy the domain factory invariants — the database is
 * trusted structurally, so a violating row indicates corruption and must
 * fail loudly.
 */
export function mapRowToProgramEnrollment(row: EnrollmentRow): ProgramEnrollment {
  const result = createProgramEnrollment({
    id: row.id,
    userId: row.userId,
    programId: row.programId,
    enrolledAt: row.enrolledAt,
  });

  if (!result.ok) {
    throw new Error(`Corrupt data in program_enrollments row "${row.id}": ${result.error.message}`);
  }

  return result.data;
}

/**
 * Maps a domain ProgramEnrollment to its persistable row shape. The
 * enrolledAt timestamp is written from the entity (not a DB-side default) so
 * the domain controls time.
 */
export function mapProgramEnrollmentToRow(
  enrollment: ProgramEnrollment,
): typeof programEnrollments.$inferInsert {
  return {
    id: enrollment.id,
    userId: enrollment.userId,
    programId: enrollment.programId,
    enrolledAt: enrollment.enrolledAt,
  };
}
