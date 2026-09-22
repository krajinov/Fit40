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
        // The addable catalog (M11) comes from the SAME read.
        addableExercises: [
          {
            id: 'ex-catalog',
            name: 'Catalog Squat',
            slug: 'catalog-squat',
            primaryMuscle: 'quadriceps',
            equipment: 'barbell',
            difficulty: 'beginner',
            movementPattern: 'squat',
          },
        ],
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

function sessionLog(
  overrides: Partial<WorkoutSessionDto['exerciseLogs'][number]> = {},
): WorkoutSessionDto['exerciseLogs'][number] {
  return {
    authoredExerciseId: 'ex-bench',
    performedExerciseId: 'ex-bench',
    isSubstituted: false,
    isSkipped: false,
    // Defaults to the order (the fixture's implicit occurrenceKey).
    occurrenceKey: 1,
    source: 'template',
    substitutionEligibility: { blockedBy: null, canRestore: false },
    adjustmentEligibility: {
      isSkipped: false,
      blockedBy: null,
      canSkip: true,
      canUnskip: false,
      canMoveUp: true,
      canMoveDown: true,
    },
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
    version: 0,
    exerciseLogs: logs,
    metrics: { totalSets: 0, totalReps: 0, totalDurationSeconds: 0, volume: 0 },
    // Skip-adjusted session totals are now consumed by the view layer
    // (M10 Slice 4) — neutral fixture values keep this mock minimal; the
    // dedicated progress tests cover the totals themselves.
    prescribedSets: 0,
    skippedExerciseCount: 0,
  };
}

/** A domain-shaped skipped log with its eligibility projection. */
function skippedSessionLog(order: number, exerciseId: string) {
  return sessionLog({
    order,
    authoredExerciseId: exerciseId,
    performedExerciseId: exerciseId,
    isSkipped: true,
    substitutionEligibility: { blockedBy: 'skipped', canRestore: false },
    adjustmentEligibility: {
      isSkipped: true,
      blockedBy: null,
      canSkip: false,
      canUnskip: true,
      canMoveUp: true,
      canMoveDown: true,
    },
  });
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

  it('exposes the addable catalog (M11) from the same single catalog read', async () => {
    mockIngestedSession([sessionLog()]);

    const view = await buildActiveWorkoutView(INPUT, USER);
    if (view === null) throw new Error('view must resolve');

    expect(view.addableExercises.map((exercise) => exercise.id)).toEqual(['ex-catalog']);
    // Display metadata, candidates and the addable list share ONE read.
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
    expect(view.addableExercises).toEqual([]);
    expect(exerciseDataList).not.toHaveBeenCalled();
  });

  it('returns null when the occurrence itself does not resolve', async () => {
    lookupExecute.mockResolvedValue({ ok: false, error: { code: 'PROGRAM_NOT_FOUND', message: 'nope' } });

    const view = await buildActiveWorkoutView(INPUT, USER);
    expect(view).toBeNull();
  });
});

