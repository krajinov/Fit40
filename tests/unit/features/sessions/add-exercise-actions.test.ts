/**
 * Unit tests for the M11 Add Exercise Server Action: auth, authoritative Zod
 * validation, trusted-user identity, revalidation, expected-error
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
  addSessionExerciseUseCase: { execute: vi.fn() },
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

import { addExerciseAction } from '@/features/sessions/actions/add-exercise';
import { addSessionExerciseUseCase } from '@/features/sessions/services';

const EXPECTED_SESSION_PATH = '/programs/fit40-beginner-strength/weeks/1/workouts/1/session';

function makeAddFormData(
  overrides: Record<string, string> = {},
): FormData {
  const fd = new FormData();
  fd.set('sessionId', 's-1');
  fd.set('exerciseId', 'ex-100');
  fd.set('scheme', 'reps');
  fd.set('sets', '3');
  fd.set('targetReps', '8');
  fd.set('expectedSessionVersion', '5');
  fd.set('programSlug', 'fit40-beginner-strength');
  fd.set('weekNumber', '1');
  fd.set('workoutOrder', '1');
  for (const [key, value] of Object.entries(overrides)) {
    fd.set(key, value);
  }
  return fd;
}

function makeDurationFormData(): FormData {
  const fd = makeAddFormData();
  fd.delete('targetReps');
  fd.set('scheme', 'duration');
  fd.set('durationSeconds', '45');
  return fd;
}

const SUCCESS = { ok: true, data: {} as WorkoutSessionDto } as const;

describe('addExerciseAction', () => {
  const execute: Mock = vi.mocked(addSessionExerciseUseCase.execute);

  beforeEach(() => {
    execute.mockReset();
    vi.mocked(revalidatePath).mockClear();
    requireUserMock.mockReset();
    requireUserMock.mockResolvedValue(SESSION_USER);
  });

  it('propagates success and revalidates the session path only', async () => {
    execute.mockResolvedValue(SUCCESS);

    const state = await addExerciseAction(makeAddFormData());

    expect(state).toEqual({ ok: true });
    expect(revalidatePath).toHaveBeenCalledWith(EXPECTED_SESSION_PATH);
    expect(revalidatePath).toHaveBeenCalledTimes(1);
  });

  it('passes the session-derived userId to the use case, never form data', async () => {
    execute.mockResolvedValue(SUCCESS);

    const fd = makeAddFormData();
    fd.set('userId', 'attacker-supplied-id');

    await addExerciseAction(fd);

    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({ userId: SESSION_USER.id }),
    );
  });

  it('forwards the coerced reps payload with the trusted userId and nothing else', async () => {
    execute.mockResolvedValue(SUCCESS);

    const fd = makeAddFormData();
    // Extra client fields must never reach the command.
    fd.set('occurrenceKey', '999');
    fd.set('nextOccurrenceKey', '999');
    fd.set('source', 'user_added');
    fd.set('authoredExerciseId', 'ex-9');
    fd.set('performedExerciseId', 'ex-9');
    fd.set('restSeconds', '300');
    fd.set('exerciseOrder', '99');

    await addExerciseAction(fd);

    expect(execute).toHaveBeenCalledWith({
      sessionId: 's-1',
      exerciseId: 'ex-100',
      scheme: 'reps',
      sets: 3,
      targetReps: 8,
      expectedSessionVersion: 5,
      userId: SESSION_USER.id,
    });
  });

  it('forwards the coerced duration payload with the trusted userId', async () => {
    execute.mockResolvedValue(SUCCESS);

    await addExerciseAction(makeDurationFormData());

    expect(execute).toHaveBeenCalledWith({
      sessionId: 's-1',
      exerciseId: 'ex-100',
      scheme: 'duration',
      sets: 3,
      durationSeconds: 45,
      expectedSessionVersion: 5,
      userId: SESSION_USER.id,
    });
  });

  it.each([
    ['an unsupported scheme', { scheme: 'weight' }],
    ['zero sets', { sets: '0' }],
    ['negative sets', { sets: '-1' }],
    ['empty sets', { sets: '' }],
    ['missing targetReps', { targetReps: '' }],
    ['zero targetReps', { targetReps: '0' }],
    ['non-numeric targetReps', { targetReps: 'many' }],
    ['an empty exercise id', { exerciseId: '' }],
    ['a negative expected version', { expectedSessionVersion: '-1' }],
  ] as const)('returns VALIDATION_ERROR for %s without calling the use case', async (_name, overrides) => {
    const state = await addExerciseAction(makeAddFormData(overrides));

    expect(state).toEqual({
      ok: false,
      error: { code: 'VALIDATION_ERROR', message: expect.any(String) },
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it('returns VALIDATION_ERROR for a duration payload missing durationSeconds', async () => {
    const fd = makeDurationFormData();
    fd.delete('durationSeconds');

    const state = await addExerciseAction(fd);

    expect(state).toEqual({
      ok: false,
      error: { code: 'VALIDATION_ERROR', message: expect.any(String) },
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it('does not revalidate when the use case fails', async () => {
    execute.mockResolvedValue({
      ok: false,
      error: { code: 'EXERCISE_NOT_FOUND', message: 'not in catalog' },
    });

    const state = await addExerciseAction(makeAddFormData());

    expect(state).toEqual({
      ok: false,
      error: { code: 'EXERCISE_NOT_FOUND', message: 'not in catalog' },
    });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('lets unexpected errors propagate instead of converting them to results', async () => {
    execute.mockRejectedValue(new Error('connection lost'));

    await expect(addExerciseAction(makeAddFormData())).rejects.toThrow('connection lost');
  });

  it.each([
    'SESSION_NOT_FOUND',
    'FORBIDDEN',
    'NOT_ENROLLED',
    'SESSION_ALREADY_COMPLETED',
    'EXERCISE_NOT_FOUND',
    'SESSION_MODIFIED',
    'INVALID_INPUT',
  ] as const)('maps the expected %s error into the action state', async (code) => {
    execute.mockResolvedValue({ ok: false, error: { code, message: `msg ${code}` } });

    const state = await addExerciseAction(makeAddFormData());

    expect(state).toEqual({ ok: false, error: { code, message: `msg ${code}` } });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
