/**
 * Serializable DTOs for the M13 dashboard weekly insights (Slice 3).
 *
 * Plain, serializable shapes: ISO 8601 instants, plain id strings and no
 * presentation-formatted text (week labels, "vs last week" wording and metric
 * units belong to the presentation layer).
 *
 * Two semantic notes that the shapes must not blur:
 * - Week facts come from the Domain's own summaries (`TrainingWeekSummary`,
 *   produced by `summarizeTrainingWeeks`) and deltas from
 *   `compareTrainingWeeks`. This module maps them; it never re-buckets,
 *   re-orders or re-computes week arithmetic beyond testing whether a
 *   Domain-provided window contains one instant.
 * - `currentPersonalBestsSetThisWeek` counts CURRENT, still-standing all-time
 *   personal bests whose winning performance was established in the current
 *   week — never historical PR events. A best set this week and surpassed
 *   later is not a current best and therefore is not counted, and an exercise
 *   whose catalog metadata cannot be resolved still counts: the count comes
 *   from the record read, not from the rendered rows.
 */

import type { ExerciseSummaryDto } from '@/application/dto/exercise';
import type { PersonalRecordMetricDto } from '@/application/dto/personal-records';
import { comparePerformancePositions } from '@/domain/services/personal-record-metrics';
import type { PersonalBest } from '@/domain/services/personal-records';
import type {
  TrainingWeekComparison,
  TrainingWeekSummary,
  TrainingWeekWindow,
} from '@/domain/services/training-week';

/**
 * How many recent current personal bests the insights carry. A bound on the
 * rendered list — the newest winners — not on the record read itself, which
 * answers the whole lookback exactly.
 */
export const RECENT_PERSONAL_BESTS_LIMIT = 5;

/** One UTC training week's factual totals. */
export interface WeeklyInsightWeekDto {
  /** ISO 8601 — the week's Monday 00:00:00.000 UTC (inclusive edge). */
  readonly weekStart: string;
  readonly completedWorkouts: number;
  readonly loggedSets: number;
}

/**
 * This week against the previous one. Both weeks are concrete UTC windows and
 * a week without training is an authoritative zero, so the deltas are plain
 * integers (negative when the current week is behind) and there is no
 * "untracked" variant.
 */
export interface WeeklyInsightsSummaryDto {
  readonly currentWeek: WeeklyInsightWeekDto;
  readonly previousWeek: WeeklyInsightWeekDto;
  readonly workoutDelta: number;
  readonly setDelta: number;
  /** Current (still-standing) PBs whose winning performance is this week. */
  readonly currentPersonalBestsSetThisWeek: number;
}

/**
 * One recently established current personal best, with the catalog identity the
 * presentation needs to name and link it. Only bests whose catalog exercise
 * resolved appear; the count above is unaffected by such gaps.
 */
export interface RecentPersonalBestDto {
  readonly exerciseId: string;
  readonly exerciseName: string;
  readonly exerciseSlug: string;
  readonly metric: PersonalRecordMetricDto;
  /** The winning value in the metric's own unit: kilograms, reps or seconds. */
  readonly value: number;
  /** The completed session that OWNS the record (M12 earliest-equal owner). */
  readonly sessionId: string;
  /** ISO 8601 — non-null: records come from completed sessions only. */
  readonly completedAt: string;
}

/** The dashboard's weekly insights, ready for the presentation layer. */
export interface TrainingWeeklyInsightsDto {
  /** ISO 8601 — the current UTC week's Monday (matches `weeks`' last entry). */
  readonly weekStart: string;
  /** Exactly the requested week count, oldest → newest (current week last). */
  readonly weeks: ReadonlyArray<WeeklyInsightWeekDto>;
  readonly summary: WeeklyInsightsSummaryDto;
  /** Newest first, at most `RECENT_PERSONAL_BESTS_LIMIT` entries. */
  readonly recentPersonalBests: ReadonlyArray<RecentPersonalBestDto>;
}

// ─── Pure selection and ordering ─────────────────────────────────────────────

/**
 * Whether one instant lies in a Domain-provided window: `[weekStart, weekEnd)`.
 *
 * This is membership testing of a single instant against a window the Domain
 * built — never week arithmetic and never bucketing: the windows themselves
 * always come from `listRecentTrainingWeekWindows`, and the week totals from
 * `summarizeTrainingWeeks`.
 */
function isEstablishedInWindow(instant: Date, window: TrainingWeekWindow): boolean {
  const time = instant.getTime();
  return time >= window.weekStart.getTime() && time < window.weekEnd.getTime();
}

