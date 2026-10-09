import { describe, expect, it } from 'vitest';

import {
  formatHistoryCount,
  formatHistoryDate,
  formatHistoryElapsed,
  formatHistoryVolume,
  formatSessionSetLine,
  hasEligibleExternalLoad,
} from '@/features/history/history-labels';
import type { CompletedSessionSetDto } from '@/application/dto/completed-session';

describe('formatHistoryDate', () => {
  it('formats a completion instant as a concise UTC date', () => {
    expect(formatHistoryDate('2026-02-15T11:00:00Z')).toBe('Feb 15, 2026');
  });

  it('stays on the UTC calendar day regardless of the server timezone', () => {
    // 23:59 UTC must not roll over to the next day (no hydration drift).
    expect(formatHistoryDate('2026-02-15T23:59:59Z')).toBe('Feb 15, 2026');
  });

  it('formats other months and years', () => {
    expect(formatHistoryDate('2025-12-31T12:00:00Z')).toBe('Dec 31, 2025');
  });
});

describe('formatHistoryCount', () => {
  it('renders zero without special cases', () => {
    expect(formatHistoryCount(0)).toBe('0');
  });

  it('renders small counts without grouping', () => {
    expect(formatHistoryCount(18)).toBe('18');
  });

  it('groups thousands', () => {
    expect(formatHistoryCount(1240)).toBe('1,240');
  });
});

describe('formatHistoryVolume', () => {
  it('renders a genuine zero with the load × reps unit', () => {
    expect(formatHistoryVolume(0)).toBe('0 kg × reps');
  });

  it('formats whole volumes without decimals', () => {
    expect(formatHistoryVolume(760)).toBe('760 kg × reps');
  });

  it('rounds fractional volumes to whole kg × reps', () => {
    expect(formatHistoryVolume(1234.6)).toBe('1,235 kg × reps');
  });
});

describe('hasEligibleExternalLoad', () => {
  /** One logged occurrence carrying the given sets. */
  function log(
    sets: ReadonlyArray<{ readonly type: 'reps' | 'duration'; readonly weightKg: number | null }>,
  ) {
    return { sets };
  }

  it('is true for a rep set with an external load', () => {
    expect(hasEligibleExternalLoad([log([{ type: 'reps', weightKg: 20 }])])).toBe(true);
  });

  it('is true for eligible 0 kg rep sets — a genuine zero is still data', () => {
    expect(
      hasEligibleExternalLoad([
        log([
          { type: 'reps', weightKg: 0 },
          { type: 'reps', weightKg: 0 },
        ]),
      ]),
    ).toBe(true);
  });

  it('is false for bodyweight rep sets (null weight)', () => {
    expect(hasEligibleExternalLoad([log([{ type: 'reps', weightKg: null }])])).toBe(false);
  });

  it('is false for duration sets even when a weight was logged on timed work', () => {
    expect(
      hasEligibleExternalLoad([log([{ type: 'duration', weightKg: 10 }])]),
    ).toBe(false);
  });

  it('is false for duration-only work without a weight', () => {
    expect(hasEligibleExternalLoad([log([{ type: 'duration', weightKg: null }])])).toBe(false);
  });

  it('is true when a mixed session has one loaded set among unloaded ones', () => {
    expect(
      hasEligibleExternalLoad([
        log([{ type: 'reps', weightKg: null }]),
        log([{ type: 'reps', weightKg: 30 }]),
      ]),
    ).toBe(true);
  });

  it('is false for sessions without sets or without occurrences', () => {
    expect(hasEligibleExternalLoad([])).toBe(false);
    expect(hasEligibleExternalLoad([log([])])).toBe(false);
  });
});

describe('formatSessionSetLine', () => {
  it('renders a loaded set with an RPE suffix', () => {
    const set: CompletedSessionSetDto = {
      type: 'reps',
      setNumber: 2,
      reps: 10,
      weightKg: 52.5,
      rpe: 7,
    };
    expect(formatSessionSetLine(set)).toBe('52.5 kg × 10 @ RPE 7');
  });

  it('renders 0 kg as a real load, distinct from no external load', () => {
    expect(formatSessionSetLine({ type: 'reps', setNumber: 1, reps: 10, weightKg: 0, rpe: null })).toBe(
      '0 kg × 10',
    );
    expect(formatSessionSetLine({ type: 'reps', setNumber: 1, reps: 10, weightKg: null, rpe: null })).toBe(
      '10 reps',
    );
  });

  it('renders timed work, loaded and bodyweight, with optional RPE', () => {
    expect(
      formatSessionSetLine({ type: 'duration', setNumber: 1, durationSeconds: 45, weightKg: null, rpe: null }),
    ).toBe('45 sec');
    expect(
      formatSessionSetLine({ type: 'duration', setNumber: 1, durationSeconds: 30, weightKg: 10, rpe: 8 }),
    ).toBe('10 kg × 30 sec @ RPE 8');
  });
});

describe('formatHistoryElapsed', () => {
  it('formats sub-hour and hour-plus elapsed times', () => {
    expect(formatHistoryElapsed(45 * 60)).toBe('45 min');
    expect(formatHistoryElapsed(65 * 60)).toBe('1 hr 5 min');
    expect(formatHistoryElapsed(120 * 60)).toBe('2 hr');
  });

  it('renders sub-minute sessions truthfully instead of flooring to 0 min', () => {
    expect(formatHistoryElapsed(1)).toBe('<1 min');
    expect(formatHistoryElapsed(59)).toBe('<1 min');
  });

  it('keeps whole-minute formatting at the 60-second boundary', () => {
    expect(formatHistoryElapsed(60)).toBe('1 min');
  });
});
