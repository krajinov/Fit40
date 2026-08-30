/**
 * Shared scenario fixtures for the progression engine test suites.
 *
 * Not a test file: imported by the `exercise-progression*.test.ts` suites so
 * every suite drives the public engine API with identical builders.
 */

import { createExercise, type Exercise } from '@/domain/entities/exercise';
import type { DurationSetLog, RepSetLog, SetLog } from '@/domain/entities/workout-session';
import type {
  NextExerciseTarget,
  PreviousExercisePerformance,
} from '@/domain/services/exercise-progression';
import {
  Difficulty,
  EquipmentType,
  MovementPattern,
  MuscleGroup,
} from '@/domain/types/exercise';
import {
  createDurationScheme,
  createRepScheme,
  type RepPrescription,
} from '@/domain/value-objects/rep-prescription';

// ─── Builders ────────────────────────────────────────────────────────────────

export function makeExercise(equipment: EquipmentType): Exercise {
  const result = createExercise({
    id: 'ex-progression-001',
    name: 'Progression Test',
    slug: 'progression-test',
    description: 'Test exercise.',
    primaryMuscle: MuscleGroup.Chest,
    secondaryMuscles: [],
    equipment,
    difficulty: Difficulty.Beginner,
    movementPattern: MovementPattern.PushHorizontal,
    considerations: [],
  });
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

export function scheme(sets: number, minReps: number, maxReps: number): RepPrescription {
  const result = createRepScheme(sets, minReps, maxReps);
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

export function timed(sets: number, seconds: number): RepPrescription {
  const result = createDurationScheme(sets, seconds);
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

export function repSet(setNumber: number, reps: number, weightKg: number | null): RepSetLog {
  return { type: 'reps', setNumber, reps, weightKg, rpe: null };
}

export function durationSet(setNumber: number, seconds: number, weightKg: number | null): DurationSetLog {
  return { type: 'duration', setNumber, durationSeconds: seconds, weightKg, rpe: null };
}

export function performance(
  prescription: RepPrescription,
  sets: ReadonlyArray<SetLog>,
): PreviousExercisePerformance {
  return { prescription, sets };
}

// ─── Shared Fixtures ──────────────────────────────────────────────────────────

export const threeByEightToTen = scheme(3, 8, 10);
export const threeByEightToTwelve = scheme(3, 8, 12);
export const threeByTenToTwelve = scheme(3, 10, 12);
export const twoByTenToTwelve = scheme(2, 10, 12);
export const threeBySixToEight = scheme(3, 6, 8);
export const threeByThirtySeconds = timed(3, 30);

export interface Scenario {
  readonly name: string;
  readonly equipment: EquipmentType;
  readonly prescription: RepPrescription;
  readonly previous: PreviousExercisePerformance | null;
  readonly expected: NextExerciseTarget;
}
