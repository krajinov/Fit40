/**
 * Not-performed settlement decisions (M17).
 *
 * The ONE business-rule evaluator for recording and undoing a run's
 * not-performed execution fact. Pure: no database, no clock, no framework, no
 * Application or Infrastructure import, so the rule can be unit-tested with
 * plain values and can never be re-derived somewhere else.
 *
 * It is called by the transaction-owning Infrastructure module
 * (`DrizzleRunOccurrenceWrites`) AFTER the enrollment row lock and AFTER the
 * authoritative facts have been read under that lock, exactly once per
 * mutation. Infrastructure gathers facts and executes this decision; it never
 * owns the policy, and the SQL it runs can never choose a business outcome.
 *
 * Truth table for recording (locked precedence — the first match wins):
 *
 * | session state                        | fact exists | decision                                     |
 * |--------------------------------------|-------------|----------------------------------------------|
 * | completed                            | either      | refuse `already-performed` (zero writes)     |
 * | in progress, with logged work        | either      | refuse `has-logged-work` (zero writes)       |
 * | anything                             | yes         | refuse `already-recorded` (zero writes)      |
 * | none                                 | no          | record (no session to delete)                |
 * | in progress, zero logged work        | no          | record + delete the abandoned session        |
 *
 * Precedence matters for honesty, not for reachability: under M17's invariants
 * a completed session and a recorded fact (I1) or a session with logged work
 * and a recorded fact (I2) are unreachable through valid writes, and the
 * session states are mutually exclusive by construction.
 *
 * Undo: an existing fact is deleted; nothing else is decided — undo never
 * recreates a deleted zero-set session, never regenerates the calendar and
 * never touches session history.
 */

/**
 * The occurrence's session state inside one run, as the diagnostic read
 * reports it. The four variants are exactly what the settlement rule has to
 * distinguish, so "in progress with zero work" (an abandoned snapshot) can
 * never be confused with "in progress with performed work".
 */
export const OccurrenceSessionState = {
  /** No session exists for the occurrence in this run. */
  Absent: 'absent',
  /**
   * An in-progress session with ZERO logged sets: the user opened it and
   * walked away. Recording the fact deletes it — it holds no work.
   */
  InProgressWithoutWork: 'in-progress-without-work',
  /**
   * An in-progress session with at least one logged set: real performed work,
   * which recording must never destroy.
   */
  InProgressWithWork: 'in-progress-with-work',
  /** A completed session: the occurrence was performed. */
  Completed: 'completed',
} as const;

export type OccurrenceSessionState =
  (typeof OccurrenceSessionState)[keyof typeof OccurrenceSessionState];

/** Why recording a not-performed fact is refused. */
export const RecordNotPerformedRefusal = {
  /** The occurrence already carries a not-performed fact. */
  AlreadyRecorded: 'already-recorded',
  /** A completed session exists for the occurrence. */
  AlreadyPerformed: 'already-performed',
  /** An in-progress session holds at least one logged set. */
  HasLoggedWork: 'has-logged-work',
} as const;

export type RecordNotPerformedRefusal =
  (typeof RecordNotPerformedRefusal)[keyof typeof RecordNotPerformedRefusal];

/** The locked facts one recording decision is evaluated over. */
export interface RecordOccurrenceFacts {
  readonly hasNotPerformedRecord: boolean;
  readonly session: OccurrenceSessionState;
}

/**
 * The recording decision: record (optionally deleting the abandoned zero-work
 * session) or refuse with the reason that matched first.
 */
export type RecordNotPerformedDecision =
  | { readonly kind: 'record'; readonly deletesAbandonedSession: boolean }
  | { readonly kind: 'refuse'; readonly reason: RecordNotPerformedRefusal };

/** Why undoing a not-performed fact is refused. */
export const UndoNotPerformedRefusal = {
  /** The occurrence carries no not-performed fact. */
  NotRecorded: 'not-recorded',
} as const;

export type UndoNotPerformedRefusal =
  (typeof UndoNotPerformedRefusal)[keyof typeof UndoNotPerformedRefusal];

/** The locked facts one undo decision is evaluated over. */
export interface UndoOccurrenceFacts {
  readonly hasNotPerformedRecord: boolean;
}

/** The undo decision: delete the fact, or refuse because there is none. */
export type UndoNotPerformedDecision =
  | { readonly kind: 'undo' }
  | { readonly kind: 'refuse'; readonly reason: UndoNotPerformedRefusal };

/**
 * The authoritative recording rule. Pure and total: every fact combination
 * yields exactly one decision, in the locked precedence.
 */
export function decideRecordNotPerformed(
  facts: RecordOccurrenceFacts,
): RecordNotPerformedDecision {
  if (facts.session === OccurrenceSessionState.Completed) {
    return { kind: 'refuse', reason: RecordNotPerformedRefusal.AlreadyPerformed };
  }
  if (facts.session === OccurrenceSessionState.InProgressWithWork) {
    return { kind: 'refuse', reason: RecordNotPerformedRefusal.HasLoggedWork };
  }
  if (facts.hasNotPerformedRecord) {
    return { kind: 'refuse', reason: RecordNotPerformedRefusal.AlreadyRecorded };
  }
  return {
    kind: 'record',
    deletesAbandonedSession: facts.session === OccurrenceSessionState.InProgressWithoutWork,
  };
}

/**
 * The authoritative undo rule. A recorded fact is deleted; an occurrence with
 * no fact is refused rather than silently treated as success.
 */
export function decideUndoNotPerformed(facts: UndoOccurrenceFacts): UndoNotPerformedDecision {
  if (!facts.hasNotPerformedRecord) {
    return { kind: 'refuse', reason: UndoNotPerformedRefusal.NotRecorded };
  }
  return { kind: 'undo' };
}