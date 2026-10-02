import { and, asc, eq, isNotNull } from 'drizzle-orm';

import {
  EnrollmentAlreadyExistsError,
  EnrollmentIdentityMismatchError,
  type ProgramEnrollmentRepository,
  type ReplaceEnrollmentOutcome,
  type RestartabilityDecision,
} from '@/application/ports/program-enrollment-repository';
import type { ProgramEnrollment } from '@/domain/entities/program-enrollment';
import type { EnrollmentId, ProgramId, ScheduledWorkoutId, UserId } from '@/domain/types/ids';

import type { Database } from '../client';
import {
  mapProgramEnrollmentToRow,
  mapRowToProgramEnrollment,
} from '../mappers/enrollment-mapper';
import { isUniqueViolation, pgConstraintName } from '../pg-error';
import { notPerformedWorkouts, programEnrollments, workoutSessions } from '../schema';

/**
 * The (user_id, program_id) unique constraint created by the enrollments
 * table definition. Unique violations are translated to
 * EnrollmentAlreadyExistsError ONLY when they name this constraint, so a
 * primary-key collision or any unrelated constraint can never masquerade as
 * a duplicate enrollment.
 */
const USER_PROGRAM_UNIQUE_CONSTRAINT = 'program_enrollments_user_program_unique';

/**
 * Drizzle implementation of the ProgramEnrollmentRepository port.
 *
 * The (user_id, program_id) unique constraint keeps at most one enrollment
 * per user per program: a create racing that constraint surfaces as
 * EnrollmentAlreadyExistsError so use cases can map it to the
 * ALREADY_ENROLLED business outcome without seeing database details. Delete
 * returns whether a row was matched, so an enrollment that vanished between
 * the ownership check and the write is handled as expected data.
 *
 * `replaceExpectedWithNew` is the atomic compare-and-replace: under ONE lock on
 * the expected enrollment row (`FOR NO KEY UPDATE`, parent-first like the
 * settlement writes) it re-reads the run's CURRENT settlement facts, evaluates
 * the caller-supplied restartability decision over them, and only then performs
 * the targeted delete + insert. A run that stopped being restartable between
 * the caller's pre-read and this transaction is refused with zero writes, so a
 * stale restart request can never replace an open run.
 */
export class DrizzleProgramEnrollmentRepository implements ProgramEnrollmentRepository {
  constructor(private readonly db: Database) {}

  async findById(id: EnrollmentId): Promise<ProgramEnrollment | null> {
    // One bounded, identity-scoped statement. A restart/leave deletes the
    // expected row, so `null` means the expected run vanished — never a silent
    // switch to a new generation.
    const rows = await this.db
      .select()
      .from(programEnrollments)
      .where(eq(programEnrollments.id, id))
      .limit(1);

    const row = rows[0];
    return row === undefined ? null : mapRowToProgramEnrollment(row);
  }

  async findByUserAndProgram(
    userId: UserId,
    programId: ProgramId,
  ): Promise<ProgramEnrollment | null> {
    const rows = await this.db
      .select()
      .from(programEnrollments)
      .where(
        and(
          eq(programEnrollments.userId, userId),
          eq(programEnrollments.programId, programId),
        ),
      )
      .limit(1);

    const row = rows[0];
    return row === undefined ? null : mapRowToProgramEnrollment(row);
  }

  async listByUserId(userId: UserId): Promise<ReadonlyArray<ProgramEnrollment>> {
    const rows = await this.db
      .select()
      .from(programEnrollments)
      .where(eq(programEnrollments.userId, userId))
      .orderBy(asc(programEnrollments.enrolledAt));

    return rows.map(mapRowToProgramEnrollment);
  }