describe('active-workout-view / skip-adjusted target resolution (M10)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /**
   * One distinct, recognizable target per requested position. The mock
   * returns one target per request so the tests can assert WHICH exercise
   * each resolved target actually belongs to — the positional associations,
   * not just the array shape.
   */
  function targetFor(exerciseId: string) {
    return {
      exerciseId,
      target: {
        basis: 'first-exposure' as const,
        reason: 'no-history' as const,
      },
      previousSets: null,
    };
  }

  it('null-aligns targets around a middle skipped occurrence with actual associations intact', async () => {
    // Three occurrences, the MIDDLE one skipped: the batch must request only
    // bench + row (position-aligned), and the resolved view must associate
    // bench's target with order 1, row's with order 3 — never crossed.
    // bench's target is an INCREASE callout ("62.5 kg"); row's is a
    // FIRST-EXPOSURE quiet line — the two are structurally distinguishable,
    // so a misalignment would show the wrong copy on the wrong card.
    mockIngestedSession([
      sessionLog({ order: 1, authoredExerciseId: 'ex-bench', performedExerciseId: 'ex-bench' }),
      skippedSessionLog(2, 'ex-plank'),
      sessionLog({ order: 3, authoredExerciseId: 'ex-row', performedExerciseId: 'ex-row' }),
    ]);
    targetsExecute.mockResolvedValue({
      ok: true,
      data: [
        {
          exerciseId: 'ex-bench',
          target: {
            basis: 'increase' as const,
            reason: 'all-sets-at-top-of-range' as const,
            previousLoadKg: 60,
            nextLoadKg: 62.5,
            incrementKg: 2.5,
          },
          previousSets: [
            { type: 'reps' as const, reps: 10, weightKg: 60 },
            { type: 'reps' as const, reps: 10, weightKg: 60 },
            { type: 'reps' as const, reps: 10, weightKg: 60 },
          ],
        },
        targetFor('ex-row'),
      ],
    });

    const view = await buildActiveWorkoutView(INPUT, USER);
    if (view === null) throw new Error('view must resolve');

    // The batch carried ONLY the two non-skipped requests, in log order.
    const requests = targetsExecute.mock.calls[0]?.[0].requests as { exerciseId: string }[];
    expect(requests.map((request) => request.exerciseId)).toEqual(['ex-bench', 'ex-row']);

    // bench's card (order 1) carries BENCH's increase callout, prefilled
    // from the recommendation — not row's target, not nothing.
    expect(view.cards[0]?.kind).toBe('active');
    expect(view.cards[0]?.logger?.callout?.kind).toBe('increase');
    expect(view.cards[0]?.logger?.callout?.valueLabel).toBe('62.5 kg');
    expect(view.cards[0]?.logger?.prefillWeightKg).toBe(62.5);
    // The skipped card (order 2) carries NO logger at all.
    expect(view.cards[1]?.kind).toBe('skipped');
    expect(view.cards[1]?.logger).toBeNull();
    // row's card (order 3) carries ROW's first-exposure quiet line — not
    // bench's increase callout that would appear on a one-off drift.
    expect(view.cards[2]?.kind).toBe('upcoming');
    expect(view.cards[2]?.logger?.callout).toBeNull();
    expect(view.cards[2]?.logger?.quietLabel).toBe('First time · no history yet');
  });

  it('null-aligns targets when the FIRST occurrence is skipped', async () => {
    mockIngestedSession([
      skippedSessionLog(1, 'ex-plank'),
      sessionLog({ order: 2, authoredExerciseId: 'ex-bench', performedExerciseId: 'ex-bench' }),
      sessionLog({ order: 3, authoredExerciseId: 'ex-row', performedExerciseId: 'ex-row' }),
    ]);
    targetsExecute.mockResolvedValue({
      ok: true,
      data: [targetFor('ex-bench'), targetFor('ex-row')],
    });

    const view = await buildActiveWorkoutView(INPUT, USER);
    if (view === null) throw new Error('view must resolve');

    const requests = targetsExecute.mock.calls[0]?.[0].requests as { exerciseId: string }[];
    expect(requests.map((request) => request.exerciseId)).toEqual(['ex-bench', 'ex-row']);

    expect(view.cards[0]?.kind).toBe('skipped');
    expect(view.cards[0]?.logger).toBeNull();
    // The next non-skipped occurrence becomes the active logger target.
    expect(view.cards[1]?.kind).toBe('active');
    expect(view.cards[2]?.kind).toBe('upcoming');
  });

  it('null-aligns targets when the LAST occurrence is skipped', async () => {
    mockIngestedSession([
      sessionLog({ order: 1, authoredExerciseId: 'ex-bench', performedExerciseId: 'ex-bench' }),
      skippedSessionLog(2, 'ex-plank'),
    ]);
    targetsExecute.mockResolvedValue({
      ok: true,
      data: [targetFor('ex-bench')],
    });

    const view = await buildActiveWorkoutView(INPUT, USER);
    if (view === null) throw new Error('view must resolve');

    const requests = targetsExecute.mock.calls[0]?.[0].requests as { exerciseId: string }[];
    expect(requests.map((request) => request.exerciseId)).toEqual(['ex-bench']);

    expect(view.cards[0]?.kind).toBe('active');
    expect(view.cards[1]?.kind).toBe('skipped');
    expect(view.cards[1]?.logger).toBeNull();
  });

  it('returns the all-null targets array without a batch when every occurrence is skipped', async () => {
    mockIngestedSession([
      skippedSessionLog(1, 'ex-plank'),
      skippedSessionLog(2, 'ex-squat'),
    ]);

    const view = await buildActiveWorkoutView(INPUT, USER);
    if (view === null) throw new Error('view must resolve');

    // No dead-weight personalization request for an all-skipped session.
    expect(targetsExecute).not.toHaveBeenCalled();
    expect(view.cards.every((card) => card.logger === null && card.kind === 'skipped')).toBe(true);
  });

  it('keeps non-skipped duplicate ids aligned in order', async () => {
    // Two non-skipped logs of the SAME exercise sandwiching a skipped one:
    // the batch still carries two requests (per-position), and the view maps
    // them back without positional drift.
    mockIngestedSession([
      sessionLog({ order: 1, authoredExerciseId: 'ex-bench', performedExerciseId: 'ex-bench' }),
      skippedSessionLog(2, 'ex-plank'),
      sessionLog({ order: 3, authoredExerciseId: 'ex-bench', performedExerciseId: 'ex-bench' }),
    ]);
    targetsExecute.mockResolvedValue({
      ok: true,
      data: [targetFor('ex-bench'), targetFor('ex-bench')],
    });

    const view = await buildActiveWorkoutView(INPUT, USER);
    if (view === null) throw new Error('view must resolve');

    const requests = targetsExecute.mock.calls[0]?.[0].requests as { exerciseId: string }[];
    expect(requests).toHaveLength(2);
    expect(view.cards.map((card) => card.kind)).toEqual(['active', 'skipped', 'upcoming']);
  });
});
