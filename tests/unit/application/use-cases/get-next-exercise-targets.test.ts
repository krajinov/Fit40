import { describe, expect, it, vi } from 'vitest';

import type { ExerciseRepository } from '@/application/ports/exercise-repository';
import type {
  ProgressionHistoryPerformance,
  TrainingHistoryRepository,
} from '@/application/ports/training-history-repository';
import {
  GetNextExerciseTargetsUseCase,
  type NextExerciseTargetRequest,
} from '@/application/use-cases/get-next-exercise-targets';
import { createExercise } from '@/domain/entities/exercise';
import { Difficulty, EquipmentType, MovementPattern, MuscleGroup } from '@/domain/types/exercise';
import { createExerciseId, createWorkoutSessionId } from '@/domain/types/ids';
import { createDurationScheme, createRepScheme } from '@/domain/value-objects/rep-prescription';
import type { RepPrescription, RepScheme } from '@/domain/value-objects/rep-prescription';

function rep(sets = 3, minReps = 8, maxReps = 10): RepScheme {
  const result = createRepScheme(sets, minReps, maxReps);
  if (!result.ok) throw new Error(result.error.message);
  if (result.data.type !== 'reps') throw new Error('expected a rep scheme');
  return result.data;
}

function duration(sets = 3, seconds = 45) {
  const result = createDurationScheme(sets, seconds);
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

function eid(value: string) {
  const result = createExerciseId(value);
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

function sessionId(value: string) {
  const result = createWorkoutSessionId(value);
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

function makeExercise(id: string, equipment: EquipmentType = EquipmentType.Dumbbell) {
  const result = createExercise({
    id,
    name: `Exercise ${id}`,
    slug: `exercise-${id}`,
    description: `The ${id} exercise.`,
    primaryMuscle: MuscleGroup.Chest,
    secondaryMuscles: [],
    equipment,
    difficulty: Difficulty.Beginner,
    movementPattern: MovementPattern.PushHorizontal,
    considerations: [],
  });
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

/**
 * Builds one `ProgressionHistoryPerformance` occurrence stub. `index` drives
 * distinct session identities and a strictly newer completion instant for
 * higher indexes, so multi-occurrence stubs are truthfully newest first when
 * handed to the use case in array order.
 */
function occurrence(
  exerciseId: string,
  index: number,
  prescription: ReturnType<typeof rep> | ReturnType<typeof duration>,
  sets: ProgressionHistoryPerformance['sets'],
): ProgressionHistoryPerformance {
  return {
    exerciseId: eid(exerciseId),
    sessionId: sessionId(`sess-${exerciseId}-${index}`),
    exerciseOrder: 1,
    completedAt: new Date(Date.parse('2026-08-01T10:00:00Z') + index * 3_600_000),
    prescription,
    sets,
  };
}

function repSet(setNumber: number, reps: number, weightKg: number | null) {
  return { type: 'reps' as const, setNumber, reps, weightKg, rpe: null };
}

function request(exerciseId: string, prescription: RepPrescription = rep()): NextExerciseTargetRequest {
  return { exerciseId: eid(exerciseId), prescription };
}

function createMockExerciseRepository(): ExerciseRepository {
  return {
    list: vi.fn(),
    findBySlug: vi.fn(),
    findByIds: vi.fn(),
  };
}

function createMockHistoryRepository(): TrainingHistoryRepository {
  return {
    listCompletedSessions: vi.fn(),
    listCompletedExerciseOccurrences: vi.fn(),
    listRecentCompletedExercisePerformances: vi.fn(),
    getTotals: vi.fn(),
    findCompletedSessionById: vi.fn(),
  };
}

/** The prescribed sets at maxReps: an increase-ready occurrence. */
function atMaxReps(scheme: RepScheme, weightKg: number) {
  return Array.from({ length: scheme.sets }, (_, i) => repSet(i + 1, scheme.maxReps, weightKg));
}

/** The prescribed sets, each one rep below minReps: a below-minimum occurrence. */
function belowMin(scheme: RepScheme, weightKg: number) {
  return Array.from({ length: scheme.sets }, (_, i) => repSet(i + 1, scheme.minReps - 1, weightKg));
}

/** The prescribed sets with the final one unlogged: an incomplete occurrence. */
function incomplete(scheme: RepScheme, weightKg: number) {
  return Array.from({ length: scheme.sets - 1 }, (_, i) => repSet(i + 1, scheme.minReps, weightKg));
}

/** The prescribed sets, all unweighted: a bodyweight occurrence. */
function unloaded(scheme: RepScheme) {
  return Array.from({ length: scheme.sets }, (_, i) => repSet(i + 1, scheme.maxReps, null));
}

describe('GetNextExerciseTargetsUseCase', () => {
  it('returns one first-exposure target per request when no history exists', async () => {
    const exerciseRepo = createMockExerciseRepository();
    const historyRepo = createMockHistoryRepository();
    vi.mocked(exerciseRepo.findByIds).mockResolvedValue([makeExercise('ex-1')]);
    vi.mocked(historyRepo.listRecentCompletedExercisePerformances).mockResolvedValue([]);

    const useCase = new GetNextExerciseTargetsUseCase(exerciseRepo, historyRepo);
    const result = await useCase.execute({ userId: 'user-1', requests: [request('ex-1')] });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toHaveLength(1);
    expect(result.data[0]?.target).toEqual({ basis: 'first-exposure', reason: 'no-history' });
  });

  it('fails the whole batch with EXERCISE_NOT_FOUND when the catalog lacks a requested exercise', async () => {
    const exerciseRepo = createMockExerciseRepository();
    const historyRepo = createMockHistoryRepository();
    vi.mocked(exerciseRepo.findByIds).mockResolvedValue([makeExercise('ex-1')]);
    vi.mocked(historyRepo.listRecentCompletedExercisePerformances).mockResolvedValue([]);

    const useCase = new GetNextExerciseTargetsUseCase(exerciseRepo, historyRepo);
    const result = await useCase.execute({
      userId: 'user-1',
      requests: [request('ex-1'), request('ex-missing')],
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('EXERCISE_NOT_FOUND');
    if (result.error.code !== 'EXERCISE_NOT_FOUND') return;
    expect(result.error.exerciseId).toBe(eid('ex-missing'));
  });

  it('rejects an empty userId with INVALID_INPUT before touching either repository', async () => {
    const exerciseRepo = createMockExerciseRepository();
    const historyRepo = createMockHistoryRepository();

    const useCase = new GetNextExerciseTargetsUseCase(exerciseRepo, historyRepo);
    const result = await useCase.execute({ userId: '  ', requests: [request('ex-1')] });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('INVALID_INPUT');
    if (result.error.code !== 'INVALID_INPUT') return;
    expect(result.error.field).toBe('userId');
    expect(exerciseRepo.findByIds).not.toHaveBeenCalled();
    expect(historyRepo.listRecentCompletedExercisePerformances).not.toHaveBeenCalled();
  });

  it('returns an empty result for an empty request list without touching either repository', async () => {
    const exerciseRepo = createMockExerciseRepository();
    const historyRepo = createMockHistoryRepository();

    const useCase = new GetNextExerciseTargetsUseCase(exerciseRepo, historyRepo);
    const result = await useCase.execute({ userId: 'user-1', requests: [] });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toEqual([]);
    expect(exerciseRepo.findByIds).not.toHaveBeenCalled();
    expect(historyRepo.listRecentCompletedExercisePerformances).not.toHaveBeenCalled();
  });


  it('reads history through one batched, bounded call: raw-5 window, distinct exercise ids, in request order', async () => {
    const exerciseRepo = createMockExerciseRepository();
    const historyRepo = createMockHistoryRepository();
    vi.mocked(exerciseRepo.findByIds).mockResolvedValue([makeExercise('ex-1'), makeExercise('ex-2')]);
    vi.mocked(historyRepo.listRecentCompletedExercisePerformances).mockResolvedValue([
      occurrence('ex-2', 1, rep(), atMaxReps(rep(), 30)),
      occurrence('ex-2', 0, rep(), atMaxReps(rep(), 30)),
      occurrence('ex-1', 1, rep(), atMaxReps(rep(), 50)),
      occurrence('ex-1', 0, rep(), atMaxReps(rep(), 50)),
    ]);

    const useCase = new GetNextExerciseTargetsUseCase(exerciseRepo, historyRepo);
    const result = await useCase.execute({
      userId: 'user-1',
      requests: [request('ex-1'), request('ex-2'), request('ex-1')],
    });

    expect(historyRepo.listRecentCompletedExercisePerformances).toHaveBeenCalledTimes(1);
    expect(historyRepo.listRecentCompletedExercisePerformances).toHaveBeenCalledWith(
      'user-1',
      [eid('ex-1'), eid('ex-2')],
      5,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.map((t) => t.exerciseId)).toEqual(['ex-1', 'ex-2', 'ex-1']);
    // Both requests for ex-1 receive the same decision from the same window.
    expect(result.data[0]?.target).toEqual(result.data[2]?.target);
    expect(result.data[0]?.target.basis).toBe('increase');
    expect(result.data[1]?.target.basis).toBe('increase');
  });

  it('keeps windows per-exercise independent: a poor window for one exercise never holds another', async () => {
    const exerciseRepo = createMockExerciseRepository();
    const historyRepo = createMockHistoryRepository();
    vi.mocked(exerciseRepo.findByIds).mockResolvedValue([makeExercise('ex-1'), makeExercise('ex-2')]);
    vi.mocked(historyRepo.listRecentCompletedExercisePerformances).mockResolvedValue([
      occurrence('ex-1', 0, rep(), belowMin(rep(), 50)),
      occurrence('ex-2', 0, rep(), atMaxReps(rep(), 30)),
    ]);

    const useCase = new GetNextExerciseTargetsUseCase(exerciseRepo, historyRepo);
    const result = await useCase.execute({
      userId: 'user-1',
      requests: [request('ex-1'), request('ex-2')],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data[0]?.target.basis).toBe('hold');
    expect(result.data[1]?.target.basis).toBe('increase');
  });

  it('drops the duplicate request id from the history read but keeps one result per request', async () => {
    const exerciseRepo = createMockExerciseRepository();
    const historyRepo = createMockHistoryRepository();
    vi.mocked(exerciseRepo.findByIds).mockResolvedValue([makeExercise('ex-1')]);
    vi.mocked(historyRepo.listRecentCompletedExercisePerformances).mockResolvedValue([
      occurrence('ex-1', 0, rep(), atMaxReps(rep(), 50)),
    ]);

    const useCase = new GetNextExerciseTargetsUseCase(exerciseRepo, historyRepo);
    const result = await useCase.execute({
      userId: 'user-1',
      requests: [request('ex-1'), request('ex-1')],
    });

    expect(historyRepo.listRecentCompletedExercisePerformances).toHaveBeenCalledWith('user-1', [eid('ex-1')], 5);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toHaveLength(2);
  });

  it('forwards two occurrences of one exercise inside one session as distinct window entries', async () => {
    const exerciseRepo = createMockExerciseRepository();
    const historyRepo = createMockHistoryRepository();
    vi.mocked(exerciseRepo.findByIds).mockResolvedValue([makeExercise('ex-1')]);
    // Same session, repeated exercise: the later position (order 2) is the
    // newer occurrence by the recency ladder and leads the window.
    const first = occurrence('ex-1', 0, rep(), belowMin(rep(), 50));
    const repeat = { ...first, exerciseOrder: 2, sets: atMaxReps(rep(), 52) };
    vi.mocked(historyRepo.listRecentCompletedExercisePerformances).mockResolvedValue([repeat, first]);

    const useCase = new GetNextExerciseTargetsUseCase(exerciseRepo, historyRepo);
    const result = await useCase.execute({ userId: 'user-1', requests: [request('ex-1')] });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data[0]?.target).toEqual({
      basis: 'increase',
      reason: 'all-sets-at-top-of-range',
      previousLoadKg: 52,
      nextLoadKg: 54,
      incrementKg: 2,
    });
  });

  it('forwards detached-history and in-progress-excluded windows unchanged: the port owns those semantics', async () => {
    const exerciseRepo = createMockExerciseRepository();
    const historyRepo = createMockHistoryRepository();
    vi.mocked(exerciseRepo.findByIds).mockResolvedValue([makeExercise('ex-1')]);
    // The port guarantees completed-only, user-global (detached included)
    // windows; the use case adds nothing on top. One detached performance
    // yields a normal increase decision.
    vi.mocked(historyRepo.listRecentCompletedExercisePerformances).mockResolvedValue([
      occurrence('ex-1', 0, rep(), atMaxReps(rep(), 50)),
    ]);

    const useCase = new GetNextExerciseTargetsUseCase(exerciseRepo, historyRepo);
    const result = await useCase.execute({ userId: 'user-1', requests: [request('ex-1')] });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data[0]?.target.basis).toBe('increase');
  });


  it('hands the raw newest-first window to the engine untouched: newest occurrence drives the decision', async () => {
    const exerciseRepo = createMockExerciseRepository();
    const historyRepo = createMockHistoryRepository();
    vi.mocked(exerciseRepo.findByIds).mockResolvedValue([makeExercise('ex-1')]);
    vi.mocked(historyRepo.listRecentCompletedExercisePerformances).mockResolvedValue([
      occurrence('ex-1', 1, rep(), atMaxReps(rep(), 50)),
      occurrence('ex-1', 0, rep(), belowMin(rep(), 47.5)),
    ]);

    const useCase = new GetNextExerciseTargetsUseCase(exerciseRepo, historyRepo);
    const result = await useCase.execute({ userId: 'user-1', requests: [request('ex-1')] });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data[0]?.target).toEqual({
      basis: 'increase',
      reason: 'all-sets-at-top-of-range',
      previousLoadKg: 50,
      nextLoadKg: 52,
      incrementKg: 2,
    });
  });

  it('regresses when the newest eligible occurrence and the first eligible prior are both below minimum', async () => {
    const exerciseRepo = createMockExerciseRepository();
    const historyRepo = createMockHistoryRepository();
    vi.mocked(exerciseRepo.findByIds).mockResolvedValue([makeExercise('ex-1')]);
    vi.mocked(historyRepo.listRecentCompletedExercisePerformances).mockResolvedValue([
      occurrence('ex-1', 1, rep(), belowMin(rep(), 50)),
      occurrence('ex-1', 0, rep(), belowMin(rep(), 50)),
    ]);

    const useCase = new GetNextExerciseTargetsUseCase(exerciseRepo, historyRepo);
    const result = await useCase.execute({ userId: 'user-1', requests: [request('ex-1')] });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data[0]?.target).toEqual({
      basis: 'regress',
      reason: 'two-consecutive-sessions-below-minimum',
      previousLoadKg: 50,
      nextLoadKg: 48,
      incrementKg: 2,
    });
  });


  it('regresses through the raw-5 window: eligible below-min newest, three ineligible priors, eligible below-min prior', async () => {
    const exerciseRepo = createMockExerciseRepository();
    const historyRepo = createMockHistoryRepository();
    vi.mocked(exerciseRepo.findByIds).mockResolvedValue([makeExercise('ex-1')]);
    vi.mocked(historyRepo.listRecentCompletedExercisePerformances).mockResolvedValue([
      // Newest: eligible, below minimum.
      occurrence('ex-1', 4, rep(), belowMin(rep(), 50)),
      // Three skipped (no evidence either way): incomplete log, unloaded
      // log, and a different rep scheme.
      occurrence('ex-1', 3, rep(), incomplete(rep(), 50)),
      occurrence('ex-1', 2, rep(), unloaded(rep())),
      occurrence('ex-1', 1, rep(4, 8, 10), atMaxReps(rep(4, 8, 10), 50)),
      // First ELIGIBLE prior: also below minimum — the streak confirms.
      occurrence('ex-1', 0, rep(), belowMin(rep(), 50)),
    ]);

    const useCase = new GetNextExerciseTargetsUseCase(exerciseRepo, historyRepo);
    const result = await useCase.execute({ userId: 'user-1', requests: [request('ex-1')] });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data[0]?.target).toEqual({
      basis: 'regress',
      reason: 'two-consecutive-sessions-below-minimum',
      previousLoadKg: 50,
      nextLoadKg: 48,
      incrementKg: 2,
    });
  });

  it('degrades conservatively beyond the raw-5 window: four consecutive ineligible priors hold instead of regress', async () => {
    const exerciseRepo = createMockExerciseRepository();
    const historyRepo = createMockHistoryRepository();
    vi.mocked(exerciseRepo.findByIds).mockResolvedValue([makeExercise('ex-1')]);
    vi.mocked(historyRepo.listRecentCompletedExercisePerformances).mockResolvedValue([
      // Newest: eligible, below minimum. FOUR consecutive ineligible
      // priors then fill the rest of the raw-5 window — the first eligible
      // prior lies beyond the bound, so the engine cannot see it and holds
      // (never an unsafe load change on partial evidence).
      occurrence('ex-1', 4, rep(), belowMin(rep(), 50)),
      occurrence('ex-1', 3, rep(), incomplete(rep(), 50)),
      occurrence('ex-1', 2, rep(), unloaded(rep())),
      occurrence('ex-1', 1, rep(4, 8, 10), atMaxReps(rep(4, 8, 10), 50)),
      occurrence('ex-1', 0, duration(), [
        { type: 'duration', setNumber: 1, durationSeconds: 30, weightKg: 50, rpe: null },
      ]),
    ]);

    const useCase = new GetNextExerciseTargetsUseCase(exerciseRepo, historyRepo);
    const result = await useCase.execute({ userId: 'user-1', requests: [request('ex-1')] });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data[0]?.target).toEqual({
      basis: 'hold',
      reason: 'single-session-below-minimum',
      previousLoadKg: 50,
      nextLoadKg: 50,
    });
  });


  it('maps the engine early gates: scheme-change, duration, and bodyweight pass through untouched', async () => {
    const exerciseRepo = createMockExerciseRepository();
    const historyRepo = createMockHistoryRepository();
    vi.mocked(exerciseRepo.findByIds).mockResolvedValue([makeExercise('ex-1')]);

    const useCase = new GetNextExerciseTargetsUseCase(exerciseRepo, historyRepo);

    // Newest occurrence earned under a different set count → scheme-change.
    vi.mocked(historyRepo.listRecentCompletedExercisePerformances).mockResolvedValue([
      occurrence('ex-1', 0, rep(4, 8, 10), atMaxReps(rep(4, 8, 10), 50)),
    ]);
    const schemeChange = await useCase.execute({ userId: 'user-1', requests: [request('ex-1')] });
    expect(schemeChange.ok).toBe(true);
    if (schemeChange.ok) {
      expect(schemeChange.data[0]?.target).toEqual({ basis: 'scheme-change', reason: 'scheme-changed' });
    }

    // Duration-based current prescription → duration.
    vi.mocked(historyRepo.listRecentCompletedExercisePerformances).mockResolvedValue([
      occurrence('ex-1', 0, duration(), [
        { type: 'duration', setNumber: 1, durationSeconds: 30, weightKg: null, rpe: null },
      ]),
    ]);
    const durationTarget = await useCase.execute({
      userId: 'user-1',
      requests: [request('ex-1', duration())],
    });
    expect(durationTarget.ok).toBe(true);
    if (durationTarget.ok) {
      expect(durationTarget.data[0]?.target).toEqual({ basis: 'duration', reason: 'duration-scheme' });
    }

    // Newest considered set logged without load → bodyweight.
    vi.mocked(historyRepo.listRecentCompletedExercisePerformances).mockResolvedValue([
      occurrence('ex-1', 0, rep(), unloaded(rep())),
    ]);
    const bodyweight = await useCase.execute({ userId: 'user-1', requests: [request('ex-1')] });
    expect(bodyweight.ok).toBe(true);
    if (bodyweight.ok) {
      expect(bodyweight.data[0]?.target).toEqual({ basis: 'bodyweight', reason: 'unloaded-set' });
    }
  });

  it('supplies each exercise its own window in a mixed batch: never crosses a history-bearing sibling with a first exposure', async () => {
    const exerciseRepo = createMockExerciseRepository();
    const historyRepo = createMockHistoryRepository();
    vi.mocked(exerciseRepo.findByIds).mockResolvedValue([makeExercise('ex-1'), makeExercise('ex-2')]);
    // Only ex-1 has completed history; ex-2 has never been performed.
    vi.mocked(historyRepo.listRecentCompletedExercisePerformances).mockResolvedValue([
      occurrence('ex-1', 0, rep(), atMaxReps(rep(), 50)),
    ]);

    const useCase = new GetNextExerciseTargetsUseCase(exerciseRepo, historyRepo);
    const result = await useCase.execute({
      userId: 'user-1',
      requests: [request('ex-1'), request('ex-2')],
    });

    // Still exactly one batched history call covering both requested ids.
    expect(historyRepo.listRecentCompletedExercisePerformances).toHaveBeenCalledTimes(1);
    expect(historyRepo.listRecentCompletedExercisePerformances).toHaveBeenCalledWith(
      'user-1',
      [eid('ex-1'), eid('ex-2')],
      5,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Positional zip: the history-bearing exercise gets its window decision,
    // the never-performed sibling gets first exposure — never crossed.
    expect(result.data[0]).toEqual({
      exerciseId: 'ex-1',
      target: {
        basis: 'increase',
        reason: 'all-sets-at-top-of-range',
        previousLoadKg: 50,
        nextLoadKg: 52,
        incrementKg: 2,
      },
    });
    expect(result.data[1]).toEqual({
      exerciseId: 'ex-2',
      target: { basis: 'first-exposure', reason: 'no-history' },
    });
  });

  it('holds through real application history when a single below-min newest breaks a healthy streak', async () => {
    const exerciseRepo = createMockExerciseRepository();
    const historyRepo = createMockHistoryRepository();
    vi.mocked(exerciseRepo.findByIds).mockResolvedValue([makeExercise('ex-1')]);
    vi.mocked(historyRepo.listRecentCompletedExercisePerformances).mockResolvedValue([
      // Newest: eligible but below minimum — one poor occurrence.
      occurrence('ex-1', 1, rep(), belowMin(rep(), 50)),
      // First eligible prior: at the top of the range — the streak breaks.
      occurrence('ex-1', 0, rep(), atMaxReps(rep(), 50)),
    ]);

    const useCase = new GetNextExerciseTargetsUseCase(exerciseRepo, historyRepo);
    const result = await useCase.execute({ userId: 'user-1', requests: [request('ex-1')] });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Slice 1 semantics through the windowed read: a single below-min
    // occurrence never regresses — hold at the current load.
    expect(result.data[0]?.target).toEqual({
      basis: 'hold',
      reason: 'single-session-below-minimum',
      previousLoadKg: 50,
      nextLoadKg: 50,
    });
  });
});


