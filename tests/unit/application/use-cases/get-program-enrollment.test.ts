import { describe, expect, it } from 'vitest';
import { GetProgramEnrollmentUseCase } from '@/application/use-cases/get-program-enrollment';
import { InMemoryProgramEnrollmentRepository } from '@/infrastructure/enrollments/in-memory-program-enrollment-repository';
import { InMemoryWorkoutSessionRepository } from '@/infrastructure/sessions/in-memory-workout-session-repository';
import { createProgramEnrollment } from '@/domain/entities/program-enrollment';
import { createTrainingProgram } from '@/domain/entities/training-program';
import { createWorkout } from '@/domain/entities/workout';
import {
  completeWorkoutSession,
  createWorkoutSession,
  logSessionSet,
} from '@/domain/entities/workout-session';
import { Difficulty } from '@/domain/types/exercise';
import {
  createEnrollmentId,
  createExerciseId,
  createScheduledWorkoutId,
  createUserId,
  createWorkoutId,
  type EnrollmentId,
} from '@/domain/types/ids';
import { ProgramGoal } from '@/domain/types/program';
import { createRepScheme } from '@/domain/value-objects/rep-prescription';

function rep() { const r = createRepScheme(3, 8, 10); if (!r.ok) throw Error(); return r.data; }
function eid(v: string) { const r = createExerciseId(v); if (!r.ok) throw Error(); return r.data; }
function swid(v: string) { const r = createScheduledWorkoutId(v); if (!r.ok) throw Error(); return r.data; }
function uid(v: string) { const r = createUserId(v); if (!r.ok) throw Error(); return r.data; }
function enid(v: string) { const r = createEnrollmentId(v); if (!r.ok) throw Error(); return r.data; }

/** Program with one week and two scheduled workouts: sched-w1 (order 1), sched-w2 (order 2). */
function makeProgram() {
  const w1r = createWorkout({ id: 'wo-1', name: 'W1', slug: 'w-1', description: 'First', estimatedDurationMinutes: 30, exercises: [{ exerciseId: eid('ex-001'), order: 1, prescription: rep(), restSeconds: 60 }] });
  const w2r = createWorkout({ id: 'wo-2', name: 'W2', slug: 'w-2', description: 'Second', estimatedDurationMinutes: 30, exercises: [{ exerciseId: eid('ex-002'), order: 1, prescription: rep(), restSeconds: 60 }] });
  if (!w1r.ok || !w2r.ok) throw Error();
  const pr = createTrainingProgram({
    id: 'p1', name: 'P1', slug: 'prog-1', description: 'A test program', difficulty: Difficulty.Beginner, goal: ProgramGoal.Strength,
    durationWeeks: 1, workoutsPerWeek: 2, workouts: [w1r.data, w2r.data],
    weeks: [{
      weekNumber: 1,
      scheduledWorkouts: [
        { id: swid('sched-w1'), workoutId: w1r.data.id, order: 1 },
        { id: swid('sched-w2'), workoutId: w2r.data.id, order: 2 },
      ],
    }],
  });
  if (!pr.ok) throw Error();
  return pr.data;
}

function enroll(repo: InMemoryProgramEnrollmentRepository, enrollmentId: string, userId: string, programId: string) {
  const r = createProgramEnrollment({ id: enrollmentId, userId, programId, enrolledAt: new Date('2026-01-01T00:00:00Z') });
  if (!r.ok) throw Error();
  return repo.create(r.data);
}

/** Saves a completed session for the given enrollment and occurrence. */
async function completeSession(
  repo: InMemoryWorkoutSessionRepository,
  sessionId: string,
  userId: string,
  enrollmentId: EnrollmentId | null,
  scheduledWorkoutId: string,
  workoutId: string,
) {
  const wId = createWorkoutIdForTest(workoutId);
  const sr = createWorkoutSession({
    id: sessionId, userId: uid(userId), enrollmentId,
    scheduledWorkoutId: swid(scheduledWorkoutId), workoutId: wId,
    startedAt: new Date('2026-01-02T10:00:00Z'),
    exerciseLogs: [{ exerciseId: eid('ex-001'), order: 1, prescription: rep(), restSeconds: 60 }],
  });
  if (!sr.ok) throw Error();
  const logged = logSessionSet(sr.data, { exerciseOrder: 1, type: 'reps', reps: 10, weightKg: null, rpe: null });
  if (!logged.ok) throw Error();
  const done = completeWorkoutSession(logged.data, new Date('2026-01-02T11:00:00Z'));
  if (!done.ok) throw Error();
  await repo.save(done.data);
}

