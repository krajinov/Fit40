/**
 * Unit tests for the M10 skip/unskip Server Actions: auth, validation,
 * trusted-user identity, revalidation, expected-error propagation, and
 * unexpected-error transparency. Mirrors the substitutionActionTests
 * pattern of substitution-actions.test.ts.
 */

import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import type { WorkoutSessionDto } from '@/application/dto/workout-session';
import type { SessionActionState } from '@/features/sessions/types/session-action-state';

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
  skipSessionExerciseUseCase: { execute: vi.fn() },
  unskipSessionExerciseUseCase: { execute: vi.fn() },
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

import { skipExerciseAction } from '@/features/sessions/actions/skip-exercise';
import { unskipExerciseAction } from '@/features/sessions/actions/unskip-exercise';
import {
  skipSessionExerciseUseCase,
  unskipSessionExerciseUseCase,
} from '@/features/sessions/services';

const EXPECTED_SESSION_PATH = '/programs/fit40-beginner-strength/weeks/1/workouts/1/session';

function makeSkipFormData(): FormData {
  const fd = new FormData();
  fd.set('sessionId', 's-1');
  fd.set('exerciseOrder', '1');
  fd.set('expectedSessionVersion', '3');
  fd.set('programSlug', 'fit40-beginner-strength');
  fd.set('weekNumber', '1');
  fd.set('workoutOrder', '1');
  return fd;
}

const SUCCESS = { ok: true, data: {} as WorkoutSessionDto } as const;

function skipActionTests(
  name: string,
  action: (formData: FormData) => Promise<SessionActionState>,
  execute: Mock,
): void {
  describe(name, () => {
    beforeEach(() => {
      execute.mockReset();
      vi.mocked(revalidatePath).mockClear();
      requireUserMock.mockReset();
      requireUserMock.mockResolvedValue(SESSION_USER);
    });

    it('propagates success and revalidates the session path only', async () => {
      execute.mockResolvedValue(SUCCESS);

      const state = await action(makeSkipFormData());

      expect(state).toEqual({ ok: true });
      expect(revalidatePath).toHaveBeenCalledWith(EXPECTED_SESSION_PATH);
      expect(revalidatePath).toHaveBeenCalledTimes(1);
    });

    it('passes the session-derived userId to the use case, never form data', async () => {
      execute.mockResolvedValue(SUCCESS);

      const fd = makeSkipFormData();
      fd.set('userId', 'attacker-supplied-id');

      await action(fd);

      expect(execute).toHaveBeenCalledWith(
        expect.objectContaining({ userId: SESSION_USER.id }),
      );
    });

    it('returns VALIDATION_ERROR for invalid input without calling the use case', async () => {
      const fd = makeSkipFormData();
      fd.delete('exerciseOrder');

      const state = await action(fd);

      expect(state).toEqual({
        ok: false,
        error: { code: 'VALIDATION_ERROR', message: expect.any(String) },
      });
      expect(execute).not.toHaveBeenCalled();
    });

    it('does not revalidate when the use case fails', async () => {
      execute.mockResolvedValue({
        ok: false,
        error: { code: 'EXERCISE_HAS_LOGGED_SETS', message: 'blocked' },
      });

      const state = await action(makeSkipFormData());

      expect(state.ok).toBe(false);
      expect(revalidatePath).not.toHaveBeenCalled();
    });

    it('lets unexpected errors propagate instead of converting them to results', async () => {
      execute.mockRejectedValue(new Error('connection lost'));

      await expect(action(makeSkipFormData())).rejects.toThrow('connection lost');
    });

    it.each([
      'SESSION_NOT_FOUND',
      'FORBIDDEN',
      'NOT_ENROLLED',
      'SESSION_ALREADY_COMPLETED',
      'EXERCISE_LOG_NOT_FOUND',
      'EXERCISE_HAS_LOGGED_SETS',
      'ADJUSTMENT_NO_CHANGE',
      'SESSION_MODIFIED',
      'INVALID_INPUT',
    ] as const)('maps the expected %s error into the action state', async (code) => {
      execute.mockResolvedValue({ ok: false, error: { code, message: `msg ${code}` } });

      const state = await action(makeSkipFormData());

      expect(state).toEqual({ ok: false, error: { code, message: `msg ${code}` } });
      expect(revalidatePath).not.toHaveBeenCalled();
    });
  });
}

skipActionTests(
  'skipExerciseAction',
  skipExerciseAction,
  vi.mocked(skipSessionExerciseUseCase.execute),
);

skipActionTests(
  'unskipExerciseAction',
  unskipExerciseAction,
  vi.mocked(unskipSessionExerciseUseCase.execute),
);

describe('skip action schemas and forwarding (FormData coercion)', () => {
  beforeEach(() => {
    vi.mocked(skipSessionExerciseUseCase.execute).mockReset();
    vi.mocked(unskipSessionExerciseUseCase.execute).mockReset();
    vi.mocked(revalidatePath).mockClear();
    requireUserMock.mockReset();
    requireUserMock.mockResolvedValue(SESSION_USER);
  });

  it('skipExerciseAction forwards the coerced occurrence with the trusted userId', async () => {
    vi.mocked(skipSessionExerciseUseCase.execute).mockResolvedValue(SUCCESS);

    await skipExerciseAction(makeSkipFormData());

    expect(skipSessionExerciseUseCase.execute).toHaveBeenCalledWith({
      sessionId: 's-1',
      exerciseOrder: 1,
      expectedSessionVersion: 3,
      userId: SESSION_USER.id,
    });
  });

  it('unskipExerciseAction forwards the coerced occurrence with the trusted userId', async () => {
    vi.mocked(unskipSessionExerciseUseCase.execute).mockResolvedValue(SUCCESS);

    await unskipExerciseAction(makeSkipFormData());

    expect(unskipSessionExerciseUseCase.execute).toHaveBeenCalledWith({
      sessionId: 's-1',
      exerciseOrder: 1,
      expectedSessionVersion: 3,
      userId: SESSION_USER.id,
    });
  });
});
