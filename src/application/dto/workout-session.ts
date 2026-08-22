/**
 * Data transfer objects for workout session data crossing layer boundaries.
 *
 * DTOs are plain, serializable shapes. Branded IDs are stripped to plain strings,
 * Date objects are serialized to ISO 8601 strings.
 */

import type { RepPrescription } from '@/domain/value-objects/rep-prescription';
import type { WorkoutSession, WorkoutSessionStatus } from '@/domain/entities/workout-session';
import { getSessionStatus } from '@/domain/entities/workout-session';
import { calculateSessionMetrics } from '@/domain/services/session-metrics';

export type WorkoutSessionSetDto =
  | {
      readonly setNumber: number;
      readonly type: 'reps';
      readonly reps: number;
      readonly weightKg: number | null;
      readonly rpe: number | null;
    }
  | {
      readonly setNumber: number;
      readonly type: 'duration';
      readonly durationSeconds: number;
      readonly weightKg: number | null;
      readonly rpe: number | null;
    };

export interface WorkoutSessionExerciseDto {
  readonly exerciseId: string;
  readonly order: number;
  readonly prescription: RepPrescription;
  readonly sets: ReadonlyArray<WorkoutSessionSetDto>;
}

export interface WorkoutSessionMetricsDto {
  readonly totalSets: number;
  readonly totalReps: number;
  readonly totalDurationSeconds: number;
  readonly volume: number;
}

export interface WorkoutSessionDto {
  readonly sessionId: string;
  readonly scheduledWorkoutId: string;
  readonly workoutId: string;
  readonly status: WorkoutSessionStatus;
  readonly startedAt: string;
  readonly completedAt: string | null;
  readonly exerciseLogs: ReadonlyArray<WorkoutSessionExerciseDto>;
  readonly metrics: WorkoutSessionMetricsDto;
}

// ─── Mapper ──────────────────────────────────────────────────────────────────

function serializeSetLog(
  set: import('@/domain/entities/workout-session').SetLog,
): WorkoutSessionSetDto {
  if (set.type === 'reps') {
    return {
      setNumber: set.setNumber,
      type: 'reps',
      reps: set.reps,
      weightKg: set.weightKg,
      rpe: set.rpe,
    };
  }
  return {
    setNumber: set.setNumber,
    type: 'duration',
    durationSeconds: set.durationSeconds,
    weightKg: set.weightKg,
    rpe: set.rpe,
  };
}

export function toWorkoutSessionDto(session: WorkoutSession): WorkoutSessionDto {
  const metrics = calculateSessionMetrics(session);

  return {
    sessionId: session.id as string,
    scheduledWorkoutId: session.scheduledWorkoutId as string,
    workoutId: session.workoutId as string,
    status: getSessionStatus(session),
    startedAt: session.startedAt.toISOString(),
    completedAt: session.completedAt?.toISOString() ?? null,
    exerciseLogs: session.exerciseLogs.map((log) => ({
      exerciseId: log.exerciseId as string,
      order: log.order,
      prescription: log.prescription,
      sets: log.sets.map(serializeSetLog),
    })),
    metrics: {
      totalSets: metrics.totalSets,
      totalReps: metrics.totalReps,
      totalDurationSeconds: metrics.totalDurationSeconds,
      volume: metrics.volume,
    },
  };
}