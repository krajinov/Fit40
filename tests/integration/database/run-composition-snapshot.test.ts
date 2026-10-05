/**
 * M17 generation fence (preview/session + planned-row snapshot): the two
 * remaining split-read gaps, on real PostgreSQL.
 *
 * TEST A (preview fence): the dashboard/preview session read is fenced to the
 * parent-loaded enrollment. A restart replacing A with B while the parent
 * still describes A must yield the typed ENROLLMENT_CHANGED - never the
 * replacement run's not-started state (which would render a B preview as Up
 * Next beside A's progress). The unfenced read (negative control) still
 * resolves B - the generation mix the fence removes.
 *
 * TEST B (planned-row snapshot): the fenced schedule projection reads identity
 * + execution facts + PLANNED ROWS from ONE statement. A leave committing
 * while the read is in flight can only shift the whole answer to before
 * (matched with A's rows - coherent A) or after (not matched - ENROLLMENT_CHANGED),
 * never to "matched but empty rows" - the false `configured: false` the old
 * split (matched-then-second-planned-read) would produce, shown as the
 * negative control.
 *
 * Every interleaving is decided by database state, never a sleep: the peer
 * transition is held uncommitted by a transaction gate; the read's in-flight
 * position is proven through pg_locks before the transition may commit.
 */

import { sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { GetWorkoutSessionUseCase } from '@/application/use-cases/get-workout-session';
import { RestartProgramUseCase } from '@/application/use-cases/restart-program';
import { NodeIdGenerator } from '@/infrastructure/crypto/node-id-generator';
import { createUserId, type UserId } from '@/domain/types/ids';
import { DrizzleScheduleExecutionFactsRepository } from '@/infrastructure/database/repositories/drizzle-schedule-execution-facts-repository';
import { programEnrollments } from '@/infrastructure/database/schema';

import {
  createRaceHarness,
  holdEnrollmentLock,
  holdTableWriteGate,
  seedConcludedRun,
  waitForPendingLock,
} from './not-performed-race-fixtures';
import {
  enrollmentIdValue,
  plannedWorkout,
  seedEnrolledRun,
} from './planned-workout-fixtures';
import {
  closeDatabase,
  db,
  occurrenceExecutionFactsRepository,
  plannedWorkoutRepository,
  programEnrollmentRepository,
  programRepository,
  resetAndSeed,
  runClosureFactsRepository,
} from './setup';

const OWNER = 'm17-fence-gap-owner';
/** `strong-at-home` authors 12 occurrences (4 weeks x 3 workouts). */
const PROGRAM_SLUG = 'strong-at-home';
const RUN_ID = 'enr-m17-fence-gap-a';
const TODAY = '2026-09-23';

afterAll(async () => {
  await closeDatabase();
});

beforeEach(async () => {
  await resetAndSeed();
});

describe('A. the preview/session read is fenced to the parent enrollment', () => {
  it('refuses ENROLLMENT_CHANGED after a restart replaced the loaded run - never B preview state', async () => {
    // Seed a restartable run A (concluded: 11 completed + 1 recorded).
    const run = await seedConcludedRun({ owner: OWNER, programSlug: PROGRAM_SLUG, enrollmentId: RUN_ID });
    const program = await programRepository.findBySlug(PROGRAM_SLUG);
    if (program === null) throw new Error('seed program is missing');
    const [occurrenceA] = run.occurrenceIds;
    if (occurrenceA === undefined) throw new Error('expected an authored occurrence');
    // A's first occurrence has a COMPLETED session (from seedConcludedRun);
    // the fresh run B has NO session for it - the distinct preview states.

    const session = new GetWorkoutSessionUseCase(
      programRepository,
      programEnrollmentRepository,
      occurrenceExecutionFactsRepository,
    );

    // 1. The parent (dashboard/preview) reads A's occurrence state: in-progress.
    const before = await session.execute({
      userId: OWNER,
      programSlug: PROGRAM_SLUG,
      weekNumber: 1,
      workoutOrder: 1,
      expectedEnrollmentId: seededEnrollmentId(RUN_ID),
    });
    expect(before.ok).toBe(true);
    if (before.ok) {
      expect(before.data.session).not.toBeNull();
      expect(before.data.session?.status).toBe('completed');
    }

    // 2. A production restart replaces A with B while the parent still
    // describes A. B has NO session for the occurrence (fresh run).
    const restart = new RestartProgramUseCase(
      programRepository,
      programEnrollmentRepository,
      runClosureFactsRepository,
      new NodeIdGenerator(),
    );
    const replaced = await restart.execute({ userId: OWNER, programSlug: PROGRAM_SLUG });
    expect(replaced.ok).toBe(true);

    // 3. The fenced preview/session read executes FOR THE EXPECTED enrollment A.
    const fenced = await session.execute({
      userId: OWNER,
      programSlug: PROGRAM_SLUG,
      weekNumber: 1,
      workoutOrder: 1,
      expectedEnrollmentId: seededEnrollmentId(RUN_ID),
    });

    // The typed refusal: the preview can never render the replacement run's
    // not-started state beside the parent's old-enrollment data.
    expect(fenced.ok).toBe(false);
    if (!fenced.ok) expect(fenced.error).toMatchObject({ code: 'ENROLLMENT_CHANGED' });

    // Negative control: the UNFENCED read still resolves the CURRENT run -
    // and now describes B (not-started, no record), which is exactly the
    // generation mix the fence removes.
    const unfenced = await session.execute({
      userId: OWNER,
      programSlug: PROGRAM_SLUG,
      weekNumber: 1,
      workoutOrder: 1,
    });
    expect(unfenced.ok).toBe(true);
    if (unfenced.ok) {
      expect(unfenced.data.session).toBeNull();
      expect(unfenced.data.notPerformedRecorded).toBe(false);
    }
  });
});

describe('B. the fenced schedule projection reads planned rows from ONE snapshot', () => {
  it('a leave committing while the read is in flight yields matched:false - never matched-with-empty-rows', async () => {
    const run = await seedEnrolledRun({ owner: OWNER, programSlug: PROGRAM_SLUG, enrollmentId: RUN_ID });
    const [occurrenceA, occurrenceB] = run.occurrenceIds;
    if (occurrenceA === undefined || occurrenceB === undefined) {
      throw new Error('expected at least two authored occurrences');
    }
    await plannedWorkoutRepository.replaceAllForEnrollment(
      enrollmentIdValue(RUN_ID),
      [plannedWorkout(RUN_ID, occurrenceA, TODAY), plannedWorkout(RUN_ID, occurrenceB, '2026-09-25')],
    );
    const projection = new DrizzleScheduleExecutionFactsRepository(db);
    const program = await programRepository.findBySlug(PROGRAM_SLUG);
    if (program === null) throw new Error('seed program is missing');

    // 1. While the run still exists: coherent A - matched with A's planned rows.
    const before = await projection.findFencedScheduleExecutionFactsByEnrollment(
      seededEnrollmentId(RUN_ID),
      ownerUserId(),
      program.id,
    );
    expect(before.matched).toBe(true);
    if (before.matched) expect(before.plannedRows).toHaveLength(2);

    // 2. Hold a LEAVE uncommitted (delete the enrollment; planned rows cascade),
    // arm the gate on planned_workouts so the fenced statement queues behind
    // the writer's uncommitted delete, then commit strictly inside the read.
    const harness = createRaceHarness(5);
    try {
      const writer = await holdEnrollmentLock({
        db: harness.db,
        enrollmentId: enrollmentIdValue(RUN_ID),
        work: async (tx) => {
          await tx.delete(programEnrollments).where(sql`id = ${RUN_ID}`);
        },
      });
      const gate = holdTableWriteGate(harness.db, 'planned_workouts');
      await waitForPendingLock(harness.sql, 'planned_workouts', 'AccessExclusiveLock');
      const inFlight = new DrizzleScheduleExecutionFactsRepository(harness.db).findFencedScheduleExecutionFactsByEnrollment(
        seededEnrollmentId(RUN_ID),
        ownerUserId(),
        program.id,
      );
      await waitForPendingLock(harness.sql, 'planned_workouts', 'AccessShareLock');
      await writer.release();
      await gate.release();

      const after = await inFlight;

      // The WHOLE statement ran after the commit: NOT matched. The forbidden
      // answer (matched with EMPTY planned rows - the false `configured: false`
      // of the old split) can never be produced by one snapshot.
      expect(after).toEqual({ matched: false });

      // Negative control, the retired split: read the facts' anchor before the
      // commit (matched), then read planned rows in a SECOND statement after
      // it - [] - which the old implementation rendered as `configured: false`.
      // (Demonstrated: the second read observes the cascade.)
      const plannedAfter = await plannedWorkoutRepository.listByEnrollment(enrollmentIdValue(RUN_ID));
      expect(plannedAfter).toEqual([]);
    } finally {
      await harness.end();
    }
  });
});

/** The trusted owner as a branded id, for the projections' user predicate. */
function ownerUserId(): UserId {
  const result = createUserId(OWNER);
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

function seededEnrollmentId(value: string) {
  return enrollmentIdValue(value);
}
