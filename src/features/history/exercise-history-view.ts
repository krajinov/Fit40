/**
 * Server-side view assembly for the per-exercise history screen.
 *
 * `toExerciseHistoryView` is the pure DTO → view-model mapping; labels are
 * formatted here so components stay presentational. `buildExerciseHistoryView`
 * runs the read use case through the feature composition root.
 *
 * Historical-truth rendering rules (locked, same family as the completed
 * session screen):
 * - Set lines render the persisted snapshot ("50 kg × 10"); a logged 0 kg
 *   is a real load ("0 kg × 10"); no external load renders "10 reps" —
 *   never conflated. RPE appears only on sets that captured one.
 * - Occurrences keep their (sessionId, exerciseOrder) identity — an
 *   exercise performed twice in one session renders as two entries.
 * - The trend is chronological (oldest → newest) and only over externally
 *   loaded occurrences; each point renders as an accessible text value,
 *   with the line chart drawn above it as pure SVG decoration.
 * - The chart renders only when at least two points exist; fewer points
 *   get an honest explanation instead of a fabricated slope.
 * - Trend points key on occurrence identity (sessionId, exerciseOrder) —
 *   never completedAt — because one exercise can occur multiple times in
 *   one completed session.
 * - No PRs, e1RM, or recommendations are invented here.
 */

import type {
  ExerciseHistoryDto,
  ExerciseHistoryEntryDto,
  ExerciseHistoryTrendPointDto,
} from '@/application/dto/exercise-history';
import { EXERCISE_HISTORY_OCCURRENCE_LIMIT } from '@/application/dto/exercise-history';
import { err, ok, type Result } from '@/domain/types/result';
import { EQUIPMENT_LABELS } from '@/features/exercises/exercise-labels';
import { formatHistoryDate, formatSessionSetLine } from '@/features/history/history-labels';
import { getExerciseHistoryUseCase } from '@/features/history/services';
import { formatPrescription } from '@/features/programs/program-labels';
import { formatKg } from '@/features/sessions/workout-target-views';

/** Minimum externally loaded points before a line chart is drawn. */
const MIN_TREND_POINTS_FOR_CHART = 2;

export interface ExerciseHistoryEntryView {
  /** (sessionId, exerciseOrder) — unique occurrence identity for keys. */
  readonly key: string;
  readonly sessionHref: string;
  readonly completedAtLabel: string;
  readonly programName: string;
  readonly workoutName: string;
  readonly prescriptionLabel: string;
  readonly setLines: ReadonlyArray<string>;
  /** "Working load 50 kg" or null when no truthful single load exists. */
  readonly workingLoadLabel: string | null;
}

export interface ExerciseHistoryTrendPointView {
  /** (sessionId, exerciseOrder) — unique occurrence identity for keys. */
  readonly key: string;
  readonly completedAtLabel: string;
  readonly loadLabel: string;
}

export interface ExerciseHistoryTrendView {
  /** Chart geometry points (oldest → newest), or null below the minimum. */
  readonly chartPoints: ReadonlyArray<ExerciseHistoryChartPointView> | null;
  /** Chronological accessible text points (oldest → newest). */
  readonly textPoints: ReadonlyArray<ExerciseHistoryTrendPointView>;
  /** True when entries exist but none carried an external load. */
  readonly noExternalLoad: boolean;
}

export interface ExerciseHistoryChartPointView {
  /** (sessionId, exerciseOrder) — unique occurrence identity for keys. */
  readonly key: string;
  /**
   * SVG coordinate in viewBox units (the chart's 100×100 space). Values
   * stay inside the 12–88 padding band so dots never clip the edges.
   */
  readonly x: number;
  /** SVG y in viewBox units — smaller is higher load (y axis grows down). */
  readonly y: number;
  readonly loadLabel: string;
}

export interface ExerciseHistoryView {
  readonly heading: string;
  readonly equipmentLabel: string;
  readonly occurrenceCountLabel: string;
  readonly entries: ReadonlyArray<ExerciseHistoryEntryView>;
  readonly trend: ExerciseHistoryTrendView | null;
}

export interface ExerciseHistoryViewError {
  readonly code: 'INVALID_INPUT' | 'EXERCISE_NOT_FOUND';
  readonly message: string;
}

