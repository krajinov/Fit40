import { and, asc, desc, eq, inArray, isNotNull } from 'drizzle-orm';

import {
  SessionAlreadyExistsError,
  SessionEnrollmentChangedError,
  SessionEnrollmentNotFoundError,
  SessionStaleVersionError,
  type LatestCompletedExercisePerformance,
  type WorkoutSessionRepository,
} from '@/application/ports/workout-session-repository';
import type { WorkoutSession } from '@/domain/entities/workout-session';
import type {
  EnrollmentId,
  ExerciseId,
  ScheduledWorkoutId,
  UserId,
  WorkoutSessionId,
} from '@/domain/types/ids';

import type { Database } from '../client';
import type { LatestPerformanceRow } from '../mappers/exercise-performance-mapper';
import { mapLatestCompletedExercisePerformances } from '../mappers/exercise-performance-mapper';
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
 * `SessionAlreadyExistsError`; a concurrently deleted enrollment (a leave
 * racing the insert) surfaces as `SessionEnrollmentNotFoundError`. Any other
 * constraint violation propagates untouched.
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

  async listLatestCompletedExercisePerformances(
    userId: UserId,
    exerciseIds: ReadonlyArray<ExerciseId>,
  ): Promise<ReadonlyArray<LatestCompletedExercisePerformance>> {
    if (exerciseIds.length === 0) {
      return [];
    }

    const performanceRows = await this.selectLatestPerformanceRows(userId, exerciseIds);
    if (performanceRows.length === 0) {
      return [];
    }

    // Batched second query: sets of every winning session in one round trip
    // (no per-exercise N+1). Set rows of non-winning exercises in those
    // sessions are ignored by the mapper's (session, order) keying.
    const sessionIds = [...new Set(performanceRows.map((row) => row.sessionId))];
    const setRows = await this.db
      .select()
      .from(setLogs)
      .where(inArray(setLogs.sessionId, sessionIds))
      .orderBy(asc(setLogs.exerciseOrder), asc(setLogs.setNumber));

    return mapLatestCompletedExercisePerformances(performanceRows, setRows);
  }

  /**
   * One winning exercise log per exercise: DISTINCT ON keeps the first row of
   * each exercise group in ORDER BY order, i.e. the deterministic recency
   * ladder completed_at → started_at → session id → exercise_order, all
   * descending. Scopes to the user's OWNED sessions (detached history is
   * included; in-progress sessions are excluded by the completed filter).
   */
  private async selectLatestPerformanceRows(
    userId: UserId,
    exerciseIds: ReadonlyArray<ExerciseId>,
  ): Promise<ReadonlyArray<LatestPerformanceRow>> {
    return this.db
      .selectDistinctOn([exerciseLogs.exerciseId], {
        exerciseId: exerciseLogs.exerciseId,
        sessionId: workoutSessions.id,
        exerciseOrder: exerciseLogs.exerciseOrder,
        completedAt: workoutSessions.completedAt,
        prescriptionType: exerciseLogs.prescriptionType,
        prescribedSets: exerciseLogs.sets,
        minReps: exerciseLogs.minReps,
        maxReps: exerciseLogs.maxReps,
        durationSeconds: exerciseLogs.durationSeconds,
      })
      .from(exerciseLogs)
      .innerJoin(workoutSessions, eq(exerciseLogs.sessionId, workoutSessions.id))
      .where(
        and(
          eq(workoutSessions.userId, userId),
          isNotNull(workoutSessions.completedAt),
          inArray(exerciseLogs.exerciseId, [...exerciseIds]),
        ),
      )
      .orderBy(
        exerciseLogs.exerciseId,
        desc(workoutSessions.completedAt),
        desc(workoutSessions.startedAt),
        desc(workoutSessions.id),
        desc(exerciseLogs.exerciseOrder),
      );
  }

  async save(session: WorkoutSession): Promise<void> {
    try {
      await this.db.transaction(async (tx) => {
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
          .returning({ id: workoutSessions.id });

        if (affected.length === 0) {
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
      });
    } catch (error) {
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
