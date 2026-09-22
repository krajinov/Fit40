import { and, asc, eq, isNotNull } from 'drizzle-orm';

import {
  SessionAlreadyExistsError,
  SessionEnrollmentChangedError,
  SessionEnrollmentNotFoundError,
  SessionStaleVersionError,
  type WorkoutSessionRepository,
  SessionOccurrenceKeyConflictError,
} from '@/application/ports/workout-session-repository';
import type { WorkoutSession } from '@/domain/entities/workout-session';
import type {
  EnrollmentId,
  ScheduledWorkoutId,
  WorkoutSessionId,
} from '@/domain/types/ids';

import type { Database } from '../client';
import {
  mapExerciseLogToRow,
  mapSessionRows,
  mapSessionToRow,
  mapSetToRow,
} from '../mappers/session-mapper';
import { isForeignKeyViolation, isUniqueViolation, pgConstraintName } from '../pg-error';
import { exerciseLogs, setLogs, workoutSessions } from '../schema';

/**
 * The workout_sessions enrollment FK created by migration 0004. Its
 * ON DELETE SET NULL behavior is the legitimate leave-detachment path; a
 * violation of this constraint on insert means the enrollment was deleted
 * between the use case's enrollment check and this write.
 */
const ENROLLMENT_FK_CONSTRAINT = 'workout_sessions_enrollment_id_program_enrollments_id_fk';

/**
 * The partial unique index `exercise_logs_session_occurrence_key_unique`
 * (migration 0011): (session_id, occurrence_key) is unique for non-null
 * occurrence keys. It is the database backstop for the domain's
 * session-unique occurrenceKey invariant; the name distinguishes its
 * violations from the one-session-per-(enrollment, occurrence) constraint so
 * the catch-all unique-violation mapping never misclassifies them.
 */
const OCCURRENCE_KEY_UNIQUE_INDEX = 'exercise_logs_session_occurrence_key_unique';

type SessionRow = typeof workoutSessions.$inferSelect;

/**
 * Drizzle implementation of the WorkoutSessionRepository port.
 *
 * `save` persists the whole aggregate in one transaction using delete-and-
 * reinsert for children. The session row upsert is guarded by an optimistic-
 * concurrency version check plus an enrollment-identity condition, so a stale
 * snapshot is rejected instead of silently overwriting concurrent changes,
  * and a session whose enrollment was detached or changed between load and
  * write can never commit (detached history is read-only). Unique-constraint
  * races on the one-session-per-(enrollment, occurrence) rule surface as
  * `SessionAlreadyExistsError`; a violation of the partial unique index on
  * (session_id, occurrence_key) — the database backstop for the domain's
  * session-unique occurrenceKey invariant — surfaces as the distinct
  * `SessionOccurrenceKeyConflictError` (never misclassified as a duplicate
  * session); a concurrently deleted enrollment (a leave racing the insert)
  * surfaces as `SessionEnrollmentNotFoundError`. Any other constraint
  * violation propagates untouched.
 */
export class DrizzleWorkoutSessionRepository implements WorkoutSessionRepository {
  constructor(private readonly db: Database) {}

  async findById(id: WorkoutSessionId): Promise<WorkoutSession | null> {
    const rows = await this.db
      .select()
      .from(workoutSessions)
      .where(eq(workoutSessions.id, id))
      .limit(1);

    const session = rows[0];
    return session === undefined ? null : this.hydrate(session);
  }

  async findByEnrollmentAndScheduledWorkout(
    enrollmentId: EnrollmentId,
    scheduledWorkoutId: ScheduledWorkoutId,
  ): Promise<WorkoutSession | null> {
    const rows = await this.db
      .select()
      .from(workoutSessions)
      .where(
        and(
          eq(workoutSessions.enrollmentId, enrollmentId),
          eq(workoutSessions.scheduledWorkoutId, scheduledWorkoutId),
        ),
      )
      .limit(1);

    const session = rows[0];
    return session === undefined ? null : this.hydrate(session);
  }

  async listCompletedScheduledWorkoutIds(
    enrollmentId: EnrollmentId,
  ): Promise<ReadonlyArray<ScheduledWorkoutId>> {
    // Lightweight projection for progress reads: a single one-column query —
    // no session aggregates, exercise logs, or set logs are hydrated.
    const rows = await this.db
      .select({ scheduledWorkoutId: workoutSessions.scheduledWorkoutId })
      .from(workoutSessions)
      .where(
        and(
          eq(workoutSessions.enrollmentId, enrollmentId),
          isNotNull(workoutSessions.completedAt),
        ),
      )
      .orderBy(asc(workoutSessions.startedAt));

    // Trusted DB values: the column is a FK into scheduled_workouts, so each
    // id is valid by schema constraint (database records are trusted at the
    // repository boundary).
    return rows.map((row) => row.scheduledWorkoutId as ScheduledWorkoutId);
  }

