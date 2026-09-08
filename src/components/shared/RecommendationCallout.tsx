import { Equal, Info, Replace, Target, Timer, TrendingDown, TrendingUp, type LucideIcon } from 'lucide-react';

import { Badge } from '@/components/shared/Badge';
import { cn } from '@/lib/utils';

/**
 * Recommendation callout — purely presentational, now covering the M8
 * progression states (approved "Fit40 · Design System — M8 Progression v2"
 * frame). One advisory state per kind:
 *
 * - increase                  accent tint, "RECOMMENDED TODAY", value + delta
 * - hold                      neutral surface-2, value + "Keep current load"
 * - regress                   amber tint (supportive, never error styling)
 * - scheme-change             neutral card, scheme value
 * - bodyweight-goal-reached   accent tint, rep target + "Goal reached" badge
 * - bodyweight-hold           accent tint, rep target, rep guidance copy
 * - duration-increase         accent tint, seconds value + delta
 * - duration-hold             neutral surface-2, seconds value
 * - first-exposure            neutral card, default first-time guidance
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
  | 'scheme-change'
  | 'bodyweight-goal-reached'
  | 'bodyweight-hold'
  | 'duration-increase'
  | 'duration-hold'
  | 'first-exposure';

export interface RecommendationCalloutProps {
  readonly kind: RecommendationKind;
  /** Primary value line, e.g. "52.5 kg", "35 sec" or "3 × 8". */
  readonly valueLabel?: string;
  /** Direction line under the value, e.g. "Increase 2.5 kg". */
  readonly deltaLabel?: string;
  /** Supporting line under the value, e.g. "Last time · 50 kg × 10, 10, 10". */
  readonly contextLabel?: string;
  /** Eyebrow override; defaults are the locked design copy per kind. */
  readonly eyebrowLabel?: string;
  /** Compact rendering for narrow/mobile logger columns. */
  readonly compact?: boolean;
  readonly className?: string;
}

interface KindConfig {
  readonly container: string;
  readonly icon: LucideIcon;
  readonly iconClass: string;
  readonly eyebrow: string;
  readonly eyebrowClass: string;
  readonly deltaClass: string;
}

const KIND_CONFIG: Record<RecommendationKind, KindConfig> = {
  increase: {
    container: 'border-accent-tint-border bg-accent-tint',
    icon: TrendingUp,
    iconClass: 'text-primary',
    eyebrow: 'RECOMMENDED TODAY',
    eyebrowClass: 'text-accent-strong',
    deltaClass: 'text-accent-strong',
  },
  hold: {
    container: 'border-border-strong bg-surface-2',
    icon: Equal,
    iconClass: 'text-ink-2',
    eyebrow: 'RECOMMENDED TODAY',
    eyebrowClass: 'text-ink-2',
    deltaClass: 'text-ink-2',
  },
  regress: {
    container: 'border-amber-border bg-amber-tint',
    icon: TrendingDown,
    iconClass: 'text-amber-strong',
    eyebrow: 'RECOMMENDED TODAY',
    eyebrowClass: 'text-amber-strong',
    deltaClass: 'text-amber-strong',
  },
  'scheme-change': {
    container: 'border-border-strong bg-card',
    icon: Replace,
    iconClass: 'text-ink-2',
    eyebrow: 'NEW TARGET SCHEME',
    eyebrowClass: 'text-ink-2',
    deltaClass: 'text-ink-2',
  },
  'bodyweight-goal-reached': {
    container: 'border-accent-tint-border bg-accent-tint',
    icon: Target,
    iconClass: 'text-primary',
    eyebrow: 'TARGET',
    eyebrowClass: 'text-accent-strong',
    deltaClass: 'text-accent-strong',
  },
  'bodyweight-hold': {
    container: 'border-accent-tint-border bg-accent-tint',
    icon: Target,
    iconClass: 'text-primary',
    eyebrow: 'TARGET',
    eyebrowClass: 'text-accent-strong',
    deltaClass: 'text-accent-strong',
  },
  'duration-increase': {
    container: 'border-accent-tint-border bg-accent-tint',
    icon: Timer,
    iconClass: 'text-primary',
    eyebrow: 'RECOMMENDED TODAY',
    eyebrowClass: 'text-accent-strong',
    deltaClass: 'text-accent-strong',
  },
  'duration-hold': {
    container: 'border-border-strong bg-surface-2',
    icon: Timer,
    iconClass: 'text-ink-2',
    eyebrow: 'TARGET',
    eyebrowClass: 'text-ink-2',
    deltaClass: 'text-ink-2',
  },
  'first-exposure': {
    container: 'border-border-strong bg-card',
    icon: Info,
    iconClass: 'text-ink-3',
    eyebrow: 'FIRST TIME',
    eyebrowClass: 'text-ink-3',
    deltaClass: 'text-ink-2',
  },
};

export function RecommendationCallout({
  kind,
  valueLabel,
  deltaLabel,
  contextLabel,
  eyebrowLabel,
  compact = false,
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
        compact && 'items-start gap-3 py-3 pl-3.5 pr-3',
        config.container,
        className,
      )}
    >
      <Icon aria-hidden="true" className={cn('size-[22px] shrink-0', config.iconClass, compact && 'size-5')} />
      <div className="min-w-0 space-y-0.5">
        <p
          className={cn(
            'text-xs font-semibold tracking-[0.8px]',
            config.eyebrowClass,
            compact && 'text-[10px] tracking-[0.6px]',
          )}
        >
          {eyebrowLabel ?? config.eyebrow}
        </p>
        {resolvedValue !== undefined && (
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <p
              className={cn(
                'font-display font-semibold text-foreground',
                kind === 'scheme-change' ? 'text-xl' : 'text-[21px]',
                kind === 'first-exposure' && 'text-[15px] text-ink-2',
                compact && (kind === 'scheme-change' ? 'text-base' : 'text-[17px]'),
                compact && kind === 'first-exposure' && 'text-[13px]',
              )}
            >
              {resolvedValue}
            </p>
            {kind === 'bodyweight-goal-reached' && (
              <Badge variant="done" className="h-6 px-2.5 text-xs">
                Goal reached
              </Badge>
            )}
          </div>
        )}
        {deltaLabel !== undefined && (
          <p className={cn('text-[13px] font-semibold', config.deltaClass, compact && 'text-[11px]')}>
            {deltaLabel}
          </p>
        )}
        {resolvedContext !== undefined && (
          <p className={cn('text-xs text-ink-3', compact && 'text-[11px]')}>{resolvedContext}</p>
        )}
      </div>
    </div>
  );
}
