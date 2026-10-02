import { and, eq, isNotNull, isNull, sql } from 'drizzle-orm';

import type {
  ScheduleExecutionFacts,
  ScheduleExecutionFactsRepository,
} from '@/application/ports/schedule-execution-facts-repository';
import type { NotPerformedOccurrence } from '@/domain/entities/not-performed-occurrence';
import type { EnrollmentId, ScheduledWorkoutId } from '@/domain/types/ids';

import type { Database } from '../client';
import { mapRowToNotPerformedOccurrence } from '../mappers/not-performed-occurrence-mapper';
import { notPerformedWorkouts, workoutSessions } from '../schema';

/** Discriminator values of the one-row-per-fact projection below. */
const COMPLETED = 'completed';
const IN_PROGRESS = 'in_progress';
const NOT_PERFORMED = 'not_performed';

/**
 * Drizzle implementation of the read-only ScheduleExecutionFactsRepository
 * port.
 *
 * Read-only by construction: this class contains no insert, update or delete
 * and takes no lock and no transaction. Every mutation of either fact is an
 * enrollment-serialized write owned by the separate M17 write authority.
 *
 * The whole port contract is ONE statement: a single `UNION ALL` of the run's
 * completed occurrences, its in-progress occurrences and its recorded
 * not-performed facts, with a discriminator column. Because READ COMMITTED
 * takes one snapshot per statement, all three sets describe the same database
 * instant — a `recordNotPerformed` transition (delete abandoned session +
 * insert fact) that commits while this statement is in flight can only shift
 * the read to the earlier or the later valid state, never hand
 * `resolvePlannedWorkoutStatus` a stale in-progress session beside the fresh
 * fact. A pair of independent statements cannot give that guarantee, which is
 * exactly why this projection is a single statement.
 */
export class DrizzleScheduleExecutionFactsRepository implements ScheduleExecutionFactsRepository {
  constructor(private readonly db: Database) {}

  async listScheduleExecutionFactsByEnrollment(
    enrollmentId: EnrollmentId,
  ): Promise<ScheduleExecutionFacts> {
    const completedFacts = this.db
      .select({
        scheduledWorkoutId: workoutSessions.scheduledWorkoutId,
        source: sql<string>`'${sql.raw(COMPLETED)}'`.as('source'),
        recordedAt: sql<string | null>`null::text`.as('recorded_at'),
      })
      .from(workoutSessions)
      .where(
        and(
          eq(workoutSessions.enrollmentId, enrollmentId),
          isNotNull(workoutSessions.completedAt),
        ),
      );

    const inProgressFacts = this.db
      .select({
        scheduledWorkoutId: workoutSessions.scheduledWorkoutId,
        source: sql<string>`'${sql.raw(IN_PROGRESS)}'`.as('source'),
        recordedAt: sql<string | null>`null::text`.as('recorded_at'),
      })
      .from(workoutSessions)
      .where(
        and(
          eq(workoutSessions.enrollmentId, enrollmentId),
          isNull(workoutSessions.completedAt),
        ),
      );

    const notPerformedFacts = this.db
      .select({
        scheduledWorkoutId: notPerformedWorkouts.scheduledWorkoutId,
        source: sql<string>`'${sql.raw(NOT_PERFORMED)}'`.as('source'),
        // `to_char` rather than the raw column: the UNION's output column is
        // not a schema column reference, so the postgres-js driver hands back
        // the server's text instead of a parsed Date (the `factInstants`
        // convention). Normalizing to ISO 8601 here keeps the decode below
        // exact and unambiguous.
        recordedAt: sql<string>`to_char(${notPerformedWorkouts.recordedAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`.as('recorded_at'),
      })
      .from(notPerformedWorkouts)
      .where(eq(notPerformedWorkouts.enrollmentId, enrollmentId));

    // Deterministic order: completed, in-progress, then not-performed, each
    // set ascending by scheduled_workout_id — never implicit database order.
    const rows = await completedFacts
      .unionAll(inProgressFacts)
      .unionAll(notPerformedFacts)
      .orderBy(sql`source`, sql`scheduled_workout_id`);

    const completedIds: ScheduledWorkoutId[] = [];
    const inProgressIds: ScheduledWorkoutId[] = [];
    const facts: NotPerformedOccurrence[] = [];
    for (const row of rows) {
      if (row.source === COMPLETED) {
        // Trusted DB values: the column is a FK into scheduled_workouts, so
        // each id is valid by schema constraint (database records are trusted
        // at the repository boundary).
        completedIds.push(row.scheduledWorkoutId as ScheduledWorkoutId);
      } else if (row.source === IN_PROGRESS) {
        inProgressIds.push(row.scheduledWorkoutId as ScheduledWorkoutId);
      } else {
        // Non-null narrowing: recorded_at is NOT NULL on the table, so a null
        // surviving on a fact row is corrupt data — thrown, never normalized.
        if (row.recordedAt === null) {
          throw new Error(
            `Corrupt data in not_performed_workouts (enrollment_id=${enrollmentId}, scheduled_workout_id=${row.scheduledWorkoutId}): recorded_at is null`,
          );
        }
        facts.push(
          mapRowToNotPerformedOccurrence({
            enrollmentId,
            scheduledWorkoutId: row.scheduledWorkoutId,
            recordedAt: new Date(row.recordedAt),
          }),
        );
      }
    }

    return { completedIds, inProgressIds, notPerformedFacts: facts };
  }
}
