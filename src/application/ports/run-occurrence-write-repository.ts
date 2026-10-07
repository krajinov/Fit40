/**
 * Run-occurrence write repository (M17) — the ONE mutation authority for writes
 * that must serialize on the run's enrollment row.
 *
 * Ownership, locked:
 * - this port owns every write that touches the enrollment row's cross-table
 *   facts: recording and undoing a not-performed settlement, and creating the
 *   workout session that starts an occurrence;
 * - `NotPerformedOccurrenceRepository` stays READ ONLY (`listByEnrollment`) and
 *   must never grow a write method — a read model must not be able to change
 *   the fact it reports;
 * - `WorkoutSessionRepository` stays session CONTENT persistence (`save`,
 *   update-only) and has NO insert: `createSessionForOccurrence` here is the
 *   only production way a new `workout_sessions` row is written;
 * - settlement deletion is not added to the session repository.
 *
 * Lock discipline (same strength and order as the M15 planning writes and the
 * M14 lifecycle writes): every call opens ONE transaction, locks the parent
 * enrollment row with `SELECT id … FOR NO KEY UPDATE` FIRST, and only then reads
 * and writes anything else. No session or fact row is read before that lock. The
 * enrollment row is the serialization point for cross-table run facts; the
 * session `version` CAS remains the separate mechanism for session CONTENT
 * writes and is never replaced by it.
 *
 * That single serialization point is what makes START and RECORD mutually
 * exclusive (M17 Slice 6): whichever of the two takes the enrollment lock first
 * determines the final state, and the loser observes the winner's committed
 * fact — a session starts where nothing was recorded as not performed, and a
 * recorded occurrence can never end up with a live session beside it.
 *
 * Decision execution (locked): the pure Domain decision
 * (`decideRecordNotPerformed` / `decideUndoNotPerformed`) is evaluated inside
 * the transaction, exactly once, AFTER the lock and AFTER the facts have been
 * read under it. Infrastructure gathers locked facts and executes that decision;
 * it never authorizes a write by its own rule, never re-evaluates the decision,
 * and never lets SQL choose a business outcome. Session creation is not a
 * Domain decision: the Application has already built and validated the
 * aggregate, and this port only coordinates its persistence with the locked
 * fact.
 *
 * Contract:
 * - a refusal writes NOTHING — no fact, no session, no child rows;
 * - the guarded session DELETE and the fact INSERT keep their predicates as
 *   safety assertions, not as policy: if the decision authorized a write and the
 *   database reports zero affected rows anyway, the transaction is rolled back
 *   and `contract-violation` is returned instead of being translated into a
 *   business outcome;
 * - `contract-violation` is a coordination outcome only because the Application
 *   layer has to observe it: it is thrown as
 *   `NotPerformedWriteContractViolationError` and is never mapped into a
 *   business Result;
 * - the not-performed primary key is the I1 backstop: a conflicting insert is
 *   classified by a bounded read (never by re-running the decision) and reported
 *   as `already-recorded`, with the transaction rolled back so no authorized
 *   deletion survives without its fact;
 * - the caller supplies `recordedAt` (the attestation instant). The repository
 *   persists exactly that instant — it never reads a clock, never derives the
 *   instant from a planned date or a session, and adds no other timestamp;
 * - session creation checks the fact EXPLICITLY after the lock. A duplicate
 *   session, a child occurrence-key conflict or a vanished enrollment keeps its
 *   established typed meaning; no constraint failure is ever translated into the
 *   not-performed outcome.
 */

import type { WorkoutSession } from '@/domain/entities/workout-session';
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

/**
 * Thrown by the Application when this authority reports an impossible invariant
 * breach instead of an outcome: a `contract-violation` (the database refused a
 * write the Domain decision had already authorized, and the transaction was
 * rolled back), or a `run-vanished` result that contradicts the run the caller
 * can still observe.
 *
 * It is deliberately an Error and never a Result: a settlement's caller must not
 * receive a truthful-sounding business outcome for a bug, and the established
 * precedent is the same (`PlannedWorkoutEnrollmentMismatchError` is thrown by
 * the planned-workout repository and never mapped into a business outcome).
 */
export class NotPerformedWriteContractViolationError extends Error {
  constructor(
    /** Which settlement operation observed the breach. */
    readonly operation: 'record' | 'undo',
    /** What was observed, for the log — never rendered to the user. */
    readonly detail: string,
  ) {
    super(`Not-performed ${operation} contract violated: ${detail}`);
    this.name = 'NotPerformedWriteContractViolationError';
  }
}

export interface CreateSessionForOccurrenceInput {
  /**
   * The run the session belongs to: the enrollment row whose lock this call
   * takes, and the enrollment the aggregate must be attached to.
   */
  readonly enrollmentId: EnrollmentId;
  /** The authored occurrence inside that run the session starts. */
  readonly scheduledWorkoutId: ScheduledWorkoutId;
  /**
   * The brand-new, Domain-validated aggregate to persist. The Application
   * builds and validates it (session construction policy is never duplicated in
   * Infrastructure); this call only persists it under the enrollment lock.
   */
  readonly session: WorkoutSession;
}

/**
 * The creation outcome: the persisted aggregate, or one of the two
 * coordination outcomes that are not business rules.
 *
 * A duplicate session for the occurrence, a child occurrence-key conflict and a
 * vanished enrollment keep their ESTABLISHED typed meanings
 * (`SessionAlreadyExistsError`, `SessionOccurrenceKeyConflictError`,
 * `SessionEnrollmentNotFoundError`) — they are thrown, never folded into
 * `recorded-not-performed`, so a constraint failure can never masquerade as a
 * settlement fact.
 */
export type CreateSessionForOccurrenceOutcome =
  /** The session was inserted; the aggregate carries the committed version. */
  | { readonly kind: 'created'; readonly session: WorkoutSession }
  /**
   * The occurrence carries a not-performed fact: starting it would manufacture
   * a live session beside a settlement. Nothing was written.
   */
  | { readonly kind: 'recorded-not-performed' }
  /** The enrollment no longer exists: a concurrent leave or restart won. */
  | { readonly kind: 'run-vanished' };

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

  /**
   * Creates the workout session that starts an occurrence, in the SAME
   * parent-first transaction discipline as the settlement writes.
   *
   * Statement order (locked):
   * 1. `SELECT id … FOR NO KEY UPDATE` on the expected enrollment row;
   * 2. if it does not exist, return `run-vanished` with zero writes;
   * 3. under that lock, check whether a `not_performed_workouts` fact exists for
   *    `(enrollmentId, scheduledWorkoutId)`;
   * 4. if the fact exists, return `recorded-not-performed` with ZERO writes;
   * 5. otherwise INSERT the session row and its child rows.
   *
   * Nothing is read before the lock, nothing is written before the fact check,
   * and the fact check is an explicit read — never a constraint failure
   * translated after the fact.
   */
  createSessionForOccurrence(
    input: CreateSessionForOccurrenceInput,
  ): Promise<CreateSessionForOccurrenceOutcome>;
}