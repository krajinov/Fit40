import { describe, expect, it } from 'vitest';

import type { SetLog } from '@/domain/entities/workout-session';
import { createDurationScheme, createRepScheme } from '@/domain/value-objects/rep-prescription';
import { resolveOccurrenceWorkingLoad } from '@/domain/services/occurrence-working-load';
import { calculateNextExerciseTarget } from '@/domain/services/exercise-progression';
import type { Exercise } from '@/domain/entities/exercise';
import { Difficulty, EquipmentType, MovementPattern, MuscleGroup } from '@/domain/types/exercise';
import { createExerciseId } from '@/domain/types/ids';

function reps() {
  const result = createRepScheme(3, 8, 10);
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

function duration() {
  const result = createDurationScheme(3, 45);
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

function repSet(setNumber: number, weightKg: number | null, repsCount = 10): SetLog {
  return { type: 'reps', setNumber, reps: repsCount, weightKg, rpe: null };
}

function durationSet(setNumber: number): SetLog {
  return { type: 'duration', setNumber, durationSeconds: 45, weightKg: null, rpe: null };
}

describe('resolveOccurrenceWorkingLoad (history mirror — NOT a progression input)', () => {
  it('returns the minimum load across all performed sets', () => {
    const load = resolveOccurrenceWorkingLoad(reps(), [
      repSet(1, 50),
      repSet(2, 45),
      repSet(3, 55),
    ]);
    expect(load).toEqual({ kind: 'external', loadKg: 45 });
  });

  it('treats a logged 0 kg as a real external load', () => {
    const load = resolveOccurrenceWorkingLoad(reps(), [repSet(1, 0), repSet(2, 0)]);
    expect(load).toEqual({ kind: 'external', loadKg: 0 });
  });

  it('marks the occurrence unloaded when any performed set has no external load', () => {
    const load = resolveOccurrenceWorkingLoad(reps(), [repSet(1, 50), repSet(2, null)]);
    expect(load).toEqual({ kind: 'unloaded' });
  });

  it('marks duration prescriptions unloaded regardless of logged loads', () => {
    const load = resolveOccurrenceWorkingLoad(duration(), [durationSet(1)]);
    expect(load).toEqual({ kind: 'unloaded' });
  });

  it('degrades to unloaded on empty sets (defensive — the port guarantees ≥1)', () => {
    const load = resolveOccurrenceWorkingLoad(reps(), []);
    expect(load).toEqual({ kind: 'unloaded' });
  });

  it('considers every performed set, not only the first prescribed sets', () => {
    // Two prescribed, three performed: the display load spans all three,
    // unlike the engine's considered-sets slice.
    const scheme = createRepScheme(2, 8, 10);
    if (!scheme.ok) throw new Error(scheme.error.message);
    const load = resolveOccurrenceWorkingLoad(scheme.data, [
      repSet(1, 40),
      repSet(2, 50),
      repSet(3, 30),
    ]);
    expect(load).toEqual({ kind: 'external', loadKg: 30 });
  });
});

describe('progression engine regression (mirror must not touch it)', () => {
  function exercise(): Exercise {
    const idResult = createExerciseId('ex-regression');
    if (!idResult.ok) throw new Error(idResult.error.message);
    return {
      id: idResult.data,
      name: 'Regression Squat',
      slug: 'regression-squat',
      description: 'Guard exercise for engine behavior.',
      primaryMuscle: MuscleGroup.Quadriceps,
      secondaryMuscles: [],
      equipment: EquipmentType.Dumbbell,
      difficulty: Difficulty.Beginner,
      movementPattern: MovementPattern.Squat,
      considerations: [],
    };
  }

  it('keeps deciding increase/hold/regress exactly from its own semantics', () => {
    const scheme = reps();
    // All sets at target on a uniform load → increase by the 2 kg step.
    expect(
      calculateNextExerciseTarget(exercise(), scheme, {
        prescription: scheme,
        sets: [repSet(1, 50, 10), repSet(2, 50, 10), repSet(3, 50, 10)],
      }),
    ).toEqual({
      basis: 'increase',
      previousLoadKg: 50,
      nextLoadKg: 52,
      incrementKg: 2,
    });

    // Mixed loads at target never increase — uniform requirement holds.
    // The mixed target narrows to hold, which carries previousLoadKg.
    const mixed = calculateNextExerciseTarget(exercise(), scheme, {
      prescription: scheme,
      sets: [repSet(1, 50, 10), repSet(2, 45, 10), repSet(3, 50, 10)],
    });
    if (mixed.basis !== 'hold') {
      throw new Error(`expected hold, got ${mixed.basis}`);
    }
    expect(mixed.previousLoadKg).toBe(45);

    // A bodyweight set is still a bodyweight recommendation — not a load.
    expect(
      calculateNextExerciseTarget(exercise(), scheme, {
        prescription: scheme,
        sets: [repSet(1, null)],
      }).basis,
    ).toBe('bodyweight');

    // Duration prescriptions still route to the duration basis.
    expect(
      calculateNextExerciseTarget(exercise(), duration(), {
        prescription: duration(),
        sets: [durationSet(1)],
      }).basis,
    ).toBe('duration');
  });
});
