/**
 * In-memory implementation of the WorkoutSessionRepository port.
 *
 * Stores sessions in a private Map. Read and write operations use
 * structuredClone to prevent accidental state mutation.
 *
 * Concurrency contract, mirrored from the Drizzle repository so both stay
 * behaviorally interchangeable:
 * - a save is a compare-and-swap on `version`; a stale aggregate is refused with
 *   `concurrent-modification` instead of overwriting newer state,
 * - an accepted save advances the stored revision and returns it,
 * - at most one session may own a scheduled workout occurrence.
 *
 * Persistence limitations:
 * - Sessions reset when the Node process restarts.
 * - During Next.js dev-server recompilation, HMR may reset the module state.
 * - Not suitable for serverless environments without a shared store.
 */

import type {
  SaveWorkoutSessionResult,
  WorkoutSessionRepository,
} from '@/application/ports/workout-session-repository';
import type { SessionVersion, WorkoutSession } from '@/domain/entities/workout-session';
import type { ScheduledWorkoutId, WorkoutSessionId } from '@/domain/types/ids';
import { err, ok } from '@/lib/result';

export class InMemoryWorkoutSessionRepository implements WorkoutSessionRepository {
  private readonly sessionsById = new Map<string, WorkoutSession>();

  async findById(id: WorkoutSessionId): Promise<WorkoutSession | null> {
    const session = this.sessionsById.get(id);
    return session ? structuredClone(session) : null;
  }

  async findByScheduledWorkoutId(id: ScheduledWorkoutId): Promise<WorkoutSession | null> {
    for (const session of this.sessionsById.values()) {
      if (session.scheduledWorkoutId === id) {
        return structuredClone(session);
      }
    }
    return null;
  }

  async save(session: WorkoutSession): Promise<SaveWorkoutSessionResult> {
    const stored = this.sessionsById.get(session.id);

    if (stored === undefined) {
      return this.insert(session);
    }

    return this.compareAndSwap(stored, session);
  }

  async listCompleted(): Promise<ReadonlyArray<WorkoutSession>> {
    return [...this.sessionsById.values()]
      .filter((session) => session.completedAt !== null)
      .sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime())
      .map((session) => structuredClone(session));
  }

  /**
   * Stores a session that has never been saved, refusing the one insert the
   * database would refuse: a session cannot claim an occurrence another session
   * already owns.
   */
  private insert(session: WorkoutSession): SaveWorkoutSessionResult {
    const owner = [...this.sessionsById.values()].find(
      (existing) =>
        existing.scheduledWorkoutId === session.scheduledWorkoutId &&
        existing.id !== session.id,
    );

    if (owner !== undefined) {
      return err({
        reason: 'scheduled-workout-conflict',
        scheduledWorkoutId: session.scheduledWorkoutId,
      });
    }

    this.sessionsById.set(session.id, structuredClone(session));

    return ok(session.version);
  }

  /** Advances the stored revision only while it still matches what was loaded. */
  private compareAndSwap(
    stored: WorkoutSession,
    session: WorkoutSession,
  ): SaveWorkoutSessionResult {
    if (stored.version !== session.version) {
      return err({
        reason: 'concurrent-modification',
        sessionId: session.id,
        expectedVersion: session.version,
      });
    }

    const version: SessionVersion = stored.version + 1;
    this.sessionsById.set(session.id, structuredClone({ ...session, version }));

    return ok(version);
  }
}