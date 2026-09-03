import { describe, expect, it } from 'vitest';

import {
  formatHistoryCount,
  formatHistoryDate,
  formatHistoryVolume,
} from '@/features/history/history-labels';

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
