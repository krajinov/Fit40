/**
 * Data transfer objects for workout session data crossing layer boundaries.
 *
 * DTOs are plain, serializable shapes. Branded IDs are stripped to plain strings,
 * Date objects are serialized to ISO 8601 strings.
 */

import type { RepPrescription } from '@/domain/value-objects/rep-prescription';
import type {
  OccurrenceSource,
  WorkoutSession,
  WorkoutSessionStatus,
} from '@/domain/entities/workout-session';
import { getSessionStatus } from '@/domain/entities/workout-session';
import {
  resolveOccurrenceAdjustmentEligibility,
  type OccurrenceAdjustmentBlock,
} from '@/domain/services/occurrence-adjustment-rules';
import { calculateSessionMetrics } from '@/domain/services/session-metrics';
import { resolveSessionPrescriptionTotals } from '@/domain/services/session-prescription-totals';
import {
  resolveOccurrenceSubstitutionEligibility,
  resolveOccurrenceSubstitutionState,
  type OccurrenceSubstitutionBlock,
} from '@/domain/services/session-exercise-substitution';
import {
  resolveOccurrenceRemovalEligibility,
  type OccurrenceRemovalBlock,
} from '@/domain/services/session-exercise-composition';

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
   * The persisted skip decision for this occurrence (M10): the user's
   * explicit choice to not perform it in this session, never inferred from
   * zero logged sets. Projected straight from the aggregate, like
   * `isSubstituted` above.
   */
  readonly isSkipped: boolean;
  /**
   * The immutable per-occurrence persistence/render token (PR #13
   * Finding 1), projected straight from the aggregate. Presentation derives
   * its stable React render identity from this — never from the mutable
   * `order`. It is NOT the business occurrence locator (that remains
   * `(sessionId, exerciseOrder)` via `order`) and is never an input to any
   * use case, Server Action, or query.
   */
  readonly occurrenceKey: number;
  /**
   * How this occurrence entered the session (M11), projected verbatim from
   * the aggregate: `'template'` when the workout template authored it,
   * `'user_added'` when the user explicitly added it during the session.
   * Presentation derives its provenance treatment from this persisted fact —
   * never inferred from order, occurrenceKey, the authored/performed
   * identities or substitution state.
   */
  readonly source: OccurrenceSource;
  /**
   * Whether the occurrence's skip decision may currently change — the
   * domain's mutation rules, projected by
   * `resolveOccurrenceAdjustmentEligibility`. Presentation consumes this
   * instead of re-deriving blocking from raw session facts.
   */
  readonly adjustmentEligibility: OccurrenceAdjustmentEligibilityDto;
  /**
   * Whether the occurrence may currently be substituted or restored — the
   * domain's mutation rules, projected by
   * `resolveOccurrenceSubstitutionEligibility`. Presentation consumes this
   * instead of re-deriving blocking from raw session facts.
   */
  readonly substitutionEligibility: OccurrenceSubstitutionEligibilityDto;
  /**
   * Whether the occurrence may currently be REMOVED (M11) — the domain's
   * removal rules, projected by `resolveOccurrenceRemovalEligibility`.
   * Presentation consumes this instead of re-deriving removability from
   * `source` or raw set counts.
   */
  readonly removalEligibility: OccurrenceRemovalEligibilityDto;
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

/**
 * The domain's REMOVAL-mutation eligibility of one occurrence (M11), stripped
 * of branded ids and fully serializable. `canRemove` is true only for an
 * in-progress, zero-set, user-added occurrence; otherwise `blockedBy` carries
 * the canonical reason (precedence: session-completed > template-authored >
 * logged-sets). Presentation formats it and never re-derives removability.
 */
export interface OccurrenceRemovalEligibilityDto {
  readonly canRemove: boolean;
  readonly blockedBy: OccurrenceRemovalBlock | null;
}

/**
 * The domain's skip/reorder-mutation eligibility of one occurrence, stripped
 * of branded ids and fully serializable: the persisted skip decision, why it
 * is currently frozen (`blockedBy` null = adjustable), and whether
 * skip/unskip and adjacent moves may run right now.
 */
