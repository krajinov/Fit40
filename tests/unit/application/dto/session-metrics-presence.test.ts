import { describe, expect, it } from 'vitest';

import { toCompletedSessionDto } from '@/application/dto/completed-session';
import { toTrainingHistorySessionDto } from '@/application/dto/training-history';
import { toWorkoutSessionDto } from '@/application/dto/workout-session';
import { createWorkoutSession, type SetLog } from '@/domain/entities/workout-session';
import { calculateSessionMetrics } from '@/domain/services/session-metrics';
import { createExerciseId, createScheduledWorkoutId, createUserId, createWorkoutId } from '@/domain/types/ids';
import { createDurationScheme, createRepScheme } from '@/domain/value-objects/rep-prescription';
import type { Result } from '@/domain/types/result';

function value<T, E>(result: Result<T, E>): T {
  if (!result.ok) throw new Error('Invalid fixture');
  return result.data;
}

function rep(weightKg: number | null): SetLog {
  return { type: 'reps', setNumber: 1, reps: 8, weightKg, rpe: null };
}
const timed: SetLog = { type: 'duration', setNumber: 1, durationSeconds: 30, weightKg: 50, rpe: null };

const cases: ReadonlyArray<{
  name: string; reps: ReadonlyArray<SetLog>; duration: ReadonlyArray<SetLog>;
  hasExternalLoad: boolean; volume: number;
}> = [
  { name: 'empty', reps: [], duration: [], hasExternalLoad: false, volume: 0 },
  { name: 'bodyweight', reps: [rep(null)], duration: [], hasExternalLoad: false, volume: 0 },
  { name: 'weighted duration', reps: [], duration: [timed], hasExternalLoad: false, volume: 0 },
  { name: 'genuine zero', reps: [rep(0)], duration: [], hasExternalLoad: true, volume: 0 },
  { name: 'positive load', reps: [rep(12.5)], duration: [], hasExternalLoad: true, volume: 100 },
  { name: 'mixed', reps: [rep(null), { ...rep(12.5), setNumber: 2 }], duration: [timed], hasExternalLoad: true, volume: 100 },
];

describe('Domain presence across all session DTO boundaries', () => {
  it.each(cases)('preserves $name eligibility and volume', (fixture) => {
    const initial = value(createWorkoutSession({
      id: 'presence-session', userId: value(createUserId('owner')), enrollmentId: null,
      scheduledWorkoutId: value(createScheduledWorkoutId('scheduled')), workoutId: value(createWorkoutId('workout')),
      startedAt: new Date('2026-07-01T09:00:00Z'),
      exerciseLogs: [
        { authoredExerciseId: value(createExerciseId('reps')), order: 1, prescription: value(createRepScheme(2, 8, 10)), restSeconds: 60 },
        { authoredExerciseId: value(createExerciseId('timed')), order: 2, prescription: value(createDurationScheme(1, 30)), restSeconds: 60 },
      ],
    }));
    // Empty completed sessions are a supported defensive history shape.
    const session = {
      ...initial, completedAt: new Date('2026-07-01T10:00:00Z'),
      exerciseLogs: initial.exerciseLogs.map((log, index) => ({ ...log, sets: index === 0 ? fixture.reps : fixture.duration })),
    };
    const context = { session, workoutName: 'Workout', programName: 'Program' };
    const expected = calculateSessionMetrics(session);
    expect(expected.hasExternalLoad).toBe(fixture.hasExternalLoad);
    expect(expected.volume).toBe(fixture.volume);
    for (const metrics of [
      toWorkoutSessionDto(session).metrics,
      toTrainingHistorySessionDto(context).metrics,
      toCompletedSessionDto(context, new Map()).metrics,
    ]) {
      expect(metrics).toEqual(expected);
      expect(JSON.parse(JSON.stringify(metrics))).toEqual(expected);
    }
  });
});
