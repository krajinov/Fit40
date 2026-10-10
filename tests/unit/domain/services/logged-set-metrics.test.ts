import { describe, expect, it } from 'vitest';

import type { SetLog } from '@/domain/entities/workout-session';
import { calculateLoggedSetMetrics } from '@/domain/services/session-metrics';

const reps = (weightKg: number | null): SetLog => ({
  type: 'reps', setNumber: 1, reps: 8, weightKg, rpe: null,
});
const duration: SetLog = {
  type: 'duration', setNumber: 1, durationSeconds: 30, weightKg: 50, rpe: null,
};

describe('shared logged-set metrics authority', () => {
  it('keeps empty, bodyweight and weighted-duration data absent', () => {
    for (const sets of [[], [reps(null)], [duration], [reps(null), duration]]) {
      expect(calculateLoggedSetMetrics(sets)).toMatchObject({ volume: 0, hasExternalLoad: false });
    }
  });

  it('preserves genuine zero and mixed-set counts without treating duration load as volume', () => {
    expect(calculateLoggedSetMetrics([reps(0)])).toMatchObject({ volume: 0, hasExternalLoad: true });
    expect(calculateLoggedSetMetrics([reps(0), reps(12.5), reps(null), duration])).toEqual({
      totalSets: 4, totalReps: 24, totalDurationSeconds: 30, volume: 100, hasExternalLoad: true,
    });
  });
});
