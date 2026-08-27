/**
 * WorkoutSession repository port.
 *
 * Defines the contract that the in-memory (and future Drizzle) repository
 * must satisfy. The application layer depends only on this port.
 *
 * `save` is an upsert by session ID, supporting both insert and update, and it
 * is a compare-and-swap on the session's `version`: a write only lands if the
 * stored aggregate is still at the revision the caller holds.
 */

import type { SessionVersion, WorkoutSession } from '@/domain/entities/workout-session';
import type { ScheduledWorkoutId, WorkoutSessionId } from '@/domain/types/ids';
import type { Result } from '@/lib/result';

/**
 * Persistence-neutral description of a save that could not be performed because
 * another session already owns the scheduled workout occurrence.
 *
 * Concurrent "start session" requests can race past the existence pre-check into
 * the database's unique constraint, which is what decides the winner.
 */
export interface ScheduledWorkoutConflict {
  readonly reason: 'scheduled-workout-conflict';
  readonly scheduledWorkoutId: string;
}

/**
 * Persistence-neutral description of a save rejected because the stored session
 * has moved on since the caller loaded it — optimistic concurrency.
 *
 * `expectedVersion` is the revision the caller's aggregate was built from; the
 * stored aggregate is at a newer one, so applying this save would lose writes.
 */
export interface ConcurrentModificationConflict {
  readonly reason: 'concurrent-modification';
  readonly sessionId: string;
  readonly expectedVersion: SessionVersion;
}

/** The expected ways a session save can be refused by storage. */
export type WorkoutSessionSaveConflict =
  | ScheduledWorkoutConflict
  | ConcurrentModificationConflict;

/**
 * Outcome of {@link WorkoutSessionRepository.save}. Resolves with the revision
 * now stored for the session, or with the expected conflict that stopped the
 * write. Every other storage failure is exceptional.
 */
export type SaveWorkoutSessionResult = Result<SessionVersion, WorkoutSessionSaveConflict>;

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
   * Saves a session (insert or update by session ID), conditioned on the
   * `version` the aggregate carries.
   *
   * The write advances the stored revision by one, and the resolved value is the
   * revision now stored, which callers hand back to the presentation layer so the
   * next save starts from the current state. A session whose stored revision has
   * moved on is rejected with `concurrent-modification`; a session claiming an
   * occurrence another session owns is rejected with `scheduled-workout-conflict`.
   * Neither leaves a trace behind: the whole aggregate write is one atomic unit.
   */
  save(session: WorkoutSession): Promise<SaveWorkoutSessionResult>;

  /**
   * Returns all completed sessions.
   */
  listCompleted(): Promise<ReadonlyArray<WorkoutSession>>;
}