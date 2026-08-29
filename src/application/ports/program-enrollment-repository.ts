/**
 * ProgramEnrollment repository port.
 *
 * Defines the contract that the Drizzle (and in-memory) repository must
 * satisfy. The application layer depends only on this port.
 *
 * Create and delete are separate operations (no upsert). The database's
 * (user_id, program_id) unique constraint keeps at most one enrollment per
 * user per program; a create racing that constraint surfaces as
 * EnrollmentAlreadyExistsError so use cases can map it to the
 * ALREADY_ENROLLED business outcome without leaking PostgreSQL details.
 */

import type { ProgramEnrollment } from '@/domain/entities/program-enrollment';
import type { EnrollmentId, ProgramId, UserId } from '@/domain/types/ids';

/**
 * Thrown by `create` when the insert races the (user_id, program_id) unique
 * constraint. The caller should map this to the ALREADY_ENROLLED business
 * outcome.
 */
export class EnrollmentAlreadyExistsError extends Error {
  constructor(
    readonly userId: string,
    readonly programId: string,
  ) {
    super(`User "${userId}" is already enrolled in program "${programId}"`);
    this.name = 'EnrollmentAlreadyExistsError';
  }
}

export interface ProgramEnrollmentRepository {
  /**
   * Finds the user's enrollment in a program, or null when the user is not
   * enrolled. Absence is a normal state, not an error.
   */
  findByUserAndProgram(
    userId: UserId,
    programId: ProgramId,
  ): Promise<ProgramEnrollment | null>;

  /**
   * Lists all of a user's enrollments, ordered by enrollment time ascending.
   */
  listByUserId(userId: UserId): Promise<ReadonlyArray<ProgramEnrollment>>;

  /**
   * Persists a new enrollment. The caller should have established that none
   * exists yet; the unique constraint remains the final authority for a
   * concurrent join race.
   *
   * May throw {@link EnrollmentAlreadyExistsError} on a concurrent join race.
   */
  create(enrollment: ProgramEnrollment): Promise<void>;

  /**
   * Deletes an enrollment by its identity.
   *
   * Returns false when no enrollment row exists with that id, so callers can
   * treat a vanished enrollment (e.g. a concurrent leave) as the expected
   * NOT_ENROLLED outcome instead of an infrastructure failure.
   *
   * Deleting the enrollment does NOT delete the user's workout sessions: the
   * database detaches them (enrollment_id becomes null) so they remain
   * user-owned history that no longer counts toward any program.
   */
  delete(id: EnrollmentId): Promise<boolean>;
}
