import { and, asc, eq } from 'drizzle-orm';

import type {
  FencedOccurrenceExecutionFacts,
  OccurrenceExecutionFacts,
  OccurrenceExecutionFactsRepository,
} from '@/application/ports/occurrence-execution-facts-repository';
import type { WorkoutSession } from '@/domain/entities/workout-session';
import type { EnrollmentId, ProgramId, ScheduledWorkoutId, UserId } from '@/domain/types/ids';

import type { Database } from '../client';
import { mapSessionRows } from '../mappers/session-mapper';
import { exerciseLogs, notPerformedWorkouts, programEnrollments, setLogs, workoutSessions } from '../schema';
import type { Transaction } from './workout-session-writes';

/**
 * Drizzle implementation of the read-only OccurrenceExecutionFactsRepository
 * port.
 *
 * Read-only by construction: this class contains no insert, update or delete
 * and takes no lock — the enrollment write lock belongs to the separate M17
 * write authority and a read model never serializes behind it.
 *
 * The whole port contract is ONE snapshot. The session aggregate spans
 * several rows (session, exercise logs, set logs), so a single statement
 * cannot hydrate it; the coherent read is therefore ONE bounded, read-only
 * REPEATABLE READ transaction containing the session hydration and the
 * settlement-existence check. REPEATABLE READ fixes the snapshot at the
 * transaction's first statement, so a `recordNotPerformed` transition (delete
 * abandoned session + insert fact) that commits mid-read can only be observed
 * whole before or whole after — never the old session beside the new fact.
 * It is deliberately not SERIALIZABLE: a stable multi-statement snapshot is
 * all a read-only projection needs.
 */
export class DrizzleOccurrenceExecutionFactsRepository implements OccurrenceExecutionFactsRepository {
  constructor(private readonly db: Database) {}

  async findOccurrenceExecutionFacts(
    enrollmentId: EnrollmentId,
    scheduledWorkoutId: ScheduledWorkoutId,
  ): Promise<OccurrenceExecutionFacts> {
    return this.db.transaction(
      async (tx) => this.readFactsInTransaction(tx, enrollmentId, scheduledWorkoutId),
      { isolationLevel: 'repeatable read', accessMode: 'read only' },
    );
  }

  /**
   * The occurrence's session aggregate and settlement existence inside ONE
   * transaction's snapshot, shared by the enrollment-scoped and the fenced
   * reads so both hydrate and map identically.
   */
  private async readFactsInTransaction(
    tx: Transaction,
    enrollmentId: EnrollmentId,
    scheduledWorkoutId: ScheduledWorkoutId,
  ): Promise<OccurrenceExecutionFacts> {
    const sessionRows = await tx
      .select()
      .from(workoutSessions)
      .where(
        and(
          eq(workoutSessions.enrollmentId, enrollmentId),
          eq(workoutSessions.scheduledWorkoutId, scheduledWorkoutId),
        ),
      )
      .limit(1);

    const sessionRow = sessionRows[0];
    const session =
      sessionRow === undefined
        ? null
        : await this.hydrate(tx, sessionRow.id, sessionRow);

    const factRows = await tx
      .select({ scheduledWorkoutId: notPerformedWorkouts.scheduledWorkoutId })
      .from(notPerformedWorkouts)
      .where(
        and(
          eq(notPerformedWorkouts.enrollmentId, enrollmentId),
          eq(notPerformedWorkouts.scheduledWorkoutId, scheduledWorkoutId),
        ),
      )
      .limit(1);

    return { session, notPerformedRecorded: factRows.length > 0 };
  }

  /**
   * The FENCED variant: identity and occurrence facts from ONE snapshot.
   *
   * The same bounded read-only REPEATABLE READ transaction as the unfenced
   * read, with the expected-enrollment check as the FIRST statement: because
   * the snapshot is fixed at the transaction's first statement, the check and
   * the facts describe the same instant - a restart/leave committing while
   * this read runs yields either the old coherent state (matched with the old
   * run's occurrence truth) or not matched, never the replacement run's
   * not-started state. No lock, no write, and no SERIALIZABLE (REPEATABLE READ
   * is the project's read-model ceiling, never a stricter level).
   */
  async findFencedOccurrenceExecutionFacts(
    expectedEnrollmentId: EnrollmentId,
    scheduledWorkoutId: ScheduledWorkoutId,
    userId: UserId,
    programId: ProgramId,
  ): Promise<FencedOccurrenceExecutionFacts> {
    return this.db.transaction(
      async (tx) => {
        // Statement 1: the expected enrollment is THIS user's run of THIS
        // program. This statement fixes the snapshot for the whole read.
        const enrollmentRows = await tx
          .select({ id: programEnrollments.id })
          .from(programEnrollments)
          .where(
            and(
              eq(programEnrollments.id, expectedEnrollmentId),
              eq(programEnrollments.userId, userId),
              eq(programEnrollments.programId, programId),
            ),
          )
          .limit(1);

        if (enrollmentRows.length === 0) {
          return { matched: false as const };
        }

        const facts = await this.readFactsInTransaction(tx, expectedEnrollmentId, scheduledWorkoutId);
        return { matched: true as const, facts };
      },
      { isolationLevel: 'repeatable read', accessMode: 'read only' },
    );
  }

  /**
   * The same Q2/Q3 child hydration the session repository's private `hydrate`
   * performs, run inside this read's transaction so the whole aggregate comes
   * from the same snapshot. `mapSessionRows` stays the single shared
   * aggregate mapper, so every session invariant is enforced exactly as in
   * every other read path.
   */
  private async hydrate(
    tx: Transaction,
    sessionId: string,
    sessionRow: typeof workoutSessions.$inferSelect,
  ): Promise<WorkoutSession> {
    const logRows = await tx
      .select()
      .from(exerciseLogs)
      .where(eq(exerciseLogs.sessionId, sessionId))
      .orderBy(asc(exerciseLogs.exerciseOrder));
    const setRows = await tx
      .select()
      .from(setLogs)
      .where(eq(setLogs.sessionId, sessionId))
      .orderBy(asc(setLogs.exerciseOrder), asc(setLogs.setNumber));

    return mapSessionRows({
      session: sessionRow,
      exerciseLogs: logRows,
      setLogs: setRows,
    });
  }
}