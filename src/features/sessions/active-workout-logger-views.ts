/**
 * PURE presentation mapping for the Active Workout screen's set logger
 * PREFILL: which value the logger's fields start from, and why.
 *
 * This module formats decisions the domain engine and the session snapshot
 * already made. It never calculates progressions, compares reps, or
 * re-derives load decisions — those arrive fully-formed in `ExerciseTargetDto`
 * and `WorkoutSessionExerciseDto`, and their semantics are owned by
 * Domain/Application. Callout, hint, and quiet-line copy live in
 * `session-callout-views.ts`; reason sentences in `progression-labels.ts`.
 *
 * Locked M8 PREFILL precedence (per exercise LOG, never across logs —
 * duplicate exercise ids in sibling logs cannot leak values into each
 * other):
 *
 *   1. the latest logged value of THIS log in THIS session (weight for
 *      loaded reps work, seconds for timed work; 0 kg is a real external
 *      load and prefills "0") — the user's current-session input always
 *      wins, and the recommendation stays visible as context;
 *   2. otherwise the recommendation's target (`nextLoadKg` for loaded
 *      reps work, `nextSeconds` for timed work) — an advisory prefill;
 *   3. otherwise nothing (regression floored at null never fakes "0 kg";
 *      bodyweight work never invents a weight field).
 */

import type { ExerciseTargetDto } from '@/application/dto/exercise';
import type { WorkoutSessionExerciseDto } from '@/application/dto/workout-session';
import {
  mapSessionCallout,
  sessionHintLabel,
  sessionQuietLabel,
  type SessionCalloutView,
} from '@/features/sessions/session-callout-views';

export type { SessionCalloutView } from '@/features/sessions/session-callout-views';

/** Where the logger's prefill came from (drives the advisory hint copy). */
export type LoggerPrefillSource = 'session' | 'recommendation' | 'none';

/** The kind of value the logger prefills for one prescription type. */
export type LoggerPrefillKind = 'weight' | 'seconds';

export interface SessionLoggerView {
  /** Weight prefill (kg) — loaded reps work only; never faked for bodyweight. */
  readonly prefillWeightKg: number | null;
  /** Seconds prefill — timed work only. */
  readonly prefillSeconds: number | null;
  readonly prefillSource: LoggerPrefillSource;
  readonly prefillKind: LoggerPrefillKind;
  readonly callout: SessionCalloutView | null;
  /** Quiet muted line (first exposure), or null. */
  readonly quietLabel: string | null;
  /**
   * Advisory hint under the callout: names the prefill's origin or confirms
   * the user's value stands; null when there is nothing to hint.
   */
  readonly hintLabel: string | null;
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

/** Latest logged seconds of one log (timed work). */
function lastLoggedSeconds(log: WorkoutSessionExerciseDto): number | null {
  let last: number | null = null;
  for (const set of log.sets) {
    if (set.type === 'duration') {
      last = set.durationSeconds;
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
    case 'regress':
      return decision.nextLoadKg;
    case 'scheme-change':
    case 'bodyweight-goal-reached':
    case 'bodyweight-hold':
    case 'duration-increase':
    case 'duration-hold':
    case 'first-exposure':
      return null;
  }
}

/** The recommendation's advisory seconds, when the basis carries them. */
function recommendedSeconds(target: ExerciseTargetDto | null): number | null {
  const decision = target?.target;
  if (decision === undefined) {
    return null;
  }
  switch (decision.basis) {
    case 'duration-increase':
    case 'duration-hold':
      return decision.nextSeconds;
    case 'increase':
    case 'hold':
    case 'regress':
    case 'scheme-change':
    case 'bodyweight-goal-reached':
    case 'bodyweight-hold':
    case 'first-exposure':
      return null;
  }
}

/** Shared view fields independent of the prefill kind. */
interface LoggerViewBase {
  readonly prefillSource: LoggerPrefillSource;
  readonly prefillKind: LoggerPrefillKind;
  readonly callout: SessionCalloutView | null;
  readonly quietLabel: string | null;
  readonly hintLabel: string | null;
}

function loggerBase(
  target: ExerciseTargetDto | null,
  source: LoggerPrefillSource,
  kind: LoggerPrefillKind,
  prefill: number | null,
  prescription: WorkoutSessionExerciseDto['prescription'],
): LoggerViewBase {
  return {
    prefillSource: source,
    prefillKind: kind,
    callout: mapSessionCallout(target, source, prescription),
    quietLabel: sessionQuietLabel(target),
    hintLabel: sessionHintLabel(source, kind, prefill),
  };
}

/**
 * Derives the logger view for one exercise log under the locked precedence:
 * session value first, recommendation second, nothing third. Timed work
 * prefills seconds; loaded reps work prefills the weight; bodyweight work
 * prefills nothing — never a fake load. The callout always shows the
 * recommendation as advisory context, whichever source won the prefill.
 */
export function buildSessionLoggerView(
  log: WorkoutSessionExerciseDto,
  target: ExerciseTargetDto | null,
): SessionLoggerView {
  if (log.prescription.type === 'duration') {
    const sessionSeconds = lastLoggedSeconds(log);
    if (sessionSeconds !== null) {
      return {
        prefillWeightKg: null,
        prefillSeconds: sessionSeconds,
        ...loggerBase(target, 'session', 'seconds', sessionSeconds, log.prescription),
      };
    }
    const recommended = recommendedSeconds(target);
    if (recommended !== null) {
      return {
        prefillWeightKg: null,
        prefillSeconds: recommended,
        ...loggerBase(target, 'recommendation', 'seconds', recommended, log.prescription),
      };
    }
    return {
      prefillWeightKg: null,
      prefillSeconds: null,
      ...loggerBase(target, 'none', 'seconds', null, log.prescription),
    };
  }

  const sessionWeight = lastLoggedWeightKg(log);
  if (sessionWeight !== null) {
    return {
      prefillWeightKg: sessionWeight,
      prefillSeconds: null,
      ...loggerBase(target, 'session', 'weight', sessionWeight, log.prescription),
    };
  }

  const recommended = recommendedLoadKg(target);
  if (recommended !== null) {
    return {
      prefillWeightKg: recommended,
      prefillSeconds: null,
      ...loggerBase(target, 'recommendation', 'weight', recommended, log.prescription),
    };
  }

  return {
    prefillWeightKg: null,
    prefillSeconds: null,
    ...loggerBase(target, 'none', 'weight', null, log.prescription),
  };
}
