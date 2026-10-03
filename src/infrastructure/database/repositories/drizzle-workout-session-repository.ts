import { and, asc, eq, inArray, isNotNull, isNull } from 'drizzle-orm';

import type { CompletedWorkoutSession } from '@/application/ports/training-history-repository';
import {
  SessionEnrollmentChangedError,
  SessionStaleVersionError,
  type CompletedOccurrenceActivity,
  type WorkoutSessionRepository,
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
  mapSetToRow,
} from '../mappers/session-mapper';
import { exerciseLogs, setLogs, workoutSessions } from '../schema';
import { mapSessionWriteFailure } from './workout-session-writes';

type SessionRow = typeof workoutSessions.$inferSelect;
type ExerciseLogRow = typeof exerciseLogs.$inferSelect;
type SetLogRow = typeof setLogs.$inferSelect;

/**
 * Drizzle implementation of the WorkoutSessionRepository port.
 *
 * This repository owns session CONTENT persistence: reading aggregates and
 * UPDATEing an existing aggregate. It has NO insert path (M17 Slice 6): every
 * new `workout_sessions` row is written by the enrollment-serialized mutation
 * authority `DrizzleRunOccurrenceWrites.createSessionForOccurrence`, so there
 * is exactly one production door into the table and the
 * START-vs-RECORD-NOT-PERFORMED race cannot be won by a writer that never took
 * the enrollment lock.
 *
 * `save` UPDATEs an existing aggregate in one transaction using
 * delete-and-reinsert for its children. The session row update is guarded by
 * an optimistic-concurrency version check plus an enrollment-identity
 * condition, so a stale snapshot is rejected instead of silently overwriting
 * concurrent changes, and a session whose enrollment was detached or changed
 * between load and write can never commit (detached history is read-only).
 * Because the statement is an UPDATE, a snapshot whose row was hard-deleted
 * can never recreate it: it fails as stale.
 *
 * Unique-constraint races on the one-session-per-(enrollment, occurrence) rule
 * surface as `SessionAlreadyExistsError`; a violation of the partial unique
 * index on (session_id, occurrence_key) — the database backstop for the
 * domain's session-unique occurrenceKey invariant — surfaces as the distinct
 * `SessionOccurrenceKeyConflictError` (never misclassified as a duplicate
 * session); a concurrently deleted enrollment (a leave racing the insert)
 * surfaces as `SessionEnrollmentNotFoundError`. Any other constraint violation
 * propagates untouched.
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

  async listInProgressScheduledWorkoutIds(
    enrollmentId: EnrollmentId,
  ): Promise<ReadonlyArray<ScheduledWorkoutId>> {
    // Lightweight projection for scheduling reads: a single one-column query —
    // no session aggregates, exercise logs, or set logs are hydrated, and
    // `planned_workouts` is never consulted. `enrollment_id = ?` never matches
    // a detached (NULL) row — SQL NULL equality — so detached,
    // other-enrollment, and (via enrollment identity) other users' sessions
    // are excluded structurally; `completed_at IS NULL` narrows to in-progress
    // sessions only. Ordering mirrors the completed projection (started_at
    // asc) with the session-id tie-break of listCompletedByEnrollment, so ties
    // still read deterministically.
    const rows = await this.db
      .select({ scheduledWorkoutId: workoutSessions.scheduledWorkoutId })
      .from(workoutSessions)
      .where(
        and(
          eq(workoutSessions.enrollmentId, enrollmentId),
          isNull(workoutSessions.completedAt),
        ),
      )
      .orderBy(asc(workoutSessions.startedAt), asc(workoutSessions.id));

    // Trusted DB values: the column is a FK into scheduled_workouts, so each
    // id is valid by schema constraint (database records are trusted at the
    // repository boundary).
    return rows.map((row) => row.scheduledWorkoutId as ScheduledWorkoutId);
  }

  async listCompletedOccurrenceActivity(
    enrollmentId: EnrollmentId,
  ): Promise<ReadonlyArray<CompletedOccurrenceActivity>> {
    // A single projected statement over `workout_sessions` — no JOIN, no UNION,
    // no aggregation, no DISTINCT: one session per (enrollment, occurrence) is a
    // database guarantee (`workout_sessions_enrollment_occurrence_unique`), so
    // this read is a projection and never a reconciliation.
    // `enrollment_id = ?` never matches a detached (NULL) row — SQL NULL
    // equality — so detached, other-enrollment, and (via enrollment identity)
    // other users' sessions are excluded structurally; `completed_at IS NOT
    // NULL` narrows to completed sessions, and `scheduled_workout_id` is NOT
    // NULL by column constraint, so every row carries a real occurrence
    // identity. Ordering mirrors the port's total completed ladder.
    const rows = await this.db
      .select({
        scheduledWorkoutId: workoutSessions.scheduledWorkoutId,
        completedAt: workoutSessions.completedAt,
      })
      .from(workoutSessions)
      .where(
        and(
          eq(workoutSessions.enrollmentId, enrollmentId),
          isNotNull(workoutSessions.completedAt),
        ),
      )
      .orderBy(
        asc(workoutSessions.completedAt),
        asc(workoutSessions.startedAt),
        asc(workoutSessions.id),
      );

    return rows.map((row) => {
      // Non-null narrowing for a completed-only read, the `completedAtOf`
      // convention: a null surviving the filter is corrupt data — thrown as an
      // unexpected error, never a business outcome.
      if (row.completedAt === null) {
        throw new Error(
          `Corrupt data in workout_sessions (scheduled_workout_id=${row.scheduledWorkoutId}): completed_at is null despite the completed-only filter`,
        );
      }

      // Trusted DB value: the column is a FK into scheduled_workouts, so the id
      // is valid by schema constraint (database records are trusted at the
      // repository boundary).
      return {
        scheduledWorkoutId: row.scheduledWorkoutId as ScheduledWorkoutId,
        completedAt: row.completedAt,
      };
    });
  }

  async listCompletedByEnrollment(
    enrollmentId: EnrollmentId,
  ): Promise<ReadonlyArray<CompletedWorkoutSession>> {
    // Q1: the enrollment's completed session rows. `enrollment_id = ?`
    // never matches a detached (NULL) row — SQL NULL equality — so detached,
    // other-enrollment, and (via enrollment identity) other users' sessions
    // are all excluded structurally. `completed_at IS NOT NULL` narrows to
    // completed-only. The total-order ascending ladder mirrors the port.
    const rows = await this.db
      .select()
      .from(workoutSessions)
      .where(
        and(
          eq(workoutSessions.enrollmentId, enrollmentId),
          isNotNull(workoutSessions.completedAt),
        ),
      )
      .orderBy(
        asc(workoutSessions.completedAt),
        asc(workoutSessions.startedAt),
        asc(workoutSessions.id),
      );

    // Batched child hydration (Q2/Q3) only when there is something to
    // hydrate — an empty result is one statement, a non-empty one is three,
    // regardless of how many sessions the enrollment holds.
    return rows.length === 0 ? [] : this.hydrateCompletedMany(rows);
  }

  async save(session: WorkoutSession): Promise<WorkoutSession> {
    try {
      const committedVersion = await this.db.transaction(async (tx) => {
        // UPDATE only — never an upsert. A snapshot whose row was hard-deleted
        // cannot recreate it here (M17 Slice 4): the statement then matches no
        // row and the write fails as stale, so a deleted session stays deleted
        // instead of being silently restored by a stale writer.
        //
        // The update must match BOTH the snapshot's version (optimistic
        // concurrency) and its enrollment identity: if a concurrent leave
        // detached the row (ON DELETE SET NULL) or re-pointed it, the predicate
        // misses and the mutation does not commit — detached history stays
        // read-only. Detached snapshots (null enrollment) keep the version-only
        // predicate; no production flow writes them.
        const affected = await tx
          .update(workoutSessions)
          .set({
            scheduledWorkoutId: session.scheduledWorkoutId,
            workoutId: session.workoutId,
            startedAt: session.startedAt,
            completedAt: session.completedAt,
            version: session.version + 1,
            // The occurrence-key high-water mark is session-row state and
            // must ride every whole-aggregate update (M11).
            nextOccurrenceKey: session.nextOccurrenceKey,
          })
          .where(
            session.enrollmentId !== null
              ? and(
                  eq(workoutSessions.id, session.id),
                  eq(workoutSessions.version, session.version),
                  eq(workoutSessions.enrollmentId, session.enrollmentId),
                )
              : and(
                  eq(workoutSessions.id, session.id),
                  eq(workoutSessions.version, session.version),
                ),
          )
          // The committed version is READ BACK from the row, never recomputed
          // here: only PostgreSQL knows the stored value, and returning the
          // database's own value is what lets the port promise "the persisted
          // aggregate".
          .returning({ id: workoutSessions.id, version: workoutSessions.version });

        const committed = affected[0];
        if (committed === undefined) {
          // Failure-path classification only (never a pre-save recheck): a
          // version mismatch — INCLUDING a row that no longer exists at all —
          // is the existing stale-session outcome; a version match with a
          // changed/NULL enrollment is the detached-history conflict. Row
          // absence is never converted into a write.
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

        // The aggregate owns its children, so the update persists exactly this
        // snapshot's children: out with the old, in with the new.
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
      const mapped = mapSessionWriteFailure(error, session);
      if (mapped === null) {
        throw error;
      }
      throw mapped;
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

  /**
   * Batched hydration for a set of completed session rows: one query for the
   * exercise logs and one for the set logs of ALL sessions, grouped per
   * session, then the shared aggregate mapper per session — the same
   * Q1/Q2/Q3 shape as the training-history read, so the statement count is
   * fixed (never one query per session). Kept private and per-instance, the
   * established per-repository convention; `mapSessionRows` stays the single
   * shared hydration implementation, so every aggregate invariant (sequential
   * exercise order, set shapes, provenance, skip, occurrence keys) is
   * enforced exactly as in every other read path.
   */
  private async hydrateCompletedMany(
    rows: ReadonlyArray<SessionRow>,
  ): Promise<ReadonlyArray<CompletedWorkoutSession>> {
    const sessionIds = rows.map((row) => row.id);
    const logRows = await this.db
      .select()
      .from(exerciseLogs)
      .where(inArray(exerciseLogs.sessionId, sessionIds))
      .orderBy(asc(exerciseLogs.sessionId), asc(exerciseLogs.exerciseOrder));
    const setRows = await this.db
      .select()
      .from(setLogs)
      .where(inArray(setLogs.sessionId, sessionIds))
      .orderBy(asc(setLogs.sessionId), asc(setLogs.exerciseOrder), asc(setLogs.setNumber));

    const logsBySession = new Map<string, ExerciseLogRow[]>();
    for (const row of logRows) {
      const list = logsBySession.get(row.sessionId) ?? [];
      list.push(row);
      logsBySession.set(row.sessionId, list);
    }
    const setsBySession = new Map<string, SetLogRow[]>();
    for (const row of setRows) {
      const list = setsBySession.get(row.sessionId) ?? [];
      list.push(row);
      setsBySession.set(row.sessionId, list);
    }

    return rows.map((row): CompletedWorkoutSession => {
      const session: CompletedWorkoutSession = {
        ...mapSessionRows({
          session: row,
          exerciseLogs: logsBySession.get(row.id) ?? [],
          setLogs: setsBySession.get(row.id) ?? [],
        }),
        completedAt: this.completedAtOf(row),
      };
      return session;
    });
  }

  /**
   * Non-null narrowing for a completed-only read: a null timestamp surviving
   * the `completed_at IS NOT NULL` filter is corrupt data — thrown as an
   * unexpected error, never a business outcome (the history read applies the
   * identical guard).
   */
  private completedAtOf(row: SessionRow): Date {
    if (row.completedAt === null) {
      throw new Error(
        `Corrupt data in workout_sessions (id=${row.id}): completed_at is null despite the completed-only filter`,
      );
    }
    return row.completedAt;
  }
}
