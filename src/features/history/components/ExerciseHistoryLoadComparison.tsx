import { cn } from '@/lib/utils';
import type { ExerciseHistoryComparisonView } from '@/features/history/exercise-history-view';

export interface ExerciseHistoryLoadComparisonProps {
  readonly comparison: ExerciseHistoryComparisonView;
}

/**
 * The period's first-vs-latest working-load sentence (M18 Slice 8, memo §7).
 *
 * Composition only: the sentence — the two loads with their dates and the
 * direction word, or the honest insufficiency note — arrives fully resolved
 * from the view model. Nothing is computed, formatted or compared here, and no
 * percentage, estimated maximum, coaching or quality claim can appear because
 * none exists in the data this component may render.
 *
 * It sits beneath the trend because it answers a different question: the trend
 * plots every loaded occurrence ever recorded (oldest → newest), while this
 * sentence states only the last 13 weeks — the same screen, two stated periods.
 */
export function ExerciseHistoryLoadComparison({
  comparison,
}: ExerciseHistoryLoadComparisonProps) {
  return (
    <p className={cn('mt-4 text-sm', comparison.isNote ? 'text-ink-2' : 'text-foreground')}>
      {comparison.text}
    </p>
  );
}