/**
 * Newest first, by the Domain's total chronological ladder REVERSED
 * (`comparePerformancePositions` negated): `completedAt` desc, then
 * `startedAt` desc, session id desc, exercise order desc, set number desc.
 *
 * The tie-break rungs are the Domain's own, so two current bests sharing a
 * completion instant still order deterministically instead of depending on the
 * read's row order or on `Array.prototype.sort` stability. No ownership rule is
 * re-decided here: which performance owns each (exercise, metric) pair is the
 * repository's answer, and this only orders those winners.
 */
export function orderCurrentPersonalBestsNewestFirst(
  bests: ReadonlyArray<PersonalBest>,
): ReadonlyArray<PersonalBest> {
  return [...bests].sort((a, b) => comparePerformancePositions(b.position, a.position));
}

/**
 * The newest `RECENT_PERSONAL_BESTS_LIMIT` current bests, newest first.
 *
 * The cap is applied BEFORE catalog resolution, so the rendered list is "the
 * newest winners, minus any the catalog cannot name". It deliberately never
 * reaches past a newer record to pad the list, which would misrepresent what is
 * recent.
 */
export function selectRecentPersonalBestCandidates(
  bests: ReadonlyArray<PersonalBest>,
): ReadonlyArray<PersonalBest> {
  return orderCurrentPersonalBestsNewestFirst(bests).slice(0, RECENT_PERSONAL_BESTS_LIMIT);
}

// ─── Mapping ─────────────────────────────────────────────────────────────────

function toWeekDto(summary: TrainingWeekSummary): WeeklyInsightWeekDto {
  return {
    weekStart: summary.window.weekStart.toISOString(),
    completedWorkouts: summary.completedWorkouts,
    loggedSets: summary.loggedSets,
  };
}

/** Everything the mapper needs, already read and already week-summarised. */
export interface TrainingWeeklyInsightsInput {
  /** Every week summary, oldest → newest; the caller owns the week count. */
  readonly summaries: ReadonlyArray<TrainingWeekSummary>;
  /** The current week's summary (the last entry of `summaries`). */
  readonly currentWeek: TrainingWeekSummary;
  /** The previous week's summary (the entry before it). */
  readonly previousWeek: TrainingWeekSummary;
  readonly comparison: TrainingWeekComparison;
  /** Every current best the record read returned for the lookback. */
  readonly bests: ReadonlyArray<PersonalBest>;
  /** Catalog summaries for the recent candidates; unresolved ids are absent. */
  readonly exercises: ReadonlyArray<ExerciseSummaryDto>;
}

/**
 * Maps the read results onto the wire DTO. Pure: no repository, no clock, no
 * week arithmetic — every week fact arrives pre-computed from the Domain and
 * every record fact arrives from the repository as authoritative.
 *
 * `recentPersonalBests` is the newest `RECENT_PERSONAL_BESTS_LIMIT` winners
 * with their catalog identity attached; a winner whose exercise the catalog
 * cannot name is omitted (never placeholder-named), while
 * `currentPersonalBestsSetThisWeek` still counts it because that count comes
 * from the record read and not from the rendered rows.
 */
export function toTrainingWeeklyInsightsDto(
  input: TrainingWeeklyInsightsInput,
): TrainingWeeklyInsightsDto {
  const exercisesById = new Map(input.exercises.map((exercise) => [exercise.id, exercise]));

  const recentPersonalBests: RecentPersonalBestDto[] = [];
  for (const best of selectRecentPersonalBestCandidates(input.bests)) {
    const exercise = exercisesById.get(best.exerciseId);
    if (exercise === undefined) continue;
    recentPersonalBests.push({
      exerciseId: best.exerciseId,
      exerciseName: exercise.name,
      exerciseSlug: exercise.slug,
      metric: best.metric,
      value: best.value,
      sessionId: best.position.sessionId,
      completedAt: best.position.completedAt.toISOString(),
    });
  }

  return {
    weekStart: input.currentWeek.window.weekStart.toISOString(),
    weeks: input.summaries.map(toWeekDto),
    summary: {
      currentWeek: toWeekDto(input.currentWeek),
      previousWeek: toWeekDto(input.previousWeek),
      workoutDelta: input.comparison.workoutDelta,
      setDelta: input.comparison.setDelta,
      currentPersonalBestsSetThisWeek: input.bests.filter((best) =>
        isEstablishedInWindow(best.position.completedAt, input.currentWeek.window),
      ).length,
    },
    recentPersonalBests,
  };
}