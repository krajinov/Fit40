import { cn } from '@/lib/utils';

/**
 * Progress indicator (locked design): surface-2 pill track with an accent
 * fill. Default track height 10px; `thin` renders the 8px variant used by
 * per-exercise indicators.
 *
 * Purely presentational: callers pass an already-computed percentage.
 */
export interface ProgressBarProps {
  /** Completed portion as a percentage, 0-100. */
  readonly value: number;
  /** Accessible name, e.g. "Session progress". */
  readonly label: string;
  readonly thin?: boolean;
  readonly className?: string;
}

export function ProgressBar({ value, label, thin = false, className }: ProgressBarProps) {
  const clamped = Math.min(100, Math.max(0, value));

  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuenow={Math.round(clamped)}
      aria-valuemin={0}
      aria-valuemax={100}
      className={cn(
        'w-full overflow-hidden rounded-pill bg-surface-2',
        thin ? 'h-2' : 'h-2.5',
        className,
      )}
    >
      <div
        className="h-full rounded-pill bg-primary transition-[width]"
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}
