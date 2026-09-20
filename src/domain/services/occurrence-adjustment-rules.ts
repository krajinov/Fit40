/**
 * Domain service: the shared occurrence-adjustment RULES kernel (M10).
 *
 * This module owns the single definition of WHEN an exercise occurrence's
 * adjustment decisions may change: the blocking rule, its error shape, and
 * the read-only eligibility projection both the skip/unskip and reorder
 * mutations guard with. The mutation services (`session-exercise-skip.ts`,
 * `session-exercise-reorder.ts`) consume this kernel, and persistence,
 * application DTOs and presentation consume the projection — nobody
 * re-derives a blocking rule from raw session facts (mirroring the
 * substitution service's pattern).
 *
 * Semantics (canonical reference: docs/session-adjustments.md):
 * - A COMPLETED session and an occurrence with ANY logged set both freeze
 *   the skip decision. When both blocks apply, the completed-session block
 *   wins, mirroring the substitution guards' precedence.
 * - Logged sets, the skip decision and substitutions NEVER block a reorder —
 *   only completion does. The projection's canMoveUp/canMoveDown carry that
 *   distinction; the skip flags carry the skip-only blocks.
 */

import type { ExerciseLog, WorkoutSession } from '@/domain/entities/workout-session';
import { err, ok, type Result } from '@/domain/types/result';

/**
 * Expected adjustment failures. `SESSION_ALREADY_COMPLETED`,
 * `EXERCISE_LOG_NOT_FOUND` and `EXERCISE_HAS_LOGGED_SETS` mirror the shapes
 * used by the entity mutations and the substitution service; the no-change
 * and move-boundary codes are unique to the adjustment mutations.
 */
export type SessionAdjustmentError =
  | { readonly code: 'SESSION_ALREADY_COMPLETED'; readonly message: string }
  | { readonly code: 'EXERCISE_LOG_NOT_FOUND'; readonly exerciseOrder: number; readonly message: string }
  | { readonly code: 'EXERCISE_HAS_LOGGED_SETS'; readonly exerciseOrder: number; readonly message: string }
  | { readonly code: 'MOVE_OUT_OF_RANGE'; readonly exerciseOrder: number; readonly message: string }
  | { readonly code: 'ADJUSTMENT_NO_CHANGE'; readonly message: string };

/** Why an occurrence's skip decision is currently blocked; null = adjustable. */
export type OccurrenceAdjustmentBlock =
  | 'session-completed'
  | 'logged-sets';

/**
 * The shared blocking rule: a completed session and an occurrence with ANY
 * logged set both freeze the skip decision. The mutation guards and the
 * eligibility projection below consume this single definition — nobody
 * re-derives it. When both blocks apply, the completed-session block wins,
 * mirroring the substitution guards' precedence.
 */
export function occurrenceAdjustmentBlock(
  session: WorkoutSession,
  log: ExerciseLog,
): OccurrenceAdjustmentBlock | null {
  if (session.completedAt !== null) return 'session-completed';
  if (log.sets.length > 0) return 'logged-sets';
  return null;
}

/**
 * Loads the occurrence and enforces the preconditions every adjustment
 * mutation shares: the session must be in progress and the occurrence must
 * exist. Skip/unskip additionally require zero logged sets; moves never do.
 */
export function loadInProgressOccurrence(
  session: WorkoutSession,
  exerciseOrder: number,
): Result<ExerciseLog, SessionAdjustmentError> {
  if (session.completedAt !== null) {
    return err({ code: 'SESSION_ALREADY_COMPLETED', message: 'Cannot modify a completed session' });
  }

  const log = session.exerciseLogs.find((e) => e.order === exerciseOrder);
  if (log === undefined) {
    return err({
      code: 'EXERCISE_LOG_NOT_FOUND',
      exerciseOrder,
      message: `Exercise log with order ${exerciseOrder} not found in session`,
    });
  }

  return ok(log);
}

// ─── Eligibility (read-only projection) ─────────────────────────────────────

/** Derived adjustment eligibility of one occurrence. Never persisted. */
export interface OccurrenceAdjustmentEligibility {
  readonly isSkipped: boolean;
  /** Null when the occurrence's skip decision is currently adjustable. */
  readonly blockedBy: OccurrenceAdjustmentBlock | null;
  /** True only for an in-progress, unskipped occurrence with zero logged sets. */
  readonly canSkip: boolean;
  /** True only for an in-progress, skipped occurrence (frozen at completion). */
  readonly canUnskip: boolean;
  /**
   * True only for an in-progress occurrence with a neighbor above
   * (order > 1). Logged sets, the skip decision and substitutions never
   * block moves — the whole occurrence swaps as one unit.
   */
  readonly canMoveUp: boolean;
  /** True only for an in-progress occurrence with a neighbor below (order < N). */
  readonly canMoveDown: boolean;
}

/**
 * Derives whether one occurrence's skip decision may currently change —
 * the same rules the mutation guards enforce, exposed as a projection.
 * Persistence, application DTOs and presentation consume this; nobody
 * re-derives mutability from raw session facts.
 */
export function resolveOccurrenceAdjustmentEligibility(
  session: WorkoutSession,
  log: ExerciseLog,
): OccurrenceAdjustmentEligibility {
  const blockedBy = occurrenceAdjustmentBlock(session, log);
  // Reordering is frozen only by completion: logged sets, the skip decision
  // and substitutions never block a move — the whole occurrence (sets
  // included) swaps with its neighbor.
  const frozen = blockedBy === 'session-completed';
  return {
    isSkipped: log.isSkipped,
    blockedBy,
    canSkip: !log.isSkipped && blockedBy === null,
    canUnskip: log.isSkipped && blockedBy === null,
    canMoveUp: !frozen && log.order > 1,
    canMoveDown: !frozen && log.order < session.exerciseLogs.length,
  };
}
