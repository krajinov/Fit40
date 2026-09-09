/**
 * Unit tests for the Active Workout view assembly's M9 substitution wiring.
 *
 * buildActiveWorkoutView runs against mocked feature composition roots
 * (same pattern as dashboard-view.test.ts). The M9 contract under test:
 * exactly ONE exercise catalog read per request, shared by performed
 * metadata, authored metadata, and every distinct performed source's
 * candidate set — with the performed exercise driving the progression
 * target request.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ScheduledWorkoutDetailDto } from '@/application/dto/program';
import type { WorkoutSessionDto } from '@/application/dto/workout-session';

const { lookupExecute, sessionExecute, targetsExecute, exerciseDataList } = vi.hoisted(() => ({
  lookupExecute: vi.fn(),
  sessionExecute: vi.fn(),
  targetsExecute: vi.fn(),
  exerciseDataList: vi.fn(),
}));

vi.mock('@/features/programs/scheduled-workout-lookup', () => ({
  lookupScheduledWorkout: lookupExecute,
}));

vi.mock('@/features/sessions/services', () => ({
  getWorkoutSessionUseCase: { execute: sessionExecute },
  getNextExerciseTargetsUseCase: { execute: targetsExecute },
  getActiveWorkoutExerciseDataUseCase: {
    execute: vi.fn(async (input: {
      readonly displayExerciseIds: ReadonlyArray<string>;
      readonly performedExerciseIds: ReadonlyArray<string>;
    }) => {
      // THE one catalog read per request — counting calls proves the
      // contract; the repository itself is mocked inside its module.
      exerciseDataList();
      return {
        summariesByExerciseId: new Map(),
        candidatesByPerformedExerciseId: new Map(),
        input,
      };
    }),
  },
}));

import { buildActiveWorkoutView } from '@/features/sessions/active-workout-view';

const USER = { id: 'user-1', email: 'user@example.com', createdAt: '2026-01-01T00:00:00.000Z' };

function rep(): { type: 'reps'; sets: 3; minReps: 8; maxReps: 10 } {
  return { type: 'reps', sets: 3, minReps: 8, maxReps: 10 };
}

function sessionLog(overrides: Partial<WorkoutSessionDto['exerciseLogs'][number]> = {}) {
  return {
    authoredExerciseId: 'ex-bench',
    performedExerciseId: 'ex-bench',
    isSubstituted: false,
    order: 1,
    prescription: rep(),
    sets: [],
    ...overrides,
  };
}

const WORKOUT: ScheduledWorkoutDetailDto = {
  programSlug: 'prog-1',
  programName: 'Program 1',
  weekNumber: 1,
  order: 1,
  workout: {
    id: 'w1',
    name: 'Push A',
    slug: 'push-a',
    description: 'A workout.',
    estimatedDurationMinutes: 45,
    exercises: [],
  },
};

function sessionDto(logs: WorkoutSessionDto['exerciseLogs']): WorkoutSessionDto {
  return {
    sessionId: 's-1',
    scheduledWorkoutId: 'sw-1',
    workoutId: 'w1',
    status: 'in-progress',
    startedAt: '2026-09-01T17:00:00.000Z',
    completedAt: null,
    exerciseLogs: logs,
    metrics: { totalSets: 0, totalReps: 0, totalDurationSeconds: 0, volume: 0 },
  };
}

function mockIngestedSession(logs: WorkoutSessionDto['exerciseLogs']): void {
  lookupExecute.mockResolvedValue({ ok: true, data: WORKOUT });
  sessionExecute.mockResolvedValue({ ok: true, data: { enrolled: true, session: sessionDto(logs) } });
  targetsExecute.mockResolvedValue({ ok: true, data: [] });
}

const INPUT = { programSlug: 'prog-1', weekNumber: 1, workoutOrder: 1 };

describe('active-workout-view / one catalog read (M9)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('builds the in-progress view with exactly one exercise-catalog read', async () => {
    mockIngestedSession([
      sessionLog(),
      sessionLog({ order: 2, authoredExerciseId: 'ex-row', performedExerciseId: 'ex-row' }),
      sessionLog({
        order: 3,
        authoredExerciseId: 'ex-squat',
        performedExerciseId: 'ex-goblet',
        isSubstituted: true,
      }),
    ]);

    const view = await buildActiveWorkoutView(INPUT, USER);
    if (view === null) throw new Error('view must resolve');

    expect(view.screenState).toBe('in-progress');
    expect(view.cards).toHaveLength(3);
    expect(exerciseDataList).toHaveBeenCalledTimes(1);
  });

  it('performs only one catalog read even with many distinct source exercises', async () => {
    mockIngestedSession(
      Array.from({ length: 6 }, (_, i) =>
        sessionLog({ order: i + 1, authoredExerciseId: `ex-${i + 1}`, performedExerciseId: `ex-${i + 1}` }),
      ),
    );

    await buildActiveWorkoutView(INPUT, USER);

    // Six distinct performed exercises, ONE shared catalog read — no N+1.
    expect(exerciseDataList).toHaveBeenCalledTimes(1);
  });

  it('requests the progression targets under the PERFORMED ids of substituted occurrences', async () => {
    mockIngestedSession([
      sessionLog({ performedExerciseId: 'ex-goblet', isSubstituted: true }),
    ]);

    await buildActiveWorkoutView(INPUT, USER);

    expect(targetsExecute).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: USER.id,
        requests: [
          expect.objectContaining({
            exerciseId: 'ex-goblet',
          }),
        ],
      }),
    );

    // The authored id never drives the replacement's progression lookup —
    // its recommendation must not carry onto the substitute.
    const requests = targetsExecute.mock.calls[0]?.[0].requests as { exerciseId: string }[];
    expect(requests.some((request) => request.exerciseId === 'ex-bench')).toBe(false);
  });

  it('returns the not-started view without touching the exercise catalog', async () => {
    lookupExecute.mockResolvedValue({ ok: true, data: WORKOUT });
    sessionExecute.mockResolvedValue({ ok: true, data: { enrolled: true, session: null } });

    const view = await buildActiveWorkoutView(INPUT, USER);
    if (view === null) throw new Error('view must resolve');

    expect(view.screenState).toBe('not-started');
    expect(view.cards).toEqual([]);
    expect(exerciseDataList).not.toHaveBeenCalled();
  });

  it('returns null when the occurrence itself does not resolve', async () => {
    lookupExecute.mockResolvedValue({ ok: false, error: { code: 'PROGRAM_NOT_FOUND', message: 'nope' } });

    const view = await buildActiveWorkoutView(INPUT, USER);
    expect(view).toBeNull();
  });
});
