/**
 * M13 Slice 3 — GetTrainingWeeklyInsightsUseCase orchestration.
 *
 * The ports are stubbed, so these tests observe the orchestration contract:
 * which reads are issued with which bounds, that the Domain's week service owns
 * every week fact, that the catalog lookup stays a single batched call for
 * exactly the candidates that can render, and that infrastructure failures are
 * never converted into fake empty data.
 */

import { describe, expect, it, vi } from 'vitest';

import type { ExerciseRepository } from '@/application/ports/exercise-repository';
import type { PersonalRecordRepository } from '@/application/ports/personal-record-repository';
import type {
  CompletedSessionActivityEntry,
  TrainingHistoryRepository,
} from '@/application/ports/training-history-repository';
import {
  GetTrainingWeeklyInsightsUseCase,
  TRAINING_INSIGHTS_WEEK_COUNT,
} from '@/application/use-cases/get-training-weekly-insights';
import type { Exercise } from '@/domain/entities/exercise';
import { RecordMetric } from '@/domain/services/personal-record-metrics';
import type { PersonalBest } from '@/domain/services/personal-records';
import {
  Difficulty as DifficultyEnum,
  EquipmentType as EquipmentTypeEnum,
  MovementPattern as MovementPatternEnum,
  MuscleGroup as MuscleGroupEnum,
} from '@/domain/types/exercise';
import {
  createExerciseId,
  createUserId,
  createWorkoutSessionId,
} from '@/domain/types/ids';

