/**
 * M17 Slice 3 — DrizzleNotPerformedOccurrenceRepository on real PostgreSQL.
 *
 * Proves the read contract end to end: ONE bounded enrollment-scoped statement,
 * deterministic order, an exact Domain mapping including the recorded instant,
 * and no leak across runs (another program of the same user, another user's run
 * of the same program, and the replaced run after a real M14 restart).
 *
 * There is no production writer in this slice, so facts are inserted with raw
 * SQL — the only statement path that exists — while users, enrollments, programs
 * and sessions all come from the shared fixtures' real write paths.
 */

import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import {
  createProgramEnrollment,
  type ProgramEnrollment,
} from '@/domain/entities/program-enrollment';
import { DrizzleNotPerformedOccurrenceRepository } from '@/infrastructure/database/repositories/drizzle-not-performed-occurrence-repository';
import * as schema from '@/infrastructure/database/schema';

import { countFacts, factLines, insertFact } from './not-performed-fixtures';
import { seedEnrollment } from './personal-record-fixtures';
import {
  enrollmentIdValue,
  seedEnrolledRun,
  type PlannedRunFixture,
} from './planned-workout-fixtures';
import {
  closeDatabase,
  notPerformedOccurrenceRepository,
  programEnrollmentRepository,
  programRepository,
  resetAndSeed,
} from './setup';
import { getTestDatabaseUrl } from './test-env';

const OWNER = 'not-performed-repo-owner';
const OTHER_USER = 'not-performed-repo-other';
const PROGRAM_SLUG = 'fit40-beginner-strength';
const OTHER_PROGRAM_SLUG = 'strong-at-home';
const RUN = enrollmentIdValue('enr-not-performed-repo-a');
const OTHER_RUN = enrollmentIdValue('enr-not-performed-repo-b');
const REPLACEMENT_RUN = enrollmentIdValue('enr-not-performed-repo-c');

/** Three distinct recorded instants, so ordering cannot pass by accident. */
const FIRST_AT = '2026-09-28T18:30:00.000Z';
const SECOND_AT = '2026-09-29T07:15:00.000Z';
const THIRD_AT = '2026-09-30T20:45:00.000Z';

/** The first three authored occurrences of the seeded run. */
function occurrences(fixture: PlannedRunFixture): readonly [string, string, string] {
  const [first, second, third] = fixture.occurrenceIds;
  if (first === undefined || second === undefined || third === undefined) {
    throw new Error('expected at least three authored occurrences');
  }
  return [first, second, third];
}

function replacement(
  owner: string,
  programId: string,
  id: string,
): ProgramEnrollment {
  const created = createProgramEnrollment({
    id,
    userId: owner,
    programId,
    enrolledAt: new Date('2026-10-01T00:00:00Z'),
  });
  if (!created.ok) throw new Error(created.error.message);
  return created.data;
}

afterAll(async () => {
  await closeDatabase();
});

