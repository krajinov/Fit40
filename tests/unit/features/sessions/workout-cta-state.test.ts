/**
 * M17 Slice 11 — the workout detail CTA state.
 *
 * Pure: the state comes from the application's own facts (enrollment, the
 * user-scoped not-performed fact, the session lifecycle) and never from an
 * inference about logged sets or session absence.
 */

import { describe, expect, it } from 'vitest';

import { resolveWorkoutCtaState } from '@/features/sessions/workout-cta-state';

describe('resolveWorkoutCtaState', () => {
  it('suppresses Start for a recorded occurrence — the fact wins over the session', () => {
    // Recording removes the empty session, so the recorded fact is typically
    // paired with "no session": without the fact that would read as `start`.
    expect(
      resolveWorkoutCtaState({
        enrolled: true,
        notPerformedRecorded: true,
        sessionStatus: 'none',
      }),
    ).toBe('not-performed');
    // Even a live session never resurrects Start/Resume for a settled fact.
    expect(
      resolveWorkoutCtaState({
        enrolled: true,
        notPerformedRecorded: true,
        sessionStatus: 'in-progress',
      }),
    ).toBe('not-performed');
  });

  it('keeps the existing behavior when the fact is false', () => {
    expect(
      resolveWorkoutCtaState({ enrolled: true, notPerformedRecorded: false, sessionStatus: 'none' }),
    ).toBe('start');
    expect(
      resolveWorkoutCtaState({
        enrolled: true,
        notPerformedRecorded: false,
        sessionStatus: 'in-progress',
      }),
    ).toBe('resume');
    expect(
      resolveWorkoutCtaState({
        enrolled: true,
        notPerformedRecorded: false,
        sessionStatus: 'completed',
      }),
    ).toBe('completed');
  });

  it('never reports a settlement state for a visitor without a run', () => {
    expect(
      resolveWorkoutCtaState({
        enrolled: false,
        notPerformedRecorded: true,
        sessionStatus: 'none',
      }),
    ).toBe('not-enrolled');
  });
});