/**
 * Chart geometry for the trend line: points are emitted directly in the
 * chart's 100×100 viewBox units with a 12-unit padding band on every side,
 * so dots never clip the plot edges. With a single point the line is
 * centered; an all-flat load history renders a horizontal line — truthful,
 * never fabricated curvature.
 */
function toChartPoints(
  trend: ReadonlyArray<ExerciseHistoryTrendPointDto>,
): ReadonlyArray<ExerciseHistoryChartPointView> {
  const pad = 12;
  const plotSize = 100 - pad * 2;
  const loads = trend.map((point) => point.workingLoadKg);
  const minLoad = Math.min(...loads);
  const maxLoad = Math.max(...loads);
  const loadSpan = maxLoad - minLoad;

  return trend.map((point, index) => ({
    key: `${point.sessionId}#${point.exerciseOrder}`,
    x: pad + (trend.length === 1 ? plotSize / 2 : (plotSize * index) / (trend.length - 1)),
    // The viewBox y axis grows downward, so the heaviest load maps to the
    // smallest y (top of the plot) and the lightest to the largest y. All
    // values are viewBox units — the component renders them unchanged.
    y: loadSpan === 0 ? pad + plotSize / 2 : pad + (1 - (point.workingLoadKg - minLoad) / loadSpan) * plotSize,
    loadLabel: formatKg(point.workingLoadKg),
  }));
}

function toEntryView(entry: ExerciseHistoryEntryDto): ExerciseHistoryEntryView {
  return {
    key: `${entry.sessionId}#${entry.exerciseOrder}`,
    sessionHref: `/history/sessions/${entry.sessionId}`,
    completedAtLabel: formatHistoryDate(entry.completedAt),
    programName: entry.programName,
    workoutName: entry.workoutName,
    prescriptionLabel: formatPrescription(entry.prescription),
    setLines: entry.sets.map((set) => formatSessionSetLine(set)),
    workingLoadLabel:
      entry.workingLoadKg === null ? null : `Working load ${formatKg(entry.workingLoadKg)}`,
  };
}

/**
 * Pure DTO → view-model mapping. Entry order is preserved exactly as the
 * application layer delivered it (newest first); the trend stays
 * chronological (oldest first). Nothing is sorted, trimmed, collapsed, or
 * fabricated here.
 */
export function toExerciseHistoryView(dto: ExerciseHistoryDto): ExerciseHistoryView {
  const entries = dto.entries.map(toEntryView);

  let trend: ExerciseHistoryTrendView | null = null;
  if (dto.entries.length > 0) {
    trend = {
      chartPoints:
        dto.trend.length >= MIN_TREND_POINTS_FOR_CHART ? toChartPoints(dto.trend) : null,
      textPoints: dto.trend.map((point) => ({
        key: `${point.sessionId}#${point.exerciseOrder}`,
        completedAtLabel: formatHistoryDate(point.completedAt),
        loadLabel: formatKg(point.workingLoadKg),
      })),
      noExternalLoad: dto.trend.length === 0,
    };
  }

  return {
    heading: dto.exercise.name,
    equipmentLabel: EQUIPMENT_LABELS[dto.exercise.equipment],
    // The read is bounded to the latest EXERCISE_HISTORY_OCCURRENCE_LIMIT
    // occurrences by design (no pagination on this screen): when the cap is
    // reached, the label says so instead of implying an all-time total.
    occurrenceCountLabel: dto.isLimited
      ? `Latest ${EXERCISE_HISTORY_OCCURRENCE_LIMIT} occurrences`
      : `${dto.entries.length} ${dto.entries.length === 1 ? 'occurrence' : 'occurrences'}`,
    entries,
    trend,
  };
}

/**
 * Builds the per-exercise history view for one authenticated user.
 * EXERCISE_NOT_FOUND addresses an unknown slug — the route renders 404. A
 * known exercise with no history is NOT an error: the view carries empty
 * entries and the screen renders its empty state.
 */
export async function buildExerciseHistoryView(
  userId: string,
  slug: string,
): Promise<Result<ExerciseHistoryView, ExerciseHistoryViewError>> {
  const result = await getExerciseHistoryUseCase.execute({ userId, slug });
  if (!result.ok) {
    return err({ code: result.error.code, message: result.error.message });
  }
  return ok(toExerciseHistoryView(result.data));
}

