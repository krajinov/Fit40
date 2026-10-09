import { SectionCard } from '@/components/shared/SectionCard';
import { PeriodSummaryCard } from '@/features/progress/components/PeriodSummaryCard';
import { PersonalBestTimeline } from '@/features/progress/components/PersonalBestTimeline';
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
import type { ProgressRecordTimelineState } from '@/features/progress/personal-best-timeline-view';
import type { ProgressActivityState } from '@/features/progress/progress-view';

export interface ProgressScreenProps {
  readonly state: ProgressActivityState;
  /**
   * The personal-best timeline state — an INDEPENDENT read (M18 Slice 6), so
   * each half of the page degrades on its own. Its exact count reaches the
   * summary as a fragment only when the read succeeded.
   */
  readonly personalBests: ProgressRecordTimelineState;
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
 * The Progress surface (M18 Slice 4 + Slice 6): three 13-week charts, the
 * factual period summary, and the period's historical personal-best timeline.
 *
 * Each half degrades on its own: a failed activity read leaves the timeline
 * intact, and a failed personal-best read leaves the charts and totals intact
 * while removing the summary's personal-best fragment — never to zero weeks or
 * to a fabricated count, either of which would claim a fact the app never read.
 * An empty horizon still renders the 13 truthful zero weeks plus one piece of
 * factual empty copy; the charts are never hidden, because "no training" is a
 * fact worth showing.
 */
export function ProgressScreen({ state, personalBests }: ProgressScreenProps) {
  if (state.status === 'unavailable') {
    return (
      <div className="flex flex-col gap-6">
        <UnavailableCard title={WORKOUTS_CHART_TITLE} message={UNAVAILABLE_ACTIVITY_MESSAGE} />
        <UnavailableCard title={SETS_CHART_TITLE} message={UNAVAILABLE_ACTIVITY_MESSAGE} />
        <UnavailableCard title={EXTERNAL_LOAD_CHART_TITLE} message={UNAVAILABLE_LOAD_MESSAGE} />
        <UnavailableCard title={SUMMARY_TITLE} message={UNAVAILABLE_SUMMARY_MESSAGE} />
        <PersonalBestTimeline state={personalBests} />
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
      <PeriodSummaryCard
        summary={summary}
        personalBestsNote={
          personalBests.status === 'loaded' ? personalBests.data.summaryFragment : null
        }
      />
      <PersonalBestTimeline state={personalBests} />
    </div>
  );
}
