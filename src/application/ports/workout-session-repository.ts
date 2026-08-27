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
import type { ScheduledWorkoutId, WorkoutSessionId } from '@/domain/types/ids';

/**
 * Thrown by `save` when a second session for the same scheduled workout races
 * the database's one-session-per-occurrence constraint. The caller should map
 * this to the `SESSION_ALREADY_EXISTS` business outcome.
 */
export class SessionAlreadyExistsError extends Error {
  constructor(readonly scheduledWorkoutId: string) {
    super(`A workout session already exists for scheduled workout "${scheduledWorkoutId}"`);
    this.name = 'SessionAlreadyExistsError';
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
   * Finds a session by the scheduled workout occurrence ID, or null if not found.
   *
   * There is at most one session per scheduled workout in this MVP.
   */
  findByScheduledWorkoutId(id: ScheduledWorkoutId): Promise<WorkoutSession | null>;

  /**
   * Saves a session (insert or update by session ID).
   *
   * May throw {@link SessionAlreadyExistsError} or {@link SessionStaleVersionError}.
   */
  save(session: WorkoutSession): Promise<void>;

  /**
   * Returns all completed sessions.
   */
  listCompleted(): Promise<ReadonlyArray<WorkoutSession>>;
}