  async create(enrollment: ProgramEnrollment): Promise<void> {
    try {
      await this.db
        .insert(programEnrollments)
        .values(mapProgramEnrollmentToRow(enrollment));
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new EnrollmentAlreadyExistsError(enrollment.userId, enrollment.programId);
      }
      throw error;
    }
  }

  async delete(id: EnrollmentId): Promise<boolean> {
    // Deleting the row detaches its workout sessions via the
    // workout_sessions_enrollment_id FK's ON DELETE SET NULL.
    const deleted = await this.db
      .delete(programEnrollments)
      .where(eq(programEnrollments.id, id))
      .returning({ id: programEnrollments.id });

    return deleted.length > 0;
  }

  async replaceExpectedWithNew(
    expectedId: EnrollmentId,
    next: ProgramEnrollment,
    isStillRestartable: RestartabilityDecision,
  ): Promise<ReplaceEnrollmentOutcome> {
    // ONE transaction: the lock, the fact read, the decision and the
    // replacement commit together or not at all. Every failure path throws from
    // INSIDE this callback, so `db.transaction` performs the rollback (the
    // delete — and with it the FK's ON DELETE SET NULL of the old sessions — is
    // undone).
    return this.db.transaction(async (tx) => {
      // Step 1 — own the EXPECTED enrollment row FIRST, with the same
      // serialization strength (FOR NO KEY UPDATE) and parent-first order the
      // settlement writes use. Everything below is read under this authority,
      // so a concurrent Undo/START that targets the same run either committed
      // before this lock or waits behind it — never interleaves.
      const locked = await tx
        .select({
          userId: programEnrollments.userId,
          programId: programEnrollments.programId,
        })
        .from(programEnrollments)
        .where(eq(programEnrollments.id, expectedId))
        .for('no key update');

      const current = locked[0];
      if (current === undefined) {
        // Stale expected id: nothing was locked, so nothing is deleted or
        // inserted and no other enrollment is touched. The transaction commits
        // as a no-op.
        return { kind: 'stale' } as const;
      }

      // Identity invariant: the replaced row must describe the same (user,
      // program) identity as its replacement. A mismatch is an invariant
      // failure (never a business outcome) and rolls the transaction back.
      if (current.userId !== next.userId || current.programId !== next.programId) {
        throw new EnrollmentIdentityMismatchError(
          expectedId,
          { userId: current.userId, programId: current.programId },
          { userId: next.userId, programId: next.programId },
        );
      }

      // Step 2 — the CURRENT run-scoped execution facts, read under the lock
      // that protects the replacement. Two bounded, enrollment-scoped
      // projections: completed occurrence ids (M14) and recorded not-performed
      // occurrence ids (M17). No session aggregate is hydrated.
      const completedRows = await tx
        .select({ scheduledWorkoutId: workoutSessions.scheduledWorkoutId })
        .from(workoutSessions)
        .where(
          and(
            eq(workoutSessions.enrollmentId, expectedId),
            isNotNull(workoutSessions.completedAt),
          ),
        );
      const recordedRows = await tx
        .select({ scheduledWorkoutId: notPerformedWorkouts.scheduledWorkoutId })
        .from(notPerformedWorkouts)
        .where(eq(notPerformedWorkouts.enrollmentId, expectedId));

      // Step 3 — the caller-supplied Domain decision, evaluated exactly once
      // over those locked facts. Infrastructure authors no restartability rule;
      // it re-evaluates the SAME authority the caller used before the write.
      const restartable = isStillRestartable({
        completedIds: completedRows.map((row) => row.scheduledWorkoutId as ScheduledWorkoutId),
        notPerformedIds: recordedRows.map((row) => row.scheduledWorkoutId as ScheduledWorkoutId),
      });
      if (!restartable) {
        // The run stopped being restartable after the caller's pre-read (an
        // Undo reopened it, or a record was undone): refuse with ZERO writes.
        // The delete, the insert and the FK's session detachment never run, and
        // the old enrollment remains exactly as it was.
        return { kind: 'not-restartable' } as const;
      }

      // Step 4 — the existing atomic replacement, now authorized against the
      // authoritative locked state. The delete targets `expectedId` ONLY: a
      // newer enrollment created by a concurrent replacement has a different id
      // and can never match this predicate.
      await tx.delete(programEnrollments).where(eq(programEnrollments.id, expectedId));

      try {
        await tx.insert(programEnrollments).values(mapProgramEnrollmentToRow(next));
      } catch (error) {
        // Translate ONLY the (user_id, program_id) unique constraint — by
        // name, so a primary-key collision or any unrelated unique violation
        // stays an unexpected error. Throwing inside the transaction is what
        // rolls the delete (and its session detachment) back.
        if (
          isUniqueViolation(error) &&
          pgConstraintName(error) === USER_PROGRAM_UNIQUE_CONSTRAINT
        ) {
          throw new EnrollmentAlreadyExistsError(next.userId, next.programId);
        }
        throw error;
      }

      // Reached only when the lock, the decision and both statements succeeded;
      // the transaction commits.
      return { kind: 'replaced' } as const;
    });
  }
}
