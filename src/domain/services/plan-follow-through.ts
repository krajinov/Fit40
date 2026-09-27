/**
 * Plan follow-through: how one planned occurrence stands (M16).
 *
 * Read-side reconciliation between a run's calendar *intent* (the
 * `PlannedWorkout` rows of the current enrollment) and its execution *fact*
 * (the session facts the caller resolved for those occurrences).
 *
 * This is the M16 counterpart of `schedule-focus.ts`: that module answers "what
 * is on the calendar now, and what is behind"; this one answers "how has the
 * plan held up" — aggregated week by week in `follow-through-week.ts`. Both
 * obey the same locked precedence (session facts outrank date-derived state),
 * and `tests/unit/domain/schedule-follow-through-parity.test.ts` pins the two
 * taxonomies together so they cannot silently drift apart.
 *
 * Deliberate boundaries of this module:
 * - **Pure and clock-free.** Every instant and date is a parameter; nothing
 *   here reads the clock, the database or the environment.
 * - **UTC calendar days only.** A completion instant is projected with
 *   `plannedDateFromInstant` (the one-way instant → PlannedDate rule), so no
 *   local-time `Date` parsing and no `Intl` can shift a classification. A
 *   workout completed one UTC calendar day after its planned date is
 *   `completed-late`: there is no grace period and no time-of-day comparison.
 * - **Classification, never judgement.** No percentage, ratio, score, streak or
 *   goal lives here or anywhere downstream of it.
 * - **Planning stays intent.** Nothing here writes, and nothing here can
 *   complete, move or rewrite a planned workout.
 */

import type { ScheduledWorkoutId } from '@/domain/types/ids';
import {
  isPlannedDateBefore,
  plannedDateFromInstant,
  type PlannedDate,
} from '@/domain/value-objects/planned-date';

/**
 * How one planned occurrence stands, in precedence order: a completion fact
 * (refined into early / on-plan / late by its UTC completion day), then a live
 * session, then the planned-date relationship to today.
 *
 * The three `completed-*` members are one axis split three ways: every one of
 * them is a completed occurrence, so they normalize back to M15's single
 * `completed` status (see the parity guard).
 */
export const FollowThroughOutcome = {
  CompletedEarly: 'completed-early',
  CompletedOnPlan: 'completed-on-plan',
  CompletedLate: 'completed-late',
  Started: 'started',
  PastDue: 'past-due',
  Today: 'today',
  Upcoming: 'upcoming',
} as const;

export type FollowThroughOutcome = (typeof FollowThroughOutcome)[keyof typeof FollowThroughOutcome];

/**
 * One planned occurrence plus the session facts resolved for it. Facts are
 * supplied by the caller; this module never reads sessions or planning.
 *
 * `completedAt` is the completion instant of the occurrence's completed session
 * (`null` when none exists) — only its UTC calendar day is read.
 * `hasActiveSession` is the live in-progress fact.
 */
export interface PlannedOccurrenceFacts {
  readonly scheduledWorkoutId: ScheduledWorkoutId;
  readonly plannedDate: PlannedDate;
  readonly completedAt: Date | null;
  readonly hasActiveSession: boolean;
}

/**
 * Resolves the follow-through outcome of one planned occurrence.
 *
 * Locked precedence:
 * 1. a completed session → `completed-early` / `completed-on-plan` /
 *    `completed-late`, by comparing its UTC completion day with the planned date
 * 2. a live in-progress session → `started` (never `past-due`)
 * 3. the planned date relative to today → `past-due` / `today` / `upcoming`
 *
 * `today` is the UTC calendar day of the caller's clock (the
 * `plannedDateFromInstant` rule), passed in so the result is deterministic.
 */
export function resolveFollowThroughOutcome(
  occurrence: PlannedOccurrenceFacts,
  today: PlannedDate,
): FollowThroughOutcome {
  const { completedAt } = occurrence;
  if (completedAt !== null) {
    const completedDate = plannedDateFromInstant(completedAt);
    if (isPlannedDateBefore(completedDate, occurrence.plannedDate)) {
      return FollowThroughOutcome.CompletedEarly;
    }
    if (isPlannedDateBefore(occurrence.plannedDate, completedDate)) {
      return FollowThroughOutcome.CompletedLate;
    }
    return FollowThroughOutcome.CompletedOnPlan;
  }

  if (occurrence.hasActiveSession) {
    return FollowThroughOutcome.Started;
  }

  if (isPlannedDateBefore(occurrence.plannedDate, today)) {
    return FollowThroughOutcome.PastDue;
  }
  if (isPlannedDateBefore(today, occurrence.plannedDate)) {
    return FollowThroughOutcome.Upcoming;
  }
  return FollowThroughOutcome.Today;
}
