import { describe, expect, it } from 'vitest';

import {
  DEFAULT_TRAINING_HISTORY_PAGE_SIZE,
  MAX_TRAINING_HISTORY_PAGE_SIZE,
  MIN_TRAINING_HISTORY_PAGE_SIZE,
  decodeTrainingHistoryCursor,
  encodeTrainingHistoryCursor,
  resolveTrainingHistoryLimit,
} from '@/application/dto/training-history';
import { createWorkoutSessionId } from '@/domain/types/ids';

const SESSION_ID = (() => {
  const result = createWorkoutSessionId('session-history-1');
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
})();

const CURSOR = {
  completedAt: new Date('2026-03-01T10:00:00Z'),
  startedAt: new Date('2026-03-01T09:30:00Z'),
  sessionId: SESSION_ID,
};

function decodeOk(token: string) {
  const result = decodeTrainingHistoryCursor(token);
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

describe('training history cursor codec', () => {
  it('round-trips a keyset position exactly', () => {
    const token = encodeTrainingHistoryCursor(CURSOR);
    const decoded = decodeOk(token);

    expect(decoded.completedAt.toISOString()).toBe(CURSOR.completedAt.toISOString());
    expect(decoded.startedAt.toISOString()).toBe(CURSOR.startedAt.toISOString());
    expect(decoded.sessionId).toBe(CURSOR.sessionId);
  });

  it('produces an opaque base64url token without padding characters', () => {
    const token = encodeTrainingHistoryCursor(CURSOR);
    expect(token).not.toMatch(/[+/=]/);
    expect(() => Buffer.from(token, 'base64url')).not.toThrow();
  });

  it('is not human-readable as a pipe-separated token', () => {
    const token = encodeTrainingHistoryCursor(CURSOR);
    const raw = Buffer.from(token, 'base64url').toString('utf8');
    expect(raw.startsWith('{')).toBe(true);
  });

  it('rejects a tampered payload with a changed version', () => {
    const tampered = Buffer.from(
      JSON.stringify({ v: 2, c: '2026-03-01T10:00:00Z', s: '2026-03-01T09:30:00Z', i: 'session-history-1' }),
      'utf8',
    ).toString('base64url');
    expect(decodeTrainingHistoryCursor(tampered).ok).toBe(false);
  });

  it('rejects a structurally valid JSON that is not a cursor payload', () => {
    const foreign = Buffer.from(JSON.stringify({ hello: 'world' }), 'utf8').toString('base64url');
    expect(decodeTrainingHistoryCursor(foreign).ok).toBe(false);
  });

  it('rejects a payload missing required fields', () => {
    const missing = Buffer.from(
      JSON.stringify({ v: 1, c: '2026-03-01T10:00:00Z', s: '2026-03-01T09:30:00Z' }),
      'utf8',
    ).toString('base64url');
    expect(decodeTrainingHistoryCursor(missing).ok).toBe(false);
  });

  it('rejects an invalid timestamp field', () => {
    const invalid = Buffer.from(
      JSON.stringify({ v: 1, c: 'not-a-date', s: '2026-03-01T09:30:00Z', i: 'session-history-1' }),
      'utf8',
    ).toString('base64url');
    const result = decodeTrainingHistoryCursor(invalid);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain('completedAt');
    }
  });

  it('rejects an empty session id', () => {
    const empty = Buffer.from(
      JSON.stringify({ v: 1, c: '2026-03-01T10:00:00 +00:00', s: '2026-03-01T09:30:00Z', i: '' }),
      'utf8',
    ).toString('base64url');
    expect(decodeTrainingHistoryCursor(empty).ok).toBe(false);
  });

  it('rejects garbage that is not base64url JSON', () => {
    expect(decodeTrainingHistoryCursor('not-a-cursor').ok).toBe(false);
    expect(decodeTrainingHistoryCursor('').ok).toBe(false);
    expect(decodeTrainingHistoryCursor('!!!').ok).toBe(false);
  });

  it('accepts a valid token even after its JSON is re-encoded elsewhere', () => {
    // A client may strip or re-add base64url padding across transports; the
    // codec only relies on Node's base64url decoder, which tolerates both.
    const token = encodeTrainingHistoryCursor(CURSOR);
    const roundTripped = Buffer.from(token, 'base64url').toString('base64url');
    expect(decodeTrainingHistoryCursor(roundTripped).ok).toBe(true);
  });
});

describe('training history page size normalization', () => {
  it('defaults to 20 when no limit is given', () => {
    const result = resolveTrainingHistoryLimit(undefined);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).toBe(DEFAULT_TRAINING_HISTORY_PAGE_SIZE);
  });

  it('clamps integers below the minimum to 1', () => {
    const result = resolveTrainingHistoryLimit(0);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).toBe(MIN_TRAINING_HISTORY_PAGE_SIZE);
    const negative = resolveTrainingHistoryLimit(-5);
    expect(negative.ok).toBe(true);
    if (negative.ok) expect(negative.data).toBe(MIN_TRAINING_HISTORY_PAGE_SIZE);
  });

  it('clamps integers above the maximum to 50', () => {
    const result = resolveTrainingHistoryLimit(500);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).toBe(MAX_TRAINING_HISTORY_PAGE_SIZE);
  });

  it('keeps in-range integers unchanged', () => {
    for (const limit of [1, 7, 20, 50]) {
      const result = resolveTrainingHistoryLimit(limit);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.data).toBe(limit);
    }
  });

  it('rejects non-integers with a typed field error', () => {
    for (const bad of [1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const result = resolveTrainingHistoryLimit(bad);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.field).toBe('limit');
        expect(result.error.message).toContain('integer');
      }
    }
  });
});

