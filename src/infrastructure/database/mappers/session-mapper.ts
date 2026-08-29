import {
  createWorkoutSession,
  type ExerciseLog,
  type SetLog,
  type WorkoutSession,
} from '@/domain/entities/workout-session';
import {
  createEnrollmentId,
  createExerciseId,
  createScheduledWorkoutId,
  createUserId,
  createWorkoutId,
  type EnrollmentId,
  type ExerciseId,
  type ScheduledWorkoutId,
  type UserId,
  type WorkoutId,
} from '@/domain/types/ids';

import type { exerciseLogs, setLogs, workoutSessions } from '../schema/sessions';
import { prescriptionFromColumns, prescriptionToColumns } from './prescription-mapper';

type SessionRow = typeof workoutSessions.$inferSelect;
type ExerciseLogRow = typeof exerciseLogs.$inferSelect;
type SetLogRow = typeof setLogs.$inferSelect;

function parseExerciseId(value: string, context: string): ExerciseId {
  const result = createExerciseId(value);
  if (!result.ok) {
    throw new Error(`Corrupt data in ${context}: ${result.error.message}`);
  }
  return result.data;
}

function parseScheduledWorkoutId(value: string, context: string): ScheduledWorkoutId {
  const result = createScheduledWorkoutId(value);
  if (!result.ok) {
    throw new Error(`Corrupt data in ${context}: ${result.error.message}`);
  }
  return result.data;
}

function parseWorkoutId(value: string, context: string): WorkoutId {
  const result = createWorkoutId(value);
  if (!result.ok) {
    throw new Error(`Corrupt data in ${context}: ${result.error.message}`);
  }
  return result.data;
}

function parseUserId(value: string, context: string): UserId {
  const result = createUserId(value);
  if (!result.ok) {
    throw new Error(`Corrupt data in ${context}: ${result.error.message}`);
  }
  return result.data;
}

function parseOptionalEnrollmentId(value: string | null, context: string): EnrollmentId | null {
  if (value === null) {
    return null;
  }
  const result = createEnrollmentId(value);
  if (!result.ok) {
    throw new Error(`Corrupt data in ${context}: ${result.error.message}`);
  }
  return result.data;
}

function mapSet(row: SetLogRow, context: string): SetLog {
  if (row.type === 'reps') {
    if (row.reps === null) {
      throw new Error(`Corrupt data in ${context}: reps set missing reps`);
    }
    return {
      type: 'reps',
      setNumber: row.setNumber,
      reps: row.reps,
      weightKg: row.weightKg,
      rpe: row.rpe,
    };
  }

  if (row.type === 'duration') {
    if (row.durationSeconds === null) {
      throw new Error(`Corrupt data in ${context}: duration set missing durationSeconds`);
    }
    return {
      type: 'duration',
      setNumber: row.setNumber,
      durationSeconds: row.durationSeconds,
      weightKg: row.weightKg,
      rpe: row.rpe,
    };
  }

  throw new Error(`Corrupt data in ${context}: unknown set type "${row.type}"`);
}

export interface SessionRows {
  readonly session: SessionRow;
  readonly exerciseLogs: ReadonlyArray<ExerciseLogRow>;
  readonly setLogs: ReadonlyArray<SetLogRow>;
}

/**
 * Reconstructs a `WorkoutSession` aggregate from its persisted rows.
 *
 * The session is first validated through the domain factory (ID and sequential
 * exercise order invariants); completed timestamp and logged sets are then
 * attached explicitly.
 */
export function mapSessionRows(rows: SessionRows): WorkoutSession {
  const rawSetsByOrder = new Map<number, SetLogRow[]>();
  for (const row of rows.setLogs) {
    const list = rawSetsByOrder.get(row.exerciseOrder) ?? [];
    list.push(row);
    rawSetsByOrder.set(row.exerciseOrder, list);
  }

  const orderedLogs = rows.exerciseLogs.slice().sort((a, b) => a.exerciseOrder - b.exerciseOrder);

  const logInputs = orderedLogs.map((row) => {
    const context = `exercise_logs (session_id=${row.sessionId}, exercise_order=${row.exerciseOrder})`;
    return {
      exerciseId: parseExerciseId(row.exerciseId, context),
      order: row.exerciseOrder,
      prescription: prescriptionFromColumns(row, context),
      restSeconds: row.restSeconds,
    };
  });

  const sessionContext = `workout_sessions (id=${rows.session.id})`;
  const base = createWorkoutSession({
    id: rows.session.id,
    userId: parseUserId(rows.session.userId, sessionContext),
    enrollmentId: parseOptionalEnrollmentId(rows.session.enrollmentId, sessionContext),
    scheduledWorkoutId: parseScheduledWorkoutId(rows.session.scheduledWorkoutId, sessionContext),
    workoutId: parseWorkoutId(rows.session.workoutId, sessionContext),
    startedAt: rows.session.startedAt,
    exerciseLogs: logInputs,
  });

  if (!base.ok) {
    throw new Error(`Corrupt ${sessionContext}: ${base.error.message}`);
  }

  const setsByOrder = new Map<number, SetLog[]>();
  for (const [order, setRows] of rawSetsByOrder) {
    const context = `set_logs (session_id=${rows.session.id}, exercise_order=${order})`;
    const sets = setRows
      .slice()
      .sort((a, b) => a.setNumber - b.setNumber)
      .map((row) => mapSet(row, context));
    setsByOrder.set(order, sets);
  }

  const exerciseLogs: ExerciseLog[] = base.data.exerciseLogs.map((log) => ({
    ...log,
    sets: setsByOrder.get(log.order) ?? [],
  }));

  return {
    ...base.data,
    completedAt: rows.session.completedAt,
    version: rows.session.version,
    exerciseLogs,
  };
}

export function mapSessionToRow(session: WorkoutSession): typeof workoutSessions.$inferInsert {
  return {
    id: session.id,
    userId: session.userId,
    enrollmentId: session.enrollmentId,
    scheduledWorkoutId: session.scheduledWorkoutId,
    workoutId: session.workoutId,
    startedAt: session.startedAt,
    completedAt: session.completedAt,
    version: session.version,
  };
}

export function mapExerciseLogToRow(
  sessionId: string,
  log: ExerciseLog,
): typeof exerciseLogs.$inferInsert {
  return {
    sessionId,
    exerciseOrder: log.order,
    exerciseId: log.exerciseId,
    ...prescriptionToColumns(log.prescription),
    restSeconds: log.restSeconds,
  };
}

export function mapSetToRow(
  sessionId: string,
  exerciseOrder: number,
  set: SetLog,
): typeof setLogs.$inferInsert {
  if (set.type === 'reps') {
    return {
      sessionId,
      exerciseOrder,
      setNumber: set.setNumber,
      type: 'reps',
      reps: set.reps,
      durationSeconds: null,
      weightKg: set.weightKg,
      rpe: set.rpe,
    };
  }

  return {
    sessionId,
    exerciseOrder,
    setNumber: set.setNumber,
    type: 'duration',
    durationSeconds: set.durationSeconds,
    reps: null,
    weightKg: set.weightKg,
    rpe: set.rpe,
  };
}
