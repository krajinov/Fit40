import { Stat } from '@/components/shared/Stat';
import { WeeklyActivityStrip } from '@/features/dashboard/components/WeeklyActivityStrip';
import {
  STILL_STANDING_PB_CAPTION,
  WEEKLY_INSIGHTS_TITLE,
  WEEKLY_INSIGHTS_UNAVAILABLE_MESSAGE,
} from '@/features/dashboard/weekly-insights-view';
import type { WeeklyInsightsView } from '@/features/dashboard/weekly-insights-view';

export interface WeeklyInsightsCardProps {
  readonly state:
    | { readonly status: 'loaded'; readonly data: WeeklyInsightsView }
    | { readonly status: 'unavailable' };
}

/**
 * Calendar-week training summary: completed workouts, logged sets, still-
 * standing current PBs set this week, factual previous-week comparison, and
 * the eight-week activity strip. A failed read renders its own truthful
 * state — never zeros, which would claim an authoritative zero week.
 */
export function WeeklyInsightsCard({ state }: WeeklyInsightsCardProps) {
  if (state.status === 'unavailable') {
    return (
      <section
        aria-labelledby="weekly-insights-heading"
        className="rounded-card border border-border bg-card p-6 md:p-8"
      >
        <h2
          id="weekly-insights-heading"
          className="font-display text-lg font-semibold text-foreground md:text-xl"
        >
          {WEEKLY_INSIGHTS_TITLE}
        </h2>
        <p className="mt-2 text-sm text-ink-2">{WEEKLY_INSIGHTS_UNAVAILABLE_MESSAGE}</p>
      </section>
    );
  }

  const { data } = state;
  return (
    <section
      aria-labelledby="weekly-insights-heading"
      className="rounded-card border border-border bg-card p-6 md:p-8"
    >
      <div className="flex items-baseline justify-between gap-3">
        <h2
          id="weekly-insights-heading"
          className="font-display text-lg font-semibold text-foreground md:text-xl"
        >
          {WEEKLY_INSIGHTS_TITLE}
        </h2>
        <span className="text-xs text-ink-2">{data.weekLabel}</span>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-3">
        {data.stats.map((stat) => (
          <Stat key={stat.label} value={stat.value} label={stat.label} />
        ))}
      </div>

      <p className="mt-2 text-xs text-ink-2">{STILL_STANDING_PB_CAPTION}</p>

      <p className="mt-3 text-sm text-foreground">{data.comparisonLabel}</p>

      <div className="mt-4">
        <WeeklyActivityStrip weeks={data.activityWeeks} />
        <p className="mt-2 text-xs text-ink-2">{data.activityCaption}</p>
      </div>
    </section>
  );
}
