import { SectionCard } from '@/components/shared/SectionCard';
import { Stat } from '@/components/shared/Stat';
import type { HistoryTotalsView } from '@/features/history/history-view';

interface HistoryTotalsCardProps {
  readonly totals: HistoryTotalsView;
}

/**
 * Lifetime training totals for the history screen. Rendered in every state —
 * including the zero state — so the numbers always reflect reality.
 */
export function HistoryTotalsCard({ totals }: HistoryTotalsCardProps) {
  return (
    <SectionCard title="Training totals">
      <div className="flex gap-10">
        <Stat value={totals.completedWorkouts} label="Completed workouts" />
        <Stat value={totals.loggedSets} label="Sets logged" />
      </div>
    </SectionCard>
  );
}
