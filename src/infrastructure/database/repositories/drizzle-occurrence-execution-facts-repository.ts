import { and, asc, eq } from 'drizzle-orm';

import type {
  OccurrenceExecutionFacts,
  OccurrenceExecutionFactsRepository,
} from '@/application/ports/occurrence-execution-facts-repository';
import type { WorkoutSession } from '@/domain/entities/workout-session';
import type { EnrollmentId, ScheduledWorkoutId } from '@/domain/types/ids';

import type { Database } from '../client';
import { mapSessionRows } from '../mappers/session-mapper';
import { exerciseLogs, notPerformedWorkouts, setLogs, workoutSessions } from '../schema';
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
      async (tx) => {
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