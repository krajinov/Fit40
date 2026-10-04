/**
 * M17 generation fence (dashboard + Program Detail): EVERY run-scoped read
 * composed into an already-loaded enrollment is tied to THAT exact
 * ProgramEnrollmentId - never to a silently re-resolved current run.
 *
 * The parent loads enrollment A (dashboard view / program detail). A restart
 * replaces A with B while the parent still describes A. Every nested run-scoped
 * read that takes `expectedEnrollmentId` must either describe A from a coherent
 * snapshot or refuse with the typed ENROLLMENT_CHANGED - and must NEVER return
 * B's schedule, follow-through report, or closure to be composed beside A's
 * enrollment/progress data. The unfenced read (negative control) still resolves
 * the current run and WOULD return B - the generation mix the fence removes.
 *
 * Real PostgreSQL, sequential deterministic steps (no sleeps): the replacement
 * is committed BETWEEN the parent read and the nested reads, which is exactly
 * the composition window that mattered.
 */

import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { GetEnrollmentFollowThroughUseCase } from '@/application/use-cases/get-enrollment-follow-through';
import { GetEnrollmentScheduleUseCase } from '@/application/use-cases/get-enrollment-schedule';
import { GetProgramEnrollmentUseCase } from '@/application/use-cases/get-program-enrollment';
import { GetRunClosureSummaryUseCase } from '@/application/use-cases/get-run-closure-summary';
import { RestartProgramUseCase } from '@/application/use-cases/restart-program';
import { NodeIdGenerator } from '@/infrastructure/crypto/node-id-generator';
import type { TrainingProgram } from '@/domain/entities/training-program';

import {
  enrollmentIdValue,
  plannedWorkout,
  seedCompletedRun,
  type CompletedRunFixture,
} from './planned-workout-fixtures';
import {
  closeDatabase,
  followThroughExecutionFactsRepository,
  notPerformedOccurrenceRepository,
  plannedWorkoutRepository,
  programEnrollmentRepository,
  programRepository,
  resetAndSeed,
  runClosureFactsRepository,
  scheduleExecutionFactsRepository,
  workoutSessionRepository,
} from './setup';

const OWNER = 'm17-composition-owner';
/** `strong-at-home` authors 12 occurrences (4 weeks x 3 workouts). */
const PROGRAM_SLUG = 'strong-at-home';
const RUN_ID = 'enr-m17-composition-a';
/** Friday 2026-10-02: the calendar/report clock. */
const NOW = new Date('2026-10-02T09:00:00.000Z');
const TODAY = '2026-10-02';

afterAll(async () => {
  await closeDatabase();
});

beforeEach(async () => {
  await resetAndSeed();
});

const PROGRAM = async (): Promise<TrainingProgram> => {
  const program = await programRepository.findBySlug(PROGRAM_SLUG);
  if (program === null) throw new Error(`seed program "${PROGRAM_SLUG}" is missing`);
  return program;
};

const schedule = () =>
  new GetEnrollmentScheduleUseCase(
    programEnrollmentRepository,
    plannedWorkoutRepository,
    scheduleExecutionFactsRepository,
  );
const followThrough = () =>
  new GetEnrollmentFollowThroughUseCase(
    programEnrollmentRepository,
    plannedWorkoutRepository,
    followThroughExecutionFactsRepository,
    notPerformedOccurrenceRepository,
  );
const closure = () =>
  new GetRunClosureSummaryUseCase(programEnrollmentRepository, runClosureFactsRepository);
const restart = () =>
  new RestartProgramUseCase(
    programRepository,
    programEnrollmentRepository,
    runClosureFactsRepository,
    new NodeIdGenerator(),
  );

/**
 * A RESTARTABLE run A with a DISTINCTIVE configured calendar: every authored
 * occurrence completed (restartable), and the first occurrence placed TODAY, so
 * A's schedule is a real configured calendar, not the empty one B starts with.
 */
