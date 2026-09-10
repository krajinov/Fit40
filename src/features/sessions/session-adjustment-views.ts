/**
 * PURE presentation mapping for the Active Workout's occurrence skip
 * affordance (M10): which skip controls one occurrence exposes, and the
 * honest blocked copy.
 *
 * Business mutability arrives as the domain-derived eligibility projection
 * (`WorkoutSessionExerciseDto.adjustmentEligibility` from
 * `resolveOccurrenceAdjustmentEligibility`) — this module only formats the
 * state it is handed and can structurally never re-derive blocking from raw
 * set counts, completion, enrollment or substitution facts. What stays purely
 * visual is which control renders. The domain remains the enforcement
 * boundary; this module never re-implements the skip/unskip mutation rules.
 *
 * Affordance states (locked M10 semantics):
 * - `open`                 in progress · not skipped · mutable — the Skip
 *                          control may run `skipExerciseAction`
 * - `skipped`              in progress · skipped · mutable — the Undo-skip
 *                          control may run `unskipExerciseAction`
 * - `blocked-logged-sets`  ≥1 logged set · no control, muted truthful copy
 * - `hidden`               completed/read-only session · no mutation
 *                          controls — not even Undo skip (frozen at
 *                          completion)
 */

import type { OccurrenceAdjustmentEligibilityDto } from '@/application/dto/workout-session';

/** Quiet control copy of the open state. */
export const SKIP_LABEL = 'Skip exercise';

/** Quiet control copy of the skipped state. */
export const UNSKIP_LABEL = 'Undo skip';

/** Muted truthful copy of the logged-set block (spec wording). */
export const SKIP_BLOCKED_LABEL = 'Delete your logged sets to skip this exercise.';

/** Neutral badge of a skipped occurrence card. */
export const SKIPPED_BADGE_LABEL = 'Skipped';

/** Muted hint on a skipped card — truthful, and never promises an undo. */
export const SKIPPED_HINT_LABEL =
  'Skipped in this session — it logged no sets and adds none to your progress.';

export type SessionAdjustmentState =
  | 'open'
  | 'skipped'
  | 'blocked-logged-sets'
  | 'hidden';

/** The interactive states — the client panel's only inputs. */
export type SessionAdjustmentControlState = 'open' | 'skipped';

/**
 * The skip affordance of one occurrence card, derived server-side from the
 * domain's eligibility projection.
 */
export interface SessionAdjustmentView {
  readonly state: SessionAdjustmentState;
  /** Present only in the `blocked-logged-sets` state; null otherwise. */
  readonly blockedLabel: string | null;
}

/**
 * Derives one occurrence's skip affordance from the domain-derived
 * eligibility projection. The blocking states map 1:1 from `blockedBy`; the
 * persisted decision (`isSkipped`) distinguishes open from skipped. A
 * skipped occurrence on a completed session maps to `hidden` — its decision
 * is frozen, so no Undo-skip control may render.
 */
export function buildSessionAdjustmentView(
  eligibility: OccurrenceAdjustmentEligibilityDto,
): SessionAdjustmentView {
  // Completed sessions are read-only: no mutation controls render at all.
  if (eligibility.blockedBy === 'session-completed') {
    return { state: 'hidden', blockedLabel: null };
  }

  // Logged sets freeze the skip decision, with truthful muted copy.
  if (eligibility.blockedBy === 'logged-sets') {
    return { state: 'blocked-logged-sets', blockedLabel: SKIP_BLOCKED_LABEL };
  }

  // A skipped, mutable occurrence may unskip.
  if (eligibility.isSkipped) {
    return { state: 'skipped', blockedLabel: null };
  }

  return { state: 'open', blockedLabel: null };
}
