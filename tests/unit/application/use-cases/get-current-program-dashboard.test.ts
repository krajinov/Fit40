import { describe, expect, it, vi } from 'vitest';
import type { ExerciseRepository } from '@/application/ports/exercise-repository';
import type { ProgramRepository } from '@/application/ports/program-repository';
import { GetCurrentProgramDashboardUseCase } from '@/application/use-cases/get-current-program-dashboard';
import { GetProgramBySlugUseCase } from '@/application/use-cases/get-program-by-slug';
import { GetProgramEnrollmentUseCase } from '@/application/use-cases/get-program-enrollment';
import { GetScheduledWorkoutUseCase } from '@/application/use-cases/get-scheduled-workout';
import { GetWorkoutSessionUseCase } from '@/application/use-cases/get-workout-session';
import { ListUserEnrollmentsUseCase } from '@/application/use-cases/list-user-enrollments';
import { ResolveNextWorkoutUseCase } from '@/application/use-cases/resolve-next-workout';
import { InMemoryProgramEnrollmentRepository } from '@/infrastructure/enrollments/in-memory-program-enrollment-repository';
import { InMemoryWorkoutSessionRepository } from '@/infrastructure/sessions/in-memory-workout-session-repository';
import { createExercise } from '@/domain/entities/exercise';
import { createProgramEnrollment } from '@/domain/entities/program-enrollment';
import { createTrainingProgram } from '@/domain/entities/training-program';
import { createWorkout } from '@/domain/entities/workout';
import { createWorkoutSession } from '@/domain/entities/workout-session';
import { Difficulty, EquipmentType, MovementPattern, MuscleGroup } from '@/domain/types/exercise';
import {
  createEnrollmentId,
  createExerciseId,
  createScheduledWorkoutId,
  createUserId,
  createWorkoutId,
} from '@/domain/types/ids';
import { ProgramGoal } from '@/domain/types/program';
import { createRepScheme } from '@/domain/value-objects/rep-prescription';

function rep() {
  const r = createRepScheme(3, 8, 10);
  if (!r.ok) throw Error(r.error.message);
  return r.data;
}

function eid(v: string) {
  const r = createExerciseId(v);
  if (!r.ok) throw Error(r.error.message);
  return r.data;
}

function swid(v: string) {
  const r = createScheduledWorkoutId(v);
  if (!r.ok) throw Error(r.error.message);
  return r.data;
}

function uid(v: string) {
  const r = createUserId(v);
  if (!r.ok) throw Error(r.error.message);
  return r.data;
}

function enid(v: string) {
  const r = createEnrollmentId(v);
  if (!r.ok) throw Error(r.error.message);
  return r.data;
}

function makeExercise(id: string) {
  const r = createExercise({
    id,
    name: `Exercise ${id}`,
    slug: `exercise-${id}`,
    description: 'A test exercise.',
    primaryMuscle: MuscleGroup.Chest,
    secondaryMuscles: [],
    equipment: EquipmentType.Dumbbell,
    difficulty: Difficulty.Beginner,
    movementPattern: MovementPattern.PushHorizontal,
    considerations: [],
  });
  if (!r.ok) throw Error(r.error.message);
  return r.data;
}

/** One-workout, one-week program with the given catalog id and slug. */
function makeProgram(programId: string, slug: string) {
  const wr = createWorkout({
    id: `wo-${programId}`,
    name: `Workout ${programId}`,
    slug: `workout-${programId}`,
    description: 'A test workout.',
    estimatedDurationMinutes: 30,
    exercises: [{ exerciseId: eid('ex-001'), order: 1, prescription: rep(), restSeconds: 60 }],
  });
  if (!wr.ok) throw Error(wr.error.message);
  const pr = createTrainingProgram({
    id: programId,
    name: `Program ${programId}`,
    slug,
    description: 'A test program.',
    difficulty: Difficulty.Beginner,
    goal: ProgramGoal.Strength,
    durationWeeks: 1,
    workoutsPerWeek: 1,
    workouts: [wr.data],
    weeks: [
      {
        weekNumber: 1,
        scheduledWorkouts: [{ id: swid(`sched-${programId}`), workoutId: wr.data.id, order: 1 }],
      },
    ],
  });
  if (!pr.ok) throw Error(pr.error.message);
  return pr.data;
}

