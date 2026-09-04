/**
 * Unit tests for the per-exercise history view assembly.
 *
 * `toExerciseHistoryView` is tested as a pure mapping over fabricated
 * DTOs; `buildExerciseHistoryView` runs the real use case over a mocked
 * feature composition root, mirroring the history-view test approach.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ExerciseHistoryDto } from '@/application/dto/exercise-history';
import { EXERCISE_HISTORY_OCCURRENCE_LIMIT } from '@/application/dto/exercise-history';

const { historyExecute } = vi.hoisted(() => ({
  historyExecute: vi.fn(),
}));

vi.mock('@/features/history/services', () => ({
  getExerciseHistoryUseCase: { execute: historyExecute },
}));

import {
  buildExerciseHistoryView,
  toExerciseHistoryView,
} from '@/features/history/exercise-history-view';

beforeEach(() => {
  vi.clearAllMocks();
});

function historyDto(overrides?: Partial<ExerciseHistoryDto>): ExerciseHistoryDto {
  return {
    exercise: {
      id: 'ex-001',
      name: 'Goblet Squat',
      slug: 'goblet-squat',
      equipment: 'kettlebell',
    },
    entries: [
      {
        sessionId: 'session-new',
        exerciseOrder: 1,
        completedAt: '2026-02-15T11:00:00Z',
        programName: 'Fit40 Beginner Strength',
        workoutName: 'Full Body A',
        prescription: { type: 'reps', sets: 3, minReps: 8, maxReps: 10 },
        sets: [
          { type: 'reps', setNumber: 1, reps: 10, weightKg: 52.5, rpe: 8 },
          { type: 'reps', setNumber: 2, reps: 10, weightKg: null, rpe: null },
        ],
        workingLoadKg: null,
      },
    ],
    trend: [
      {
        sessionId: 'session-trend',
        exerciseOrder: 1,
        completedAt: '2026-01-15T11:00:00Z',
        workingLoadKg: 50,
      },
    ],
    isLimited: false,
    ...overrides,
  };
}

/** 50 occurrence stubs — the full bounded read, for the capped-label case. */
const limitedEntries: ExerciseHistoryDto['entries'] = Array.from(
  { length: EXERCISE_HISTORY_OCCURRENCE_LIMIT },
  (_, i) => ({
    sessionId: `session-${i}`,
    exerciseOrder: 1,
    completedAt: '2026-02-15T11:00:00Z',
    programName: 'Fit40 Beginner Strength',
    workoutName: 'Full Body A',
    prescription: { type: 'reps', sets: 3, minReps: 8, maxReps: 10 } as const,
    sets: [
      { type: 'reps', setNumber: 1, reps: 10, weightKg: 52.5, rpe: 8 },
    ],
    workingLoadKg: 52.5,
  }),
);

describe('toExerciseHistoryView', () => {
  it('formats the header, occurrence count, and entry labels truthfully', () => {
    const view = toExerciseHistoryView(historyDto());
    expect(view.heading).toBe('Goblet Squat');
    expect(view.equipmentLabel).toBe('Kettlebell');
    expect(view.occurrenceCountLabel).toBe('1 occurrence');
    expect(view.entries[0]?.completedAtLabel).toBe('Feb 15, 2026');
    expect(view.entries[0]?.programName).toBe('Fit40 Beginner Strength');
    expect(view.entries[0]?.workoutName).toBe('Full Body A');
    expect(view.entries[0]?.prescriptionLabel).toBe('3 × 8–10');
    // A bodyweight set in the occurrence means no truthful single load.
    expect(view.entries[0]?.workingLoadLabel).toBeNull();
  });

  it('formats set lines with the persisted snapshot and RPE only when captured', () => {
    const view = toExerciseHistoryView(historyDto());
    expect(view.entries[0]?.setLines).toEqual(['52.5 kg × 10 @ RPE 8', '10 reps']);
  });

  it('links each occurrence to its owning session by occurrence identity', () => {
    const view = toExerciseHistoryView(historyDto());
    expect(view.entries[0]?.sessionHref).toBe('/history/sessions/session-new');
    expect(view.entries[0]?.key).toBe('session-new#1');
  });

  it('labels the working load when a truthful external load exists', () => {
    const dto = historyDto();
    const first = dto.entries[0];
    if (first === undefined) throw new Error('fixture entry missing');
    const loaded: ExerciseHistoryDto = {
      ...dto,
      entries: [{ ...first, workingLoadKg: 52.5 }],
    };
    const view = toExerciseHistoryView(loaded);
    expect(view.entries[0]?.workingLoadLabel).toBe('Working load 52.5 kg');
  });
});

