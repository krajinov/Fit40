/**
 * Serializable DTOs for the M18 Progress surface activity read model
 * (`/progress`) — memo §4.1–§4.5, §6.3.
 *
 * Plain, serializable shapes: ISO 8601 instants, numbers and nulls, with no
 * presentation-formatted text (week labels, "This week", unit strings and
 * rounding belong to the presentation layer).
 *
 * Presence is carried, not inferred: `externalLoadVolumeKgReps` is `null`
 * when a week (or the period) holds NO eligible external-load data and a
 * number — including a genuine `0` — otherwise. A consumer that renders `0`
 * for `null` (or hides a real `0`) would fabricate a fact, so the two cases
 * are separate fields states on purpose.
 *
 * Week facts arrive pre-computed from the Domain's own progress service
 * (`src/domain/services/training-progress.ts`, M18 Slice 1); this module only
 * maps them, never re-buckets, re-sums or re-decides anything.
 */

import type { ExerciseSummaryDto } from '@/application/dto/exercise';
import type { PersonalRecordMetricDto } from '@/application/dto/personal-records';
import { comparePerformancePositions } from '@/domain/services/personal-record-metrics';
import type { PersonalBest, RecordEvent } from '@/domain/services/personal-records';
import type {
  AverageWorkoutsPerWeek,
  ProgressPeriodTotals,
  ProgressWeekSummary,
} from '@/domain/services/training-progress';

/**
 * How many recent UTC training weeks the Progress surface covers: the current
 * partial week plus 12 preceding completed weeks (memo §5.1). Fixed for M18 —
 * no user-selectable horizon.
 */
export const PROGRESS_HORIZON_WEEK_COUNT = 13;

/** One UTC training week's factual totals (memo §4.1–§4.3). */
export interface ProgressActivityWeekDto {
  /** ISO 8601 — the week's Monday 00:00:00.000 UTC (inclusive edge). */
  readonly weekStart: string;
  readonly completedWorkouts: number;
  readonly loggedSets: number;
  /** null = no eligible external-load data; 0 = a genuine zero (memo §6.3). */
  readonly externalLoadVolumeKgReps: number | null;
}

/** Totals across the whole horizon, current partial week included (§4.4). */
export interface ProgressActivityTotalsDto {
  readonly completedWorkouts: number;
  readonly loggedSets: number;
  /** null iff no week in the period had eligible external-load data. */
  readonly externalLoadVolumeKgReps: number | null;
}

/** The §4.5 anchored average, with the exact denominator used. */
export interface ProgressActivityAverageDto {
  readonly workoutsPerWeek: number;
  readonly denominatorWeeks: number;
}

/** The Progress surface's activity read model, ready for presentation. */
export interface ProgressActivityDto {
  /** ISO 8601 — the current (partial) week's Monday 00:00:00.000 UTC. */
  readonly currentWeekStart: string;
  /** The horizon's weeks, oldest → newest; the final entry is the current one. */
  readonly weeks: ReadonlyArray<ProgressActivityWeekDto>;
  readonly totals: ProgressActivityTotalsDto;
  /** null when no completed week holds a workout (memo §4.5) — never 0. */
  readonly average: ProgressActivityAverageDto | null;
}

/** Everything the mapper needs; every fact already resolved by the Domain. */
export interface ProgressActivityDtoInput {
  /** Every week summary, oldest → newest; the caller owns the week count. */
  readonly summaries: ReadonlyArray<ProgressWeekSummary>;
  readonly totals: ProgressPeriodTotals;
  readonly average: AverageWorkoutsPerWeek | null;
}

function toWeekDto(summary: ProgressWeekSummary): ProgressActivityWeekDto {
  return {
    weekStart: summary.window.weekStart.toISOString(),
    completedWorkouts: summary.completedWorkouts,
    loggedSets: summary.loggedSets,
    externalLoadVolumeKgReps: summary.externalLoad?.volumeKgReps ?? null,
  };
}

/**
 * Maps the Domain's summaries onto the wire DTO. Pure: no repository, no
 * clock, no week arithmetic.
 *
 * The current week is the LAST supplied window (the
 * `listRecentTrainingWeekWindows` contract); a caller that supplies no
 * windows violates that contract and fails loudly rather than emitting a
 * fabricated `currentWeekStart`.
 */
export function toProgressActivityDto(input: ProgressActivityDtoInput): ProgressActivityDto {
  const weeks = input.summaries.map(toWeekDto);
  const currentWeek = weeks[weeks.length - 1];
  if (currentWeek === undefined) {
    throw new Error('Progress activity contract violated: no week summaries supplied');
  }

  return {
    currentWeekStart: currentWeek.weekStart,
    weeks,
    totals: {
      completedWorkouts: input.totals.completedWorkouts,
      loggedSets: input.totals.loggedSets,
      externalLoadVolumeKgReps: input.totals.externalLoad?.volumeKgReps ?? null,
    },
    average:
      input.average === null
        ? null
        : {
            workoutsPerWeek: input.average.workoutsPerWeek,
            denominatorWeeks: input.average.denominatorWeeks,
          },
  };
}

// ─── Historical PR events (M18 Slice 5, memo §8) ────────────────────────────