function seedEnrollment(
  repo: InMemoryProgramEnrollmentRepository,
  enrollmentId: string,
  userId: string,
  programId: string,
  enrolledAt: string,
) {
  const r = createProgramEnrollment({ id: enrollmentId, userId, programId, enrolledAt: new Date(enrolledAt) });
  if (!r.ok) throw Error();
  return repo.create(r.data);
}

function seedSession(
  repo: InMemoryWorkoutSessionRepository,
  sessionId: string,
  userId: string,
  enrollmentId: string,
) {
  const workoutId = createWorkoutId('wo-p1');
  if (!workoutId.ok) throw Error(workoutId.error.message);
  const r = createWorkoutSession({
    id: sessionId,
    userId: uid(userId),
    enrollmentId: enid(enrollmentId),
    scheduledWorkoutId: swid('sched-p1'),
    workoutId: workoutId.data,
    startedAt: new Date(),
    exerciseLogs: [{ exerciseId: eid('ex-001'), order: 1, prescription: rep(), restSeconds: 60 }],
  });
  if (!r.ok) throw Error(r.error.message);
  return repo.save(r.data);
}

/**
 * Wires the real use-case graph over mocked program/exercise repositories
 * and the in-memory enrollment/session repositories (the established
 * convention from the ListUserEnrollmentsUseCase unit tests).
 */
function makeUseCase(
  programs: ReadonlyArray<ReturnType<typeof makeProgram>>,
  metadata: ReadonlyArray<{ id: string; slug: string; name: string }>,
  exercises: ReadonlyArray<ReturnType<typeof makeExercise>> = [makeExercise('ex-001')],
) {
  const programRepo: ProgramRepository = {
    list: vi.fn(),
    findBySlug: vi
      .fn()
      .mockImplementation(
        async (slug: string) => programs.find((program) => program.slug === slug) ?? null,
      ),
    findSessionRouteByScheduledWorkoutId: vi.fn(),
    listMetadataByIds: vi.fn().mockResolvedValue(metadata),
  };
  const exerciseRepo: ExerciseRepository = {
    list: vi.fn().mockResolvedValue(exercises),
    findBySlug: vi.fn(),
    findByIds: vi.fn(),
  };
  const enrollmentRepo = new InMemoryProgramEnrollmentRepository();
  const sessionRepo = new InMemoryWorkoutSessionRepository();

  const uc = new GetCurrentProgramDashboardUseCase(
    new ListUserEnrollmentsUseCase(enrollmentRepo, programRepo),
    new GetProgramBySlugUseCase(programRepo),
    new GetProgramEnrollmentUseCase(enrollmentRepo, sessionRepo),
    new ResolveNextWorkoutUseCase(
      new GetScheduledWorkoutUseCase(programRepo, exerciseRepo),
      new GetWorkoutSessionUseCase(programRepo, sessionRepo, enrollmentRepo),
    ),
  );
  return { enrollmentRepo, sessionRepo, uc };
}

const P1 = () => makeProgram('p1', 'prog-1');
const P2 = () => makeProgram('p2', 'prog-2');

const METADATA = [
  { id: 'p1', slug: 'prog-1', name: 'Program p1' },
  { id: 'p2', slug: 'prog-2', name: 'Program p2' },
];

