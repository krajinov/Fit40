import { ProgressBar } from '@/components/shared/ProgressBar';
import type { SessionProgressView } from '@/features/sessions/active-workout-views';

interface SessionProgressCardProps {
  readonly progress: SessionProgressView;
}

/**
 * Session progress band (locked design): "N of M sets logged" with the
 * reps · volume metrics line on the right, above the accent progress track.
 * Purely presentational — the view mapper computed every label.
 */
export function SessionProgressCard({ progress }: SessionProgressCardProps) {
  return (
    <section
      aria-label="Session progress"
      className="rounded-card border border-border bg-card px-4 py-5 md:px-7 md:py-5"
    >
      <div className="flex items-center gap-4">
        <p className="text-[13px] font-semibold text-foreground md:text-[15px]">
          {progress.loggedSets} of {progress.prescribedSets} sets logged
        </p>
        <p className="min-w-0 flex-1 truncate text-right text-xs text-ink-3 md:text-sm">
          {progress.repsLabel} · {progress.volumeLabel} volume
        </p>
      </div>
      <ProgressBar
        value={progress.percentage}
        label="Session progress"
        className="mt-4"
      />
    </section>
  );
}
