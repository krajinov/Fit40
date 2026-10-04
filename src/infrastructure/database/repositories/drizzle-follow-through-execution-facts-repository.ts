import { and, eq, exists, isNotNull, isNull, sql } from 'drizzle-orm';

import type {
  FencedFollowThroughExecutionFacts,
  FollowThroughExecutionFacts,
  FollowThroughExecutionFactsRepository,
} from '@/application/ports/follow-through-execution-facts-repository';
import type { CompletedOccurrenceActivity } from '@/application/ports/workout-session-repository';
import type { NotPerformedOccurrence } from '@/domain/entities/not-performed-occurrence';
import type { EnrollmentId, ProgramId, ScheduledWorkoutId, UserId } from '@/domain/types/ids';

import type { Database } from '../client';
import { mapRowToNotPerformedOccurrence } from '../mappers/not-performed-occurrence-mapper';
import { notPerformedWorkouts, programEnrollments, workoutSessions } from '../schema';

/** Discriminator values of the one-row-per-fact projection below. */
const MATCHED = 'matched';
const COMPLETED = 'completed';
const IN_PROGRESS = 'in_progress';
const NOT_PERFORMED = 'not_performed';

/**
 * Drizzle implementation of the read-only FollowThroughExecutionFactsRepository
 * port.
 *
 * Read-only by construction: this class contains no insert, update or delete
 * and takes no lock and no transaction. Every mutation of either fact is an
 * enrollment-serialized write owned by the separate M17 write authority.
 *
 * The whole port contract is ONE statement: a single `UNION ALL` of the run's
 * completed occurrences (with their completion instants), its in-progress
 * occurrences and its recorded not-performed facts, with a discriminator
 * column. Because READ COMMITTED takes one snapshot per statement, all three
 * sets describe the same database instant — an `Undo → start → complete`
 * transition that commits while this statement is in flight can only shift
 * the read to the earlier or the later valid state, never hand the Domain
 * BOTH the recorded fact and the completed session for one occurrence. A pair
 * of independent statements cannot give that guarantee, which is exactly why
 * this projection is a single statement.
 *
 * `to_char` rather than the raw timestamp columns: a UNION's output columns
 * are not schema column references, so the postgres-js driver hands back the
 * server's text instead of parsed Dates (the `factInstants` convention);
 * normalizing to ISO 8601 keeps the decodes exact and unambiguous.
 */
