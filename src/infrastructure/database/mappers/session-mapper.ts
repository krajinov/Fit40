import {
  createWorkoutSession,
  type ExerciseLog,
  type SetLog,
  type WorkoutSession,
} from '@/domain/entities/workout-session';
import type { ExerciseId, ScheduledWorkoutId, WorkoutId, WorkoutSessionId } from '@/domain/types/ids';
import { createWorkoutSessionId } from '@/domain/types/ids';
import type { RepPrescription } from '@/domain/value-objects/rep-prescription';

import { prescriptionToDomain, prescriptionToRow } from './prescription-mapper';
import { exerciseLogs, setLogs, workoutSessions } from '../schema/sessions';

type SessionRow = typeof workoutSessions.$inferSelect;
type ExerciseLogRow = typeof exerciseLogs.$inferSelect;
type SetLogRow = typeof setLogs.$inferSelect;

export function sessionToDomain(
  sessionRow: SessionRow,
  exerciseLogRows: ReadonlyArray<ExerciseLogRow>,
  setLogRows: ReadonlyArray<SetLogRow>,
): WorkoutSession {
  const exerciseLogInputs = exerciseLogRows
    .slice()
    .sort((a, b) => a.exerciseOrder - b.exerciseOrder)
    .map((row) => ({
      exerciseId: row.exerciseId as ExerciseId,
      order: row.exerciseOrder,
      prescription: prescriptionToDomain({
      prescriptionType: row.prescriptionType as 'reps' | 'duration',
      sets: row.sets,
      minReps: row.minReps,
      maxReps: row.maxReps,
      durationSeconds: row.durationSeconds,
    }),
      restSeconds: row.restSeconds,
    }));

  const result = createWorkoutSession({
    id: sessionRow.id,
    scheduledWorkoutId: sessionRow.scheduledWorkoutId as ScheduledWorkoutId,
    workoutId: sessionRow.workoutId as WorkoutId,
    startedAt: sessionRow.startedAt,
    exerciseLogs: exerciseLogInputs,
  });

  if (!result.ok) {
    throw new Error(`Corrupt workout session ${sessionRow.id}: ${result.error.message}`);
  }

  const setsByExerciseOrder = groupSetLogsByExerciseOrder(setLogRows);

  const mappedLogs: ReadonlyArray<ExerciseLog> = exerciseLogInputs.map((input, index) => {
    const row = exerciseLogRows[index];
    if (row === undefined) {
      throw new Error(`Corrupt workout session ${sessionRow.id}: exercise log row missing`);
    }

    const sets = setsByExerciseOrder.get(row.exerciseOrder) ?? [];

    return {
      exerciseId: input.exerciseId,
      order: input.order,
      prescription: input.prescription,
      restSeconds: input.restSeconds,
      sets,
    };
  });

  return {
    id: createWorkoutSessionIdOrThrow(sessionRow.id),
    scheduledWorkoutId: sessionRow.scheduledWorkoutId as ScheduledWorkoutId,
    workoutId: sessionRow.workoutId as WorkoutId,
    startedAt: sessionRow.startedAt,
    completedAt: sessionRow.completedAt ?? null,
    exerciseLogs: mappedLogs,
  };
}

export function exerciseLogToRow(
  sessionId: string,
  order: number,
  log: {
    exerciseId: ExerciseId;
    prescription: RepPrescription;
    restSeconds: number;
  },
): ExerciseLogRow {
  return {
    sessionId,
    exerciseOrder: order,
    exerciseId: log.exerciseId,
    ...prescriptionToRow(log.prescription),
    restSeconds: log.restSeconds,
  };
}

export function setLogToRow(sessionId: string, exerciseOrder: number, set: SetLog): SetLogRow {
  const base = {
    sessionId,
    exerciseOrder,
    setNumber: set.setNumber,
    weightKg: set.weightKg === null ? null : String(set.weightKg),
    rpe: set.rpe,
  };

  if (set.type === 'reps') {
    return {
      ...base,
      type: 'reps',
      reps: set.reps,
      durationSeconds: null,
    };
  }

  return {
    ...base,
    type: 'duration',
    reps: null,
    durationSeconds: set.durationSeconds,
  };
}

function groupSetLogsByExerciseOrder(rows: ReadonlyArray<SetLogRow>): Map<number, ReadonlyArray<SetLog>> {
  const map = new Map<number, SetLog[]>();

  for (const row of rows) {
    const existing = map.get(row.exerciseOrder) ?? [];
    existing.push(mapSetLogRow(row));
    map.set(row.exerciseOrder, existing);
  }

  return new Map(
    Array.from(map.entries()).map(([order, logs]) => [
      order,
      logs.sort((a, b) => a.setNumber - b.setNumber),
    ]),
  );
}

function mapSetLogRow(row: SetLogRow): SetLog {
  if (row.type === 'reps') {
    if (row.reps === null) {
      throw new Error('Corrupt set log: reps set missing reps');
    }

    return {
      type: 'reps',
      setNumber: row.setNumber,
      reps: row.reps,
      weightKg: row.weightKg === null ? null : Number(row.weightKg),
      rpe: row.rpe,
    };
  }

  if (row.durationSeconds === null) {
    throw new Error('Corrupt set log: duration set missing durationSeconds');
  }

  return {
    type: 'duration',
    setNumber: row.setNumber,
    durationSeconds: row.durationSeconds,
    weightKg: row.weightKg === null ? null : Number(row.weightKg),
    rpe: row.rpe,
  };
}

function createWorkoutSessionIdOrThrow(value: string): WorkoutSessionId {
  const result = createWorkoutSessionId(value);
  if (!result.ok) {
    throw new Error(`Invalid workout session id stored in database: ${value}`);
  }

  return result.data;
}
