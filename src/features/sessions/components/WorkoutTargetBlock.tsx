import { cn } from '@/lib/utils';
import { Badge } from '@/components/shared/Badge';
import type { WorkoutTargetBlockView } from '@/features/sessions/workout-target-views';

interface WorkoutTargetBlockProps {
  readonly block: WorkoutTargetBlockView;
  /** Compact rendering for dense/mobile contexts (smaller type scale). */
  readonly compact?: boolean;
  readonly className?: string;
}

/**
 * Block styling per M8 design state: accent (positive guidance), neutral
 * surface-2 (hold), supportive amber (regress), neutral card (scheme).
 * Every state also names its direction in words — never color alone.
 */
const BLOCK_STYLES: Record<
  WorkoutTargetBlockView['kind'],
  { readonly container: string; readonly eyebrow: string; readonly delta: string }
> = {
  increase: {
    container: 'border border-accent-tint-border bg-accent-tint',
    eyebrow: 'text-accent-strong',
    delta: 'text-accent-strong',
  },
  hold: {
    container: 'border border-border-strong bg-surface-2',
    eyebrow: 'text-ink-2',
    delta: 'text-ink-2',
  },
  regress: {
    container: 'border border-amber-border bg-amber-tint',
    eyebrow: 'text-amber-strong',
    delta: 'text-amber-strong',
  },
  'scheme-change': {
    container: 'border border-border-strong bg-card',
    eyebrow: 'text-ink-2',
    delta: 'text-ink-2',
  },
  'bodyweight-goal-reached': {
    container: 'border border-accent-tint-border bg-accent-tint',
    eyebrow: 'text-accent-strong',
    delta: 'text-accent-strong',
  },
  'bodyweight-hold': {
    container: 'border border-accent-tint-border bg-accent-tint',
    eyebrow: 'text-accent-strong',
    delta: 'text-ink-2',
  },
  'duration-increase': {
    container: 'border border-accent-tint-border bg-accent-tint',
    eyebrow: 'text-accent-strong',
    delta: 'text-accent-strong',
  },
  'duration-hold': {
    container: 'border border-border-strong bg-surface-2',
    eyebrow: 'text-ink-2',
    delta: 'text-ink-2',
  },
};

/**
 * M8 target block (approved design): eyebrow, Sora value, direction delta
 * and the deterministic reason sentence in one rounded-control panel.
 *
 * The visual fragments are hidden from the accessibility tree and the
 * block announces its full `ariaLabel` (eyebrow · value · delta · reason)
 * exactly once, so meaning never depends on color.
 */
export function WorkoutTargetBlock({ block, compact = false, className }: WorkoutTargetBlockProps) {
  const style = BLOCK_STYLES[block.kind];

  return (
    <div
      role="img"
      aria-label={block.ariaLabel}
      className={cn(
        'flex flex-col gap-0.5 rounded-control px-3.5 py-2.5',
        style.container,
        compact && 'gap-0 px-3 py-2',
        className,
      )}
    >
      <p
        className={cn(
          'text-xs font-semibold tracking-[0.8px]',
          style.eyebrow,
          compact && 'text-[10px] tracking-[0.6px]',
        )}
      >
        {block.eyebrowLabel}
      </p>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
        <p
          className={cn(
            'font-display text-[17px] font-semibold text-ink',
            compact && 'text-[15px]',
          )}
        >
          {block.valueLabel}
        </p>
        {block.showGoalBadge && (
          <Badge variant="done" className="h-6 px-2.5 text-xs">
            Goal reached
          </Badge>
        )}
      </div>
      {block.deltaLabel !== null && (
        <p
          className={cn(
            'text-xs font-semibold',
            style.delta,
            compact && 'text-[11px]',
          )}
        >
          {block.deltaLabel}
        </p>
      )}
      <p className={cn('text-xs text-ink-2', compact && 'text-[11px]')}>
        {block.reasonLabel}
      </p>
    </div>
  );
}
