/**
 * Unit tests for the shared session mutation submit factory (PR #13 Finding 3
 * refactor): the one `useActionState`-compatible action body the adjustment
 * panel's skip, unskip and move paths now share. It must apply every route
 * field, invoke the injected Server Action exactly once, refresh ONLY on the
 * centralized stale-server-state codes, and return the action's result
 * verbatim.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createSessionMutationSubmit } from '@/features/sessions/session-mutation-submit';
import type { SessionActionErrorCode, SessionActionState } from '@/features/sessions/types/session-action-state';

const applyRouteFields = vi.fn((formData: FormData): void => {
  formData.set('sessionId', 's-1');
  formData.set('exerciseOrder', '1');
  formData.set('expectedSessionVersion', '0');
  formData.set('programSlug', 'prog');
  formData.set('weekNumber', '1');
  formData.set('workoutOrder', '1');
});
const refresh = vi.fn();

/** A fake Server Action resolving with the given state, capturing its FormData. */
function makeAction(result: SessionActionState) {
  return vi.fn(async (formData: FormData): Promise<SessionActionState> => {
    // The action receives the FormData the submit factory assembled; keep the
    // parameter used so mock.calls[0][0] is typed for the route-field checks.
    if (!(formData instanceof FormData)) {
      throw new Error('submit factory must pass a FormData instance to the action');
    }
    return result;
  });
}

const STALE_CODES: ReadonlyArray<SessionActionErrorCode> = [
  'SESSION_MODIFIED',
  'SUBSTITUTION_NO_CHANGE',
  'ADJUSTMENT_NO_CHANGE',
  'MOVE_OUT_OF_RANGE',
  'EXERCISE_HAS_LOGGED_SETS',
  'SESSION_ALREADY_COMPLETED',
  'NOT_ENROLLED',
];

const ORDINARY_CODES: ReadonlyArray<SessionActionErrorCode> = [
  'INVALID_INPUT',
  'EXERCISE_NOT_FOUND',
  'EXERCISE_LOG_NOT_FOUND',
  'FORBIDDEN',
  'VALIDATION_ERROR',
];

describe('createSessionMutationSubmit', () => {
  beforeEach(() => {
    refresh.mockClear();
    applyRouteFields.mockClear();
  });

  it('applies the route fields, calls the action, and returns the result verbatim on success', async () => {
    const action = makeAction({ ok: true });
    const submit = createSessionMutationSubmit({ router: { refresh }, applyRouteFields, action });

    const result = await submit({ ok: true }, new FormData());

    expect(result).toEqual({ ok: true });
    expect(action).toHaveBeenCalledTimes(1);
    const calledWith = action.mock.calls[0]?.[0];
    expect(calledWith?.get('sessionId')).toBe('s-1');
    expect(calledWith?.get('exerciseOrder')).toBe('1');
    expect(calledWith?.get('expectedSessionVersion')).toBe('0');
    expect(calledWith?.get('programSlug')).toBe('prog');
    expect(calledWith?.get('weekNumber')).toBe('1');
    expect(calledWith?.get('workoutOrder')).toBe('1');
  });

  it.each(STALE_CODES)('refreshes on the stale-server-state code %s', async (code) => {
    const action = makeAction({ ok: false, error: { code, message: 'x' } });
    const submit = createSessionMutationSubmit({ router: { refresh }, applyRouteFields, action });

    const result = await submit({ ok: true }, new FormData());

    expect(result).toEqual({ ok: false, error: { code, message: 'x' } });
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it.each(ORDINARY_CODES)('never refreshes on the ordinary failure code %s', async (code) => {
    const action = makeAction({ ok: false, error: { code, message: 'x' } });
    const submit = createSessionMutationSubmit({ router: { refresh }, applyRouteFields, action });

    await submit({ ok: true }, new FormData());

    expect(refresh).not.toHaveBeenCalled();
  });

  it('never refreshes on success', async () => {
    const action = makeAction({ ok: true });
    const submit = createSessionMutationSubmit({ router: { refresh }, applyRouteFields, action });

    await submit({ ok: true }, new FormData());

    expect(refresh).not.toHaveBeenCalled();
  });

  it('one factory per path without cross-talk: each submission reaches exactly its own action', async () => {
    const skip = makeAction({ ok: true });
    const move = makeAction({ ok: false, error: { code: 'MOVE_OUT_OF_RANGE', message: 'x' } });
    const submitSkip = createSessionMutationSubmit({ router: { refresh }, applyRouteFields, action: skip });
    const submitMove = createSessionMutationSubmit({ router: { refresh }, applyRouteFields, action: move });

    await submitSkip({ ok: true }, new FormData());
    await submitMove({ ok: true }, new FormData());

    expect(skip).toHaveBeenCalledTimes(1);
    expect(move).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
