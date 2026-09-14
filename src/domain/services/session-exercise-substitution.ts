/**
 * Domain service: session-scoped exercise substitution.
 *
 * PRODUCT INVARIANT — the authored prescription/rest snapshot remains the
 * session occurrence contract after substitution. Swapping an occurrence's
 * exercise swaps ONLY the performed exercise identity
 * (`ExerciseLog.performedExerciseId`); the authored exercise id, the
 * prescription snapshot and the rest snapshot carry over untouched. M9 never
 * infers or converts prescriptions based on the replacement exercise — the
 * catalog does not model exercise-specific supported prescription schemes,
 * and none are invented here.
 *
 * Lifecycle invariants (deliberately stronger than "block on completed"):
 * - Completed sessions are immutable (SESSION_ALREADY_COMPLETED).
 * - An occurrence with ANY logged set can be neither substituted nor
 *   restored: relabeling existing sets would attach another exercise's
 *   loads to the (new) exercise's history and progression. The user must
 *   explicitly delete the logged sets first — nothing is silently
 *   discarded or relabeled.
 * - A skipped occurrence can be neither substituted nor restored (M10):
 *   the user must unskip it first (EXERCISE_OCCURRENCE_SKIPPED). A valid
 *   skipped occurrence has zero logged sets, so this block never
 *   co-occurs with the logged-set rule.
 * - Restore returns the occurrence to performed-as-authored identity.
 *
 * The same rules are exposed as a read-only eligibility projection
 * (`resolveOccurrenceSubstitutionEligibility`): persistence, application
 * DTOs, and presentation consume it and never re-derive a blocking rule
 * from raw session facts.
 */

import type { ExerciseLog, WorkoutSession } from '@/domain/entities/workout-session';
import type { ExerciseId } from '@/domain/types/ids';
import { err, ok, type Result } from '@/domain/types/result';

// ─── Errors ──────────────────────────────────────────────────────────────────

/**
 * Expected substitution failures. `SESSION_ALREADY_COMPLETED` and
 * `EXERCISE_LOG_NOT_FOUND` mirror the entity mutation error shapes;
 * `EXERCISE_OCCURRENCE_SKIPPED` is shared with the M10 adjustment model;
 * `EXERCISE_HAS_LOGGED_SETS` and `SUBSTITUTION_NO_CHANGE` are unique to
 * this service.
 */
export type SessionSubstitutionError =
  | { readonly code: 'SESSION_ALREADY_COMPLETED'; readonly message: string }
  | { readonly code: 'EXERCISE_LOG_NOT_FOUND'; readonly exerciseOrder: number; readonly message: string }
  | { readonly code: 'EXERCISE_HAS_LOGGED_SETS'; readonly exerciseOrder: number; readonly message: string }
  | { readonly code: 'EXERCISE_OCCURRENCE_SKIPPED'; readonly exerciseOrder: number; readonly message: string }
  | { readonly code: 'SUBSTITUTION_NO_CHANGE'; readonly message: string };

// ─── Inputs & State ──────────────────────────────────────────────────────────

export interface SubstituteSessionExerciseInput {
  /** Identifies the occurrence within its session. */
  readonly exerciseOrder: number;
  /** The exercise that will be performed instead of the current one. */
  readonly replacementExerciseId: ExerciseId;
}

export interface RestoreSessionExerciseInput {
  readonly exerciseOrder: number;
}

/** Derived substitution state of one occurrence. `isSubstituted` is never persisted. */
export interface OccurrenceSubstitutionState {
  readonly authoredExerciseId: ExerciseId;
  readonly performedExerciseId: ExerciseId;
  readonly isSubstituted: boolean;
}

// ─── Guards ─────────────────────────────────────────────────────────────────

/**
 * The shared blocking rule: a completed session and an occurrence with ANY
 * logged set are both immutable for substitution and restore. The mutation
 * guards and the eligibility projection below consume this single
 * definition — nobody re-derives it.
 */
function occurrenceSubstitutionBlock(
  session: WorkoutSession,
  log: ExerciseLog,
): OccurrenceSubstitutionBlock | null {
  if (session.completedAt !== null) return 'session-completed';
  // A valid skipped occurrence has zero logged sets, so the skipped and
  // logged-sets blocks never co-occur; skipped is checked first — the user
  // must unskip before any other occurrence change is meaningful.
  if (log.isSkipped) return 'skipped';
  if (log.sets.length > 0) return 'logged-sets';
  return null;
}

/**
 * Loads the occurrence and enforces the shared preconditions: the session
 * must be in progress, the occurrence must exist, and it must have zero
 * logged sets.
 */
