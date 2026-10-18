import { afterEach, describe, expect, it, vi } from 'vitest';

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock('@/features/exercises/services', () => ({ getExerciseHistoryPresenceUseCase: { execute } }));

import { buildExerciseHistoryPresenceView } from '@/features/exercises/exercise-history-presence-view';

afterEach(() => vi.restoreAllMocks());

describe('exercise history presence view', () => {
  it('exposes a personal link only for present', async () => {
    execute.mockResolvedValue({ ok: true, data: { status: 'present' } });
    expect(await buildExerciseHistoryPresenceView('owner', 'goblet-squat')).toEqual({
      status: 'present', personalHistoryHref: '/history/exercises/goblet-squat',
    });
    expect(execute).toHaveBeenLastCalledWith({ userId: 'owner', slug: 'goblet-squat' });
  });

  it('keeps successful absence distinct', async () => {
    execute.mockResolvedValue({ ok: true, data: { status: 'absent' } });
    expect(await buildExerciseHistoryPresenceView('owner', 'goblet-squat')).toEqual({ status: 'absent' });
  });

  it('logs the original unavailable failure with user context and omits the link', async () => {
    const cause = new Error('read failed');
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    execute.mockResolvedValue({ ok: true, data: { status: 'unavailable', cause } });
    expect(await buildExerciseHistoryPresenceView('owner', 'goblet-squat')).toEqual({ status: 'unavailable' });
    expect(log).toHaveBeenCalledExactlyOnceWith(
      'Unexpected failure loading exercise history presence for user owner (goblet-squat)', cause,
    );
  });

  it.each(['INVALID_INPUT', 'EXERCISE_NOT_FOUND'])('omits the link on %s without confirming absence', async (code) => {
    execute.mockResolvedValue({ ok: false, error: { code, message: 'Expected error' } });
    expect(await buildExerciseHistoryPresenceView('owner', 'goblet-squat')).toEqual({ status: 'unavailable' });
  });
});
