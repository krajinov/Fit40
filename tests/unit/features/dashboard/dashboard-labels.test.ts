import { describe, expect, it } from 'vitest';

import {
  calculateAge,
  formatDashboardDate,
  formatPlannedDateLabel,
} from '@/features/dashboard/dashboard-labels';

describe('formatDashboardDate', () => {
  it('formats a date as an uppercase long weekday and month', () => {
    // UTC-anchored so the assertion is timezone-independent.
    expect(formatDashboardDate(new Date('2026-09-01T12:00:00Z'))).toBe(
      'TUESDAY, SEPTEMBER 1',
    );
  });

  it('does not shift across server timezones', () => {
    expect(formatDashboardDate(new Date('2026-12-31T23:30:00Z'))).toBe(
      'THURSDAY, DECEMBER 31',
    );
  });
});

describe('calculateAge', () => {
  it('derives the age from the birth year', () => {
    expect(calculateAge(1984, new Date('2026-09-01T00:00:00Z'))).toBe(42);
  });
});

describe('formatPlannedDateLabel (M15)', () => {
  it('renders a canonical planned date from its calendar components', () => {
    expect(formatPlannedDateLabel('2026-09-23')).toBe('Sep 23');
    expect(formatPlannedDateLabel('2026-12-31')).toBe('Dec 31');
    expect(formatPlannedDateLabel('2026-01-05')).toBe('Jan 5');
  });

  it('does not depend on any timezone or Date parsing', () => {
    // The formatter never constructs a Date: the label is month-name + day
    // number straight from the string, so it cannot shift across server
    // timezones the way `new Date('YYYY-MM-DD')` + local formatting would.
    const label = formatPlannedDateLabel('2026-09-23');
    expect(label).not.toContain('Invalid');
    expect(label).not.toContain('2026');
    // Pinned regardless of the process TZ (no instant is ever formatted).
    expect(formatPlannedDateLabel('2026-11-01')).toBe('Nov 1');
  });

  it('returns a non-canonical value unchanged instead of fabricating a label', () => {
    expect(formatPlannedDateLabel('23-09-2026')).toBe('23-09-2026');
    expect(formatPlannedDateLabel('2026-13-01')).toBe('2026-13-01');
    expect(formatPlannedDateLabel('')).toBe('');
  });
});
