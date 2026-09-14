/**
 * Domain service: skip/unskip of one exercise occurrence inside an in-progress
 * session (M10). Split out of the original session-exercise-adjustment
 * service by responsibility (PR #13 Finding 2); the shared blocking rules and
 * the eligibility projection live in `occurrence-adjustment-rules.ts`.
 *
 * PRODUCT SEMANTICS — skip is a persisted fact, never an inference:
 * - `ExerciseLog.isSkipped` records the user's explicit decision to not
 *   perform this occurrence in this session. An occurrence with zero logged
 *   sets is NOT skipped unless this flag says so.
 * - Skip and logged sets are mutually exclusive in BOTH directions, and the
 *   domain is the only enforcement boundary: `skipSessionExercise` rejects
 *   an occurrence containing sets (`EXERCISE_HAS_LOGGED_SETS`) and
 *   `logSessionSet` rejects a skipped occurrence
 *   (`EXERCISE_OCCURRENCE_SKIPPED`). There is deliberately no database
 *   CHECK/trigger for this cross-table rule — direct SQL could persist the
 *   invalid combination; no supported write path can.
 * - The decision is reversible while the session is in progress and frozen
 *   at completion (completed sessions are immutable).
 */

import type { ExerciseLog, WorkoutSession } from '@/domain/entities/workout-session';
import { err, ok, type Result } from '@/domain/types/result';

import {
  loadInProgressOccurrence,
  occurrenceAdjustmentBlock,
  type SessionAdjustmentError,
} from './occurrence-adjustment-rules';

// ─── Inputs ──────────────────────────────────────────────────────────────────

export interface SkipSessionExerciseInput {
  /** Identifies the occurrence within its session. */
  readonly exerciseOrder: number;
}

export interface UnskipSessionExerciseInput {
  readonly exerciseOrder: number;
}

// ─── Guards ─────────────────────────────────────────────────────────────────

/**
 * The skip/unskip loader: the shared in-progress/existence preconditions plus
 * the zero-logged-sets rule (skip is mutually exclusive with performed
 * work).
 */
function loadAdjustableOccurrence(
  session: WorkoutSession,
  exerciseOrder: number,
): Result<ExerciseLog, SessionAdjustmentError> {
  const result = loadInProgressOccurrence(session, exerciseOrder);
  if (!result.ok) return result;

  // The completed case returned above, so a block here is the logged-set rule.
  if (occurrenceAdjustmentBlock(session, result.data) === 'logged-sets') {
    return err({
      code: 'EXERCISE_HAS_LOGGED_SETS',
      exerciseOrder,
      message: `Exercise order ${exerciseOrder} has logged sets; delete them before skipping it`,
    });
  }

  return result;
}

// ─── Skip & Unskip ──────────────────────────────────────────────────────────

/**
 * Marks one occurrence as skipped. The whole occurrence contract (authored
 * and performed identity, prescription and rest snapshot, order, the version
 * token and every other occurrence) is untouched — only the persisted skip
 * flag flips. Sets are and stay empty (the guard rejected any logged set).
 */
export function skipSessionExercise(
  session: WorkoutSession,
  input: SkipSessionExerciseInput,
): Result<WorkoutSession, SessionAdjustmentError> {
  const log = loadAdjustableOccurrence(session, input.exerciseOrder);
  if (!log.ok) return log;

  if (log.data.isSkipped) {
    return err({ code: 'ADJUSTMENT_NO_CHANGE', message: 'This exercise is already skipped' });
  }

  const exerciseLogs = session.exerciseLogs.map((e) =>
    e.order === input.exerciseOrder ? { ...e, isSkipped: true } : e,
  );

  return ok({ ...session, exerciseLogs });
}

/**
 * Reverts a skipped occurrence back to not-skipped. Guards mirror skip:
 * blocked on a completed session; an unskipped occurrence is a no-change.
 * (A valid skipped occurrence has zero logged sets, so the logged-set
 * guard never fires here.)
 */
export function unskipSessionExercise(
  session: WorkoutSession,
  input: UnskipSessionExerciseInput,
): Result<WorkoutSession, SessionAdjustmentError> {
  const log = loadAdjustableOccurrence(session, input.exerciseOrder);
  if (!log.ok) return log;

  if (!log.data.isSkipped) {
    return err({ code: 'ADJUSTMENT_NO_CHANGE', message: 'This exercise is not skipped' });
  }

  const exerciseLogs = session.exerciseLogs.map((e) =>
    e.order === input.exerciseOrder ? { ...e, isSkipped: false } : e,
  );

  return ok({ ...session, exerciseLogs });
}
