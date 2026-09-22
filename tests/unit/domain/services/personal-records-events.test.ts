/**
 * M12 historical event resolution: the strict comparison rule in isolation
 * from the chronological fold.
 */

import { describe, expect, it } from 'vitest';

import {
  RecordMetric,
  type PerformancePosition,
  type RecordCandidate,
} from '@/domain/services/personal-record-metrics';
import { resolveRecordEvents, type CandidatePriorBest } from '@/domain/services/personal-records';
import { eid, eventLines, sessionId } from './personal-records.fixtures';

// ─── Position helpers ────────────────────────────────────────────────────────

function positionAt(overrides: Partial<PerformancePosition> = {}): PerformancePosition {
  return {
    completedAt: new Date('2025-01-01T10:00:00Z'),
    startedAt: new Date('2025-01-01T09:00:00Z'),
    sessionId: sessionId('s-1'),
    exerciseOrder: 1,
    setNumber: 1,
    ...overrides,
  };
}

function candidateAt(
  exerciseId: string,
  metric: RecordMetric,
  value: number,
  overrides: Partial<PerformancePosition> = {},
): RecordCandidate {
  return { exerciseId: eid(exerciseId), metric, value, position: positionAt(overrides) };
}

function paired(candidate: RecordCandidate, bestBefore: number | null): CandidatePriorBest {
  return { candidate, bestBefore };
}

describe('resolveRecordEvents — historical strictness', () => {
  function lines(entries: ReadonlyArray<CandidatePriorBest>): ReadonlyArray<string> {
    return eventLines(resolveRecordEvents(entries));
  }

  it('treats a first exposure as a record with no previous best', () => {
    expect(lines([paired(candidateAt('ex-a', RecordMetric.MaxLoad, 80), null)])).toEqual([
      'ex-a/max-load/80/prev:none@s-1.1.1',
    ]);
  });

  it('treats a 0 kg first exposure as a record, never as a missing value', () => {
    expect(lines([paired(candidateAt('ex-a', RecordMetric.MaxLoad, 0), null)])).toEqual([
      'ex-a/max-load/0/prev:none@s-1.1.1',
    ]);
  });

  it('treats a strictly greater performance as a record', () => {
    expect(lines([paired(candidateAt('ex-a', RecordMetric.MaxLoad, 85), 80)])).toEqual([
      'ex-a/max-load/85/prev:80@s-1.1.1',
    ]);
  });

  it('does not treat an equal performance as a record', () => {
    expect(lines([paired(candidateAt('ex-a', RecordMetric.MaxLoad, 80), 80)])).toEqual([]);
  });

  it('does not treat a lower performance as a record', () => {
    expect(lines([paired(candidateAt('ex-a', RecordMetric.MaxLoad, 75), 80)])).toEqual([]);
  });

  it('resolves entries independently and preserves input order', () => {
    expect(
      lines([
        paired(candidateAt('ex-b', RecordMetric.MaxDuration, 45, { exerciseOrder: 2 }), null),
        paired(candidateAt('ex-a', RecordMetric.MaxLoad, 80), 90),
        paired(candidateAt('ex-a', RecordMetric.MaxLoad, 95, { setNumber: 2 }), 90),
      ]),
    ).toEqual([
      'ex-b/max-duration/45/prev:none@s-1.2.1',
      'ex-a/max-load/95/prev:90@s-1.1.2',
    ]);
  });

  it('judges equal-valued duplicates by their own paired prior best', () => {
    expect(
      lines([
        paired(candidateAt('ex-a', RecordMetric.MaxLoad, 80), 80),
        paired(candidateAt('ex-a', RecordMetric.MaxLoad, 80, { exerciseOrder: 2 }), 70),
      ]),
    ).toEqual(['ex-a/max-load/80/prev:70@s-1.2.1']);
  });
});
