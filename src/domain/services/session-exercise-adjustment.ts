/**
 * Domain service: session-scoped occurrence adjustment (M10) — skipping an
 * authored exercise occurrence inside an in-progress session, plus the
 * derived session-level facts that depend on that persisted decision.
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
 * code is unique to this service.
 */
export type SessionAdjustmentError =
  | { readonly code: 'SESSION_ALREADY_COMPLETED'; readonly message: string }
  | { readonly code: 'EXERCISE_LOG_NOT_FOUND'; readonly exerciseOrder: number; readonly message: string }
  | { readonly code: 'EXERCISE_HAS_LOGGED_SETS'; readonly exerciseOrder: number; readonly message: string }
  | { readonly code: 'ADJUSTMENT_NO_CHANGE'; readonly message: string };

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
 * Loads the occurrence and enforces the shared preconditions: the session
 * must be in progress, the occurrence must exist, and it must have zero
 * logged sets (skip is mutually exclusive with performed work).
 */
function loadAdjustableOccurrence(
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

  // The completed case returned above, so a block here is the logged-set rule.
  if (occurrenceAdjustmentBlock(session, log) === 'logged-sets') {
    return err({
      code: 'EXERCISE_HAS_LOGGED_SETS',
      exerciseOrder,
      message: `Exercise order ${exerciseOrder} has logged sets; delete them before skipping it`,
    });
  }

  return ok(log);
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
  return {
    isSkipped: log.isSkipped,
    blockedBy,
    canSkip: !log.isSkipped && blockedBy === null,
    canUnskip: log.isSkipped && blockedBy === null,
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
