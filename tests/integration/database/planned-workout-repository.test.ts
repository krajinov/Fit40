/**
 * M15 Slice 2 — DrizzlePlannedWorkoutRepository on real PostgreSQL.
 *
 * Proves the persistence contract end to end: the DATE column round-trips as a
 * canonical string, both unique constraints and both foreign keys guard the
 * table, the repository's pre-mutation invariant gate protects the run, the
 * single expected business conflict (an occupied date) is the only translated
 * violation, and every write is bounded and parent-first (the enrollment row is
 * locked with FOR NO KEY UPDATE before any planned row is touched).
 *
 * The lifecycle and concurrency suites live beside this file.
 */

import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import {
  PlannedDateConflictError,
  PlannedWorkoutEnrollmentMismatchError,
  PlannedWorkoutSetConflictError,
} from '@/application/ports/planned-workout-repository';
import { errorCode, pgConstraintName } from '@/infrastructure/database/pg-error';
import { DrizzlePlannedWorkoutRepository } from '@/infrastructure/database/repositories/drizzle-planned-workout-repository';
import * as schema from '@/infrastructure/database/schema';

import {
  enrollmentIdValue,
  plannedDate,
  plannedLines,
  plannedSetFor,
  plannedWorkout,
  scheduledWorkoutIdValue,
  seedEnrolledRun,
  type PlannedRunFixture,
} from './planned-workout-fixtures';
import {
  client,
  closeDatabase,
  plannedWorkoutRepository,
  programEnrollmentRepository,
  resetAndSeed,
} from './setup';
import { getTestDatabaseUrl } from './test-env';

const OWNER = 'planned-repo-owner';
const OTHER_OWNER = 'planned-repo-other';
/** 18 authored occurrences: large enough to prove statements do not scale. */
const PROGRAM_SLUG = 'fit40-beginner-strength';
/** Branded enrollment ids: they satisfy the port's types and the raw string uses. */
const RUN = enrollmentIdValue('enr-planned-a');
const OTHER_RUN = enrollmentIdValue('enr-planned-b');

const ENROLLMENT_DATE_UNIQUE = 'planned_workouts_enrollment_date_unique';
const OCCURRENCE_PK = 'planned_workouts_enrollment_id_scheduled_workout_id_pk';

/** Raw insert, for the constraints only the database can enforce. */
async function rawInsert(values: {
  readonly enrollmentId: string;
  readonly scheduledWorkoutId: string;
  readonly plannedDate: string;
}): Promise<unknown> {
  return client`
    INSERT INTO planned_workouts (enrollment_id, scheduled_workout_id, planned_date)
    VALUES (${values.enrollmentId}, ${values.scheduledWorkoutId}, ${values.plannedDate}::date)
  `;
}

/** Runs a statement expected to fail and reports its SQLSTATE and constraint. */
async function capturePgError(
  run: () => Promise<unknown>,
): Promise<{ readonly code: unknown; readonly constraint: string | undefined }> {
  try {
    await run();
  } catch (error) {
    return { code: errorCode(error), constraint: pgConstraintName(error) };
  }
  throw new Error('expected the statement to fail');
}

/** The first three authored occurrences of the seeded run. */
function firstOccurrences(fixture: PlannedRunFixture): {
  readonly first: string;
  readonly second: string;
  readonly third: string;
} {
  const [first, second, third] = fixture.occurrenceIds;
  if (first === undefined || second === undefined || third === undefined) {
    throw new Error('expected at least three authored occurrences');
  }
  return { first, second, third };
}

