/**
 * M15 Slice 2 — planned-workout concurrency contract on real PostgreSQL.
 *
 * The shared integration client is `max: 1`, so every overlap in this suite
 * runs on a dedicated pool with real parallel connections; nothing here fakes
 * concurrency with sequential calls.
 *
 * Two techniques are used together, deliberately:
 *
 * 1. **Forced interleavings.** A dedicated transaction acquires the run's
 *    parent enrollment lock exactly as the repository does (`FOR NO KEY
 *    UPDATE`) and holds it until the test releases it, so a test can decide
 *    which side is already inside its write. When that holder also writes
 *    planned rows it reproduces the statement shape of a configure-style write
 *    (lock → delete → insert); no production test hook is involved.
 * 2. **Real overlap.** `Promise.all` over the real repository and the real M14
 *    restart/leave code on separate connections, repeated, so an interleaving
 *    is never a single lucky scheduling.
 *
 * Invariants asserted everywhere: the stored schedule is always exactly one
 * complete set (never a union, never partial), no planned row can outlive its
 * run or land in a replacement run, and no overlap ever produces SQLSTATE
 * 40P01 (deadlock detection).
 */

import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { PlannedDateConflictError } from '@/application/ports/planned-workout-repository';
import { RestartProgramUseCase } from '@/application/use-cases/restart-program';
import type { PlannedWorkout } from '@/domain/entities/planned-workout';
import { createWorkoutSession } from '@/domain/entities/workout-session';
import { createUserId, type EnrollmentId } from '@/domain/types/ids';
import { NodeIdGenerator } from '@/infrastructure/crypto/node-id-generator';
import { DrizzlePlannedWorkoutRepository } from '@/infrastructure/database/repositories/drizzle-planned-workout-repository';
import { DrizzleProgramEnrollmentRepository } from '@/infrastructure/database/repositories/drizzle-program-enrollment-repository';
import { DrizzleProgramRepository } from '@/infrastructure/database/repositories/drizzle-program-repository';
import { DrizzleWorkoutSessionRepository } from '@/infrastructure/database/repositories/drizzle-workout-session-repository';
import * as schema from '@/infrastructure/database/schema';

import {
  allPlannedRows,
  enrollmentIdValue,
  enrollmentIdsForOwner,
  firstCatalogExerciseId,
  listOccurrences,
  plannedDate,
  plannedLines,
  plannedSetFor,
  scheduledWorkoutIdValue,
  seedCompletedRun,
  seedEnrolledRun,
  type PlannedRunFixture,
} from './planned-workout-fixtures';
import { reps } from './personal-record-fixtures';
import {
  closeDatabase,
  plannedWorkoutRepository,
  programEnrollmentRepository,
  programRepository,
  resetAndSeed,
  workoutSessionRepository,
} from './setup';
import { getTestDatabaseUrl } from './test-env';

const OWNER = 'planned-concurrency-owner';
/** 12 authored occurrences: every scenario replaces a whole set. */
const PROGRAM_SLUG = 'strong-at-home';
const OTHER_PROGRAM_SLUG = 'fit40-beginner-strength';
const RUN = enrollmentIdValue('enr-concurrency');
const OWNER_ID = ownerId();

function ownerId() {
  const result = createUserId(OWNER);
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

/** A dedicated pool: real parallel connections, unlike the shared max: 1 client. */
function concurrentPool(max = 6) {
  const client = postgres(getTestDatabaseUrl(), { max });
  const db = drizzle(client, { schema });

  return {
    planned: new DrizzlePlannedWorkoutRepository(db),
    enrollments: new DrizzleProgramEnrollmentRepository(db),
    restart: () =>
      new RestartProgramUseCase(
        new DrizzleProgramRepository(db),
        new DrizzleProgramEnrollmentRepository(db),
        new DrizzleWorkoutSessionRepository(db),
        new NodeIdGenerator(),
      ),
    end: async (): Promise<void> => {
      await client.end();
    },
  };
}

/** A one-shot gate: created closed, opened once by its owner. */
function createGate(): { readonly opened: Promise<void>; readonly open: () => void } {
  let open: (() => void) | null = null;
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });

  return {
    opened,
    open: () => {
      if (open !== null) open();
    },
  };
}

