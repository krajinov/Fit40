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
  logSessionSetUseCase: { execute: vi.fn() },
  updateSessionSetUseCase: { execute: vi.fn() },
  deleteSessionSetUseCase: { execute: vi.fn() },
  completeWorkoutSessionUseCase: { execute: vi.fn() },
  startWorkoutSessionUseCase: { execute: vi.fn() },
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

import { completeSessionAction } from '@/features/sessions/actions/complete-session';
import { deleteSetAction } from '@/features/sessions/actions/delete-set';
import { logSetAction } from '@/features/sessions/actions/log-set';
import { startSessionAction } from '@/features/sessions/actions/start-session';
import { updateSetAction } from '@/features/sessions/actions/update-set';
import {
  completeWorkoutSessionUseCase,
  deleteSessionSetUseCase,
  logSessionSetUseCase,
  startWorkoutSessionUseCase,
  updateSessionSetUseCase,
} from '@/features/sessions/services';

const EXPECTED_SESSION_PATH = '/programs/fit40-beginner-strength/weeks/1/workouts/1/session';

function makeLogSetFormData(): FormData {
  const fd = new FormData();
  fd.set('sessionId', 's-1');
  fd.set('exerciseOrder', '1');
  fd.set('type', 'reps');
  fd.set('reps', '10');
  fd.set('programSlug', 'fit40-beginner-strength');
  fd.set('weekNumber', '1');
  fd.set('workoutOrder', '1');
  return fd;
}

function makeUpdateSetFormData(): FormData {
  const fd = makeLogSetFormData();
  fd.set('setNumber', '1');
  return fd;
}

function makeDeleteSetFormData(): FormData {
  const fd = new FormData();
  fd.set('sessionId', 's-1');
  fd.set('exerciseOrder', '1');
  fd.set('setNumber', '1');
  fd.set('programSlug', 'fit40-beginner-strength');
  fd.set('weekNumber', '1');
  fd.set('workoutOrder', '1');
  return fd;
}

function makeCompleteSessionFormData(): FormData {
  const fd = new FormData();
  fd.set('sessionId', 's-1');
  fd.set('programSlug', 'fit40-beginner-strength');
  fd.set('weekNumber', '1');
  fd.set('workoutOrder', '1');
  return fd;
}

const SESSION_MODIFIED_ERROR = {
  code: 'SESSION_MODIFIED',
  message: 'Session was modified concurrently; reload and retry',
} as const;

