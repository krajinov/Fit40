/**
 * Unit tests for the training-history view assembly.
 *
 * `toHistoryView` is tested as a pure mapping over fabricated DTOs; the
 * `buildHistoryView` orchestration runs the real use cases over mocked
 * feature composition roots, mirroring the dashboard-view test approach.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  TrainingHistoryPageDto,
  TrainingHistorySessionDto,
  TrainingTotalsDto,
} from '@/application/dto/training-history';

const { listExecute, totalsExecute } = vi.hoisted(() => ({
  listExecute: vi.fn(),
  totalsExecute: vi.fn(),
}));

vi.mock('@/features/history/services', () => ({
  listTrainingHistoryUseCase: { execute: listExecute },
  getTrainingTotalsUseCase: { execute: totalsExecute },
}));

import {
  buildHistoryView,
  toHistoryView,
} from '@/features/history/history-view';

// The module-level mocks are shared across tests; clear recorded calls so
// per-test call-count assertions stay isolated.
beforeEach(() => {
  vi.clearAllMocks();
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

describe('toHistoryView', () => {
  it('maps one page with truthful labels and preserves DTO order', () => {
    const sessions = [
      sessionDto({ sessionId: 'session-new', workoutName: 'Full Body B', completedAt: '2026-03-01T11:00:00Z' }),
      sessionDto({ sessionId: 'session-old', workoutName: 'Full Body A', completedAt: '2026-02-15T11:00:00Z' }),
    ];
    const view = toHistoryView(pageDto(sessions, 'tok-123'), TOTALS);

    expect(view.sessions.map((s) => s.sessionId)).toEqual(['session-new', 'session-old']);
    expect(view.sessions[0]?.completedAtLabel).toBe('Mar 1, 2026');
    expect(view.sessions[0]?.setsLabel).toBe('18 sets');
    expect(view.sessions[0]?.repsLabel).toBe('126 reps');
    expect(view.sessions[0]?.volumeLabel).toBe('1,240 kg');
    expect(view.sessions[1]?.completedAtLabel).toBe('Feb 15, 2026');
  });

  it('builds the older-page URL from the opaque next cursor', () => {
    const view = toHistoryView(pageDto([], 'tok-123'), TOTALS);
    expect(view.olderPageHref).toBe('/history?cursor=tok-123');
  });

  it('omits pagination when there is no next cursor', () => {
    const view = toHistoryView(pageDto([sessionDto()], null), TOTALS);
    expect(view.olderPageHref).toBeNull();
  });

  it('formats totals as display values', () => {
    const view = toHistoryView(pageDto([], null), TOTALS);
    expect(view.totals).toEqual({ completedWorkouts: '7', loggedSets: '63' });
  });

  it('suppresses zero reps and volume instead of fabricating badges', () => {
    const view = toHistoryView(
      pageDto([
        sessionDto({
          metrics: { totalSets: 1, totalReps: 0, totalDurationSeconds: 30, volume: 0 },
        }),
      ]),
      { completedSessions: 0, loggedSets: 0 },
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
    );
    expect(view.sessions[0]?.workoutName).toBe(longName);
    expect(view.sessions[0]?.programName).toBe(longName);
  });
});
describe('buildHistoryView', () => {
  it('orchestrates both use cases and returns the assembled view', async () => {
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
    expect(listExecute).toHaveBeenCalledWith({ userId: 'user-a', cursor: null });
    expect(totalsExecute).toHaveBeenCalledWith('user-a');
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
  });
});

