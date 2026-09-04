/**
 * Unit tests for the per-exercise history DTO assembly.
 *
 * `toExerciseHistoryDto` is tested as a pure mapping over fabricated port
 * occurrences, mirroring the use-case test approach. These tests lock the
 * occurrence-identity contract at the application boundary: every trend
 * point carries its (sessionId, exerciseOrder) identity, so two externally
 * loaded occurrences of one exercise in the SAME completed session stay
 * distinct all the way to the screen — React keys must never collide on a
 * shared completedAt.
 */

import { describe, expect, it } from 'vitest';

import {
  toExerciseHistoryDto,
} from '@/application/dto/exercise-history';
import type { CompletedExerciseOccurrence } from '@/application/ports/training-history-repository';
import { createExercise } from '@/domain/entities/exercise';
import type { SetLog } from '@/domain/entities/workout-session';
import { Difficulty, EquipmentType, MovementPattern, MuscleGroup } from '@/domain/types/exercise';
import { createWorkoutSessionId } from '@/domain/types/ids';
import { createRepScheme } from '@/domain/value-objects/rep-prescription';

function makeExercise() {
  const result = createExercise({
    id: 'ex-002',
    name: 'Goblet Squat',
    slug: 'goblet-squat',
    description: 'Squat pattern with a goblet-held load.',
    primaryMuscle: MuscleGroup.Quadriceps,
    secondaryMuscles: [MuscleGroup.Glutes],
    equipment: EquipmentType.Kettlebell,
    difficulty: Difficulty.Beginner,
    movementPattern: MovementPattern.Squat,
    considerations: [],
  });
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

function makePrescription() {
  const result = createRepScheme(3, 8, 10);
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

const exercise = makeExercise();
const prescription = makePrescription();

/**
 * One externally loaded occurrence of `exercise` in a completed session.
 * `sessionId`/`exerciseOrder` are the occurrence's identity components;
 * `completedAt` is shared when both occurrences live in the same session.
 */
function occurrence(input: {
  readonly sessionId: string;
  readonly exerciseOrder: number;
  readonly weightKg: number;
}): CompletedExerciseOccurrence {
  const sessionId = (() => {
    const result = createWorkoutSessionId(input.sessionId);
    if (!result.ok) throw new Error(result.error.message);
    return result.data;
  })();

  const sets: ReadonlyArray<SetLog> = [
    { type: 'reps', setNumber: 1, reps: 10, weightKg: input.weightKg, rpe: null },
  ];

  return {
    sessionId,
    exerciseOrder: input.exerciseOrder,
    completedAt: new Date('2026-02-15T11:00:00Z'),
    programName: 'Fit40 Beginner Strength',
    workoutName: 'Full Body A',
    prescription,
    sets,
  };
}

describe('toExerciseHistoryDto — trend occurrence identity', () => {
  it('preserves both same-session occurrences as distinct trend points', () => {
    // The collision case: the same exercise twice in ONE completed session.
    // Both occurrences are externally loaded and share an identical
    // completedAt — only (sessionId, exerciseOrder) distinguishes them.
    const dto = toExerciseHistoryDto(exercise, [
      occurrence({ sessionId: 'session-dup', exerciseOrder: 1, weightKg: 40 }),
      occurrence({ sessionId: 'session-dup', exerciseOrder: 2, weightKg: 44 }),
    ]);

    // Both occurrences survive into the trend (chronological: newest-first
    // entries reversed — exerciseOrder 2 then 1 for the same instant).
    expect(dto.trend).toHaveLength(2);
    expect(dto.trend.map((point) => point.workingLoadKg)).toEqual([44, 40]);
    expect(dto.trend.map((point) => `${point.sessionId}#${point.exerciseOrder}`)).toEqual([
      'session-dup#2',
      'session-dup#1',
    ]);
    // Identical completion instants prove identity is NOT the timestamp:
    // a completedAt-derived key would have collided here.
    expect(new Set(dto.trend.map((point) => point.completedAt))).toHaveLength(1);
  });

  it('keys every trend point uniquely by (sessionId, exerciseOrder)', () => {
    const dto = toExerciseHistoryDto(exercise, [
      occurrence({ sessionId: 'session-a', exerciseOrder: 1, weightKg: 50 }),
      occurrence({ sessionId: 'session-b', exerciseOrder: 1, weightKg: 52.5 }),
    ]);

    const keys = dto.trend.map((point) => `${point.sessionId}#${point.exerciseOrder}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
