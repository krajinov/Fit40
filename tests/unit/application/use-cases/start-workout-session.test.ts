import { describe, expect, it, vi } from 'vitest';
import type { ProgramRepository } from '@/application/ports/program-repository';
import { SessionAlreadyExistsError, SessionEnrollmentNotFoundError } from '@/application/ports/workout-session-repository';
import { StartWorkoutSessionUseCase } from '@/application/use-cases/start-workout-session';
import { InMemoryProgramEnrollmentRepository } from '@/infrastructure/enrollments/in-memory-program-enrollment-repository';
import { InMemoryWorkoutSessionRepository } from '@/infrastructure/sessions/in-memory-workout-session-repository';
import { createProgramEnrollment } from '@/domain/entities/program-enrollment';
import { createTrainingProgram, type TrainingProgram } from '@/domain/entities/training-program';
import { createWorkout, type Workout } from '@/domain/entities/workout';
import { Difficulty } from '@/domain/types/exercise';
import { createExerciseId, createScheduledWorkoutId, createWorkoutSessionId } from '@/domain/types/ids';
import { ProgramGoal } from '@/domain/types/program';
import { createRepScheme } from '@/domain/value-objects/rep-prescription';

import { FakeIdGenerator } from '../../helpers/fake-crypto';

function rep() { const r = createRepScheme(3, 8, 10); if (!r.ok) throw Error(); return r.data; }
function eid(v: string) { const r = createExerciseId(v); if (!r.ok) throw Error(); return r.data; }

const OWNER_A = 'user-a';
const OWNER_B = 'user-b';

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
  return { list: vi.fn(), findBySlug: vi.fn(), findSlugByScheduledWorkoutId: vi.fn() };
}

function enroll(repo: InMemoryProgramEnrollmentRepository, enrollmentId: string, userId: string, programId: string) {
  const r = createProgramEnrollment({ id: enrollmentId, userId, programId, enrolledAt: new Date('2026-01-01T00:00:00Z') });
  if (!r.ok) throw Error();
  return repo.create(r.data);
}

function makeUseCase(program: TrainingProgram | null = makeProgram()) {
  const programRepo = createMockRepo();
  vi.mocked(programRepo.findBySlug).mockResolvedValue(program);
  const sessionRepo = new InMemoryWorkoutSessionRepository();
  const enrollmentRepo = new InMemoryProgramEnrollmentRepository();
  const useCase = new StartWorkoutSessionUseCase(programRepo, sessionRepo, enrollmentRepo, new FakeIdGenerator());
  return { sessionRepo, enrollmentRepo, useCase };
}

const START_INPUT = { programSlug: 'test-program', weekNumber: 1, workoutOrder: 1 } as const;

