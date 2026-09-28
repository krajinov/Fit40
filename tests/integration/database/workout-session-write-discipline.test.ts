/**
 * M17 Slice 4 — workout-session write discipline on real PostgreSQL.
 *
 * `save` UPDATEs and refuses to resurrect: an aggregate whose row no longer
 * exists cannot recreate it, it fails as stale. This is what makes the
 * settlement transaction's hard deletion of an abandoned session safe — before
 * Slice 4 a stale aggregate could recreate a row the run no longer had, so the
 * first production DELETE would have been unsound.
 *
 * Slice 6 removed the repository's INSERT entirely (creation is owned by
 * `DrizzleRunOccurrenceWrites.createSessionForOccurrence`), so sessions are
 * seeded here through the shared `insertSession` fixture. What remains under
 * test is the CONTENT discipline of the update path: version monotonicity, the
 * optimistic-concurrency predicate, the enrollment-identity predicate, and the
 * structural fact that this repository can only UPDATE.
 *
 * The load-bearing scenario is "save() cannot resurrect a session whose row was
 * hard-deleted": it FAILS against the pre-Slice-4 upsert behaviour.
 */

import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import {
  createWorkoutSession,
  logSessionSet,
  type WorkoutSession,
} from '@/domain/entities/workout-session';
import { createProgramEnrollment } from '@/domain/entities/program-enrollment';
import {
  createEnrollmentId,
  createExerciseId,
  createScheduledWorkoutId,
  createUserId,
  createWorkoutId,
  type EnrollmentId,
} from '@/domain/types/ids';
import { createRepScheme } from '@/domain/value-objects/rep-prescription';

import {
  SessionEnrollmentChangedError,
  SessionStaleVersionError,
} from '@/application/ports/workout-session-repository';
import { DrizzleWorkoutSessionRepository } from '@/infrastructure/database/repositories/drizzle-workout-session-repository';
import * as schema from '@/infrastructure/database/schema';

import {
  client,
  closeDatabase,
  programEnrollmentRepository,
  programRepository,
  resetAndSeed,
  workoutSessionRepository,
} from './setup';
import { getTestDatabaseUrl } from './test-env';
import { insertSession } from './session-fixtures';

const OWNER = 'write-discipline-user';
const PROGRAM_SLUG = 'fit40-beginner-strength';
/** The authored occurrence and its template from the seeded program. */
const OCCURRENCE = 'fit40-beginner-strength-w1-1';
const WORKOUT = 'wo-beginner-strength-a';

