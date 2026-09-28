import { and, eq, isNull, sql } from 'drizzle-orm';

import type {
  RecordNotPerformedInput,
  RecordNotPerformedOutcome,
  RunOccurrenceWriteRepository,
  UndoNotPerformedInput,
  UndoNotPerformedOutcome,
} from '@/application/ports/run-occurrence-write-repository';
import {
  decideRecordNotPerformed,
  decideUndoNotPerformed,
  OccurrenceSessionState,
  RecordNotPerformedRefusal,
  type RecordOccurrenceFacts,
} from '@/domain/services/not-performed-decision';

import type { Database } from '../client';
import { notPerformedWorkouts, programEnrollments, setLogs, workoutSessions } from '../schema';

/**
 * Internal control-flow signal: the Domain decision authorized a write, the
 * enrollment lock was held, and PostgreSQL still reported zero affected rows.
 * That is an invariant breach, not a business outcome — throwing rolls the
 * transaction back and the caller sees `contract-violation`.
 */
class RunOccurrenceWriteContractViolationError extends Error {
  constructor(
    readonly occurrenceLabel: string,
    readonly statement: string,
  ) {
    super(
      `Run occurrence write contract violated: ${statement} affected no rows for ${occurrenceLabel}`,
    );
    this.name = 'RunOccurrenceWriteContractViolationError';
  }
}

/**
 * Internal control-flow signal: the I1 primary key backstop rejected the
 * insert because a fact already exists. Throwing (rather than committing)
 * ensures an authorized abandoned-session deletion never survives without the
 * fact it was authorized for; the caller sees the locked `already-recorded`
 * refusal.
 */
class NotPerformedAlreadyRecordedError extends Error {
  constructor(readonly occurrenceLabel: string) {
    super(`not_performed_workouts already holds ${occurrenceLabel}`);
    this.name = 'NotPerformedAlreadyRecordedError';
  }
}

/** The locked facts plus the session row the diagnostic saw (internal). */
interface LockedSettlementFacts {
  readonly facts: RecordOccurrenceFacts;
  /** The session row's id, or null when the occurrence has no session. */
  readonly sessionId: string | null;
}

/** The transaction handle `db.transaction` hands to its callback. */
type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

/**
 * Drizzle implementation of the RunOccurrenceWriteRepository port: the single
 * mutation authority for enrollment-serialized run-occurrence writes.
 *
 * Every call is ONE transaction that locks the parent enrollment row with
 * `FOR NO KEY UPDATE` FIRST (the M15/M14 convention: same strength, same order,
 * so no lock cycle is possible), then gathers the authoritative facts under that
 * lock, evaluates the pure Domain decision exactly once, and only then writes.
 * Nothing is read or written before the lock, no write happens before the
 * decision, and the decision is never re-evaluated.
 *
 * The SQL predicates on the guarded DELETE and INSERT are SAFETY assertions, not
 * policy: they can only confirm what the decision already authorized, and a
 * mismatch aborts the transaction instead of being converted into a business
 * outcome.
 */
export class DrizzleRunOccurrenceWrites implements RunOccurrenceWriteRepository {
  constructor(private readonly db: Database) {}