describe('DrizzleNotPerformedOccurrenceRepository — reads on PostgreSQL', () => {
  let run: PlannedRunFixture;

  beforeEach(async () => {
    await resetAndSeed();
    run = await seedEnrolledRun({ owner: OWNER, programSlug: PROGRAM_SLUG, enrollmentId: RUN });
  });

  it('returns an empty list for a run with no recorded fact', async () => {
    expect(await notPerformedOccurrenceRepository.listByEnrollment(RUN)).toEqual([]);
  });

  it('maps a persisted fact exactly, recorded instant included', async () => {
    const [first] = occurrences(run);
    await insertFact({ enrollmentId: RUN, scheduledWorkoutId: first, recordedAt: FIRST_AT });

    const listed = await notPerformedOccurrenceRepository.listByEnrollment(RUN);

    expect(listed).toHaveLength(1);
    expect(listed[0]?.enrollmentId).toBe(RUN);
    expect(listed[0]?.scheduledWorkoutId).toBe(first);
    expect(listed[0]?.recordedAt.toISOString()).toBe(FIRST_AT);
  });

  it('reads every fact of one run in authored occurrence order', async () => {
    const [first, second, third] = occurrences(run);
    // Inserted out of occurrence order: the order must come from the query.
    await insertFact({ enrollmentId: RUN, scheduledWorkoutId: third, recordedAt: THIRD_AT });
    await insertFact({ enrollmentId: RUN, scheduledWorkoutId: first, recordedAt: FIRST_AT });
    await insertFact({ enrollmentId: RUN, scheduledWorkoutId: second, recordedAt: SECOND_AT });

    const listed = await notPerformedOccurrenceRepository.listByEnrollment(RUN);

    const expected = [first, second, third].sort();
    expect(factLines(listed)).toEqual([
      `${expected[0]}@${FIRST_AT}`,
      `${expected[1]}@${SECOND_AT}`,
      `${expected[2]}@${THIRD_AT}`,
    ]);
    expect(listed.map((row) => row.scheduledWorkoutId)).toEqual(expected);
  });

  it('never leaks another run of the same user', async () => {
    const [first] = occurrences(run);
    const otherProgram = await programRepository.findBySlug(OTHER_PROGRAM_SLUG);
    if (otherProgram === null) throw new Error(`seed program "${OTHER_PROGRAM_SLUG}" is missing`);
    // A second run of the SAME user in a different program: the user already
    // exists, so only the enrollment is seeded here.
    await seedEnrollment(OTHER_RUN, OWNER, otherProgram.id);
    const otherOccurrence = otherProgram.weeks[0]?.scheduledWorkouts[0]?.id;
    if (otherOccurrence === undefined) throw new Error('expected an occurrence');

    await insertFact({ enrollmentId: RUN, scheduledWorkoutId: first, recordedAt: FIRST_AT });
    await insertFact({
      enrollmentId: OTHER_RUN,
      scheduledWorkoutId: otherOccurrence,
      recordedAt: SECOND_AT,
    });

    const listed = await notPerformedOccurrenceRepository.listByEnrollment(RUN);

    expect(factLines(listed)).toEqual([`${first}@${FIRST_AT}`]);
  });

  it('never leaks another user’s run of the same program', async () => {
    const [first] = occurrences(run);
    const otherUserRun = await seedEnrolledRun({
      owner: OTHER_USER,
      programSlug: PROGRAM_SLUG,
      enrollmentId: OTHER_RUN,
    });
    const otherOccurrence = otherUserRun.occurrenceIds[0];
    if (otherOccurrence === undefined) throw new Error('expected an occurrence');

    await insertFact({ enrollmentId: RUN, scheduledWorkoutId: first, recordedAt: FIRST_AT });
    await insertFact({
      enrollmentId: OTHER_RUN,
      scheduledWorkoutId: otherOccurrence,
      recordedAt: SECOND_AT,
    });

    const listed = await notPerformedOccurrenceRepository.listByEnrollment(RUN);
    const otherListed = await notPerformedOccurrenceRepository.listByEnrollment(OTHER_RUN);

    expect(factLines(listed)).toEqual([`${first}@${FIRST_AT}`]);
    expect(otherListed.map((row) => row.enrollmentId)).toEqual([OTHER_RUN]);
  });

  it('never inherits the replaced run’s facts after a restart', async () => {
    const [first, second] = occurrences(run);
    await insertFact({ enrollmentId: RUN, scheduledWorkoutId: first, recordedAt: FIRST_AT });

    // The real M14 replacement path: the old enrollment is deleted inside one
    // transaction, so its facts cascade with it and can never be inherited.
    const replaced = await programEnrollmentRepository.replaceExpectedWithNew(
      RUN,
      replacement(OWNER, run.program.id, REPLACEMENT_RUN),
      // Lifecycle-cascade suite: the restartability gate is exercised by the
      // restart/race suites, so this call always passes it.
      () => true,
    );

    expect(replaced.kind).toBe('replaced');
    expect(await countFacts(RUN)).toBe(0);
    expect(await notPerformedOccurrenceRepository.listByEnrollment(RUN)).toEqual([]);
    expect(await notPerformedOccurrenceRepository.listByEnrollment(REPLACEMENT_RUN)).toEqual([]);

    await insertFact({
      enrollmentId: REPLACEMENT_RUN,
      scheduledWorkoutId: second,
      recordedAt: THIRD_AT,
    });

    const currentRun = await notPerformedOccurrenceRepository.listByEnrollment(REPLACEMENT_RUN);

    expect(factLines(currentRun)).toEqual([`${second}@${THIRD_AT}`]);
  });

  it('reads a run with a single bounded statement', async () => {
    const [first, second] = occurrences(run);
    await insertFact({ enrollmentId: RUN, scheduledWorkoutId: first, recordedAt: FIRST_AT });
    await insertFact({ enrollmentId: RUN, scheduledWorkoutId: second, recordedAt: SECOND_AT });

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
      const repo = new DrizzleNotPerformedOccurrenceRepository(
        drizzle(countingClient, { schema }),
      );
      // Warm the connection so postgres.js' one-time introspection is not part
      // of the count, then measure the read itself.
      await repo.listByEnrollment(RUN);
      queries.length = 0;

      const listed = await repo.listByEnrollment(RUN);

      expect(listed).toHaveLength(2);
      expect(queries).toHaveLength(1);
      expect(queries[0]?.startsWith('select')).toBe(true);
      expect(queries[0]).toContain('from "not_performed_workouts"');
      // No joins: the fact is reported without a session or calendar row.
      expect(queries[0]).not.toContain('join');
    } finally {
      await countingClient.end();
    }
  });
});