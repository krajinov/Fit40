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
import type { Result } from '@/lib/result';

/**
 * Persistence-neutral description of a save that could not be performed because
 * another session already owns the scheduled workout occurrence.
 *
 * Only this conflict is modelled: sessions are unique per scheduled workout, and
 * concurrent "start session" requests can race past the existence pre-check into
 * the database's unique constraint. Every other storage failure is exceptional.
 */
export interface ScheduledWorkoutConflict {
  readonly reason: 'scheduled-workout-conflict';
  readonly scheduledWorkoutId: string;
}

/**
 * Outcome of {@link WorkoutSessionRepository.save}. Resolves with no data on
 * success; `err` carries the one expected persistence conflict.
 */
export type SaveWorkoutSessionResult = Result<void, ScheduledWorkoutConflict>;

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
   * Returns a `SaveWorkoutSessionResult` so callers can map the one expected
   * conflict — another session owning the same scheduled workout — to a typed
   * application error. Unexpected storage failures are thrown.
   */
  save(session: WorkoutSession): Promise<SaveWorkoutSessionResult>;

  /**
   * Returns all completed sessions.
   */
  listCompleted(): Promise<ReadonlyArray<WorkoutSession>>;
}