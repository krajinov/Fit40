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
  readonly exerciseId: string;
  /** Position within the session — the entry's identity component. */
  readonly exerciseOrder: number;
  /** Current catalog name, or null when the exercise was not resolved. */
  readonly exerciseName: string | null;
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
  const meta = catalog.get(log.exerciseId);
  const prescription = log.prescription;
  return {
    exerciseId: log.exerciseId,
    exerciseOrder: log.order,
    exerciseName: meta?.name ?? null,
    equipment: meta?.equipment ?? null,
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
