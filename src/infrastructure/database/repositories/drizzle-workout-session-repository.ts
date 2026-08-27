import type {
  SaveWorkoutSessionResult,
  WorkoutSessionRepository,
} from '@/application/ports/workout-session-repository';
import type { WorkoutSession } from '@/domain/entities/workout-session';
import type { ScheduledWorkoutId, WorkoutSessionId } from '@/domain/types/ids';
import { err, ok } from '@/lib/result';

import { eq, inArray, isNotNull } from 'drizzle-orm';

import { exerciseLogToRow, sessionToDomain, setLogToRow } from '../mappers/session-mapper';
import { exerciseLogs, setLogs, workoutSessions } from '../schema';

import type { DrizzleDatabase } from './types';

/** Unique constraint backing "at most one session per scheduled workout". */
const SCHEDULED_WORKOUT_UNIQUE_CONSTRAINT = 'workout_sessions_scheduled_workout_id';

/** PostgreSQL error code for unique_violation. */
const UNIQUE_VIOLATION = '23505';

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

  async save(session: WorkoutSession): Promise<SaveWorkoutSessionResult> {
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
      // Another session claimed this scheduled workout occurrence first. The
      // transaction has already rolled back, so translate the unique violation
      // into the port's persistence-neutral conflict instead of leaking Postgres.
      if (isScheduledWorkoutConflict(error)) {
        return err({
          reason: 'scheduled-workout-conflict',
          scheduledWorkoutId: session.scheduledWorkoutId,
        });
      }

      throw error;
    }

    return ok(undefined);
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

/**
 * Structural shape of the errors postgres.js surfaces for constraint violations.
 * The cast in `isScheduledWorkoutConflict` is the minimal way to read those
 * fields off an `unknown` catch value; the package does not export the error
 * class as a type-only import.
 */
interface PostgresConstraintViolation {
  readonly code?: unknown;
  readonly constraint_name?: unknown;
}

/**
 * True when PostgreSQL rejected the write because another session already owns
 * this scheduled workout (SQLSTATE 23505 on the sessions unique constraint).
 *
 * Drizzle wraps driver errors in a "Failed query" error and keeps the original
 * PostgresError in `cause`, so both levels are inspected.
 */
function isScheduledWorkoutConflict(error: unknown): boolean {
  return (
    isScheduledWorkoutViolation(error) ||
    (error instanceof Error && isScheduledWorkoutViolation(error.cause))
  );
}

function isScheduledWorkoutViolation(candidate: unknown): boolean {
  const { code, constraint_name: constraintName } =
    (candidate ?? {}) as PostgresConstraintViolation;

  return (
    code === UNIQUE_VIOLATION &&
    typeof constraintName === 'string' &&
    constraintName.startsWith(SCHEDULED_WORKOUT_UNIQUE_CONSTRAINT)
  );
}
