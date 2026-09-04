/**
 * Serializable DTOs for the per-exercise history screen
 * (`/history/exercises/[slug]`).
 *
 * Self-contained by design, mirroring the completed-session DTO module's
 * convention that each boundary module owns its own wire contracts: the set
 * and prescription unions are structurally identical to
 * `CompletedSessionSetDto`/`CompletedSessionPrescriptionDto`, so the
 * history label helpers format them unchanged, but no module imports the
 * other's shapes.
 *
 * Historical-truth rules (same family as the completed-session DTOs):
 * - The persisted prescription snapshot and logged sets ARE the record.
 * - `workingLoadKg` is the occurrence's single truthful external load
 *   (minimum across its performed sets) or null when no truthful single
 *   load exists (a bodyweight set or a duration prescription). `0` is a
 *   real load and is preserved; null weight means no external load.
 * - Entries are newest first (the port's recency ladder); `trend` is the
 *   chronological (oldest first) externally loaded subsequence.
 */

import type { CompletedExerciseOccurrence } from '@/application/ports/training-history-repository';
import type { Exercise } from '@/domain/entities/exercise';
import type { SetLog } from '@/domain/entities/workout-session';
import type { RepPrescription } from '@/domain/value-objects/rep-prescription';
import { resolveOccurrenceWorkingLoad } from '@/domain/services/occurrence-working-load';
import type { EquipmentType } from '@/domain/types/exercise';

/** The persisted prescription snapshot of one occurrence. */
export type ExerciseHistoryPrescriptionDto =
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

/** One logged set of one occurrence, in the shape the screen renders. */
export type ExerciseHistorySetDto =
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

/** One completed occurrence of the exercise, newest first in `entries`. */
export interface ExerciseHistoryEntryDto {
  readonly sessionId: string;
  /** Position within the session — the occurrence's identity component. */
  readonly exerciseOrder: number;
  /** ISO 8601 — non-null: occurrences belong to completed sessions only. */
  readonly completedAt: string;
  readonly programName: string;
  readonly workoutName: string;
  readonly prescription: ExerciseHistoryPrescriptionDto;
  readonly sets: ReadonlyArray<ExerciseHistorySetDto>;
  /**
   * The occurrence's single truthful working load (minimum external load
   * across its performed sets), or null when no truthful single load exists.
   */
  readonly workingLoadKg: number | null;
}

/** One chronological trend point: only externally loaded occurrences. */
export interface ExerciseHistoryTrendPointDto {
  readonly completedAt: string;
  readonly workingLoadKg: number;
}

/** Catalog summary of the exercise the history page is about. */
export interface ExerciseHistoryExerciseDto {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly equipment: EquipmentType;
}

/**
 * Hard ceiling on occurrences read per request. A deliberate display bound
 * (no pagination on this screen), matching the training-history DTO module's
 * page-size convention.
 */
export const EXERCISE_HISTORY_OCCURRENCE_LIMIT = 50;

/** The assembled per-exercise history, serializable for Server Components. */
export interface ExerciseHistoryDto {
  readonly exercise: ExerciseHistoryExerciseDto;
  readonly entries: ReadonlyArray<ExerciseHistoryEntryDto>;
  readonly trend: ReadonlyArray<ExerciseHistoryTrendPointDto>;
  /**
   * True when the bounded read returned exactly its limit — the screen then
   * labels the list as the latest N occurrences instead of implying an
   * all-time total. No COUNT query backs this: reaching the bound is the
   * signal.
   */
  readonly isLimited: boolean;
}

function serializeSet(set: SetLog): ExerciseHistorySetDto {
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

function serializePrescription(
  prescription: RepPrescription,
): ExerciseHistoryPrescriptionDto {
  if (prescription.type === 'reps') {
    return {
      type: 'reps',
      sets: prescription.sets,
      minReps: prescription.minReps,
      maxReps: prescription.maxReps,
    };
  }
  return {
    type: 'duration',
    sets: prescription.sets,
    seconds: prescription.seconds,
  };
}

function hasExternalLoad(
  entry: ExerciseHistoryEntryDto,
): entry is ExerciseHistoryEntryDto & { readonly workingLoadKg: number } {
  return entry.workingLoadKg !== null;
}

/**
 * Maps the port's occurrences to the serializable history DTO. The working
 * load is resolved here via the domain mirror service — never in SQL — and
 * the trend is the chronological (oldest first) externally loaded
 * subsequence of the entries.
 */
export function toExerciseHistoryDto(
  exercise: Exercise,
  occurrences: ReadonlyArray<CompletedExerciseOccurrence>,
): ExerciseHistoryDto {
  const entries: ExerciseHistoryEntryDto[] = occurrences.map((occurrence) => {
    const load = resolveOccurrenceWorkingLoad(occurrence.prescription, occurrence.sets);
    return {
      sessionId: occurrence.sessionId,
      exerciseOrder: occurrence.exerciseOrder,
      completedAt: occurrence.completedAt.toISOString(),
      programName: occurrence.programName,
      workoutName: occurrence.workoutName,
      prescription: serializePrescription(occurrence.prescription),
      sets: occurrence.sets.map(serializeSet),
      workingLoadKg: load.kind === 'external' ? load.loadKg : null,
    };
  });

  const trend: ExerciseHistoryTrendPointDto[] = entries
    .filter(hasExternalLoad)
    .map((entry) => ({
      completedAt: entry.completedAt,
      workingLoadKg: entry.workingLoadKg,
    }))
    .reverse();

  return {
    exercise: {
      id: exercise.id,
      name: exercise.name,
      slug: exercise.slug,
      equipment: exercise.equipment,
    },
    entries,
    trend,
    isLimited: occurrences.length >= EXERCISE_HISTORY_OCCURRENCE_LIMIT,
  };
}


