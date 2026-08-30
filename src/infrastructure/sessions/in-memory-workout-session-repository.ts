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
  SessionEnrollmentChangedError,
  type LatestCompletedExercisePerformance,
  type WorkoutSessionRepository,
} from '@/application/ports/workout-session-repository';
import type { ExerciseLog, WorkoutSession } from '@/domain/entities/workout-session';
import type {
  EnrollmentId,
  ExerciseId,
  ScheduledWorkoutId,
  UserId,
  WorkoutSessionId,
} from '@/domain/types/ids';

/**
 * Coordinates identifying one candidate exercise log in the recency ladder.
 */
interface PerformanceCandidate {
  readonly completedAt: Date;
  readonly startedAt: Date;
  readonly sessionId: string;
  readonly exerciseOrder: number;
}

/**
 * Deterministic recency ladder shared with the SQL projection: completed_at
 * desc, then started_at desc, then session id desc, then exercise order desc
 * (a repeated exercise inside one session resolves to its later position).
 * Returns true when `candidate` beats `incumbent`.
 */
function beatsRecencyLadder(
  candidate: PerformanceCandidate,
  incumbent: PerformanceCandidate,
): boolean {
  if (candidate.completedAt.getTime() !== incumbent.completedAt.getTime()) {
    return candidate.completedAt.getTime() > incumbent.completedAt.getTime();
  }
  if (candidate.startedAt.getTime() !== incumbent.startedAt.getTime()) {
    return candidate.startedAt.getTime() > incumbent.startedAt.getTime();
  }
  if (candidate.sessionId !== incumbent.sessionId) {
    return candidate.sessionId > incumbent.sessionId;
  }
  return candidate.exerciseOrder > incumbent.exerciseOrder;
}

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

  async listLatestCompletedExercisePerformances(
    userId: UserId,
    exerciseIds: ReadonlyArray<ExerciseId>,
  ): Promise<ReadonlyArray<LatestCompletedExercisePerformance>> {
    if (exerciseIds.length === 0) {
      return [];
    }

    const winners = this.reduceToLatestPerExercise(userId, new Set(exerciseIds));

    // Exercise-id ascending, mirroring the SQL projection's ORDER BY. The
    // result is an isolated snapshot via structuredClone, like every read.
    return structuredClone(
      [...winners.entries()]
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([exerciseId, winner]) => ({
          exerciseId,
          sessionId: winner.session.id,
          exerciseOrder: winner.log.order,
          completedAt: winner.completedAt,
          prescription: winner.log.prescription,
          sets: winner.log.sets,
        })),
    );
  }

  /**
   * Reduces every completed exercise log the user owns to one winner per
   * requested exercise, using the deterministic recency ladder. Completed
   * sessions only — in-progress sessions never contribute. Logs with zero
   * sets (skipped exercises) never contribute either, mirroring the SQL
   * projection's EXISTS filter.
   */
  private reduceToLatestPerExercise(
    userId: UserId,
    wanted: ReadonlySet<ExerciseId>,
  ): Map<ExerciseId, { session: WorkoutSession; log: ExerciseLog; completedAt: Date }> {
    const winners = new Map<
      ExerciseId,
      { session: WorkoutSession; log: ExerciseLog; completedAt: Date }
    >();

    for (const session of this.sessionsById.values()) {
      const completedAt = session.completedAt;
      if (session.userId !== userId || completedAt === null) {
        continue;
      }
      for (const log of session.exerciseLogs) {
        if (!wanted.has(log.exerciseId)) {
          continue;
        }
        // Mirrors the SQL EXISTS filter: a log with zero sets is a skipped
        // exercise, not a performance — it never enters the recency ladder,
        // so an older real performance still wins.
        if (log.sets.length === 0) {
          continue;
        }
        const current = winners.get(log.exerciseId);
        if (
          current === undefined ||
          beatsRecencyLadder(
            {
              completedAt,
              startedAt: session.startedAt,
              sessionId: session.id,
              exerciseOrder: log.order,
            },
            {
              completedAt: current.completedAt,
              startedAt: current.session.startedAt,
              sessionId: current.session.id,
              exerciseOrder: current.log.order,
            },
          )
        ) {
          winners.set(log.exerciseId, { session, log, completedAt });
        }
      }
    }

    return winners;
  }
}