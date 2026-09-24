/**
 * Unit tests for the training-history view assembly.
 *
 * `toHistoryView` is tested as a pure mapping over fabricated DTOs; the
 * `buildHistoryView` orchestration runs the real use cases over mocked
 * feature composition roots, mirroring the dashboard-view test approach.
 *
 * The "recently trained exercises" shortcuts are covered here as well: the
 * selection is pure (page DTOs in, ids out) and the orchestration proves one
 * batched catalog lookup over exactly the selected ids.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ExerciseSummaryDto } from '@/application/dto/exercise';
import type {
  TrainingHistoryPageDto,
  TrainingHistorySessionDto,
  TrainingTotalsDto,
} from '@/application/dto/training-history';

const { listExecute, totalsExecute, exercisesExecute } = vi.hoisted(() => ({
  listExecute: vi.fn(),
  totalsExecute: vi.fn(),
  exercisesExecute: vi.fn(),
}));

vi.mock('@/features/history/services', () => ({
  listTrainingHistoryUseCase: { execute: listExecute },
  getTrainingTotalsUseCase: { execute: totalsExecute },
  getExercisesByIdsUseCase: { execute: exercisesExecute },
}));

import {
  MAX_HISTORY_EXERCISE_SHORTCUTS,
  buildHistoryView,
  selectRecentlyTrainedExerciseIds,
  toHistoryView,
} from '@/features/history/history-view';

// The module-level mocks are shared across tests; clear recorded calls so
// per-test call-count assertions stay isolated. A page with no exercise logs
// needs no catalog resolution, and most fixtures are exactly that.
beforeEach(() => {
  vi.clearAllMocks();
  exercisesExecute.mockResolvedValue({ ok: true, data: [] });
});

function sessionDto(overrides: Partial<TrainingHistorySessionDto> = {}): TrainingHistorySessionDto {
  return {
    sessionId: 'session-1',
    scheduledWorkoutId: 'sw-1',
    workoutId: 'wo-1',
    workoutName: 'Full Body A',
    programName: 'Fit40 Beginner Strength',
    startedAt: '2026-02-15T10:00:00Z',
    completedAt: '2026-02-15T11:00:00Z',
    exerciseLogs: [],
    metrics: { totalSets: 18, totalReps: 126, totalDurationSeconds: 0, volume: 1240 },
    ...overrides,
  };
}

function pageDto(
  sessions: ReadonlyArray<TrainingHistorySessionDto>,
  nextCursor: string | null = null,
): TrainingHistoryPageDto {
  return { sessions, nextCursor };
}

const TOTALS: TrainingTotalsDto = { completedSessions: 7, loggedSets: 63 };

/** One persisted occurrence of a page session, minimal but complete. */
function exerciseLog(
  performedExerciseId: string,
  overrides: Partial<TrainingHistorySessionDto['exerciseLogs'][number]> = {},
): TrainingHistorySessionDto['exerciseLogs'][number] {
  return {
    authoredExerciseId: performedExerciseId,
    performedExerciseId,
    isSubstituted: false,
    isSkipped: false,
    occurrenceKey: 1,
    source: 'template',
    substitutionEligibility: { blockedBy: null, canRestore: false },
    removalEligibility: { canRemove: false, blockedBy: 'template-authored' },
    adjustmentEligibility: {
      isSkipped: false,
      blockedBy: null,
      canSkip: true,
      canUnskip: false,
      canMoveUp: true,
      canMoveDown: true,
    },
    order: 1,
    prescription: { type: 'reps', sets: 3, minReps: 8, maxReps: 10 },
    sets: [],
    ...overrides,
  };
}

function exerciseSummary(id: string): ExerciseSummaryDto {
  return {
    id,
    name: `Exercise ${id}`,
    slug: id,
    primaryMuscle: 'quadriceps',
    equipment: 'barbell',
    difficulty: 'beginner',
    movementPattern: 'squat',
  };
}

