/**
 * Contract tests for reschedulePlannedWorkoutAction (M15 Slice 7).
 *
 * Pinned: the user id comes from the trusted session, the schedule clock is
 * created server-side, the planned workout is addressed ONLY by authored public
 * coordinates (slug + week + order) and the canonical date string — no
 * enrollment id, database id or session id is accepted or forwarded —
 * validation failures are truthful typed states, every expected application
 * error is mapped as data, unexpected errors propagate, and a successful move
 * revalidates exactly the program detail and the dashboard.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { requireUserMock, redirectMock } = vi.hoisted(() => ({
  requireUserMock: vi.fn(),
  redirectMock: vi.fn((target: string) => {
    const error = new Error(`NEXT_REDIRECT:${target}`);
    error.name = 'NEXT_REDIRECT';
    throw error;
  }),
}));

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

vi.mock('@/features/auth/current-user', () => ({ requireUser: requireUserMock }));

vi.mock('@/features/schedule/services', () => ({
  reschedulePlannedWorkoutUseCase: { execute: vi.fn() },
}));

import { revalidatePath } from 'next/cache';

import type { ReschedulePlannedWorkoutError } from '@/application/use-cases/reschedule-planned-workout';
import { reschedulePlannedWorkoutAction } from '@/features/schedule/actions/reschedule-planned-workout';
import { reschedulePlannedWorkoutUseCase } from '@/features/schedule/services';

const SESSION_USER = {
  id: '11111111-1111-1111-1111-111111111111',
  email: 'user@example.com',
  createdAt: '2026-01-01T00:00:00.000Z',
};

const PROGRAM_PATH = '/programs/fit40-beginner-strength';

function submit(
  overrides: Readonly<Record<string, string>> = {},
  extras: ReadonlyArray<readonly [string, string]> = [],
): FormData {
  const fields: Record<string, string> = {
    programSlug: 'fit40-beginner-strength',
    weekNumber: '2',
    workoutOrder: '3',
    date: '2026-09-30',
    ...overrides,
  };
  const fd = new FormData();
  for (const [name, value] of Object.entries(fields)) {
    fd.set(name, value);
  }
  for (const [name, value] of extras) {
    fd.set(name, value);
  }
  return fd;
}

function executedInput(): Record<string, unknown> {
  const call = vi.mocked(reschedulePlannedWorkoutUseCase.execute).mock.calls.at(0);
  if (call === undefined) throw new Error('use case was not called');
  return call[0] as unknown as Record<string, unknown>;
}

describe('reschedulePlannedWorkoutAction', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    requireUserMock.mockResolvedValue(SESSION_USER);
    vi.mocked(reschedulePlannedWorkoutUseCase.execute).mockResolvedValue({
      ok: true,
      data: undefined,
    });
  });

  it('redirects unauthenticated users without touching the use case', async () => {
    requireUserMock.mockImplementation(() =>
      redirectMock(`/login?next=${encodeURIComponent(PROGRAM_PATH)}`),
    );

    await expect(reschedulePlannedWorkoutAction(submit())).rejects.toThrow('NEXT_REDIRECT');

    expect(reschedulePlannedWorkoutUseCase.execute).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('rejects malformed coordinates without calling the use case', async () => {
    const coordinateFailures: ReadonlyArray<Readonly<Record<string, string>>> = [
      { weekNumber: '0' },
      { weekNumber: 'abc' },
      { workoutOrder: '' },
    ];

    for (const overrides of coordinateFailures) {
      vi.mocked(reschedulePlannedWorkoutUseCase.execute).mockClear();

      const state = await reschedulePlannedWorkoutAction(submit(overrides));

      expect(state).toEqual({
        ok: false,
        error: { code: 'VALIDATION_ERROR', message: 'Invalid move request.' },
      });
      expect(reschedulePlannedWorkoutUseCase.execute).not.toHaveBeenCalled();
    }
  });

  it('rejects a non-canonical date at the presentation boundary', async () => {
    for (const date of ['30/09/2026', '2026-9-30', '']) {
      vi.mocked(reschedulePlannedWorkoutUseCase.execute).mockClear();

      const state = await reschedulePlannedWorkoutAction(submit({ date }));

      expect(state).toEqual({
        ok: false,
        error: { code: 'VALIDATION_ERROR', message: 'Enter a valid date.' },
      });
      expect(reschedulePlannedWorkoutUseCase.execute).not.toHaveBeenCalled();
    }
  });

  it('passes the trusted user id, the authored coordinates and a server-owned clock', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-09-23T08:15:00.000Z'));

      await reschedulePlannedWorkoutAction(
        submit({}, [
          ['userId', 'attacker-supplied-id'],
          ['now', '1999-01-01T00:00:00.000Z'],
          ['enrollmentId', 'enr-attacker'],
          ['scheduledWorkoutId', 'sw-attacker'],
          ['sessionId', 's-attacker'],
        ]),
      );
    } finally {
      vi.useRealTimers();
    }

    const input = executedInput();
    expect(input).toMatchObject({
      userId: SESSION_USER.id,
      programSlug: 'fit40-beginner-strength',
      weekNumber: 2,
      workoutOrder: 3,
      date: '2026-09-30',
    });
    expect(input.now).toBeInstanceOf(Date);
    expect((input.now as Date).toISOString()).toBe('2026-09-23T08:15:00.000Z');
    // Exactly the public/trusted inputs cross the boundary: no enrollment id,
    // no database scheduled-workout id, no session id, nothing from the browser.
    expect(Object.keys(input).sort()).toEqual([
      'date',
      'now',
      'programSlug',
      'userId',
      'weekNumber',
      'workoutOrder',
    ]);
  });

  it('revalidates the program detail and the dashboard on success, nothing else', async () => {
    const state = await reschedulePlannedWorkoutAction(submit());

    expect(state).toEqual({ ok: true });
    expect(revalidatePath).toHaveBeenCalledTimes(2);
    expect(revalidatePath).toHaveBeenCalledWith(PROGRAM_PATH);
    expect(revalidatePath).toHaveBeenCalledWith('/dashboard');
  });

  it('maps every expected application error truthfully, without revalidating', async () => {
    const slug = 'fit40-beginner-strength';
    const cases: ReadonlyArray<ReschedulePlannedWorkoutError> = [
      { code: 'PROGRAM_NOT_FOUND', slug, message: `Program "${slug}" not found` },
      { code: 'NOT_ENROLLED', programSlug: slug, message: 'You are not enrolled in this program.' },
      {
        code: 'SCHEDULED_WORKOUT_NOT_FOUND',
        programSlug: slug,
        weekNumber: 2,
        workoutOrder: 3,
        message: 'Scheduled workout not found for week 2, order 3',
      },
      {
        code: 'SCHEDULE_NOT_CONFIGURED',
        programSlug: slug,
        message: 'This program run has no training schedule yet.',
      },
      {
        code: 'PLANNED_WORKOUT_NOT_FOUND',
        programSlug: slug,
        scheduledWorkoutId: 'sw-1',
        message: 'This workout is not part of your current schedule.',
      },
      { code: 'INVALID_DATE', value: '2026-02-30', message: 'PlannedDate must be a calendar date in YYYY-MM-DD form' },
      {
        code: 'DATE_IN_PAST',
        programSlug: slug,
        date: '2026-09-20',
        today: '2026-09-23',
        message: 'A planned workout cannot be moved into the past.',
      },
      {
        code: 'WORKOUT_ALREADY_COMPLETED',
        programSlug: slug,
        scheduledWorkoutId: 'sw-1',
        message: 'This workout is already completed and cannot be rescheduled.',
      },
      {
        code: 'SESSION_IN_PROGRESS',
        programSlug: slug,
        scheduledWorkoutId: 'sw-1',
        message: 'This workout has a session in progress and cannot be rescheduled.',
      },
      {
        code: 'DATE_ALREADY_PLANNED',
        programSlug: slug,
        date: '2026-09-30',
        message: 'Another planned workout is already scheduled for 2026-09-30.',
      },
      {
        code: 'SCHEDULE_CHANGED',
        programSlug: slug,
        message: 'Your training schedule changed while saving. Please reload and try again.',
      },
    ];

    for (const error of cases) {
      vi.mocked(reschedulePlannedWorkoutUseCase.execute).mockClear();
      vi.mocked(revalidatePath).mockClear();
      vi.mocked(reschedulePlannedWorkoutUseCase.execute).mockResolvedValue({ ok: false, error });

      const state = await reschedulePlannedWorkoutAction(submit());

      // The action forwards the code and the user-facing message only.
      expect(state).toEqual({ ok: false, error: { code: error.code, message: error.message } });
      expect(revalidatePath).not.toHaveBeenCalled();
    }
  });

  it('lets unexpected errors propagate instead of converting them to validation state', async () => {
    vi.mocked(reschedulePlannedWorkoutUseCase.execute).mockRejectedValue(
      new Error('connection terminated unexpectedly'),
    );

    await expect(reschedulePlannedWorkoutAction(submit())).rejects.toThrow(
      'connection terminated unexpectedly',
    );
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});