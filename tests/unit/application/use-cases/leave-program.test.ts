import { describe, expect, it, vi } from 'vitest';
import type { ProgramRepository } from '@/application/ports/program-repository';
import { LeaveProgramUseCase } from '@/application/use-cases/leave-program';
import { InMemoryProgramEnrollmentRepository } from '@/infrastructure/enrollments/in-memory-program-enrollment-repository';
import { createProgramEnrollment } from '@/domain/entities/program-enrollment';
import { createTrainingProgram } from '@/domain/entities/training-program';
import { createWorkout } from '@/domain/entities/workout';
import { Difficulty } from '@/domain/types/exercise';
import { createExerciseId, createProgramId, createScheduledWorkoutId, createUserId } from '@/domain/types/ids';
import { ProgramGoal } from '@/domain/types/program';
import { createRepScheme } from '@/domain/value-objects/rep-prescription';

function rep() { const r = createRepScheme(3, 8, 10); if (!r.ok) throw Error(); return r.data; }
function eid(v: string) { const r = createExerciseId(v); if (!r.ok) throw Error(); return r.data; }
function swid(v: string) { const r = createScheduledWorkoutId(v); if (!r.ok) throw Error(); return r.data; }
function uid(v: string) { const r = createUserId(v); if (!r.ok) throw Error(); return r.data; }
function pid(v: string) { const r = createProgramId(v); if (!r.ok) throw Error(); return r.data; }

function makeProgram(id: string, slug: string) {
  const wr = createWorkout({ id: `wo-${id}`, name: 'W1', slug: `w-${id}`, description: 'A test workout', estimatedDurationMinutes: 30, exercises: [{ exerciseId: eid('ex-001'), order: 1, prescription: rep(), restSeconds: 60 }] });
  if (!wr.ok) throw Error();
  const pr = createTrainingProgram({
    id, name: id, slug, description: 'A test program', difficulty: Difficulty.Beginner, goal: ProgramGoal.Strength,
    durationWeeks: 1, workoutsPerWeek: 1, workouts: [wr.data],
    weeks: [{ weekNumber: 1, scheduledWorkouts: [{ id: swid(`sched-${id}-w1`), workoutId: wr.data.id, order: 1 }] }],
  });
  if (!pr.ok) throw Error();
  return pr.data;
}

function makeUseCase(programs = [makeProgram('p1', 'prog-1')]) {
  const programRepo: ProgramRepository = {
    list: vi.fn().mockResolvedValue(programs),
    findBySlug: vi.fn().mockImplementation((slug: string) =>
      Promise.resolve(programs.find((p) => p.slug === slug) ?? null)),
    findSlugByScheduledWorkoutId: vi.fn(),
  };
  const enrollmentRepo = new InMemoryProgramEnrollmentRepository();
  const uc = new LeaveProgramUseCase(programRepo, enrollmentRepo);
  return { enrollmentRepo, uc };
}

function enroll(repo: InMemoryProgramEnrollmentRepository, enrollmentId: string, userId: string, programId: string) {
  const r = createProgramEnrollment({ id: enrollmentId, userId, programId, enrolledAt: new Date('2026-01-01T00:00:00Z') });
  if (!r.ok) throw Error();
  return repo.create(r.data);
}

describe('LeaveProgramUseCase', () => {
  it('removes the user\'s enrollment', async () => {
    const { enrollmentRepo, uc } = makeUseCase();
    await enroll(enrollmentRepo, 'enr-a', 'user-a', 'p1');

    const result = await uc.execute({ userId: 'user-a', programSlug: 'prog-1' });

    expect(result.ok).toBe(true);
    expect(await enrollmentRepo.findByUserAndProgram(uid('user-a'), pid('p1'))).toBeNull();
  });

  it('returns NOT_ENROLLED when the user has no enrollment in the program', async () => {
    const { uc } = makeUseCase();
    const result = await uc.execute({ userId: 'user-a', programSlug: 'prog-1' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('NOT_ENROLLED');
  });

  it('returns PROGRAM_NOT_FOUND for an unknown program slug', async () => {
    const { uc } = makeUseCase();
    const result = await uc.execute({ userId: 'user-a', programSlug: 'missing' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('PROGRAM_NOT_FOUND');
  });

  it('maps an enrollment that vanished mid-request to NOT_ENROLLED', async () => {
    const { enrollmentRepo, uc } = makeUseCase();
    await enroll(enrollmentRepo, 'enr-a', 'user-a', 'p1');
    vi.spyOn(enrollmentRepo, 'delete').mockResolvedValue(false);

    const result = await uc.execute({ userId: 'user-a', programSlug: 'prog-1' });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('NOT_ENROLLED');
  });

  it('does not touch another user\'s enrollment in the same program', async () => {
    const { enrollmentRepo, uc } = makeUseCase();
    await enroll(enrollmentRepo, 'enr-a', 'user-a', 'p1');
    await enroll(enrollmentRepo, 'enr-b', 'user-b', 'p1');

    const result = await uc.execute({ userId: 'user-a', programSlug: 'prog-1' });

    expect(result.ok).toBe(true);
    expect(await enrollmentRepo.findByUserAndProgram(uid('user-b'), pid('p1'))).not.toBeNull();
  });
});
