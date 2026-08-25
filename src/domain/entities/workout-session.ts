/**
 * WorkoutSession aggregate root and factory.
 *
 * A WorkoutSession represents one attempt to perform a specific ScheduledWorkout
 * occurrence. It is the aggregate root; ExerciseLog and SetLog are internal.
 *
 * Invariants enforced at construction:
 * - IDs must be valid branded types
 * - startedAt must be a valid Date
 * - At least one exercise log is required
 * - Exercise orders must be unique and sequential starting at 1
 *
 * Lifecycle:
 * - Session starts in-progress (completedAt === null)
 * - completeWorkoutSession transitions to completed (completedAt !== null)
 * - Completed sessions are immutable
 */

import { err, ok, type Result } from '@/lib/result';

import type { ExerciseId, ScheduledWorkoutId, WorkoutId, WorkoutSessionId } from '@/domain/types/ids';
import { createWorkoutSessionId } from '@/domain/types/ids';
import type { RepPrescription } from '@/domain/value-objects/rep-prescription';

// ─── Set Log ─────────────────────────────────────────────────────────────────

export interface RepSetLog {
  readonly type: 'reps';
  readonly setNumber: number;
  readonly reps: number;
  readonly weightKg: number | null;
  readonly rpe: number | null;
}

export interface DurationSetLog {
  readonly type: 'duration';
  readonly setNumber: number;
  readonly durationSeconds: number;
  readonly weightKg: number | null;
  readonly rpe: number | null;
}

export type SetLog = RepSetLog | DurationSetLog;

// ─── Exercise Log ────────────────────────────────────────────────────────────

export interface ExerciseLog {
  readonly exerciseId: ExerciseId;
  readonly order: number;
  readonly prescription: RepPrescription;
  readonly restSeconds: number;
  readonly sets: ReadonlyArray<SetLog>;
}

// ─── Session ─────────────────────────────────────────────────────────────────

export type WorkoutSessionStatus = 'in-progress' | 'completed';

export interface WorkoutSession {
  readonly id: WorkoutSessionId;
  readonly scheduledWorkoutId: ScheduledWorkoutId;
  readonly workoutId: WorkoutId;
  readonly startedAt: Date;
  readonly completedAt: Date | null;
  readonly exerciseLogs: ReadonlyArray<ExerciseLog>;
}

// ─── Input Types ─────────────────────────────────────────────────────────────

export interface CreateExerciseLogInput {
  readonly exerciseId: ExerciseId;
  readonly order: number;
  readonly prescription: RepPrescription;
  readonly restSeconds: number;
}

export interface CreateWorkoutSessionInput {
  readonly id: string;
  readonly scheduledWorkoutId: ScheduledWorkoutId;
  readonly workoutId: WorkoutId;
  readonly startedAt: Date;
  readonly exerciseLogs: ReadonlyArray<CreateExerciseLogInput>;
}

export interface LogSetInput {
  readonly exerciseOrder: number;
  readonly type: 'reps';
  readonly reps: number;
  readonly weightKg: number | null;
  readonly rpe: number | null;
}

export interface LogDurationSetInput {
  readonly exerciseOrder: number;
  readonly type: 'duration';
  readonly durationSeconds: number;
  readonly weightKg: number | null;
  readonly rpe: number | null;
}

export type LogSetCommandInput = LogSetInput | LogDurationSetInput;

export interface UpdateSetInput {
  readonly exerciseOrder: number;
  readonly setNumber: number;
  readonly type: 'reps';
  readonly reps: number;
  readonly weightKg: number | null;
  readonly rpe: number | null;
}

export interface UpdateDurationSetInput {
  readonly exerciseOrder: number;
  readonly setNumber: number;
  readonly type: 'duration';
  readonly durationSeconds: number;
  readonly weightKg: number | null;
  readonly rpe: number | null;
}

export type UpdateSetCommandInput = UpdateSetInput | UpdateDurationSetInput;

export interface DeleteSetInput {
  readonly exerciseOrder: number;
  readonly setNumber: number;
}

// ─── Error Types ─────────────────────────────────────────────────────────────

export interface WorkoutSessionValidationError {
  readonly code: 'INVALID_WORKOUT_SESSION';
  readonly message: string;
  readonly field?: string;
}

