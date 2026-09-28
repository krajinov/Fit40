import { SectionCard } from '@/components/shared/SectionCard';
import type { EnrollmentFollowThroughDto } from '@/application/dto/follow-through';
import {
  CURRENT_WEEK_LABEL,
  buildFollowThroughView,
  type FollowThroughWeekRowView,
} from '@/features/schedule/follow-through-view';

interface PlanFollowThroughSectionProps {
  readonly followThrough: EnrollmentFollowThroughDto;
  readonly className?: string;
}

/**
 * M16 plan follow-through section (Slice 4).
 *
 * A Server Component: no client state, no effects, no clock access — every value
 * it renders is already decided on the DTO, and the labels come from the pure
 * view builder. It reconciles nothing itself and judges nothing: the rows restate
 * weekly counts, the current week is marked as the current week, and the section
 * closes with the one approved disclosure about the report describing today's
 * calendar.
 *
 * Two truthful states: a run with no planned rows renders nothing at all —
 * configuring training days belongs to the M15 schedule section, so this one
 * adds no setup copy, no empty card and no zero counts; a configured run renders
 * its weeks and totals. Placement on the page is the caller's decision.
 */
export function PlanFollowThroughSection({
  followThrough,
  className,
}: PlanFollowThroughSectionProps) {
  if (!followThrough.configured) {
    return null;
  }

  const view = buildFollowThroughView(followThrough);

  return (
    <SectionCard title={view.title} className={className}>
      <p className="text-xs text-ink-2">{view.horizonLabel}</p>

      {view.summary.status === 'empty' ? (
        <p className="mt-3 text-sm text-ink-2">{view.summary.message}</p>
      ) : (
        <>
          <p className="mt-3 text-sm text-ink-2">{view.summary.totalsLabel}</p>
          <ul
            aria-label="Plan follow-through by week"
            className="mt-3 divide-y divide-border border-t border-border"
          >
            {view.summary.weeks.map((week) => (
              <FollowThroughRow key={week.weekStart} week={week} />
            ))}
          </ul>
        </>
      )}

      <p className="mt-4 text-[13px] text-ink-3">{view.disclosure}</p>

      {view.unplacedNotPerformedLabel !== null && (
        <p className="mt-2 text-[13px] text-ink-3">{view.unplacedNotPerformedLabel}</p>
      )}
    </SectionCard>
  );
}

/**
 * One week's row: the covered range first, then the DTO's own counts as text.
 * The current week is distinguished by the words "This week" and
 * `aria-current="date"` (the M15 calendar convention) — never by colour alone,
 * and never framed as unfinished.
 */
function FollowThroughRow({ week }: { readonly week: FollowThroughWeekRowView }) {
  return (
    <li
      aria-current={week.isCurrent ? 'date' : undefined}
      className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2.5 first:pt-3 last:pb-0"
    >
      <span className="text-sm font-medium text-foreground">{week.rangeLabel}</span>
      <span className="text-sm text-ink-2">{week.progressLabel}</span>
      {week.startedLabel !== null && (
        <span className="text-[13px] text-ink-3">{week.startedLabel}</span>
      )}
      {week.pastDueLabel !== null && (
        <span className="text-[13px] text-ink-3">{week.pastDueLabel}</span>
      )}
      {week.notPerformedLabel !== null && (
        <span className="text-[13px] text-ink-3">{week.notPerformedLabel}</span>
      )}
      {week.isCurrent && (
        <span className="text-[13px] font-medium text-ink-2">{CURRENT_WEEK_LABEL}</span>
      )}
    </li>
  );
}
