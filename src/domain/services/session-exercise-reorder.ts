/**
 * Domain service: adjacent reordering of exercise occurrences inside an
 * in-progress session (M10). Split out of the original session-exercise-
 * adjustment service by responsibility (PR #13 Finding 2); the shared
 * blocking rules and the eligibility projection live in
 * `occurrence-adjustment-rules.ts`.
 *
 * REORDER SEMANTICS — `moveSessionExercise` swaps adjacent occurrences:
 * - Occurrence identity is (sessionId, exerciseOrder): a move targets the
 *   occurrence at that order, never "the exercise with that id" (the same
 *   exercise may appear twice in a session).
 * - Only adjacent moves exist (one slot up or down) and orders stay dense
 *   1..N after every move, and the returned aggregate is canonical: array
 *   position agrees with order (exerciseLogs[index].order === index + 1),
 *   because Active Workout and progression consumers read
 *   session.exerciseLogs positionally.
 * - The WHOLE `ExerciseLog` occurrence — authored/performed ids,
 *   prescription, restSeconds, isSkipped and its logged sets — moves as
 *   one unit, so reordering never reassigns sets between exercises.
 * - Logged sets never block a move (unlike skip), and skipped or
 *   substituted occurrences are freely movable; only completion freezes
 *   reordering.
 */

import type { WorkoutSession } from '@/domain/entities/workout-session';
import { err, ok, type Result } from '@/domain/types/result';

import { loadInProgressOccurrence, type SessionAdjustmentError } from './occurrence-adjustment-rules';

// ─── Inputs ──────────────────────────────────────────────────────────────────

/** Which adjacent neighbor an occurrence swaps with. */
export type MoveDirection = 'up' | 'down';

export interface MoveSessionExerciseInput {
  /** Identifies the occurrence within its session. */
  readonly exerciseOrder: number;
  /** Swaps the occurrence with the neighbor above ('up') or below ('down'). */
  readonly direction: MoveDirection;
}

// ─── Move (reorder) ──────────────────────────────────────────────────────────

/**
 * Swaps one occurrence with its adjacent neighbor (up or down). Guards run
 * in the locked order: completed session → unknown occurrence → boundary.
 *
 * The WHOLE occurrence — authored/performed identity, prescription and rest
 * snapshot, skip decision and its logged sets — moves as one unit, so a
 * reorder can never reassign sets between exercises. Only the two swapped
 * occurrences change order, so the sequence stays dense 1..N.
 *
 * The returned aggregate is canonical: `exerciseLogs` is physically
 * arranged in the new session order (exerciseLogs[index].order ===
 * index + 1), because Active Workout and progression consumers read the
 * collection positionally.
 */
export function moveSessionExercise(
  session: WorkoutSession,
  input: MoveSessionExerciseInput,
): Result<WorkoutSession, SessionAdjustmentError> {
  const log = loadInProgressOccurrence(session, input.exerciseOrder);
  if (!log.ok) return log;

  const atBoundary =
    input.direction === 'up'
      ? log.data.order === 1
      : log.data.order === session.exerciseLogs.length;
  if (atBoundary) {
    return err({
      code: 'MOVE_OUT_OF_RANGE',
      exerciseOrder: input.exerciseOrder,
      message: `Exercise order ${input.exerciseOrder} cannot move ${input.direction} any further`,
    });
  }

  // Adjacent swap: the mover takes the neighbor's order and vice versa; every
  // other occurrence keeps its order.
  const neighborOrder = input.direction === 'up' ? log.data.order - 1 : log.data.order + 1;
  const swapped = session.exerciseLogs.map((e) => {
    if (e.order === input.exerciseOrder) return { ...e, order: neighborOrder };
    if (e.order === neighborOrder) return { ...e, order: input.exerciseOrder };
    return e;
  });

  // Canonical form: array position must agree with ExerciseLog.order —
  // exerciseLogs[index].order === index + 1 — after every successful move,
  // because Active Workout and progression code reads session.exerciseLogs
  // positionally. The aggregate factory guarantees the orders are exactly
  // the dense 1..N sequence, so arranging the swapped array by order IS the
  // physical session order and its dense renumbering; the whole occurrence
  // — identities, prescription, rest, skip decision and its logged sets —
  // travels as one untouched unit, and the source session is never mutated.
  const exerciseLogs = swapped.slice().sort((a, b) => a.order - b.order);

  return ok({ ...session, exerciseLogs });
}
