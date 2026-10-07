/**
 * M15 Slice 2 — planned-workout lifecycle on real PostgreSQL.
 *
 * The FK cascade is M15's lifecycle cleanup, so this suite proves it with the
 * real lifecycle code paths — no production change was made to M14:
 * `ProgramEnrollmentRepository.delete` (what leaving a program does),
 * `replaceExpectedWithNew` (M14's single atomic restart write) and the
 * `RestartProgramUseCase` on top of it.
 *
 * Guarantees pinned here: a deleted run takes its planning with it, a
 * replacement enrollment starts with zero planning, planning can never outlive
 * its enrollment (no orphans), and WorkoutSessions keep the exact pre-M15
 * behaviour (detached, still historical, never reattached).
 */

import { inArray } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { RestartProgramUseCase } from '@/application/use-cases/restart-program';
import { createProgramEnrollment } from '@/domain/entities/program-enrollment';
import { createUserId, type EnrollmentId } from '@/domain/types/ids';
import { NodeIdGenerator } from '@/infrastructure/crypto/node-id-generator';
import { workoutSessions } from '@/infrastructure/database/schema';

import {
  allPlannedRows,
  enrollmentIdValue,
  enrollmentIdsForOwner,
  plannedSetFor,
  seedCompletedRun,
  seedEnrolledRun,
  type CompletedRunFixture,
  type PlannedRunFixture,
} from './planned-workout-fixtures';
import {
  closeDatabase,
  db,
  plannedWorkoutRepository,
  programEnrollmentRepository,
  programRepository,
  resetAndSeed,
  trainingHistoryRepository,
  workoutSessionRepository,
} from './setup';

const OWNER = 'planned-lifecycle-owner';
const PROGRAM_SLUG = 'strong-at-home';

