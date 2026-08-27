import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import type { WorkoutSessionDto } from '@/application/dto/workout-session';
import type { SessionActionState } from '@/features/sessions/types/session-action-state';

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

import { revalidatePath } from 'next/cache';

import { completeSessionAction } from '@/features/sessions/actions/complete-session';
import { deleteSetAction } from '@/features/sessions/actions/delete-set';
import { logSetAction } from '@/features/sessions/actions/log-set';
import { updateSetAction } from '@/features/sessions/actions/update-set';
import {
  completeWorkoutSessionUseCase,
  deleteSessionSetUseCase,
  logSessionSetUseCase,
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
): void {
  describe(name, () => {
    beforeEach(() => {
      execute.mockReset();
      vi.mocked(revalidatePath).mockClear();
    });

    it('propagates success and revalidates the session path', async () => {
      execute.mockResolvedValue({ ok: true, data: {} as WorkoutSessionDto });

      const state = await action(makeFormData());

      expect(state).toEqual({ ok: true });
      expect(revalidatePath).toHaveBeenCalledWith(EXPECTED_SESSION_PATH);
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
);
