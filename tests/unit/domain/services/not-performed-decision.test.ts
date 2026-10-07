/**
 * M17 Slice 5 — the not-performed settlement decision contract.
 *
 * The full truth table of the ONE business-rule evaluator for recording, plus
 * undo. The rule is pure: every case is a plain value in and a plain decision
 * out, with no database, no clock and no framework involved.
 */

import { describe, expect, it } from 'vitest';

import {
  decideRecordNotPerformed,
  decideUndoNotPerformed,
  OccurrenceSessionState,
  RecordNotPerformedRefusal,
  UndoNotPerformedRefusal,
  type RecordOccurrenceFacts,
} from '@/domain/services/not-performed-decision';

function facts(
  session: OccurrenceSessionState,
  hasNotPerformedRecord: boolean,
): RecordOccurrenceFacts {
  return { session, hasNotPerformedRecord };
}

describe('decideRecordNotPerformed', () => {
  it('records an occurrence with no session and no fact, deleting nothing', () => {
    expect(decideRecordNotPerformed(facts(OccurrenceSessionState.Absent, false))).toEqual({
      kind: 'record',
      deletesAbandonedSession: false,
    });
  });

  it('records and deletes the abandoned in-progress session with zero logged work', () => {
    expect(
      decideRecordNotPerformed(facts(OccurrenceSessionState.InProgressWithoutWork, false)),
    ).toEqual({ kind: 'record', deletesAbandonedSession: true });
  });

  it('refuses a completed occurrence as already performed', () => {
    expect(decideRecordNotPerformed(facts(OccurrenceSessionState.Completed, false))).toEqual({
      kind: 'refuse',
      reason: RecordNotPerformedRefusal.AlreadyPerformed,
    });
    expect(decideRecordNotPerformed(facts(OccurrenceSessionState.Completed, true))).toEqual({
      kind: 'refuse',
      reason: RecordNotPerformedRefusal.AlreadyPerformed,
    });
  });

  it('refuses an in-progress session that holds logged work', () => {
    expect(
      decideRecordNotPerformed(facts(OccurrenceSessionState.InProgressWithWork, false)),
    ).toEqual({ kind: 'refuse', reason: RecordNotPerformedRefusal.HasLoggedWork });
    expect(
      decideRecordNotPerformed(facts(OccurrenceSessionState.InProgressWithWork, true)),
    ).toEqual({ kind: 'refuse', reason: RecordNotPerformedRefusal.HasLoggedWork });
  });

  it('refuses an occurrence that already carries a fact', () => {
    expect(decideRecordNotPerformed(facts(OccurrenceSessionState.Absent, true))).toEqual({
      kind: 'refuse',
      reason: RecordNotPerformedRefusal.AlreadyRecorded,
    });
    expect(
      decideRecordNotPerformed(facts(OccurrenceSessionState.InProgressWithoutWork, true)),
    ).toEqual({ kind: 'refuse', reason: RecordNotPerformedRefusal.AlreadyRecorded });
  });

  it('deletes an abandoned session ONLY for the zero-work in-progress state', () => {
    const deleting = Object.values(OccurrenceSessionState).filter((session) => {
      const decision = decideRecordNotPerformed(facts(session, false));
      return decision.kind === 'record' && decision.deletesAbandonedSession;
    });

    expect(deleting).toEqual([OccurrenceSessionState.InProgressWithoutWork]);
  });

  it('evaluates the locked precedence: completed, then logged work, then already recorded', () => {
    // A completed session outranks a logged-work session (unreachable together)
    // and both outrank an existing fact, so the refusal names the strongest
    // fact rather than the most convenient one.
    expect(decideRecordNotPerformed(facts(OccurrenceSessionState.Completed, true))).toEqual({
      kind: 'refuse',
      reason: RecordNotPerformedRefusal.AlreadyPerformed,
    });
    expect(
      decideRecordNotPerformed(facts(OccurrenceSessionState.InProgressWithWork, true)),
    ).toEqual({ kind: 'refuse', reason: RecordNotPerformedRefusal.HasLoggedWork });
  });

  it('is total and deterministic: every state maps to exactly one decision', () => {
    for (const session of Object.values(OccurrenceSessionState)) {
      for (const recorded of [false, true]) {
        const first = decideRecordNotPerformed(facts(session, recorded));
        const second = decideRecordNotPerformed(facts(session, recorded));

        expect(second).toEqual(first);
        expect(first.kind === 'record' || first.kind === 'refuse').toBe(true);
      }
    }
  });
});

describe('decideUndoNotPerformed', () => {
  it('undoes an existing fact', () => {
    expect(decideUndoNotPerformed({ hasNotPerformedRecord: true })).toEqual({ kind: 'undo' });
  });

  it('refuses an occurrence with no fact instead of reporting a false success', () => {
    expect(decideUndoNotPerformed({ hasNotPerformedRecord: false })).toEqual({
      kind: 'refuse',
      reason: UndoNotPerformedRefusal.NotRecorded,
    });
  });
});