/**
 * How many newest historical PR events the display list carries. The exact
 * count is never capped by this bound (memo §8.5): it is applied only after the
 * exact event set is known, and it never rewrites the count.
 */
export const PROGRESS_RECORD_EVENT_LIMIT = 10;

/** One historical PR event as the Progress surface renders it. */
export interface ProgressRecordEventDto {
  readonly exerciseId: string;
  readonly exerciseName: string;
  readonly exerciseSlug: string;
  readonly metric: PersonalRecordMetricDto;
  /** The event value in the metric's own unit: kilograms, reps or seconds. */
  readonly value: number;
  /** The best eligible value strictly before the event, or null for a first exposure. */
  readonly previousBest: number | null;
  /** The completed session holding the event's logged set. */
  readonly sessionId: string;
  /** ISO 8601 — non-null: events come from completed sessions only. */
  readonly completedAt: string;
  /**
   * True iff this event's own logged set IS the current all-time best's owning
   * position for its (performed exercise, metric) — the M12 earliest-equal
   * ownership rule, never a bare value comparison (memo §8.5).
   */
  readonly stillStanding: boolean;
}

/** The period's historical PR-event answer (memo §8.3–§8.5). */
export interface ProgressRecordEventsDto {
  /** EXACT number of events established in the period — never capped. */
  readonly recordEventCount: number;
  /**
   * At most `PROGRESS_RECORD_EVENT_LIMIT` rows, ASCENDING by the M12 position
   * ladder (oldest → newest): the newest-N selection presented in the
   * timeline's own chronological order (memo §8.4). Catalog-unresolved events
   * are omitted here and never change the count.
   */
  readonly events: ReadonlyArray<ProgressRecordEventDto>;
}

/**
 * The newest `PROGRESS_RECORD_EVENT_LIMIT` events by the M12 ladder, returned
 * ASCENDING (oldest → newest): selection is newest-first, presentation order is
 * the ladder's own order (memo §8.4) — never a date-only sort, never insertion
 * order. The exact event set is untouched, and a caller (or the mapper) may use
 * this to learn which exercises the display actually needs.
 */
export function selectNewestProgressRecordEvents(
  events: ReadonlyArray<RecordEvent>,
): ReadonlyArray<RecordEvent> {
  return [...events]
    .sort((a, b) => comparePerformancePositions(b.position, a.position))
    .slice(0, PROGRESS_RECORD_EVENT_LIMIT)
    .reverse();
}

/** Everything the record-event mapper needs; every fact already resolved. */
export interface ProgressRecordEventsDtoInput {
  /** Every resolved historical event of the period (exact, uncapped). */
  readonly events: ReadonlyArray<RecordEvent>;
  /** Current bests for the DISPLAYED events' exercises (M12's exact read). */
  readonly currentBests: ReadonlyArray<PersonalBest>;
  /** Catalog summaries; unresolved ids are absent and omit rows only. */
  readonly exercises: ReadonlyArray<ExerciseSummaryDto>;
}

/**
 * The identity of one logged set inside its session — the ownership key the
 * M12 ladder uses for a set (`sessionId`, `exerciseOrder`, `setNumber`).
 * NUL-joined so distinct positions can never collide.
 */
function loggedSetKey(position: {
  readonly sessionId: string;
  readonly exerciseOrder: number;
  readonly setNumber: number;
}): string {
  return `${position.sessionId}\u0000${position.exerciseOrder}\u0000${position.setNumber}`;
}

/**
 * Maps the exact event set onto the wire DTO. Pure: no repository, no clock,
 * no re-resolution — the events and the current bests arrive authoritative.
 *
 * `recordEventCount` is the EXACT period total (`events.length`), while the
 * display list is the newest `PROGRESS_RECORD_EVENT_LIMIT`, chronologically
 * ordered, with still-stands decided by POSITION OWNERSHIP: an event still
 * stands iff the current best for its (performed exercise, metric) is owned by
 * that very logged set. A catalog-unresolved event is omitted from the list and
 * never changes the count.
 */
export function toProgressRecordEventsDto(
  input: ProgressRecordEventsDtoInput,
): ProgressRecordEventsDto {
  const exercisesById = new Map(input.exercises.map((exercise) => [exercise.id, exercise]));
  const ownersByKey = new Map<string, string>();
  for (const best of input.currentBests) {
    ownersByKey.set(`${best.exerciseId}\u0000${best.metric}`, loggedSetKey(best.position));
  }

  const events: ProgressRecordEventDto[] = [];
  for (const event of selectNewestProgressRecordEvents(input.events)) {
    const exercise = exercisesById.get(event.exerciseId);
    // Missing catalog metadata never rewrites historical truth: the row is
    // omitted from the display list, and the exact count is unaffected.
    if (exercise === undefined) continue;

    events.push({
      exerciseId: event.exerciseId,
      exerciseName: exercise.name,
      exerciseSlug: exercise.slug,
      metric: event.metric,
      value: event.value,
      previousBest: event.previousBest,
      sessionId: event.position.sessionId,
      completedAt: event.position.completedAt.toISOString(),
      stillStanding:
        ownersByKey.get(`${event.exerciseId}\u0000${event.metric}`) ===
        loggedSetKey(event.position),
    });
  }

  return { recordEventCount: input.events.length, events };
}
