/**
 * PURE presentation copy for M8 progression targets: deterministic
 * reason-to-sentence mapping and label formatting.
 *
 * This module is the single home of UI copy for progression states. It maps
 * the engine's machine-readable `basis`/`reason` codes (see
 * `progression-reason.ts`) to the concise, deterministic sentences of the
 * approved M8 Pencil design ("Fit40 · Design System — M8 Progression v2").
 * It never computes a progression, compares reps, or interprets history —
 * all numbers arrive as DTO fields.
 *
 * Every mapping is an exhaustive switch over the discriminated unions with
 * a `never` check, so a future basis/reason fails compilation until it is
 * deliberately given copy. Raw reason codes are never shown to users.
 *
 * Truthfulness rules (locked semantics):
 * - Direction is always named in words (Increase / Keep / Reduce), never
 *   color alone.
 * - Regress is supportive amber copy, never error wording.
 * - Bodyweight states never invent load, variation, or substitution copy.
 * - Mixed-load history names each set's own load — the working minimum is
 *   never presented as the load of every set.
 */

import type { PreviousExerciseSetDto } from '@/application/dto/exercise';
import type { NextExerciseTarget } from '@/domain/services/exercise-progression';
import type {
  BodyweightHoldProgressionReason,
  DurationHoldProgressionReason,
  HoldProgressionReason,
} from '@/domain/services/progression-reason';
import type { RepPrescription } from '@/domain/value-objects/rep-prescription';

// ─── Number formatting ───────────────────────────────────────────────────────

/**
 * Formats a load value for display: trims float dust ("52.50 kg" →
 * "52.5 kg") while keeping half-kilos ("22.5 kg"). `0` stays a real load.
 */
export function formatKg(kg: number): string {
  const rounded = Math.round(kg * 100) / 100;
  return `${rounded} kg`;
}

/** Formats a duration value ("35 sec"); 60 seconds stays "60 sec". */
export function formatSeconds(seconds: number): string {
  return `${Math.round(seconds)} sec`;
}

// ─── Reason → sentence (the deterministic M8 copy) ──────────────────────────

/** Copy for a `hold` target, by the reason that held the load. */
export function holdReasonLabel(reason: HoldProgressionReason): string {
  switch (reason) {
    case 'single-session-below-minimum':
      return 'Previous session was below the target range. One more similar session would trigger a reduction.';
    case 'mixed-performance-in-range':
      return 'Reps landed inside the target range — keep the current load.';
    case 'non-uniform-load':
      return 'Sets were logged with different loads — keep the current load.';
    case 'incomplete-sets':
      return 'Previous performance was incomplete.';
  }
}

/** Copy for a `bodyweight-hold` target, by the reason that held it. */
export function bodyweightHoldReasonLabel(reason: BodyweightHoldProgressionReason): string {
  switch (reason) {
    case 'reps-below-top-of-range':
      return 'Aim for the top of the prescribed rep range in every set.';
    case 'incomplete-sets':
      return 'Previous performance was incomplete.';
  }
}

/** Copy for a `duration-hold` target, by the reason that held it. */
export function durationHoldReasonLabel(reason: DurationHoldProgressionReason): string {
  switch (reason) {
    case 'sets-below-target-duration':
      return 'Aim for the full target duration in every set.';
    case 'incomplete-sets':
      return 'Previous performance was incomplete.';
  }
}

/**
 * The deterministic reason sentence for any target variant — the single
 * mapping every screen shares. Exhaustive over the full union: a new basis
 * or reason fails compilation here until it is given copy.
 */
export function targetReasonLabel(target: NextExerciseTarget): string {
  switch (target.basis) {
    case 'first-exposure':
      return 'First time · no history yet';
    case 'scheme-change':
      return 'Previous performance was recorded under a different prescription.';
    case 'bodyweight-goal-reached':
      return 'You completed all prescribed sets at the top of the target range.';
    case 'bodyweight-hold':
      return bodyweightHoldReasonLabel(target.reason);
    case 'duration-increase':
      return 'Completed all prescribed sets at the target duration.';
    case 'duration-hold':
      return durationHoldReasonLabel(target.reason);
    case 'increase':
      return 'Completed all prescribed sets at the top of the rep range.';
    case 'hold':
      return holdReasonLabel(target.reason);
    case 'regress':
      return 'Two consecutive sessions were below the target range.';
  }
}