function mutationActionTests(
  name: string,
  action: (formData: FormData) => Promise<SessionActionState>,
  execute: Mock,
  makeFormData: () => FormData,
  // log/update/delete use cases resolve to a bare WorkoutSessionDto; the
  // complete use case resolves to { session, programSlug } (trusted slug).
  successData: { ok: true; data: unknown } = { ok: true, data: {} as WorkoutSessionDto },
): void {
  describe(name, () => {
    beforeEach(() => {
      execute.mockReset();
      vi.mocked(revalidatePath).mockClear();
      requireUserMock.mockReset();
      requireUserMock.mockResolvedValue(SESSION_USER);
    });

    it('propagates success and revalidates the session path', async () => {
      execute.mockResolvedValue(successData);

      const state = await action(makeFormData());

      expect(state).toEqual({ ok: true });
      expect(revalidatePath).toHaveBeenCalledWith(EXPECTED_SESSION_PATH);
    });

    it('passes the session-derived userId to the use case, never form data', async () => {
      execute.mockResolvedValue(successData);

      const fd = makeFormData();
      fd.set('userId', 'attacker-supplied-id');

      await action(fd);

      expect(execute).toHaveBeenCalledWith(expect.objectContaining({ userId: SESSION_USER.id }));
    });

    it('redirects unauthenticated users to login without calling the use case', async () => {
      requireUserMock.mockImplementation(() => redirectMock('/login?next=test'));

      await expect(action(makeFormData())).rejects.toThrow('NEXT_REDIRECT');

      expect(execute).not.toHaveBeenCalled();
      expect(revalidatePath).not.toHaveBeenCalled();
    });

    it('propagates FORBIDDEN when the session belongs to another user', async () => {
      const forbidden = { code: 'FORBIDDEN', message: 'You do not have access to this session.' } as const;
      execute.mockResolvedValue({ ok: false, error: forbidden });

      const state = await action(makeFormData());

      expect(state).toEqual({ ok: false, error: forbidden });
      expect(revalidatePath).not.toHaveBeenCalled();
    });

    it('propagates SESSION_MODIFIED instead of swallowing it', async () => {
      execute.mockResolvedValue({ ok: false, error: SESSION_MODIFIED_ERROR });

      const state = await action(makeFormData());

      expect(state).toEqual({ ok: false, error: SESSION_MODIFIED_ERROR });
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

    it('lets unexpected errors propagate instead of converting them to results', async () => {
      execute.mockRejectedValue(new Error('connection lost'));

      await expect(action(makeFormData())).rejects.toThrow('connection lost');
    });
  });
}

mutationActionTests(
  'logSetAction',
  logSetAction,
  vi.mocked(logSessionSetUseCase.execute),
  makeLogSetFormData,
);
mutationActionTests(
  'updateSetAction',
  updateSetAction,
  vi.mocked(updateSessionSetUseCase.execute),
  makeUpdateSetFormData,
);
mutationActionTests(
  'deleteSetAction',
  deleteSetAction,
  vi.mocked(deleteSessionSetUseCase.execute),
  makeDeleteSetFormData,
);
mutationActionTests(
  'completeSessionAction',
  completeSessionAction,
  vi.mocked(completeWorkoutSessionUseCase.execute),
  makeCompleteSessionFormData,
  {
    ok: true,
    data: { session: {} as WorkoutSessionDto, programSlug: 'fit40-beginner-strength' },
  },
);

describe('completeSessionAction revalidation target', () => {
  beforeEach(() => {
    vi.mocked(completeWorkoutSessionUseCase.execute).mockReset();
    vi.mocked(revalidatePath).mockClear();
    requireUserMock.mockReset();
    requireUserMock.mockResolvedValue(SESSION_USER);
  });

  it('revalidates the owning program page from trusted data, never the forged form slug', async () => {
    vi.mocked(completeWorkoutSessionUseCase.execute).mockResolvedValue({
      ok: true,
      data: { session: {} as WorkoutSessionDto, programSlug: 'fit40-beginner-strength' },
    });

    const fd = makeCompleteSessionFormData();
    fd.set('programSlug', 'forged-program');

    const state = await completeSessionAction(fd);

    expect(state).toEqual({ ok: true });
    expect(revalidatePath).toHaveBeenCalledWith('/programs/fit40-beginner-strength');
    expect(revalidatePath).not.toHaveBeenCalledWith('/programs/forged-program');
  });

  it('skips program-page revalidation when the trusted slug cannot be resolved', async () => {
    vi.mocked(completeWorkoutSessionUseCase.execute).mockResolvedValue({
      ok: true,
      data: { session: {} as WorkoutSessionDto, programSlug: null },
    });

    const fd = makeCompleteSessionFormData();
    fd.set('programSlug', 'forged-program');

    await completeSessionAction(fd);

    // The session page keeps its unchanged form-derived revalidation, but no
    // bare program page may be derived from the forged form field.
    const revalidated = vi.mocked(revalidatePath).mock.calls.map((call) => String(call[0]));
    expect(revalidated).toHaveLength(1);
    expect(revalidated[0]).toMatch(/\/session$/);
    expect(revalidated).not.toContain('/programs/forged-program');
  });
});

function makeStartSessionFormData(): FormData {
  const fd = new FormData();
  fd.set('programSlug', 'fit40-beginner-strength');
  fd.set('weekNumber', '1');
  fd.set('workoutOrder', '1');
  return fd;
}

const SESSION_ALREADY_EXISTS_MESSAGE =
  'A session already exists for scheduled workout "fit40-beginner-strength-w1-1"';

describe('startSessionAction', () => {
  beforeEach(() => {
    vi.mocked(startWorkoutSessionUseCase.execute).mockReset();
    vi.mocked(revalidatePath).mockClear();
    requireUserMock.mockReset();
    requireUserMock.mockResolvedValue(SESSION_USER);
  });

  it('redirects unauthenticated users to login without calling the use case', async () => {
    requireUserMock.mockImplementation(() => redirectMock('/login?next=test'));

    await expect(startSessionAction(makeStartSessionFormData())).rejects.toThrow('NEXT_REDIRECT');

    expect(startWorkoutSessionUseCase.execute).not.toHaveBeenCalled();
  });

  it('passes the session-derived userId to the use case, never form data', async () => {
    vi.mocked(startWorkoutSessionUseCase.execute).mockResolvedValue({
      ok: true,
      data: {} as WorkoutSessionDto,
    });

    const fd = makeStartSessionFormData();
    fd.set('userId', 'attacker-supplied-id');

    await startSessionAction(fd);

    expect(startWorkoutSessionUseCase.execute).toHaveBeenCalledWith(
      expect.objectContaining({ userId: SESSION_USER.id }),
    );
  });

  it('propagates NOT_ENROLLED as typed action state', async () => {
    vi.mocked(startWorkoutSessionUseCase.execute).mockResolvedValue({
      ok: false,
      error: {
        code: 'NOT_ENROLLED',
        programSlug: 'fit40-beginner-strength',
        message: 'Join this program before starting its workouts.',
      },
    });

    const state = await startSessionAction(makeStartSessionFormData());

    expect(state).toEqual({
      ok: false,
      error: { code: 'NOT_ENROLLED', message: 'Join this program before starting its workouts.' },
    });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('propagates success and revalidates the session path', async () => {
    vi.mocked(startWorkoutSessionUseCase.execute).mockResolvedValue({
      ok: true,
      data: {} as WorkoutSessionDto,
    });

    const state = await startSessionAction(makeStartSessionFormData());

    expect(state).toEqual({ ok: true });
    expect(revalidatePath).toHaveBeenCalledWith(EXPECTED_SESSION_PATH);
  });

  it('propagates SESSION_ALREADY_EXISTS instead of swallowing it', async () => {
    vi.mocked(startWorkoutSessionUseCase.execute).mockResolvedValue({
      ok: false,
      error: {
        code: 'SESSION_ALREADY_EXISTS',
        scheduledWorkoutId: 'fit40-beginner-strength-w1-1',
        message: SESSION_ALREADY_EXISTS_MESSAGE,
      },
    });

    const state = await startSessionAction(makeStartSessionFormData());

    expect(state).toEqual({
      ok: false,
      error: { code: 'SESSION_ALREADY_EXISTS', message: SESSION_ALREADY_EXISTS_MESSAGE },
    });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('returns VALIDATION_ERROR for invalid input without calling the use case', async () => {
    const state = await startSessionAction(new FormData());

    expect(state).toEqual({
      ok: false,
      error: { code: 'VALIDATION_ERROR', message: expect.any(String) },
    });
    expect(startWorkoutSessionUseCase.execute).not.toHaveBeenCalled();
  });

  it('lets unexpected errors propagate instead of converting them to results', async () => {
    vi.mocked(startWorkoutSessionUseCase.execute).mockRejectedValue(new Error('connection lost'));

    await expect(startSessionAction(makeStartSessionFormData())).rejects.toThrow('connection lost');
  });
});
