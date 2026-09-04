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
 */

import type { ExerciseHistoryTrendView } from '@/features/history/exercise-history-view';

interface ExerciseHistoryTrendProps {
  readonly trend: ExerciseHistoryTrendView;
}

/** Dot radius, in the same viewBox units as the view model's coordinates. */
const POINT_RADIUS = 3;

export function ExerciseHistoryTrend({ trend }: ExerciseHistoryTrendProps) {
  const chartPoints = trend.chartPoints;

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
              key={`${point.x}-${point.y}`}
              cx={point.x}
              cy={point.y}
              r={POINT_RADIUS}
              fill="var(--chart-1)"
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
          </li>
        ))}
      </ol>

      {trend.noExternalLoad && (
        <p className="text-sm text-ink-2">
          No external load was logged for this exercise yet, so there is no
          working-load trend to show.
        </p>
      )}

      {chartPoints === null && !trend.noExternalLoad && (
        <p className="text-sm text-ink-2">
          A load trend appears once this exercise has been performed with an
          external load in at least two completed workouts.
        </p>
      )}
    </div>
  );
}
