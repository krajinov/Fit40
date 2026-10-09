import { SectionCard } from '@/components/shared/SectionCard';
import { Stat } from '@/components/shared/Stat';
import type { ProgressSummaryView } from '@/features/progress/progress-view';

export interface PeriodSummaryCardProps {
  readonly summary: ProgressSummaryView;
}

/**
 * The factual period summary (§4.4): totals (including the current partial
 * week) plus the §4.5 average with its basis stated in words and the exact
 * denominator the Domain used. An absent external-load total renders "—" with
 * no number, and a missing average renders the missing-data copy — never a
 * fabricated zero. No verdict, percentage or score appears here.
 */
export function PeriodSummaryCard({ summary }: PeriodSummaryCardProps) {
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
    </SectionCard>
  );
}
