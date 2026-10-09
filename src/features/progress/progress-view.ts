/**
 * Server-side view assembly for the Progress surface (M18 Slice 4).
 *
 * `toProgressActivityView` is the pure DTO → view-model mapping; labels and bar
 * geometry are computed here so the components stay presentational (they map
 * nothing, they compare nothing — the view never re-decides a fact the
 * Application or Domain layer already resolved).
 *
 * `buildProgressView` reads the single progress use case and degrades to
 * `unavailable` — never to zero weeks — when the read fails, mirroring the M13
 * dashboard convention (typed rejection and unexpected infrastructure failure
 * both degrade; the unexpected one is logged per docs/error-handling.md).
 *
 * Honesty rules from `docs/training-progress.md`:
 * - all 13 weeks always render (zero-activity weeks are authoritative zeros);
 * - the current week is the LAST supplied week and is marked "This week";
 * - period totals include the current week; the average never does (§4.4/§4.5);
 * - external load is `kg × reps` and a week with no eligible loaded set is
 *   absent (`null`), never a fabricated `0`; a genuine `0 kg × reps` week is.
 */

import type {
  ProgressActivityDto,
  ProgressActivityWeekDto,
} from '@/application/dto/training-progress';
import { formatHistoryCount } from '@/features/history/history-labels';
import {
  ABSENT_LOAD_POINT_LABEL,
  averageBasisCaption,
  averageWorkoutsLabel,
  EXTERNAL_LOAD_CHART_ARIA_LABEL,
  EXTERNAL_LOAD_CHART_CAPTION,
  EXTERNAL_LOAD_CHART_TITLE,
  formatExternalLoadValue,
  formatSetsValue,
  formatWeekRange,
  formatWorkoutsValue,
  NO_AVERAGE_LABEL,
  NO_LOADED_SETS_NOTE,
  SETS_CHART_ARIA_LABEL,
  SETS_CHART_CAPTION,
  SETS_CHART_TITLE,
  SUMMARY_NOTE_EMPTY,
  SUMMARY_TITLE,
  WORKOUTS_CHART_ARIA_LABEL,
  WORKOUTS_CHART_CAPTION,
  WORKOUTS_CHART_TITLE,
} from '@/features/progress/progress-labels';
import { getTrainingProgressActivityUseCase } from '@/features/progress/services';

/** One week's chart point, fully resolved for rendering. */
export interface ProgressChartPointView {
  /** Stable React key: the week's UTC start instant. */
  readonly key: string;
  /** "Jun 29 – Jul 5" — component-formatted, never a raw instant. */
  readonly rangeLabel: string;
  /** "3 workouts" / "18 sets" / "1,240 kg × reps" / "No loaded sets". */
  readonly valueLabel: string;
  readonly isCurrentWeek: boolean;
  /** No eligible external-load data this week (volume charts only). */
  readonly isAbsent: boolean;
  /** Precomputed bar height in px; the floor for zero or absent weeks. */
  readonly barHeightPx: number;
}

export interface ProgressChartView {
  readonly title: string;
  readonly caption: string;
  readonly ariaLabel: string;
  /** An honest absence note, or null when the chart needs none. */
  readonly note: string | null;
  readonly points: ReadonlyArray<ProgressChartPointView>;
}

export interface ProgressStatView {
  readonly label: string;
  readonly value: string;
}

export interface ProgressSummaryView {
  readonly title: string;
  readonly stats: ReadonlyArray<ProgressStatView>;
  readonly averageLabel: string;
  readonly averageCaption: string | null;
}

export interface ProgressActivityView {
  /** Factual empty copy when the horizon holds no completed workout. */
  readonly emptyNote: string | null;
  readonly workoutsChart: ProgressChartView;
  readonly setsChart: ProgressChartView;
  readonly externalLoadChart: ProgressChartView;
  readonly summary: ProgressSummaryView;
}

export type ProgressActivityState =
  | { readonly status: 'loaded'; readonly data: ProgressActivityView }
  | { readonly status: 'unavailable' };

/** Zero-value and absent weeks keep a visible floor (the M13 strip idiom). */
const FLOOR_ZERO_PX = 3;
const FLOOR_NONZERO_PX = 8;