function createWorkoutIdForTest(v: string) { const r = createWorkoutId(v); if (!r.ok) throw Error(); return r.data; }

function makeUseCase() {
  const sessionRepo = new InMemoryWorkoutSessionRepository();
  const enrollmentRepo = new InMemoryProgramEnrollmentRepository();
  const uc = new GetProgramEnrollmentUseCase(enrollmentRepo, sessionRepo);
  return { sessionRepo, enrollmentRepo, uc };
}

const INPUT = { program: makeProgram() } as const;

describe('GetProgramEnrollmentUseCase', () => {
  it('reports not-enrolled when the user has no enrollment', async () => {
    const { uc } = makeUseCase();
    const r = await uc.execute({ ...INPUT, userId: 'user-a' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data).toEqual({ status: 'not-enrolled' });
  });

  it('resolves the view entirely from the caller-supplied aggregate (no catalog re-query)', async () => {
    const { sessionRepo, enrollmentRepo, uc } = makeUseCase();
    await enroll(enrollmentRepo, 'enr-a', 'user-a', 'p1');
    await completeSession(sessionRepo, 's-1', 'user-a', enid('enr-a'), 'sched-w1', 'wo-1');

    // This aggregate was never persisted to any repository the use case
    // holds, so a correct result proves no second program lookup happens.
    const orphanAggregate = makeProgram();

    const r = await uc.execute({ userId: 'user-a', program: orphanAggregate });

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    if (r.data.status !== 'enrolled') throw Error('expected enrolled');
    expect(r.data.progress).toEqual({ totalWorkouts: 2, completedWorkouts: 1, percentage: 50 });
    expect(r.data.nextWorkout).toEqual({ weekNumber: 1, workoutOrder: 2 });
    expect(r.data.completedScheduledWorkoutIds).toEqual(['sched-w1']);
  });

  it('reports zero progress and the first workout as next for a fresh enrollment', async () => {
    const { enrollmentRepo, uc } = makeUseCase();
    await enroll(enrollmentRepo, 'enr-a', 'user-a', 'p1');

    const r = await uc.execute({ ...INPUT, userId: 'user-a' });

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    if (r.data.status !== 'enrolled') throw Error('expected enrolled');
    expect(r.data.progress).toEqual({ totalWorkouts: 2, completedWorkouts: 0, percentage: 0 });
    expect(r.data.nextWorkout).toEqual({ weekNumber: 1, workoutOrder: 1 });
    expect(r.data.completedScheduledWorkoutIds).toEqual([]);
    expect(r.data.enrolledAt).toBe('2026-01-01T00:00:00.000Z');
  });

  it('derives progress and the next workout from the enrollment\'s completed sessions', async () => {
    const { sessionRepo, enrollmentRepo, uc } = makeUseCase();
    await enroll(enrollmentRepo, 'enr-a', 'user-a', 'p1');
    await completeSession(sessionRepo, 's-1', 'user-a', enid('enr-a'), 'sched-w1', 'wo-1');

    const r = await uc.execute({ ...INPUT, userId: 'user-a' });

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    if (r.data.status !== 'enrolled') throw Error('expected enrolled');
    expect(r.data.progress).toEqual({ totalWorkouts: 2, completedWorkouts: 1, percentage: 50 });
    expect(r.data.nextWorkout).toEqual({ weekNumber: 1, workoutOrder: 2 });
    expect(r.data.completedScheduledWorkoutIds).toEqual(['sched-w1']);
  });

  it('reports nextWorkout as null when every scheduled workout is completed', async () => {
    const { sessionRepo, enrollmentRepo, uc } = makeUseCase();
    await enroll(enrollmentRepo, 'enr-a', 'user-a', 'p1');
    await completeSession(sessionRepo, 's-1', 'user-a', enid('enr-a'), 'sched-w1', 'wo-1');
    await completeSession(sessionRepo, 's-2', 'user-a', enid('enr-a'), 'sched-w2', 'wo-2');

    const r = await uc.execute({ ...INPUT, userId: 'user-a' });

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    if (r.data.status !== 'enrolled') throw Error('expected enrolled');
    expect(r.data.progress.percentage).toBe(100);
    expect(r.data.nextWorkout).toBeNull();
  });

  it('never counts another user\'s completions toward the current user\'s progress', async () => {
    const { sessionRepo, enrollmentRepo, uc } = makeUseCase();
    await enroll(enrollmentRepo, 'enr-a', 'user-a', 'p1');
    await enroll(enrollmentRepo, 'enr-b', 'user-b', 'p1');
    // User A completed the first occurrence.
    await completeSession(sessionRepo, 's-1', 'user-a', enid('enr-a'), 'sched-w1', 'wo-1');

    const r = await uc.execute({ ...INPUT, userId: 'user-b' });

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    if (r.data.status !== 'enrolled') throw Error('expected enrolled');
    expect(r.data.progress).toEqual({ totalWorkouts: 2, completedWorkouts: 0, percentage: 0 });
    expect(r.data.nextWorkout).toEqual({ weekNumber: 1, workoutOrder: 1 });
    expect(r.data.completedScheduledWorkoutIds).toEqual([]);
  });

  it('starts a rejoined enrollment at zero progress (old sessions are detached)', async () => {
    const { sessionRepo, enrollmentRepo, uc } = makeUseCase();
    // First enrollment completes the whole program, then leaves.
    await enroll(enrollmentRepo, 'enr-old', 'user-a', 'p1');
    await completeSession(sessionRepo, 's-1', 'user-a', enid('enr-old'), 'sched-w1', 'wo-1');
    await completeSession(sessionRepo, 's-2', 'user-a', enid('enr-old'), 'sched-w2', 'wo-2');
    await enrollmentRepo.delete(enid('enr-old'));
    // Detached history survives, but no longer counts toward any enrollment.
    await completeSession(sessionRepo, 's-3', 'user-a', null, 'sched-w1', 'wo-1');
    // Rejoin: fresh identity, fresh progress.
    await enroll(enrollmentRepo, 'enr-new', 'user-a', 'p1');

    const r = await uc.execute({ ...INPUT, userId: 'user-a' });

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    if (r.data.status !== 'enrolled') throw Error('expected enrolled');
    expect(r.data.progress).toEqual({ totalWorkouts: 2, completedWorkouts: 0, percentage: 0 });
    expect(r.data.nextWorkout).toEqual({ weekNumber: 1, workoutOrder: 1 });
    expect(r.data.completedScheduledWorkoutIds).toEqual([]);
  });

  it('ignores in-progress sessions when deriving progress', async () => {
    const { sessionRepo, enrollmentRepo, uc } = makeUseCase();
    await enroll(enrollmentRepo, 'enr-a', 'user-a', 'p1');
    const sr = createWorkoutSession({
      id: 's-ip', userId: uid('user-a'), enrollmentId: enid('enr-a'),
      scheduledWorkoutId: swid('sched-w1'), workoutId: createWorkoutIdForTest('wo-1'),
      startedAt: new Date('2026-01-02T10:00:00Z'),
      exerciseLogs: [{ exerciseId: eid('ex-001'), order: 1, prescription: rep(), restSeconds: 60 }],
    });
    if (!sr.ok) throw Error();
    await sessionRepo.save(sr.data);

    const r = await uc.execute({ ...INPUT, userId: 'user-a' });

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    if (r.data.status !== 'enrolled') throw Error('expected enrolled');
    expect(r.data.progress.completedWorkouts).toBe(0);
    expect(r.data.nextWorkout).toEqual({ weekNumber: 1, workoutOrder: 1 });
  });
});