function ownerId() {
  const result = createUserId(OWNER);
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

function restartUseCase(): RestartProgramUseCase {
  return new RestartProgramUseCase(
    programRepository,
    programEnrollmentRepository,
    workoutSessionRepository,
    new NodeIdGenerator(),
  );
}

/** Session rows for the given ids, straight from the table. */
async function sessionRowsFor(sessionIds: ReadonlyArray<string>) {
  return db
    .select({
      id: workoutSessions.id,
      enrollmentId: workoutSessions.enrollmentId,
    })
    .from(workoutSessions)
    .where(inArray(workoutSessions.id, [...sessionIds]));
}

/** Completed-history size for the owner, through the real history read. */
async function historySize(): Promise<number> {
  const page = await trainingHistoryRepository.listCompletedSessions(ownerId(), {
    limit: 50,
    after: null,
  });
  return page.entries.length;
}

/** No planned row may reference an enrollment that no longer exists. */
async function expectNoOrphanPlanning(): Promise<void> {
  const rows = await allPlannedRows();
  const enrollments = await enrollmentIdsForOwner(OWNER);
  for (const row of rows) {
    expect(enrollments).toContain(row.enrollmentId);
  }
}

/** A replacement enrollment for the same (user, program) pair. */
async function replacementEnrollment(id: string, programId: string, enrolledAt: string) {
  const created = createProgramEnrollment({
    id,
    userId: OWNER,
    programId,
    enrolledAt: new Date(enrolledAt),
  });
  if (!created.ok) throw new Error(created.error.message);
  return created.data;
}

function runEnrollment(run: PlannedRunFixture): EnrollmentId {
  return enrollmentIdValue(run.enrollmentId);
}

describe('planned_workouts lifecycle — leave and delete', () => {
  let run: CompletedRunFixture;

  beforeEach(async () => {
    await resetAndSeed();
    run = await seedCompletedRun({
      owner: OWNER,
      programSlug: PROGRAM_SLUG,
      enrollmentId: 'enr-lifecycle-leave',
    });
    await plannedWorkoutRepository.replaceAllForEnrollment(
      runEnrollment(run),
      plannedSetFor(run.program, run.enrollmentId, '2026-10-01'),
    );
  });

  it('cascades a deleted run’s planning away and leaves its sessions detached', async () => {
    expect(await allPlannedRows()).toHaveLength(run.occurrenceIds.length);
    const historyBefore = await historySize();

    const deleted = await programEnrollmentRepository.delete(runEnrollment(run));

    expect(deleted).toBe(true);
    // The cascade removed the run's planning in the same database action.
    expect(await allPlannedRows()).toEqual([]);
    await expectNoOrphanPlanning();

    // Sessions keep the pre-M15 semantics: still stored, now detached.
    const sessions = await sessionRowsFor(run.sessionIds);
    expect(sessions).toHaveLength(run.sessionIds.length);
    expect(sessions.every((session) => session.enrollmentId === null)).toBe(true);
    // ...no longer counting toward the deleted run...
    expect(await workoutSessionRepository.listCompletedByEnrollment(runEnrollment(run))).toEqual([]);
    // ...while remaining the user's training history.
    expect(await historySize()).toBe(historyBefore);
  });
});

describe('planned_workouts lifecycle — M14 restart', () => {
  let run: CompletedRunFixture;

  beforeEach(async () => {
    await resetAndSeed();
    run = await seedCompletedRun({
      owner: OWNER,
      programSlug: PROGRAM_SLUG,
      enrollmentId: 'enr-lifecycle-restart',
    });
    await plannedWorkoutRepository.replaceAllForEnrollment(
      runEnrollment(run),
      plannedSetFor(run.program, run.enrollmentId, '2026-10-01'),
    );
  });

  it('removes the completed run’s planning and starts the fresh run with zero', async () => {
    const historyBefore = await historySize();

    const result = await restartUseCase().execute({ userId: OWNER, programSlug: PROGRAM_SLUG });
    expect(result.ok).toBe(true);

    const enrollments = await enrollmentIdsForOwner(OWNER);
    expect(enrollments).toHaveLength(1);
    const fresh = enrollments[0];
    if (fresh === undefined) throw new Error('expected a fresh enrollment');
    expect(fresh).not.toBe(run.enrollmentId);

    // The old run's planning is gone, and the fresh run inherited nothing.
    expect(await allPlannedRows()).toEqual([]);
    expect(await plannedWorkoutRepository.listByEnrollment(enrollmentIdValue(fresh))).toEqual([]);
    await expectNoOrphanPlanning();

    // Sessions: detached historical truth, never reattached to the fresh run.
    const sessions = await sessionRowsFor(run.sessionIds);
    expect(sessions).toHaveLength(run.sessionIds.length);
    expect(sessions.every((session) => session.enrollmentId === null)).toBe(true);
    expect(await historySize()).toBe(historyBefore);
  });

  it('clears planning through the atomic replacement primitive itself', async () => {
    const fresh = await replacementEnrollment('enr-lifecycle-replacement', run.program.id, '2026-12-01T00:00:00Z');

    const replaced = await programEnrollmentRepository.replaceExpectedWithNew(
      runEnrollment(run),
      fresh,
    );

    expect(replaced).toBe(true);
    expect(await allPlannedRows()).toEqual([]);
    expect(
      await plannedWorkoutRepository.listByEnrollment(enrollmentIdValue('enr-lifecycle-replacement')),
    ).toEqual([]);
    await expectNoOrphanPlanning();
  });
});

describe('planned_workouts lifecycle — planning never outlives its run', () => {
  beforeEach(async () => {
    await resetAndSeed();
  });

  it('refuses the stale run id and accepts the fresh run’s own planning', async () => {
    const run = await seedEnrolledRun({
      owner: OWNER,
      programSlug: PROGRAM_SLUG,
      enrollmentId: 'enr-lifecycle-rewrite',
    });
    await plannedWorkoutRepository.replaceAllForEnrollment(
      runEnrollment(run),
      plannedSetFor(run.program, run.enrollmentId, '2026-10-01'),
    );

    const fresh = await replacementEnrollment('enr-lifecycle-rewrite-2', run.program.id, '2026-12-01T00:00:00Z');
    await programEnrollmentRepository.replaceExpectedWithNew(runEnrollment(run), fresh);

    // The stale run id can no longer be written into (it is gone)...
    const staleWrite = await plannedWorkoutRepository.replaceAllForEnrollment(
      runEnrollment(run),
      plannedSetFor(run.program, run.enrollmentId, '2027-01-01'),
    );
    expect(staleWrite).toBe(false);

    // ...while the fresh run accepts its own planning normally.
    const freshId = enrollmentIdValue('enr-lifecycle-rewrite-2');
    const freshWrite = await plannedWorkoutRepository.replaceAllForEnrollment(
      freshId,
      plannedSetFor(run.program, 'enr-lifecycle-rewrite-2', '2027-02-01'),
    );
    expect(freshWrite).toBe(true);
    expect(await plannedWorkoutRepository.listByEnrollment(freshId)).toHaveLength(
      run.occurrenceIds.length,
    );
    await expectNoOrphanPlanning();
  });
});

afterAll(async () => {
  await closeDatabase();
});