describe('toHistoryView', () => {
  it('maps one page with truthful labels and preserves DTO order', () => {
    const sessions = [
      sessionDto({ sessionId: 'session-new', workoutName: 'Full Body B', completedAt: '2026-03-01T11:00:00Z' }),
      sessionDto({ sessionId: 'session-old', workoutName: 'Full Body A', completedAt: '2026-02-15T11:00:00Z' }),
    ];
    const view = toHistoryView(pageDto(sessions, 'tok-123'), TOTALS, []);

    expect(view.sessions.map((s) => s.sessionId)).toEqual(['session-new', 'session-old']);
    expect(view.sessions[0]?.completedAtLabel).toBe('Mar 1, 2026');
    expect(view.sessions[0]?.setsLabel).toBe('18 sets');
    expect(view.sessions[0]?.repsLabel).toBe('126 reps');
    expect(view.sessions[0]?.volumeLabel).toBe('1,240 kg');
    expect(view.sessions[1]?.completedAtLabel).toBe('Feb 15, 2026');
  });

  it('builds the older-page URL from the opaque next cursor', () => {
    const view = toHistoryView(pageDto([], 'tok-123'), TOTALS, []);
    expect(view.olderPageHref).toBe('/history?cursor=tok-123');
  });

  it('omits pagination when there is no next cursor', () => {
    const view = toHistoryView(pageDto([sessionDto()], null), TOTALS, []);
    expect(view.olderPageHref).toBeNull();
  });

  it('formats totals as display values', () => {
    const view = toHistoryView(pageDto([], null), TOTALS, []);
    expect(view.totals).toEqual({ completedWorkouts: '7', loggedSets: '63' });
    expect(view.exerciseShortcuts).toEqual([]);
  });

  it('suppresses zero reps and volume instead of fabricating badges', () => {
    const view = toHistoryView(
      pageDto([
        sessionDto({
          metrics: { totalSets: 1, totalReps: 0, totalDurationSeconds: 30, volume: 0 },
        }),
      ]),
      { completedSessions: 0, loggedSets: 0 },
      [],
    );

    const session = view.sessions[0];
    expect(session?.setsLabel).toBe('1 set');
    expect(session?.repsLabel).toBeNull();
    expect(session?.volumeLabel).toBeNull();
    // Timed work is never presented as a workout duration.
    expect(Object.keys(session ?? {})).not.toContain('durationLabel');
  });

  it('carries long workout and program names untruncated', () => {
    const longName = 'Full Body'.repeat(30);
    const view = toHistoryView(
      pageDto([sessionDto({ workoutName: longName, programName: longName })], null),
      TOTALS,
      [],
    );
    expect(view.sessions[0]?.workoutName).toBe(longName);
    expect(view.sessions[0]?.programName).toBe(longName);
  });
});
describe('buildHistoryView', () => {
  it('orchestrates the reads and returns the assembled view', async () => {
    listExecute.mockResolvedValue({
      ok: true,
      data: pageDto([sessionDto()], 'tok-next'),
    });
    totalsExecute.mockResolvedValue({ ok: true, data: TOTALS });

    const result = await buildHistoryView('user-a', null);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.sessions).toHaveLength(1);
    expect(result.data.totals).toEqual({ completedWorkouts: '7', loggedSets: '63' });
    expect(result.data.olderPageHref).toBe('/history?cursor=tok-next');
    expect(result.data.exerciseShortcuts).toEqual([]);
    expect(listExecute).toHaveBeenCalledWith({ userId: 'user-a', cursor: null });
    expect(totalsExecute).toHaveBeenCalledWith('user-a');
    // A page without logged exercises resolves no shortcuts — and the lookup
    // is still exactly one batched call.
    expect(exercisesExecute).toHaveBeenCalledTimes(1);
    expect(exercisesExecute).toHaveBeenCalledWith({ exerciseIds: [] });
  });

  it('forwards the requested cursor to the list use case', async () => {
    listExecute.mockResolvedValue({ ok: true, data: pageDto([]) });
    totalsExecute.mockResolvedValue({ ok: true, data: TOTALS });

    await buildHistoryView('user-a', 'tok-123');

    expect(listExecute).toHaveBeenCalledWith({ userId: 'user-a', cursor: 'tok-123' });
  });

  it('propagates INVALID_INPUT from a tampered cursor', async () => {
    listExecute.mockResolvedValue({
      ok: false,
      error: { code: 'INVALID_INPUT', message: 'bad cursor', field: 'cursor' },
    });

    const result = await buildHistoryView('user-a', 'tampered');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('INVALID_INPUT');
    expect(result.error.message).toBe('bad cursor');
    expect(totalsExecute).not.toHaveBeenCalled();
    expect(exercisesExecute).not.toHaveBeenCalled();
  });

  it('propagates totals failures', async () => {
    listExecute.mockResolvedValue({ ok: true, data: pageDto([]) });
    totalsExecute.mockResolvedValue({
      ok: false,
      error: { code: 'INVALID_INPUT', message: 'bad userId', field: 'userId' },
    });

    const result = await buildHistoryView('', null);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('INVALID_INPUT');
    expect(exercisesExecute).not.toHaveBeenCalled();
  });

  it('renders the zero state view truthfully (empty page, zero totals)', async () => {
    listExecute.mockResolvedValue({ ok: true, data: pageDto([]) });
    totalsExecute.mockResolvedValue({ ok: true, data: { completedSessions: 0, loggedSets: 0 } });

    const result = await buildHistoryView('user-a', null);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.sessions).toEqual([]);
    expect(result.data.totals).toEqual({ completedWorkouts: '0', loggedSets: '0' });
    expect(result.data.olderPageHref).toBeNull();
    expect(result.data.exerciseShortcuts).toEqual([]);
  });
});

// ─── Recently trained exercise shortcuts ─────────────────────────────────────

