import { and, eq, exists, isNotNull, isNull, sql } from 'drizzle-orm';

import type {
  FencedScheduleExecutionFacts,
  ScheduleExecutionFacts,
  ScheduleExecutionFactsRepository,
} from '@/application/ports/schedule-execution-facts-repository';
import type { NotPerformedOccurrence } from '@/domain/entities/not-performed-occurrence';
import type { PlannedWorkout } from '@/domain/entities/planned-workout';
import type { EnrollmentId, ProgramId, ScheduledWorkoutId, UserId } from '@/domain/types/ids';

import type { Database } from '../client';
import { mapRowToNotPerformedOccurrence } from '../mappers/not-performed-occurrence-mapper';
import { mapRowToPlannedWorkout } from '../mappers/planned-workout-mapper';
import {
  notPerformedWorkouts,
  plannedWorkouts,
  programEnrollments,
  workoutSessions,
} from '../schema';

/** Discriminator values of the one-row-per-fact projection below. */
const MATCHED = 'matched';
const COMPLETED = 'completed';
const IN_PROGRESS = 'in_progress';
const NOT_PERFORMED = 'not_performed';
const PLANNED = 'planned';

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

    return mapScheduleFactRows(enrollmentId, rows);
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
   * enrollment whose empty facts a composed parent would misread as an
   * unconfigured run beside old-generation data.
   */
  async findFencedScheduleExecutionFactsByEnrollment(
    expectedEnrollmentId: EnrollmentId,
    userId: UserId,
    programId: ProgramId,
  ): Promise<FencedScheduleExecutionFacts> {
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
        recordedAt: sql<string | null>`null::text`.as('recorded_at'),
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

    // The planned rows of THAT run, in the SAME statement and gated by the
    // SAME predicate — never a second read whose window a restart/leave could
    // open. `planned_date` is a string-mode DATE column, so the text comes
    // through exactly as the unfenced planned-workout read returns it.
    const plannedBranch = this.db
      .select({
        scheduledWorkoutId: plannedWorkouts.scheduledWorkoutId,
        source: sql<string>`'${sql.raw(PLANNED)}'`.as('source'),
        // `planned_date` is a DATE column, so cast it to text exactly as the
        // string-mode unfenced read decodes it - the UNION's output column is
        // text for every branch.
        recordedAt: sql<string>`to_char(${plannedWorkouts.plannedDate}, 'YYYY-MM-DD')`.as('recorded_at'),
      })
      .from(plannedWorkouts)
      .where(and(eq(plannedWorkouts.enrollmentId, expectedEnrollmentId), expectedRunExists));

    // ONE statement: the anchor first, then the facts and the planned rows,
    // all from ONE snapshot.
    const rows = await anchor
      .unionAll(completedFacts)
      .unionAll(inProgressFacts)
      .unionAll(notPerformedFacts)
      .unionAll(plannedBranch)
      .orderBy(sql`source`, sql`scheduled_workout_id`);

    if (!rows.some((row) => row.source === MATCHED)) {
      return { matched: false };
    }

    // Planned rows mirror `listByEnrollment`'s contract: date asc, then
    // occurrence id — never implicit database order.
    const plannedRows: PlannedWorkout[] = [];
    for (const row of rows) {
      if (row.source !== PLANNED) continue;
      // Non-null narrowing: both columns are NOT NULL on the table, so a null
      // surviving on a planned row is corrupt data — thrown, never normalized.
      if (row.recordedAt === null || row.scheduledWorkoutId === null) {
        throw new Error(
          `Corrupt data in planned_workouts (enrollment_id=${expectedEnrollmentId}, scheduled_workout_id=${row.scheduledWorkoutId}): planned_date is null`,
        );
      }
      plannedRows.push(
        mapRowToPlannedWorkout({
          enrollmentId: expectedEnrollmentId,
          scheduledWorkoutId: row.scheduledWorkoutId,
          plannedDate: row.recordedAt,
        }),
      );
    }
    plannedRows.sort((a, b) =>
      a.plannedDate === b.plannedDate
        ? String(a.scheduledWorkoutId).localeCompare(String(b.scheduledWorkoutId))
        : String(a.plannedDate).localeCompare(String(b.plannedDate)),
    );

    return {
      matched: true,
      plannedRows,
      facts: mapScheduleFactRows(expectedEnrollmentId, rows),
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
        recordedAt: sql<string | null>`null::text`.as('recorded_at'),
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
        recordedAt: sql<string | null>`null::text`.as('recorded_at'),
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
        // `to_char` rather than the raw column: the UNION's output column is
        // not a schema column reference, so the postgres-js driver hands back
        // the server's text instead of a parsed Date (the `factInstants`
        // convention). Normalizing to ISO 8601 here keeps the decode below
        // exact and unambiguous.
        recordedAt: sql<string>`to_char(${notPerformedWorkouts.recordedAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`.as('recorded_at'),
      })
      .from(notPerformedWorkouts)
      .where(
        and(eq(notPerformedWorkouts.enrollmentId, enrollmentId), expectedRunExists),
      );

    return { completedFacts, inProgressFacts, notPerformedFacts };
  }
}

/** One row of the projection, whatever statement produced it. */
interface ScheduleFactRow {
  readonly scheduledWorkoutId: string | null;
  readonly source: string;
  readonly recordedAt: string | null;
}

/** Maps projection rows onto the three fact sets (the shared mapper). */
function mapScheduleFactRows(
  enrollmentId: EnrollmentId,
  rows: ReadonlyArray<ScheduleFactRow>,
): ScheduleExecutionFacts {
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
    } else if (row.source === NOT_PERFORMED) {
      // Non-null narrowing: both columns are NOT NULL on the table, so a null
      // surviving on a fact row is corrupt data — thrown, never normalized.
      if (row.recordedAt === null || row.scheduledWorkoutId === null) {
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
