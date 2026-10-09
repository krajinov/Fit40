import { SectionCard } from '@/components/shared/SectionCard';
import { PeriodSummaryCard } from '@/features/progress/components/PeriodSummaryCard';
import { ProgressWeekChart } from '@/features/progress/components/ProgressWeekChart';
import {
  EXTERNAL_LOAD_CHART_TITLE,
  SETS_CHART_TITLE,
  SUMMARY_TITLE,
  UNAVAILABLE_ACTIVITY_MESSAGE,
  UNAVAILABLE_LOAD_MESSAGE,
  UNAVAILABLE_SUMMARY_MESSAGE,
  WORKOUTS_CHART_TITLE,
} from '@/features/progress/progress-labels';
import type { ProgressActivityState } from '@/features/progress/progress-view';

export interface ProgressScreenProps {
  readonly state: ProgressActivityState;
}

/** Title + message of one degraded card (the M13 unavailable idiom). */
function UnavailableCard({
  title,
  message,
}: {
  readonly title: string;
  readonly message: string;
}) {
  return (
    <SectionCard title={title}>
      <p className="text-sm text-ink-2">{message}</p>
    </SectionCard>
  );
}

/**
 * The Progress surface (M18 Slice 4): three 13-week charts and the factual
 * period summary.
 *
 * A failed read degrades every card to its own "Couldn't load …" state —
 * never to zero weeks, which would claim the user did not train. An empty
 * horizon renders the 13 truthful zero weeks plus one piece of factual empty
 * copy; the charts are never hidden, because "no training" is a fact worth
 * showing.
 */
export function ProgressScreen({ state }: ProgressScreenProps) {
  if (state.status === 'unavailable') {
    return (
      <div className="flex flex-col gap-6">
        <UnavailableCard title={WORKOUTS_CHART_TITLE} message={UNAVAILABLE_ACTIVITY_MESSAGE} />
        <UnavailableCard title={SETS_CHART_TITLE} message={UNAVAILABLE_ACTIVITY_MESSAGE} />
        <UnavailableCard title={EXTERNAL_LOAD_CHART_TITLE} message={UNAVAILABLE_LOAD_MESSAGE} />
        <UnavailableCard title={SUMMARY_TITLE} message={UNAVAILABLE_SUMMARY_MESSAGE} />
      </div>
    );
  }

  const { emptyNote, workoutsChart, setsChart, externalLoadChart, summary } = state.data;

  return (
    <div className="flex flex-col gap-6">
      {emptyNote !== null && (
        <p className="rounded-card border border-border bg-surface-2 px-5 py-4 text-sm text-ink-2">
          {emptyNote}
        </p>
      )}

      <ProgressWeekChart chart={workoutsChart} />
      <ProgressWeekChart chart={setsChart} />
      <ProgressWeekChart chart={externalLoadChart} />
      <PeriodSummaryCard summary={summary} />
    </div>
  );
}
