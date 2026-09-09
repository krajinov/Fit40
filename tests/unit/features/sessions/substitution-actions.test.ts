/**
 * Unit tests for the M9 substitution Server Actions: auth, validation,
 * trusted-user identity, revalidation, expected-error propagation, and
 * unexpected-error transparency. Mirrors the mutationActionTests pattern
 * of session-mutation-actions.test.ts.
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
  substituteSessionExerciseUseCase: { execute: vi.fn() },
  restoreSessionExerciseUseCase: { execute: vi.fn() },
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

import { substituteExerciseAction } from '@/features/sessions/actions/substitute-exercise';
import { restoreExerciseAction } from '@/features/sessions/actions/restore-exercise';
import {
  restoreSessionExerciseUseCase,
  substituteSessionExerciseUseCase,
} from '@/features/sessions/services';

const EXPECTED_SESSION_PATH = '/programs/fit40-beginner-strength/weeks/1/workouts/1/session';

function makeSubstituteFormData(): FormData {
  const fd = new FormData();
  fd.set('sessionId', 's-1');
  fd.set('exerciseOrder', '1');
  fd.set('replacementExerciseId', 'ex-db-bench');
  fd.set('programSlug', 'fit40-beginner-strength');
  fd.set('weekNumber', '1');
  fd.set('workoutOrder', '1');
  return fd;
}

function makeRestoreFormData(): FormData {
  const fd = new FormData();
  fd.set('sessionId', 's-1');
  fd.set('exerciseOrder', '1');
  fd.set('programSlug', 'fit40-beginner-strength');
  fd.set('weekNumber', '1');
  fd.set('workoutOrder', '1');
  return fd;
}

const SUCCESS = { ok: true, data: {} as WorkoutSessionDto } as const;

function substitutionActionTests(
  name: string,
  action: (formData: FormData) => Promise<SessionActionState>,
  execute: Mock,
  makeFormData: () => FormData,
): void {
  describe(name, () => {
    beforeEach(() => {
      execute.mockReset();
      vi.mocked(revalidatePath).mockClear();
      requireUserMock.mockReset();
      requireUserMock.mockResolvedValue(SESSION_USER);
    });

    it('propagates success and revalidates the session path', async () => {
      execute.mockResolvedValue(SUCCESS);

      const state = await action(makeFormData());

      expect(state).toEqual({ ok: true });
      expect(revalidatePath).toHaveBeenCalledWith(EXPECTED_SESSION_PATH);
      expect(revalidatePath).toHaveBeenCalledTimes(1);
    });

    it('passes the session-derived userId to the use case, never form data', async () => {
      execute.mockResolvedValue(SUCCESS);

      const fd = makeFormData();
      fd.set('userId', 'attacker-supplied-id');

      await action(fd);

      expect(execute).toHaveBeenCalledWith(
        expect.objectContaining({ userId: SESSION_USER.id }),
      );
    });

    it('redirects unauthenticated users to login without calling the use case', async () => {
      requireUserMock.mockImplementation(() => redirectMock('/login?next=test'));

      await expect(action(makeFormData())).rejects.toThrow('NEXT_REDIRECT');

      expect(execute).not.toHaveBeenCalled();
      expect(revalidatePath).not.toHaveBeenCalled();
    });

    it('returns VALIDATION_ERROR for invalid input without calling the use case', async () => {
      const state = await action(new FormData());

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

      const state = await action(makeFormData());

      expect(state.ok).toBe(false);
      expect(revalidatePath).not.toHaveBeenCalled();
    });

    it('lets unexpected errors propagate instead of converting them to results', async () => {
      execute.mockRejectedValue(new Error('connection lost'));

      await expect(action(makeFormData())).rejects.toThrow('connection lost');
    });

    it.each([
      'SESSION_NOT_FOUND',
      'FORBIDDEN',
      'NOT_ENROLLED',
      'SESSION_ALREADY_COMPLETED',
      'EXERCISE_LOG_NOT_FOUND',
      'EXERCISE_HAS_LOGGED_SETS',
      'SUBSTITUTION_NO_CHANGE',
      'EXERCISE_NOT_FOUND',
      'SESSION_MODIFIED',
      'INVALID_INPUT',
    ] as const)('maps the expected %s error into the action state', async (code) => {
      execute.mockResolvedValue({ ok: false, error: { code, message: `msg ${code}` } });

      const state = await action(makeFormData());

      expect(state).toEqual({ ok: false, error: { code, message: `msg ${code}` } });
      expect(revalidatePath).not.toHaveBeenCalled();
    });
  });
}

substitutionActionTests(
  'substituteExerciseAction',
  substituteExerciseAction,
  vi.mocked(substituteSessionExerciseUseCase.execute),
  makeSubstituteFormData,
);

substitutionActionTests(
  'restoreExerciseAction',
  restoreExerciseAction,
  vi.mocked(restoreSessionExerciseUseCase.execute),
  makeRestoreFormData,
);

describe('substitution action schemas (FormData coercion)', () => {
  beforeEach(() => {
    vi.mocked(substituteSessionExerciseUseCase.execute).mockReset();
    vi.mocked(restoreSessionExerciseUseCase.execute).mockReset();
    vi.mocked(revalidatePath).mockClear();
    requireUserMock.mockReset();
    requireUserMock.mockResolvedValue(SESSION_USER);
  });

  it('substituteExerciseAction forwards the coerced occurrence and replacement', async () => {
    vi.mocked(substituteSessionExerciseUseCase.execute).mockResolvedValue(SUCCESS);

    await substituteExerciseAction(makeSubstituteFormData());

    expect(substituteSessionExerciseUseCase.execute).toHaveBeenCalledWith({
      sessionId: 's-1',
      exerciseOrder: 1,
      replacementExerciseId: 'ex-db-bench',
      userId: SESSION_USER.id,
    });
  });

  it('restoreExerciseAction forwards the coerced occurrence only', async () => {
    vi.mocked(restoreSessionExerciseUseCase.execute).mockResolvedValue(SUCCESS);

    await restoreExerciseAction(makeRestoreFormData());

    expect(restoreSessionExerciseUseCase.execute).toHaveBeenCalledWith({
      sessionId: 's-1',
      exerciseOrder: 1,
      userId: SESSION_USER.id,
    });
  });

  it('substituteExerciseAction rejects a missing replacement selection', async () => {
    const fd = makeSubstituteFormData();
    fd.delete('replacementExerciseId');

    const state = await substituteExerciseAction(fd);

    expect(state).toEqual({
      ok: false,
      error: { code: 'VALIDATION_ERROR', message: expect.any(String) },
    });
    expect(substituteSessionExerciseUseCase.execute).not.toHaveBeenCalled();
  });
});