function enrollmentIdValue(value: string): EnrollmentId {
  const result = createEnrollmentId(value);
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

const RUN = enrollmentIdValue('enrollment-write-discipline');

function exerciseId(value: string) {
  const result = createExerciseId(value);
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

function scheduledWorkoutId(value: string) {
  const result = createScheduledWorkoutId(value);
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

function workoutId(value: string) {
  const result = createWorkoutId(value);
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

function userIdValue(value: string) {
  const result = createUserId(value);
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

function reps() {
  const result = createRepScheme(3, 8, 10);
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

function makeSession(
  id: string,
  overrides: {
    readonly enrollmentId?: string | null;
    readonly scheduledWorkoutId?: string;
    readonly workoutId?: string;
    readonly startedAt?: string;
  } = {},
): WorkoutSession {
  const result = createWorkoutSession({
    id,
    userId: userIdValue(OWNER),
    enrollmentId:
      overrides.enrollmentId === undefined
        ? RUN
        : overrides.enrollmentId === null
          ? null
          : enrollmentIdValue(overrides.enrollmentId),
    scheduledWorkoutId: scheduledWorkoutId(overrides.scheduledWorkoutId ?? OCCURRENCE),
    workoutId: workoutId(overrides.workoutId ?? WORKOUT),
    startedAt: new Date(overrides.startedAt ?? '2026-09-21T10:00:00Z'),
    exerciseLogs: [
      {
        authoredExerciseId: exerciseId('ex-002'),
        order: 1,
        prescription: reps(),
        restSeconds: 90,
      },
    ],
  });
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

function withOneSet(session: WorkoutSession): WorkoutSession {
  const logged = logSessionSet(session, {
    exerciseOrder: 1,
    type: 'reps',
    reps: 10,
    weightKg: 20,
    rpe: 7,
  });
  if (!logged.ok) throw new Error(logged.error.message);
  return logged.data;
}

async function countRows(table: 'workout_sessions' | 'exercise_logs'): Promise<number> {
  const rows =
    table === 'workout_sessions'
      ? await client<{ count: string }[]>`SELECT count(*)::text AS count FROM workout_sessions`
      : await client<{ count: string }[]>`SELECT count(*)::text AS count FROM exercise_logs`;
  const [row] = rows;
  if (row === undefined) throw new Error('count(*) returned no row');
  return Number.parseInt(row.count, 10);
}

afterAll(async () => {
  await closeDatabase();
});

describe('DrizzleWorkoutSessionRepository — create vs save', () => {
  beforeEach(async () => {
    await resetAndSeed();
    await client`
      INSERT INTO users (id, email, password_hash)
      VALUES (${OWNER}, ${`${OWNER}@example.test`}, 'x')
    `;
    const program = await programRepository.findBySlug(PROGRAM_SLUG);
    if (program === null) throw new Error(`seed program "${PROGRAM_SLUG}" is missing`);

    const enrollment = createProgramEnrollment({
      id: RUN,
      userId: OWNER,
      programId: program.id,
      enrolledAt: new Date('2026-01-01T00:00:00Z'),
    });
    if (!enrollment.ok) throw new Error(enrollment.error.message);
    await programEnrollmentRepository.create(enrollment.data);
  });

  it('save() cannot resurrect a session whose row was hard-deleted', async () => {
    const stale = makeSession('session-resurrect');
    expect((await insertSession(stale)).version).toBe(stale.version);

    // The row is hard-deleted behind a live request that still holds the
    // aggregate — the situation M17's settlement transaction creates.
    await client`DELETE FROM workout_sessions WHERE id = ${stale.id}`;
    expect(await workoutSessionRepository.findById(stale.id)).toBeNull();

    await expect(workoutSessionRepository.save(stale)).rejects.toBeInstanceOf(
      SessionStaleVersionError,
    );

    // The stale writer wrote nothing: the row is still absent and no orphan
    // child rows were created for it.
    expect(await workoutSessionRepository.findById(stale.id)).toBeNull();
    expect(await countRows('workout_sessions')).toBe(0);
    expect(await countRows('exercise_logs')).toBe(0);
  });

  it('has no INSERT path left: the repository cannot create a session at all', async () => {
    const session = makeSession('session-no-create');

    // Structural: creation belongs to the enrollment-serialized authority, so
    // this repository exposes no create operation to seed through — even the
    // seeding fixture has to go to the shared INSERT statements directly.
    expect('create' in workoutSessionRepository).toBe(false);

    const loaded = await workoutSessionRepository.findById(session.id);
    expect(loaded).toBeNull();
    expect(await countRows('workout_sessions')).toBe(0);
  });

  it('save() updates an existing aggregate and bumps the version by one', async () => {
    const created = await insertSession(makeSession('session-update'));

    const saved = await workoutSessionRepository.save(withOneSet(created));

    expect(saved.version).toBe(created.version + 1);
    const loaded = await workoutSessionRepository.findById(created.id);
    expect(loaded?.version).toBe(created.version + 1);
    expect(loaded?.exerciseLogs[0]?.sets).toHaveLength(1);
    // Still exactly one session row: an update never adds one.
    expect(await countRows('workout_sessions')).toBe(1);
  });

  it('keeps the version monotonic across seeding and repeated saves', async () => {
    const created = await insertSession(makeSession('session-version'));
    const firstSave = await workoutSessionRepository.save(withOneSet(created));
    const secondSave = await workoutSessionRepository.save(withOneSet(firstSave));

    expect([created.version, firstSave.version, secondSave.version]).toEqual([
      created.version,
      created.version + 1,
      created.version + 2,
    ]);
  });

  it('save() rejects a stale snapshot without changing the stored row', async () => {
    const created = await insertSession(makeSession('session-stale'));
    const firstSave = await workoutSessionRepository.save(withOneSet(created));

    await expect(workoutSessionRepository.save(withOneSet(created))).rejects.toBeInstanceOf(
      SessionStaleVersionError,
    );

    const stored = await workoutSessionRepository.findById(created.id);
    expect(stored?.version).toBe(firstSave.version);
    expect(stored?.exerciseLogs[0]?.sets).toHaveLength(1);
  });

  it('save() keeps the enrollment predicate: a detached row refuses the mutation', async () => {
    const created = await insertSession(makeSession('session-detached'));

    // A concurrent leave detaches the row (ON DELETE SET NULL).
    await client`UPDATE workout_sessions SET enrollment_id = NULL WHERE id = ${created.id}`;

    await expect(workoutSessionRepository.save(withOneSet(created))).rejects.toBeInstanceOf(
      SessionEnrollmentChangedError,
    );

    const stored = await workoutSessionRepository.findById(created.id);
    expect(stored?.enrollmentId).toBeNull();
    expect(stored?.version).toBe(created.version);
    expect(stored?.exerciseLogs[0]?.sets).toHaveLength(0);
  });

  it('issues an UPDATE for save and never an INSERT into workout_sessions', async () => {
    const session = makeSession('session-statements');
    await insertSession(session);

    const queries: string[] = [];
    const countingClient = postgres(getTestDatabaseUrl(), {
      max: 1,
      debug: (_connection: number, query: string) => {
        const normalized = query.trim().toLowerCase();
        if (/^(select|insert|update|delete)/.test(normalized)) {
          queries.push(normalized);
        }
      },
    });

    try {
      const repo = new DrizzleWorkoutSessionRepository(
        drizzle(countingClient, { schema }),
      );

      await repo.save(withOneSet(session));
      const saveStatements = [...queries];

      // save: exactly one parent UPDATE and no session INSERT at all — the
      // structural reason a deleted row cannot come back. (Child rows are
      // re-inserted by the update path, which is why only the parent table is
      // asserted here.)
      expect(saveStatements.some((q) => q.startsWith('update "workout_sessions"'))).toBe(true);
      expect(saveStatements.some((q) => q.startsWith('insert into "workout_sessions"'))).toBe(
        false,
      );
      expect(saveStatements.some((q) => q.includes('on conflict'))).toBe(false);
    } finally {
      await countingClient.end();
    }
  });
});