import { describe, expect, it } from 'vitest';

import {
  formatHistoryCount,
  formatHistoryDate,
  formatHistoryElapsed,
  formatHistoryVolume,
  formatSessionSetLine,
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
  it('formats zero volume', () => {
    expect(formatHistoryVolume(0)).toBe('0 kg');
  });

  it('formats whole volumes without decimals', () => {
    expect(formatHistoryVolume(760)).toBe('760 kg');
  });

  it('rounds fractional volumes to whole kilograms', () => {
    expect(formatHistoryVolume(1234.6)).toBe('1,235 kg');
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
});