function loadMutableOccurrence(
  session: WorkoutSession,
  exerciseOrder: number,
): Result<ExerciseLog, SessionSubstitutionError> {
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

  const block = occurrenceSubstitutionBlock(session, log);
  // The completed case returned above, so a block here is the logged-set or
  // skipped rule.
  if (block === 'logged-sets') {
    return err({
      code: 'EXERCISE_HAS_LOGGED_SETS',
      exerciseOrder,
      message: `Exercise order ${exerciseOrder} has logged sets; delete them before changing its exercise`,
    });
  }
  if (block === 'skipped') {
    return err({
      code: 'EXERCISE_OCCURRENCE_SKIPPED',
      exerciseOrder,
      message: `Exercise order ${exerciseOrder} is skipped; unskip it before changing its exercise`,
    });
  }

  return ok(log);
}

// ─── Substitution & Restore ──────────────────────────────────────────────────

/**
 * Swaps the performed exercise of one occurrence, keeping the authored
 * identity, prescription snapshot and rest snapshot as the occurrence
 * contract. Sets, the version token and every other occurrence are
 * untouched.
 */
export function substituteSessionExercise(
  session: WorkoutSession,
  input: SubstituteSessionExerciseInput,
): Result<WorkoutSession, SessionSubstitutionError> {
  const log = loadMutableOccurrence(session, input.exerciseOrder);
  if (!log.ok) return log;

  if (input.replacementExerciseId === log.data.performedExerciseId) {
    return err({
      code: 'SUBSTITUTION_NO_CHANGE',
      message: 'The replacement exercise is already the performed exercise of this occurrence',
    });
  }

  const exerciseLogs = session.exerciseLogs.map((e) =>
    e.order === input.exerciseOrder
      ? { ...e, performedExerciseId: input.replacementExerciseId }
      : e,
  );

  return ok({ ...session, exerciseLogs });
}

/**
 * Reverts one occurrence back to its authored exercise
 * (performed := authored). Guards mirror substitution: blocked once any set
 * is logged on the occurrence.
 */
export function restoreSessionExercise(
  session: WorkoutSession,
  input: RestoreSessionExerciseInput,
): Result<WorkoutSession, SessionSubstitutionError> {
  const log = loadMutableOccurrence(session, input.exerciseOrder);
  if (!log.ok) return log;

  if (log.data.performedExerciseId === log.data.authoredExerciseId) {
    return err({
      code: 'SUBSTITUTION_NO_CHANGE',
      message: 'This occurrence is already performed as authored',
    });
  }

  const exerciseLogs = session.exerciseLogs.map((e) =>
    e.order === input.exerciseOrder ? { ...e, performedExerciseId: e.authoredExerciseId } : e,
  );

  return ok({ ...session, exerciseLogs });
}

/**
 * Derives one occurrence's substitution state. The domain owns this
 * definition so persistence and presentation never re-derive it.
 */
export function resolveOccurrenceSubstitutionState(log: ExerciseLog): OccurrenceSubstitutionState {
  return {
    authoredExerciseId: log.authoredExerciseId,
    performedExerciseId: log.performedExerciseId,
    isSubstituted: log.performedExerciseId !== log.authoredExerciseId,
  };
}

// ─── Eligibility (read-only projection) ─────────────────────────────────────

/** Why an occurrence's substitution/restore is currently blocked; null = mutable. */
export type OccurrenceSubstitutionBlock =
  | 'session-completed'
  | 'skipped'
  | 'logged-sets';

/** Derived substitution eligibility of one occurrence. Never persisted. */
export interface OccurrenceSubstitutionEligibility {
  readonly isSubstituted: boolean;
  /** Null when the occurrence is currently mutable. */
  readonly blockedBy: OccurrenceSubstitutionBlock | null;
  /** True only for a currently substituted, mutable occurrence. */
  readonly canRestore: boolean;
}

/**
 * Derives whether one occurrence may currently be substituted or restored —
 * the same rules the mutation guards enforce, exposed as a projection. When
 * both blocks apply, the completed-session block wins, mirroring the guards'
 * `SESSION_ALREADY_COMPLETED` precedence. Persistence, application DTOs, and
 * presentation all consume this; nobody re-derives mutability from raw facts.
 */
export function resolveOccurrenceSubstitutionEligibility(
  session: WorkoutSession,
  log: ExerciseLog,
): OccurrenceSubstitutionEligibility {
  const state = resolveOccurrenceSubstitutionState(log);
  const blockedBy = occurrenceSubstitutionBlock(session, log);
  return {
    isSubstituted: state.isSubstituted,
    blockedBy,
    canRestore: state.isSubstituted && blockedBy === null,
  };
}
