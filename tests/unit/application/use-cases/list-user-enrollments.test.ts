import { describe, expect, it, vi } from 'vitest';
import type { ProgramRepository } from '@/application/ports/program-repository';
import { ListUserEnrollmentsUseCase } from '@/application/use-cases/list-user-enrollments';
import { InMemoryProgramEnrollmentRepository } from '@/infrastructure/enrollments/in-memory-program-enrollment-repository';
import { createProgramEnrollment } from '@/domain/entities/program-enrollment';
import { createTrainingProgram } from '@/domain/entities/training-program';
import { createWorkout } from '@/domain/entities/workout';
import { Difficulty } from '@/domain/types/exercise';
import { createExerciseId, createScheduledWorkoutId } from '@/domain/types/ids';
import { ProgramGoal } from '@/domain/types/program';
import { createRepScheme } from '@/domain/value-objects/rep-prescription';

function rep() { const r = createRepScheme(3, 8, 10); if (!r.ok) throw Error(); return r.data; }
function eid(v: string) { const r = createExerciseId(v); if (!r.ok) throw Error(); return r.data; }
function swid(v: string) { const r = createScheduledWorkoutId(v); if (!r.ok) throw Error(); return r.data; }

function makeProgram(id: string, slug: string, name: string) {
  const wr = createWorkout({ id: `wo-${id}`, name: 'W1', slug: `w-${id}`, description: 'A test workout', estimatedDurationMinutes: 30, exercises: [{ exerciseId: eid('ex-001'), order: 1, prescription: rep(), restSeconds: 60 }] });
  if (!wr.ok) throw Error();
  const pr = createTrainingProgram({
    id, name, slug, description: 'A test program', difficulty: Difficulty.Beginner, goal: ProgramGoal.Strength,
    durationWeeks: 1, workoutsPerWeek: 1, workouts: [wr.data],
    weeks: [{ weekNumber: 1, scheduledWorkouts: [{ id: swid(`sched-${id}-w1`), workoutId: wr.data.id, order: 1 }] }],
  });
  if (!pr.ok) throw Error();
  return pr.data;
}

function enroll(repo: InMemoryProgramEnrollmentRepository, enrollmentId: string, userId: string, programId: string, enrolledAt: string) {
  const r = createProgramEnrollment({ id: enrollmentId, userId, programId, enrolledAt: new Date(enrolledAt) });
  if (!r.ok) throw Error();
  return repo.create(r.data);
}

function makeUseCase() {
  const programs = [makeProgram('p1', 'prog-1', 'Program One'), makeProgram('p2', 'prog-2', 'Program Two')];
  const programRepo: ProgramRepository = { list: vi.fn().mockResolvedValue(programs), findBySlug: vi.fn() };
  const enrollmentRepo = new InMemoryProgramEnrollmentRepository();
  const uc = new ListUserEnrollmentsUseCase(enrollmentRepo, programRepo);
  return { enrollmentRepo, uc };
}

describe('ListUserEnrollmentsUseCase', () => {
  it('returns an empty list when the user has no enrollments', async () => {
    const { uc } = makeUseCase();
    expect(await uc.execute('user-a')).toEqual([]);
  });

  it('lists only the given user\'s enrollments with program slugs and names', async () => {
    const { enrollmentRepo, uc } = makeUseCase();
    await enroll(enrollmentRepo, 'enr-1', 'user-a', 'p1', '2026-01-01T10:00:00Z');
    await enroll(enrollmentRepo, 'enr-2', 'user-a', 'p2', '2026-02-01T10:00:00Z');
    await enroll(enrollmentRepo, 'enr-3', 'user-b', 'p1', '2026-01-15T10:00:00Z');

    const result = await uc.execute('user-a');

    expect(result).toEqual([
      { programId: 'p1', programSlug: 'prog-1', programName: 'Program One', enrolledAt: '2026-01-01T10:00:00.000Z' },
      { programId: 'p2', programSlug: 'prog-2', programName: 'Program Two', enrolledAt: '2026-02-01T10:00:00.000Z' },
    ]);
  });
});
