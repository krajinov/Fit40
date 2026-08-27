/**
 * In-memory implementation of the WorkoutSessionRepository port.
 *
 * Stores sessions in a private Map. Read and write operations use
 * structuredClone to prevent accidental state mutation.
 *
 * Persistence limitations:
 * - Sessions reset when the Node process restarts.
 * - During Next.js dev-server recompilation, HMR may reset the module state.
 * - Not suitable for serverless environments without a shared store.
 *
 * A future Drizzle implementation will replace this class without changing
 * domain or application code.
 */

import type {
  SaveWorkoutSessionResult,
  WorkoutSessionRepository,
} from '@/application/ports/workout-session-repository';
import type { WorkoutSession } from '@/domain/entities/workout-session';
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
    // Mirror the unique constraint the Drizzle repository relies on: one session
    // per scheduled workout occurrence.
    const owner = [...this.sessionsById.values()].find(
      (existing) =>
        existing.scheduledWorkoutId === session.scheduledWorkoutId && existing.id !== session.id,
    );

    if (owner !== undefined) {
      return err({
        reason: 'scheduled-workout-conflict',
        scheduledWorkoutId: session.scheduledWorkoutId,
      });
    }

    this.sessionsById.set(session.id, structuredClone(session));

    return ok(undefined);
  }

  async listCompleted(): Promise<ReadonlyArray<WorkoutSession>> {
    return [...this.sessionsById.values()]
      .filter((session) => session.completedAt !== null)
      .sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime())
      .map((session) => structuredClone(session));
  }
}