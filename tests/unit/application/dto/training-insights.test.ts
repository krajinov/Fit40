/**
 * M13 Slice 3 — the weekly-insights DTO mapper and its pure selection helpers.
 *
 * The mapper is total and clock-free: week facts arrive as Domain summaries,
 * record facts as repository results, so these tests hand both in directly and
 * assert only mapping, ordering, capping and counting.
 */

import { describe, expect, it } from 'vitest';

import type { ExerciseSummaryDto } from '@/application/dto/exercise';
import {
  orderCurrentPersonalBestsNewestFirst,
  RECENT_PERSONAL_BESTS_LIMIT,
  selectRecentPersonalBestCandidates,
  toTrainingWeeklyInsightsDto,
  type TrainingWeeklyInsightsInput,
} from '@/application/dto/training-insights';
import { RecordMetric } from '@/domain/services/personal-record-metrics';
import type { PersonalBest } from '@/domain/services/personal-records';
import type { TrainingWeekSummary, TrainingWeekWindow } from '@/domain/services/training-week';
import {
  Difficulty as DifficultyEnum,
  EquipmentType as EquipmentTypeEnum,
  MovementPattern as MovementPatternEnum,
  MuscleGroup as MuscleGroupEnum,
} from '@/domain/types/exercise';
import { createExerciseId, createWorkoutSessionId } from '@/domain/types/ids';

const MS_PER_DAY = 86_400_000;

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

/** A Domain window exactly as `listRecentTrainingWeekWindows` would build it. */
function weekWindow(weekStart: string, weekIndex = 0): TrainingWeekWindow {
  const start = new Date(weekStart);
  return {
    weekStart: start,
    weekEnd: new Date(start.getTime() + 7 * MS_PER_DAY),
    weekIndex,
  };
}

function weekSummary(
  weekStart: string,
  completedWorkouts: number,
  loggedSets: number,
  weekIndex = 0,
): TrainingWeekSummary {
  return { window: weekWindow(weekStart, weekIndex), completedWorkouts, loggedSets };
}

function best(spec: {
  readonly exerciseId: string;
  readonly value: number;
  readonly completedAt: string;
  readonly metric?: RecordMetric;
  readonly startedAt?: string;
  readonly sessionId?: string;
  readonly exerciseOrder?: number;
  readonly setNumber?: number;
}): PersonalBest {
  return {
    exerciseId: eid(spec.exerciseId),
    metric: spec.metric ?? RecordMetric.MaxLoad,
    value: spec.value,
    position: {
      completedAt: new Date(spec.completedAt),
      startedAt: new Date(spec.startedAt ?? spec.completedAt),
      sessionId: sid(spec.sessionId ?? `session-${spec.exerciseId}`),
      exerciseOrder: spec.exerciseOrder ?? 1,
      setNumber: spec.setNumber ?? 1,
    },
  };
}

function exercise(id: string, name: string, slug: string): ExerciseSummaryDto {
  return {
    id,
    name,
    slug,
    primaryMuscle: MuscleGroupEnum.Quadriceps,
    equipment: EquipmentTypeEnum.Kettlebell,
    difficulty: DifficultyEnum.Beginner,
    movementPattern: MovementPatternEnum.Squat,
  };
}

/** 2026-09-21 is a Monday: the current week; the previous starts a week earlier. */
const CURRENT_WEEK_START = '2026-09-21T00:00:00.000Z';
const PREVIOUS_WEEK_START = '2026-09-14T00:00:00.000Z';

const previousWeek = weekSummary(PREVIOUS_WEEK_START, 2, 20, -1);
const currentWeek = weekSummary(CURRENT_WEEK_START, 3, 30, 0);

function input(overrides: Partial<TrainingWeeklyInsightsInput> = {}): TrainingWeeklyInsightsInput {
  const summaries: ReadonlyArray<TrainingWeekSummary> = [previousWeek, currentWeek];
  return {
    summaries,
    currentWeek,
    previousWeek,
    comparison: { workoutDelta: 1, setDelta: 10 },
    bests: [],
    exercises: [],
    ...overrides,
  };
}

const BENCH = 'ex-001';
const GOBLET = 'ex-002';

