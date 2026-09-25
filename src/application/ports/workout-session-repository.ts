/**
 * WorkoutSession repository port.
 *
 * Defines the contract that the in-memory (and future Drizzle) repository
 * must satisfy. The application layer depends only on this port.
 *
 * `save` is an upsert by session ID, supporting both insert and update.
 * It rejects concurrent conflicts with the typed errors below so use cases
 * can map them to business outcomes without seeing database details.
 */

import type { WorkoutSession } from '@/domain/entities/workout-session';
import type {
  EnrollmentId,
  ScheduledWorkoutId,
  WorkoutSessionId,
} from '@/domain/types/ids';
import type { CompletedWorkoutSession } from '@/application/ports/training-history-repository';

/**
 * Thrown by `save` when a second session for the same enrollment and
 * scheduled workout races the database's one-session-per-occurrence-per-
 * enrollment constraint. The caller should map this to the
 * `SESSION_ALREADY_EXISTS` business outcome.
 */
export class SessionAlreadyExistsError extends Error {
  constructor(readonly scheduledWorkoutId: string) {
    super(`A workout session already exists for scheduled workout "${scheduledWorkoutId}"`);
    this.name = 'SessionAlreadyExistsError';
  }
}

/**
 * Thrown by `save` when the session's enrollment no longer exists: a
 * concurrent leave deleted the enrollment between the caller's enrollment
 * check and the insert. The caller should re-check enrollment and map this
 * to the `NOT_ENROLLED` business outcome.
 */
export class SessionEnrollmentNotFoundError extends Error {
  constructor(readonly enrollmentId: string) {
    super(`Enrollment "${enrollmentId}" no longer exists; the session cannot attach to it`);
    this.name = 'SessionEnrollmentNotFoundError';
  }
}

/**
 * Thrown by `save` when the persisted session was modified concurrently after
 * the caller loaded its snapshot (optimistic-concurrency version mismatch).
 */
export class SessionStaleVersionError extends Error {
  constructor(readonly sessionId: string) {
    super(`Workout session "${sessionId}" was modified concurrently; reload and retry`);
    this.name = 'SessionStaleVersionError';
  }
}

/**
 * Thrown by `save` when the session's enrollment changed between the caller's
 * snapshot load and the write: the persisted row's enrollment_id no longer
 * matches the snapshot — a concurrent leave detached it via ON DELETE SET
 * NULL, or it was re-pointed. The mutation did not commit, so detached
 * history stays read-only. The caller should map this to the `NOT_ENROLLED`
 * business outcome.
 */
export class SessionEnrollmentChangedError extends Error {
  constructor(readonly sessionId: string) {
    super(
      `Workout session "${sessionId}" is no longer attached to the enrollment it was loaded under`,
    );
    this.name = 'SessionEnrollmentChangedError';
  }
}

/**
 * Thrown by `save` when PostgreSQL rejects the whole-aggregate write on the
 * partial unique index `exercise_logs_session_occurrence_key_unique` — the
 * database backstop for the domain's session-unique `occurrenceKey`
 * invariant. Distinguished from the one-session-per-(enrollment, scheduled
 * workout) constraint BY CONSTRAINT NAME, so a colliding/corrupt snapshot is
 * a typed data-integrity failure instead of `SessionAlreadyExistsError`.
 * Reaching it means the domain-enforced invariant was violated upstream of
 * the repository; it is a persistence-backstop outcome, not a business rule,
 * so use cases do not translate it — it propagates as an unexpected error.
 */
export class SessionOccurrenceKeyConflictError extends Error {
  constructor(readonly sessionId: string) {
    super(
      `Workout session "${sessionId}" has duplicate non-null occurrence keys; ` +
        'occurrence keys must be unique within a session',
    );
    this.name = 'SessionOccurrenceKeyConflictError';
  }
}

export interface WorkoutSessionRepository {
  /**
   * Finds a session by its unique ID, or null if not found.
   */
  findById(id: WorkoutSessionId): Promise<WorkoutSession | null>;

  /**
   * Finds a session by owning enrollment and scheduled workout occurrence, or
   * null if not found.
   *
   * There is at most one session per (enrollment, scheduled workout) pair, so
   * different users — and different enrollments of the same user — never see
   * each other's sessions.
   */
  findByEnrollmentAndScheduledWorkout(
    enrollmentId: EnrollmentId,
    scheduledWorkoutId: ScheduledWorkoutId,
  ): Promise<WorkoutSession | null>;

  /**
   * Saves a session (insert or update by session ID) and returns the
   * PERSISTED aggregate carrying the committed `version`.
   *
   * Updates of enrollment-owned sessions are conditional on the snapshot's
   * version AND its enrollment identity, so a leave (or any enrollment
   * change) between load and write makes the mutation a no-op instead of
   * mutating detached history.
   *
   * The versioning policy belongs to the repository, not to its callers: an
   * UPDATE commits `version + 1` while a first INSERT stores the snapshot's
   * own version. A caller that builds a DTO from a successful save MUST use
   * this return value and never the pre-save snapshot — otherwise the DTO
   * carries a version the database never held, and the caller's next
   * occurrence mutation would send that stale token as
   * `expectedSessionVersion` and be rejected with `SESSION_MODIFIED` despite
   * the preceding write having succeeded.
   *
   * May throw {@link SessionAlreadyExistsError},
   * {@link SessionEnrollmentNotFoundError}, {@link SessionStaleVersionError},
   * {@link SessionEnrollmentChangedError}, or
   * {@link SessionOccurrenceKeyConflictError}.
   */
  save(session: WorkoutSession): Promise<WorkoutSession>;

  /**
   * Returns the IDs of the scheduled workouts the enrollment has completed
   * sessions for, ordered by session start time ascending.
   *
   * This is the completion source for per-user program progress. It is a
   * lightweight projection: no full session aggregates, exercise logs, or set
   * logs are hydrated. Sessions detached from their enrollment (after leaving
   * a program) are excluded, so a rejoined program correctly starts with zero
   * progress. IDs are unique — the (enrollment, scheduled workout) constraint
   * admits at most one session per occurrence.
   */
  listCompletedScheduledWorkoutIds(
    enrollmentId: EnrollmentId,
  ): Promise<ReadonlyArray<ScheduledWorkoutId>>;

  /**
   * Returns the enrollment's COMPLETED sessions as fully hydrated
   * aggregates, ordered deterministically ascending by
   * `(completedAt, startedAt, session id)` — a total order even when
   * timestamps tie.
   *
   * Contract:
   * - Enrollment-scoped: sessions of other enrollments (including other
   *   users' enrollments) are excluded by enrollment identity, and detached
   *   sessions (enrollment_id nulled by a leave) can never match a non-null
   *   enrollment id.
   * - Completed sessions only: an in-progress session never appears. The
   *   returned aggregates carry a non-null `completedAt` by construction —
   *   this read reuses the established `CompletedWorkoutSession` narrowed
   *   type rather than inventing a second completed-session model.
   * - Fully hydrated: exercise logs and set logs ride the aggregate with all
   *   persisted truth intact — occurrence source provenance, authored and
   *   performed exercise identity, prescription/rest snapshots, skip state,
   *   occurrence keys, and ordering.
   * - Read in a bounded number of batched statements regardless of how many
   *   sessions the enrollment holds — never one query per session (no N+1).
   * - Pure read: no program-completion policy lives here. Whether these
   *   sessions complete the program is decided by the Domain.
   */
  listCompletedByEnrollment(
    enrollmentId: EnrollmentId,
  ): Promise<ReadonlyArray<CompletedWorkoutSession>>;
}