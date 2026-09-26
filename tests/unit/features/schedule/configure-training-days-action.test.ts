/**
 * Contract tests for configureTrainingDaysAction (M15 Slice 7).
 *
 * Pinned: the trusted session is the only source of the user id, the schedule
 * clock is created server-side (never accepted from form data), validation
 * failures are truthful typed states that never reach the use case, expected
 * application errors are returned as data, unexpected errors propagate, and a
 * successful save revalidates exactly the program detail and the dashboard —
 * no completed-truth route.
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
  configureTrainingDaysUseCase: { execute: vi.fn() },
}));

import { revalidatePath } from 'next/cache';

import { configureTrainingDaysAction } from '@/features/schedule/actions/configure-training-days';
import { configureTrainingDaysUseCase } from '@/features/schedule/services';

const SESSION_USER = {
  id: '11111111-1111-1111-1111-111111111111',
  email: 'user@example.com',
  createdAt: '2026-01-01T00:00:00.000Z',
};

const PROGRAM_PATH = '/programs/fit40-beginner-strength';

function submit(
  weekdays: ReadonlyArray<string>,
  extras: ReadonlyArray<readonly [string, string]> = [],
): FormData {
  const fd = new FormData();
  fd.set('programSlug', 'fit40-beginner-strength');
  for (const weekday of weekdays) {
    fd.append('weekday', weekday);
  }
  for (const [name, value] of extras) {
    fd.set(name, value);
  }
  return fd;
}

/** The single use-case input the action produced. */
function executedInput(): Record<string, unknown> {
  const call = vi.mocked(configureTrainingDaysUseCase.execute).mock.calls.at(0);
  if (call === undefined) throw new Error('use case was not called');
  return call[0] as unknown as Record<string, unknown>;
}

