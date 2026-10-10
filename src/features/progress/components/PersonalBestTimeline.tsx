import Link from 'next/link';

import { EmptyState } from '@/components/shared/EmptyState';
import { SectionCard } from '@/components/shared/SectionCard';
import { cn } from '@/lib/utils';
import {
  PERSONAL_BESTS_TIMELINE_TITLE,
  UNAVAILABLE_PERSONAL_BESTS_MESSAGE,
} from '@/features/progress/progress-labels';
import type { ProgressRecordTimelineState } from '@/features/progress/personal-best-timeline-view';

export interface PersonalBestTimelineProps {
  readonly state: ProgressRecordTimelineState;
}

/**
 * The period's historical personal-best events (M18 Slice 6, memo §8.4–§8.5).
 *
 * Composition only: the exact count, the rows, their order and every label
 * arrive authoritative from the view model, and this component re-derives
 * nothing — it never counts rows, never sorts, never compares values and never
 * decides ownership. The headline states the EXACT period count while the list
 * holds at most the capped number of rows, and the cap note says so truthfully
 * instead of implying the unlisted events do not exist.
 *
 * Each row is one block link to the completed session that holds the event's
 * logged set (the history screen's session link). The row's context is
 * deliberately historical: "First time"/previous value plus "Still your best"
 * or "Since surpassed" — never a claim that every event is a current best
 * (the dashboard's M13 "Personal bests" card owns current bests). An empty
 * period, a read that produced no renderable row and a failed read each get
 * their own truthful state, and none of them fabricates a count or a row.
 */
export function PersonalBestTimeline({ state }: PersonalBestTimelineProps) {
  if (state.status === 'unavailable') {
    return (
      <SectionCard title={PERSONAL_BESTS_TIMELINE_TITLE}>
        <p className="text-sm text-ink-2">{UNAVAILABLE_PERSONAL_BESTS_MESSAGE}</p>
      </SectionCard>
    );
  }

  const { data } = state;

  return (
    <SectionCard title={data.title}>
      <p className="text-sm text-ink-2">{data.caption}</p>
      <p className="mt-1 text-xs text-ink-2">{data.countCaption}</p>

      {data.emptyState !== null ? (
        <div className="mt-4">
          <EmptyState title={data.emptyState.title} body={data.emptyState.body} />
        </div>
      ) : (
        <>
          {data.events.length === 0 ? (
            <p className="mt-4 text-sm text-ink-2">{data.unresolvedNote}</p>
          ) : (
            <ul className="mt-4 divide-y divide-border">
              {data.events.map((event) => (
                <li key={event.key}>
                  <Link
                    href={event.sessionHref}
                    className="flex min-h-[44px] items-center justify-between gap-3 py-3 transition-colors hover:bg-accent-tint/40 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-foreground">
                        {event.exerciseName}
                      </span>
                      <span className="block text-xs text-ink-2">{event.metricLabel}</span>
                      <span className="block text-xs text-ink-3">
                        {event.previousBestLabel}
                      </span>
                    </span>
                    <span className="shrink-0 text-right">
                      <span className="block font-display text-sm font-semibold text-foreground">
                        {event.valueLabel}
                      </span>
                      <span className="block text-xs text-ink-2">{event.completedAtLabel}</span>
                      <span
                        className={cn(
                          'block text-xs font-semibold',
                          event.stillStanding ? 'text-accent-strong' : 'text-ink-2',
                        )}
                      >
                        {event.standingLabel}
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}

          {data.capNote !== null && <p className="mt-3 text-xs text-ink-2">{data.capNote}</p>}
        </>
      )}
    </SectionCard>
  );
}