export interface OccurrenceAdjustmentEligibilityDto {
  readonly isSkipped: boolean;
  readonly blockedBy: OccurrenceAdjustmentBlock | null;
  readonly canSkip: boolean;
  readonly canUnskip: boolean;
  /**
   * True only for an in-progress occurrence with a neighbor above
   * (order > 1). Logged sets, the skip decision and substitutions never
   * block moves — the whole occurrence swaps as one unit.
   */
  readonly canMoveUp: boolean;
  /** True only for an in-progress occurrence with a neighbor below (order < N). */
  readonly canMoveDown: boolean;
}

export interface WorkoutSessionDto {
  readonly sessionId: string;
  readonly scheduledWorkoutId: string;
  readonly workoutId: string;
  readonly status: WorkoutSessionStatus;
  readonly startedAt: string;
  readonly completedAt: string | null;
  /**
   * The rendered snapshot's optimistic-concurrency token (PR #13 stale
   * rendered-intent guard): occurrence-addressed mutation commands carry it
   * back as `expectedSessionVersion`, and the use case rejects a mismatch
   * BEFORE interpreting the mutable `exerciseOrder` — a stale tab that was
   * rendered before a concurrent reorder cannot silently target the
   * occurrence that now occupies its old order.
   */
  readonly version: number;
  readonly exerciseLogs: ReadonlyArray<WorkoutSessionExerciseDto>;
  readonly metrics: WorkoutSessionMetricsDto;
  /**
   * Prescribed sets across the NON-skipped occurrences — the progress
   * denominator (F5). Domain-owned via `resolveSessionPrescriptionTotals`;
   * never re-summed independently in this mapper.
   */
  readonly prescribedSets: number;
  /** How many authored occurrences are currently skipped (domain-owned). */
  readonly skippedExerciseCount: number;
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
  const totals = resolveSessionPrescriptionTotals(session);

  return {
    sessionId: session.id as string,
    scheduledWorkoutId: session.scheduledWorkoutId as string,
    workoutId: session.workoutId as string,
    status: getSessionStatus(session),
    startedAt: session.startedAt.toISOString(),
    completedAt: session.completedAt?.toISOString() ?? null,
    version: session.version,
    exerciseLogs: session.exerciseLogs.map((log) => {
      const substitution = resolveOccurrenceSubstitutionState(log);
      const eligibility = resolveOccurrenceSubstitutionEligibility(session, log);
      const adjustment = resolveOccurrenceAdjustmentEligibility(session, log);
      const removal = resolveOccurrenceRemovalEligibility(session, log);
      return {
        authoredExerciseId: substitution.authoredExerciseId as string,
        performedExerciseId: substitution.performedExerciseId as string,
        isSubstituted: substitution.isSubstituted,
        isSkipped: log.isSkipped,
        occurrenceKey: log.occurrenceKey,
        source: log.source,
        substitutionEligibility: {
          blockedBy: eligibility.blockedBy,
          canRestore: eligibility.canRestore,
        },
        removalEligibility: {
          canRemove: removal.canRemove,
          blockedBy: removal.blockedBy,
        },
        adjustmentEligibility: {
          isSkipped: adjustment.isSkipped,
          blockedBy: adjustment.blockedBy,
          canSkip: adjustment.canSkip,
          canUnskip: adjustment.canUnskip,
          canMoveUp: adjustment.canMoveUp,
          canMoveDown: adjustment.canMoveDown,
        },
        order: log.order,
        prescription: log.prescription,
        sets: log.sets.map(serializeSetLog),
      };
    }),
    // Metrics describe actual logged work only: a skipped occurrence carries
    // zero sets by invariant, so it contributes nothing here by construction.
    metrics: {
      totalSets: metrics.totalSets,
      totalReps: metrics.totalReps,
      totalDurationSeconds: metrics.totalDurationSeconds,
      volume: metrics.volume,
    },
    prescribedSets: totals.prescribedSets,
    skippedExerciseCount: totals.skippedOccurrences,
  };
}