describe('selectRecentlyTrainedExerciseIds', () => {
  it('returns distinct performed exercises in newest-first first-appearance order', () => {
    const sessions = [
      sessionDto({ exerciseLogs: [exerciseLog('ex-squat'), exerciseLog('ex-bench')] }),
      sessionDto({
        sessionId: 'session-old',
        exerciseLogs: [exerciseLog('ex-bench'), exerciseLog('ex-row')],
      }),
    ];

    expect(selectRecentlyTrainedExerciseIds(sessions)).toEqual([
      'ex-squat',
      'ex-bench',
      'ex-row',
    ]);
  });

  it('excludes skipped occurrences without hiding the exercise', () => {
    const sessions = [
      sessionDto({
        exerciseLogs: [exerciseLog('ex-squat', { isSkipped: true }), exerciseLog('ex-bench')],
      }),
      // The same exercise really was trained earlier, so it still qualifies.
      sessionDto({
        sessionId: 'session-old',
        exerciseLogs: [exerciseLog('ex-squat')],
      }),
    ];

    expect(selectRecentlyTrainedExerciseIds(sessions)).toEqual(['ex-bench', 'ex-squat']);
  });

  it('caps the selection at the shortcut limit', () => {
    const logs = Array.from({ length: MAX_HISTORY_EXERCISE_SHORTCUTS + 3 }, (_value, index) =>
      exerciseLog(`ex-${index}`),
    );

    const selected = selectRecentlyTrainedExerciseIds([sessionDto({ exerciseLogs: logs })]);

    expect(selected).toHaveLength(MAX_HISTORY_EXERCISE_SHORTCUTS);
    expect(selected[0]).toBe('ex-0');
    expect(selected).not.toContain(`ex-${MAX_HISTORY_EXERCISE_SHORTCUTS}`);
  });

  it('returns nothing for a page with no recorded exercises', () => {
    expect(selectRecentlyTrainedExerciseIds([])).toEqual([]);
    expect(selectRecentlyTrainedExerciseIds([sessionDto()])).toEqual([]);
  });
});

describe('toHistoryView exercise shortcuts', () => {
  it('resolves names and history links in newest-trained-first order', () => {
    const view = toHistoryView(
      pageDto([
        sessionDto({ exerciseLogs: [exerciseLog('ex-squat'), exerciseLog('ex-bench')] }),
      ]),
      TOTALS,
      [exerciseSummary('ex-bench'), exerciseSummary('ex-squat')],
    );

    expect(view.exerciseShortcuts).toEqual([
      { exerciseId: 'ex-squat', name: 'Exercise ex-squat', href: '/history/exercises/ex-squat' },
      { exerciseId: 'ex-bench', name: 'Exercise ex-bench', href: '/history/exercises/ex-bench' },
    ]);
  });

  it('omits an id the catalog no longer resolves instead of fabricating an entry', () => {
    const view = toHistoryView(
      pageDto([sessionDto({ exerciseLogs: [exerciseLog('ex-gone'), exerciseLog('ex-bench')] })]),
      TOTALS,
      [exerciseSummary('ex-bench')],
    );

    expect(view.exerciseShortcuts.map((shortcut) => shortcut.exerciseId)).toEqual(['ex-bench']);
  });

  it('renders only the exercises that were selected from the page', () => {
    const view = toHistoryView(
      pageDto([sessionDto({ exerciseLogs: [exerciseLog('ex-bench')] })]),
      TOTALS,
      [exerciseSummary('ex-unrelated'), exerciseSummary('ex-bench')],
    );

    expect(view.exerciseShortcuts.map((shortcut) => shortcut.exerciseId)).toEqual(['ex-bench']);
  });
});

describe('buildHistoryView exercise shortcuts', () => {
  it('resolves exactly the selected ids in one batched lookup', async () => {
    listExecute.mockResolvedValue({
      ok: true,
      data: pageDto([
        sessionDto({ exerciseLogs: [exerciseLog('ex-squat'), exerciseLog('ex-bench')] }),
      ]),
    });
    totalsExecute.mockResolvedValue({ ok: true, data: TOTALS });
    exercisesExecute.mockResolvedValue({
      ok: true,
      data: [exerciseSummary('ex-bench'), exerciseSummary('ex-squat')],
    });

    const result = await buildHistoryView('user-a', null);

    expect(exercisesExecute).toHaveBeenCalledTimes(1);
    expect(exercisesExecute).toHaveBeenCalledWith({ exerciseIds: ['ex-squat', 'ex-bench'] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Catalog order never leaks: the shortcuts follow the trained order.
    expect(result.data.exerciseShortcuts.map((shortcut) => shortcut.exerciseId)).toEqual([
      'ex-squat',
      'ex-bench',
    ]);
  });

  it('propagates a catalog lookup failure instead of hiding it behind an empty row', async () => {
    listExecute.mockResolvedValue({
      ok: true,
      data: pageDto([sessionDto({ exerciseLogs: [exerciseLog('ex-squat')] })]),
    });
    totalsExecute.mockResolvedValue({ ok: true, data: TOTALS });
    exercisesExecute.mockResolvedValue({
      ok: false,
      error: { code: 'INVALID_INPUT', message: 'bad exercise id', field: 'exerciseIds[0]' },
    });

    const result = await buildHistoryView('user-a', null);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('INVALID_INPUT');
    expect(result.error.message).toBe('bad exercise id');
  });
});

