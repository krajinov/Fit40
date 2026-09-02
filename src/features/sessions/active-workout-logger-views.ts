/**
 * PURE presentation mapping for the Active Workout screen's set logger:
 * the weight PREFILL and the advisory progression CALLOUT of one exercise.
 *
 * This module formats decisions the domain engine and the session snapshot
 * already made. It never calculates progressions, compares reps, or re-derives
 * load decisions — those arrive fully-formed in `ExerciseTargetDto` and
 * `WorkoutSessionExerciseDto`, and their semantics are owned by
 * Domain/Application.
 *
 * Locked-design semantics implemented here:
 *
 * - PREFILL precedence (per exercise LOG, never across logs — duplicate
 *   exercise ids in sibling logs cannot leak weights into each other):
 *     1. the latest logged NON-NULL weight of THIS log in THIS session
 *        (0 kg is a real external load and prefills "0"),
 *     2. otherwise the recommendation's target load (`nextLoadKg`) — only
 *        for increase / hold / regress-with-load targets,
 *     3. otherwise nothing (regression floored at null never fakes "0 kg").
 * - CALLOUTS are advisory: they always render the recommendation computed
 *   from the latest COMPLETED performance, even after the user already
 *   logged heavier sets this session.
 * - bodyweight / duration bases render NO callout (the engine progresses
 *   external load, not bodyweight reps or timed work).
 * - "Last time" copy shows the previous LOAD only — previous reps are not in
 *   the DTO, so the locked hint "From 50 kg × 10" renders truthfully as
 *   "From 50 kg last time".
 */

import type { RecommendationKind } from '@/components/shared/RecommendationCallout';
import type { ExerciseTargetDto } from '@/application/dto/exercise';
import type { WorkoutSessionExerciseDto } from '@/application/dto/workout-session';
import { formatPrescription } from '@/features/programs/program-labels';
import { formatKg } from '@/features/sessions/workout-target-views';

export interface SessionCalloutView {
  readonly kind: RecommendationKind;
  readonly valueLabel?: string;
  readonly contextLabel?: string;
}

/** Where the logger's weight prefill came from (drives the hint copy). */
export type LoggerPrefillSource = 'session' | 'recommendation' | 'none';

export interface SessionLoggerView {
  readonly prefillWeightKg: number | null;
  readonly prefillSource: LoggerPrefillSource;
  readonly callout: SessionCalloutView | null;
}

/** Latest logged non-null external weight of one log (0 kg counts). */
export function lastLoggedWeightKg(log: WorkoutSessionExerciseDto): number | null {
  let last: number | null = null;
  for (const set of log.sets) {
    if (set.weightKg !== null) {
      last = set.weightKg;
    }
  }
  return last;
}

/** The recommendation's advisory load, when the basis carries one. */
function recommendedLoadKg(target: ExerciseTargetDto | null): number | null {
  const decision = target?.target;
  if (decision === undefined) {
    return null;
  }
  switch (decision.basis) {
    case 'increase':
    case 'hold':
      return decision.nextLoadKg;
    case 'regress':
      return decision.nextLoadKg;
    default:
      return null;
  }
}

/**
 * Context copy for the advisory callout. The claim "prefilled" is only made
 * when the prefill actually came from that source — an in-session prefill
 * never claims to be the recommendation.
 */
function calloutContextLabel(
  target: ExerciseTargetDto,
  source: LoggerPrefillSource,
): string | undefined {
  const decision = target.target;
  const previous = 'previousLoadKg' in decision ? formatKg(decision.previousLoadKg) : null;

  if (source === 'session') {
    return 'Prefilled with your last set — edit freely.';
  }
  if (source === 'recommendation' && previous !== null) {
    return `From ${previous} last time — prefilled, edit freely.`;
  }
  if (decision.basis === 'regress' && decision.nextLoadKg === null) {
    return previous === null
      ? undefined
      : `Last time ${previous} — train without added load today.`;
  }
  return previous === null ? undefined : `From ${previous} last time.`;
}

/** Maps one batched target to the logger's advisory callout (or null). */
export function mapSessionCallout(
  target: ExerciseTargetDto | null,
  source: LoggerPrefillSource,
  prescriptionLabel: string,
): SessionCalloutView | null {
  if (target === null) {
    return null;
  }
  const decision = target.target;

  switch (decision.basis) {
    case 'increase':
    case 'hold':
      return {
        kind: decision.basis,
        valueLabel: formatKg(decision.nextLoadKg),
        contextLabel: calloutContextLabel(target, source),
      };
    case 'regress':
      return {
        kind: 'regress',
        valueLabel:
          decision.nextLoadKg === null ? 'No added load' : formatKg(decision.nextLoadKg),
        contextLabel: calloutContextLabel(target, source),
      };
    case 'scheme-change':
      return {
        kind: 'scheme-change',
        valueLabel: prescriptionLabel,
        contextLabel: 'Previous performance was under a different rep scheme.',
      };
    case 'first-exposure':
      // The shared callout component supplies the locked first-time copy.
      return { kind: 'first-exposure' };
    default:
      // bodyweight / duration bases: no load callout (by design contract).
      return null;
  }
}

/**
 * Derives the logger view for one exercise log: prefill (session-first,
 * recommendation fallback, never a fake 0) plus the advisory callout.
 */
export function buildSessionLoggerView(
  log: WorkoutSessionExerciseDto,
  target: ExerciseTargetDto | null,
): SessionLoggerView {
  const prescriptionLabel = formatPrescription(log.prescription);
  const sessionWeight = lastLoggedWeightKg(log);

  if (sessionWeight !== null) {
    return {
      prefillWeightKg: sessionWeight,
      prefillSource: 'session',
      callout: mapSessionCallout(target, 'session', prescriptionLabel),
    };
  }

  const recommended = recommendedLoadKg(target);
  if (recommended !== null) {
    return {
      prefillWeightKg: recommended,
      prefillSource: 'recommendation',
      callout: mapSessionCallout(target, 'recommendation', prescriptionLabel),
    };
  }

  return {
    prefillWeightKg: null,
    prefillSource: 'none',
    callout: mapSessionCallout(target, 'none', prescriptionLabel),
  };
}

