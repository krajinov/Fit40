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
