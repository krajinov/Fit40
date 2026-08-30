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

import type { SetLog, WorkoutSession } from '@/domain/entities/workout-session';
import type {
  EnrollmentId,
  ExerciseId,
  ScheduledWorkoutId,
  UserId,
  WorkoutSessionId,
} from '@/domain/types/ids';
import type { RepPrescription } from '@/domain/value-objects/rep-prescription';

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
 * Read-side projection of the most recent completed performance of one
 * exercise by one user — the history input of the deterministic progressive
 * overload rules.
 *
 * It is a flat snapshot copied from the winning exercise log and its session:
 * the prescription the exercise was performed under, and the sets actually
 * logged. It deliberately carries no session coordinates (scheduled workout,
 * workout template, enrollment): overload decisions depend only on what the
 * user last did for the exercise, not on where in a program it happened.
 */
export interface LatestCompletedExercisePerformance {
  /** The exercise this performance is history for. */
  readonly exerciseId: ExerciseId;
  /** The completed session the winning exercise log belongs to. */
  readonly sessionId: WorkoutSessionId;
  /** Position of the exercise within that session's log list. */
  readonly exerciseOrder: number;
  /** When the winning session was completed. */
  readonly completedAt: Date;
  /** Prescription snapshot the exercise was performed under. */
  readonly prescription: RepPrescription;
  /** Sets logged for the exercise, ordered by set number. */
  readonly sets: ReadonlyArray<SetLog>;
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
   * Updates of enrollment-owned sessions are conditional on the snapshot's
   * version AND its enrollment identity, so a leave (or any enrollment
   * change) between load and write makes the mutation a no-op instead of
   * mutating detached history.
   *
   * May throw {@link SessionAlreadyExistsError},
   * {@link SessionEnrollmentNotFoundError}, {@link SessionStaleVersionError},
   * or {@link SessionEnrollmentChangedError}.
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

  /**
   * Returns the latest completed performance for each of the given exercises
   * that the user has performed in a completed session.
   *
   * Contract:
   * - Scopes to sessions OWNED by the user (`user_id`), regardless of
   *   enrollment: detached history (sessions left behind after leaving a
   *   program) is still the user's training past and therefore included.
   * - Only completed sessions contribute; in-progress sessions are ignored
   *   even when started more recently.
   * - At most one projection per exercise id. When several completed logs
   *   compete, the winner is the most recent by the deterministic ladder:
   *   `completed_at` desc, then `started_at` desc, then session id desc, then
   *   `exercise_order` desc (a repeated exercise inside one session resolves
   *   to its later position).
   * - Requested exercises with no completed performance are absent from the
   *   result; callers treat absence as "no overload history".
   * - An empty `exerciseIds` returns an empty result without querying.
   * - The result is ordered by exercise id ascending, and each projection is
   *   an isolated snapshot: mutating it never affects stored sessions.
   */
  listLatestCompletedExercisePerformances(
    userId: UserId,
    exerciseIds: ReadonlyArray<ExerciseId>,
  ): Promise<ReadonlyArray<LatestCompletedExercisePerformance>>;
}