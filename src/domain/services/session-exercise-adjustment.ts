/**
 * Domain service: session-scoped occurrence adjustment (M10) — skipping an
 * authored exercise occurrence inside an in-progress session, reordering
 * occurrences with adjacent moves (M10), plus the derived session-level
 * facts that depend on those persisted decisions.
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
 *
 * The mutation rules are exposed as a read-only eligibility projection
 * (`resolveOccurrenceAdjustmentEligibility`) — persistence, application
 * DTOs and presentation consume it and never re-derive a blocking rule from
 * raw session facts, mirroring the substitution service's pattern.
 *
 * Session-level consequences of skip decisions are domain-owned here:
 * - `resolveSessionPrescriptionTotals`: the progress denominator excludes
 *   skipped occurrences (F5).
 * - `resolveSessionCompletionReadiness`: the completion gate — a session is
 *   completable when at least one set is logged somewhere (F6, unchanged by
 *   M10). Skipped occurrences carry no sets, so an all-skipped session
 *   stays non-completable through this same gate; there is no stricter
 *   every-non-skipped-exercise rule. `completeWorkoutSession` delegates to
 *   this definition.
 */

import type { ExerciseLog, WorkoutSession } from '@/domain/entities/workout-session';
import { err, ok, type Result } from '@/domain/types/result';

// ─── Errors ──────────────────────────────────────────────────────────────────

/**
 * Expected adjustment failures. `SESSION_ALREADY_COMPLETED`,
 * `EXERCISE_LOG_NOT_FOUND` and `EXERCISE_HAS_LOGGED_SETS` mirror the shapes
 * used by the entity mutations and the substitution service; the no-change
 * and move-boundary codes are unique to this service.
 */
export type SessionAdjustmentError =
  | { readonly code: 'SESSION_ALREADY_COMPLETED'; readonly message: string }
  | { readonly code: 'EXERCISE_LOG_NOT_FOUND'; readonly exerciseOrder: number; readonly message: string }
  | { readonly code: 'EXERCISE_HAS_LOGGED_SETS'; readonly exerciseOrder: number; readonly message: string }
  | { readonly code: 'MOVE_OUT_OF_RANGE'; readonly exerciseOrder: number; readonly message: string }
  | { readonly code: 'ADJUSTMENT_NO_CHANGE'; readonly message: string };

// ─── Inputs ──────────────────────────────────────────────────────────────────

export interface SkipSessionExerciseInput {
  /** Identifies the occurrence within its session. */
  readonly exerciseOrder: number;
}

export interface UnskipSessionExerciseInput {
  readonly exerciseOrder: number;
}

/** Which adjacent neighbor an occurrence swaps with. */
export type MoveDirection = 'up' | 'down';

export interface MoveSessionExerciseInput {
  /** Identifies the occurrence within its session. */
  readonly exerciseOrder: number;
  /** Swaps the occurrence with the neighbor above ('up') or below ('down'). */
  readonly direction: MoveDirection;
}

// ─── Guards ─────────────────────────────────────────────────────────────────

/**
 * The shared blocking rule: a completed session and an occurrence with ANY
 * logged set both freeze the skip decision. The mutation guards and the
 * eligibility projection below consume this single definition — nobody
 * re-derives it. When both blocks apply, the completed-session block wins,
 * mirroring the substitution guards' precedence.
 */
function occurrenceAdjustmentBlock(
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
function loadInProgressOccurrence(
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

// ─── Eligibility (read-only projection) ─────────────────────────────────────

/** Why an occurrence's skip decision is currently blocked; null = adjustable. */
export type OccurrenceAdjustmentBlock =
  | 'session-completed'
  | 'logged-sets';

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

// ─── Session Totals & Completion ────────────────────────────────────────────

/**
 * Session-level prescription totals adjusted for skip decisions. The
 * prescribed-set count is the progress denominator: skipped occurrences
 * contribute nothing to it (F5).
 */
export interface SessionPrescriptionTotals {
  /** Prescribed sets across the non-skipped occurrences. */
  readonly prescribedSets: number;
  /** How many authored occurrences are currently skipped. */
  readonly skippedOccurrences: number;
}

export function resolveSessionPrescriptionTotals(
  session: WorkoutSession,
): SessionPrescriptionTotals {
  let prescribedSets = 0;
  let skippedOccurrences = 0;
  for (const log of session.exerciseLogs) {
    if (log.isSkipped) {
      skippedOccurrences += 1;
      continue;
    }
    prescribedSets += log.prescription.sets;
  }
  return { prescribedSets, skippedOccurrences };
}

/**
 * The domain-owned completion gate (F6, unchanged by M10): a session is
 * completable when at least one set is logged somewhere in it.
 * `completeWorkoutSession` delegates to this definition.
 */
export interface SessionCompletionReadiness {
  readonly canComplete: boolean;
}

export function resolveSessionCompletionReadiness(
  session: WorkoutSession,
): SessionCompletionReadiness {
  const hasLoggedSets = session.exerciseLogs.some((log) => log.sets.length > 0);
  return { canComplete: hasLoggedSets };
}
