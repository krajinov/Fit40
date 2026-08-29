import { describe, expect, it, vi } from 'vitest';
import type { ProgramRepository } from '@/application/ports/program-repository';
import { GetWorkoutSessionUseCase } from '@/application/use-cases/get-workout-session';
import { InMemoryProgramEnrollmentRepository } from '@/infrastructure/enrollments/in-memory-program-enrollment-repository';
import { InMemoryWorkoutSessionRepository } from '@/infrastructure/sessions/in-memory-workout-session-repository';
import { createProgramEnrollment } from '@/domain/entities/program-enrollment';
import { createTrainingProgram } from '@/domain/entities/training-program';
import { createWorkout } from '@/domain/entities/workout';
import { createWorkoutSession } from '@/domain/entities/workout-session';
import { Difficulty } from '@/domain/types/exercise';
import { createEnrollmentId, createExerciseId, createScheduledWorkoutId, createUserId } from '@/domain/types/ids';
import { ProgramGoal } from '@/domain/types/program';
import { createRepScheme } from '@/domain/value-objects/rep-prescription';

function rep() { const r = createRepScheme(3, 8, 10); if (!r.ok) throw Error(); return r.data; }
function eid(v: string) { const r = createExerciseId(v); if (!r.ok) throw Error(); return r.data; }
function swid(v: string) { const r = createScheduledWorkoutId(v); if (!r.ok) throw Error(); return r.data; }
function uid(v: string) { const r = createUserId(v); if (!r.ok) throw Error(); return r.data; }
function enid(v: string) { const r = createEnrollmentId(v); if (!r.ok) throw Error(); return r.data; }

function seedProgram() {
  const wr = createWorkout({ id: 'wo-1', name: 'W1', slug: 'w1', description: 'A test workout', estimatedDurationMinutes: 30, exercises: [{ exerciseId: eid('ex-001'), order: 1, prescription: rep(), restSeconds: 60 }] });
  if (!wr.ok) throw Error();
  const sw = swid('sched-wo1');
  const pr = createTrainingProgram({
    id: 'p1', name: 'P1', slug: 'prog-1', description: 'A test program', difficulty: Difficulty.Beginner, goal: ProgramGoal.Strength,
    durationWeeks: 1, workoutsPerWeek: 1, workouts: [wr.data],
    weeks: [{ weekNumber: 1, scheduledWorkouts: [{ id: sw, workoutId: wr.data.id, order: 1 }] }],
  });
  if (!pr.ok) throw Error();
  return { program: pr.data, swId: sw, workoutId: wr.data.id };
}

function seedEnrollment(repo: InMemoryProgramEnrollmentRepository, enrollmentId: string, userId: string, programId: string) {
  const r = createProgramEnrollment({ id: enrollmentId, userId, programId, enrolledAt: new Date('2026-01-01T00:00:00Z') });
  if (!r.ok) throw Error();
  return repo.create(r.data);
}

function seedSession(repo: InMemoryWorkoutSessionRepository, sessionId: string, userId: string, enrollmentId: string) {
  const { swId, workoutId } = seedProgram();
  const sr = createWorkoutSession({ id: sessionId, userId: uid(userId), enrollmentId: enid(enrollmentId), scheduledWorkoutId: swId, workoutId, startedAt: new Date(), exerciseLogs: [{ exerciseId: eid('ex-001'), order: 1, prescription: rep(), restSeconds: 60 }] });
  if (!sr.ok) throw Error();
  return repo.save(sr.data);
}

function makeUseCase() {
  const { program } = seedProgram();
  const programRepo: ProgramRepository = { list: vi.fn(), findBySlug: vi.fn().mockResolvedValue(program), findSessionRouteByScheduledWorkoutId: vi.fn() };
  const sessionRepo = new InMemoryWorkoutSessionRepository();
  const enrollmentRepo = new InMemoryProgramEnrollmentRepository();
  const uc = new GetWorkoutSessionUseCase(programRepo, sessionRepo, enrollmentRepo);
  return { sessionRepo, enrollmentRepo, uc };
}

const INPUT = { programSlug: 'prog-1', weekNumber: 1, workoutOrder: 1 } as const;

describe('GetWorkoutSessionUseCase', () => {
  it('reports not-enrolled with no session when the user has not joined', async () => {
    const { uc } = makeUseCase();
    const r = await uc.execute({ ...INPUT, userId: 'user-a' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data).toEqual({ enrolled: false, session: null });
  });

  it('reports enrolled with null session when the workout was not started', async () => {
    const { enrollmentRepo, uc } = makeUseCase();
    await seedEnrollment(enrollmentRepo, 'enr-a', 'user-a', 'p1');

    const r = await uc.execute({ ...INPUT, userId: 'user-a' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data).toEqual({ enrolled: true, session: null });
  });

  it('returns the session when it exists for the user\'s enrollment', async () => {
    const { sessionRepo, enrollmentRepo, uc } = makeUseCase();
    await seedEnrollment(enrollmentRepo, 'enr-a', 'user-a', 'p1');
    await seedSession(sessionRepo, 's-1', 'user-a', 'enr-a');

    const r = await uc.execute({ ...INPUT, userId: 'user-a' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.enrolled).toBe(true);
    expect(r.data.session?.sessionId).toBe('s-1');
    expect(r.data.session?.status).toBe('in-progress');
  });

  it('never returns another user\'s session for the same occurrence', async () => {
    const { sessionRepo, enrollmentRepo, uc } = makeUseCase();
    await seedEnrollment(enrollmentRepo, 'enr-a', 'user-a', 'p1');
    await seedEnrollment(enrollmentRepo, 'enr-b', 'user-b', 'p1');
    await seedSession(sessionRepo, 's-1', 'user-a', 'enr-a');

    const r = await uc.execute({ ...INPUT, userId: 'user-b' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.session).toBeNull();
  });

  it('returns PROGRAM_NOT_FOUND', async () => {
    const programRepo: ProgramRepository = { list: vi.fn(), findBySlug: vi.fn().mockResolvedValue(null), findSessionRouteByScheduledWorkoutId: vi.fn() };
    const uc = new GetWorkoutSessionUseCase(programRepo, new InMemoryWorkoutSessionRepository(), new InMemoryProgramEnrollmentRepository());
    const r = await uc.execute({ ...INPUT, programSlug: 'missing', userId: 'user-a' });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('PROGRAM_NOT_FOUND');
  });
});
