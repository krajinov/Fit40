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
import type { EnrollmentId, ProgramId, ScheduledWorkoutId, UserId } from '@/domain/types/ids';

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

/**
 * The run-scoped execution facts restartability is defined over, read by the
 * repository UNDER the enrollment lock — never before it and never from the
 * caller's pre-read. `completedIds` are the run's completed authored
 * occurrences (M14); `notPerformedIds` its recorded not-performed facts (M17).
 */
export interface LockedRunSettlementFacts {
  readonly completedIds: ReadonlyArray<ScheduledWorkoutId>;
  readonly notPerformedIds: ReadonlyArray<ScheduledWorkoutId>;
}

/**
 * The restartability decision `replaceExpectedWithNew` evaluates over the
 * CURRENT settlement facts, under the same enrollment lock that performs the
 * replacement.
 *
 * Ownership: the Application owns this rule (it is the Domain's
 * `isRunRestartable` composed from `isProgramComplete` and `isRunConcluded`,
 * closed over the authored program the caller loaded); the repository never
 * authors it, never re-evaluates it and never lets SQL choose its outcome. This
 * is the SAME decision the caller makes before the write, re-evaluated on the
 * authoritative state — so a stale request that read a settled run, but whose
 * facts changed (e.g. an Undo reopened the run) before this transaction took
 * authority, is refused here instead of replacing an open run.
 */
export type RestartabilityDecision = (facts: LockedRunSettlementFacts) => boolean;

/**
 * The outcome of a compare-and-replace attempt.
 *
 * - `replaced` — the expected row was owned, the current facts satisfied the
 *   supplied restartability decision, and the swap committed;
 * - `stale` — no row held `expectedId`: a newer enrollment (or none) is
 *   current. Nothing was written;
 * - `not-restartable` — the expected row existed but the CURRENT facts no
 *   longer satisfy the supplied decision, so the replacement is refused with
 *   ZERO writes and the old enrollment remains.
 */
export type ReplaceEnrollmentOutcome =
  | { readonly kind: 'replaced' }
  | { readonly kind: 'stale' }
  | { readonly kind: 'not-restartable' };

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
   * (userId, programId) identity — in ONE transaction, PROVIDED the run is
   * still restartable under that transaction's own authority.
   *
   * The three steps run under ONE lock on the expected enrollment row:
   * 1. the row at `expectedId` is owned first (`SELECT … FOR NO KEY UPDATE`,
   *    the same strength and order the settlement writes use);
   * 2. while that authority is held, the run's CURRENT settlement facts
   *    (completed occurrence ids and recorded not-performed ids) are read;
   * 3. the caller-supplied {@link RestartabilityDecision} is evaluated over
   *    those facts, and only then does the existing delete+insert run.
   *
   * Compare-and-replace contract:
   * - The delete targets `expectedId` ONLY. An enrollment created afterwards
   *   (e.g. by a concurrent replacement) has a different id and is NEVER
   *   deleted or replaced by this call.
   * - Returns `replaced` only when the row was owned, the decision passed over
   *   the locked facts, and both steps committed: the old row is gone, its
   *   sessions detached (the workout_sessions enrollment FK's ON DELETE SET
   *   NULL, applied at commit), and `next` is the single live enrollment for
   *   the pair.
   * - Returns `stale` when `expectedId` matches no row — a stale expected id.
   *   Nothing is inserted and no other enrollment is touched; the transaction
   *   commits as a no-op.
   * - Returns `not-restartable` when the row existed but the decision fails on
   *   the CURRENT facts (e.g. an Undo reopened the run after the caller's
   *   pre-read). ZERO writes: the delete, the insert and the FK's session
   *   detachment never run, and the old enrollment remains exactly as it was.
   *   The decision is evaluated here — under the replacement's own authority —
   *   precisely so the final delete/replace never relies on the caller's
   *   pre-read.
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
   *   FORMULA lives here. The caller supplies the Domain's restartability rule
   *   as `isStillRestartable`; the repository only gathers the locked facts and
   *   executes the decision it is given.
   */
  replaceExpectedWithNew(
    expectedId: EnrollmentId,
    next: ProgramEnrollment,
    isStillRestartable: RestartabilityDecision,
  ): Promise<ReplaceEnrollmentOutcome>;
}