/**
 * Holds a dedicated transaction that has taken the run's parent enrollment lock
 * (the same statement the repository issues) until `release()` is called.
 * `work` runs after the lock is acquired, so a test can reproduce the rows a
 * peer planning write would have committed inside its own transaction.
 */
async function holdEnrollmentLock(input: {
  readonly sql: postgres.Sql;
  readonly enrollmentId: EnrollmentId;
  readonly work?: (tx: postgres.TransactionSql) => Promise<void>;
}): Promise<{ readonly release: () => Promise<void> }> {
  const held = createGate();
  const released = createGate();

  const done = input.sql.begin(async (tx) => {
    await tx`SELECT id FROM program_enrollments WHERE id = ${input.enrollmentId} FOR NO KEY UPDATE`;
    if (input.work !== undefined) {
      await input.work(tx);
    }
    held.open();
    await released.opened;
  });

  await held.opened;

  return {
    release: async () => {
      released.open();
      await done;
    },
  };
}

/** A peer planning write's statement shape: lock (held by the caller), delete, insert. */
async function writePlannedRowsRaw(
  tx: postgres.TransactionSql,
  enrollmentId: EnrollmentId,
  rows: ReadonlyArray<PlannedWorkout>,
): Promise<void> {
  await tx`DELETE FROM planned_workouts WHERE enrollment_id = ${enrollmentId}`;
  if (rows.length === 0) return;

  await tx`INSERT INTO planned_workouts ${tx(
    rows.map((row) => ({
      enrollment_id: row.enrollmentId,
      scheduled_workout_id: row.scheduledWorkoutId,
      planned_date: row.plannedDate,
    })),
    'enrollment_id',
    'scheduled_workout_id',
    'planned_date',
  )}`;
}

const PENDING = 'pending' as const;

/**
 * Waits up to `ms` for `observed`. Resolving with `PENDING` proves the promise
 * is still blocked; any rejection surfaces later through the awaits that follow.
 */
