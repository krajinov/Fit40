/**
 * WorkoutSession repository port.
 *
 * Defines the contract that the in-memory (and future Drizzle) repository
 * must satisfy. The application layer depends only on this port.
 *
 * `save` is an upsert by session ID, supporting both insert and update.
 */

import type { WorkoutSession } from '@/domain/entities/workout-session';
import type { ScheduledWorkoutId, WorkoutSessionId } from '@/domain/types/ids';

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
   */
  save(session: WorkoutSession): Promise<void>;

  /**
   * Returns all completed sessions.
   */
  listCompleted(): Promise<ReadonlyArray<WorkoutSession>>;
}