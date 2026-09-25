import Link from 'next/link';

import { EmptyState } from '@/components/shared/EmptyState';
import {
  PERSONAL_BESTS_EMPTY_MESSAGE,
  PERSONAL_BESTS_TITLE,
  RECENT_PERSONAL_BESTS_UNAVAILABLE_MESSAGE,
} from '@/features/dashboard/weekly-insights-view';
import type { WeeklyInsightsView } from '@/features/dashboard/weekly-insights-view';

export interface RecentPersonalBestsCardProps {
  readonly state:
    | { readonly status: 'loaded'; readonly data: WeeklyInsightsView }
    | { readonly status: 'unavailable' };
}

/**
 * Recently established, still-standing current personal bests (max five rows,
 * from Application data). Each row is a single block link to the owning
 * completed session — one large touch target, no nested interactive
 * elements. A failed read renders its own truthful state; an empty loaded
 * list renders honest empty copy, never fake rows.
 */
export function RecentPersonalBestsCard({ state }: RecentPersonalBestsCardProps) {
  if (state.status === 'unavailable') {
    return (
      <section
        aria-labelledby="recent-personal-bests-heading"
        className="rounded-card border border-border bg-card p-6 md:p-8"
      >
        <h2
          id="recent-personal-bests-heading"
          className="font-display text-lg font-semibold text-foreground md:text-xl"
        >
          {PERSONAL_BESTS_TITLE}
        </h2>
        <p className="mt-2 text-sm text-ink-2">{RECENT_PERSONAL_BESTS_UNAVAILABLE_MESSAGE}</p>
      </section>
    );
  }

  const { data } = state;
  return (
    <section
      aria-labelledby="recent-personal-bests-heading"
      className="rounded-card border border-border bg-card p-6 md:p-8"
    >
      <h2
        id="recent-personal-bests-heading"
        className="font-display text-lg font-semibold text-foreground md:text-xl"
      >
        {PERSONAL_BESTS_TITLE}
      </h2>
      <p className="mt-1 text-xs text-ink-2">{data.personalBestsCaption}</p>

      {data.personalBests.length === 0 ? (
        <div className="mt-4">
          <EmptyState title="No personal bests yet" body={PERSONAL_BESTS_EMPTY_MESSAGE} />
        </div>
      ) : (
        <ul className="mt-3 divide-y divide-border">
          {data.personalBests.map((best) => (
            <li key={`${best.sessionId}-${best.exerciseSlug}`}>
              <Link
                href={`/history/sessions/${best.sessionId}`}
                className="flex min-h-[44px] items-center justify-between gap-3 py-3 transition-colors hover:bg-accent-tint/40 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-foreground">
                    {best.exerciseName}
                  </span>
                  <span className="block text-xs text-ink-2">{best.valueLabel}</span>
                </span>
                <span className="shrink-0 text-xs text-ink-2">{best.completedAtLabel}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
