/**
 * Domain service: session-scoped exercise COMPOSITION (M11) — explicitly
 * adding an exercise occurrence to an in-progress session, and removing one
 * the user added.
 *
 * Split out by responsibility, mirroring the M10 service split
 * (`session-exercise-skip.ts`, `session-exercise-reorder.ts`) and M9
 * (`session-exercise-substitution.ts`): this module owns the composition
 * invariants (what a session-added occurrence IS, and how the occurrence SET
 * changes), and nothing else.
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
 * REMOVAL SEMANTICS — only what the user added may be removed:
 * - Template-authored occurrences can NEVER be removed; Skip/Unskip stays
 *   their session-level exclusion mechanism (the template is immutable).
 * - A removable occurrence must carry NO logged sets: nothing is ever
 *   silently discarded, so the user deletes them explicitly first.
 * - Removal renumbers the trailing orders densely 1..N and touches NOTHING
 *   else: every surviving occurrence keeps its occurrenceKey, `nextOccurrenceKey`
 *   is never decremented, and the removed key is never reusable.
 * - The REMOVED key disappearing from the aggregate is why the high-water
 *   mark — not `max(occurrenceKey)` — is the only safe key source (see
 *   `addSessionExercise`).
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
 * `SessionAdjustmentError`; `SESSION_ALREADY_COMPLETED`,
 * `EXERCISE_LOG_NOT_FOUND` and `EXERCISE_HAS_LOGGED_SETS` reuse the
 * established codes rather than inventing parallel ones.
 * `EXERCISE_NOT_REMOVABLE` is unique to removal: it means the occurrence was
 * authored by the workout template, which is immutable.
 */
export type SessionCompositionError =
  | { readonly code: 'SESSION_ALREADY_COMPLETED'; readonly message: string }
  | { readonly code: 'EXERCISE_LOG_NOT_FOUND'; readonly exerciseOrder: number; readonly message: string }
  | { readonly code: 'EXERCISE_NOT_REMOVABLE'; readonly exerciseOrder: number; readonly message: string }
  | { readonly code: 'EXERCISE_HAS_LOGGED_SETS'; readonly exerciseOrder: number; readonly message: string };

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

// ─── Removal ─────────────────────────────────────────────────────────────────

/**
 * The removal command's input: the occurrence's business locator only.
 * `occurrenceKey` is deliberately NOT an input — occurrence identity is
 * `(sessionId, exerciseOrder)`, and the presentation-stability token is never
 * an address for anything.
 */
export interface RemoveSessionExerciseInput {
  /** Identifies the occurrence within its session. */
  readonly exerciseOrder: number;
}

/** Why an occurrence's removal is currently blocked; null = removable. */
export type OccurrenceRemovalBlock =
  | 'session-completed'
  | 'template-authored'
  | 'logged-sets';

/** Derived removal eligibility of one occurrence. Never persisted. */
export interface OccurrenceRemovalEligibility {
  /** True only for an in-progress, zero-set, user-added occurrence. */
  readonly canRemove: boolean;
  /** Null when the occurrence is currently removable. */
  readonly blockedBy: OccurrenceRemovalBlock | null;
}

/**
 * The single canonical removal blocking rule, consumed by BOTH the mutation
 * and the eligibility projection below — nobody re-derives it. Precedence:
 * session-completed > template-authored > logged-sets (the most fundamental
 * reason wins, mirroring the substitution/adjustment guards).
 */
function occurrenceRemovalBlock(
  session: WorkoutSession,
  log: ExerciseLog,
): OccurrenceRemovalBlock | null {
  if (session.completedAt !== null) return 'session-completed';
  // Provenance is the persisted fact, never inferred: a template-authored
  // occurrence is removed only through Skip/Unskip, so it is checked BEFORE
  // the logged-set rule (which it would otherwise also satisfy).
  if (log.source !== OccurrenceSource.UserAdded) return 'template-authored';
  if (log.sets.length > 0) return 'logged-sets';
  return null;
}

/**
 * Derives whether one occurrence may currently be removed — the same rules
 * the mutation enforces, exposed as a projection. Persistence, application
 * DTOs and presentation consume this; nobody re-derives removability from
 * `source` or raw set counts.
 */
export function resolveOccurrenceRemovalEligibility(
  session: WorkoutSession,
  log: ExerciseLog,
): OccurrenceRemovalEligibility {
  const blockedBy = occurrenceRemovalBlock(session, log);
  return { canRemove: blockedBy === null, blockedBy };
}

/**
 * Removes one USER-ADDED occurrence from an in-progress session.
 *
 * Guards run in the locked order: completed session → unknown occurrence →
 * provenance → logged sets. A skipped or substituted user-added occurrence
 * needs no unskip/restore first: removal discards the whole occurrence and
 * relabels nothing, so provenance alone gates it.
 *
 * The returned aggregate is canonical and dense: the trailing occurrences are
 * renumbered 1..N with their array position agreeing with their order, while
 * every surviving occurrence keeps its identity token (`occurrenceKey`),
 * provenance, prescription, rest, skip decision and logged sets. The high-water
 * mark is NOT touched, so the removed key can never be handed out again.
 *
 * At least one occurrence always survives: a session starts with at least one
 * TEMPLATE-occurrence (the aggregate factory rejects zero logs) and template
 * occurrences are never removable, so this can never yield an empty
 * occurrence list.
 */
export function removeSessionExercise(
  session: WorkoutSession,
  input: RemoveSessionExerciseInput,
): Result<WorkoutSession, SessionCompositionError> {
  if (session.completedAt !== null) {
    return err({ code: 'SESSION_ALREADY_COMPLETED', message: 'Cannot modify a completed session' });
  }

  const log = session.exerciseLogs.find((e) => e.order === input.exerciseOrder);
  if (log === undefined) {
    return err({
      code: 'EXERCISE_LOG_NOT_FOUND',
      exerciseOrder: input.exerciseOrder,
      message: `Exercise log with order ${input.exerciseOrder} not found in session`,
    });
  }

  const block = occurrenceRemovalBlock(session, log);
  // The completed case returned above, so a block here is provenance or sets.
  if (block === 'template-authored') {
    return err({
      code: 'EXERCISE_NOT_REMOVABLE',
      exerciseOrder: input.exerciseOrder,
      message: `Exercise order ${input.exerciseOrder} was authored by the workout template; only exercises you added can be removed`,
    });
  }
  if (block === 'logged-sets') {
    return err({
      code: 'EXERCISE_HAS_LOGGED_SETS',
      exerciseOrder: input.exerciseOrder,
      message: `Exercise order ${input.exerciseOrder} has logged sets; delete them before removing it`,
    });
  }

  // Drop the occurrence, then renumber the survivors densely in canonical
  // order. `.filter()` already returns a fresh array, so sorting it can never
  // mutate the source aggregate; an already-correct order keeps its object
  // identity, and everything else about each survivor rides along untouched.
  const exerciseLogs = session.exerciseLogs
    .filter((e) => e.order !== input.exerciseOrder)
    .sort((a, b) => a.order - b.order)
    .map((e, index) => (e.order === index + 1 ? e : { ...e, order: index + 1 }));

  return ok({ ...session, exerciseLogs });
}
