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
import {
  resolveOccurrenceSubstitutionEligibility,
  resolveOccurrenceSubstitutionState,
  type OccurrenceSubstitutionBlock,
} from '@/domain/services/session-exercise-substitution';

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
  /** The exercise the program's template authored for this occurrence. */
  readonly authoredExerciseId: string;
  /** The exercise actually performed (equals authored when not substituted). */
  readonly performedExerciseId: string;
  /**
   * Derived: the performed identity diverged from the authored one. The
   * domain owns this derivation (`resolveOccurrenceSubstitutionState`);
   * it is never persisted or stored alongside the session.
   */
  readonly isSubstituted: boolean;
  /**
   * Whether the occurrence may currently be substituted or restored — the
   * domain's mutation rules, projected by
   * `resolveOccurrenceSubstitutionEligibility`. Presentation consumes this
   * instead of re-deriving blocking from raw session facts.
   */
  readonly substitutionEligibility: OccurrenceSubstitutionEligibilityDto;
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

/**
 * The domain's substitution-mutation eligibility of one occurrence, stripped
 * of branded ids and fully serializable. `blockedBy` is null when the
 * occurrence is currently mutable; `canRestore` is true only for a currently
 * substituted, mutable occurrence.
 */
export interface OccurrenceSubstitutionEligibilityDto {
  readonly blockedBy: OccurrenceSubstitutionBlock | null;
  readonly canRestore: boolean;
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

/**
 * Serializes one logged set to its DTO shape. Exported for the training
 * history DTO mapper, which composes the same per-set shape into its
 * entries without duplicating the union handling.
 */
export function serializeSetLog(
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
    exerciseLogs: session.exerciseLogs.map((log) => {
      const substitution = resolveOccurrenceSubstitutionState(log);
      const eligibility = resolveOccurrenceSubstitutionEligibility(session, log);
      return {
        authoredExerciseId: substitution.authoredExerciseId as string,
        performedExerciseId: substitution.performedExerciseId as string,
        isSubstituted: substitution.isSubstituted,
        substitutionEligibility: {
          blockedBy: eligibility.blockedBy,
          canRestore: eligibility.canRestore,
        },
        order: log.order,
        prescription: log.prescription,
        sets: log.sets.map(serializeSetLog),
      };
    }),
    metrics: {
      totalSets: metrics.totalSets,
      totalReps: metrics.totalReps,
      totalDurationSeconds: metrics.totalDurationSeconds,
      volume: metrics.volume,
    },
  };
}