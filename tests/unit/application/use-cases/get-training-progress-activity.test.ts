/**
 * M18 Slice 2 — GetTrainingProgressActivityUseCase orchestration.
 *
 * The port is stubbed, so these tests observe the orchestration contract:
 * exactly one bounded read whose `since` is the oldest horizon window, the
 * fixed 13-week horizon derived from the caller's clock, week/period/average
 * facts owned by the Domain's progress service, presence (`null` vs genuine
 * `0`) carried through the DTO, and no fabricated zeros when history is empty.
 */

import { describe, expect, it, vi } from 'vitest';

import {
  PROGRESS_HORIZON_WEEK_COUNT,
  type ProgressActivityDto,
} from '@/application/dto/training-progress';
import type {
  ProgressSessionActivityEntry,
  TrainingHistoryRepository,
} from '@/application/ports/training-history-repository';
import { GetTrainingProgressActivityUseCase } from '@/application/use-cases/get-training-progress-activity';
import { createWorkoutSessionId } from '@/domain/types/ids';

function sessionId(value: string) {
  const result = createWorkoutSessionId(value);
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

/** A Thursday: the current UTC week starts 2026-09-21. */
const NOW = new Date('2026-09-24T10:00:00.000Z');
/** The oldest of the 13 windows: 2026-09-21 minus twelve weeks. */
const OLDEST_WEEK_START = '2026-06-29T00:00:00.000Z';
const CURRENT_WEEK_START = '2026-09-21T00:00:00.000Z';

function activity(
  sessionIdValue: string,
  completedAt: string,
  loggedSets: number,
  externalLoadVolume: number | null,
): ProgressSessionActivityEntry {
  return {
    sessionId: sessionId(sessionIdValue),
    completedAt: new Date(completedAt),
    loggedSets,
    externalLoadVolume,
  };
}

function makeDeps(entries: ReadonlyArray<ProgressSessionActivityEntry> = []) {
  const listProgress = vi
    .fn<TrainingHistoryRepository['listProgressSessionActivity']>()
    .mockResolvedValue([...entries]);

  const history = {
    listCompletedSessions: vi.fn(),
    listCompletedExerciseOccurrences: vi.fn(),
    listRecentCompletedExercisePerformances: vi.fn(),
    listCompletedSessionActivity: vi.fn(),
    listProgressSessionActivity: listProgress,
    getTotals: vi.fn(),
    findCompletedSessionById: vi.fn(),
  } satisfies TrainingHistoryRepository;

  return {
    history,
    listProgress,
    useCase: new GetTrainingProgressActivityUseCase(history),
  };
}

/** A four-session horizon: loaded, bodyweight-only, genuine zero, current week. */
const HORIZON_ENTRIES: ReadonlyArray<ProgressSessionActivityEntry> = [
  activity('progress-loaded', '2026-06-29T09:00:00.000Z', 10, 2_000),
  activity('progress-bodyweight', '2026-07-13T09:00:00.000Z', 12, null),
  activity('progress-zero', '2026-07-27T09:00:00.000Z', 3, 0),
  activity('progress-current', '2026-09-22T09:00:00.000Z', 5, 300),
];

describe('GetTrainingProgressActivityUseCase — validation', () => {
  it('rejects a malformed userId before touching the repository', async () => {
    const deps = makeDeps();

    const result = await deps.useCase.execute({ userId: '   ', now: NOW });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('INVALID_INPUT');
    expect(result.error.field).toBe('userId');
    expect(deps.listProgress).not.toHaveBeenCalled();
  });
});

describe('GetTrainingProgressActivityUseCase — horizon and read bounds', () => {
  it('covers exactly thirteen weeks, oldest first, ending with the week of `now`', async () => {
    const deps = makeDeps();

    const result = await deps.useCase.execute({ userId: 'user-a', now: NOW });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(PROGRESS_HORIZON_WEEK_COUNT).toBe(13);
    expect(result.data.weeks).toHaveLength(PROGRESS_HORIZON_WEEK_COUNT);
    expect(result.data.weeks[0]?.weekStart).toBe(OLDEST_WEEK_START);
    expect(result.data.weeks.at(-1)?.weekStart).toBe(CURRENT_WEEK_START);
    expect(result.data.currentWeekStart).toBe(CURRENT_WEEK_START);

    // Contiguous: each week start is exactly seven days after the previous.
    for (let index = 1; index < result.data.weeks.length; index += 1) {
      const previous = result.data.weeks[index - 1];
      const current = result.data.weeks[index];
      const gap =
        new Date(current?.weekStart ?? '').getTime() -
        new Date(previous?.weekStart ?? '').getTime();
      expect(gap).toBe(7 * 86_400_000);
    }
  });

  it('issues one bounded read bound by the oldest week start, and nothing else', async () => {
    const deps = makeDeps(HORIZON_ENTRIES);

    await deps.useCase.execute({ userId: 'user-a', now: NOW });

    expect(deps.listProgress).toHaveBeenCalledTimes(1);
    const call = deps.listProgress.mock.calls[0];
    expect(String(call?.[0])).toBe('user-a');
    expect(call?.[1]?.toISOString()).toBe(OLDEST_WEEK_START);

    // No other repository method is touched: the horizon is one window read.
    expect(deps.history.listCompletedSessions).not.toHaveBeenCalled();
    expect(deps.history.listCompletedExerciseOccurrences).not.toHaveBeenCalled();
    expect(deps.history.listRecentCompletedExercisePerformances).not.toHaveBeenCalled();
    expect(deps.history.listCompletedSessionActivity).not.toHaveBeenCalled();
    expect(deps.history.getTotals).not.toHaveBeenCalled();
    expect(deps.history.findCompletedSessionById).not.toHaveBeenCalled();
  });
});

/** Week/total/average facts of one DTO, for compact assertions. */
function facts(dto: ProgressActivityDto) {
  return {
    weeks: dto.weeks.map((week) => ({
      weekStart: week.weekStart,
      completedWorkouts: week.completedWorkouts,
      loggedSets: week.loggedSets,
      externalLoadVolumeKgReps: week.externalLoadVolumeKgReps,
    })),
    totals: dto.totals,
    average: dto.average,
  };
}

describe('GetTrainingProgressActivityUseCase — Domain facts mapped through', () => {
  it('maps week facts, period totals and the anchored average, presence included', async () => {
    const deps = makeDeps(HORIZON_ENTRIES);

    const result = await deps.useCase.execute({ userId: 'user-a', now: NOW });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const dto = result.data;

    expect(dto.weeks[0]).toEqual({
      weekStart: OLDEST_WEEK_START,
      completedWorkouts: 1,
      loggedSets: 10,
      externalLoadVolumeKgReps: 2_000,
    });
    // Bodyweight-only: no eligible external-load data, never a zero (§6.3).
    expect(dto.weeks[2]).toEqual({
      weekStart: '2026-07-13T00:00:00.000Z',
      completedWorkouts: 1,
      loggedSets: 12,
      externalLoadVolumeKgReps: null,
    });
    // Genuine zero: eligible loaded sets that sum to zero stay a real `0`.
    expect(dto.weeks[4]).toEqual({
      weekStart: '2026-07-27T00:00:00.000Z',
      completedWorkouts: 1,
      loggedSets: 3,
      externalLoadVolumeKgReps: 0,
    });
    // The current partial week renders its own facts.
    expect(dto.weeks[12]).toEqual({
      weekStart: CURRENT_WEEK_START,
      completedWorkouts: 1,
      loggedSets: 5,
      externalLoadVolumeKgReps: 300,
    });
    // Untouched weeks are authoritative zeros with no external-load data.
    expect(dto.weeks[1]).toEqual({
      weekStart: '2026-07-06T00:00:00.000Z',
      completedWorkouts: 0,
      loggedSets: 0,
      externalLoadVolumeKgReps: null,
    });

    // Totals include the current partial week; the average excludes it.
    expect(dto.totals).toEqual({
      completedWorkouts: 4,
      loggedSets: 30,
      externalLoadVolumeKgReps: 2_300,
    });
    expect(dto.average).toEqual({ workoutsPerWeek: 0.25, denominatorWeeks: 12 });
  });

  it('never fabricates a period volume when no week carried eligible data', async () => {
    const deps = makeDeps([
      activity('progress-bw-1', '2026-06-29T09:00:00.000Z', 8, null),
      activity('progress-bw-2', '2026-09-22T09:00:00.000Z', 6, null),
    ]);

    const result = await deps.useCase.execute({ userId: 'user-a', now: NOW });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.totals).toEqual({
      completedWorkouts: 2,
      loggedSets: 14,
      externalLoadVolumeKgReps: null,
    });
  });

  it('answers an empty history with truthful zeros and no average', async () => {
    const deps = makeDeps();

    const result = await deps.useCase.execute({ userId: 'user-a', now: NOW });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { weeks, totals, average } = facts(result.data);

    expect(weeks).toHaveLength(PROGRESS_HORIZON_WEEK_COUNT);
    expect(weeks.every((week) => week.completedWorkouts === 0)).toBe(true);
    expect(weeks.every((week) => week.loggedSets === 0)).toBe(true);
    expect(weeks.every((week) => week.externalLoadVolumeKgReps === null)).toBe(true);
    expect(totals).toEqual({
      completedWorkouts: 0,
      loggedSets: 0,
      externalLoadVolumeKgReps: null,
    });
    // Never a fabricated "0.0 workouts per week" (§4.5).
    expect(average).toBeNull();
  });
});
