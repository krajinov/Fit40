import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CompletedSessionDto } from '@/application/dto/completed-session';

const { detailExecute } = vi.hoisted(() => ({
  detailExecute: vi.fn(),
}));

vi.mock('@/features/history/services', () => ({
  getCompletedSessionUseCase: { execute: detailExecute },
}));

import { toCompletedSessionView } from '@/features/history/completed-session-view';

beforeEach(() => {
  vi.clearAllMocks();
});

function sessionDto(overrides?: {
  readonly startedAt?: string;
  readonly completedAt?: string;
  readonly entries?: CompletedSessionDto['entries'];
  readonly metrics?: CompletedSessionDto['metrics'];
}): CompletedSessionDto {
  return {
    sessionId: 'session-1',
    workoutName: 'Full Body A',
    programName: 'Fit40 Beginner Strength',
    startedAt: overrides?.startedAt ?? '2026-01-01T10:00:00.000Z',
    completedAt: overrides?.completedAt ?? '2026-01-01T10:45:00.000Z',
    entries:
      overrides?.entries ??
      [
        {
          exerciseId: 'ex-001',
          exerciseOrder: 1,
          exerciseName: 'Goblet Squat',
          exerciseSlug: 'goblet-squat',
          equipment: 'kettlebell',
          restSeconds: 90,
          prescription: { type: 'reps', sets: 3, minReps: 8, maxReps: 10 },
          sets: [
            { type: 'reps', setNumber: 1, reps: 10, weightKg: 50, rpe: 7 },
            { type: 'reps', setNumber: 2, reps: 10, weightKg: null, rpe: null },
          ],
        },
      ],
    metrics:
      overrides?.metrics ?? { totalSets: 2, totalReps: 20, totalDurationSeconds: 0, volume: 500 },
  };
}

describe('toCompletedSessionView', () => {
  it('formats set lines truthfully and preserves entry/set order', () => {
    const view = toCompletedSessionView(sessionDto());
    expect(view.entries).toHaveLength(1);
    expect(view.entries[0]?.sets[0]?.valueLabel).toBe('50 kg × 10 @ RPE 7');
    expect(view.entries[0]?.sets[1]?.valueLabel).toBe('10 reps');
    expect(view.entries[0]?.sets.map((set) => set.setNumber)).toEqual([1, 2]);
  });

  it('renders header labels and the joined metrics line', () => {
    const view = toCompletedSessionView(sessionDto());
    expect(view.heading).toBe('Full Body A');
    expect(view.contextLabel).toBe('Fit40 Beginner Strength');
    expect(view.completedAtLabel).toBe('Jan 1, 2026');
    expect(view.elapsedLabel).toBe('45 min');
    expect(view.metricsLineLabel).toBe('2 sets · 20 reps · 500 kg');
  });

  it('omits elapsed time when the completedAt gap is not positive', () => {
    const view = toCompletedSessionView(
      sessionDto({ startedAt: '2026-01-01T10:45:00.000Z', completedAt: '2026-01-01T10:45:00.000Z' }),
    );
    expect(view.elapsedLabel).toBeNull();
  });

  it('renders sub-minute elapsed time truthfully instead of flooring to 0 min', () => {
    const oneSecond = toCompletedSessionView(
      sessionDto({ startedAt: '2026-01-01T10:45:00.000Z', completedAt: '2026-01-01T10:45:01.000Z' }),
    );
    const fiftyNineSeconds = toCompletedSessionView(
      sessionDto({ startedAt: '2026-01-01T10:45:00.000Z', completedAt: '2026-01-01T10:45:59.000Z' }),
    );
    expect(oneSecond.elapsedLabel).toBe('<1 min');
    expect(fiftyNineSeconds.elapsedLabel).toBe('<1 min');
  });

  it('formats a 60-second session as one minute', () => {
    const view = toCompletedSessionView(
      sessionDto({ startedAt: '2026-01-01T10:45:00.000Z', completedAt: '2026-01-01T10:46:00.000Z' }),
    );
    expect(view.elapsedLabel).toBe('1 min');
  });

  it('falls back to positional names and omits unresolved equipment', () => {
    const entries: CompletedSessionDto['entries'] = [
      {
        exerciseId: 'ex-404',
        exerciseOrder: 3,
        exerciseName: null,
        exerciseSlug: null,
        equipment: null,
        restSeconds: 0,
        prescription: { type: 'reps', sets: 2, minReps: 8, maxReps: 10 },
        sets: [],
      },
    ];
    const view = toCompletedSessionView(sessionDto({ entries }));
    expect(view.entries[0]?.name).toBe('Exercise 3');
    expect(view.entries[0]?.equipmentLabel).toBeNull();
    expect(view.entries[0]?.restLabel).toBeNull();
    expect(view.entries[0]?.sets).toEqual([]);
  });

  it('omits zero-value reps and volume from the metrics line', () => {
    const entries: CompletedSessionDto['entries'] = [
      {
        exerciseId: 'ex-015',
        exerciseOrder: 1,
        exerciseName: 'Plank',
        exerciseSlug: 'dead-bug',
        equipment: 'bodyweight',
        restSeconds: 60,
        prescription: { type: 'duration', sets: 3, seconds: 45 },
        sets: [{ type: 'duration', setNumber: 1, durationSeconds: 45, weightKg: null, rpe: null }],
      },
    ];
    const view = toCompletedSessionView(
      sessionDto({ entries, metrics: { totalSets: 1, totalReps: 0, totalDurationSeconds: 45, volume: 0 } }),
    );
    expect(view.metricsLineLabel).toBe('1 set');
  });

  it('links a resolved catalog slug to the exercise history page', () => {
    const view = toCompletedSessionView(sessionDto());
    expect(view.entries[0]?.historyHref).toBe('/history/exercises/goblet-squat');
  });

  it('renders no history link when the slug is missing or malformed', () => {
    const badSlug: CompletedSessionDto['entries'] = [
      {
        exerciseId: 'ex-099',
        exerciseOrder: 1,
        exerciseName: 'Odd Exercise',
        exerciseSlug: 'Not_A_Valid_Slug',
        equipment: null,
        restSeconds: 60,
        prescription: { type: 'reps', sets: 2, minReps: 8, maxReps: 10 },
        sets: [],
      },
    ];
    const noSlugView = toCompletedSessionView(
      sessionDto({ entries: badSlug }),
    );
    expect(noSlugView.entries[0]?.historyHref).toBeNull();

    const unresolved = sessionDto({
      entries: [
        {
          exerciseId: 'ex-404',
          exerciseOrder: 2,
          exerciseName: null,
          exerciseSlug: null,
          equipment: null,
          restSeconds: 60,
          prescription: { type: 'reps', sets: 2, minReps: 8, maxReps: 10 },
          sets: [],
        },
      ],
    });
    const unresolvedView = toCompletedSessionView(unresolved);
    expect(unresolvedView.entries[0]?.historyHref).toBeNull();
  });
});
