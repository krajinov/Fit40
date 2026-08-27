import type { WorkoutSessionRepository } from '@/application/ports/workout-session-repository';
import type { WorkoutSession } from '@/domain/entities/workout-session';
import type { ScheduledWorkoutId, WorkoutSessionId } from '@/domain/types/ids';

import { eq, inArray, isNotNull } from 'drizzle-orm';

import { exerciseLogToRow, sessionToDomain, setLogToRow } from '../mappers/session-mapper';
import { exerciseLogs, setLogs, workoutSessions } from '../schema';

import type { DrizzleDatabase } from './types';

export class WorkoutSessionConflictError extends Error {
  constructor(
    message: string,
    public readonly scheduledWorkoutId: string,
  ) {
    super(message);
    this.name = 'WorkoutSessionConflictError';
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

    return this.loadSession(row);
  }

  async findByScheduledWorkoutId(id: ScheduledWorkoutId): Promise<WorkoutSession | null> {
    const rows = await this.db.select().from(workoutSessions).where(eq(workoutSessions.scheduledWorkoutId, id));
    const row = rows[0];

    if (row === undefined) {
      return null;
    }

    return this.loadSession(row);
  }

  async save(session: WorkoutSession): Promise<void> {
    try {
      await this.db.transaction(async (tx) => {
        const sessionValues = {
          id: session.id,
          scheduledWorkoutId: session.scheduledWorkoutId,
          workoutId: session.workoutId,
          startedAt: session.startedAt,
          completedAt: session.completedAt,
        };

        await tx
          .insert(workoutSessions)
          .values(sessionValues)
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
          await tx
            .insert(exerciseLogs)
            .values(exerciseLogToRow(session.id, log.order, log));

          for (const set of log.sets) {
            await tx.insert(setLogs).values(setLogToRow(session.id, log.order, set));
          }
        }
      });
    } catch (error) {
      if (isUniqueViolation(error, 'scheduled_workout_id')) {
        throw new WorkoutSessionConflictError(
          `A session already exists for scheduled workout "${session.scheduledWorkoutId}"`,
          session.scheduledWorkoutId,
        );
      }

      throw error;
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

    return this.loadSessions(rows);
  }

  private async loadSession(row: typeof workoutSessions.$inferSelect): Promise<WorkoutSession> {
    const [exerciseLogRows, setLogRows] = await this.loadExerciseAndSetLogs([row.id]);

    return sessionToDomain(row, exerciseLogRows, setLogRows);
  }

  private async loadSessions(sessionRows: ReadonlyArray<typeof workoutSessions.$inferSelect>): Promise<ReadonlyArray<WorkoutSession>> {
    const ids = sessionRows.map((row) => row.id);
    const [exerciseLogRows, setLogRows] = await this.loadExerciseAndSetLogs(ids);

    return sessionRows.map((row) =>
      sessionToDomain(
        row,
        exerciseLogRows.filter((log) => log.sessionId === row.id),
        setLogRows.filter((set) => set.sessionId === row.id),
      ),
    );
  }

  private async loadExerciseAndSetLogs(
    sessionIds: ReadonlyArray<string>,
  ): Promise<[ReadonlyArray<typeof exerciseLogs.$inferSelect>, ReadonlyArray<typeof setLogs.$inferSelect>]> {
    if (sessionIds.length === 0) {
      return [[], []];
    }

    const ids = sessionIds.map((id) => id);

    const exerciseLogRows = await this.db
      .select()
      .from(exerciseLogs)
      .where(inArray(exerciseLogs.sessionId, ids))
      .orderBy(exerciseLogs.sessionId, exerciseLogs.exerciseOrder);

    const setLogRows = await this.db
      .select()
      .from(setLogs)
      .where(inArray(setLogs.sessionId, ids))
      .orderBy(setLogs.sessionId, setLogs.exerciseOrder, setLogs.setNumber);

    return [exerciseLogRows, setLogRows];
  }
}

interface PostgresError {
  readonly code: string;
  readonly constraint_name?: string;
}

function isUniqueViolation(error: unknown, constraint: string): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }

  const candidate = error as PostgresError;
  return (
    candidate.code === '23505' &&
    (candidate.constraint_name === constraint ||
      (candidate.constraint_name !== undefined && candidate.constraint_name.includes(constraint)))
  );
}
