/**
 * PURE presentation mapping for the Active Workout's occurrence adjustment
 * affordance (M10): which skip controls one occurrence exposes, the honest
 * blocked copy, and whether each adjacent move control may render.
 *
 * Business mutability arrives as the domain-derived eligibility projection
 * (`WorkoutSessionExerciseDto.adjustmentEligibility` from
 * `resolveOccurrenceAdjustmentEligibility`) — this module only formats the
 * state it is handed and can structurally never re-derive blocking from raw
 * set counts, completion, enrollment, array position or substitution facts.
 * What stays purely visual is which control renders. The domain remains the
 * enforcement boundary; this module never re-implements the skip/unskip or
 * move mutation rules.
 *
 * Affordance states (locked M10 semantics):
 * - `open`                 in progress · not skipped · mutable — the Skip
 *                          control may run `skipExerciseAction`
 * - `skipped`              in progress · skipped · mutable — the Undo-skip
 *                          control may run `unskipExerciseAction`
 * - `blocked-logged-sets`  ≥1 logged set · no SKIP control, muted truthful
 *                          copy — but the move controls still render:
 *                          logged sets freeze only the skip decision,
 *                          never a reorder (the whole occurrence swaps as
 *                          one unit)
 * - `hidden`               completed/read-only session · no mutation
 *                          controls — not even Undo skip (frozen at
 *                          completion)
 */

import type { OccurrenceAdjustmentEligibilityDto } from '@/application/dto/workout-session';

/** Quiet control copy of the open state. */
export const SKIP_LABEL = 'Skip exercise';

/** Quiet control copy of the skipped state. */
export const UNSKIP_LABEL = 'Undo skip';

/** Quiet control copy of the adjacent move-up affordance (M10 Slice 6). */
export const MOVE_UP_LABEL = 'Move up';

/** Quiet control copy of the adjacent move-down affordance (M10 Slice 6). */
export const MOVE_DOWN_LABEL = 'Move down';

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

/**
 * The adjustment affordance of one occurrence card, derived server-side
 * from the domain's eligibility projection: the skip state, the honest
 * blocked copy, and whether each adjacent move control may render.
 */
export interface SessionAdjustmentView {
  readonly state: SessionAdjustmentState;
  /** Present only in the `blocked-logged-sets` state; null otherwise. */
  readonly blockedLabel: string | null;
  /**
   * Copied verbatim from `adjustmentEligibility.canMoveUp` — never derived
   * from the occurrence's array position, skip decision or logged sets.
   */
  readonly canMoveUp: boolean;
  /** Copied verbatim from `adjustmentEligibility.canMoveDown`. */
  readonly canMoveDown: boolean;
}

/**
 * Derives one occurrence's adjustment affordance from the domain-derived
 * eligibility projection. The blocking states map 1:1 from `blockedBy`; the
 * persisted decision (`isSkipped`) distinguishes open from skipped. A
 * skipped occurrence on a completed session maps to `hidden` — its decision
 * is frozen, so no Undo-skip control may render. The move flags are copied
 * verbatim in every state: they are the domain's facts about adjacency and
 * completion, never a positional re-derivation.
 */
export function buildSessionAdjustmentView(
  eligibility: OccurrenceAdjustmentEligibilityDto,
): SessionAdjustmentView {
  // Completed sessions are read-only: no mutation controls render at all.
  if (eligibility.blockedBy === 'session-completed') {
    return {
      state: 'hidden',
      blockedLabel: null,
      canMoveUp: eligibility.canMoveUp,
      canMoveDown: eligibility.canMoveDown,
    };
  }

  // Logged sets freeze the skip decision, with truthful muted copy — the
  // move flags ride along untouched (logged sets never block a reorder).
  if (eligibility.blockedBy === 'logged-sets') {
    return {
      state: 'blocked-logged-sets',
      blockedLabel: SKIP_BLOCKED_LABEL,
      canMoveUp: eligibility.canMoveUp,
      canMoveDown: eligibility.canMoveDown,
    };
  }

  // A skipped, mutable occurrence may unskip — and move normally.
  if (eligibility.isSkipped) {
    return {
      state: 'skipped',
      blockedLabel: null,
      canMoveUp: eligibility.canMoveUp,
      canMoveDown: eligibility.canMoveDown,
    };
  }

  return {
    state: 'open',
    blockedLabel: null,
    canMoveUp: eligibility.canMoveUp,
    canMoveDown: eligibility.canMoveDown,
  };
}
