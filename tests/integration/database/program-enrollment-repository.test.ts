import { asc } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import {
  EnrollmentAlreadyExistsError,
  EnrollmentIdentityMismatchError,
} from '@/application/ports/program-enrollment-repository';
import {
  createProgramEnrollment,
  type ProgramEnrollment,
} from '@/domain/entities/program-enrollment';
import {
  createEnrollmentId,
  createProgramId,
  createUserId,
} from '@/domain/types/ids';
import { isUniqueViolation, pgConstraintName } from '@/infrastructure/database/pg-error';
import { programEnrollments, users, workoutSessions } from '@/infrastructure/database/schema';

import { closeDatabase, db, programEnrollmentRepository, resetAndSeed } from './setup';

/**
 * Port-level proof of the atomic compare-and-replace primitive
 * (`ProgramEnrollmentRepository.replaceExpectedWithNew`). These tests assert
 * DATABASE state after the fact — row presence, and whether the FK's
 * ON DELETE SET NULL of the old sessions committed or rolled back — not merely
 * the method's return value. Sessions are inserted directly: this suite is
 * about the enrollment primitive's transaction, not about session writes.
 */

function enid(value: string) {
  const result = createEnrollmentId(value);
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

function userId(value: string) {
  const result = createUserId(value);
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

function programId(value: string) {
  const result = createProgramId(value);
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

function enrollment(
  id: string,
  ownerId: string,
  trainingProgramId: string,
  enrolledAt = '2026-01-01T00:00:00Z',
): ProgramEnrollment {
  const result = createProgramEnrollment({
    id,
    userId: ownerId,
    programId: trainingProgramId,
    enrolledAt: new Date(enrolledAt),
  });
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

async function seedUser(id: string): Promise<void> {
  await db.insert(users).values({ id, email: `${id}@example.test`, passwordHash: 'x' });
}

/** Attaches a workout session to an enrollment (direct insert, FK-valid pair). */
async function attachSession(
  id: string,
  ownerId: string,
  ownerEnrollmentId: string,
  occurrence: {
    readonly scheduledWorkoutId: string;
    readonly workoutId: string;
  } = {
    scheduledWorkoutId: 'fit40-beginner-strength-w1-1',
    workoutId: 'wo-beginner-strength-a',
  },
): Promise<void> {
  await db.insert(workoutSessions).values({
    id,
    userId: ownerId,
    enrollmentId: ownerEnrollmentId,
    scheduledWorkoutId: occurrence.scheduledWorkoutId,
    workoutId: occurrence.workoutId,
    startedAt: new Date('2026-01-02T10:00:00Z'),
  });
}

async function enrollmentRows() {
  return db.select().from(programEnrollments).orderBy(asc(programEnrollments.id));
}

async function sessionRows() {
  return db.select().from(workoutSessions).orderBy(asc(workoutSessions.id));
}

describe('DrizzleProgramEnrollmentRepository.replaceExpectedWithNew', () => {
  beforeEach(async () => {
    await resetAndSeed();
    await seedUser('user-a');
    await seedUser('user-b');
  });

  it('atomically replaces the expected enrollment: old gone, sessions detached, fresh present', async () => {
    await programEnrollmentRepository.create(
      enrollment('enr-1', 'user-a', 'prog-beginner-strength'),
    );
    await attachSession('sess-1', 'user-a', 'enr-1');
    await attachSession('sess-2', 'user-a', 'enr-1', {
      scheduledWorkoutId: 'fit40-beginner-strength-w1-2',
      workoutId: 'wo-beginner-strength-b',
    });
    // Unrelated enrollments that must survive the replacement untouched.
    await programEnrollmentRepository.create(
      enrollment('enr-a2', 'user-a', 'prog-strong-at-home'),
    );
    await programEnrollmentRepository.create(
      enrollment('enr-other', 'user-b', 'prog-strong-at-home'),
    );

    const replaced = await programEnrollmentRepository.replaceExpectedWithNew(
      enid('enr-1'),
      enrollment('enr-2', 'user-a', 'prog-beginner-strength', '2026-04-01T10:00:00Z'),
    );

    expect(replaced).toBe(true);

    // The old identity is gone, the fresh one exists, and nothing else moved:
    // exactly one enrollment for the (user, program) pair.
    const rows = await enrollmentRows();
    expect(rows.map((row) => row.id)).toEqual(['enr-2', 'enr-a2', 'enr-other']);
    expect(rows[0]?.enrolledAt.toISOString()).toBe('2026-04-01T10:00:00.000Z');
    const found = await programEnrollmentRepository.findByUserAndProgram(
      userId('user-a'),
      programId('prog-beginner-strength'),
    );
    expect(found?.id).toBe('enr-2');

    // The old sessions survive as user history, detached at commit by the FK's
    // ON DELETE SET NULL.
    const sessions = await sessionRows();
    expect(sessions.map((session) => session.id)).toEqual(['sess-1', 'sess-2']);
    expect(sessions.every((session) => session.enrollmentId === null)).toBe(true);
  });

  it('returns false for a stale expected id and never touches the newer enrollment', async () => {
    await programEnrollmentRepository.create(
      enrollment('enr-1', 'user-a', 'prog-beginner-strength'),
    );
    // The expected row was already replaced by a newer identity...
    expect(
      await programEnrollmentRepository.replaceExpectedWithNew(
        enid('enr-1'),
        enrollment('enr-2', 'user-a', 'prog-beginner-strength', '2026-04-01T10:00:00Z'),
      ),
    ).toBe(true);
    // ...which owns a session of its own.
    await attachSession('sess-after', 'user-a', 'enr-2');

    const replaced = await programEnrollmentRepository.replaceExpectedWithNew(
      enid('enr-1'),
      enrollment('enr-3', 'user-a', 'prog-beginner-strength', '2026-05-01T10:00:00Z'),
    );

    expect(replaced).toBe(false);
    // No insertion, and the newer enrollment is untouched.
    const rows = await enrollmentRows();
    expect(rows.map((row) => row.id)).toEqual(['enr-2']);
    expect(rows[0]?.enrolledAt.toISOString()).toBe('2026-04-01T10:00:00.000Z');
    // Its session was not detached either — the stale call touched nothing.
    const sessions = await sessionRows();
    expect(sessions.map((session) => [session.id, session.enrollmentId])).toEqual([
      ['sess-after', 'enr-2'],
    ]);
  });

  it('rolls back the delete when the insert fails after it (forced primary-key collision)', async () => {
    await programEnrollmentRepository.create(
      enrollment('enr-1', 'user-a', 'prog-beginner-strength'),
    );
    await attachSession('sess-1', 'user-a', 'enr-1');
    await attachSession('sess-2', 'user-a', 'enr-1', {
      scheduledWorkoutId: 'fit40-beginner-strength-w1-2',
      workoutId: 'wo-beginner-strength-b',
    });
    // The same user's OTHER program enrollment already owns the replacement id.
    await programEnrollmentRepository.create(
      enrollment('enr-a2', 'user-a', 'prog-strong-at-home', '2026-03-01T00:00:00Z'),
    );

    // The replacement is identity-valid (same user, same program) but its
    // primary key is taken, so the INSERT fails AFTER the DELETE inside the
    // transaction.
    //
    // Note: a nonexistent-program FK violation cannot stand in as the forced
    // failure — the in-transaction identity guard requires next.programId to
    // equal the deleted row's programId, and that program exists by FK, so an
    // identity-valid replacement can only fail the insert on the primary key
    // (see the PK-collision test below for the non-translation assertion).
    const error = await programEnrollmentRepository
      .replaceExpectedWithNew(
        enid('enr-1'),
        enrollment('enr-a2', 'user-a', 'prog-beginner-strength', '2026-04-01T10:00:00Z'),
      )
      .then(
        () => null,
        (thrown: unknown) => thrown,
      );

    expect(error).not.toBeNull();
    // A unique violation on the primary key is never translated into the
    // duplicate-enrollment outcome.
    expect(error).not.toBeInstanceOf(EnrollmentAlreadyExistsError);

    // Critical rollback proof: the delete inside the transaction was undone —
    // the expected enrollment is restored with its original fields...
    const rows = await enrollmentRows();
    expect(rows.map((row) => row.id)).toEqual(['enr-1', 'enr-a2']);
    const expected = rows.find((row) => row.id === 'enr-1');
    expect(expected?.programId).toBe('prog-beginner-strength');
    expect(expected?.enrolledAt.toISOString()).toBe('2026-01-01T00:00:00.000Z');
    // ...the replacement was not inserted under the colliding id...
    const colliding = rows.find((row) => row.id === 'enr-a2');
    expect(colliding?.programId).toBe('prog-strong-at-home');
    expect(colliding?.enrolledAt.toISOString()).toBe('2026-03-01T00:00:00.000Z');
    // ...and BOTH old sessions still point at the old enrollment id: the FK's
    // ON DELETE SET NULL was rolled back together with the delete.
    const sessions = await sessionRows();
    expect(sessions.map((session) => [session.id, session.enrollmentId])).toEqual([
      ['sess-1', 'enr-1'],
      ['sess-2', 'enr-1'],
    ]);
  });

  it('rejects a primary-key collision without translating it to a duplicate enrollment', async () => {
    await programEnrollmentRepository.create(
      enrollment('enr-1', 'user-a', 'prog-beginner-strength'),
    );
    await attachSession('sess-1', 'user-a', 'enr-1');
    // Another user's unrelated enrollment already owns the replacement id.
    await programEnrollmentRepository.create(
      enrollment('enr-other', 'user-b', 'prog-strong-at-home'),
    );

    const error = await programEnrollmentRepository
      .replaceExpectedWithNew(
        enid('enr-1'),
        enrollment('enr-other', 'user-a', 'prog-beginner-strength', '2026-04-01T10:00:00Z'),
      )
      .then(
        () => null,
        (thrown: unknown) => thrown,
      );

    // A real unique violation — but on the PRIMARY KEY, so the constraint-name
    // check must keep it an unexpected error, never ALREADY_ENROLLED.
    expect(error).not.toBeNull();
    expect(error).not.toBeInstanceOf(EnrollmentAlreadyExistsError);
    expect(isUniqueViolation(error)).toBe(true);
    expect(pgConstraintName(error)).toBe('program_enrollments_pkey');

    // Rollback: the expected enrollment survives with its session attached...
    const rows = await enrollmentRows();
    expect(rows.map((row) => row.id)).toEqual(['enr-1', 'enr-other']);
    const sessions = await sessionRows();
    expect(sessions.map((session) => [session.id, session.enrollmentId])).toEqual([
      ['sess-1', 'enr-1'],
    ]);
    // ...and the colliding row is untouched, still owned by user-b.
    const other = rows.find((row) => row.id === 'enr-other');
    expect(other?.userId).toBe('user-b');
    expect(other?.programId).toBe('prog-strong-at-home');
    expect(other?.enrolledAt.toISOString()).toBe('2026-01-01T00:00:00.000Z');
  });

  it('pins the (user_id, program_id) constraint name that the replacement maps', async () => {
    // A pair conflict is STRUCTURALLY UNREACHABLE through
    // replaceExpectedWithNew under this schema, so no replacement call can be
    // arranged to produce it:
    //  - the in-transaction identity guard requires `next`'s (userId, programId)
    //    to equal the deleted row's, and it runs BEFORE the insert;
    //  - the unique constraint guarantees no other row can own that pair while
    //    the expected row exists;
    //  - a concurrent create aiming at the same pair cannot slip in between the
    //    delete and the insert: it either conflicts with the still-live expected
    //    row, or waits on the deleting transaction's index entry and then
    //    conflicts with the replacement (or, if the replacement rolls back, with
    //    the restored row).
    // The mapping's precondition is therefore pinned at the narrowest valid
    // level instead: a real duplicate-pair insert produces exactly the
    // constraint name the repository translates on. (The PK-collision test
    // above proves a different unique violation is NOT translated.)
    await programEnrollmentRepository.create(
      enrollment('enr-1', 'user-a', 'prog-beginner-strength'),
    );

    const error = await db
      .insert(programEnrollments)
      .values({
        id: 'enr-dup',
        userId: 'user-a',
        programId: 'prog-beginner-strength',
        enrolledAt: new Date('2026-02-01T00:00:00Z'),
      })
      .then(
        () => null,
        (thrown: unknown) => thrown,
      );

    expect(isUniqueViolation(error)).toBe(true);
    expect(pgConstraintName(error)).toBe('program_enrollments_user_program_unique');

    // The raw duplicate insert did not land: the pair still has one owner.
    expect((await enrollmentRows()).map((row) => row.id)).toEqual(['enr-1']);
  });

  it('rolls back a replacement whose program identity mismatches the expected row', async () => {
    await programEnrollmentRepository.create(
      enrollment('enr-1', 'user-a', 'prog-beginner-strength'),
    );
    await attachSession('sess-1', 'user-a', 'enr-1');

    const error = await programEnrollmentRepository
      .replaceExpectedWithNew(
        enid('enr-1'),
        enrollment('enr-2', 'user-a', 'prog-strong-at-home', '2026-04-01T10:00:00Z'),
      )
      .then(
        () => null,
        (thrown: unknown) => thrown,
      );

    expect(error).toBeInstanceOf(EnrollmentIdentityMismatchError);
    // The delete executed inside the transaction was rolled back...
    const rows = await enrollmentRows();
    expect(rows.map((row) => row.id)).toEqual(['enr-1']);
    // ...the replacement was not inserted...
    expect(rows.some((row) => row.id === 'enr-2')).toBe(false);
    // ...and the session is still attached to the old enrollment.
    const sessions = await sessionRows();
    expect(sessions.map((session) => [session.id, session.enrollmentId])).toEqual([
      ['sess-1', 'enr-1'],
    ]);
  });

  it('rolls back a replacement whose user identity mismatches the expected row', async () => {
    await programEnrollmentRepository.create(
      enrollment('enr-1', 'user-a', 'prog-beginner-strength'),
    );
    await attachSession('sess-1', 'user-a', 'enr-1');

    const error = await programEnrollmentRepository
      .replaceExpectedWithNew(
        enid('enr-1'),
        enrollment('enr-2', 'user-b', 'prog-beginner-strength', '2026-04-01T10:00:00Z'),
      )
      .then(
        () => null,
        (thrown: unknown) => thrown,
      );

    expect(error).toBeInstanceOf(EnrollmentIdentityMismatchError);
    const rows = await enrollmentRows();
    expect(rows.map((row) => row.id)).toEqual(['enr-1']);
    expect(rows[0]?.userId).toBe('user-a');
    const sessions = await sessionRows();
    expect(sessions.map((session) => [session.id, session.enrollmentId])).toEqual([
      ['sess-1', 'enr-1'],
    ]);
  });
});

afterAll(async () => {
  await closeDatabase();
});
