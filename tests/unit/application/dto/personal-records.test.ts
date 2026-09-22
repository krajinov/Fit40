import { describe, expect, it } from 'vitest';

import { toPersonalBestDto } from '@/application/dto/personal-records';
import type { PersonalBest } from '@/domain/services/personal-records';
import { RecordMetric } from '@/domain/services/personal-record-metrics';
import { createExerciseId, createWorkoutSessionId } from '@/domain/types/ids';

function eid(value: string) {
  const result = createExerciseId(value);
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

function sid(value: string) {
  const result = createWorkoutSessionId(value);
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

function best(overrides?: Partial<PersonalBest>): PersonalBest {
  return {
    exerciseId: eid('ex-001'),
    metric: RecordMetric.MaxLoad,
    value: 82.5,
    position: {
      completedAt: new Date('2026-02-15T11:00:00Z'),
      startedAt: new Date('2026-02-15T10:00:00Z'),
      sessionId: sid('session-owner'),
      exerciseOrder: 2,
      setNumber: 3,
    },
    ...overrides,
  };
}

describe('toPersonalBestDto', () => {
  it('flattens the record into serializable fields, including the owning position', () => {
    expect(toPersonalBestDto(best())).toEqual({
      exerciseId: 'ex-001',
      metric: 'max-load',
      value: 82.5,
      sessionId: 'session-owner',
      exerciseOrder: 2,
      setNumber: 3,
      completedAt: '2026-02-15T11:00:00.000Z',
    });
  });

  it('keeps a logged 0 kg as a real value', () => {
    const dto = toPersonalBestDto(best({ value: 0 }));

    expect(dto.value).toBe(0);
    expect(Object.is(dto.value, 0)).toBe(true);
  });

  it('carries every metric of the closed taxonomy unchanged', () => {
    const metrics = [
      RecordMetric.MaxLoad,
      RecordMetric.MaxBodyweightReps,
      RecordMetric.MaxDuration,
    ] as const;

    expect(metrics.map((metric) => toPersonalBestDto(best({ metric })).metric)).toEqual([
      'max-load',
      'max-bodyweight-reps',
      'max-duration',
    ]);
  });

  it('preserves fractional precision without rounding it', () => {
    expect(toPersonalBestDto(best({ value: 52.25 })).value).toBe(52.25);
  });
});
