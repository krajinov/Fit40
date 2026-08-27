import { describe, expect, it, vi } from 'vitest';
import type { ProgramRepository } from '@/application/ports/program-repository';
import { GetWorkoutSessionUseCase } from '@/application/use-cases/get-workout-session';
import { InMemoryWorkoutSessionRepository } from '@/infrastructure/sessions/in-memory-workout-session-repository';
import { createTrainingProgram } from '@/domain/entities/training-program';
import { createWorkout } from '@/domain/entities/workout';
import { createWorkoutSession, logSessionSet } from '@/domain/entities/workout-session';
import { Difficulty } from '@/domain/types/exercise';
import { createExerciseId, createScheduledWorkoutId } from '@/domain/types/ids';
import { ProgramGoal } from '@/domain/types/program';
import { createRepScheme } from '@/domain/value-objects/rep-prescription';

function rep() { const r = createRepScheme(3, 8, 10); if (!r.ok) throw Error(); return r.data; }
function eid(v: string) { const r = createExerciseId(v); if (!r.ok) throw Error(); return r.data; }
function swid(v: string) { const r = createScheduledWorkoutId(v); if (!r.ok) throw Error(); return r.data; }

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

describe('GetWorkoutSessionUseCase', () => {
  it('returns null when no session exists', async () => {
    const repo: ProgramRepository = { list: vi.fn(), findBySlug: vi.fn().mockResolvedValue(seedProgram().program) };
    const sr = new InMemoryWorkoutSessionRepository();
    const uc = new GetWorkoutSessionUseCase(repo, sr);
    const r = await uc.execute({ programSlug: 'prog-1', weekNumber: 1, workoutOrder: 1 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data).toBeNull();
  });

  it('returns DTO when session exists', async () => {
    const { program, swId } = seedProgram();
    const repo: ProgramRepository = { list: vi.fn(), findBySlug: vi.fn().mockResolvedValue(program) };
    const sr = new InMemoryWorkoutSessionRepository();
    const sr2 = createWorkoutSession({ id: 's-1', scheduledWorkoutId: swId, workoutId: program.workouts[0]!.id, startedAt: new Date(), exerciseLogs: [{ exerciseId: eid('ex-001'), order: 1, prescription: rep(), restSeconds: 60 }] });
    if (!sr2.ok) throw Error();
    await sr.save(sr2.data);
    const uc = new GetWorkoutSessionUseCase(repo, sr);
    const r = await uc.execute({ programSlug: 'prog-1', weekNumber: 1, workoutOrder: 1 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data).not.toBeNull();
    expect(r.data!.status).toBe('in-progress');
  });

  it('returns PROGRAM_NOT_FOUND', async () => {
    const repo: ProgramRepository = { list: vi.fn(), findBySlug: vi.fn().mockResolvedValue(null) };
    const uc = new GetWorkoutSessionUseCase(repo, new InMemoryWorkoutSessionRepository());
    const r = await uc.execute({ programSlug: 'missing', weekNumber: 1, workoutOrder: 1 });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('PROGRAM_NOT_FOUND');
  });
});