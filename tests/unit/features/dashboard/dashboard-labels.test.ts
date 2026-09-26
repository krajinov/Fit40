import { describe, expect, it } from 'vitest';

import {
  calculateAge,
  formatDashboardDate,
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