describe('DrizzlePlannedWorkoutRepository — persistence on PostgreSQL', () => {
  let run: PlannedRunFixture;

  beforeEach(async () => {
    await resetAndSeed();
    run = await seedEnrolledRun({ owner: OWNER, programSlug: PROGRAM_SLUG, enrollmentId: RUN });
  });

  it('round-trips a run’s planning and keeps the date a canonical string', async () => {
    const planned = plannedSetFor(run.program, RUN, '2026-10-01');

    expect(await plannedWorkoutRepository.replaceAllForEnrollment(RUN, planned)).toBe(true);

    const listed = await plannedWorkoutRepository.listByEnrollment(RUN);
    expect(plannedLines(listed)).toEqual(plannedLines(planned));
    expect(listed).toHaveLength(run.occurrenceIds.length);
    for (const row of listed) {
      expect(typeof row.plannedDate).toBe('string');
      expect(row.plannedDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it('returns an empty list for a run that has no planning', async () => {
    expect(await plannedWorkoutRepository.listByEnrollment(RUN)).toEqual([]);
  });

  it('reads only the addressed run, in deterministic calendar order', async () => {
    const other = await seedEnrolledRun({
      owner: OTHER_OWNER,
      programSlug: PROGRAM_SLUG,
      enrollmentId: OTHER_RUN,
    });
    await plannedWorkoutRepository.replaceAllForEnrollment(
      OTHER_RUN,
      plannedSetFor(other.program, OTHER_RUN, '2027-01-01'),
    );
    const { first, second, third } = firstOccurrences(run);

    // Supplied out of order on purpose.
    await plannedWorkoutRepository.replaceAllForEnrollment(RUN, [
      plannedWorkout(RUN, third, '2026-10-03'),
      plannedWorkout(RUN, first, '2026-10-01'),
      plannedWorkout(RUN, second, '2026-10-02'),
    ]);

    expect(plannedLines(await plannedWorkoutRepository.listByEnrollment(RUN))).toEqual([
      `${first}@2026-10-01`,
      `${second}@2026-10-02`,
      `${third}@2026-10-03`,
    ]);
  });

  it('rejects a second row for the same occurrence with the composite primary key', async () => {
    const { first } = firstOccurrences(run);
    await plannedWorkoutRepository.replaceAllForEnrollment(RUN, [
      plannedWorkout(RUN, first, '2026-10-01'),
    ]);

    const failure = await capturePgError(() =>
      rawInsert({ enrollmentId: RUN, scheduledWorkoutId: first, plannedDate: '2026-10-02' }),
    );

    expect(failure.code).toBe('23505');
    expect(failure.constraint).toBe(OCCURRENCE_PK);
  });

  it('rejects two occurrences on one date with the named date-unique constraint', async () => {
    const { first, second } = firstOccurrences(run);
    await plannedWorkoutRepository.replaceAllForEnrollment(RUN, [
      plannedWorkout(RUN, first, '2026-10-01'),
    ]);

    const failure = await capturePgError(() =>
      rawInsert({ enrollmentId: RUN, scheduledWorkoutId: second, plannedDate: '2026-10-01' }),
    );

    // The exact name the repository translates; the primary key name above is
    // different, which is what keeps the translation name-gated.
    expect(failure.code).toBe('23505');
    expect(failure.constraint).toBe(ENROLLMENT_DATE_UNIQUE);
    expect(ENROLLMENT_DATE_UNIQUE).not.toBe(OCCURRENCE_PK);
  });

  it('allows the same date in two different runs', async () => {
    const other = await seedEnrolledRun({
      owner: OTHER_OWNER,
      programSlug: PROGRAM_SLUG,
      enrollmentId: OTHER_RUN,
    });
    const { first } = firstOccurrences(run);

    await plannedWorkoutRepository.replaceAllForEnrollment(RUN, [
      plannedWorkout(RUN, first, '2026-10-01'),
    ]);
    const inserted = await rawInsert({
      enrollmentId: OTHER_RUN,
      scheduledWorkoutId: other.occurrenceIds[0] ?? '',
      plannedDate: '2026-10-01',
    });

    expect(inserted).toBeDefined();
    expect(await plannedWorkoutRepository.listByEnrollment(RUN)).toHaveLength(1);
    expect(await plannedWorkoutRepository.listByEnrollment(OTHER_RUN)).toHaveLength(1);
  });

  it('rejects a planned row for an enrollment that does not exist', async () => {
    const { first } = firstOccurrences(run);

    const failure = await capturePgError(() =>
      rawInsert({
        enrollmentId: 'enr-does-not-exist',
        scheduledWorkoutId: first,
        plannedDate: '2026-10-01',
      }),
    );

    expect(failure.code).toBe('23503');
    expect(failure.constraint).toBe('planned_workouts_enrollment_id_program_enrollments_id_fk');
  });

  it('rejects a planned row for a scheduled workout that does not exist', async () => {
    const failure = await capturePgError(() =>
      rawInsert({ enrollmentId: RUN, scheduledWorkoutId: 'w9-9-unknown', plannedDate: '2026-10-01' }),
    );

    expect(failure.code).toBe('23503');
    expect(failure.constraint).toBe(
      'planned_workouts_scheduled_workout_id_scheduled_workouts_id_fk',
    );
  });
});

describe('DrizzlePlannedWorkoutRepository — invariant gate and absence', () => {
  let run: PlannedRunFixture;

  beforeEach(async () => {
    await resetAndSeed();
    run = await seedEnrolledRun({ owner: OWNER, programSlug: PROGRAM_SLUG, enrollmentId: RUN });
  });

  it('replaces the whole set, not merely the rows it received', async () => {
    const planned = plannedSetFor(run.program, RUN, '2026-10-01');
    await plannedWorkoutRepository.replaceAllForEnrollment(RUN, planned);
    const { first } = firstOccurrences(run);

    const replaced = await plannedWorkoutRepository.replaceAllForEnrollment(RUN, [
      plannedWorkout(RUN, first, '2027-03-01'),
    ]);

    expect(replaced).toBe(true);
    expect(plannedLines(await plannedWorkoutRepository.listByEnrollment(RUN))).toEqual([
      `${first}@2027-03-01`,
    ]);
  });

  it('accepts an empty set and clears the run', async () => {
    await plannedWorkoutRepository.replaceAllForEnrollment(
      RUN,
      plannedSetFor(run.program, RUN, '2026-10-01'),
    );

    expect(await plannedWorkoutRepository.replaceAllForEnrollment(RUN, [])).toBe(true);
    expect(await plannedWorkoutRepository.listByEnrollment(RUN)).toEqual([]);
  });

  it('refuses a cross-enrollment row before destroying the current planning', async () => {
    const other = await seedEnrolledRun({
      owner: OTHER_OWNER,
      programSlug: PROGRAM_SLUG,
      enrollmentId: OTHER_RUN,
    });
    const planned = plannedSetFor(run.program, RUN, '2026-10-01');
    await plannedWorkoutRepository.replaceAllForEnrollment(RUN, planned);
    const foreign = plannedWorkout(OTHER_RUN, other.occurrenceIds[0] ?? '', '2027-05-01');

    await expect(
      plannedWorkoutRepository.replaceAllForEnrollment(RUN, [foreign]),
    ).rejects.toBeInstanceOf(PlannedWorkoutEnrollmentMismatchError);

    // Untouched: the guard runs before the transaction opens.
    expect(plannedLines(await plannedWorkoutRepository.listByEnrollment(RUN))).toEqual(
      plannedLines(planned),
    );
    expect(await plannedWorkoutRepository.listByEnrollment(OTHER_RUN)).toEqual([]);
  });

  it('refuses a duplicated occurrence before mutating', async () => {
    const planned = plannedSetFor(run.program, RUN, '2026-10-01');
    await plannedWorkoutRepository.replaceAllForEnrollment(RUN, planned);
    const { first } = firstOccurrences(run);

    await expect(
      plannedWorkoutRepository.replaceAllForEnrollment(RUN, [
        plannedWorkout(RUN, first, '2027-01-01'),
        plannedWorkout(RUN, first, '2027-01-02'),
      ]),
    ).rejects.toBeInstanceOf(PlannedWorkoutSetConflictError);

    expect(plannedLines(await plannedWorkoutRepository.listByEnrollment(RUN))).toEqual(
      plannedLines(planned),
    );
  });

  it('refuses two occurrences on one date before mutating', async () => {
    const planned = plannedSetFor(run.program, RUN, '2026-10-01');
    await plannedWorkoutRepository.replaceAllForEnrollment(RUN, planned);
    const { first, second } = firstOccurrences(run);

    await expect(
      plannedWorkoutRepository.replaceAllForEnrollment(RUN, [
        plannedWorkout(RUN, first, '2027-01-01'),
        plannedWorkout(RUN, second, '2027-01-01'),
      ]),
    ).rejects.toBeInstanceOf(PlannedWorkoutSetConflictError);

    expect(plannedLines(await plannedWorkoutRepository.listByEnrollment(RUN))).toEqual(
      plannedLines(planned),
    );
  });

  it('returns false and writes nothing when the run no longer exists', async () => {
    const planned = plannedSetFor(run.program, RUN, '2026-10-01');
    await plannedWorkoutRepository.replaceAllForEnrollment(RUN, planned);
    await programEnrollmentRepository.delete(RUN);

    const outcome = await plannedWorkoutRepository.replaceAllForEnrollment(RUN, [
      plannedWorkout(RUN, firstOccurrences(run).first, '2027-01-01'),
    ]);

    expect(outcome).toBe(false);
    expect(await plannedWorkoutRepository.listByEnrollment(RUN)).toEqual([]);
  });
});

describe('DrizzlePlannedWorkoutRepository — reschedule', () => {
  let run: PlannedRunFixture;

  beforeEach(async () => {
    await resetAndSeed();
    run = await seedEnrolledRun({ owner: OWNER, programSlug: PROGRAM_SLUG, enrollmentId: RUN });
    await plannedWorkoutRepository.replaceAllForEnrollment(
      RUN,
      plannedSetFor(run.program, RUN, '2026-10-01'),
    );
  });

  it('moves one planned workout to a free date and leaves the rest untouched', async () => {
    const { first, second } = firstOccurrences(run);
    const before = await plannedWorkoutRepository.listByEnrollment(RUN);

    const moved = await plannedWorkoutRepository.reschedule(
      RUN,
      scheduledWorkoutIdValue(first),
      plannedDate('2026-11-20'),
    );

    expect(moved).toBe(true);
    const after = await plannedWorkoutRepository.listByEnrollment(RUN);
    expect(after).toHaveLength(before.length);
    expect(plannedLines(after)).toContain(`${first}@2026-11-20`);
    expect(plannedLines(after)).toContain(`${second}@2026-10-02`);
  });

  it('throws PlannedDateConflictError when another planned workout holds the date', async () => {
    const { second } = firstOccurrences(run);

    const conflict = plannedWorkoutRepository.reschedule(
      RUN,
      scheduledWorkoutIdValue(second),
      plannedDate('2026-10-01'),
    );

    await expect(conflict).rejects.toBeInstanceOf(PlannedDateConflictError);
    expect(plannedLines(await plannedWorkoutRepository.listByEnrollment(RUN))).toContain(
      `${second}@2026-10-02`,
    );
  });

  it('returns false for an occurrence this run does not plan', async () => {
    const outcome = await plannedWorkoutRepository.reschedule(
      RUN,
      scheduledWorkoutIdValue('fit40-beginner-strength-w9-9'),
      plannedDate('2026-11-20'),
    );

    expect(outcome).toBe(false);
  });

  it('returns false and writes nothing when the run no longer exists', async () => {
    const { first } = firstOccurrences(run);
    await programEnrollmentRepository.delete(RUN);

    const outcome = await plannedWorkoutRepository.reschedule(
      RUN,
      scheduledWorkoutIdValue(first),
      plannedDate('2026-11-20'),
    );

    expect(outcome).toBe(false);
    expect(await plannedWorkoutRepository.listByEnrollment(RUN)).toEqual([]);
  });
});

describe('DrizzlePlannedWorkoutRepository — bounded, parent-first statements', () => {
  let run: PlannedRunFixture;

  beforeEach(async () => {
    await resetAndSeed();
    run = await seedEnrolledRun({ owner: OWNER, programSlug: PROGRAM_SLUG, enrollmentId: RUN });
  });

  /**
   * Runs `observe` with a dedicated counting client. Only data statements are
   * counted (transaction control is excluded), and the connection is warmed
   * first so postgres.js' one-time introspection is not part of the count.
   */
  async function withQueryLog<T>(
    observe: (repo: DrizzlePlannedWorkoutRepository, queries: string[]) => Promise<T>,
  ): Promise<T> {
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
      const countingDb = drizzle(countingClient, { schema });
      const repo = new DrizzlePlannedWorkoutRepository(countingDb);
      await repo.listByEnrollment(RUN);
      queries.length = 0;
      return await observe(repo, queries);
    } finally {
      await countingClient.end();
    }
  }

  it('reads a run with a single statement', async () => {
    await withQueryLog(async (repo, queries) => {
      await repo.listByEnrollment(RUN);

      expect(queries).toHaveLength(1);
      expect(queries[0]?.startsWith('select')).toBe(true);
    });
  });

  it('replaces the set with a locking parent read, a delete and one multi-row insert', async () => {
    const planned = plannedSetFor(run.program, RUN, '2026-10-01');

    await withQueryLog(async (repo, queries) => {
      expect(await repo.replaceAllForEnrollment(RUN, planned)).toBe(true);

      // Parent-first: the enrollment row is locked BEFORE any planned row is
      // touched. That ordering is what keeps lifecycle writes (M14 restart and
      // leave, which take the same parent row first) from forming a lock cycle.
      expect(queries).toHaveLength(3);
      expect(queries[0]).toContain('from "program_enrollments"');
      expect(queries[0]).toContain('for no key update');
      expect(queries[0]?.includes('planned_workouts')).toBe(false);
      expect(queries[1]?.startsWith('delete')).toBe(true);
      expect(queries[2]?.startsWith('insert')).toBe(true);
      // One multi-row INSERT, never one insert per planned workout.
      expect(queries[2]?.match(/values/g)).toHaveLength(1);
    });
  });

  it('clears the set with the parent lock and the delete only', async () => {
    await withQueryLog(async (repo, queries) => {
      expect(await repo.replaceAllForEnrollment(RUN, [])).toBe(true);

      expect(queries).toHaveLength(2);
      expect(queries[0]).toContain('for no key update');
      expect(queries[1]?.startsWith('delete')).toBe(true);
    });
  });

  it('keeps the statement count constant as the set grows', async () => {
    const small = plannedSetFor(run.program, RUN, '2026-10-01').slice(0, 3);
    const large = plannedSetFor(run.program, RUN, '2026-11-01');
    expect(large.length).toBeGreaterThan(small.length);

    const counts = await withQueryLog(async (repo, queries) => {
      await repo.replaceAllForEnrollment(RUN, small);
      const smallCount = queries.length;
      queries.length = 0;
      await repo.replaceAllForEnrollment(RUN, large);
      return { smallCount, largeCount: queries.length };
    });

    expect(counts.smallCount).toBe(3);
    expect(counts.largeCount).toBe(3);
  });

  it('reschedules with a parent lock and a single update', async () => {
    const { first } = firstOccurrences(run);
    await plannedWorkoutRepository.replaceAllForEnrollment(
      RUN,
      plannedSetFor(run.program, RUN, '2026-10-01'),
    );

    await withQueryLog(async (repo, queries) => {
      const moved = await repo.reschedule(
        RUN,
        scheduledWorkoutIdValue(first),
        plannedDate('2026-12-01'),
      );

      expect(moved).toBe(true);
      expect(queries).toHaveLength(2);
      expect(queries[0]).toContain('for no key update');
      expect(queries[1]?.startsWith('update')).toBe(true);
    });
  });
});

afterAll(async () => {
  await closeDatabase();
});
