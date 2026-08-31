import { Equal, Info, Replace, TrendingDown, TrendingUp, type LucideIcon } from 'lucide-react';

import { cn } from '@/lib/utils';

/**
 * Recommendation callout (locked design), purely presentational.
 *
 * Represents one advisory state of the Progressive Overload v1 UI:
 *
 * - increase        accent tint, "RECOMMENDED TODAY", load value
 * - hold            neutral surface-2, "REPEAT", load value
 * - regress         amber tint, "TRY TODAY", load value
 * - first-exposure  neutral surface, "FIRST TIME", default guidance copy
 * - scheme-change   neutral surface, "NEW REP TARGET", scheme value
 *
 * Bodyweight and duration exercises intentionally render NO callout; that is
 * decided by whoever maps data to this component, not here.
 *
 * This component is domain-agnostic: it receives pre-formatted presentation
 * strings and contains zero progression logic. Mapping from application DTOs
 * (e.g. ExerciseTargetDto) to these props belongs in the screen that wires
 * live data.
 */
export type RecommendationKind =
  | 'increase'
  | 'hold'
  | 'regress'
  | 'first-exposure'
  | 'scheme-change';

export interface RecommendationCalloutProps {
  readonly kind: RecommendationKind;
  /** Primary value line, e.g. "52.5 kg" or "3 × 8". */
  readonly valueLabel?: string;
  /** Supporting line under the value, e.g. "Last time · 50 kg × 10 at 3 × 10". */
  readonly contextLabel?: string;
  /** Eyebrow override; defaults are the locked design copy per kind. */
  readonly eyebrowLabel?: string;
  readonly className?: string;
}

interface KindConfig {
  readonly container: string;
  readonly icon: LucideIcon;
  readonly iconClass: string;
  readonly eyebrow: string;
  readonly eyebrowClass: string;
}

const KIND_CONFIG: Record<RecommendationKind, KindConfig> = {
  increase: {
    container: 'border-accent-tint-border bg-accent-tint',
    icon: TrendingUp,
    iconClass: 'text-primary',
    eyebrow: 'RECOMMENDED TODAY',
    eyebrowClass: 'text-accent-strong',
  },
  hold: {
    container: 'border-border-strong bg-surface-2',
    icon: Equal,
    iconClass: 'text-ink-2',
    eyebrow: 'REPEAT',
    eyebrowClass: 'text-ink-2',
  },
  regress: {
    container: 'border-amber-border bg-amber-tint',
    icon: TrendingDown,
    iconClass: 'text-amber-strong',
    eyebrow: 'TRY TODAY',
    eyebrowClass: 'text-amber-strong',
  },
  'first-exposure': {
    container: 'border-border-strong bg-card',
    icon: Info,
    iconClass: 'text-ink-3',
    eyebrow: 'FIRST TIME',
    eyebrowClass: 'text-ink-3',
  },
  'scheme-change': {
    container: 'border-border-strong bg-card',
    icon: Replace,
    iconClass: 'text-ink-2',
    eyebrow: 'NEW REP TARGET',
    eyebrowClass: 'text-ink-2',
  },
};

export function RecommendationCallout({
  kind,
  valueLabel,
  contextLabel,
  eyebrowLabel,
  className,
}: RecommendationCalloutProps) {
  const config = KIND_CONFIG[kind];
  const Icon = config.icon;

  const resolvedValue = kind === 'first-exposure' ? (valueLabel ?? 'No recommendation yet') : valueLabel;
  const resolvedContext =
    kind === 'first-exposure'
      ? (contextLabel ?? 'Log your first set — it guides you next time.')
      : contextLabel;

  return (
    <div
      className={cn(
        'flex items-center gap-3.5 rounded-callout border py-3.5 px-[18px]',
        config.container,
        className,
      )}
    >
      <Icon aria-hidden="true" className={cn('size-[22px] shrink-0', config.iconClass)} />
      <div className="space-y-0.5">
        <p className={cn('text-xs font-semibold tracking-[0.8px]', config.eyebrowClass)}>
          {eyebrowLabel ?? config.eyebrow}
        </p>
        {resolvedValue !== undefined &&
          (kind === 'first-exposure' ? (
            <p className="text-[15px] font-semibold text-ink-2">{resolvedValue}</p>
          ) : (
            <p
              className={cn(
                'font-display font-semibold text-foreground',
                kind === 'scheme-change' ? 'text-xl' : 'text-[21px]',
              )}
            >
              {resolvedValue}
            </p>
          ))}
        {resolvedContext !== undefined && <p className="text-xs text-ink-3">{resolvedContext}</p>}
      </div>
    </div>
  );
}
