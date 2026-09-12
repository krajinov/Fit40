/**
 * Unit tests for the M10 Slice 5 move Server Action: auth, validation,
 * trusted-user identity, revalidation, expected-error propagation, and
 * unexpected-error transparency. Mirrors the skip-actions.test.ts pattern.
 */

import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import type { WorkoutSessionDto } from '@/application/dto/workout-session';

const { redirectMock, requireUserMock } = vi.hoisted(() => {
  const redirect = vi.fn((target: string) => {
    const error = new Error(`NEXT_REDIRECT:${target}`);
    error.name = 'NEXT_REDIRECT';
    throw error;
  });

  return { redirectMock: redirect, requireUserMock: vi.fn() };
});

vi.mock('next/navigation', () => ({
  redirect: redirectMock,
}));

vi.mock('@/features/auth/current-user', () => ({
  requireUser: requireUserMock,
}));

vi.mock('@/features/sessions/services', () => ({
  moveSessionExerciseUseCase: { execute: vi.fn() },
}));

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

const SESSION_USER = {
  id: '11111111-1111-1111-1111-111111111111',
  email: 'user@example.com',
  createdAt: '2026-01-01T00:00:00.000Z',
};

import { revalidatePath } from 'next/cache';

import { moveExerciseAction } from '@/features/sessions/actions/move-exercise';
import { moveSessionExerciseUseCase } from '@/features/sessions/services';

const EXPECTED_SESSION_PATH = '/programs/fit40-beginner-strength/weeks/1/workouts/1/session';

function makeMoveFormData(direction: 'up' | 'down' = 'up'): FormData {
  const fd = new FormData();
  fd.set('sessionId', 's-1');
  fd.set('exerciseOrder', '2');
  fd.set('expectedSessionVersion', '5');
  fd.set('direction', direction);
  fd.set('programSlug', 'fit40-beginner-strength');
  fd.set('weekNumber', '1');
  fd.set('workoutOrder', '1');
  return fd;
}

const SUCCESS = { ok: true, data: {} as WorkoutSessionDto } as const;

describe('moveExerciseAction', () => {
  const execute: Mock = vi.mocked(moveSessionExerciseUseCase.execute);

  beforeEach(() => {
    execute.mockReset();
    vi.mocked(revalidatePath).mockClear();
    requireUserMock.mockReset();
    requireUserMock.mockResolvedValue(SESSION_USER);
  });

  it('propagates success and revalidates the session path only', async () => {
    execute.mockResolvedValue(SUCCESS);

    const state = await moveExerciseAction(makeMoveFormData());

    expect(state).toEqual({ ok: true });
    expect(revalidatePath).toHaveBeenCalledWith(EXPECTED_SESSION_PATH);
    expect(revalidatePath).toHaveBeenCalledTimes(1);
  });

  it('passes the session-derived userId to the use case, never form data', async () => {
    execute.mockResolvedValue(SUCCESS);

    const fd = makeMoveFormData();
    fd.set('userId', 'attacker-supplied-id');

    await moveExerciseAction(fd);

    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({ userId: SESSION_USER.id }),
    );
  });

  it('returns VALIDATION_ERROR for invalid input without calling the use case', async () => {
    const fd = makeMoveFormData();
    fd.set('direction', 'sideways');

    const state = await moveExerciseAction(fd);

    expect(state).toEqual({
      ok: false,
      error: { code: 'VALIDATION_ERROR', message: expect.any(String) },
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it('does not revalidate when the use case fails', async () => {
    execute.mockResolvedValue({
      ok: false,
      error: { code: 'MOVE_OUT_OF_RANGE', message: 'blocked' },
    });

    const state = await moveExerciseAction(makeMoveFormData());

    expect(state.ok).toBe(false);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('lets unexpected errors propagate instead of converting them to results', async () => {
    execute.mockRejectedValue(new Error('connection lost'));

    await expect(moveExerciseAction(makeMoveFormData())).rejects.toThrow('connection lost');
  });

  it.each([
    'SESSION_NOT_FOUND',
    'FORBIDDEN',
    'NOT_ENROLLED',
    'SESSION_ALREADY_COMPLETED',
    'EXERCISE_LOG_NOT_FOUND',
    'MOVE_OUT_OF_RANGE',
    'ADJUSTMENT_NO_CHANGE',
    'SESSION_MODIFIED',
    'INVALID_INPUT',
  ] as const)('maps the expected %s error into the action state', async (code) => {
    execute.mockResolvedValue({ ok: false, error: { code, message: `msg ${code}` } });

    const state = await moveExerciseAction(makeMoveFormData());

    expect(state).toEqual({ ok: false, error: { code, message: `msg ${code}` } });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('forwards the coerced occurrence and direction with the trusted userId', async () => {
    execute.mockResolvedValue(SUCCESS);

    await moveExerciseAction(makeMoveFormData('down'));

    expect(execute).toHaveBeenCalledWith({
      sessionId: 's-1',
      exerciseOrder: 2,
      expectedSessionVersion: 5,
      direction: 'down',
      userId: SESSION_USER.id,
    });
  });
});