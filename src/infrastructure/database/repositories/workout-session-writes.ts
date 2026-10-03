import {
  SessionAlreadyExistsError,
  SessionEnrollmentNotFoundError,
  SessionOccurrenceKeyConflictError,
} from '@/application/ports/workout-session-repository';
import type { WorkoutSession } from '@/domain/entities/workout-session';

import type { Database } from '../client';
import { mapExerciseLogToRow, mapSessionToRow, mapSetToRow } from '../mappers/session-mapper';
import { isForeignKeyViolation, isUniqueViolation, pgConstraintName } from '../pg-error';
import { exerciseLogs, setLogs, workoutSessions } from '../schema';

/**
 * The transaction handle `db.transaction` hands to its callback. A session row
 * is only ever written INSIDE a caller-owned transaction: this module never
 * opens one and never takes a lock, so the enrollment-first ordering stays
 * owned by the transaction owner (`DrizzleRunOccurrenceWrites`).
 */
export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

/**
 * The workout_sessions enrollment FK created by migration 0004. Its
 * ON DELETE SET NULL behavior is the legitimate leave-detachment path; a
 * violation of this constraint on insert means the enrollment was deleted
 * before this write.
 */
export const ENROLLMENT_FK_CONSTRAINT =
  'workout_sessions_enrollment_id_program_enrollments_id_fk';

/**
 * The partial unique index `exercise_logs_session_occurrence_key_unique`
 * (migration 0011): (session_id, occurrence_key) is unique for non-null
 * occurrence keys. It is the database backstop for the domain's
 * session-unique occurrenceKey invariant; the name distinguishes its
 * violations from the one-session-per-(enrollment, occurrence) constraint so
 * the catch-all unique-violation mapping never misclassifies them.
 */
export const OCCURRENCE_KEY_UNIQUE_INDEX = 'exercise_logs_session_occurrence_key_unique';

/**
 * Translates the constraint failures the session port names into their typed
 * errors, by constraint name, or returns null when the error is not one of
 * them (the caller rethrows the original). Shared by the session INSERT
 * (the run-occurrence write authority) and the session UPDATE (`save`), so both
 * operations report the same outcomes, and the only constraint that can mean
 * "this row is already taken" is the one-session-per-(enrollment, occurrence)
 * rule — the occurrence-key index is reported distinctly.
 */
export function mapSessionWriteFailure(error: unknown, session: WorkoutSession): Error | null {
  if (isUniqueViolation(error) && pgConstraintName(error) === OCCURRENCE_KEY_UNIQUE_INDEX) {
    return new SessionOccurrenceKeyConflictError(session.id);
  }
  if (isUniqueViolation(error)) {
    return new SessionAlreadyExistsError(session.scheduledWorkoutId);
  }
  if (
    isForeignKeyViolation(error) &&
    pgConstraintName(error) === ENROLLMENT_FK_CONSTRAINT &&
    session.enrollmentId !== null
  ) {
    // A concurrent leave deleted the enrollment before this write; the caller
    // re-checks and maps this to the NOT_ENROLLED business outcome. The FK can
    // only be violated by a non-null enrollment id, so this narrowing cannot
    // hide a case.
    return new SessionEnrollmentNotFoundError(session.enrollmentId);
  }
  return null;
}

/**
 * INSERTs a BRAND-NEW session aggregate — its row and its child rows — and
 * returns the COMMITTED version read back from the row.
 *
 * INSERT only: there is no `ON CONFLICT`, no update branch and no upsert, so a
 * second creation for the same (enrollment, scheduled occurrence) pair is
 * rejected by the database instead of overwriting the existing session. A
 * brand-new session has no child rows yet, so its children are inserted
 * directly — the UPDATE path's delete-and-reinsert dance is unnecessary (and
 * would be wrong to run).
 *
 * The caller must already hold the run's enrollment row lock: this is the
 * session half of `DrizzleRunOccurrenceWrites.createSessionForOccurrence`, and
 * it is deliberately shared with test seeding so the row mapping exists once.
 */
export async function insertWorkoutSessionRows(
  tx: Transaction,
  session: WorkoutSession,
): Promise<number> {
  const inserted = await tx
    .insert(workoutSessions)
    .values(mapSessionToRow(session))
    // The committed version is READ BACK from the row: the mapper writes the
    // snapshot's own version, and returning the database's value is what lets
    // the port promise "the persisted aggregate".
    .returning({ id: workoutSessions.id, version: workoutSessions.version });

  const created = inserted[0];
  if (created === undefined) {
    throw new Error(`Workout session "${session.id}" was not inserted`);
  }

  for (const log of session.exerciseLogs) {
    await tx.insert(exerciseLogs).values(mapExerciseLogToRow(session.id, log));
    for (const set of log.sets) {
      await tx.insert(setLogs).values(mapSetToRow(session.id, log.order, set));
    }
  }

  return created.version;
}