export type SessionMutationError =
  | { readonly code: 'SESSION_ALREADY_COMPLETED'; readonly message: string }
  | { readonly code: 'EXERCISE_LOG_NOT_FOUND'; readonly exerciseOrder: number; readonly message: string }
  | { readonly code: 'SET_NOT_FOUND'; readonly setNumber: number; readonly message: string }
  | { readonly code: 'INVALID_SET_TYPE'; readonly message: string }
  | { readonly code: 'INVALID_SET_DATA'; readonly message: string; readonly field?: string }
  | { readonly code: 'CANNOT_COMPLETE_EMPTY_SESSION'; readonly message: string };

// ─── Status ──────────────────────────────────────────────────────────────────

export function getSessionStatus(session: WorkoutSession): WorkoutSessionStatus {
  return session.completedAt === null ? 'in-progress' : 'completed';
}

// ─── Set Validation ──────────────────────────────────────────────────────────

function validateRepSetInput(
  reps: number,
  weightKg: number | null | undefined,
  rpe: number | null | undefined,
): Result<void, SessionMutationError> {
  if (!Number.isInteger(reps) || reps <= 0) {
    return err({ code: 'INVALID_SET_DATA', message: 'reps must be a positive integer', field: 'reps' });
  }

  if (weightKg !== undefined && weightKg !== null) {
    if (typeof weightKg !== 'number' || !Number.isFinite(weightKg) || weightKg < 0) {
      return err({ code: 'INVALID_SET_DATA', message: 'weightKg must be a non-negative number', field: 'weightKg' });
    }
  }

  if (rpe !== undefined && rpe !== null) {
    if (!Number.isInteger(rpe) || rpe < 1 || rpe > 10) {
      return err({ code: 'INVALID_SET_DATA', message: 'RPE must be an integer between 1 and 10', field: 'rpe' });
    }
  }

  return ok(undefined);
}

function validateDurationSetInput(
  durationSeconds: number,
  weightKg: number | null | undefined,
  rpe: number | null | undefined,
): Result<void, SessionMutationError> {
  if (!Number.isInteger(durationSeconds) || durationSeconds <= 0) {
    return err({
      code: 'INVALID_SET_DATA',
      message: 'durationSeconds must be a positive integer',
      field: 'durationSeconds',
    });
  }

  if (weightKg !== undefined && weightKg !== null) {
    if (typeof weightKg !== 'number' || !Number.isFinite(weightKg) || weightKg < 0) {
      return err({ code: 'INVALID_SET_DATA', message: 'weightKg must be a non-negative number', field: 'weightKg' });
    }
  }

  if (rpe !== undefined && rpe !== null) {
    if (!Number.isInteger(rpe) || rpe < 1 || rpe > 10) {
      return err({ code: 'INVALID_SET_DATA', message: 'RPE must be an integer between 1 and 10', field: 'rpe' });
    }
  }

  return ok(undefined);
}

function assertNotCompleted(session: WorkoutSession): Result<void, SessionMutationError> {
  if (session.completedAt !== null) {
    return err({ code: 'SESSION_ALREADY_COMPLETED', message: 'Cannot modify a completed session' });
  }
  return ok(undefined);
}

// ─── Factory ─────────────────────────────────────────────────────────────────

