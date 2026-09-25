/**
 * In-memory implementation of the ProgramEnrollmentRepository port.
 *
 * Stores enrollments in a private Map. Read and write operations use
 * structuredClone to prevent accidental state mutation. The (user, program)
 * uniqueness rule is enforced exactly like the database constraint so
 * use-case tests observe the same ALREADY_ENROLLED race outcome.
 *
 * `replaceExpectedWithNew` mirrors the Drizzle implementation's
 * compare-and-replace semantics: every failure condition is checked — and
 * throws — before the store is mutated, so the swap is atomic from the
 * caller's perspective. The fake deliberately does NOT model the workout
 * sessions FK's ON DELETE SET NULL (it never models cross-repository FK
 * behavior); PostgreSQL integration tests are the authority for session
 * detachment and rollback.
 */

import {
  EnrollmentAlreadyExistsError,
  EnrollmentIdentityMismatchError,
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

  async replaceExpectedWithNew(
    expectedId: EnrollmentId,
    next: ProgramEnrollment,
  ): Promise<boolean> {
    const current = this.enrollmentsById.get(expectedId);
    if (current === undefined) {
      // Stale expected id: nothing to replace, the store is untouched.
      return false;
    }

    // Identity guard, exactly as the Drizzle implementation reads it from the
    // deleted row's RETURNING values — checked before any mutation.
    if (current.userId !== next.userId || current.programId !== next.programId) {
      throw new EnrollmentIdentityMismatchError(
        expectedId,
        { userId: current.userId, programId: current.programId },
        { userId: next.userId, programId: next.programId },
      );
    }

    // Mirror PostgreSQL's primary-key uniqueness: replacing under an id that
    // another enrollment already owns would overwrite that unrelated row in a
    // Map (PostgreSQL rejects it as a unique violation the repository does not
    // translate). Checked as an unexpected failure, never as
    // EnrollmentAlreadyExistsError.
    if (next.id !== expectedId && this.enrollmentsById.has(next.id)) {
      throw new Error(
        `Enrollment id "${next.id}" is already stored under a different identity; ` +
          'replacing would overwrite an unrelated enrollment',
      );
    }

    // Defense-in-depth mirror of the (user_id, program_id) unique constraint
    // for the replacement's pair. Unreachable through this port's write paths
    // (the identity guard ties `next`'s pair to the row being replaced, and
    // every write path enforces pair uniqueness), but a directly-seeded or
    // externally-corrupted duplicate pair must surface the typed duplicate
    // outcome rather than silently corrupting the store.
    for (const [id, enrollment] of this.enrollmentsById) {
      if (id === expectedId) continue;
      if (enrollment.userId === next.userId && enrollment.programId === next.programId) {
        throw new EnrollmentAlreadyExistsError(next.userId, next.programId);
      }
    }

    // Every failure condition has passed: mutate once, atomically from the
    // caller's perspective, cloning per this repository's isolation rule.
    this.enrollmentsById.delete(expectedId);
    this.enrollmentsById.set(next.id, structuredClone(next));
    return true;
  }
}
