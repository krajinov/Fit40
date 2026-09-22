/**
 * Domain service: session-scoped exercise COMPOSITION (M11) — explicitly
 * adding an exercise occurrence to an in-progress session.
 *
 * Split out by responsibility, mirroring the M10 service split
 * (`session-exercise-skip.ts`, `session-exercise-reorder.ts`) and M9
 * (`session-exercise-substitution.ts`): this module owns the composition
 * invariants (what a session-added occurrence IS), and nothing else. Removal
 * arrives in the Remove slice; it belongs to this same module because both
 * mutations change the session's occurrence SET rather than an occurrence's
 * state.
 *
 * PRODUCT SEMANTICS — the user explicitly chooses the exercise:
 * - Add appends exactly one occurrence to the END of the canonical session
 *   order. It never reorders anything: M10's adjacent Move Up/Down is the
 *   only repositioning mechanism.
 * - The authored/performed identities both start as the selected exercise:
 *   a session-added occurrence's "contract" exercise IS the one the user
 *   chose, so substitution/restore keep working without ambiguity.
 * - Provenance is explicit: `source = 'user_added'`. It is never inferred
 *   from order, occurrenceKey, the identities or substitution state.
 * - The occurrence takes the session's persisted monotonic high-water mark
 *   (`nextOccurrenceKey`) as its `occurrenceKey`, and the returned aggregate
 *   advances the mark by exactly one. Existing occurrence keys are never
 *   touched, and a removed key is never reused.
 * - Duplicate exercises are valid: occurrence identity is
 *   `(sessionId, exerciseOrder)`, so the same ExerciseId may appear many
 *   times as distinct occurrences.
 * - The program/workout TEMPLATE is never touched: a session-added occurrence
 *   lives only in the session snapshot.
 *
 * The explicit prescription is supplied by the caller (the application layer
 * builds it from the user's explicit rep/duration choice through the domain
 * prescription factories). This service never invents, infers or converts a
 * prescription, and never fabricates a template rest period.
 */

import {
  OccurrenceSource,
  type ExerciseLog,
  type WorkoutSession,
} from '@/domain/entities/workout-session';
import type { ExerciseId } from '@/domain/types/ids';
import { err, ok, type Result } from '@/domain/types/result';
import type { RepPrescription } from '@/domain/value-objects/rep-prescription';

// ─── Errors ──────────────────────────────────────────────────────────────────

/**
 * Expected composition failures. The service owns this union by
 * responsibility, exactly like `SessionSubstitutionError` and
 * `SessionAdjustmentError`; `SESSION_ALREADY_COMPLETED` reuses the established
 * code rather than inventing a parallel one. Removal adds its own codes here
 * in the Remove slice.
 */
export type SessionCompositionError = {
  readonly code: 'SESSION_ALREADY_COMPLETED';
  readonly message: string;
};

// ─── Inputs ──────────────────────────────────────────────────────────────────

/**
 * The domain facts needed to create one session-added occurrence. Everything
 * else about the occurrence is DERIVED by this service:
 *
 * - `order`           ← current canonical N + 1
 * - `occurrenceKey`   ← session.nextOccurrenceKey
 * - `nextOccurrenceKey` ← previous mark + 1
 * - `source`          ← 'user_added'
 * - `isSkipped`       ← false
 * - `sets`            ← []
 * - `authoredExerciseId` / `performedExerciseId` ← the selected exercise
 *
 * Callers therefore cannot supply an occurrenceKey, an exercise order,
 * provenance, a performed identity or a new high-water mark: those are not
 * inputs to this service at all.
 */
export interface AddSessionExerciseInput {
  /** The exercise the user explicitly selected from the catalog. */
  readonly exerciseId: ExerciseId;
  /**
   * The explicit prescription the user chose. The domain value object is
   * already validated; this service persists it verbatim.
   */
  readonly prescription: RepPrescription;
  /**
   * The occurrence's rest snapshot. A session-added occurrence has no
   * authored/template rest prescription, so the supported caller supplies the
   * explicit product rule's 0. Never negative by the aggregate invariant.
   */
  readonly restSeconds: number;
}

// ─── Add ─────────────────────────────────────────────────────────────────────

/**
 * Appends one user-added occurrence to an in-progress session.
 *
 * The returned aggregate is canonical: the new occurrence lands at order
 * `N + 1` (the array is ordered by `order`, so position agrees with order —
 * the invariant Active Workout and progression consumers rely on), every
 * existing occurrence is untouched, and only `nextOccurrenceKey` advances.
 * Completion freezes the session: a completed session rejects the add.
 */
export function addSessionExercise(
  session: WorkoutSession,
  input: AddSessionExerciseInput,
): Result<WorkoutSession, SessionCompositionError> {
  if (session.completedAt !== null) {
    return err({ code: 'SESSION_ALREADY_COMPLETED', message: 'Cannot modify a completed session' });
  }

  const occurrence: ExerciseLog = {
    // The user's explicit choice is both the occurrence's contract identity
    // (authored) and its performed identity until a substitution changes it.
    authoredExerciseId: input.exerciseId,
    performedExerciseId: input.exerciseId,
    order: session.exerciseLogs.length + 1,
    prescription: input.prescription,
    restSeconds: input.restSeconds,
    isSkipped: false,
    // The monotonic session-local high-water mark: unique by construction and
    // never reused, because the mark only ever advances.
    occurrenceKey: session.nextOccurrenceKey,
    source: OccurrenceSource.UserAdded,
    sets: [],
  };

  // Canonical ordering (position agrees with order). The source aggregate is
  // already canonical, and N + 1 appends, so this is normally a no-op; it
  // keeps the returned aggregate canonical by construction, like the reorder
  // service's post-swap sort.
  const exerciseLogs = [...session.exerciseLogs, occurrence].sort((a, b) => a.order - b.order);

  return ok({
    ...session,
    exerciseLogs,
    nextOccurrenceKey: session.nextOccurrenceKey + 1,
  });
}
