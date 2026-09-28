/**
 * Run-occurrence write repository (M17) — the ONE mutation authority for writes
 * that must serialize on the run's enrollment row.
 *
 * Ownership, locked:
 * - this port owns every write that touches the enrollment row's cross-table
 *   facts: recording and undoing a not-performed settlement;
 * - `NotPerformedOccurrenceRepository` stays READ ONLY (`listByEnrollment`) and
 *   must never grow a write method — a read model must not be able to change
 *   the fact it reports;
 * - `WorkoutSessionRepository` stays session-content persistence (`create` /
 *   `save` only); settlement deletion is not added there.
 *
 * Slice 6 will add `createSessionForOccurrence` to THIS same port, so the
 * guarded session creation shares this one parent-first lock discipline. It does
 * not exist yet.
 *
 * Lock discipline (same strength and order as the M15 planning writes and the
 * M14 lifecycle writes): every call opens ONE transaction, locks the parent
 * enrollment row with `SELECT id … FOR NO KEY UPDATE` FIRST, and only then reads
 * and writes anything else. No session or fact row is read before that lock. The
 * enrollment row is the serialization point for cross-table run facts; the
 * session `version` CAS remains the separate mechanism for session CONTENT
 * writes and is never replaced by it.
 *
 * Decision execution (locked): the pure Domain decision
 * (`decideRecordNotPerformed` / `decideUndoNotPerformed`) is evaluated inside
 * the transaction, exactly once, AFTER the lock and AFTER the facts have been
 * read under it. Infrastructure gathers locked facts and executes that decision;
 * it never authorizes a write by its own rule, never re-evaluates the decision,
 * and never lets SQL choose a business outcome.
 *
 * Contract:
 * - a refusal writes NOTHING — no fact, no session, no child rows;
 * - the guarded session DELETE and the fact INSERT keep their predicates as
 *   safety assertions, not as policy: if the decision authorized a write and the
 *   database reports zero affected rows anyway, the transaction is rolled back
 *   and `contract-violation` is returned instead of being translated into a
 *   business outcome;
 * - the not-performed primary key is the I1 backstop: a conflicting insert is
 *   classified by a bounded read (never by re-running the decision) and reported
 *   as `already-recorded`, with the transaction rolled back so no authorized
 *   deletion survives without its fact;
 * - the caller supplies `recordedAt` (the attestation instant). The repository
 *   persists exactly that instant — it never reads a clock, never derives the
 *   instant from a planned date or a session, and adds no other timestamp.
 */

import {
  type RecordNotPerformedDecision,
  type UndoNotPerformedDecision,
} from '@/domain/services/not-performed-decision';
import type { EnrollmentId, ScheduledWorkoutId } from '@/domain/types/ids';

export interface RecordNotPerformedInput {
  /** The run the fact belongs to. */
  readonly enrollmentId: EnrollmentId;
  /** The authored occurrence inside that run. */
  readonly scheduledWorkoutId: ScheduledWorkoutId;
  /** The attestation instant, supplied by the caller's clock. */
  readonly recordedAt: Date;
}

export interface UndoNotPerformedInput {
  readonly enrollmentId: EnrollmentId;
  readonly scheduledWorkoutId: ScheduledWorkoutId;
}

/**
 * The recording outcome: the Domain decision (record, or a reasoned refusal),
 * plus the two infrastructure coordination outcomes that are not business
 * rules at all.
 */
export type RecordNotPerformedOutcome =
  | RecordNotPerformedDecision
  /** The enrollment no longer exists: a concurrent leave or restart won. */
  | { readonly kind: 'run-vanished' }
  /**
   * The decision authorized a write that the database then refused while the
   * enrollment lock was held: an impossible invariant breach, rolled back.
   */
  | { readonly kind: 'contract-violation' };

/** The undo outcome: the Domain decision, plus the same coordination outcomes. */
export type UndoNotPerformedOutcome =
  | UndoNotPerformedDecision
  | { readonly kind: 'run-vanished' }
  | { readonly kind: 'contract-violation' };

export interface RunOccurrenceWriteRepository {
  /**
   * Records the occurrence as not performed, deleting an abandoned zero-work
   * session when, and only when, the Domain decision authorizes it.
   */
  recordNotPerformed(input: RecordNotPerformedInput): Promise<RecordNotPerformedOutcome>;

  /**
   * Undoes the occurrence's not-performed fact by DELETING it. Undo never
   * recreates a deleted session, never regenerates the calendar, and never
   * touches completed or detached session history.
   */
  undoNotPerformed(input: UndoNotPerformedInput): Promise<UndoNotPerformedOutcome>;
}