import { and, eq, isNotNull, sql } from 'drizzle-orm';

import type { RunClosureFactsRepository } from '@/application/ports/run-closure-facts-repository';
import type { RunClosureFacts } from '@/domain/services/run-closure';
import type { EnrollmentId, ScheduledWorkoutId } from '@/domain/types/ids';

import type { Database } from '../client';
import { notPerformedWorkouts, workoutSessions } from '../schema';

/** Discriminator values of the one-row-per-fact projection below. */
const COMPLETED = 'completed';
const NOT_PERFORMED = 'not_performed';

/**
 * Drizzle implementation of the read-only RunClosureFactsRepository port.
 *
 * Read-only by construction: this class contains no insert, update or delete
 * and takes no lock and no transaction. Every mutation of either fact is an
 * enrollment-serialized write owned by the separate M17 write authority.
 *
 * The whole port contract is ONE statement: a single `UNION ALL` of the run's
 * completed occurrences and its recorded not-performed facts, with a
 * discriminator column. Because READ COMMITTED takes one snapshot per
 * statement, both fact sets are guaranteed to describe the same database
 * instant — a concurrent `undo → start → complete` that commits while this
 * statement is in flight can only shift the read to the earlier or the later
 * valid state, never manufacture an authored occurrence that appears in both
 * sets. A pair of independent statements cannot give that guarantee, which is
 * exactly why this projection is a single statement.
 */
export class DrizzleRunClosureFactsRepository implements RunClosureFactsRepository {
  constructor(private readonly db: Database) {}

  async listClosureFactsByEnrollment(enrollmentId: EnrollmentId): Promise<RunClosureFacts> {
    const completedFacts = this.db
      .select({
        scheduledWorkoutId: workoutSessions.scheduledWorkoutId,
        source: sql<string>`'${sql.raw(COMPLETED)}'`.as('source'),
      })
      .from(workoutSessions)
      .where(
        and(
          eq(workoutSessions.enrollmentId, enrollmentId),
          isNotNull(workoutSessions.completedAt),
        ),
      );

    const notPerformedFacts = this.db
      .select({
        scheduledWorkoutId: notPerformedWorkouts.scheduledWorkoutId,
        source: sql<string>`'${sql.raw(NOT_PERFORMED)}'`.as('source'),
      })
      .from(notPerformedWorkouts)
      .where(eq(notPerformedWorkouts.enrollmentId, enrollmentId));

    // Deterministic order: completed facts first, each set ascending by
    // scheduled_workout_id — never implicit database order.
    const rows = await completedFacts
      .unionAll(notPerformedFacts)
      .orderBy(sql`source`, sql`scheduled_workout_id`);

    const completedIds: ScheduledWorkoutId[] = [];
    const notPerformedIds: ScheduledWorkoutId[] = [];
    for (const row of rows) {
      // Trusted DB values: both columns are FKs into scheduled_workouts, so
      // each id is valid by schema constraint (database records are trusted
      // at the repository boundary). No id validation here — the Domain owns
      // contradiction and foreign-id detection.
      if (row.source === COMPLETED) {
        completedIds.push(row.scheduledWorkoutId as ScheduledWorkoutId);
      } else {
        notPerformedIds.push(row.scheduledWorkoutId as ScheduledWorkoutId);
      }
    }

    return { completedIds, notPerformedIds };
  }
}