  async recordNotPerformed(input: RecordNotPerformedInput): Promise<RecordNotPerformedOutcome> {
    const label = `${input.enrollmentId}/${input.scheduledWorkoutId}`;

    try {
      return await this.db.transaction(async (tx) => {
        // 1. Parent-first lock: the enrollment row serializes every settlement
        //    and planning write for this run.
        const locked = await tx
          .select({ id: programEnrollments.id })
          .from(programEnrollments)
          .where(eq(programEnrollments.id, input.enrollmentId))
          .for('no key update');

        if (locked.length === 0) {
          // A concurrent leave/restart removed the run: nothing to record on.
          return { kind: 'run-vanished' };
        }

        // 2. Authoritative facts, ONE bounded statement, under the lock.
        const lockedFacts = await readSettlementFacts(tx, input);

        // 3. THE decision — exactly once, over the locked facts. Infrastructure
        //    never authors this policy and SQL never chooses its outcome.
        const decision = decideRecordNotPerformed(lockedFacts.facts);
        if (decision.kind === 'refuse') {
          return decision;
        }

        // 4. Guarded deletion of the abandoned zero-work session, only when the
        //    decision authorized it. The predicate re-states the safety
        //    conditions; it cannot select an outcome.
        if (decision.deletesAbandonedSession) {
          const sessionId = lockedFacts.sessionId;
          if (sessionId === null) {
            // Unreachable: the decision only authorizes deletion for an
            // in-progress session, which the diagnostic saw.
            throw new RunOccurrenceWriteContractViolationError(
              label,
              'the guarded session DELETE (no session row)',
            );
          }

          const deleted = await tx
            .delete(workoutSessions)
            .where(
              and(
                eq(workoutSessions.id, sessionId),
                eq(workoutSessions.enrollmentId, input.enrollmentId),
                eq(workoutSessions.scheduledWorkoutId, input.scheduledWorkoutId),
                isNull(workoutSessions.completedAt),
                sql`not exists (select 1 from ${setLogs} where ${setLogs.sessionId} = ${workoutSessions.id})`,
              ),
            )
            .returning({ id: workoutSessions.id });

          if (deleted.length === 0) {
            throw new RunOccurrenceWriteContractViolationError(label, 'the guarded session DELETE');
          }
        }

        // 5. Insert the fact. The composite primary key is the I1 backstop.
        const inserted = await tx
          .insert(notPerformedWorkouts)
          .values({
            enrollmentId: input.enrollmentId,
            scheduledWorkoutId: input.scheduledWorkoutId,
            // The attestation instant, exactly as supplied — never a clock
            // read, never derived from a planned date or a session.
            recordedAt: input.recordedAt,
          })
          .onConflictDoNothing()
          .returning({ enrollmentId: notPerformedWorkouts.enrollmentId });

        if (inserted.length === 0) {
          // Backstop classification (the only situation in which a second read
          // is issued): does a fact already exist? A conflict WITHOUT one is
          // impossible, so it is a contract violation rather than an outcome.
          const existing = await tx
            .select({ enrollmentId: notPerformedWorkouts.enrollmentId })
            .from(notPerformedWorkouts)
            .where(
              and(
                eq(notPerformedWorkouts.enrollmentId, input.enrollmentId),
                eq(notPerformedWorkouts.scheduledWorkoutId, input.scheduledWorkoutId),
              ),
            )
            .limit(1);

          if (existing.length > 0) {
            throw new NotPerformedAlreadyRecordedError(label);
          }
          throw new RunOccurrenceWriteContractViolationError(label, 'the fact INSERT');
        }

        return decision;
      });
    } catch (error) {
      if (error instanceof RunOccurrenceWriteContractViolationError) {
        return { kind: 'contract-violation' };
      }
      if (error instanceof NotPerformedAlreadyRecordedError) {
        return { kind: 'refuse', reason: RecordNotPerformedRefusal.AlreadyRecorded };
      }
      throw error;
    }
  }

  async undoNotPerformed(input: UndoNotPerformedInput): Promise<UndoNotPerformedOutcome> {
    const label = `${input.enrollmentId}/${input.scheduledWorkoutId}`;

    try {
      return await this.db.transaction(async (tx) => {
        // Same parent-first discipline as recording: one lock, one read, one
        // decision, and the write it authorizes — nothing else.
        const locked = await tx
          .select({ id: programEnrollments.id })
          .from(programEnrollments)
          .where(eq(programEnrollments.id, input.enrollmentId))
          .for('no key update');

        if (locked.length === 0) {
          return { kind: 'run-vanished' };
        }

        const existing = await tx
          .select({ enrollmentId: notPerformedWorkouts.enrollmentId })
          .from(notPerformedWorkouts)
          .where(
            and(
              eq(notPerformedWorkouts.enrollmentId, input.enrollmentId),
              eq(notPerformedWorkouts.scheduledWorkoutId, input.scheduledWorkoutId),
            ),
          )
          .limit(1);

        // THE decision — exactly once, over the locked facts.
        const decision = decideUndoNotPerformed({ hasNotPerformedRecord: existing.length > 0 });
        if (decision.kind === 'refuse') {
          return decision;
        }

        // Deleting the fact is the whole write: no session is recreated, no
        // calendar row is touched, no history is mutated.
        const deleted = await tx
          .delete(notPerformedWorkouts)
          .where(
            and(
              eq(notPerformedWorkouts.enrollmentId, input.enrollmentId),
              eq(notPerformedWorkouts.scheduledWorkoutId, input.scheduledWorkoutId),
            ),
          )
          .returning({ enrollmentId: notPerformedWorkouts.enrollmentId });

        if (deleted.length === 0) {
          throw new RunOccurrenceWriteContractViolationError(label, 'the fact DELETE');
        }

        return decision;
      });
    } catch (error) {
      if (error instanceof RunOccurrenceWriteContractViolationError) {
        return { kind: 'contract-violation' };
      }
      throw error;
    }
  }
}