describe('GetCurrentProgramDashboardUseCase', () => {
  it('returns ok(null) when the user has no enrollments', async () => {
    const { uc } = makeUseCase([P1()], METADATA);

    const result = await uc.execute('user-a');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toBeNull();
  });

  it('hydrates the single enrollment with program detail, progress and next-workout state', async () => {
    const { enrollmentRepo, uc } = makeUseCase([P1()], METADATA);
    await seedEnrollment(enrollmentRepo, 'enr-1', 'user-a', 'p1', '2026-01-01T10:00:00Z');

    const result = await uc.execute('user-a');

    expect(result.ok).toBe(true);
    if (!result.ok || result.data === null) return;
    expect(result.data.program.slug).toBe('prog-1');
    expect(result.data.enrollment.status).toBe('enrolled');
    expect(result.data.enrollment.enrolledAt).toBe('2026-01-01T10:00:00.000Z');
    expect(result.data.enrollment.progress).toEqual({
      totalWorkouts: 1,
      completedWorkouts: 0,
      percentage: 0,
    });
    expect(result.data.enrollment.completedScheduledWorkoutIds).toEqual([]);
    expect(result.data.nextWorkout).toEqual({
      programSlug: 'prog-1',
      weekNumber: 1,
      workoutOrder: 1,
      workoutName: 'Workout p1',
      exerciseCount: 1,
      estimatedMinutes: 30,
      preview: [{ exerciseName: 'Exercise ex-001', prescription: rep() }],
      sessionState: 'not-started',
    });
  });

  it('selects the most recently joined enrollment when the user has several', async () => {
    const { enrollmentRepo, uc } = makeUseCase([P1(), P2()], METADATA);
    await seedEnrollment(enrollmentRepo, 'enr-1', 'user-a', 'p1', '2026-01-01T10:00:00Z');
    await seedEnrollment(enrollmentRepo, 'enr-2', 'user-a', 'p2', '2026-02-01T10:00:00Z');

    const result = await uc.execute('user-a');

    expect(result.ok).toBe(true);
    if (!result.ok || result.data === null) return;
    expect(result.data.program.slug).toBe('prog-2');
    expect(result.data.enrollment.enrolledAt).toBe('2026-02-01T10:00:00.000Z');
  });

  it('reports an unresolvable current program instead of null when the enrolled program is missing', async () => {
    // Only prog-2 exists in the catalog: the stale prog-1 enrollment must
    // surface as a typed failure, not silently render as "no program".
    const { enrollmentRepo, uc } = makeUseCase([P2()], METADATA);
    await seedEnrollment(enrollmentRepo, 'enr-1', 'user-a', 'p1', '2026-01-01T10:00:00Z');

    const result = await uc.execute('user-a');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('CURRENT_PROGRAM_UNRESOLVABLE');
  });

  it('degrades the next workout to null when the scheduled workout cannot be resolved', async () => {
    // Exercise catalog cannot resolve ex-001: the enrollment view stays
    // intact but no "Up next" card data is fabricated.
    const { enrollmentRepo, uc } = makeUseCase([P1()], METADATA, []);
    await seedEnrollment(enrollmentRepo, 'enr-1', 'user-a', 'p1', '2026-01-01T10:00:00Z');

    const result = await uc.execute('user-a');

    expect(result.ok).toBe(true);
    if (!result.ok || result.data === null) return;
    expect(result.data.enrollment.status).toBe('enrolled');
    expect(result.data.nextWorkout).toBeNull();
  });

  it('reports an in-progress session state when the workout was already started', async () => {
    const { enrollmentRepo, sessionRepo, uc } = makeUseCase([P1()], METADATA);
    await seedEnrollment(enrollmentRepo, 'enr-1', 'user-a', 'p1', '2026-01-01T10:00:00Z');
    await seedSession(sessionRepo, 's-1', 'user-a', 'enr-1');

    const result = await uc.execute('user-a');

    expect(result.ok).toBe(true);
    if (!result.ok || result.data === null) return;
    expect(result.data.nextWorkout?.sessionState).toBe('in-progress');
  });
});
