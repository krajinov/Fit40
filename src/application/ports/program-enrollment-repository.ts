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
 *
 * `replaceExpectedWithNew` is the one compare-and-replace capability: it
 * atomically swaps an EXPECTED enrollment for a fresh one, so a caller that
 * owns the lifecycle decision (e.g. restarting a completed program) never
 * has to compose a delete with a create and risk a committed intermediate
 * "not enrolled" state.
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

/**
 * Thrown by `replaceExpectedWithNew` when the row identified by `expectedId`
 * does not describe the same (userId, programId) identity as the replacement:
 * the compare-and-replace precondition is violated, so the operation is a
 * programming/state error rather than a business outcome. It is a
 * persistence-backstop outcome (like the session repository's occurrence-key
 * conflict): use cases do not translate it — it propagates as an unexpected
 * error — and the replacement transaction rolls back completely.
 */
export class EnrollmentIdentityMismatchError extends Error {
  constructor(
    readonly enrollmentId: string,
    readonly found: { readonly userId: string; readonly programId: string },
    readonly next: { readonly userId: string; readonly programId: string },
  ) {
    super(
      `Enrollment "${enrollmentId}" does not describe the same (user, program) identity as the replacement ` +
        `(found ${found.userId}/${found.programId}, replacement ${next.userId}/${next.programId})`,
    );
    this.name = 'EnrollmentIdentityMismatchError';
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

  /**
   * Atomically replaces the enrollment `expectedId` with `next` — the SAME
   * (userId, programId) identity — in ONE transaction: the targeted delete
   * and the insert either both commit or neither does. There is never a
   * committed state in which the user is unenrolled.
   *
   * Compare-and-replace contract:
   * - The delete targets `expectedId` ONLY. An enrollment created afterwards
   *   (e.g. by a concurrent replacement) has a different id and is NEVER
   *   deleted or replaced by this call.
   * - Returns true only when both steps committed: the old row is gone, its
   *   sessions detached (the workout_sessions enrollment FK's ON DELETE SET
   *   NULL, applied at commit), and `next` is the single live enrollment for
   *   the pair.
   * - Returns false when `expectedId` matches no row — a stale expected id.
   *   Nothing is inserted and no other enrollment is touched; the
   *   transaction commits as a no-op.
   * - The row found at `expectedId` must carry exactly `next`'s (userId,
   *   programId); otherwise the identity invariant is violated and
   *   {@link EnrollmentIdentityMismatchError} is thrown, rolling back
   *   everything.
   * - May throw {@link EnrollmentAlreadyExistsError} when the insert races
   *   the (user_id, program_id) unique constraint — translated for that
   *   constraint only. The whole transaction rolls back, so the old
   *   enrollment and its session attribution are preserved.
   * - Any other failure rolls back and propagates as an unexpected error
   *   (never translated).
   * - Identity-based replacement only: no completion, progress, or restart
   *   policy lives here. Whether a replacement is allowed is an
   *   Application/Domain decision made by the caller.
   */
  replaceExpectedWithNew(
    expectedId: EnrollmentId,
    next: ProgramEnrollment,
  ): Promise<boolean>;
}
