import type {
  SaveWorkoutSessionResult,
  WorkoutSessionRepository,
} from '@/application/ports/workout-session-repository';
import type { SessionVersion, WorkoutSession } from '@/domain/entities/workout-session';
import type { ScheduledWorkoutId, WorkoutSessionId } from '@/domain/types/ids';
import { err, ok } from '@/lib/result';

import { and, eq, isNotNull } from 'drizzle-orm';

import { exerciseLogToRow, setLogToRow } from '../mappers/session-mapper';
import { exerciseLogs, setLogs, workoutSessions } from '../schema';
import { loadSessionAggregate, loadSessionAggregates } from './session-aggregate-loader';
import { isUniqueViolation } from './pg-constraint-violation';

import type { DrizzleDatabase, DrizzleTransaction } from './types';

/** Unique constraint backing "at most one session per scheduled workout". */
const SCHEDULED_WORKOUT_UNIQUE_CONSTRAINT = 'workout_sessions_scheduled_workout_id';

/**
 * Raised from inside the save transaction when the stored session is no longer at
 * the revision the caller loaded. It unwinds the transaction before anything is
 * written, and `save` translates it into the port's neutral conflict.
 */
class StaleSessionSaveError extends Error {
  constructor(readonly expectedVersion: SessionVersion) {
    super(`Workout session revision ${expectedVersion} is no longer current`);
  }
}

export class DrizzleWorkoutSessionRepository implements WorkoutSessionRepository {
  constructor(private readonly db: DrizzleDatabase) {}

  async findById(id: WorkoutSessionId): Promise<WorkoutSession | null> {
    const rows = await this.db.select().from(workoutSessions).where(eq(workoutSessions.id, id));
    const row = rows[0];

    if (row === undefined) {
      return null;
    }

    return loadSessionAggregate(this.db, row);
  }

  async findByScheduledWorkoutId(id: ScheduledWorkoutId): Promise<WorkoutSession | null> {
    const rows = await this.db.select().from(workoutSessions).where(eq(workoutSessions.scheduledWorkoutId, id));
    const row = rows[0];

    if (row === undefined) {
      return null;
    }

    return loadSessionAggregate(this.db, row);
  }

  /**
   * Compare-and-swap on `version`: the stored row is advanced only while it is
   * still at the revision the caller holds. When nothing matches, the session has
   * never been stored and is inserted — and if that insert loses on the primary
   * key, somebody else wrote this session first. Child rows are replaced wholesale
   * inside the same transaction, so a refused save leaves no trace and an accepted
   * one stores exactly the aggregate it was handed.
   */
  async save(session: WorkoutSession): Promise<SaveWorkoutSessionResult> {
    try {
      const version = await this.db.transaction((tx) => this.writeAggregate(tx, session));
      return ok(version);
    } catch (error) {
      // The transaction has already rolled back. Both conflicts are decided by
      // storage, so they become the port's persistence-neutral results rather than
      // PostgreSQL errors traveling up into application code.
      if (error instanceof StaleSessionSaveError) {
        return err({
          reason: 'concurrent-modification',
          sessionId: session.id,
          expectedVersion: error.expectedVersion,
        });
      }

      if (isScheduledWorkoutConflict(error)) {
        return err({
          reason: 'scheduled-workout-conflict',
          scheduledWorkoutId: session.scheduledWorkoutId,
        });
      }

      throw error;
    }
  }

  private async writeAggregate(
    tx: DrizzleTransaction,
    session: WorkoutSession,
  ): Promise<SessionVersion> {
    const [updated] = await tx
      .update(workoutSessions)
      .set({
        scheduledWorkoutId: session.scheduledWorkoutId,
        workoutId: session.workoutId,
        startedAt: session.startedAt,
        completedAt: session.completedAt,
        version: session.version + 1,
      })
      .where(
        and(eq(workoutSessions.id, session.id), eq(workoutSessions.version, session.version)),
      )
      .returning({ version: workoutSessions.version });

    if (updated !== undefined) {
      await this.replaceChildRows(tx, session);
      return updated.version;
    }

    // Nothing matched the caller's revision. A session that has never been stored
    // lands here; one that was written in the meantime is refused by its primary
    // key. Claiming an occurrence another session owns still surfaces as a unique
    // violation on `scheduled_workout_id`, which that conflict target keeps live.
    const [inserted] = await tx
      .insert(workoutSessions)
      .values({
        id: session.id,
        scheduledWorkoutId: session.scheduledWorkoutId,
        workoutId: session.workoutId,
        startedAt: session.startedAt,
        completedAt: session.completedAt,
        version: session.version,
      })
      .onConflictDoNothing({ target: workoutSessions.id })
      .returning({ version: workoutSessions.version });

    if (inserted === undefined) {
      throw new StaleSessionSaveError(session.version);
    }

    await this.replaceChildRows(tx, session);
    return inserted.version;
  }

  private async replaceChildRows(
    tx: DrizzleTransaction,
    session: WorkoutSession,
  ): Promise<void> {
    await tx.delete(setLogs).where(eq(setLogs.sessionId, session.id));
    await tx.delete(exerciseLogs).where(eq(exerciseLogs.sessionId, session.id));

    for (const log of session.exerciseLogs) {
      await tx.insert(exerciseLogs).values(exerciseLogToRow(session.id, log.order, log));

      for (const set of log.sets) {
        await tx.insert(setLogs).values(setLogToRow(session.id, log.order, set));
      }
    }
  }

  async listCompleted(): Promise<ReadonlyArray<WorkoutSession>> {
    const rows = await this.db
      .select()
      .from(workoutSessions)
      .where(isNotNull(workoutSessions.completedAt))
      .orderBy(workoutSessions.startedAt);

    if (rows.length === 0) {
      return [];
    }

    return loadSessionAggregates(this.db, rows);
  }
}

/**
 * True when PostgreSQL rejected the write because another session already owns
 * this scheduled workout (SQLSTATE 23505 on the sessions unique constraint).
 */
function isScheduledWorkoutConflict(error: unknown): boolean {
  return isUniqueViolation(error, SCHEDULED_WORKOUT_UNIQUE_CONSTRAINT);
}
