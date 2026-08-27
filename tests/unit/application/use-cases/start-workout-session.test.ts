import { describe, expect, it, vi } from 'vitest';
import type { ProgramRepository } from '@/application/ports/program-repository';
import { StartWorkoutSessionUseCase } from '@/application/use-cases/start-workout-session';
import { InMemoryWorkoutSessionRepository } from '@/infrastructure/sessions/in-memory-workout-session-repository';
import { createExercise } from '@/domain/entities/exercise';
import { createTrainingProgram, type TrainingProgram } from '@/domain/entities/training-program';
import { createWorkout, type Workout } from '@/domain/entities/workout';
import { Difficulty, EquipmentType, MovementPattern, MuscleGroup } from '@/domain/types/exercise';
import { createExerciseId, createScheduledWorkoutId } from '@/domain/types/ids';
import { ProgramGoal } from '@/domain/types/program';
import { createRepScheme } from '@/domain/value-objects/rep-prescription';

function rep() { const r = createRepScheme(3, 8, 10); if (!r.ok) throw Error(); return r.data; }
function eid(v: string) { const r = createExerciseId(v); if (!r.ok) throw Error(); return r.data; }

function makeWorkout(id: string, exerciseIds: string[]): Workout {
  const r = createWorkout({
    id, name: `W${id}`, slug: `w-${id}`, description: 'A test workout', estimatedDurationMinutes: 30,
    exercises: exerciseIds.map((eidStr, i) => ({
      exerciseId: eid(eidStr), order: i + 1, prescription: rep(), restSeconds: 60,
    })),
  });
  if (!r.ok) throw Error();
  return r.data;
}

function makeProgram(): TrainingProgram {
  const w1 = makeWorkout('wo-1', ['ex-001', 'ex-002']);
  const sw1 = createScheduledWorkoutId('sched-w1');
  if (!sw1.ok) throw Error();
  const r = createTrainingProgram({
    id: 'prog-test', name: 'Test', slug: 'test-program', description: 'A test program',
    difficulty: Difficulty.Beginner, goal: ProgramGoal.Strength,
    durationWeeks: 1, workoutsPerWeek: 1,
    workouts: [w1],
    weeks: [{ weekNumber: 1, scheduledWorkouts: [{ id: sw1.data, workoutId: w1.id, order: 1 }] }],
  });
  if (!r.ok) throw Error();
  return r.data;
}

function createMockRepo(): ProgramRepository {
  return { list: vi.fn(), findBySlug: vi.fn() };
}

describe('StartWorkoutSessionUseCase', () => {
  it('starts a valid session from program slug/week/order', async () => {
    const programRepo = createMockRepo();
    vi.mocked(programRepo.findBySlug).mockResolvedValue(makeProgram());
    const sessionRepo = new InMemoryWorkoutSessionRepository();
    const useCase = new StartWorkoutSessionUseCase(programRepo, sessionRepo);
    const result = await useCase.execute({ programSlug: 'test-program', weekNumber: 1, workoutOrder: 1 });
    expect(result.ok).toBe(true);
  });

  it('returns DTO with status in-progress', async () => {
    const programRepo = createMockRepo();
    vi.mocked(programRepo.findBySlug).mockResolvedValue(makeProgram());
    const sessionRepo = new InMemoryWorkoutSessionRepository();
    const useCase = new StartWorkoutSessionUseCase(programRepo, sessionRepo);
    const result = await useCase.execute({ programSlug: 'test-program', weekNumber: 1, workoutOrder: 1 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.status).toBe('in-progress');
    expect(result.data.sessionId).toBeTruthy();
  });

  it('snapshots exercise logs with correct data', async () => {
    const programRepo = createMockRepo();
    vi.mocked(programRepo.findBySlug).mockResolvedValue(makeProgram());
    const sessionRepo = new InMemoryWorkoutSessionRepository();
    const useCase = new StartWorkoutSessionUseCase(programRepo, sessionRepo);
    const result = await useCase.execute({ programSlug: 'test-program', weekNumber: 1, workoutOrder: 1 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.exerciseLogs).toHaveLength(2);
    expect(result.data.exerciseLogs[0]?.order).toBe(1);
    expect(result.data.exerciseLogs[0]?.prescription.type).toBe('reps');
    expect(result.data.exerciseLogs[0]?.sets).toEqual([]);
  });

  it('returns PROGRAM_NOT_FOUND when program missing', async () => {
    const programRepo = createMockRepo();
    vi.mocked(programRepo.findBySlug).mockResolvedValue(null);
    const useCase = new StartWorkoutSessionUseCase(programRepo, new InMemoryWorkoutSessionRepository());
    const result = await useCase.execute({ programSlug: 'missing', weekNumber: 1, workoutOrder: 1 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('PROGRAM_NOT_FOUND');
  });

  it('returns SCHEDULED_WORKOUT_NOT_FOUND for invalid week', async () => {
    const programRepo = createMockRepo();
    vi.mocked(programRepo.findBySlug).mockResolvedValue(makeProgram());
    const useCase = new StartWorkoutSessionUseCase(programRepo, new InMemoryWorkoutSessionRepository());
    const result = await useCase.execute({ programSlug: 'test-program', weekNumber: 99, workoutOrder: 1 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('SCHEDULED_WORKOUT_NOT_FOUND');
  });

  it('returns SESSION_ALREADY_EXISTS when session already exists', async () => {
    const programRepo = createMockRepo();
    vi.mocked(programRepo.findBySlug).mockResolvedValue(makeProgram());
    const sessionRepo = new InMemoryWorkoutSessionRepository();
    const useCase = new StartWorkoutSessionUseCase(programRepo, sessionRepo);
    await useCase.execute({ programSlug: 'test-program', weekNumber: 1, workoutOrder: 1 });
    const second = await useCase.execute({ programSlug: 'test-program', weekNumber: 1, workoutOrder: 1 });
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.error.code).toBe('SESSION_ALREADY_EXISTS');
  });

  it('returns SESSION_ALREADY_EXISTS when a concurrent start wins the unique constraint', async () => {
    const programRepo = createMockRepo();
    vi.mocked(programRepo.findBySlug).mockResolvedValue(makeProgram());
    const sessionRepo = new InMemoryWorkoutSessionRepository();
    const useCase = new StartWorkoutSessionUseCase(programRepo, sessionRepo);

    const first = await useCase.execute({
      programSlug: 'test-program',
      weekNumber: 1,
      workoutOrder: 1,
    });
    expect(first.ok).toBe(true);

    // Two overlapping requests can both pass the existence pre-check before the
    // loser's insert is rejected by the one-session-per-occurrence constraint.
    vi.spyOn(sessionRepo, 'findByScheduledWorkoutId').mockResolvedValue(null);

    const raced = await useCase.execute({
      programSlug: 'test-program',
      weekNumber: 1,
      workoutOrder: 1,
    });
    expect(raced.ok).toBe(false);
    if (raced.ok) return;
    expect(raced.error).toMatchObject({
      code: 'SESSION_ALREADY_EXISTS',
      scheduledWorkoutId: 'sched-w1',
    });
  });
});
