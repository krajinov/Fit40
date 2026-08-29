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
import type { EnrollmentId, ScheduledWorkoutId, WorkoutSessionId } from '@/domain/types/ids';

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
   * Saves a session (insert or update by session ID).
   *
   * May throw {@link SessionAlreadyExistsError},
   * {@link SessionEnrollmentNotFoundError}, or {@link SessionStaleVersionError}.
   */
  save(session: WorkoutSession): Promise<void>;

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
}