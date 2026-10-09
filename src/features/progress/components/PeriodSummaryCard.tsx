import { SectionCard } from '@/components/shared/SectionCard';
import { Stat } from '@/components/shared/Stat';
import type { ProgressSummaryView } from '@/features/progress/progress-view';

export interface PeriodSummaryCardProps {
  readonly summary: ProgressSummaryView;
  /**
   * The period's personal-best fragment, e.g. "12 personal bests" (M18 Slice 6),
   * or null when that read is unavailable. An unavailable read states no count
   * at all rather than a fabricated zero, so the genuine "0 personal bests" of a
   * loaded read stays distinguishable from "we could not read it". The "·"
   * separator is the house convention for a fact fragment and is owned here.
   */
  readonly personalBestsNote: string | null;
}

/**
 * The factual period summary (§4.4): totals (including the current partial
 * week) plus the §4.5 average with its basis stated in words and the exact
 * denominator the Domain used. An absent external-load total renders "—" with
 * no number, and a missing average renders the missing-data copy — never a
 * fabricated zero. No verdict, percentage or score appears here.
 */
export function PeriodSummaryCard({ summary, personalBestsNote }: PeriodSummaryCardProps) {
  return (
    <SectionCard title={summary.title}>
      <div className="flex flex-wrap gap-x-10 gap-y-6">
        {summary.stats.map((stat) => (
          <Stat key={stat.label} value={stat.value} label={stat.label} />
        ))}
      </div>

      <p className="mt-6 text-sm text-foreground">{summary.averageLabel}</p>
      {summary.averageCaption !== null && (
        <p className="mt-1 text-xs text-ink-2">{summary.averageCaption}</p>
      )}
      {personalBestsNote !== null && (
        <p className="mt-2 text-xs text-ink-2">· {personalBestsNote}</p>
      )}
    </SectionCard>
  );
}