/**
 * The authoritative diagnostic read: ONE statement that always returns exactly
 * one row, because it is anchored on the enrollment row the caller already
 * locked. The two LEFT JOINs bring back, together:
 *
 * - whether the not-performed fact exists (the join's enrollment column is null
 *   when it does not), and
 * - the occurrence's session row (null when none exists), with the two facts
 *   the Domain decision needs: whether it is completed, and whether ANY logged
 *   set exists for it.
 *
 * Set rows are the work signal on purpose: `exercise_logs` rows exist for every
 * occurrence of a started session even with zero sets, so they cannot
 * distinguish "opened and abandoned" from "trained".
 */
async function readSettlementFacts(
  tx: Transaction,
  input: RecordNotPerformedInput,
): Promise<LockedSettlementFacts> {
  const rows = await tx
    .select({
      factEnrollmentId: notPerformedWorkouts.enrollmentId,
      sessionId: workoutSessions.id,
      sessionCompletedAt: workoutSessions.completedAt,
      loggedSetCount: sql<number>`(select count(*)::int from ${setLogs} where ${setLogs.sessionId} = ${workoutSessions.id})`,
    })
    .from(programEnrollments)
    .leftJoin(
      notPerformedWorkouts,
      and(
        eq(notPerformedWorkouts.enrollmentId, programEnrollments.id),
        eq(notPerformedWorkouts.scheduledWorkoutId, input.scheduledWorkoutId),
      ),
    )
    .leftJoin(
      workoutSessions,
      and(
        eq(workoutSessions.enrollmentId, programEnrollments.id),
        eq(workoutSessions.scheduledWorkoutId, input.scheduledWorkoutId),
      ),
    )
    .where(eq(programEnrollments.id, input.enrollmentId))
    .limit(1);

  const row = rows[0];
  if (row === undefined) {
    // Unreachable: the enrollment row was locked in this transaction.
    throw new RunOccurrenceWriteContractViolationError(
      `${input.enrollmentId}/${input.scheduledWorkoutId}`,
      'the locked diagnostic read',
    );
  }

  return {
    sessionId: row.sessionId,
    facts: {
      hasNotPerformedRecord: row.factEnrollmentId !== null,
      session: resolveSessionState(row.sessionId, row.sessionCompletedAt, row.loggedSetCount),
    },
  };
}

/**
 * Maps the diagnostic row onto the Domain's session-state vocabulary. This is
 * fact GATHERING — turning persisted state into the values the Domain decision
 * is defined over — and deliberately contains no policy: no branch here decides
 * whether anything may be recorded or deleted.
 */
function resolveSessionState(
  sessionId: string | null,
  completedAt: Date | null,
  loggedSetCount: number,
): OccurrenceSessionState {
  if (sessionId === null) {
    return OccurrenceSessionState.Absent;
  }
  if (completedAt !== null) {
    return OccurrenceSessionState.Completed;
  }
  return loggedSetCount > 0
    ? OccurrenceSessionState.InProgressWithWork
    : OccurrenceSessionState.InProgressWithoutWork;
}