export class DrizzleFollowThroughExecutionFactsRepository
  implements FollowThroughExecutionFactsRepository
{
  constructor(private readonly db: Database) {}

  async listFollowThroughExecutionFactsByEnrollment(
    enrollmentId: EnrollmentId,
  ): Promise<FollowThroughExecutionFacts> {
    const { completedFacts, inProgressFacts, notPerformedFacts } = this.factBranches(
      enrollmentId,
      undefined,
    );

    // Deterministic order: completed, in-progress, then not-performed, each
    // set ascending by scheduled_workout_id — never implicit database order.
    const rows = await completedFacts
      .unionAll(inProgressFacts)
      .unionAll(notPerformedFacts)
      .orderBy(sql`source`, sql`scheduled_workout_id`);

    return mapFollowThroughFactRows(enrollmentId, rows);
  }

  /**
   * The FENCED projection (the `findFencedClosureFactsByEnrollment` shape):
   * identity and facts from ONE statement.
   *
   * Four branches in a single `UNION ALL`, every one of them gated by the SAME
   * predicate over `program_enrollments` (the expected id AND the trusted
   * `user_id` / `program_id`): a `matched` anchor row plus the three fact
   * branches. Because READ COMMITTED takes ONE snapshot per statement, the
   * anchor and the facts describe the same instant: a restart/leave committing
   * while this statement runs shifts the whole answer to before (matched, the
   * old run's facts) or after (not matched) — never a validated-but-vanished
   * enrollment whose empty facts a composed parent would misread as a fresh
   * run beside old-generation data.
   */
  async findFencedFollowThroughExecutionFactsByEnrollment(
    expectedEnrollmentId: EnrollmentId,
    userId: UserId,
    programId: ProgramId,
  ): Promise<FencedFollowThroughExecutionFacts> {
    // The one predicate every branch shares: the expected enrollment is THIS
    // user's run of THIS program. Evaluated in the same snapshot as the facts.
    const expectedRunExists = exists(
      this.db
        .select({ one: sql`1` })
        .from(programEnrollments)
        .where(
          and(
            eq(programEnrollments.id, expectedEnrollmentId),
            eq(programEnrollments.userId, userId),
            eq(programEnrollments.programId, programId),
          ),
        ),
    );

    const anchor = this.db
      .select({
        scheduledWorkoutId: sql<string | null>`null::text`.as('scheduled_workout_id'),
        source: sql<string>`'${sql.raw(MATCHED)}'`.as('source'),
        at: sql<string | null>`null::text`.as('at'),
      })
      .from(programEnrollments)
      .where(
        and(
          eq(programEnrollments.id, expectedEnrollmentId),
          eq(programEnrollments.userId, userId),
          eq(programEnrollments.programId, programId),
        ),
      );

    const { completedFacts, inProgressFacts, notPerformedFacts } = this.factBranches(
      expectedEnrollmentId,
      expectedRunExists,
    );

    // ONE statement: the anchor first, then the facts in the same deterministic
    // order as the unfenced projection.
    const rows = await anchor
      .unionAll(completedFacts)
      .unionAll(inProgressFacts)
      .unionAll(notPerformedFacts)
      .orderBy(sql`source`, sql`scheduled_workout_id`);

    if (!rows.some((row) => row.source === MATCHED)) {
      return { matched: false };
    }

    return {
      matched: true,
      facts: mapFollowThroughFactRows(expectedEnrollmentId, rows),
    };
  }

  /**
   * The three fact branches of the projection, optionally gated by the fenced
   * anchor predicate so both public reads share ONE branch shape and ONE
   * mapper.
   */
  private factBranches(
    enrollmentId: EnrollmentId,
    expectedRunExists: ReturnType<typeof exists> | undefined,
  ) {
    const completedFacts = this.db
      .select({
        scheduledWorkoutId: workoutSessions.scheduledWorkoutId,
        source: sql<string>`'${sql.raw(COMPLETED)}'`.as('source'),
        at: sql<string | null>`to_char(${workoutSessions.completedAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`.as('at'),
      })
      .from(workoutSessions)
      .where(
        and(
          eq(workoutSessions.enrollmentId, enrollmentId),
          isNotNull(workoutSessions.completedAt),
          expectedRunExists,
        ),
      );

    const inProgressFacts = this.db
      .select({
        scheduledWorkoutId: workoutSessions.scheduledWorkoutId,
        source: sql<string>`'${sql.raw(IN_PROGRESS)}'`.as('source'),
        at: sql<string | null>`null::text`.as('at'),
      })
      .from(workoutSessions)
      .where(
        and(
          eq(workoutSessions.enrollmentId, enrollmentId),
          isNull(workoutSessions.completedAt),
          expectedRunExists,
        ),
      );

    const notPerformedFacts = this.db
      .select({
        scheduledWorkoutId: notPerformedWorkouts.scheduledWorkoutId,
        source: sql<string>`'${sql.raw(NOT_PERFORMED)}'`.as('source'),
        at: sql<string | null>`to_char(${notPerformedWorkouts.recordedAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`.as('at'),
      })
      .from(notPerformedWorkouts)
      .where(
        and(eq(notPerformedWorkouts.enrollmentId, enrollmentId), expectedRunExists),
      );

    return { completedFacts, inProgressFacts, notPerformedFacts };
  }
}

/** One row of the projection, whatever statement produced it. */
interface FollowThroughFactRow {
  readonly scheduledWorkoutId: string | null;
  readonly source: string;
  readonly at: string | null;
}

/** Maps projection rows onto the three fact sets (the shared mapper). */
function mapFollowThroughFactRows(
  enrollmentId: EnrollmentId,
  rows: ReadonlyArray<FollowThroughFactRow>,
): FollowThroughExecutionFacts {
  const completedActivity: CompletedOccurrenceActivity[] = [];
  const inProgressIds: ScheduledWorkoutId[] = [];
  const facts: NotPerformedOccurrence[] = [];
  for (const row of rows) {
    if (row.source === COMPLETED) {
      // Trusted DB values: the column is a FK into scheduled_workouts, and
      // completed_at is NOT NULL behind the completed-only filter, so a null
      // surviving on a dated row is corrupt data — thrown, never normalized.
      if (row.at === null) {
        throw new Error(
          `Corrupt data in workout_sessions (enrollment_id=${enrollmentId}, scheduled_workout_id=${row.scheduledWorkoutId}): completed_at is null despite the completed-only filter`,
        );
      }
      completedActivity.push({
        scheduledWorkoutId: row.scheduledWorkoutId as ScheduledWorkoutId,
        completedAt: new Date(row.at),
      });
    } else if (row.source === IN_PROGRESS) {
      // Trusted DB values: the FK-constrained id plus the null instant of
      // the in-progress branch.
      inProgressIds.push(row.scheduledWorkoutId as ScheduledWorkoutId);
    } else if (row.source === NOT_PERFORMED) {
      // Both columns are NOT NULL on the table, so a null surviving on a fact
      // row is corrupt data — thrown, never normalized.
      if (row.at === null || row.scheduledWorkoutId === null) {
        throw new Error(
          `Corrupt data in not_performed_workouts (enrollment_id=${enrollmentId}, scheduled_workout_id=${row.scheduledWorkoutId}): recorded_at is null`,
        );
      }
      facts.push(
        mapRowToNotPerformedOccurrence({
          enrollmentId,
          scheduledWorkoutId: row.scheduledWorkoutId,
          recordedAt: new Date(row.at),
        }),
      );
    }
  }

  return { completedActivity, inProgressIds, notPerformedFacts: facts };
}