describe('toTrainingWeeklyInsightsDto — week mapping', () => {
  it('maps every week summary in order with ISO starts and its own totals', () => {
    const dto = toTrainingWeeklyInsightsDto(input());

    expect(dto.weeks).toEqual([
      { weekStart: PREVIOUS_WEEK_START, completedWorkouts: 2, loggedSets: 20 },
      { weekStart: CURRENT_WEEK_START, completedWorkouts: 3, loggedSets: 30 },
    ]);
  });

  it('reports the current week start and both week summaries', () => {
    const dto = toTrainingWeeklyInsightsDto(input());

    expect(dto.weekStart).toBe(CURRENT_WEEK_START);
    expect(dto.summary.currentWeek).toEqual({
      weekStart: CURRENT_WEEK_START,
      completedWorkouts: 3,
      loggedSets: 30,
    });
    expect(dto.summary.previousWeek).toEqual({
      weekStart: PREVIOUS_WEEK_START,
      completedWorkouts: 2,
      loggedSets: 20,
    });
  });

  it('carries the domain comparison through as plain integers', () => {
    const positive = toTrainingWeeklyInsightsDto(input());
    expect(positive.summary.workoutDelta).toBe(1);
    expect(positive.summary.setDelta).toBe(10);

    const negative = toTrainingWeeklyInsightsDto(
      input({ comparison: { workoutDelta: -2, setDelta: -35 } }),
    );
    expect(negative.summary.workoutDelta).toBe(-2);
    expect(negative.summary.setDelta).toBe(-35);

    const zeroPrevious = toTrainingWeeklyInsightsDto(
      input({
        previousWeek: weekSummary(PREVIOUS_WEEK_START, 0, 0, -1),
        // The delta is the Domain comparison the use case computed; the mapper
        // only carries it and never re-derives it from the summaries.
        comparison: { workoutDelta: 3, setDelta: 30 },
      }),
    );
    expect(zeroPrevious.summary.workoutDelta).toBe(3);
    expect(zeroPrevious.summary.setDelta).toBe(30);
    expect(zeroPrevious.summary.previousWeek).toEqual({
      weekStart: PREVIOUS_WEEK_START,
      completedWorkouts: 0,
      loggedSets: 0,
    });
  });

  it('serializes instants as ISO strings, not Dates', () => {
    const dto = toTrainingWeeklyInsightsDto(
      input({
        bests: [best({ exerciseId: BENCH, value: 82.5, completedAt: '2026-09-23T10:00:00.000Z' })],
        exercises: [exercise(BENCH, 'Bench Press', 'bench-press')],
      }),
    );

    expect(dto.recentPersonalBests[0]?.completedAt).toBe('2026-09-23T10:00:00.000Z');
    expect(dto.weeks.every((week) => typeof week.weekStart === 'string')).toBe(true);
  });
});

describe('toTrainingWeeklyInsightsDto — current personal bests set this week', () => {
  it('counts only winners established inside the current week [start, end)', () => {
    const dto = toTrainingWeeklyInsightsDto(
      input({
        bests: [
          // Inclusive edge: exactly the current week's Monday midnight.
          best({ exerciseId: 'ex-001', value: 60, completedAt: CURRENT_WEEK_START }),
          best({ exerciseId: 'ex-002', value: 24, completedAt: '2026-09-24T18:00:00.000Z' }),
          // Exclusive edge: the next week's Monday midnight.
          best({ exerciseId: 'ex-003', value: 40, completedAt: '2026-09-28T00:00:00.000Z' }),
          // Previous week: returned by the lookback, not this week.
          best({ exerciseId: 'ex-004', value: 40, completedAt: '2026-09-14T10:00:00.000Z' }),
        ],
      }),
    );

    expect(dto.summary.currentPersonalBestsSetThisWeek).toBe(2);
  });

  it('does not count older winners the lookback still returns', () => {
    const dto = toTrainingWeeklyInsightsDto(
      input({
        bests: [
          best({ exerciseId: 'ex-001', value: 60, completedAt: '2026-08-03T10:00:00.000Z' }),
          best({ exerciseId: 'ex-002', value: 24, completedAt: '2026-09-07T10:00:00.000Z' }),
          best({ exerciseId: 'ex-003', value: 40, completedAt: '2026-09-14T10:00:00.000Z' }),
        ],
        exercises: [
          exercise('ex-001', 'Bench Press', 'bench-press'),
          exercise('ex-002', 'Goblet Squat', 'goblet-squat'),
          exercise('ex-003', 'Farmer Carry', 'farmer-carry'),
        ],
      }),
    );

    expect(dto.summary.currentPersonalBestsSetThisWeek).toBe(0);
    // They are still recent winners — the count is what excludes them.
    expect(dto.recentPersonalBests).toHaveLength(3);
  });

  it('counts a this-week winner whose catalog metadata cannot be resolved', () => {
    const dto = toTrainingWeeklyInsightsDto(
      input({
        bests: [
          best({ exerciseId: 'ex-001', value: 60, completedAt: '2026-09-22T10:00:00.000Z' }),
        ],
        exercises: [],
      }),
    );

    expect(dto.summary.currentPersonalBestsSetThisWeek).toBe(1);
    expect(dto.recentPersonalBests).toEqual([]);
  });
});

