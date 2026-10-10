/**
 * Pure-SVG working-load trend for the per-exercise history screen.
 *
 * Locked design decisions:
 * - No chart library: the line is a plain `<polyline>` over a 100×100
 *   viewBox scaled to a ~390px responsive width and ~150px height; every
 *   point is a real HTML list item below the chart (accessible text), the
 *   SVG itself is `aria-hidden` decoration over that text.
 * - The chart renders only with ≥2 points (fewer get an honest note, never
 *   a fabricated slope); all-flat loads render a horizontal line.
 * - Only externally loaded occurrences reach this component; bodyweight,
 *   timed, and 0-point histories are filtered out upstream.
 * - Chart dots and accessible text entries key on occurrence identity
 *   (sessionId, exerciseOrder) — never completedAt — because one exercise
 *   can occur multiple times in one completed session.
 * - Personal-record marks (M18 Slice 7) are stated in the TEXT list ("Personal
 *   best: 32.5 kg") and only emphasized in the chart by a slightly larger dot:
 *   the fact reaches this component precomputed, the SVG stays decoration, and
 *   the mark never claims the plotted working load equals the record (memo
 *   §8.6). A one-line legend explains the mark only when one is actually shown
 *   — the screen never explains a marker it does not render (the M12 rule).
 */

import type { ExerciseHistoryTrendView } from '@/features/history/exercise-history-view';

interface ExerciseHistoryTrendProps {
  readonly trend: ExerciseHistoryTrendView;
}

/** Dot radius, in the same viewBox units as the view model's coordinates. */
const POINT_RADIUS = 3;
/** Extra viewBox units for a dot that marks a personal record. */
const RECORD_RADIUS_BONUS = 1.5;

export function ExerciseHistoryTrend({ trend }: ExerciseHistoryTrendProps) {
  const chartPoints = trend.chartPoints;
  const hasRecordMark = trend.textPoints.some((point) => point.markerLabel !== null);

  return (
    <div>
      {chartPoints !== null && (
        <svg
          aria-hidden="true"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          className="h-38 w-full max-w-md rounded-card border border-border bg-surface-2"
          role="presentation"
        >
          {/* The view model's x/y ARE viewBox units (12–88 padding band);
              they render unchanged — no further scaling here. */}
          <polyline
            points={chartPoints.map((point) => `${point.x},${point.y}`).join(' ')}
            fill="none"
            stroke="var(--chart-1)"
            strokeWidth="2"
            vectorEffect="non-scaling-stroke"
          />
          {chartPoints.map((point) => (
            <circle
              key={point.key}
              cx={point.x}
              cy={point.y}
              r={point.isRecord ? POINT_RADIUS + RECORD_RADIUS_BONUS : POINT_RADIUS}
              fill={point.isRecord ? 'var(--accent-strong)' : 'var(--chart-1)'}
              vectorEffect="non-scaling-stroke"
            />
          ))}
        </svg>
      )}

      <ol className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-sm text-ink-2">
        {trend.textPoints.map((point) => (
          <li key={point.key} className="flex items-baseline gap-2">
            <span className="text-ink-3">{point.completedAtLabel}</span>
            <span className="font-medium text-foreground">{point.loadLabel}</span>
            {point.markerLabel !== null && (
              <span className="text-xs font-semibold text-accent-strong">
                {point.markerLabel}
              </span>
            )}
          </li>
        ))}
      </ol>

      {hasRecordMark && (
        <p className="mt-3 text-xs text-ink-3">
          A personal best mark means that workout contains a set that established a new
          heaviest-load record for this exercise at the time — not necessarily the load
          plotted for that workout.
        </p>
      )}

      {trend.noExternalLoad && (
        <p className="text-sm text-ink-2">
          No external load was logged for this exercise yet, so there is no
          working-load trend to show.
        </p>
      )}

      {chartPoints === null && !trend.noExternalLoad && (
        <p className="text-sm text-ink-2">
          A load trend appears once this exercise has at least two completed
          occurrences with an external load — they may come from the same
          workout or from different workouts.
        </p>
      )}
    </div>
  );
}