async function settleWithin<T>(observed: Promise<T>, ms: number): Promise<T | typeof PENDING> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<typeof PENDING>((resolve) => {
    timer = setTimeout(() => resolve(PENDING), ms);
  });

  try {
    return await Promise.race([observed, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** True when the stored schedule is exactly `expected` and nothing else. */
function scheduleEquals(actual: ReadonlyArray<string>, expected: ReadonlyArray<string>): boolean {
  return JSON.stringify(actual) === JSON.stringify(expected);
}

/** Sorted copy, for order-independent set comparisons. */
function asSorted(lines: ReadonlyArray<string>): ReadonlyArray<string> {
  return [...lines].sort();
}

/** The real M14 restart use case on the shared (sequential) repositories. */
function restartUseCase(): RestartProgramUseCase {
  return new RestartProgramUseCase(
    programRepository,
    programEnrollmentRepository,
    workoutSessionRepository,
    new NodeIdGenerator(),
  );
}

/** The first two authored occurrences of a seeded run. */
function occurrencesOf(run: PlannedRunFixture): { readonly first: string; readonly second: string } {
  const [first, second] = run.occurrenceIds;
  if (first === undefined || second === undefined) {
    throw new Error('expected at least two authored occurrences');
  }
  return { first, second };
}

describe('planned-workout concurrency — configure vs configure', () => {
  let run: PlannedRunFixture;

  beforeEach(async () => {
    await resetAndSeed();
    run = await seedEnrolledRun({ owner: OWNER, programSlug: PROGRAM_SLUG, enrollmentId: RUN });
  });

  it('serializes two concurrent whole-set replacements into exactly one complete schedule', async () => {
    const pool = concurrentPool();

    try {
      const setA = plannedSetFor(run.program, run.enrollmentId, '2026-10-01');
      const setB = plannedSetFor(run.program, run.enrollmentId, '2026-11-01');
      const linesA = plannedLines(setA);
      const linesB = plannedLines(setB);

      for (let attempt = 0; attempt < 4; attempt += 1) {
        // Start every attempt from a committed schedule, so the second writer
        // must delete the winner's rows rather than begin from empty.
        await plannedWorkoutRepository.replaceAllForEnrollment(RUN, setA);

        const outcomes = await Promise.all([
          pool.planned.replaceAllForEnrollment(RUN, setA),
          pool.planned.replaceAllForEnrollment(RUN, setB),
        ]);
        expect(outcomes).toEqual([true, true]);

        const final = plannedLines(await plannedWorkoutRepository.listByEnrollment(RUN));
        // Exactly one complete schedule: never a union, never a partial set.
        expect(scheduleEquals(final, linesA) || scheduleEquals(final, linesB)).toBe(true);
        expect(final).toHaveLength(linesA.length);
        expect(new Set(final).size).toBe(final.length);
      }
    } finally {
      await pool.end();
    }
  });
});

describe('planned-workout concurrency — configure vs M14 restart', () => {
  it('makes the restart wait behind a planning write, then clears that planning with the run', async () => {
    await resetAndSeed();
    const run = await seedCompletedRun({
      owner: OWNER,
      programSlug: PROGRAM_SLUG,
      enrollmentId: 'enr-concurrency-restart-a',
    });
    const sql = postgres(getTestDatabaseUrl(), { max: 1 });
    const pool = concurrentPool();

    try {
      const runId = enrollmentIdValue(run.enrollmentId);
      const planned = plannedSetFor(run.program, run.enrollmentId, '2026-10-01');
      const holder = await holdEnrollmentLock({
        sql,
        enrollmentId: runId,
        work: (tx) => writePlannedRowsRaw(tx, runId, planned),
      });

      const restart = pool.restart().execute({ userId: OWNER, programSlug: PROGRAM_SLUG });

      // Waiting on the parent enrollment row, not deadlocked: a lock cycle
      // would have been aborted with 40P01 after the 1s deadlock timeout.
      expect(await settleWithin(restart, 1500)).toBe(PENDING);

      await holder.release();
      expect((await restart).ok).toBe(true);

      // The restart replaced the run, and the planning went with the old run.
      const enrollments = await enrollmentIdsForOwner(OWNER);
      expect(enrollments).toHaveLength(1);
      expect(enrollments[0]).not.toBe(run.enrollmentId);
      expect(await allPlannedRows()).toEqual([]);
    } finally {
      await pool.end();
      await sql.end();
    }
  });

  it('returns false and leaves the fresh run untouched when the restart won first', async () => {
    await resetAndSeed();
    const run = await seedCompletedRun({
      owner: OWNER,
      programSlug: PROGRAM_SLUG,
      enrollmentId: 'enr-concurrency-restart-b',
    });
    const runId = enrollmentIdValue(run.enrollmentId);

    expect((await restartUseCase().execute({ userId: OWNER, programSlug: PROGRAM_SLUG })).ok).toBe(
      true,
    );
    const fresh = (await enrollmentIdsForOwner(OWNER))[0];
    if (fresh === undefined) throw new Error('expected a fresh enrollment');

    const staleWrite = await plannedWorkoutRepository.replaceAllForEnrollment(
      runId,
      plannedSetFor(run.program, run.enrollmentId, '2026-10-01'),
    );

    expect(staleWrite).toBe(false);
    expect(await allPlannedRows()).toEqual([]);
    expect(await plannedWorkoutRepository.listByEnrollment(enrollmentIdValue(fresh))).toEqual([]);
  });

  it('keeps the no-leak invariant across repeated real overlaps', async () => {
    const pool = concurrentPool();

    try {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        await resetAndSeed();
        const run = await seedCompletedRun({
          owner: OWNER,
          programSlug: PROGRAM_SLUG,
          enrollmentId: `enr-concurrency-restart-loop-${attempt}`,
        });
        const runId = enrollmentIdValue(run.enrollmentId);

        const [writeOutcome, restartOutcome] = await Promise.all([
          pool.planned.replaceAllForEnrollment(
            runId,
            plannedSetFor(run.program, run.enrollmentId, '2026-10-01'),
          ),
          pool.restart().execute({ userId: OWNER, programSlug: PROGRAM_SLUG }),
        ]);

        expect(restartOutcome.ok).toBe(true);
        expect(typeof writeOutcome).toBe('boolean');

        // The restart always wins the run: exactly one (fresh) enrollment, and
        // no planning anywhere — the stale write could only address the old id.
        const enrollments = await enrollmentIdsForOwner(OWNER);
        expect(enrollments).toHaveLength(1);
        expect(enrollments[0]).not.toBe(run.enrollmentId);
        expect(await allPlannedRows()).toEqual([]);
      }
    } finally {
      await pool.end();
    }
  });
});

describe('planned-workout concurrency — configure vs leave', () => {
  let run: PlannedRunFixture;

  beforeEach(async () => {
    await resetAndSeed();
    run = await seedEnrolledRun({ owner: OWNER, programSlug: PROGRAM_SLUG, enrollmentId: RUN });
  });

  it('makes the leave wait behind a planning write, then removes the planning with the run', async () => {
    const sql = postgres(getTestDatabaseUrl(), { max: 1 });

    try {
      const planned = plannedSetFor(run.program, run.enrollmentId, '2026-10-01');
      const holder = await holdEnrollmentLock({
        sql,
        enrollmentId: RUN,
        work: (tx) => writePlannedRowsRaw(tx, RUN, planned),
      });

      const leave = programEnrollmentRepository.delete(RUN);
      expect(await settleWithin(leave, 1500)).toBe(PENDING);

      await holder.release();
      expect(await leave).toBe(true);

      // No enrollment, no orphaned planning.
      expect(await enrollmentIdsForOwner(OWNER)).toEqual([]);
      expect(await allPlannedRows()).toEqual([]);
    } finally {
      await sql.end();
    }
  });

  it('returns false and writes nothing when the run was already left', async () => {
    await programEnrollmentRepository.delete(RUN);

    const staleWrite = await plannedWorkoutRepository.replaceAllForEnrollment(
      RUN,
      plannedSetFor(run.program, run.enrollmentId, '2026-10-01'),
    );

    expect(staleWrite).toBe(false);
    expect(await allPlannedRows()).toEqual([]);
  });

  it('never leaves an orphan row across repeated real overlaps', async () => {
    const pool = concurrentPool();

    try {
      for (let attempt = 0; attempt < 4; attempt += 1) {
        await resetAndSeed();
        const attemptRun = await seedEnrolledRun({
          owner: OWNER,
          programSlug: PROGRAM_SLUG,
          enrollmentId: `enr-concurrency-leave-loop-${attempt}`,
        });
        const attemptRunId = enrollmentIdValue(attemptRun.enrollmentId);

        const [writeOutcome, deleted] = await Promise.all([
          pool.planned.replaceAllForEnrollment(
            attemptRunId,
            plannedSetFor(attemptRun.program, attemptRun.enrollmentId, '2026-10-01'),
          ),
          pool.enrollments.delete(attemptRunId),
        ]);

        expect(typeof writeOutcome).toBe('boolean');
        expect(deleted).toBe(true);

        // Whichever committed first, the run is gone and its planning went with
        // it: the write either returned false or was cascaded away.
        expect(await enrollmentIdsForOwner(OWNER)).toEqual([]);
        expect(await allPlannedRows()).toEqual([]);
      }
    } finally {
      await pool.end();
    }
  });
});

describe('planned-workout concurrency — reschedule vs reschedule', () => {
  let run: PlannedRunFixture;

  beforeEach(async () => {
    await resetAndSeed();
    run = await seedEnrolledRun({ owner: OWNER, programSlug: PROGRAM_SLUG, enrollmentId: RUN });
    await plannedWorkoutRepository.replaceAllForEnrollment(
      RUN,
      plannedSetFor(run.program, run.enrollmentId, '2026-10-01'),
    );
  });

  it('serializes two moves of one occurrence into a single valid final date', async () => {
    const pool = concurrentPool();
    const { first } = occurrencesOf(run);
    const targetA = plannedDate('2026-12-01');
    const targetB = plannedDate('2026-12-02');

    try {
      const outcomes = await Promise.all([
        pool.planned.reschedule(RUN, scheduledWorkoutIdValue(first), targetA),
        pool.planned.reschedule(RUN, scheduledWorkoutIdValue(first), targetB),
      ]);
      expect(outcomes).toEqual([true, true]);

      const listed = await plannedWorkoutRepository.listByEnrollment(RUN);
      const moved = listed.find((row) => row.scheduledWorkoutId === first);
      expect([targetA, targetB]).toContain(moved?.plannedDate);
      expect(listed).toHaveLength(run.occurrenceIds.length);
      // The one-per-date invariant survived the overlap.
      expect(new Set(listed.map((row) => row.plannedDate)).size).toBe(listed.length);
    } finally {
      await pool.end();
    }
  });

  it('lets exactly one of two moves onto the same target date win', async () => {
    const pool = concurrentPool();
    const { first, second } = occurrencesOf(run);
    const target = plannedDate('2026-12-15');

    try {
      const outcomes = await Promise.allSettled([
        pool.planned.reschedule(RUN, scheduledWorkoutIdValue(first), target),
        pool.planned.reschedule(RUN, scheduledWorkoutIdValue(second), target),
      ]);

      expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
      const rejected = outcomes.filter((outcome) => outcome.status === 'rejected');
      expect(rejected).toHaveLength(1);
      const reason = rejected[0]?.status === 'rejected' ? rejected[0].reason : undefined;
      expect(reason).toBeInstanceOf(PlannedDateConflictError);

      const listed = await plannedWorkoutRepository.listByEnrollment(RUN);
      expect(listed.filter((row) => row.plannedDate === target)).toHaveLength(1);
      expect(listed).toHaveLength(run.occurrenceIds.length);
    } finally {
      await pool.end();
    }
  });
});

describe('planned-workout concurrency — reschedule vs M14 restart', () => {
  function seedRestartRun() {
    return seedCompletedRun({
      owner: OWNER,
      programSlug: PROGRAM_SLUG,
      enrollmentId: 'enr-concurrency-reschedule-restart',
    });
  }

  it('returns false and leaves the fresh run untouched when the restart won first', async () => {
    await resetAndSeed();
    const run = await seedRestartRun();
    const runId = enrollmentIdValue(run.enrollmentId);
    await plannedWorkoutRepository.replaceAllForEnrollment(
      runId,
      plannedSetFor(run.program, run.enrollmentId, '2026-10-01'),
    );

    expect((await restartUseCase().execute({ userId: OWNER, programSlug: PROGRAM_SLUG })).ok).toBe(
      true,
    );
    const fresh = (await enrollmentIdsForOwner(OWNER))[0];
    if (fresh === undefined) throw new Error('expected a fresh enrollment');

    const { first } = occurrencesOf(run);
    const outcome = await plannedWorkoutRepository.reschedule(
      runId,
      scheduledWorkoutIdValue(first),
      plannedDate('2026-12-01'),
    );

    expect(outcome).toBe(false);
    expect(await allPlannedRows()).toEqual([]);
    expect(await plannedWorkoutRepository.listByEnrollment(enrollmentIdValue(fresh))).toEqual([]);
  });

  it('removes a rescheduled row with the run when the reschedule won first', async () => {
    await resetAndSeed();
    const run = await seedRestartRun();
    const runId = enrollmentIdValue(run.enrollmentId);
    await plannedWorkoutRepository.replaceAllForEnrollment(
      runId,
      plannedSetFor(run.program, run.enrollmentId, '2026-10-01'),
    );
    const { first } = occurrencesOf(run);

    expect(
      await plannedWorkoutRepository.reschedule(
        runId,
        scheduledWorkoutIdValue(first),
        plannedDate('2026-12-01'),
      ),
    ).toBe(true);
    expect((await restartUseCase().execute({ userId: OWNER, programSlug: PROGRAM_SLUG })).ok).toBe(
      true,
    );

    expect(await allPlannedRows()).toEqual([]);
    expect(await enrollmentIdsForOwner(OWNER)).toHaveLength(1);
  });

  it('never leaks a moved row across repeated real overlaps', async () => {
    const pool = concurrentPool();

    try {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        await resetAndSeed();
        const run = await seedCompletedRun({
          owner: OWNER,
          programSlug: PROGRAM_SLUG,
          enrollmentId: `enr-concurrency-resched-loop-${attempt}`,
        });
        const runId = enrollmentIdValue(run.enrollmentId);
        await plannedWorkoutRepository.replaceAllForEnrollment(
          runId,
          plannedSetFor(run.program, run.enrollmentId, '2026-10-01'),
        );
        const { first } = occurrencesOf(run);

        const [moveOutcome, restartOutcome] = await Promise.all([
          pool.planned.reschedule(runId, scheduledWorkoutIdValue(first), plannedDate('2026-12-01')),
          pool.restart().execute({ userId: OWNER, programSlug: PROGRAM_SLUG }),
        ]);

        expect(restartOutcome.ok).toBe(true);
        expect(typeof moveOutcome).toBe('boolean');
        expect(await enrollmentIdsForOwner(OWNER)).toHaveLength(1);
        expect(await allPlannedRows()).toEqual([]);
      }
    } finally {
      await pool.end();
    }
  });
});

describe('planned-workout concurrency — reschedule vs leave', () => {
  let run: PlannedRunFixture;

  beforeEach(async () => {
    await resetAndSeed();
    run = await seedEnrolledRun({ owner: OWNER, programSlug: PROGRAM_SLUG, enrollmentId: RUN });
    await plannedWorkoutRepository.replaceAllForEnrollment(
      RUN,
      plannedSetFor(run.program, run.enrollmentId, '2026-10-01'),
    );
  });

  it('returns false and writes nothing when the run was already left', async () => {
    const { first } = occurrencesOf(run);
    await programEnrollmentRepository.delete(RUN);

    const outcome = await plannedWorkoutRepository.reschedule(
      RUN,
      scheduledWorkoutIdValue(first),
      plannedDate('2026-12-01'),
    );

    expect(outcome).toBe(false);
    expect(await allPlannedRows()).toEqual([]);
  });

  it('removes a moved row with the run when the reschedule committed first', async () => {
    const { first } = occurrencesOf(run);

    expect(
      await plannedWorkoutRepository.reschedule(
        RUN,
        scheduledWorkoutIdValue(first),
        plannedDate('2026-12-01'),
      ),
    ).toBe(true);
    expect(await programEnrollmentRepository.delete(RUN)).toBe(true);

    expect(await allPlannedRows()).toEqual([]);
    expect(await enrollmentIdsForOwner(OWNER)).toEqual([]);
  });

  it('never leaves an orphan row across repeated real overlaps', async () => {
    const pool = concurrentPool();

    try {
      for (let attempt = 0; attempt < 4; attempt += 1) {
        await resetAndSeed();
        const attemptRun = await seedEnrolledRun({
          owner: OWNER,
          programSlug: PROGRAM_SLUG,
          enrollmentId: `enr-concurrency-resched-leave-${attempt}`,
        });
        const attemptRunId = enrollmentIdValue(attemptRun.enrollmentId);
        await plannedWorkoutRepository.replaceAllForEnrollment(
          attemptRunId,
          plannedSetFor(attemptRun.program, attemptRun.enrollmentId, '2026-10-01'),
        );
        const { first } = occurrencesOf(attemptRun);

        const [moveOutcome, deleted] = await Promise.all([
          pool.planned.reschedule(
            attemptRunId,
            scheduledWorkoutIdValue(first),
            plannedDate('2026-12-01'),
          ),
          pool.enrollments.delete(attemptRunId),
        ]);

        expect(typeof moveOutcome).toBe('boolean');
        expect(deleted).toBe(true);

        // The move either returned false or was cascaded away with the run.
        expect(await enrollmentIdsForOwner(OWNER)).toEqual([]);
        expect(await allPlannedRows()).toEqual([]);
      }
    } finally {
      await pool.end();
    }
  });
});

describe('planned-workout concurrency — reschedule vs configure', () => {
  let run: PlannedRunFixture;

  beforeEach(async () => {
    await resetAndSeed();
    run = await seedEnrolledRun({ owner: OWNER, programSlug: PROGRAM_SLUG, enrollmentId: RUN });
    await plannedWorkoutRepository.replaceAllForEnrollment(
      RUN,
      plannedSetFor(run.program, run.enrollmentId, '2026-10-01'),
    );
  });

  it('lets a regeneration overwrite a manual move (regeneration is authoritative)', async () => {
    const { first } = occurrencesOf(run);
    expect(
      await plannedWorkoutRepository.reschedule(
        RUN,
        scheduledWorkoutIdValue(first),
        plannedDate('2026-12-01'),
      ),
    ).toBe(true);

    const regenerated = plannedSetFor(run.program, run.enrollmentId, '2026-11-01');
    expect(await plannedWorkoutRepository.replaceAllForEnrollment(RUN, regenerated)).toBe(true);

    expect(plannedLines(await plannedWorkoutRepository.listByEnrollment(RUN))).toEqual(
      plannedLines(regenerated),
    );
  });

  it('applies a manual move to the regenerated row when the move lands second', async () => {
    const { first } = occurrencesOf(run);
    const regenerated = plannedSetFor(run.program, run.enrollmentId, '2026-11-01');
    await plannedWorkoutRepository.replaceAllForEnrollment(RUN, regenerated);
    const target = plannedDate('2026-12-20');

    expect(
      await plannedWorkoutRepository.reschedule(RUN, scheduledWorkoutIdValue(first), target),
    ).toBe(true);

    const final = plannedLines(await plannedWorkoutRepository.listByEnrollment(RUN));
    expect(final).toContain(`${first}@${target}`);
    expect(final).toHaveLength(regenerated.length);
  });

  it('keeps exactly one complete schedule across repeated real overlaps', async () => {
    const pool = concurrentPool();
    const { first } = occurrencesOf(run);
    const regenerated = plannedSetFor(run.program, run.enrollmentId, '2026-11-01');
    const target = plannedDate('2026-12-20');
    const expectedWithMove = plannedLines(regenerated).map((line) =>
      line.startsWith(`${first}@`) ? `${first}@${target}` : line,
    );

    try {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        await plannedWorkoutRepository.replaceAllForEnrollment(
          RUN,
          plannedSetFor(run.program, run.enrollmentId, '2026-10-01'),
        );

        const [moved, replaced] = await Promise.all([
          pool.planned.reschedule(RUN, scheduledWorkoutIdValue(first), target),
          pool.planned.replaceAllForEnrollment(RUN, regenerated),
        ]);

        expect(moved).toBe(true);
        expect(replaced).toBe(true);

        const final = plannedLines(await plannedWorkoutRepository.listByEnrollment(RUN));
        // Either the regeneration overwrote the move, or the move landed on the
        // regenerated row — never a union, never a partial schedule.
        const matchesRegeneration = scheduleEquals(
          asSorted(final),
          asSorted(plannedLines(regenerated)),
        );
        const matchesWithMove = scheduleEquals(asSorted(final), asSorted(expectedWithMove));
        expect(matchesRegeneration || matchesWithMove).toBe(true);
        expect(final).toHaveLength(regenerated.length);
        expect(new Set(final).size).toBe(final.length);
      }
    } finally {
      await pool.end();
    }
  });
});