  async save(session: WorkoutSession): Promise<WorkoutSession> {
    try {
      const committedVersion = await this.db.transaction(async (tx) => {
        const affected = await tx
          .insert(workoutSessions)
          .values(mapSessionToRow(session))
          .onConflictDoUpdate({
            target: workoutSessions.id,
            set: {
              scheduledWorkoutId: session.scheduledWorkoutId,
              workoutId: session.workoutId,
              startedAt: session.startedAt,
              completedAt: session.completedAt,
              version: session.version + 1,
              // The occurrence-key high-water mark is session-row state and
              // must ride every whole-aggregate update (M11).
              nextOccurrenceKey: session.nextOccurrenceKey,
            },
            // The write must match BOTH the snapshot's version (optimistic
            // concurrency) and its enrollment identity: if a concurrent leave
            // detached the row (ON DELETE SET NULL) or re-pointed it, the
            // predicate misses and the mutation does not commit — detached
            // history stays read-only. Detached snapshots (null enrollment)
            // keep the version-only predicate; no production flow writes them.
            where:
              session.enrollmentId !== null
                ? and(
                    eq(workoutSessions.version, session.version),
                    eq(workoutSessions.enrollmentId, session.enrollmentId),
                  )
                : eq(workoutSessions.version, session.version),
          })
          // The committed version is READ BACK from the row, never recomputed
          // here: the upsert's INSERT branch stores the snapshot's own version
          // while its UPDATE branch stores version + 1, and only PostgreSQL
          // knows which branch ran. Returning the database's own value is what
          // lets the port promise "the persisted aggregate".
          .returning({ id: workoutSessions.id, version: workoutSessions.version });

        const committed = affected[0];
        if (committed === undefined) {
          // Failure-path classification only (never a pre-save recheck): a
          // version mismatch is the existing optimistic-concurrency outcome;
          // a version match with a changed/NULL enrollment is the detached-
          // history conflict. A missing row cannot occur (sessions are never
          // hard-deleted) and conservatively reports stale.
          const rows = await tx
            .select({
              version: workoutSessions.version,
              enrollmentId: workoutSessions.enrollmentId,
            })
            .from(workoutSessions)
            .where(eq(workoutSessions.id, session.id))
            .limit(1);
          const current = rows[0];
          if (
            current !== undefined &&
            current.version === session.version &&
            session.enrollmentId !== null &&
            current.enrollmentId !== session.enrollmentId
          ) {
            throw new SessionEnrollmentChangedError(session.id);
          }
          throw new SessionStaleVersionError(session.id);
        }

        await tx.delete(setLogs).where(eq(setLogs.sessionId, session.id));
        await tx.delete(exerciseLogs).where(eq(exerciseLogs.sessionId, session.id));

        for (const log of session.exerciseLogs) {
          await tx.insert(exerciseLogs).values(mapExerciseLogToRow(session.id, log));
          for (const set of log.sets) {
            await tx.insert(setLogs).values(mapSetToRow(session.id, log.order, set));
          }
        }

        return committed.version;
      });

      // The whole-aggregate write persisted exactly this snapshot's children,
      // so the persisted aggregate is the snapshot with the database's own
      // committed version attached.
      return { ...session, version: committedVersion };
    } catch (error) {
      if (
        isUniqueViolation(error) &&
        pgConstraintName(error) === OCCURRENCE_KEY_UNIQUE_INDEX
      ) {
        throw new SessionOccurrenceKeyConflictError(session.id);
      }
      if (isUniqueViolation(error)) {
        throw new SessionAlreadyExistsError(session.scheduledWorkoutId);
      }
      if (
        isForeignKeyViolation(error) &&
        pgConstraintName(error) === ENROLLMENT_FK_CONSTRAINT
      ) {
        // A concurrent leave deleted the enrollment after the use case's
        // enrollment check; the caller re-checks and maps this to the
        // NOT_ENROLLED business outcome. The FK can only be violated by a
        // non-null enrollment id, so the narrowing below cannot hide a case.
        if (session.enrollmentId !== null) {
          throw new SessionEnrollmentNotFoundError(session.enrollmentId);
        }
      }
      throw error;
    }
  }

  private async hydrate(session: SessionRow): Promise<WorkoutSession> {
    const logRows = await this.db
      .select()
      .from(exerciseLogs)
      .where(eq(exerciseLogs.sessionId, session.id))
      .orderBy(asc(exerciseLogs.exerciseOrder));
    const setRows = await this.db
      .select()
      .from(setLogs)
      .where(eq(setLogs.sessionId, session.id))
      .orderBy(asc(setLogs.exerciseOrder), asc(setLogs.setNumber));

    return mapSessionRows({
      session,
      exerciseLogs: logRows,
      setLogs: setRows,
    });
  }
}