async function seedDistinctiveRunA(): Promise<CompletedRunFixture> {
  const run = await seedCompletedRun({ owner: OWNER, programSlug: PROGRAM_SLUG, enrollmentId: RUN_ID });
  const [first] = run.occurrenceIds;
  if (first === undefined) throw new Error('expected at least one authored occurrence');
  await plannedWorkoutRepository.replaceAllForEnrollment(
    enrollmentIdValue(RUN_ID),
    [plannedWorkout(RUN_ID, first, TODAY)],
  );
  return run;
}

describe('M17 generation fence - composed reads describe ONE enrollment generation', () => {
  it('nested reads refuse ENROLLMENT_CHANGED after the parent-loaded run was replaced - never B data', async () => {
    const seededA = await seedDistinctiveRunA();
    const program = await PROGRAM();

    // 1. The parent loads A (dashboard view / program detail).
    const view = await new GetProgramEnrollmentUseCase(
      programEnrollmentRepository,
      workoutSessionRepository,
    ).execute({ userId: OWNER, program });
    expect(view.ok).toBe(true);
    if (!view.ok || view.data.status !== 'enrolled') throw new Error('expected an enrolled view');
    const expectedEnrollmentId = view.data.enrollmentId;
    expect(expectedEnrollmentId).toBe(seededA.enrollmentId);

    // 2. A restart replaces A with B while the parent still describes A.
    const replaced = await restart().execute({ userId: OWNER, programSlug: PROGRAM_SLUG });
    expect(replaced.ok).toBe(true);

    // 3. The nested run-scoped reads execute FOR THE EXPECTED enrollment A.
    const [scheduleRead, followThroughRead, closureRead] = await Promise.all([
      schedule().execute({ userId: OWNER, program, now: NOW, expectedEnrollmentId }),
      followThrough().execute({ userId: OWNER, program, now: NOW, expectedEnrollmentId }),
      closure().execute({ userId: OWNER, program, expectedEnrollmentId }),
    ]);

    // Forbidden shape: A enrollment/progress composed with B's schedule,
    // report, or closure. Every nested read refuses with the SAME typed code.
    expect(scheduleRead.ok).toBe(false);
    if (!scheduleRead.ok) expect(scheduleRead.error).toMatchObject({ code: 'ENROLLMENT_CHANGED' });
    expect(followThroughRead.ok).toBe(false);
    if (!followThroughRead.ok) expect(followThroughRead.error).toMatchObject({ code: 'ENROLLMENT_CHANGED' });
    expect(closureRead.ok).toBe(false);
    if (!closureRead.ok) expect(closureRead.error).toMatchObject({ code: 'ENROLLMENT_CHANGED' });

    // Negative control: the UNFENCED schedule read still resolves the CURRENT
    // run - and now describes B (an unconfigured fresh calendar), which is
    // exactly the generation mix the fence removes from the composed pages.
    const unfenced = await schedule().execute({ userId: OWNER, program, now: NOW });
    expect(unfenced.ok).toBe(true);
    if (!unfenced.ok || unfenced.data === null) throw new Error('expected the replacement run');
    expect(unfenced.data.configured).toBe(false);
    expect(unfenced.data.items).toHaveLength(0);

    // Deliberate whole-parent B result: fencing to B's own identity is coherent.
    const freshView = await new GetProgramEnrollmentUseCase(
      programEnrollmentRepository,
      workoutSessionRepository,
    ).execute({ userId: OWNER, program });
    expect(freshView.ok).toBe(true);
    if (!freshView.ok || freshView.data.status !== 'enrolled') {
      throw new Error('expected the replacement run');
    }
    const fencedToB = await schedule().execute({
      userId: OWNER,
      program,
      now: NOW,
      expectedEnrollmentId: freshView.data.enrollmentId,
    });
    expect(fencedToB.ok).toBe(true);
    if (!fencedToB.ok || fencedToB.data === null) throw new Error('expected the coherent B calendar');
    expect(fencedToB.data.configured).toBe(false);
  });
});
