/**
 * In-memory implementation of the ProgramEnrollmentRepository port.
 *
 * Stores enrollments in a private Map. Read and write operations use
 * structuredClone to prevent accidental state mutation. The (user, program)
 * uniqueness rule is enforced exactly like the database constraint so
 * use-case tests observe the same ALREADY_ENROLLED race outcome.
 */

import {
  EnrollmentAlreadyExistsError,
  type ProgramEnrollmentRepository,
} from '@/application/ports/program-enrollment-repository';
import type { ProgramEnrollment } from '@/domain/entities/program-enrollment';
import type { EnrollmentId, ProgramId, UserId } from '@/domain/types/ids';

export class InMemoryProgramEnrollmentRepository implements ProgramEnrollmentRepository {
  private readonly enrollmentsById = new Map<string, ProgramEnrollment>();

  async findByUserAndProgram(
    userId: UserId,
    programId: ProgramId,
  ): Promise<ProgramEnrollment | null> {
    for (const enrollment of this.enrollmentsById.values()) {
      if (enrollment.userId === userId && enrollment.programId === programId) {
        return structuredClone(enrollment);
      }
    }
    return null;
  }

  async listByUserId(userId: UserId): Promise<ReadonlyArray<ProgramEnrollment>> {
    return [...this.enrollmentsById.values()]
      .filter((enrollment) => enrollment.userId === userId)
      .sort((a, b) => a.enrolledAt.getTime() - b.enrolledAt.getTime())
      .map((enrollment) => structuredClone(enrollment));
  }

  async create(enrollment: ProgramEnrollment): Promise<void> {
    const existing = await this.findByUserAndProgram(enrollment.userId, enrollment.programId);
    if (existing !== null) {
      throw new EnrollmentAlreadyExistsError(enrollment.userId, enrollment.programId);
    }
    this.enrollmentsById.set(enrollment.id, structuredClone(enrollment));
  }

  async delete(id: EnrollmentId): Promise<boolean> {
    return this.enrollmentsById.delete(id);
  }
}
