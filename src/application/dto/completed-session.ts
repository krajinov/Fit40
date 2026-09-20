/**
 * Serializable DTO for the completed-session detail screen.
 *
 * Self-contained by design (no imports from the workout-session DTO
 * module): the read-only detail view needs flatter set and prescription
 * shapes than the live logger, and each boundary module owns its own wire
 * contracts. Everything is plain JSON — branded ids are stripped, Dates
 * become ISO 8601 strings, sets and prescriptions are discriminated unions
 * so an invalid mix (reps without a count, duration without seconds) is
 * unrepresentable.
 *
 * Historical-truth rules mirrored from the repository boundary:
 * - The persisted prescription snapshot and logged sets ARE the record;
 *   current catalog data (name, equipment) rides along as display metadata
 *   only and may be absent (null/empty) when resolution fails.
 * - `0` kg is a real external load and is preserved; `null` weight means no
 *   external load was logged. RPE appears only when the set captured one.
 */

import type { CompletedSessionContext } from '@/application/ports/training-history-repository';
import type { EquipmentType } from '@/domain/types/exercise';
import { calculateSessionMetrics } from '@/domain/services/session-metrics';
import { resolveOccurrenceSubstitutionState } from '@/domain/services/session-exercise-substitution';
import type { ExerciseLog, SetLog } from '@/domain/entities/workout-session';

/** Current catalog display metadata for one exercise id. Display-only. */
export interface ExerciseMeta {
  readonly name: string;
  readonly slug: string;
  readonly equipment: EquipmentType;
}

/** The persisted prescription snapshot of one exercise entry. */
export type CompletedSessionPrescriptionDto =
  | {
      readonly type: 'reps';
      readonly sets: number;
      readonly minReps: number;
      readonly maxReps: number;
    }
  | {
      readonly type: 'duration';
      readonly sets: number;
      readonly seconds: number;
    };

/** One logged set, in the shape the detail screen renders. */
export type CompletedSessionSetDto =
  | {
      readonly type: 'reps';
      readonly setNumber: number;
      readonly reps: number;
      /** null = no external load; 0 = a real, logged 0 kg load. */
      readonly weightKg: number | null;
      readonly rpe: number | null;
    }
  | {
      readonly type: 'duration';
      readonly setNumber: number;
      readonly durationSeconds: number;
      readonly weightKg: number | null;
      readonly rpe: number | null;
    };

/** One exercise occurrence in the completed session. */
export interface CompletedSessionEntryDto {
  /** The exercise the program's template authored for this occurrence. */
  readonly authoredExerciseId: string;
  /** The exercise actually performed (equals authored when not substituted). */
  readonly performedExerciseId: string;
  /**
   * Derived: the performed identity diverged from the authored one. The
   * domain owns this derivation; it is never part of the persisted record.
   */
  readonly isSubstituted: boolean;
  /**
   * The persisted skip decision for this occurrence (M10): the user's
   * explicit choice to not perform it in this session, never inferred from
   * zero logged sets. Skipped occurrences carry zero logged sets, so they are
   * naturally absent from per-exercise performance history regardless.
   */
  readonly isSkipped: boolean;
  /** Position within the session — the entry's identity component. */
  readonly exerciseOrder: number;
  /**
   * Current catalog name of the PERFORMED exercise, or null when unresolved.
   * This is the exercise the user actually trained — the visible identity.
   */
  readonly exerciseName: string | null;
  /**
   * Current catalog name of the AUTHORED exercise, or null when the catalog
   * cannot resolve it. Equal to `exerciseName` when the entry was performed
   * as authored. Never fabricated from other data.
   */
  readonly authoredExerciseName: string | null;
  /** Current catalog slug (links to the exercise's history page), or null when unresolved. */
  readonly exerciseSlug: string | null;
  /** Current catalog equipment, or null when unresolved. Display-only. */
  readonly equipment: EquipmentType | null;
  readonly restSeconds: number;
  readonly prescription: CompletedSessionPrescriptionDto;
  readonly sets: ReadonlyArray<CompletedSessionSetDto>;
}

/** Plain numeric metrics, as already computed by the domain service. */
export interface CompletedSessionMetricsDto {
  readonly totalSets: number;
  readonly totalReps: number;
  readonly totalDurationSeconds: number;
  readonly volume: number;
}

/** One completed session, fully serializable for the detail screen. */
export interface CompletedSessionDto {
  readonly sessionId: string;
  readonly workoutName: string;
  readonly programName: string;
  readonly startedAt: string;
  /** ISO 8601 — non-null: detail addresses completed sessions only. */
  readonly completedAt: string;
  readonly entries: ReadonlyArray<CompletedSessionEntryDto>;
  readonly metrics: CompletedSessionMetricsDto;
}

function serializeCompletedSet(set: SetLog): CompletedSessionSetDto {
  if (set.type === 'reps') {
    return {
      type: 'reps',
      setNumber: set.setNumber,
      reps: set.reps,
      weightKg: set.weightKg,
      rpe: set.rpe,
    };
  }
  return {
    type: 'duration',
    setNumber: set.setNumber,
    durationSeconds: set.durationSeconds,
    weightKg: set.weightKg,
    rpe: set.rpe,
  };
}

function serializeEntry(
  log: ExerciseLog,
  catalog: ReadonlyMap<string, ExerciseMeta>,
): CompletedSessionEntryDto {
  const performed = catalog.get(log.performedExerciseId);
  const authored = catalog.get(log.authoredExerciseId);
  const prescription = log.prescription;
  const substitution = resolveOccurrenceSubstitutionState(log);
  return {
    authoredExerciseId: log.authoredExerciseId,
    performedExerciseId: log.performedExerciseId,
    isSubstituted: substitution.isSubstituted,
    isSkipped: log.isSkipped,
    exerciseOrder: log.order,
    exerciseName: performed?.name ?? null,
    authoredExerciseName: authored?.name ?? null,
    exerciseSlug: performed?.slug ?? null,
    equipment: performed?.equipment ?? null,
    restSeconds: log.restSeconds,
    prescription:
      prescription.type === 'reps'
        ? {
            type: 'reps',
            sets: prescription.sets,
            minReps: prescription.minReps,
            maxReps: prescription.maxReps,
          }
        : {
            type: 'duration',
            sets: prescription.sets,
            seconds: prescription.seconds,
          },
    sets: log.sets.map(serializeCompletedSet),
  };
}

/**
 * Maps the hydrated completed-session context to its serializable DTO.
 * `exerciseCatalog` carries current catalog display metadata keyed by
 * exercise id (duplicates share one entry); it may be sparse — an
 * unresolved exercise serializes with a null name and empty equipment, and
 * the view degrades to a positional label instead of failing.
 * Metrics are computed here in the application layer via the domain
 * service — never in SQL. Entry order (exerciseOrder) and set order
 * (setNumber) are preserved exactly as hydrated.
 */
export function toCompletedSessionDto(
  context: CompletedSessionContext,
  exerciseCatalog: ReadonlyMap<string, ExerciseMeta>,
): CompletedSessionDto {
  return {
    sessionId: context.session.id,
    workoutName: context.workoutName,
    programName: context.programName,
    startedAt: context.session.startedAt.toISOString(),
    completedAt: context.session.completedAt.toISOString(),
    entries: context.session.exerciseLogs.map((log) =>
      serializeEntry(log, exerciseCatalog),
    ),
    metrics: calculateSessionMetrics(context.session),
  };
}