describe('planned-workout concurrency — parent-first locking and lock compatibility', () => {
  it('queues a restart and a planning write behind one held lock without deadlocking', async () => {
    await resetAndSeed();
    const run = await seedCompletedRun({
      owner: OWNER,
      programSlug: PROGRAM_SLUG,
      enrollmentId: 'enr-concurrency-lock',
    });
    const sql = postgres(getTestDatabaseUrl(), { max: 1 });
    const pool = concurrentPool();

    try {
      const runId = enrollmentIdValue(run.enrollmentId);
      const holder = await holdEnrollmentLock({
        sql,
        enrollmentId: runId,
        work: (tx) =>
          writePlannedRowsRaw(
            tx,
            runId,
            plannedSetFor(run.program, run.enrollmentId, '2026-10-01'),
          ),
      });

      const restart = pool.restart().execute({ userId: OWNER, programSlug: PROGRAM_SLUG });
      const write = pool.planned.replaceAllForEnrollment(
        runId,
        plannedSetFor(run.program, run.enrollmentId, '2027-01-01'),
      );

      // Both writers wait on the SAME parent row — for longer than the 1s
      // PostgreSQL deadlock timeout — so no lock cycle exists between them.
      expect(await settleWithin(restart, 1500)).toBe(PENDING);
      expect(await settleWithin(write, 1500)).toBe(PENDING);

      await holder.release();

      const [restartOutcome, writeOutcome] = await Promise.all([restart, write]);
      expect(restartOutcome.ok).toBe(true);
      expect(typeof writeOutcome).toBe('boolean');

      // Lifecycle semantics regardless of who acquired the lock next.
      expect(await enrollmentIdsForOwner(OWNER)).toHaveLength(1);
      expect(await allPlannedRows()).toEqual([]);
    } finally {
      await pool.end();
      await sql.end();
    }
  });

  it('lets a workout-session insert proceed while the enrollment lock is held', async () => {
    await resetAndSeed();
    const run = await seedEnrolledRun({
      owner: OWNER,
      programSlug: OTHER_PROGRAM_SLUG,
      enrollmentId: 'enr-concurrency-session',
    });
    const sql = postgres(getTestDatabaseUrl(), { max: 1 });

    try {
      const runId = enrollmentIdValue(run.enrollmentId);
      const occurrence = listOccurrences(run.program)[0];
      if (occurrence === undefined) throw new Error('expected an authored occurrence');
      const scheduledId = scheduledWorkoutIdValue(occurrence.id);

      const created = createWorkoutSession({
        id: 'session-during-lock',
        userId: OWNER_ID,
        enrollmentId: runId,
        scheduledWorkoutId: scheduledId,
        workoutId: occurrence.workoutId,
        startedAt: new Date('2026-10-01T09:00:00Z'),
        exerciseLogs: [
          {
            authoredExerciseId: await firstCatalogExerciseId(),
            order: 1,
            prescription: reps(),
            restSeconds: 60,
          },
        ],
      });
      if (!created.ok) throw new Error(created.error.message);

      const holder = await holdEnrollmentLock({ sql, enrollmentId: runId });

      // The session INSERT's foreign-key check takes FOR KEY SHARE on the same
      // enrollment row, which FOR NO KEY UPDATE does not conflict with. The
      // claim is verified, not assumed: the save must complete while the lock
      // is still held, because the holder is only released afterwards.
      const saved = await settleWithin(workoutSessionRepository.save(created.data), 3000);
      expect(saved).not.toBe(PENDING);

      await holder.release();

      expect(
        await workoutSessionRepository.findByEnrollmentAndScheduledWorkout(runId, scheduledId),
      ).not.toBeNull();
    } finally {
      await sql.end();
    }
  });
});

afterAll(async () => {
  await closeDatabase();
});
