/**
 * M17 Slice 3 — `not_performed_workouts` schema contract on real PostgreSQL.
 *
 * Pins the generated migration's shape and its lifecycle rules: the three fact
 * columns, the composite primary key that enforces one settlement per occurrence
 * per run (I1), the enrollment CASCADE that makes a fact run-scoped, the
 * scheduled-workout RESTRICT that protects seeded reference data, the standalone
 * index the FK restrict check needs, and the deliberately ABSENT session foreign
 * key.
 *
 * Every scenario runs against real rows and real constraint failures.
 */

import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { errorCode, pgConstraintName } from '@/infrastructure/database/pg-error';

import { countFacts, insertFact } from './not-performed-fixtures';
import {
  enrollmentIdValue,
  seedCompletedRun,
  seedEnrolledRun,
  type PlannedRunFixture,
} from './planned-workout-fixtures';
import { client, closeDatabase, resetAndSeed } from './setup';

const OWNER = 'not-performed-schema-owner';
const OTHER_OWNER = 'not-performed-schema-other';
const PROGRAM_SLUG = 'fit40-beginner-strength';
const RUN = enrollmentIdValue('enr-not-performed-a');
const OTHER_RUN = enrollmentIdValue('enr-not-performed-b');

const PK = 'not_performed_workouts_enrollment_id_scheduled_workout_id_pk';
const ENROLLMENT_FK = 'not_performed_workouts_enrollment_id_program_enrollments_id_fk';
/**
 * PostgreSQL truncates identifiers to 63 bytes, and this name is 69 bytes
 * before truncation (`…_scheduled_workout_id_scheduled_workouts_id_fk`), so the
 * catalog holds the 63-byte prefix — without the trailing `id_fk`. Pinned here
 * because a later M17 write slice that translates a foreign-key violation must
 * compare against the name PostgreSQL actually stores.
 */
const WORKOUT_FK = 'not_performed_workouts_scheduled_workout_id_scheduled_workouts_';

const RECORDED_AT = '2026-09-28T18:30:00.000Z';

/** Dedicated run for the session-independence scenarios (own user + enrollment). */
const SESSION_OWNER = 'not-performed-session-owner';
const SESSION_RUN = enrollmentIdValue('enr-not-performed-sessions');

/** Runs a statement expected to fail and reports its SQLSTATE and constraint. */
async function capturePgError(
  statement: () => Promise<unknown>,
): Promise<{ readonly code: unknown; readonly constraint: string | undefined }> {
  try {
    await statement();
  } catch (error) {
    return { code: errorCode(error), constraint: pgConstraintName(error) };
  }
  throw new Error('expected the statement to fail');
}

/** The first three authored occurrences of the seeded run. */
function firstOccurrences(fixture: PlannedRunFixture): ReadonlyArray<string> {
  const [first, second] = fixture.occurrenceIds;
  if (first === undefined || second === undefined) {
    throw new Error('expected at least two authored occurrences');
  }
  return [first, second];
}

afterAll(async () => {
  await closeDatabase();
});