function uid(value: string) {
  const result = createUserId(value);
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

function eid(value: string) {
  const result = createExerciseId(value);
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

function sid(value: string) {
  const result = createWorkoutSessionId(value);
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

/** A Thursday: the current UTC week starts 2026-09-21, the previous 2026-09-14. */
const NOW = new Date('2026-09-24T10:00:00.000Z');
/** The oldest window of the eight: 2026-09-21 minus seven weeks. */
const OLDEST_WEEK_START = '2026-08-03T00:00:00.000Z';
const CURRENT_WEEK_START = '2026-09-21T00:00:00.000Z';

function activity(
  sessionId: string,
  completedAt: string,
  loggedSets: number,
  startedAt = completedAt,
): CompletedSessionActivityEntry {
  return {
    sessionId: sid(sessionId),
    workoutName: 'Full Body A',
    programName: 'Fit40 Beginner Strength',
    startedAt: new Date(startedAt),
    completedAt: new Date(completedAt),
    loggedSets,
  };
}

function best(spec: {
  readonly exerciseId: string;
  readonly value: number;
  readonly completedAt: string;
  readonly metric?: RecordMetric;
  readonly startedAt?: string;
  readonly sessionId?: string;
}): PersonalBest {
  return {
    exerciseId: eid(spec.exerciseId),
    metric: spec.metric ?? RecordMetric.MaxLoad,
    value: spec.value,
    position: {
      completedAt: new Date(spec.completedAt),
      startedAt: new Date(spec.startedAt ?? spec.completedAt),
      sessionId: sid(spec.sessionId ?? `session-${spec.exerciseId}`),
      exerciseOrder: 1,
      setNumber: 1,
    },
  };
}

function makeExercise(id: string, name: string, slug: string): Exercise {
  return {
    id: eid(id),
    name,
    slug,
    description: 'A movement.',
    primaryMuscle: MuscleGroupEnum.Quadriceps,
    secondaryMuscles: [],
    equipment: EquipmentTypeEnum.Kettlebell,
    difficulty: DifficultyEnum.Beginner,
    movementPattern: MovementPatternEnum.Squat,
    considerations: [],
  };
}

function makeDeps() {
  const listActivity = vi
    .fn<TrainingHistoryRepository['listCompletedSessionActivity']>()
    .mockResolvedValue([]);
  const findBests = vi
    .fn<PersonalRecordRepository['findCurrentPersonalBestsSetBetween']>()
    .mockResolvedValue([]);
  const findByIds = vi.fn<ExerciseRepository['findByIds']>().mockResolvedValue([]);

  const history = {
    listCompletedSessions: vi.fn(),
    listCompletedExerciseOccurrences: vi.fn(),
    listRecentCompletedExercisePerformances: vi.fn(),
    listCompletedSessionActivity: listActivity,
    getTotals: vi.fn(),
    findCompletedSessionById: vi.fn(),
  } satisfies TrainingHistoryRepository;

  const records = {
    findCurrentPersonalBests: vi.fn(),
    findCurrentPersonalBestsSetBetween: findBests,
    findBestValuesBefore: vi.fn(),
  } satisfies PersonalRecordRepository;

  const exercises = {
    list: vi.fn(),
    findBySlug: vi.fn(),
    findByIds,
  } satisfies ExerciseRepository;

  return {
    listActivity,
    findBests,
    findByIds,
    useCase: new GetTrainingWeeklyInsightsUseCase(history, records, exercises),
  };
}

describe('GetTrainingWeeklyInsightsUseCase — validation', () => {
  it('rejects a malformed userId before touching any repository', async () => {
    const deps = makeDeps();

    const result = await deps.useCase.execute({ userId: '   ', now: NOW });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('INVALID_INPUT');
    expect(result.error.field).toBe('userId');
    expect(deps.listActivity).not.toHaveBeenCalled();
    expect(deps.findBests).not.toHaveBeenCalled();
    expect(deps.findByIds).not.toHaveBeenCalled();
  });
});

describe('GetTrainingWeeklyInsightsUseCase — reads and week windows', () => {
  it('covers exactly eight weeks, oldest first, ending with the week of `now`', async () => {
    const deps = makeDeps();

    const result = await deps.useCase.execute({ userId: 'user-a', now: NOW });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(TRAINING_INSIGHTS_WEEK_COUNT).toBe(8);
    expect(result.data.weeks).toHaveLength(TRAINING_INSIGHTS_WEEK_COUNT);
    expect(result.data.weeks[0]?.weekStart).toBe(OLDEST_WEEK_START);
    expect(result.data.weeks.at(-1)?.weekStart).toBe(CURRENT_WEEK_START);
    expect(result.data.weekStart).toBe(CURRENT_WEEK_START);

    // Contiguous: each week start is exactly seven days after the previous one.
    for (let index = 1; index < result.data.weeks.length; index += 1) {
      const previous = result.data.weeks[index - 1];
      const current = result.data.weeks[index];
      const gap =
        new Date(current?.weekStart ?? '').getTime() -
        new Date(previous?.weekStart ?? '').getTime();
      expect(gap).toBe(7 * 86_400_000);
    }
  });

  it('bounds the activity read by the oldest week start and the record read by the request clock', async () => {
    const deps = makeDeps();

    await deps.useCase.execute({ userId: 'user-a', now: NOW });

    expect(deps.listActivity).toHaveBeenCalledTimes(1);
    const activityCall = deps.listActivity.mock.calls[0];
    expect(activityCall?.[0]).toBe(uid('user-a'));
    expect(activityCall?.[1]?.toISOString()).toBe(OLDEST_WEEK_START);

    expect(deps.findBests).toHaveBeenCalledTimes(1);
    const bestsCall = deps.findBests.mock.calls[0];
    expect(bestsCall?.[0]).toBe(uid('user-a'));
    expect(bestsCall?.[1]?.toISOString()).toBe(OLDEST_WEEK_START);
    // `to` is the request clock itself — never a computed week end.
    expect(bestsCall?.[2]).toBe(NOW);
    expect(bestsCall?.[2]?.toISOString()).toBe('2026-09-24T10:00:00.000Z');
  });

  it('issues no catalog lookup when there are no candidates to name', async () => {
    const deps = makeDeps();

    const result = await deps.useCase.execute({ userId: 'user-a', now: NOW });

    expect(result.ok).toBe(true);
    expect(deps.findByIds).not.toHaveBeenCalled();
  });
});

describe('GetTrainingWeeklyInsightsUseCase — week summaries and deltas', () => {
  it('buckets the activity read into the weeks through the domain service', async () => {
    const deps = makeDeps();
    deps.listActivity.mockResolvedValue([
      activity('session-current-1', '2026-09-22T10:00:00.000Z', 12),
      activity('session-current-2', '2026-09-24T09:00:00.000Z', 8),
      activity('session-previous', '2026-09-15T10:00:00.000Z', 10),
      // Older than the eight-week lookback: outside every supplied window.
      activity('session-ancient', '2026-07-01T10:00:00.000Z', 99),
    ]);

    const result = await deps.useCase.execute({ userId: 'user-a', now: NOW });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.summary.currentWeek).toEqual({
      weekStart: CURRENT_WEEK_START,
      completedWorkouts: 2,
      loggedSets: 20,
    });
    expect(result.data.summary.previousWeek).toEqual({
      weekStart: '2026-09-14T00:00:00.000Z',
      completedWorkouts: 1,
      loggedSets: 10,
    });
    expect(result.data.summary.workoutDelta).toBe(1);
    expect(result.data.summary.setDelta).toBe(10);

    // The out-of-window session is ignored rather than counted anywhere…
    const totalWorkouts = result.data.weeks.reduce(
      (total, week) => total + week.completedWorkouts,
      0,
    );
    expect(totalWorkouts).toBe(3);
    // …and the untouched weeks stay authoritative zeros.
    expect(
      result.data.weeks
        .slice(0, 6)
        .every((week) => week.completedWorkouts === 0 && week.loggedSets === 0),
    ).toBe(true);
  });

  it('reports zeroed weeks and no records for empty history', async () => {
    const deps = makeDeps();

    const result = await deps.useCase.execute({ userId: 'user-a', now: NOW });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(
      result.data.weeks.every((week) => week.completedWorkouts === 0 && week.loggedSets === 0),
    ).toBe(true);
    expect(result.data.summary).toEqual({
      currentWeek: { weekStart: CURRENT_WEEK_START, completedWorkouts: 0, loggedSets: 0 },
      previousWeek: { weekStart: '2026-09-14T00:00:00.000Z', completedWorkouts: 0, loggedSets: 0 },
      workoutDelta: 0,
      setDelta: 0,
      currentPersonalBestsSetThisWeek: 0,
    });
    expect(result.data.recentPersonalBests).toEqual([]);
  });

  it('reports plain numeric deltas when behind and when the previous week is zero', async () => {
    const behind = makeDeps();
    behind.listActivity.mockResolvedValue([
      activity('behind-current', '2026-09-22T10:00:00.000Z', 10),
      activity('behind-previous-1', '2026-09-15T10:00:00.000Z', 20),
      activity('behind-previous-2', '2026-09-16T10:00:00.000Z', 20),
      activity('behind-previous-3', '2026-09-17T10:00:00.000Z', 10),
    ]);

    const behindResult = await behind.useCase.execute({ userId: 'user-a', now: NOW });
    expect(behindResult.ok).toBe(true);
    if (!behindResult.ok) return;
    expect(behindResult.data.summary.workoutDelta).toBe(-2);
    expect(behindResult.data.summary.setDelta).toBe(-40);

    const zeroPrevious = makeDeps();
    zeroPrevious.listActivity.mockResolvedValue([
      activity('zero-previous-current', '2026-09-22T10:00:00.000Z', 30),
    ]);

    const zeroResult = await zeroPrevious.useCase.execute({ userId: 'user-a', now: NOW });
    expect(zeroResult.ok).toBe(true);
    if (!zeroResult.ok) return;
    // A week without training is an authoritative zero, never "untracked".
    expect(zeroResult.data.summary.previousWeek.completedWorkouts).toBe(0);
    expect(zeroResult.data.summary.workoutDelta).toBe(1);
    expect(zeroResult.data.summary.setDelta).toBe(30);
  });
});

describe('GetTrainingWeeklyInsightsUseCase — personal bests', () => {
  it('counts only this-week winners and orders the recent list newest first', async () => {
    const deps = makeDeps();
    deps.findBests.mockResolvedValue([
      // Both winners share a completion instant: the later start orders first.
      best({
        exerciseId: 'ex-002',
        value: 24,
        completedAt: '2026-09-22T10:00:00.000Z',
        startedAt: '2026-09-22T08:00:00.000Z',
        sessionId: 'session-tie-early',
      }),
      best({
        exerciseId: 'ex-003',
        value: 40,
        completedAt: '2026-09-22T10:00:00.000Z',
        startedAt: '2026-09-22T09:00:00.000Z',
        sessionId: 'session-tie-late',
      }),
      // Older winners the lookback still returns: recent, but not this week.
      best({ exerciseId: 'ex-001', value: 60, completedAt: '2026-09-10T10:00:00.000Z' }),
      best({ exerciseId: 'ex-004', value: 30, completedAt: '2026-08-05T10:00:00.000Z' }),
    ]);
    deps.findByIds.mockResolvedValue([
      makeExercise('ex-001', 'Bench Press', 'bench-press'),
      makeExercise('ex-002', 'Goblet Squat', 'goblet-squat'),
      makeExercise('ex-003', 'Farmer Carry', 'farmer-carry'),
      makeExercise('ex-004', 'Dead Bug', 'dead-bug'),
    ]);

    const result = await deps.useCase.execute({ userId: 'user-a', now: NOW });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.summary.currentPersonalBestsSetThisWeek).toBe(2);
    expect(result.data.recentPersonalBests.map((row) => row.exerciseId)).toEqual([
      'ex-003',
      'ex-002',
      'ex-001',
      'ex-004',
    ]);
    expect(result.data.recentPersonalBests[0]).toEqual({
      exerciseId: 'ex-003',
      exerciseName: 'Farmer Carry',
      exerciseSlug: 'farmer-carry',
      metric: 'max-load',
      value: 40,
      sessionId: 'session-tie-late',
      completedAt: '2026-09-22T10:00:00.000Z',
    });
  });

  it('deduplicates candidate ids and performs exactly one batched catalog lookup', async () => {
    const deps = makeDeps();
    deps.findBests.mockResolvedValue([
      best({ exerciseId: 'ex-001', value: 60, completedAt: '2026-09-22T10:00:00.000Z' }),
      best({
        exerciseId: 'ex-001',
        metric: RecordMetric.MaxBodyweightReps,
        value: 18,
        completedAt: '2026-09-20T10:00:00.000Z',
      }),
      best({ exerciseId: 'ex-002', value: 24, completedAt: '2026-09-10T10:00:00.000Z' }),
    ]);
    deps.findByIds.mockResolvedValue([
      makeExercise('ex-001', 'Bench Press', 'bench-press'),
      makeExercise('ex-002', 'Goblet Squat', 'goblet-squat'),
    ]);

    const result = await deps.useCase.execute({ userId: 'user-a', now: NOW });

    expect(result.ok).toBe(true);
    expect(deps.findByIds).toHaveBeenCalledTimes(1);
    // One call, deduplicated ids, first-seen order of the newest-first candidates.
    expect(deps.findByIds.mock.calls[0]?.[0]).toEqual([eid('ex-001'), eid('ex-002')]);
  });

  it('omits unresolved catalog metadata without changing the this-week count', async () => {
    const deps = makeDeps();
    deps.findBests.mockResolvedValue([
      // This week, and the catalog cannot name it: counted, not rendered.
      best({ exerciseId: 'ex-001', value: 60, completedAt: '2026-09-22T10:00:00.000Z' }),
      best({ exerciseId: 'ex-002', value: 24, completedAt: '2026-09-21T10:00:00.000Z' }),
      best({ exerciseId: 'ex-003', value: 40, completedAt: '2026-09-10T10:00:00.000Z' }),
    ]);
    // The catalog resolves only two of the three.
    deps.findByIds.mockResolvedValue([
      makeExercise('ex-002', 'Goblet Squat', 'goblet-squat'),
      makeExercise('ex-003', 'Farmer Carry', 'farmer-carry'),
    ]);

    const result = await deps.useCase.execute({ userId: 'user-a', now: NOW });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.recentPersonalBests.map((row) => row.exerciseId)).toEqual([
      'ex-002',
      'ex-003',
    ]);
    expect(result.data.summary.currentPersonalBestsSetThisWeek).toBe(2);
  });

  it('caps the recent list at five winners', async () => {
    const deps = makeDeps();
    const days = ['2026-09-05', '2026-09-06', '2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10'];
    deps.findBests.mockResolvedValue(
      days.map((day, index) =>
        best({
          exerciseId: `ex-00${index + 1}`,
          value: 40 + index,
          completedAt: `${day}T10:00:00.000Z`,
        }),
      ),
    );
    deps.findByIds.mockResolvedValue(
      days.map((_, index) =>
        makeExercise(`ex-00${index + 1}`, `Exercise ${index + 1}`, `exercise-${index + 1}`),
      ),
    );

    const result = await deps.useCase.execute({ userId: 'user-a', now: NOW });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.recentPersonalBests).toHaveLength(5);
    expect(result.data.recentPersonalBests.map((row) => row.completedAt)).toEqual([
      '2026-09-10T10:00:00.000Z',
      '2026-09-09T10:00:00.000Z',
      '2026-09-08T10:00:00.000Z',
      '2026-09-07T10:00:00.000Z',
      '2026-09-06T10:00:00.000Z',
    ]);
  });

  it('consumes repository record values as authoritative', async () => {
    const deps = makeDeps();
    deps.findBests.mockResolvedValue([
      // A performed exercise id (the replacement of a substitution), a real
      // logged 0 kg, and a bodyweight-reps metric: all passed through as-is.
      best({ exerciseId: 'ex-004', value: 0, completedAt: '2026-09-22T10:00:00.000Z' }),
      best({
        exerciseId: 'ex-005',
        metric: RecordMetric.MaxBodyweightReps,
        value: 18,
        completedAt: '2026-09-21T10:00:00.000Z',
      }),
    ]);
    deps.findByIds.mockResolvedValue([
      makeExercise('ex-004', 'Goblet Squat', 'goblet-squat'),
      makeExercise('ex-005', 'Push-up', 'push-up'),
    ]);

    const result = await deps.useCase.execute({ userId: 'user-a', now: NOW });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.recentPersonalBests.map((row) => row.exerciseId)).toEqual([
      'ex-004',
      'ex-005',
    ]);
    expect(result.data.recentPersonalBests.map((row) => row.metric)).toEqual([
      'max-load',
      'max-bodyweight-reps',
    ]);
    expect(Object.is(result.data.recentPersonalBests[0]?.value, 0)).toBe(true);
    expect(result.data.recentPersonalBests[1]?.value).toBe(18);
  });
});