describe('toTrainingWeeklyInsightsDto — recent personal bests', () => {
  it('orders winners newest first with their catalog identity attached', () => {
    const dto = toTrainingWeeklyInsightsDto(
      input({
        bests: [
          best({ exerciseId: BENCH, value: 60, completedAt: '2026-09-10T10:00:00.000Z' }),
          best({ exerciseId: GOBLET, value: 24, completedAt: '2026-09-22T10:00:00.000Z' }),
        ],
        exercises: [
          exercise(BENCH, 'Bench Press', 'bench-press'),
          exercise(GOBLET, 'Goblet Squat', 'goblet-squat'),
        ],
      }),
    );

    expect(dto.recentPersonalBests).toEqual([
      {
        exerciseId: GOBLET,
        exerciseName: 'Goblet Squat',
        exerciseSlug: 'goblet-squat',
        metric: 'max-load',
        value: 24,
        sessionId: `session-${GOBLET}`,
        completedAt: '2026-09-22T10:00:00.000Z',
      },
      {
        exerciseId: BENCH,
        exerciseName: 'Bench Press',
        exerciseSlug: 'bench-press',
        metric: 'max-load',
        value: 60,
        sessionId: `session-${BENCH}`,
        completedAt: '2026-09-10T10:00:00.000Z',
      },
    ]);
  });

  it('breaks a completedAt tie by the domain ladder, not by input order', () => {
    const sameInstant = '2026-09-22T10:00:00.000Z';
    const catalog = [
      exercise(BENCH, 'Bench Press', 'bench-press'),
      exercise(GOBLET, 'Goblet Squat', 'goblet-squat'),
    ];

    const byStartedAt = toTrainingWeeklyInsightsDto(
      input({
        bests: [
          best({
            exerciseId: GOBLET,
            value: 24,
            completedAt: sameInstant,
            startedAt: '2026-09-22T08:00:00.000Z',
            sessionId: 'session-early',
          }),
          best({
            exerciseId: BENCH,
            value: 60,
            completedAt: sameInstant,
            startedAt: '2026-09-22T09:00:00.000Z',
            sessionId: 'session-late',
          }),
        ],
        exercises: catalog,
      }),
    );
    expect(byStartedAt.recentPersonalBests.map((record) => record.sessionId)).toEqual([
      'session-late',
      'session-early',
    ]);

    const bySessionId = toTrainingWeeklyInsightsDto(
      input({
        bests: [
          best({
            exerciseId: BENCH,
            value: 60,
            completedAt: sameInstant,
            startedAt: '2026-09-22T09:00:00.000Z',
            sessionId: 'session-a',
          }),
          best({
            exerciseId: GOBLET,
            value: 24,
            completedAt: sameInstant,
            startedAt: '2026-09-22T09:00:00.000Z',
            sessionId: 'session-b',
          }),
        ],
        exercises: catalog,
      }),
    );
    // Byte-wise session id descending — the same ladder rung the history reads use.
    expect(bySessionId.recentPersonalBests.map((record) => record.sessionId)).toEqual([
      'session-b',
      'session-a',
    ]);
  });

  it('caps the list at the newest five winners', () => {
    const days = ['2026-09-05', '2026-09-06', '2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10'];
    const bests = days.map((day, index) =>
      best({ exerciseId: `ex-00${index + 1}`, value: 40 + index, completedAt: `${day}T10:00:00.000Z` }),
    );
    const dto = toTrainingWeeklyInsightsDto(
      input({
        bests,
        exercises: days.map((_, index) =>
          exercise(`ex-00${index + 1}`, `Exercise ${index + 1}`, `exercise-${index + 1}`),
        ),
      }),
    );

    expect(RECENT_PERSONAL_BESTS_LIMIT).toBe(5);
    expect(dto.recentPersonalBests).toHaveLength(5);
    // Newest first: the oldest of the six is the one dropped.
    expect(dto.recentPersonalBests.map((record) => record.completedAt)).toEqual([
      '2026-09-10T10:00:00.000Z',
      '2026-09-09T10:00:00.000Z',
      '2026-09-08T10:00:00.000Z',
      '2026-09-07T10:00:00.000Z',
      '2026-09-06T10:00:00.000Z',
    ]);
  });

  it('omits an unresolvable exercise without padding the list or changing the count', () => {
    const dto = toTrainingWeeklyInsightsDto(
      input({
        bests: [
          // This week, and unresolvable: counted, not rendered.
          best({ exerciseId: 'ex-001', value: 60, completedAt: '2026-09-22T10:00:00.000Z' }),
          best({ exerciseId: 'ex-002', value: 24, completedAt: '2026-09-10T10:00:00.000Z' }),
          best({ exerciseId: 'ex-003', value: 40, completedAt: '2026-09-09T10:00:00.000Z' }),
          best({ exerciseId: 'ex-004', value: 30, completedAt: '2026-09-08T10:00:00.000Z' }),
          best({ exerciseId: 'ex-005', value: 20, completedAt: '2026-09-07T10:00:00.000Z' }),
          // The sixth-newest winner: the cap runs before omission, so the list
          // is never padded by reaching past a newer record.
          best({ exerciseId: 'ex-006', value: 15, completedAt: '2026-09-06T10:00:00.000Z' }),
        ],
        exercises: [
          exercise('ex-002', 'Exercise 2', 'exercise-2'),
          exercise('ex-003', 'Exercise 3', 'exercise-3'),
          exercise('ex-004', 'Exercise 4', 'exercise-4'),
          exercise('ex-005', 'Exercise 5', 'exercise-5'),
          exercise('ex-006', 'Exercise 6', 'exercise-6'),
        ],
      }),
    );

    expect(dto.recentPersonalBests.map((record) => record.exerciseId)).toEqual([
      'ex-002',
      'ex-003',
      'ex-004',
      'ex-005',
    ]);
    expect(dto.summary.currentPersonalBestsSetThisWeek).toBe(1);
  });

  it('passes record values through unchanged, including a logged 0 kg', () => {
    const dto = toTrainingWeeklyInsightsDto(
      input({
        bests: [
          // The repository's winner is authoritative: a full-replacement id is
          // never reinterpreted as an authored one here.
          best({
            exerciseId: 'ex-004',
            value: 0,
            metric: RecordMetric.MaxLoad,
            completedAt: '2026-09-22T10:00:00.000Z',
            exerciseOrder: 2,
            setNumber: 3,
          }),
        ],
        exercises: [exercise('ex-004', 'Exercise 4', 'exercise-4')],
      }),
    );

    expect(dto.recentPersonalBests).toHaveLength(1);
    expect(Object.is(dto.recentPersonalBests[0]?.value, 0)).toBe(true);
    expect(dto.recentPersonalBests[0]?.metric).toBe('max-load');
    expect(dto.recentPersonalBests[0]?.exerciseId).toBe('ex-004');
  });

  it('is empty when the record read returned nothing', () => {
    const dto = toTrainingWeeklyInsightsDto(input());

    expect(dto.recentPersonalBests).toEqual([]);
    expect(dto.summary.currentPersonalBestsSetThisWeek).toBe(0);
  });
});