describe('toExerciseHistoryView — duplicates and empty states', () => {
  it('keeps two occurrences of one exercise as two entries (never collapsed)', () => {
    const dto = historyDto({
      entries: [
        {
          sessionId: 'session-1',
          exerciseOrder: 1,
          completedAt: '2026-02-15T11:00:00Z',
          programName: 'P',
          workoutName: 'W',
          prescription: { type: 'reps', sets: 3, minReps: 8, maxReps: 10 },
          sets: [{ type: 'reps', setNumber: 1, reps: 10, weightKg: 50, rpe: null }],
          workingLoadKg: 50,
        },
        {
          sessionId: 'session-1',
          exerciseOrder: 2,
          completedAt: '2026-02-15T11:00:00Z',
          programName: 'P',
          workoutName: 'W',
          prescription: { type: 'reps', sets: 3, minReps: 8, maxReps: 10 },
          sets: [{ type: 'reps', setNumber: 1, reps: 12, weightKg: null, rpe: null }],
          workingLoadKg: null,
        },
      ],
    });

    const view = toExerciseHistoryView(dto);
    expect(view.entries).toHaveLength(2);
    expect(view.entries.map((entry) => entry.key)).toEqual(['session-1#1', 'session-1#2']);
    expect(view.occurrenceCountLabel).toBe('2 occurrences');
  });

  it('omits the trend entirely when there are no entries', () => {
    const view = toExerciseHistoryView(historyDto({ entries: [], trend: [] }));
    expect(view.trend).toBeNull();
  });

  it('flags a no-external-load history instead of fabricating a chart', () => {
    const view = toExerciseHistoryView(
      historyDto({
        entries: [
          {
            sessionId: 'session-bw',
            exerciseOrder: 1,
            completedAt: '2026-02-15T11:00:00Z',
            programName: 'P',
            workoutName: 'W',
            prescription: { type: 'reps', sets: 3, minReps: 8, maxReps: 10 },
            sets: [{ type: 'reps', setNumber: 1, reps: 10, weightKg: null, rpe: null }],
            workingLoadKg: null,
          },
        ],
        trend: [],
      }),
    );

    expect(view.trend).not.toBeNull();
    expect(view.trend?.noExternalLoad).toBe(true);
    expect(view.trend?.chartPoints).toBeNull();
    expect(view.trend?.textPoints).toEqual([]);
  });

  it('suppresses the chart below two points but keeps the honest text point', () => {
    const view = toExerciseHistoryView(historyDto());
    expect(view.trend?.chartPoints).toBeNull();
    expect(view.trend?.textPoints).toEqual([
      { key: 'session-trend#1', completedAtLabel: 'Jan 15, 2026', loadLabel: '50 kg' },
    ]);
  });
});

describe('toExerciseHistoryView — chart geometry', () => {
  it('maps chronological chart geometry for three points with padding', () => {
    const dto = historyDto({
      trend: [
        {
          sessionId: 'session-geo-1',
          exerciseOrder: 1,
          completedAt: '2026-01-01T11:00:00Z',
          workingLoadKg: 40,
        },
        {
          sessionId: 'session-geo-2',
          exerciseOrder: 1,
          completedAt: '2026-02-01T11:00:00Z',
          workingLoadKg: 50,
        },
        {
          sessionId: 'session-geo-3',
          exerciseOrder: 1,
          completedAt: '2026-03-01T11:00:00Z',
          workingLoadKg: 45,
        },
      ],
    });

    const view = toExerciseHistoryView(dto);
    const points = view.trend?.chartPoints;
    expect(points).not.toBeNull();
    if (points === null || points === undefined) return;
    expect(points).toHaveLength(3);
    // Points are already viewBox units (12–88 padding band in a 100×100
    // space) — the component renders them unchanged, never re-scales.
    expect(points[0]?.x).toBe(12);
    expect(points[1]?.x).toBe(50);
    expect(points[2]?.x).toBe(88);
    // min 40 → bottom (88), max 50 → top (12), mid 45 → center (50).
    expect(points[0]?.y).toBe(88);
    expect(points[1]?.y).toBe(12);
    expect(points[2]?.y).toBe(50);
    expect(points[1]?.loadLabel).toBe('50 kg');
  });

  it('renders a flat load history as a horizontal line (never fabricated slope)', () => {
    const dto = historyDto({
      trend: [
        {
          sessionId: 'session-flat-1',
          exerciseOrder: 1,
          completedAt: '2026-01-01T11:00:00Z',
          workingLoadKg: 50,
        },
        {
          sessionId: 'session-flat-2',
          exerciseOrder: 1,
          completedAt: '2026-02-01T11:00:00Z',
          workingLoadKg: 50,
        },
      ],
    });

    const view = toExerciseHistoryView(dto);
    const points = view.trend?.chartPoints;
    expect(points).not.toBeNull();
    if (points === null || points === undefined) return;
    expect(points[0]?.y).toBe(50);
    expect(points[1]?.y).toBe(50);
  });
});

describe('toExerciseHistoryView — occurrence count label', () => {
  it('labels a full bounded read as the latest N occurrences, not a total', () => {
    const dto = historyDto({ isLimited: true, entries: limitedEntries });

    const view = toExerciseHistoryView(dto);
    expect(view.occurrenceCountLabel).toBe('Latest 50 occurrences');
  });

  it('keeps the exact-count wording below the bound', () => {
    const dto = historyDto({ isLimited: false });

    const view = toExerciseHistoryView(dto);
    expect(view.occurrenceCountLabel).toBe('1 occurrence');
  });
});

describe('buildExerciseHistoryView', () => {
  it('orchestrates the use case and returns the assembled view', async () => {
    historyExecute.mockResolvedValue({ ok: true, data: historyDto() });

    const result = await buildExerciseHistoryView('user-a', 'goblet-squat');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.heading).toBe('Goblet Squat');
    expect(historyExecute).toHaveBeenCalledWith({ userId: 'user-a', slug: 'goblet-squat' });
  });

  it('propagates EXERCISE_NOT_FOUND for an unknown slug', async () => {
    historyExecute.mockResolvedValue({
      ok: false,
      error: { code: 'EXERCISE_NOT_FOUND', slug: 'nope', message: 'Exercise "nope" not found' },
    });

    const result = await buildExerciseHistoryView('user-a', 'nope');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('EXERCISE_NOT_FOUND');
  });

  it('propagates INVALID_INPUT for a malformed userId', async () => {
    historyExecute.mockResolvedValue({
      ok: false,
      error: { code: 'INVALID_INPUT', message: 'UserId cannot be empty', field: 'userId' },
    });

    const result = await buildExerciseHistoryView('', 'goblet-squat');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('INVALID_INPUT');
  });
});