export function createWorkoutSession(
  input: CreateWorkoutSessionInput,
): Result<WorkoutSession, WorkoutSessionValidationError> {
  const idResult = createWorkoutSessionId(input.id);
  if (!idResult.ok) {
    return err({ code: 'INVALID_WORKOUT_SESSION', message: idResult.error.message, field: 'id' });
  }

  if (!(input.startedAt instanceof Date) || isNaN(input.startedAt.getTime())) {
    return err({ code: 'INVALID_WORKOUT_SESSION', message: 'startedAt must be a valid Date', field: 'startedAt' });
  }

  if (input.exerciseLogs.length === 0) {
    return err({
      code: 'INVALID_WORKOUT_SESSION',
      message: 'session must contain at least one exercise log',
      field: 'exerciseLogs',
    });
  }

  const expectedOrders = Array.from({ length: input.exerciseLogs.length }, (_, index) => index + 1);
  const actualOrders = input.exerciseLogs.map((log) => log.order).sort((a, b) => a - b);
  const ordersValid =
    expectedOrders.length === actualOrders.length &&
    expectedOrders.every((value, index) => value === actualOrders[index]);

  if (!ordersValid) {
    return err({
      code: 'INVALID_WORKOUT_SESSION',
      message: 'exercise log orders must be unique and sequential starting at 1',
      field: 'exerciseLogs',
    });
  }

  for (const log of input.exerciseLogs) {
    if (log.restSeconds < 0) {
      return err({
        code: 'INVALID_WORKOUT_SESSION',
        message: 'restSeconds cannot be negative',
        field: 'exerciseLogs',
      });
    }
  }

  const exerciseLogs: ReadonlyArray<ExerciseLog> = input.exerciseLogs.map((log) => ({
    exerciseId: log.exerciseId,
    order: log.order,
    prescription: log.prescription,
    restSeconds: log.restSeconds,
    sets: [],
  }));

  return ok({
    id: idResult.data,
    scheduledWorkoutId: input.scheduledWorkoutId,
    workoutId: input.workoutId,
    startedAt: input.startedAt,
    completedAt: null,
    exerciseLogs,
  });
}

// ─── Log Set ─────────────────────────────────────────────────────────────────

export function logSessionSet(
  session: WorkoutSession,
  input: LogSetCommandInput,
): Result<WorkoutSession, SessionMutationError> {
  const notCompleted = assertNotCompleted(session);
  if (!notCompleted.ok) return notCompleted;

  const log = session.exerciseLogs.find((e) => e.order === input.exerciseOrder);
  if (log === undefined) {
    return err({
      code: 'EXERCISE_LOG_NOT_FOUND',
      exerciseOrder: input.exerciseOrder,
      message: `Exercise log with order ${input.exerciseOrder} not found in session`,
    });
  }

  const expectedType = log.prescription.type;
  if (input.type !== expectedType) {
    return err({
      code: 'INVALID_SET_TYPE',
      message: `Exercise order ${input.exerciseOrder} expects ${expectedType} sets, got ${input.type}`,
    });
  }

  if (input.type === 'reps') {
    const validation = validateRepSetInput(input.reps, input.weightKg, input.rpe);
    if (!validation.ok) return validation;
  } else {
    const validation = validateDurationSetInput(input.durationSeconds, input.weightKg, input.rpe);
    if (!validation.ok) return validation;
  }

  const newSetNumber = log.sets.length + 1;

  let newSet: SetLog;
  if (input.type === 'reps') {
    newSet = {
      type: 'reps',
      setNumber: newSetNumber,
      reps: input.reps,
      weightKg: input.weightKg ?? null,
      rpe: input.rpe ?? null,
    };
  } else {
    newSet = {
      type: 'duration',
      setNumber: newSetNumber,
      durationSeconds: input.durationSeconds,
      weightKg: input.weightKg ?? null,
      rpe: input.rpe ?? null,
    };
  }

  const updatedExerciseLogs: ReadonlyArray<ExerciseLog> = session.exerciseLogs.map((e) => {
    if (e.order !== input.exerciseOrder) return e;
    return { ...e, sets: [...e.sets, newSet] };
  });

  return ok({
    ...session,
    exerciseLogs: updatedExerciseLogs,
  });
}

// ─── Update Set ──────────────────────────────────────────────────────────────