describe('recent personal best selection', () => {
  it('orders newest first along the full domain ladder and does not mutate its input', () => {
    const inputBests = [
      best({ exerciseId: BENCH, value: 60, completedAt: '2026-09-10T10:00:00.000Z' }),
      best({
        exerciseId: GOBLET,
        value: 24,
        completedAt: '2026-09-22T10:00:00.000Z',
        startedAt: '2026-09-22T08:00:00.000Z',
      }),
      best({
        exerciseId: 'ex-003',
        value: 40,
        completedAt: '2026-09-22T10:00:00.000Z',
        startedAt: '2026-09-22T09:00:00.000Z',
      }),
    ];
    const snapshot = inputBests.map((entry) => entry.position.sessionId);

    const ordered = orderCurrentPersonalBestsNewestFirst(inputBests);

    expect(ordered.map((entry) => entry.position.sessionId)).toEqual([
      'session-ex-003',
      `session-${GOBLET}`,
      `session-${BENCH}`,
    ]);
    expect(inputBests.map((entry) => entry.position.sessionId)).toEqual(snapshot);
  });

  it('returns at most the limit, keeping the newest candidates', () => {
    const bests = Array.from({ length: 7 }, (_, index) =>
      best({
        exerciseId: `ex-00${index + 1}`,
        value: 40,
        completedAt: `2026-09-0${index + 1}T10:00:00.000Z`,
      }),
    );

    const candidates = selectRecentPersonalBestCandidates(bests);

    expect(candidates).toHaveLength(RECENT_PERSONAL_BESTS_LIMIT);
    expect(candidates.map((entry) => entry.exerciseId)).toEqual([
      'ex-007',
      'ex-006',
      'ex-005',
      'ex-004',
      'ex-003',
    ]);
  });

  it('returns nothing for an empty record read', () => {
    expect(selectRecentPersonalBestCandidates([])).toEqual([]);
  });
});