import { and, eq, exists, isNotNull, sql } from 'drizzle-orm';

import type {
  FencedRunClosureFacts,
  RunClosureFactsRepository,
} from '@/application/ports/run-closure-facts-repository';
import type { RunClosureFacts } from '@/domain/services/run-closure';
import type { EnrollmentId, ProgramId, ScheduledWorkoutId, UserId } from '@/domain/types/ids';

import type { Database } from '../client';
import { notPerformedWorkouts, programEnrollments, workoutSessions } from '../schema';

/** Discriminator values of the one-row-per-fact projection below. */
const MATCHED = 'matched';
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

  /**
   * The FENCED projection: identity and facts from ONE statement.
   *
   * Three branches in a single `UNION ALL`, every one of them gated by the SAME
   * predicate over `program_enrollments` (the expected id AND the trusted
   * `user_id` / `program_id`):
   * - a `matched` anchor row, present only when the expected enrollment still
   *   exists as this user's run for this program;
   * - the run's completed authored occurrences;
   * - its recorded not-performed facts.
   *
   * Because READ COMMITTED takes ONE snapshot per statement, the anchor and the
   * facts describe the same database instant: a restart/leave committing while
   * this statement runs shifts the whole answer to before (matched, the old
   * run's facts) or after (not matched) — never to a validated-but-vanished
   * enrollment with empty facts, which the summary would misread as an open
   * run. The anchor row is also why an empty fact set is unambiguous:
   * `matched` present with no facts is a genuinely unstarted run, while its
   * absence is a run that no longer exists.
   */
  async findFencedClosureFactsByEnrollment(
    expectedEnrollmentId: EnrollmentId,
    userId: UserId,
    programId: ProgramId,
  ): Promise<FencedRunClosureFacts> {
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
      })
      .from(programEnrollments)
      .where(
        and(
          eq(programEnrollments.id, expectedEnrollmentId),
          eq(programEnrollments.userId, userId),
          eq(programEnrollments.programId, programId),
        ),
      );

    const completedFacts = this.db
      .select({
        scheduledWorkoutId: workoutSessions.scheduledWorkoutId,
        source: sql<string>`'${sql.raw(COMPLETED)}'`.as('source'),
      })
      .from(workoutSessions)
      .where(
        and(
          eq(workoutSessions.enrollmentId, expectedEnrollmentId),
          isNotNull(workoutSessions.completedAt),
          expectedRunExists,
        ),
      );

    const notPerformedFacts = this.db
      .select({
        scheduledWorkoutId: notPerformedWorkouts.scheduledWorkoutId,
        source: sql<string>`'${sql.raw(NOT_PERFORMED)}'`.as('source'),
      })
      .from(notPerformedWorkouts)
      .where(
        and(
          eq(notPerformedWorkouts.enrollmentId, expectedEnrollmentId),
          expectedRunExists,
        ),
      );

    // ONE statement: the anchor first, then the facts, each ascending by
    // occurrence id — never implicit database order.
    const rows = await anchor
      .unionAll(completedFacts)
      .unionAll(notPerformedFacts)
      .orderBy(sql`source`, sql`scheduled_workout_id`);

    if (!rows.some((row) => row.source === MATCHED)) {
      return { matched: false };
    }

    const completedIds: ScheduledWorkoutId[] = [];
    const notPerformedIds: ScheduledWorkoutId[] = [];
    for (const row of rows) {
      if (row.source === COMPLETED && row.scheduledWorkoutId !== null) {
        completedIds.push(row.scheduledWorkoutId as ScheduledWorkoutId);
      } else if (row.source === NOT_PERFORMED && row.scheduledWorkoutId !== null) {
        notPerformedIds.push(row.scheduledWorkoutId as ScheduledWorkoutId);
      }
    }

    return { matched: true, facts: { completedIds, notPerformedIds } };
  }
}
