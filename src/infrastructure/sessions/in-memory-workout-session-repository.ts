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

import type { CompletedWorkoutSession } from '@/application/ports/training-history-repository';
import {
  SessionAlreadyExistsError,
  SessionEnrollmentChangedError,
  SessionStaleVersionError,
  type WorkoutSessionRepository,
} from '@/application/ports/workout-session-repository';
import type { WorkoutSession } from '@/domain/entities/workout-session';
import type {
  EnrollmentId,
  ScheduledWorkoutId,
  WorkoutSessionId,
} from '@/domain/types/ids';

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

  async save(session: WorkoutSession): Promise<WorkoutSession> {
    // Mirror the database's write protection: an update of an existing row
    // whose enrollment no longer matches the caller's snapshot (detached by
    // a concurrent leave, or re-pointed) must not commit, so use-case tests
    // observe the same detached-history race outcome as PostgreSQL.
    const existing = this.sessionsById.get(session.id);
    if (
      existing !== undefined &&
      session.enrollmentId !== null &&
      existing.enrollmentId !== session.enrollmentId
    ) {
      throw new SessionEnrollmentChangedError(session.id);
    }

    // Mirror the database's one-session-per-(enrollment, occurrence) unique
    // constraint so use-case tests observe the same race outcome. Detached
    // sessions (null enrollment) never collide, matching PostgreSQL.
    for (const other of this.sessionsById.values()) {
      if (
        other.id !== session.id &&
        session.enrollmentId !== null &&
        other.enrollmentId === session.enrollmentId &&
        other.scheduledWorkoutId === session.scheduledWorkoutId
      ) {
        throw new SessionAlreadyExistsError(session.scheduledWorkoutId);
      }
    }
    // Optimistic concurrency, mirroring the Drizzle implementation exactly:
    // an UPDATE of an existing row must carry the version the caller READ,
    // and only the update path bumps the stored version by one — a first
    // save (INSERT, no existing row) stores the snapshot's own version,
    // like the SQL upsert's insert branch. A stale snapshot is rejected
    // instead of silently overwriting concurrent changes, so use-case tests
    // observe the same race outcome as PostgreSQL.
    if (existing !== undefined && existing.version !== session.version) {
      throw new SessionStaleVersionError(session.id);
    }
    // The returned aggregate carries the COMMITTED version (the port's
    // contract): the same two-branch policy the SQL upsert applies, so a
    // caller building a DTO from this return value never sends a version the
    // store did not hold. Both the stored copy and the returned copy are
    // clones, preserving this repository's mutation isolation.
    const persisted: WorkoutSession =
      existing === undefined ? session : { ...session, version: session.version + 1 };
    this.sessionsById.set(session.id, structuredClone(persisted));
    return structuredClone(persisted);
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

  async listInProgressScheduledWorkoutIds(
    enrollmentId: EnrollmentId,
  ): Promise<ReadonlyArray<ScheduledWorkoutId>> {
    // Mirrors the SQL projection: exact enrollment match (a detached null
    // never equals a non-null enrollment id, so detached and other
    // enrollments are excluded structurally), in-progress only
    // (completedAt === null), ordered by (startedAt, session id) ascending —
    // the completed projection's started_at ladder plus the same deterministic
    // id tie-break. save() already enforces one session per occurrence, so ids
    // are unique without deduplication. Returned values are primitive ids, so
    // the result can never reach back into stored state.
    return [...this.sessionsById.values()]
      .filter(
        (session) => session.enrollmentId === enrollmentId && session.completedAt === null,
      )
      .sort(
        (a, b) =>
          a.startedAt.getTime() - b.startedAt.getTime() ||
          (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
      )
      .map((session) => session.scheduledWorkoutId);
  }

  async listCompletedByEnrollment(
    enrollmentId: EnrollmentId,
  ): Promise<ReadonlyArray<CompletedWorkoutSession>> {
    // Mirrors the SQL read exactly: exact enrollment match (a detached null
    // never equals a non-null enrollment id, so detached and other
    // enrollments are excluded structurally), completed only, ordered by the
    // port's total ladder — (completedAt, startedAt, session id) ascending.
    // Session ids compare byte-wise, matching the database's text tie-break
    // for the ASCII id values this store uses.
    const completed = [...this.sessionsById.values()]
      .filter(
        (session): session is CompletedWorkoutSession =>
          session.enrollmentId === enrollmentId && session.completedAt !== null,
      )
      .sort(
        (a, b) =>
          a.completedAt.getTime() - b.completedAt.getTime() ||
          a.startedAt.getTime() - b.startedAt.getTime() ||
          (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
      );

    // Defensive clones per this repository's mutation-isolation convention:
    // returned aggregates can never reach back into stored state.
    return completed.map((session) => structuredClone(session));
  }
}