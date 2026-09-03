import { describe, expect, it } from 'vitest';

import { parseHistoryPageQuery } from '@/features/history/schemas/history-page-schema';

describe('parseHistoryPageQuery', () => {
  it('returns a null cursor when the param is absent', () => {
    expect(parseHistoryPageQuery({})).toEqual({ cursor: null });
    expect(parseHistoryPageQuery({ other: 'value' })).toEqual({ cursor: null });
  });

  it('treats an empty cursor as absence (first page)', () => {
    expect(parseHistoryPageQuery({ cursor: '' })).toEqual({ cursor: null });
  });

  it('treats array-valued cursors as absence instead of crashing', () => {
    expect(parseHistoryPageQuery({ cursor: ['a', 'b'] })).toEqual({ cursor: null });
  });

  it('passes a structurally valid cursor through untouched', () => {
    const token = 'eyJ2IjoxLCJjIjoiMjAyNi0wMi0xNSJ9';
    expect(parseHistoryPageQuery({ cursor: token })).toEqual({ cursor: token });
  });
});
