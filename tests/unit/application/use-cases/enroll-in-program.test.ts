import { describe, expect, it, vi } from 'vitest';
import { EnrollmentAlreadyExistsError } from '@/application/ports/program-enrollment-repository';
import type { ProgramRepository } from '@/application/ports/program-repository';
import { EnrollInProgramUseCase } from '@/application/use-cases/enroll-in-program';
import { InMemoryProgramEnrollmentRepository } from '@/infrastructure/enrollments/in-memory-program-enrollment-repository';
import { createTrainingProgram } from '@/domain/entities/training-program';
import { createWorkout } from '@/domain/entities/workout';
import { Difficulty } from '@/domain/types/exercise';
import { createExerciseId, createProgramId, createScheduledWorkoutId, createUserId } from '@/domain/types/ids';
import { ProgramGoal } from '@/domain/types/program';
import { createRepScheme } from '@/domain/value-objects/rep-prescription';

import { FakeIdGenerator } from '../../helpers/fake-crypto';

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

function makeUseCase(programs = [makeProgram('p1', 'prog-1'), makeProgram('p2', 'prog-2')]) {
  const programRepo: ProgramRepository = {
    list: vi.fn().mockResolvedValue(programs),
    findBySlug: vi.fn().mockImplementation((slug: string) =>
      Promise.resolve(programs.find((p) => p.slug === slug) ?? null)),
    findSlugByScheduledWorkoutId: vi.fn(),
  };
  const enrollmentRepo = new InMemoryProgramEnrollmentRepository();
  const uc = new EnrollInProgramUseCase(programRepo, enrollmentRepo, new FakeIdGenerator());
  return { enrollmentRepo, uc };
}

describe('EnrollInProgramUseCase', () => {
  it('enrolls the user in the program', async () => {
    const { enrollmentRepo, uc } = makeUseCase();

    const result = await uc.execute({ userId: 'user-a', programSlug: 'prog-1' });

    expect(result.ok).toBe(true);
    const enrollment = await enrollmentRepo.findByUserAndProgram(uid('user-a'), pid('p1'));
    expect(enrollment).not.toBeNull();
    expect(enrollment?.id).toBe('fake-id-1');
  });

  it('returns PROGRAM_NOT_FOUND for an unknown program slug', async () => {
    const { uc } = makeUseCase();
    const result = await uc.execute({ userId: 'user-a', programSlug: 'missing' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('PROGRAM_NOT_FOUND');
  });

  it('returns ALREADY_ENROLLED when the user re-joins an active enrollment', async () => {
    const { uc } = makeUseCase();
    await uc.execute({ userId: 'user-a', programSlug: 'prog-1' });

    const second = await uc.execute({ userId: 'user-a', programSlug: 'prog-1' });

    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.error.code).toBe('ALREADY_ENROLLED');
  });

  it('maps a concurrent join race (unique violation) to ALREADY_ENROLLED', async () => {
    const { enrollmentRepo, uc } = makeUseCase();
    vi.spyOn(enrollmentRepo, 'create').mockRejectedValue(
      new EnrollmentAlreadyExistsError('user-a', 'p1'),
    );

    const result = await uc.execute({ userId: 'user-a', programSlug: 'prog-1' });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('ALREADY_ENROLLED');
  });

  it('lets a user enroll in multiple programs independently', async () => {
    const { enrollmentRepo, uc } = makeUseCase();

    const first = await uc.execute({ userId: 'user-a', programSlug: 'prog-1' });
    const second = await uc.execute({ userId: 'user-a', programSlug: 'prog-2' });

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(await enrollmentRepo.listByUserId(uid('user-a'))).toHaveLength(2);
  });

  it('lets different users enroll in the same program independently', async () => {
    const { enrollmentRepo, uc } = makeUseCase();

    const a = await uc.execute({ userId: 'user-a', programSlug: 'prog-1' });
    const b = await uc.execute({ userId: 'user-b', programSlug: 'prog-1' });

    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    expect(await enrollmentRepo.findByUserAndProgram(uid('user-a'), pid('p1'))).not.toBeNull();
    expect(await enrollmentRepo.findByUserAndProgram(uid('user-b'), pid('p1'))).not.toBeNull();
  });
});