describe('not_performed_workouts schema', () => {
  let run: PlannedRunFixture;

  beforeEach(async () => {
    await resetAndSeed();
    run = await seedEnrolledRun({ owner: OWNER, programSlug: PROGRAM_SLUG, enrollmentId: RUN });
  });

  it('stores exactly the three fact columns, all NOT NULL', async () => {
    const rows = await client<{ column_name: string; data_type: string; is_nullable: string }[]>`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'not_performed_workouts'
      ORDER BY column_name
    `;

    expect(rows.map((row) => row.column_name)).toEqual([
      'enrollment_id',
      'recorded_at',
      'scheduled_workout_id',
    ]);
    const nullable = new Map(rows.map((row) => [row.column_name, row.is_nullable]));
    expect(nullable.get('enrollment_id')).toBe('NO');
    expect(nullable.get('scheduled_workout_id')).toBe('NO');
    expect(nullable.get('recorded_at')).toBe('NO');
    // A zoneless timestamp would let a viewer's timezone move the recorded
    // instant, so the column must be timestamptz (the repo-wide UTC rule).
    const recordedType = rows.find((row) => row.column_name === 'recorded_at')?.data_type;
    expect(recordedType).toBe('timestamp with time zone');
  });

  it('keys one settlement per occurrence per run with the composite primary key', async () => {
    const rows = await client<{ conname: string; definition: string }[]>`
      SELECT conname, pg_get_constraintdef(oid) AS definition
      FROM pg_constraint
      WHERE conrelid = 'not_performed_workouts'::regclass AND contype = 'p'
    `;

    expect(rows).toHaveLength(1);
    expect(rows[0]?.conname).toBe(PK);
    expect(rows[0]?.definition).toContain('PRIMARY KEY (enrollment_id, scheduled_workout_id)');
  });

  it('has exactly the two locked foreign keys', async () => {
    const rows = await client<{ conname: string; confdeltype: string }[]>`
      SELECT conname, confdeltype
      FROM pg_constraint
      WHERE conrelid = 'not_performed_workouts'::regclass AND contype = 'f'
      ORDER BY conname
    `;

    const rules = new Map(rows.map((row) => [row.conname, row.confdeltype]));
    // 'c' = ON DELETE CASCADE, 'r' = ON DELETE RESTRICT.
    expect(rows).toHaveLength(2);
    expect(rules.get(ENROLLMENT_FK)).toBe('c');
    expect(rules.get(WORKOUT_FK)).toBe('r');
  });

  it('has no foreign key to workout_sessions', async () => {
    const rows = await client<{ conname: string; referenced: string }[]>`
      SELECT conname, pg_get_constraintdef(oid) AS referenced
      FROM pg_constraint
      WHERE conrelid = 'not_performed_workouts'::regclass AND contype = 'f'
    `;

    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.referenced).not.toContain('workout_sessions');
    }
  });

  it('indexes scheduled_workout_id for FK restrict checks', async () => {
    const rows = await client<{ indexname: string }[]>`
      SELECT indexname FROM pg_indexes WHERE tablename = 'not_performed_workouts'
    `;

    expect(rows.map((row) => row.indexname)).toContain(
      'not_performed_workouts_scheduled_workout_id_idx',
    );
  });

  it('rejects a duplicate settlement for the same occurrence and run', async () => {
    const [first] = firstOccurrences(run);
    if (first === undefined) throw new Error('unreachable: occurrences were checked');

    await insertFact({ enrollmentId: RUN, scheduledWorkoutId: first, recordedAt: RECORDED_AT });

    const failure = await capturePgError(() =>
      insertFact({ enrollmentId: RUN, scheduledWorkoutId: first, recordedAt: '2026-09-29T08:00:00.000Z' }),
    );

    // SQLSTATE 23505 = unique_violation, and the constraint is named exactly as
    // the generated migration created it.
    expect(failure.code).toBe('23505');
    expect(failure.constraint).toBe(PK);
    expect(await countFacts(RUN)).toBe(1);
  });

  it('rejects a null recorded instant', async () => {
    const [first] = firstOccurrences(run);
    if (first === undefined) throw new Error('unreachable: occurrences were checked');

    const failure = await capturePgError(() =>
      client`
        INSERT INTO not_performed_workouts (enrollment_id, scheduled_workout_id, recorded_at)
        VALUES (${RUN}, ${first}, NULL)
      `,
    );

    // SQLSTATE 23502 = not_null_violation.
    expect(failure.code).toBe('23502');
  });

  it('lets the same authored occurrence be recorded by a different run', async () => {
    const [first] = firstOccurrences(run);
    if (first === undefined) throw new Error('unreachable: occurrences were checked');

    // A second run of the SAME program: the authored occurrence id is shared by
    // every run of a program, so the enrollment is what makes the fact unique.
    // The scenario is relationally valid because a different user may enroll in
    // the same program (`program_enrollments_user_program_unique`).
    const otherRun = await seedEnrolledRun({
      owner: OTHER_OWNER,
      programSlug: PROGRAM_SLUG,
      enrollmentId: OTHER_RUN,
    });

    await insertFact({ enrollmentId: RUN, scheduledWorkoutId: first, recordedAt: RECORDED_AT });
    await insertFact({
      enrollmentId: OTHER_RUN,
      scheduledWorkoutId: first,
      recordedAt: RECORDED_AT,
    });

    expect(otherRun.occurrenceIds).toContain(first);
    expect(await countFacts(RUN)).toBe(1);
    expect(await countFacts(OTHER_RUN)).toBe(1);
  });

  it('cascades facts when the run is deleted while sessions only detach', async () => {
    const completed = await seedCompletedRun({
      owner: SESSION_OWNER,
      programSlug: PROGRAM_SLUG,
      enrollmentId: SESSION_RUN,
    });
    const sessionRunOccurrences = completed.occurrenceIds;
    const [first] = sessionRunOccurrences;
    if (first === undefined) throw new Error('expected an authored occurrence');
    const sessionId = completed.sessionIds[0];
    if (sessionId === undefined) throw new Error('expected a completed session');

    await insertFact({ enrollmentId: SESSION_RUN, scheduledWorkoutId: first, recordedAt: RECORDED_AT });
    expect(await countFacts(SESSION_RUN)).toBe(1);

    await client`DELETE FROM program_enrollments WHERE id = ${SESSION_RUN}`;

    // Run-scoped execution truth: the fact dies with the run (no archive, no
    // detach-on-restart)...
    expect(await countFacts(SESSION_RUN)).toBe(0);
    // ...while completed session history is governed by its own lifecycle and
    // merely detaches, exactly as before M17.
    const sessions = await client<{ id: string; enrollment_id: string | null }[]>`
      SELECT id, enrollment_id FROM workout_sessions WHERE id = ${sessionId}
    `;
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.enrollment_id).toBeNull();
  });

  it('restricts deleting an authored scheduled workout a fact references', async () => {
    const [first] = firstOccurrences(run);
    if (first === undefined) throw new Error('unreachable: occurrences were checked');

    await insertFact({ enrollmentId: RUN, scheduledWorkoutId: first, recordedAt: RECORDED_AT });

    const failure = await capturePgError(
      () => client`DELETE FROM scheduled_workouts WHERE id = ${first}`,
    );

    // `ON DELETE RESTRICT` raises SQLSTATE 23001 (restrict_violation), not 23503
    // (foreign_key_violation, which is what a NO ACTION check reports), and it
    // names this table's FK: seeded authored structure is never deletable from a
    // user's recorded facts.
    expect(failure.code).toBe('23001');
    expect(failure.constraint).toBe(WORKOUT_FK);
    expect(await countFacts(RUN)).toBe(1);
  });

  it('keeps a fact when its session row is deleted', async () => {
    const completed = await seedCompletedRun({
      owner: SESSION_OWNER,
      programSlug: PROGRAM_SLUG,
      enrollmentId: SESSION_RUN,
    });
    const [first] = completed.occurrenceIds;
    if (first === undefined) throw new Error('expected an authored occurrence');
    const sessionId = completed.sessionIds[0];
    if (sessionId === undefined) throw new Error('expected a completed session');

    // The same occurrence carries both a completed session and a recorded fact
    // here only to prove the columns are independent: this combination is
    // rejected by the Domain taxonomy (M17 I1), and the database deliberately
    // does not model it as a relation.
    await insertFact({ enrollmentId: SESSION_RUN, scheduledWorkoutId: first, recordedAt: RECORDED_AT });

    await client`DELETE FROM workout_sessions WHERE id = ${sessionId}`;

    expect(await countFacts(SESSION_RUN)).toBe(1);
    const facts = await client<{ recorded_at: Date | string }[]>`
      SELECT recorded_at FROM not_performed_workouts WHERE enrollment_id = ${SESSION_RUN}
    `;
    const fact = facts[0];
    if (fact === undefined) throw new Error('expected the fact to survive');
    expect(facts).toHaveLength(1);
    expect(new Date(fact.recorded_at).toISOString()).toBe(RECORDED_AT);
  });
});