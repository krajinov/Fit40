import { SectionCard } from '@/components/shared/SectionCard';
import { cn } from '@/lib/utils';
import { THIS_WEEK_LABEL } from '@/features/progress/progress-labels';
import type { ProgressChartView } from '@/features/progress/progress-view';

export interface ProgressWeekChartProps {
  readonly chart: ProgressChartView;
}

/**
 * One 13-week chart (locked design conventions, no chart library): text-first —
 * every week renders its label and value in a list, and the bars above are
 * `aria-hidden` decoration. Zero-activity weeks keep a visible floor so a gap
 * reads as "no training", never as missing data; a week with no eligible
 * external-load data renders a muted floor and the words "No loaded sets"
 * instead of a fabricated `0`. The current week is marked by the word
 * "This week" and `aria-current="date"`, never by colour alone.
 */
export function ProgressWeekChart({ chart }: ProgressWeekChartProps) {
  return (
    <SectionCard title={chart.title}>
      <p className="text-sm text-ink-2">{chart.caption}</p>

      <div aria-hidden="true" className="mt-4 flex h-24 items-end gap-1.5">
        {chart.points.map((point) => (
          <div key={point.key} className="flex-1">
            <div
              className={cn(
                'w-full rounded-t-[3px]',
                point.isAbsent
                  ? 'bg-border-strong'
                  : point.isCurrentWeek
                    ? 'bg-accent-strong'
                    : 'bg-accent-tint',
              )}
              style={{ height: `${point.barHeightPx}px` }}
            />
          </div>
        ))}
      </div>

      <ol
        aria-label={chart.ariaLabel}
        className="mt-4 grid gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2 lg:grid-cols-3"
      >
        {chart.points.map((point) => (
          <li
            key={point.key}
            aria-current={point.isCurrentWeek ? 'date' : undefined}
            className="flex items-baseline justify-between gap-2"
          >
            <span className="text-ink-3">{point.rangeLabel}</span>
            <span
              className={cn(
                'text-right font-medium',
                point.isAbsent ? 'text-ink-3' : 'text-foreground',
              )}
            >
              {point.valueLabel}
              {point.isCurrentWeek && (
                <span className="ml-1.5 text-xs font-semibold text-accent-strong">
                  {THIS_WEEK_LABEL}
                </span>
              )}
            </span>
          </li>
        ))}
      </ol>

      {chart.note !== null && <p className="mt-3 text-sm text-ink-2">{chart.note}</p>}
    </SectionCard>
  );
}
