import { asc, eq, inArray, isNotNull } from 'drizzle-orm';

import type { WorkoutSessionRepository } from '@/application/ports/workout-session-repository';
import type { WorkoutSession } from '@/domain/entities/workout-session';
import type { ScheduledWorkoutId, WorkoutSessionId } from '@/domain/types/ids';

import type { Database } from '../client';
import {
  mapExerciseLogToRow,
  mapSessionRows,
  mapSessionToRow,
  mapSetToRow,
} from '../mappers/session-mapper';
import { exerciseLogs, setLogs, workoutSessions } from '../schema';

/**
 * Infrastructure-level conflict error raised when a second session for the same
 * scheduled workout races against the database unique constraint.
 */
export class WorkoutSessionConflictError extends Error {
  constructor(scheduledWorkoutId: string) {
    super(`A workout session already exists for scheduled workout "${scheduledWorkoutId}"`);
    this.name = 'WorkoutSessionConflictError';
  }
}

function errorCode(error: unknown): unknown {
  if (typeof error !== 'object' || error === null) {
    return undefined;
  }

  const candidate = error as { code?: unknown; cause?: unknown };
  if (candidate.code !== undefined) {
    return candidate.code;
  }

  return errorCode(candidate.cause);
}

function isUniqueViolation(error: unknown): boolean {
  return errorCode(error) === '23505';
}

type SessionRow = typeof workoutSessions.$inferSelect;

/**
 * Drizzle implementation of the WorkoutSessionRepository port.
 *
 * `save` persists the whole aggregate in one transaction using delete-and-
 * reinsert for children, which is the simplest correct strategy at this scale.
 */
export class DrizzleWorkoutSessionRepository implements WorkoutSessionRepository {
  constructor(private readonly db: Database) {}

  async findById(id: WorkoutSessionId): Promise<WorkoutSession | null> {
    const rows = await this.db
      .select()
      .from(workoutSessions)
      .where(eq(workoutSessions.id, id))
      .limit(1);

    const session = rows[0];
    return session === undefined ? null : this.hydrate(session);
  }

  async findByScheduledWorkoutId(id: ScheduledWorkoutId): Promise<WorkoutSession | null> {
    const rows = await this.db
      .select()
      .from(workoutSessions)
      .where(eq(workoutSessions.scheduledWorkoutId, id))
      .limit(1);

    const session = rows[0];
    return session === undefined ? null : this.hydrate(session);
  }

  async listCompleted(): Promise<ReadonlyArray<WorkoutSession>> {
    const sessionRows = await this.db
      .select()
      .from(workoutSessions)
      .where(isNotNull(workoutSessions.completedAt));

    if (sessionRows.length === 0) {
      return [];
    }

    const sessionIds = sessionRows.map((row) => row.id);
    const logRows = await this.db
      .select()
      .from(exerciseLogs)
      .where(inArray(exerciseLogs.sessionId, sessionIds))
      .orderBy(asc(exerciseLogs.sessionId), asc(exerciseLogs.exerciseOrder));
    const setRows = await this.db
      .select()
      .from(setLogs)
      .where(inArray(setLogs.sessionId, sessionIds))
      .orderBy(
        asc(setLogs.sessionId),
        asc(setLogs.exerciseOrder),
        asc(setLogs.setNumber),
      );

    return sessionRows.map((session) =>
      mapSessionRows({
        session,
        exerciseLogs: logRows.filter((row) => row.sessionId === session.id),
        setLogs: setRows.filter((row) => row.sessionId === session.id),
      }),
    );
  }

  async save(session: WorkoutSession): Promise<void> {
    try {
      await this.db.transaction(async (tx) => {
        await tx
          .insert(workoutSessions)
          .values(mapSessionToRow(session))
          .onConflictDoUpdate({
            target: workoutSessions.id,
            set: {
              scheduledWorkoutId: session.scheduledWorkoutId,
              workoutId: session.workoutId,
              startedAt: session.startedAt,
              completedAt: session.completedAt,
            },
          });

        await tx.delete(setLogs).where(eq(setLogs.sessionId, session.id));
        await tx.delete(exerciseLogs).where(eq(exerciseLogs.sessionId, session.id));

        for (const log of session.exerciseLogs) {
          await tx.insert(exerciseLogs).values(mapExerciseLogToRow(session.id, log));
          for (const set of log.sets) {
            await tx.insert(setLogs).values(mapSetToRow(session.id, log.order, set));
          }
        }
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new WorkoutSessionConflictError(session.scheduledWorkoutId);
      }
      throw error;
    }
  }

  private async hydrate(session: SessionRow): Promise<WorkoutSession> {
    const logRows = await this.db
      .select()
      .from(exerciseLogs)
      .where(eq(exerciseLogs.sessionId, session.id))
      .orderBy(asc(exerciseLogs.exerciseOrder));
    const setRows = await this.db
      .select()
      .from(setLogs)
      .where(eq(setLogs.sessionId, session.id))
      .orderBy(asc(setLogs.exerciseOrder), asc(setLogs.setNumber));

    return mapSessionRows({
      session,
      exerciseLogs: logRows,
      setLogs: setRows,
    });
  }
}
