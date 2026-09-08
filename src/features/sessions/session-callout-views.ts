/**
 * PURE presentation mapping for the Active Workout logger's advisory
 * callout, hint, and quiet line — the M8 "Rec" column's copy.
 *
 * This module formats decisions the domain engine already made; it never
 * calculates progressions or re-derives load decisions. Reason sentences
 * come from `progression-labels.ts`; raw reason codes never reach users.
 *
 * Locked semantics:
 * - CALLOUTS are advisory and always render the recommendation computed
 *   from the latest COMPLETED performance — RPE never affects them (the
 *   history projection carries no RPE).
 * - The hint names the prefill's origin: a recommendation-sourced prefill
 *   says "Advisory prefill — edit freely"; a session value that won says
 *   "your value stands" — never a warning or confirmation.
 * - first-exposure renders a quiet muted line instead of a callout.
 */

import type { RecommendationKind } from '@/components/shared/RecommendationCallout';
import type { ExerciseTargetDto } from '@/application/dto/exercise';
import type { RepPrescription } from '@/domain/value-objects/rep-prescription';
import {
  bodyweightTargetLabel,
  formatKg,
  formatSeconds,
  lastTimeLabel,
  targetDeltaLabel,
} from '@/features/sessions/progression-labels';
import { formatPrescription } from '@/features/programs/program-labels';

export interface SessionCalloutView {
  readonly kind: RecommendationKind;
  readonly valueLabel?: string;
  readonly deltaLabel?: string;
  readonly contextLabel?: string;
}

/**
 * Maps one batched target to the logger's advisory callout (or null when
 * the basis renders none — first exposure renders a quiet line instead).
 */
export function mapSessionCallout(
  target: ExerciseTargetDto | null,
  prescription: RepPrescription,
): SessionCalloutView | null {
  if (target === null) {
    return null;
  }
  const decision = target.target;
  const context = lastTimeLabel(decision, target.previousSets);

  switch (decision.basis) {
    case 'increase':
    case 'hold':
    case 'regress':
      return {
        kind: decision.basis,
        valueLabel:
          decision.nextLoadKg === null ? 'No added load' : formatKg(decision.nextLoadKg),
        deltaLabel: targetDeltaLabel(decision) ?? undefined,
        contextLabel: context ?? undefined,
      };
    case 'scheme-change':
      return {
        kind: 'scheme-change',
        valueLabel: formatPrescription(prescription),
        contextLabel: 'Previous performance was recorded under a different prescription.',
      };
    case 'bodyweight-goal-reached':
    case 'bodyweight-hold':
      return {
        kind: decision.basis,
        valueLabel: bodyweightTargetLabel(prescription),
        deltaLabel: targetDeltaLabel(decision) ?? undefined,
        contextLabel: context ?? undefined,
      };
    case 'duration-increase':
    case 'duration-hold':
      return {
        kind: decision.basis,
        valueLabel: formatSeconds(decision.nextSeconds),
        deltaLabel: targetDeltaLabel(decision) ?? undefined,
        contextLabel: context ?? undefined,
      };
    case 'first-exposure':
      return null;
  }
}

/** The quiet muted line of a basis that renders no callout, or null. */
export function sessionQuietLabel(target: ExerciseTargetDto | null): string | null {
  if (target === null) {
    return null;
  }
  switch (target.target.basis) {
    case 'first-exposure':
      return 'First time · no history yet';
    case 'increase':
    case 'hold':
    case 'regress':
    case 'scheme-change':
    case 'bodyweight-goal-reached':
    case 'bodyweight-hold':
    case 'duration-increase':
    case 'duration-hold':
      return null;
  }
}

/**
 * Advisory hint copy (the M8 "Hint" line under the callout). The claim
 * "prefilled" is only made when the prefill actually came from the
 * recommendation — an in-session value never claims to be the
 * recommendation, it stands. A null session prefill hints nothing: no
 * logged value is invented.
 */
export function sessionHintLabel(
  source: 'session' | 'recommendation' | 'none',
  kind: 'weight' | 'seconds',
  prefill: number | null,
): string | null {
  if (source === 'session') {
    if (prefill === null) {
      // Nothing was actually logged — "You logged 0 kg" would fabricate a
      // value (0 is a real load, not a stand-in for "nothing").
      return null;
    }
    const value = kind === 'weight' ? formatKg(prefill) : formatSeconds(prefill);
    const unit = kind === 'weight' ? 'weight' : 'duration';
    return `You logged ${value} — your ${unit} stands. The recommendation stays as context.`;
  }
  if (source === 'recommendation') {
    return 'Advisory prefill — edit freely. Your logged value always counts.';
  }
  return null;
}