describe('configureTrainingDaysAction', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    requireUserMock.mockResolvedValue(SESSION_USER);
    vi.mocked(configureTrainingDaysUseCase.execute).mockResolvedValue({
      ok: true,
      data: undefined,
    });
  });

  it('redirects unauthenticated users without touching the use case', async () => {
    requireUserMock.mockImplementation(() =>
      redirectMock(`/login?next=${encodeURIComponent(PROGRAM_PATH)}`),
    );

    await expect(configureTrainingDaysAction(submit(['1']))).rejects.toThrow('NEXT_REDIRECT');

    expect(configureTrainingDaysUseCase.execute).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
    // The redirect target is derived from the submitted slug (post-login deep link).
    expect(redirectMock).toHaveBeenCalledWith(`/login?next=${encodeURIComponent(PROGRAM_PATH)}`);
  });

  it('rejects a malformed program slug without calling the use case', async () => {
    const fd = new FormData();
    fd.set('programSlug', 'Not A Slug!');
    fd.append('weekday', '1');

    const state = await configureTrainingDaysAction(fd);

    expect(state).toEqual({
      ok: false,
      error: { code: 'VALIDATION_ERROR', message: 'Invalid program.' },
    });
    expect(configureTrainingDaysUseCase.execute).not.toHaveBeenCalled();
  });

  it('rejects an empty weekday selection without calling the use case', async () => {
    const state = await configureTrainingDaysAction(submit([]));

    expect(state).toEqual({
      ok: false,
      error: { code: 'VALIDATION_ERROR', message: 'Choose at least one training day.' },
    });
    expect(configureTrainingDaysUseCase.execute).not.toHaveBeenCalled();
  });

  it('rejects invalid weekday values without calling the use case', async () => {
    for (const weekday of ['0', '8', 'abc', '']) {
      vi.mocked(configureTrainingDaysUseCase.execute).mockClear();

      const state = await configureTrainingDaysAction(submit([weekday]));

      expect(state).toEqual({
        ok: false,
        error: { code: 'VALIDATION_ERROR', message: 'Choose at least one training day.' },
      });
      expect(configureTrainingDaysUseCase.execute).not.toHaveBeenCalled();
    }
  });

  it('maps repeated weekdays to numeric values for the use case', async () => {
    await configureTrainingDaysAction(submit(['1', '3', '5']));

    expect(executedInput().weekdays).toEqual([1, 3, 5]);
  });

  it('takes the user id from the trusted session, ignoring form data', async () => {
    await configureTrainingDaysAction(
      submit(['1'], [['userId', 'attacker-supplied-id'], ['enrollmentId', 'enr-attacker']]),
    );

    const input = executedInput();
    expect(input.userId).toBe(SESSION_USER.id);
    // Only the trusted inputs cross the boundary: no enrollment id, no
    // browser-supplied user id, nothing extra.
    expect(Object.keys(input).sort()).toEqual(['now', 'programSlug', 'userId', 'weekdays']);
  });

  it('creates the schedule clock on the server, never accepting it from form data', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-09-23T09:30:00.000Z'));

      await configureTrainingDaysAction(
        submit(['1'], [['now', '1999-01-01T00:00:00.000Z'], ['today', '1999-01-01']]),
      );
    } finally {
      vi.useRealTimers();
    }

    const now = executedInput().now;
    expect(now).toBeInstanceOf(Date);
    expect((now as Date).toISOString()).toBe('2026-09-23T09:30:00.000Z');
  });

  it('revalidates the program detail and the dashboard on success, nothing else', async () => {
    const state = await configureTrainingDaysAction(submit(['1', '5']));

    expect(state).toEqual({ ok: true });
    expect(revalidatePath).toHaveBeenCalledTimes(2);
    expect(revalidatePath).toHaveBeenCalledWith(PROGRAM_PATH);
    expect(revalidatePath).toHaveBeenCalledWith('/dashboard');
  });

  it('returns INVALID_TRAINING_DAYS as typed state without revalidating', async () => {
    vi.mocked(configureTrainingDaysUseCase.execute).mockResolvedValue({
      ok: false,
      error: {
        code: 'INVALID_TRAINING_DAYS',
        programSlug: 'fit40-beginner-strength',
        message: '7 is not a weekday between 1 (Monday) and 7 (Sunday)',
      },
    });

    const state = await configureTrainingDaysAction(submit(['7']));

    expect(state).toEqual({
      ok: false,
      error: {
        code: 'INVALID_TRAINING_DAYS',
        message: '7 is not a weekday between 1 (Monday) and 7 (Sunday)',
      },
    });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('returns NOT_ENROLLED as typed state without revalidating', async () => {
    vi.mocked(configureTrainingDaysUseCase.execute).mockResolvedValue({
      ok: false,
      error: {
        code: 'NOT_ENROLLED',
        programSlug: 'fit40-beginner-strength',
        message: 'You are not enrolled in this program.',
      },
    });

    const state = await configureTrainingDaysAction(submit(['1']));

    expect(state).toEqual({
      ok: false,
      error: { code: 'NOT_ENROLLED', message: 'You are not enrolled in this program.' },
    });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('returns SCHEDULE_CHANGED as typed state without revalidating', async () => {
    vi.mocked(configureTrainingDaysUseCase.execute).mockResolvedValue({
      ok: false,
      error: {
        code: 'SCHEDULE_CHANGED',
        programSlug: 'fit40-beginner-strength',
        message: 'Your training schedule changed while saving. Please reload and try again.',
      },
    });

    const state = await configureTrainingDaysAction(submit(['2']));

    expect(state).toEqual({
      ok: false,
      error: {
        code: 'SCHEDULE_CHANGED',
        message: 'Your training schedule changed while saving. Please reload and try again.',
      },
    });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('lets unexpected errors propagate instead of converting them to validation state', async () => {
    vi.mocked(configureTrainingDaysUseCase.execute).mockRejectedValue(
      new Error('Schedule generation contract violated'),
    );

    await expect(configureTrainingDaysAction(submit(['1']))).rejects.toThrow(
      'Schedule generation contract violated',
    );
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});