// ─── Delta (direction) lines ─────────────────────────────────────────────────

/** Direction line for a target decision, e.g. "Increase 2.5 kg". */
export function targetDeltaLabel(target: NextExerciseTarget): string | null {
  switch (target.basis) {
    case 'increase':
      return `Increase ${formatKg(target.incrementKg)}`;
    case 'regress':
      // A floored reduction carries no amount to name — the value line
      // itself ("No added load") already states the direction in words.
      return target.nextLoadKg === null ? null : `Reduce ${formatKg(target.incrementKg)}`;
    case 'hold':
      return 'Keep current load';
    case 'duration-increase':
      return `Increase duration by ${target.incrementSeconds} sec`;
    case 'duration-hold':
      return 'Keep current duration';
    case 'bodyweight-goal-reached':
      return 'Goal reached';
    case 'bodyweight-hold':
    case 'first-exposure':
    case 'scheme-change':
      return null;
  }
}

// ─── Last-time context ───────────────────────────────────────────────────────

/** One considered set's "10" (reps) / "30" (seconds) value fragment. */
function setFragment(set: PreviousExerciseSetDto): string {
  if (set.type === 'reps') {
    return String(set.reps);
  }
  return String(set.durationSeconds);
}

/**
 * The one load every considered set shared, or null when loads were mixed
 * or absent. The engine's `previousLoadKg` is the working MINIMUM across
 * sets, so it alone cannot authorize presenting one load for every set.
 */
function uniformLoadKg(previousSets: ReadonlyArray<PreviousExerciseSetDto>): number | null {
  const first = previousSets[0]?.weightKg;
  if (first === null || first === undefined) {
    return null;
  }
  return previousSets.every((set) => set.weightKg === first) ? first : null;
}

/** One set of a mixed-load line: "62.5 kg × 9", or just "9" with no load. */
function loadedSetFragment(set: PreviousExerciseSetDto): string {
  const value = setFragment(set);
  return set.weightKg === null ? value : `${formatKg(set.weightKg)} × ${value}`;
}

/**
 * Truthful "Last time" context from the DTO's previous-sets projection:
 * "Last time · 60 kg × 10, 10, 10" when one load covered every set, "Last
 * time · 60 kg × 10, 62.5 kg × 9, 25 kg × 8" when the sets used mixed
 * loads (each set names its own — the working minimum never stands in as
 * the load of every set), "Last time · 30, 30, 25 sec" for timed work,
 * "Last time · 12, 12, 10 reps" for unloaded bodyweight reps, or null when
 * nothing truthful exists. Timed work lists its seconds directly (they are
 * the performance — the scheme seconds are not a load); bodyweight work
 * never shows a fabricated load.
 */
export function lastTimeLabel(
  target: NextExerciseTarget,
  previousSets: ReadonlyArray<PreviousExerciseSetDto> | null,
): string | null {
  if (previousSets === null || previousSets.length === 0) {
    return null;
  }

  if (target.basis === 'increase' || target.basis === 'hold' || target.basis === 'regress') {
    const load = uniformLoadKg(previousSets);
    if (load !== null) {
      return `Last time · ${formatKg(load)} × ${previousSets.map(setFragment).join(', ')}`;
    }
    return `Last time · ${previousSets.map(loadedSetFragment).join(', ')}`;
  }

  const unit = previousSets[0]?.type === 'duration' ? ' sec' : ' reps';
  return `Last time · ${previousSets.map(setFragment).join(', ')}${unit}`;
}

// ─── Bodyweight value labels ──────────────────────────────────────────────────

/**
 * The authored target a bodyweight/duration state points at, formatted from
 * the CURRENT prescription: "12 reps" or "30 sec". The engine decides the
 * state; this only formats the authored numbers already on the prescription.
 */
export function bodyweightTargetLabel(prescription: RepPrescription): string {
  if (prescription.type === 'duration') {
    return formatSeconds(prescription.seconds);
  }
  return `${prescription.maxReps} reps`;
}

