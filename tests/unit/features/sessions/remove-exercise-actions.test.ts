/**
 * Unit tests for the M11 Remove Exercise Server Action: auth, authoritative
 * Zod validation, trusted-user identity, revalidation, expected-error
 * propagation and unexpected-error transparency. Mirrors the
 * `move-actions.test.ts` pattern.
 */

import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import type { WorkoutSessionDto } from '@/application/dto/workout-session';

const { requireUserMock } = vi.hoisted(() => ({ requireUserMock: vi.fn() }));

vi.mock('@/features/auth/current-user', () => ({
  requireUser: requireUserMock,
}));

vi.mock('@/features/sessions/services', () => ({
  removeSessionExerciseUseCase: { execute: vi.fn() },
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

import { removeExerciseAction } from '@/features/sessions/actions/remove-exercise';
import { removeSessionExerciseUseCase } from '@/features/sessions/services';

const EXPECTED_SESSION_PATH = '/programs/fit40-beginner-strength/weeks/1/workouts/1/session';

function makeRemoveFormData(overrides: Record<string, string> = {}): FormData {
  const fd = new FormData();
  fd.set('sessionId', 's-1');
  fd.set('exerciseOrder', '2');
  fd.set('expectedSessionVersion', '5');
  fd.set('programSlug', 'fit40-beginner-strength');
  fd.set('weekNumber', '1');
  fd.set('workoutOrder', '1');
  for (const [key, value] of Object.entries(overrides)) {
    fd.set(key, value);
  }
  return fd;
}

const SUCCESS = { ok: true, data: {} as WorkoutSessionDto } as const;

describe('removeExerciseAction', () => {
  const execute: Mock = vi.mocked(removeSessionExerciseUseCase.execute);

  beforeEach(() => {
    execute.mockReset();
    vi.mocked(revalidatePath).mockClear();
    requireUserMock.mockReset();
    requireUserMock.mockResolvedValue(SESSION_USER);
  });

  it('propagates success and revalidates the session path only', async () => {
    execute.mockResolvedValue(SUCCESS);

    const state = await removeExerciseAction(makeRemoveFormData());

    expect(state).toEqual({ ok: true });
    expect(revalidatePath).toHaveBeenCalledWith(EXPECTED_SESSION_PATH);
    expect(revalidatePath).toHaveBeenCalledTimes(1);
  });

  it('forwards the coerced command with the trusted userId and nothing else', async () => {
    execute.mockResolvedValue(SUCCESS);

    const fd = makeRemoveFormData();
    // Extra client fields must never reach the command.
    fd.set('userId', 'attacker-supplied-id');
    fd.set('occurrenceKey', '999');
    fd.set('nextOccurrenceKey', '999');
    fd.set('source', 'user_added');
    fd.set('exerciseId', 'ex-9');
    fd.set('authoredExerciseId', 'ex-9');
    fd.set('performedExerciseId', 'ex-9');

    await removeExerciseAction(fd);

    expect(execute).toHaveBeenCalledWith({
      sessionId: 's-1',
      exerciseOrder: 2,
      expectedSessionVersion: 5,
      userId: SESSION_USER.id,
    });
  });

  it('passes the session-derived userId to the use case, never form data', async () => {
    execute.mockResolvedValue(SUCCESS);

    const fd = makeRemoveFormData();
    fd.set('userId', 'attacker-supplied-id');

    await removeExerciseAction(fd);

    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({ userId: SESSION_USER.id }),
    );
  });

  it.each([
    ['a zero order', { exerciseOrder: '0' }],
    ['a negative order', { exerciseOrder: '-1' }],
    ['a fractional order', { exerciseOrder: '1.5' }],
    ['a non-numeric order', { exerciseOrder: 'second' }],
    ['an empty order', { exerciseOrder: '' }],
    ['a negative expected version', { expectedSessionVersion: '-1' }],
  ] as const)('returns VALIDATION_ERROR for %s without calling the use case', async (_name, overrides) => {
    const state = await removeExerciseAction(makeRemoveFormData(overrides));

    expect(state).toEqual({
      ok: false,
      error: { code: 'VALIDATION_ERROR', message: expect.any(String) },
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it('does not revalidate when the use case fails', async () => {
    execute.mockResolvedValue({
      ok: false,
      error: { code: 'EXERCISE_NOT_REMOVABLE', message: 'template-authored' },
    });

    const state = await removeExerciseAction(makeRemoveFormData());

    expect(state).toEqual({
      ok: false,
      error: { code: 'EXERCISE_NOT_REMOVABLE', message: 'template-authored' },
    });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('lets unexpected errors propagate instead of converting them to results', async () => {
    execute.mockRejectedValue(new Error('connection lost'));

    await expect(removeExerciseAction(makeRemoveFormData())).rejects.toThrow('connection lost');
  });

  it.each([
    'SESSION_NOT_FOUND',
    'FORBIDDEN',
    'NOT_ENROLLED',
    'SESSION_ALREADY_COMPLETED',
    'EXERCISE_LOG_NOT_FOUND',
    'EXERCISE_HAS_LOGGED_SETS',
    'EXERCISE_NOT_REMOVABLE',
    'SESSION_MODIFIED',
    'INVALID_INPUT',
  ] as const)('maps the expected %s error into the action state', async (code) => {
    execute.mockResolvedValue({ ok: false, error: { code, message: `msg ${code}` } });

    const state = await removeExerciseAction(makeRemoveFormData());

    expect(state).toEqual({ ok: false, error: { code, message: `msg ${code}` } });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
