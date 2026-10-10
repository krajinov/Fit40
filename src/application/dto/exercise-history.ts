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
 * - `comparison` (M18 Slice 8) is its own period fact: the first and latest
 *   ELIGIBLE working loads completed inside the 13-week horizon, over UNCAPPED
 *   history. It is never derived from `entries`, `trend` or `isLimited` — the
 *   50-occurrence display bound cannot change it (memo §7.3).
 * - `personalBests` (M12) is independent of both: the exercise's exact
 *   all-time records over ALL completed history, not just the bounded
 *   occurrence window rendered below them. They never feed the trend,
 *   pagination, or any progression input.
 */

import type { PersonalBestDto } from '@/application/dto/personal-records';
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
  /** Occurrence identity — one exercise can occur multiple times per session. */
  readonly sessionId: string;
  readonly exerciseOrder: number;
  readonly completedAt: string;
  readonly workingLoadKg: number;
  /**
   * The heaviest `max-load` value (kg) whose event this occurrence established,
   * or null when it established none (M18 Slice 7, memo §8.6). It is the
   * RECORD SET's load, which may exceed the plotted working load (the minimum
   * across the occurrence's sets) — never a statement that the plotted point is
   * the record. An event, never a current-best claim.
   */
  readonly recordKg: number | null;
}

/**
 * One occurrence's resolved `max-load` marker, projected by the use case from
 * the M12 event set. `recordKg` is the heaviest event value of that occurrence
 * (events inside one occurrence are strictly increasing by set number, so the
 * latest event is also the heaviest).
 */
export interface ExerciseHistoryRecordMarker {
  readonly sessionId: string;
  readonly exerciseOrder: number;
  readonly recordKg: number;
}

/**
 * The factual direction between the period's two compared loads (M18 Slice 8,
 * memo §7.4). Presentation renders the word; it never derives it.
 */
export type ExerciseHistoryComparisonDirection = 'increased' | 'unchanged' | 'decreased';

/** One compared load: the value in kilograms and the date it was produced. */
export interface ExerciseHistoryLoadPointDto {
  readonly loadKg: number;
  /** ISO 8601 — non-null: compared occurrences belong to completed sessions. */
  readonly completedAt: string;
}

/**
 * The period's first-vs-latest working-load comparison, or the honest reason
 * there is none (memo §7.5/§7.6). The compared case carries the two eligible
 * observations — the ladder's FIRST and LATEST, never the lowest and highest
 * loads — and the Direction fact as the Domain resolved it.
 */
export type ExerciseHistoryComparisonDto =
  | {
      readonly status: 'compared';
      readonly first: ExerciseHistoryLoadPointDto;
      readonly latest: ExerciseHistoryLoadPointDto;
      readonly direction: ExerciseHistoryComparisonDirection;
    }
  | {
      readonly status: 'insufficient';
      /**
       * `no_external_load`: the period holds occurrences, but none carried an
       * external working load — the "no external load was logged" wording
       * applies, not the ≥2-points one (memo §7.6).
       * `fewer_than_two_points`: zero or one eligible loaded occurrence — the
       * ≥2-points rule, stated as such (memo §7.5).
       */
      readonly reason: 'no_external_load' | 'fewer_than_two_points';
    };

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
   * The period's first-vs-latest eligible working load (M18 Slice 8, memo §7),
   * or the honest insufficient-data state. It is independent of `entries` and
   * `trend`: the comparison is scoped to the 13-week horizon over UNCAPPED
   * history, never to the bounded display window.
   */
  readonly comparison: ExerciseHistoryComparisonDto;
  /**
   * The exercise's exact current all-time personal bests (M12), one entry per
   * applicable metric, in the repository's deterministic order (metric
   * ascending). Only metrics with eligible completed history appear; an empty
   * list is a valid result, never an error.
   */
  readonly personalBests: ReadonlyArray<PersonalBestDto>;
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
 *
 * `personalBests` arrive already serialized (the M12 records read) and are
 * embedded in the order the repository delivered them: this module renders
 * them next to the occurrence window without touching, sorting or deriving
 * anything about them.
 *
 * `recordMarkers` arrive already resolved (M18 Slice 7): the use case ran the
 * M12 pipeline and projected the `max-load` events onto occurrence identities.
 * This module only attaches the fact to the matching trend point — it detects
 * nothing, compares nothing and never infers a record from the plotted values.
 */
export function toExerciseHistoryDto(
  exercise: Exercise,
  occurrences: ReadonlyArray<CompletedExerciseOccurrence>,
  personalBests: ReadonlyArray<PersonalBestDto>,
  recordMarkers: ReadonlyArray<ExerciseHistoryRecordMarker>,
  comparison: ExerciseHistoryComparisonDto,
): ExerciseHistoryDto {
  const recordKgByOccurrence = new Map<string, number>(
    recordMarkers.map((marker) => [
      `${marker.sessionId}#${marker.exerciseOrder}`,
      marker.recordKg,
    ]),
  );

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
      sessionId: entry.sessionId,
      exerciseOrder: entry.exerciseOrder,
      completedAt: entry.completedAt,
      workingLoadKg: entry.workingLoadKg,
      recordKg: recordKgByOccurrence.get(`${entry.sessionId}#${entry.exerciseOrder}`) ?? null,
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
    comparison,
    personalBests,
    isLimited: occurrences.length >= EXERCISE_HISTORY_OCCURRENCE_LIMIT,
  };
}