export function updateSessionSet(
  session: WorkoutSession,
  input: UpdateSetCommandInput,
): Result<WorkoutSession, SessionMutationError> {
  const notCompleted = assertNotCompleted(session);
  if (!notCompleted.ok) return notCompleted;

  const log = session.exerciseLogs.find((e) => e.order === input.exerciseOrder);
  if (log === undefined) {
    return err({
      code: 'EXERCISE_LOG_NOT_FOUND',
      exerciseOrder: input.exerciseOrder,
      message: `Exercise log with order ${input.exerciseOrder} not found in session`,
    });
  }

  const existingSet = log.sets.find((s) => s.setNumber === input.setNumber);
  if (existingSet === undefined) {
    return err({
      code: 'SET_NOT_FOUND',
      setNumber: input.setNumber,
      message: `Set ${input.setNumber} not found in exercise order ${input.exerciseOrder}`,
    });
  }

  const expectedType = log.prescription.type;
  if (input.type !== expectedType) {
    return err({
      code: 'INVALID_SET_TYPE',
      message: `Exercise order ${input.exerciseOrder} expects ${expectedType} sets, got ${input.type}`,
    });
  }

  if (input.type === 'reps') {
    const validation = validateRepSetInput(input.reps, input.weightKg, input.rpe);
    if (!validation.ok) return validation;
  } else {
    const validation = validateDurationSetInput(input.durationSeconds, input.weightKg, input.rpe);
    if (!validation.ok) return validation;
  }

  const updatedSets: ReadonlyArray<SetLog> = log.sets.map((s) => {
    if (s.setNumber !== input.setNumber) return s;

    if (input.type === 'reps') {
      return {
        type: 'reps',
        setNumber: input.setNumber,
        reps: input.reps,
        weightKg: input.weightKg ?? null,
        rpe: input.rpe ?? null,
      } as SetLog;
    }

    return {
      type: 'duration',
      setNumber: input.setNumber,
      durationSeconds: input.durationSeconds,
      weightKg: input.weightKg ?? null,
      rpe: input.rpe ?? null,
    } as SetLog;
  });

  const updatedExerciseLogs: ReadonlyArray<ExerciseLog> = session.exerciseLogs.map((e) => {
    if (e.order !== input.exerciseOrder) return e;
    return { ...e, sets: updatedSets };
  });

  return ok({
    ...session,
    exerciseLogs: updatedExerciseLogs,
  });
}

// ─── Delete Set ──────────────────────────────────────────────────────────────

export function deleteSessionSet(
  session: WorkoutSession,
  input: DeleteSetInput,
): Result<WorkoutSession, SessionMutationError> {
  const notCompleted = assertNotCompleted(session);
  if (!notCompleted.ok) return notCompleted;

  const log = session.exerciseLogs.find((e) => e.order === input.exerciseOrder);
  if (log === undefined) {
    return err({
      code: 'EXERCISE_LOG_NOT_FOUND',
      exerciseOrder: input.exerciseOrder,
      message: `Exercise log with order ${input.exerciseOrder} not found in session`,
    });
  }

  const setExists = log.sets.some((s) => s.setNumber === input.setNumber);
  if (!setExists) {
    return err({
      code: 'SET_NOT_FOUND',
      setNumber: input.setNumber,
      message: `Set ${input.setNumber} not found in exercise order ${input.exerciseOrder}`,
    });
  }

  const remainingSets: ReadonlyArray<SetLog> = log.sets
    .filter((s) => s.setNumber !== input.setNumber)
    .map((s, index) => {
      if (s.type === 'reps') {
        return { ...s, setNumber: index + 1 } as SetLog;
      }
      return { ...s, setNumber: index + 1 } as SetLog;
    });

  const updatedExerciseLogs: ReadonlyArray<ExerciseLog> = session.exerciseLogs.map((e) => {
    if (e.order !== input.exerciseOrder) return e;
    return { ...e, sets: remainingSets };
  });

  return ok({
    ...session,
    exerciseLogs: updatedExerciseLogs,
  });
}

// ─── Complete ────────────────────────────────────────────────────────────────

export function completeWorkoutSession(
  session: WorkoutSession,
  completedAt: Date,
): Result<WorkoutSession, SessionMutationError> {
  if (session.completedAt !== null) {
    return err({ code: 'SESSION_ALREADY_COMPLETED', message: 'Session is already completed' });
  }

  const hasAnySet = session.exerciseLogs.some((log) => log.sets.length > 0);
  if (!hasAnySet) {
    return err({
      code: 'CANNOT_COMPLETE_EMPTY_SESSION',
      message: 'Cannot complete a session with zero logged sets',
    });
  }

  if (!(completedAt instanceof Date) || isNaN(completedAt.getTime())) {
    return err({ code: 'INVALID_SET_DATA', message: 'completedAt must be a valid Date', field: 'completedAt' });
  }

  return ok({
    ...session,
    completedAt,
  });
}