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

import {
  SessionAlreadyExistsError,
  type WorkoutSessionRepository,
} from '@/application/ports/workout-session-repository';
import type { WorkoutSession } from '@/domain/entities/workout-session';
import type { EnrollmentId, ScheduledWorkoutId, WorkoutSessionId } from '@/domain/types/ids';

export class InMemoryWorkoutSessionRepository implements WorkoutSessionRepository {
  private readonly sessionsById = new Map<string, WorkoutSession>();

  async findById(id: WorkoutSessionId): Promise<WorkoutSession | null> {
    const session = this.sessionsById.get(id);
    return session ? structuredClone(session) : null;
  }

  async findByEnrollmentAndScheduledWorkout(
    enrollmentId: EnrollmentId,
    scheduledWorkoutId: ScheduledWorkoutId,
  ): Promise<WorkoutSession | null> {
    for (const session of this.sessionsById.values()) {
      if (
        session.enrollmentId === enrollmentId &&
        session.scheduledWorkoutId === scheduledWorkoutId
      ) {
        return structuredClone(session);
      }
    }
    return null;
  }

  async save(session: WorkoutSession): Promise<void> {
    // Mirror the database's one-session-per-(enrollment, occurrence) unique
    // constraint so use-case tests observe the same race outcome. Detached
    // sessions (null enrollment) never collide, matching PostgreSQL.
    for (const existing of this.sessionsById.values()) {
      if (
        existing.id !== session.id &&
        session.enrollmentId !== null &&
        existing.enrollmentId === session.enrollmentId &&
        existing.scheduledWorkoutId === session.scheduledWorkoutId
      ) {
        throw new SessionAlreadyExistsError(session.scheduledWorkoutId);
      }
    }
    this.sessionsById.set(session.id, structuredClone(session));
  }

  async listCompletedScheduledWorkoutIds(
    enrollmentId: EnrollmentId,
  ): Promise<ReadonlyArray<ScheduledWorkoutId>> {
    // Mirrors the SQL projection: completed sessions only, ordered by start
    // time, deduplicated (save() already enforces one session per occurrence;
    // the Set documents that contract explicitly).
    const ids = new Set<ScheduledWorkoutId>();
    const completed = [...this.sessionsById.values()]
      .filter(
        (session) => session.enrollmentId === enrollmentId && session.completedAt !== null,
      )
      .sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime());
    for (const session of completed) {
      ids.add(session.scheduledWorkoutId);
    }
    return [...ids];
  }
}