function buildChart(input: {
  readonly title: string;
  readonly caption: string;
  readonly ariaLabel: string;
  readonly weeks: ReadonlyArray<ProgressActivityWeekDto>;
  /** null = the week has no data for this metric (external load absence). */
  readonly valueOf: (week: ProgressActivityWeekDto) => number | null;
  readonly formatValue: (value: number) => string;
  readonly note: string | null;
}): ProgressChartView {
  const values = input.weeks.map(input.valueOf);
  const present = values.filter((value): value is number => value !== null);
  const max = present.length === 0 ? 1 : Math.max(1, ...present);

  const points = input.weeks.map((week, index) => {
    const raw = values[index];
    const value = raw === undefined ? null : raw;
    const isAbsent = value === null;
    const barHeightPx = isAbsent
      ? FLOOR_ZERO_PX
      : Math.max(
          Math.round((value / max) * 100),
          value > 0 ? FLOOR_NONZERO_PX : FLOOR_ZERO_PX,
        );

    return {
      key: week.weekStart,
      rangeLabel: formatWeekRange(week.weekStart),
      valueLabel: value === null ? ABSENT_LOAD_POINT_LABEL : input.formatValue(value),
      isCurrentWeek: index === input.weeks.length - 1,
      isAbsent,
      barHeightPx,
    };
  });

  return {
    title: input.title,
    caption: input.caption,
    ariaLabel: input.ariaLabel,
    note: input.note,
    points,
  };
}

/**
 * Pure DTO → view mapping. Nothing is sorted, trimmed or recomputed: the 13
 * weeks arrive oldest → newest with the current partial week last, and the
 * summary reflects them exactly (totals include that week; the average is the
 * Domain's anchored answer, or the §4.5 missing-data copy).
 */
export function toProgressActivityView(dto: ProgressActivityDto): ProgressActivityView {
  const hasAnyTraining = dto.totals.completedWorkouts > 0;
  const totalLoad = dto.totals.externalLoadVolumeKgReps;
  const loadAbsent = totalLoad === null;

  return {
    emptyNote: hasAnyTraining ? null : SUMMARY_NOTE_EMPTY,
    workoutsChart: buildChart({
      title: WORKOUTS_CHART_TITLE,
      caption: WORKOUTS_CHART_CAPTION,
      ariaLabel: WORKOUTS_CHART_ARIA_LABEL,
      weeks: dto.weeks,
      valueOf: (week) => week.completedWorkouts,
      formatValue: formatWorkoutsValue,
      note: null,
    }),
    setsChart: buildChart({
      title: SETS_CHART_TITLE,
      caption: SETS_CHART_CAPTION,
      ariaLabel: SETS_CHART_ARIA_LABEL,
      weeks: dto.weeks,
      valueOf: (week) => week.loggedSets,
      formatValue: formatSetsValue,
      note: null,
    }),
    externalLoadChart: buildChart({
      title: EXTERNAL_LOAD_CHART_TITLE,
      caption: EXTERNAL_LOAD_CHART_CAPTION,
      ariaLabel: EXTERNAL_LOAD_CHART_ARIA_LABEL,
      weeks: dto.weeks,
      valueOf: (week) => week.externalLoadVolumeKgReps,
      formatValue: formatExternalLoadValue,
      // Absence (no week carried eligible loaded sets) is stated in words;
      // a genuine 0 kg × reps week is a value and is never suppressed.
      note: loadAbsent ? NO_LOADED_SETS_NOTE : null,
    }),
    summary: {
      title: SUMMARY_TITLE,
      stats: [
        { label: 'Workouts', value: formatHistoryCount(dto.totals.completedWorkouts) },
        { label: 'Sets', value: formatHistoryCount(dto.totals.loggedSets) },
        {
          label: 'External load (kg × reps)',
          value: loadAbsent ? '—' : formatExternalLoadValue(totalLoad),
        },
      ],
      averageLabel:
        dto.average === null
          ? NO_AVERAGE_LABEL
          : averageWorkoutsLabel(dto.average.workoutsPerWeek),
      averageCaption:
        dto.average === null ? null : averageBasisCaption(dto.average.denominatorWeeks),
    },
  };
}

/**
 * Builds the Progress surface state for one authenticated user at one request
 * clock. A typed rejection or an unexpected failure both degrade to
 * `unavailable` (the failure is logged) — never to zero weeks, which would
 * claim the user did not train.
 */
export async function buildProgressView(
  userId: string,
  now: Date,
): Promise<ProgressActivityState> {
  try {
    const result = await getTrainingProgressActivityUseCase.execute({ userId, now });
    return result.ok
      ? { status: 'loaded', data: toProgressActivityView(result.data) }
      : { status: 'unavailable' };
  } catch (error: unknown) {
    console.error(`Unexpected failure reading training progress for user ${userId}`, error);
    return { status: 'unavailable' };
  }
}