describe('GetTrainingWeeklyInsightsUseCase — failures', () => {
  it('propagates an activity read failure instead of inventing empty weeks', async () => {
    const deps = makeDeps();
    deps.listActivity.mockRejectedValue(new Error('activity read unavailable'));

    await expect(deps.useCase.execute({ userId: 'user-a', now: NOW })).rejects.toThrow(
      'activity read unavailable',
    );
    expect(deps.findByIds).not.toHaveBeenCalled();
  });

  it('propagates a record read failure instead of inventing zero records', async () => {
    const deps = makeDeps();
    deps.findBests.mockRejectedValue(new Error('record read unavailable'));

    await expect(deps.useCase.execute({ userId: 'user-a', now: NOW })).rejects.toThrow(
      'record read unavailable',
    );
  });

  it('propagates a catalog failure instead of dropping the records', async () => {
    const deps = makeDeps();
    deps.findBests.mockResolvedValue([
      best({ exerciseId: 'ex-001', value: 60, completedAt: '2026-09-22T10:00:00.000Z' }),
    ]);
    deps.findByIds.mockRejectedValue(new Error('catalog unavailable'));

    await expect(deps.useCase.execute({ userId: 'user-a', now: NOW })).rejects.toThrow(
      'catalog unavailable',
    );
  });
});