describe('StartWorkoutSessionUseCase', () => {
  it('starts a valid session owned by the enrolled user', async () => {
    const { enrollmentRepo, useCase } = makeUseCase();
    await enroll(enrollmentRepo, 'enr-a', OWNER_A, 'prog-test');

    const result = await useCase.execute({ ...START_INPUT, userId: OWNER_A });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.status).toBe('in-progress');
    expect(result.data.sessionId).toBe('fake-id-1');
    expect(result.data.exerciseLogs).toHaveLength(2);
    expect(result.data.exerciseLogs[0]?.sets).toEqual([]);
  });

  it('returns PROGRAM_NOT_FOUND when program missing', async () => {
    const { useCase } = makeUseCase(null);
    const result = await useCase.execute({ ...START_INPUT, programSlug: 'missing', userId: OWNER_A });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('PROGRAM_NOT_FOUND');
  });

  it('returns SCHEDULED_WORKOUT_NOT_FOUND for invalid week', async () => {
    const { enrollmentRepo, useCase } = makeUseCase();
    await enroll(enrollmentRepo, 'enr-a', OWNER_A, 'prog-test');

    const result = await useCase.execute({ ...START_INPUT, weekNumber: 99, userId: OWNER_A });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('SCHEDULED_WORKOUT_NOT_FOUND');
  });

  it('returns NOT_ENROLLED when the user has not joined the program', async () => {
    const { sessionRepo, useCase } = makeUseCase();

    const result = await useCase.execute({ ...START_INPUT, userId: OWNER_A });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('NOT_ENROLLED');

    // No session may be persisted for a non-enrolled user.
    const generatedId = createWorkoutSessionId('fake-id-1');
    if (!generatedId.ok) throw Error();
    expect(await sessionRepo.findById(generatedId.data)).toBeNull();
  });

  it('returns SESSION_ALREADY_EXISTS when the enrollment already has a session for the occurrence', async () => {
    const { enrollmentRepo, useCase } = makeUseCase();
    await enroll(enrollmentRepo, 'enr-a', OWNER_A, 'prog-test');

    await useCase.execute({ ...START_INPUT, userId: OWNER_A });
    const second = await useCase.execute({ ...START_INPUT, userId: OWNER_A });

    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.error.code).toBe('SESSION_ALREADY_EXISTS');
  });

  it('lets two users start the same occurrence independently', async () => {
    const { enrollmentRepo, useCase } = makeUseCase();
    await enroll(enrollmentRepo, 'enr-a', OWNER_A, 'prog-test');
    await enroll(enrollmentRepo, 'enr-b', OWNER_B, 'prog-test');

    const first = await useCase.execute({ ...START_INPUT, userId: OWNER_A });
    const second = await useCase.execute({ ...START_INPUT, userId: OWNER_B });

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(first.data.sessionId).not.toBe(second.data.sessionId);
  });

  it('maps a save-level unique race to SESSION_ALREADY_EXISTS', async () => {
    const programRepo = createMockRepo();
    vi.mocked(programRepo.findBySlug).mockResolvedValue(makeProgram());
    const sessionRepo = new InMemoryWorkoutSessionRepository();
    vi.spyOn(sessionRepo, 'save').mockRejectedValue(new SessionAlreadyExistsError('sched-w1'));
    const enrollmentRepo = new InMemoryProgramEnrollmentRepository();
    await enroll(enrollmentRepo, 'enr-a', OWNER_A, 'prog-test');
    const useCase = new StartWorkoutSessionUseCase(programRepo, sessionRepo, enrollmentRepo, new FakeIdGenerator());

    const result = await useCase.execute({ ...START_INPUT, userId: OWNER_A });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('SESSION_ALREADY_EXISTS');
  });

  it('resolves a concurrent-leave race to NOT_ENROLLED instead of an untyped 500', async () => {
    const programRepo = createMockRepo();
    vi.mocked(programRepo.findBySlug).mockResolvedValue(makeProgram());
    const sessionRepo = new InMemoryWorkoutSessionRepository();
    // The repository's enrollment FK translation: the enrollment existed at
    // preflight but a concurrent leave deleted it before the insert.
    vi.spyOn(sessionRepo, 'save').mockRejectedValue(new SessionEnrollmentNotFoundError('enr-a'));
    const enrollmentRepo = new InMemoryProgramEnrollmentRepository();
    const useCase = new StartWorkoutSessionUseCase(programRepo, sessionRepo, enrollmentRepo, new FakeIdGenerator());

    const result = await useCase.execute({ ...START_INPUT, userId: OWNER_A });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('NOT_ENROLLED');
  });

  it('retries once against a replacement enrollment on a leave-and-rejoin race', async () => {
    const programRepo = createMockRepo();
    vi.mocked(programRepo.findBySlug).mockResolvedValue(makeProgram());
    const sessionRepo = new InMemoryWorkoutSessionRepository();
    // The first save races a concurrent leave: the enrollment existed at
    // preflight (enr-a) but was deleted before the insert.
    const saveSpy = vi
      .spyOn(sessionRepo, 'save')
      .mockRejectedValueOnce(new SessionEnrollmentNotFoundError('enr-a'));
    const enrollmentRepo = new InMemoryProgramEnrollmentRepository();
    // The user rejoined before the FK-failure recovery ran, creating a new
    // enrollment identity (enr-b) for the same user and program.
    await enroll(enrollmentRepo, 'enr-b', OWNER_A, 'prog-test');
    const useCase = new StartWorkoutSessionUseCase(programRepo, sessionRepo, enrollmentRepo, new FakeIdGenerator());

    const result = await useCase.execute({ ...START_INPUT, userId: OWNER_A });

    expect(result.ok).toBe(true);
    expect(saveSpy).toHaveBeenCalledTimes(2);
    expect(saveSpy.mock.calls[1]?.[0]).toMatchObject({
      userId: OWNER_A,
      enrollmentId: 'enr-b',
      scheduledWorkoutId: 'sched-w1',
    });
    if (!result.ok) return;
    const storedId = createWorkoutSessionId(result.data.sessionId);
    if (!storedId.ok) throw Error();
    const stored = await sessionRepo.findById(storedId.data);
    expect(stored?.enrollmentId).toBe('enr-b');
  });

  it('maps a duplicate under the replacement enrollment to SESSION_ALREADY_EXISTS', async () => {
    const programRepo = createMockRepo();
    vi.mocked(programRepo.findBySlug).mockResolvedValue(makeProgram());
    const sessionRepo = new InMemoryWorkoutSessionRepository();
    // The first save races the leave; the retry hits a session the user
    // already started under the replacement enrollment.
    vi.spyOn(sessionRepo, 'save')
      .mockRejectedValueOnce(new SessionEnrollmentNotFoundError('enr-a'))
      .mockRejectedValueOnce(new SessionAlreadyExistsError('sched-w1'));
    const enrollmentRepo = new InMemoryProgramEnrollmentRepository();
    await enroll(enrollmentRepo, 'enr-b', OWNER_A, 'prog-test');
    const useCase = new StartWorkoutSessionUseCase(programRepo, sessionRepo, enrollmentRepo, new FakeIdGenerator());

    const result = await useCase.execute({ ...START_INPUT, userId: OWNER_A });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('SESSION_ALREADY_EXISTS');
  });

  it('rethrows a save-level enrollment error when the enrollment is actually present', async () => {
    const programRepo = createMockRepo();
    vi.mocked(programRepo.findBySlug).mockResolvedValue(makeProgram());
    const sessionRepo = new InMemoryWorkoutSessionRepository();
    vi.spyOn(sessionRepo, 'save').mockRejectedValue(new SessionEnrollmentNotFoundError('enr-a'));
    const enrollmentRepo = new InMemoryProgramEnrollmentRepository();
    await enroll(enrollmentRepo, 'enr-a', OWNER_A, 'prog-test');
    const useCase = new StartWorkoutSessionUseCase(programRepo, sessionRepo, enrollmentRepo, new FakeIdGenerator());

    // The enrollment re-check contradicts the error, so it must propagate
    // rather than be silently converted to NOT_ENROLLED.
    await expect(useCase.execute({ ...START_INPUT, userId: OWNER_A })).rejects.toBeInstanceOf(
      SessionEnrollmentNotFoundError,
    );
  });

  it('propagates a retry failure instead of looping on a repeated enrollment error', async () => {
    const programRepo = createMockRepo();
    vi.mocked(programRepo.findBySlug).mockResolvedValue(makeProgram());
    const sessionRepo = new InMemoryWorkoutSessionRepository();
    // Every save fails with the same stale-enrollment error while the
    // re-checked enrollment (enr-b) differs from it: the recovery must retry
    // exactly once and surface the error, never loop.
    const saveSpy = vi
      .spyOn(sessionRepo, 'save')
      .mockRejectedValue(new SessionEnrollmentNotFoundError('enr-a'));
    const enrollmentRepo = new InMemoryProgramEnrollmentRepository();
    await enroll(enrollmentRepo, 'enr-b', OWNER_A, 'prog-test');
    const useCase = new StartWorkoutSessionUseCase(programRepo, sessionRepo, enrollmentRepo, new FakeIdGenerator());

    await expect(useCase.execute({ ...START_INPUT, userId: OWNER_A })).rejects.toBeInstanceOf(
      SessionEnrollmentNotFoundError,
    );
    expect(saveSpy).toHaveBeenCalledTimes(2);
  });
});
