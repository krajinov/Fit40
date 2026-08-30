import { describe, expect, it } from 'vitest';

import { createExercise, type Exercise } from '@/domain/entities/exercise';
import type { DurationSetLog, RepSetLog, SetLog } from '@/domain/entities/workout-session';
import {
  calculateNextExerciseTarget,
  EQUIPMENT_LOAD_INCREMENT_KG,
  type NextExerciseTarget,
  type PreviousExercisePerformance,
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

function makeExercise(equipment: EquipmentType): Exercise {
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

function scheme(sets: number, minReps: number, maxReps: number): RepPrescription {
  const result = createRepScheme(sets, minReps, maxReps);
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

function timed(sets: number, seconds: number): RepPrescription {
  const result = createDurationScheme(sets, seconds);
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

function repSet(setNumber: number, reps: number, weightKg: number | null): RepSetLog {
  return { type: 'reps', setNumber, reps, weightKg, rpe: null };
}

function durationSet(setNumber: number, seconds: number, weightKg: number | null): DurationSetLog {
  return { type: 'duration', setNumber, durationSeconds: seconds, weightKg, rpe: null };
}

function performance(
  prescription: RepPrescription,
  sets: ReadonlyArray<SetLog>,
): PreviousExercisePerformance {
  return { prescription, sets };
}

// ─── Shared Fixtures ──────────────────────────────────────────────────────────

const threeByEightToTen = scheme(3, 8, 10);
const threeByEightToTwelve = scheme(3, 8, 12);
const threeByTenToTwelve = scheme(3, 10, 12);
const twoByTenToTwelve = scheme(2, 10, 12);
const threeBySixToEight = scheme(3, 6, 8);
const threeByThirtySeconds = timed(3, 30);

interface Scenario {
  readonly name: string;
  readonly equipment: EquipmentType;
  readonly prescription: RepPrescription;
  readonly previous: PreviousExercisePerformance | null;
  readonly expected: NextExerciseTarget;
}

const SCENARIOS: Scenario[] = [
  {
    name: 'recommends first-exposure when the exercise has no previous performance',
    equipment: EquipmentType.Dumbbell,
    prescription: threeByEightToTen,
    previous: null,
    expected: { basis: 'first-exposure' },
  },
  {
    name: 'recommends first-exposure when a duration prescription has no history',
    equipment: EquipmentType.Barbell,
    prescription: threeByThirtySeconds,
    previous: null,
    expected: { basis: 'first-exposure' },
  },
  {
    name: 'recommends scheme-change when the rep range changed',
    equipment: EquipmentType.Dumbbell,
    prescription: threeByTenToTwelve,
    previous: performance(threeByEightToTen, [
      repSet(1, 10, 20),
      repSet(2, 10, 20),
      repSet(3, 10, 20),
    ]),
    expected: { basis: 'scheme-change' },
  },
  {
    name: 'recommends scheme-change when the set count changed',
    equipment: EquipmentType.Dumbbell,
    prescription: scheme(4, 8, 10),
    previous: performance(threeByEightToTen, [
      repSet(1, 10, 20),
      repSet(2, 10, 20),
      repSet(3, 10, 20),
    ]),
    expected: { basis: 'scheme-change' },
  },
  {
    name: 'recommends scheme-change before the duration basis when the set type changed',
    equipment: EquipmentType.Barbell,
    prescription: threeByThirtySeconds,
    previous: performance(threeByEightToTen, [
      repSet(1, 10, 20),
      repSet(2, 10, 20),
      repSet(3, 10, 20),
    ]),
    expected: { basis: 'scheme-change' },
  },
  {
    name: 'recommends scheme-change when the duration target changed',
    equipment: EquipmentType.Barbell,
    prescription: timed(3, 45),
    previous: performance(threeByThirtySeconds, [
      durationSet(1, 30, null),
      durationSet(2, 30, null),
      durationSet(3, 30, null),
    ]),
    expected: { basis: 'scheme-change' },
  },
  {
    name: 'recommends duration when the prescription matches the previous one',
    equipment: EquipmentType.Barbell,
    prescription: threeByThirtySeconds,
    previous: performance(threeByThirtySeconds, [
      durationSet(1, 30, null),
      durationSet(2, 30, null),
      durationSet(3, 30, null),
    ]),
    expected: { basis: 'duration' },
  },
  {
    name: 'recommends bodyweight when every considered set is unweighted',
    equipment: EquipmentType.Bodyweight,
    prescription: threeByEightToTen,
    previous: performance(threeByEightToTen, [
      repSet(1, 10, null),
      repSet(2, 10, null),
      repSet(3, 10, null),
    ]),
    expected: { basis: 'bodyweight' },
  },
  {
    name: 'recommends bodyweight when one considered set is unweighted',
    equipment: EquipmentType.Dumbbell,
    prescription: threeByEightToTen,
    previous: performance(threeByEightToTen, [
      repSet(1, 10, 20),
      repSet(2, 8, null),
      repSet(3, 10, 20),
    ]),
    expected: { basis: 'bodyweight' },
  },
  {
    name: 'increases the barbell load by 2.5 kg when every set reaches maxReps with a uniform load',
    equipment: EquipmentType.Barbell,
    prescription: threeByEightToTen,
    previous: performance(threeByEightToTen, [
      repSet(1, 10, 20),
      repSet(2, 10, 20),
      repSet(3, 10, 20),
    ]),
    expected: { basis: 'increase', previousLoadKg: 20, nextLoadKg: 22.5, incrementKg: 2.5 },
  },
  {
    name: 'increases the dumbbell load by 2 kg when every set reaches maxReps with a uniform load',
    equipment: EquipmentType.Dumbbell,
    prescription: threeByTenToTwelve,
    previous: performance(threeByTenToTwelve, [
      repSet(1, 12, 12),
      repSet(2, 12, 12),
      repSet(3, 12, 12),
    ]),
    expected: { basis: 'increase', previousLoadKg: 12, nextLoadKg: 14, incrementKg: 2 },
  },
  {
    name: 'treats 0 kg as a real load and increases from it on a machine',
    equipment: EquipmentType.Machine,
    prescription: threeByEightToTen,
    previous: performance(threeByEightToTen, [
      repSet(1, 10, 0),
      repSet(2, 10, 0),
      repSet(3, 10, 0),
    ]),
    expected: { basis: 'increase', previousLoadKg: 0, nextLoadKg: 2.5, incrementKg: 2.5 },
  },
  {
    name: 'increases by the default 2.5 kg increment for equipment without a finer step',
    equipment: EquipmentType.ResistanceBand,
    prescription: twoByTenToTwelve,
    previous: performance(twoByTenToTwelve, [repSet(1, 12, 15), repSet(2, 12, 15)]),
    expected: { basis: 'increase', previousLoadKg: 15, nextLoadKg: 17.5, incrementKg: 2.5 },
  },
  {
    name: 'ignores logged sets beyond the prescribed count when deciding',
    equipment: EquipmentType.Barbell,
    prescription: threeByEightToTen,
    previous: performance(threeByEightToTen, [
      repSet(1, 10, 20),
      repSet(2, 10, 20),
      repSet(3, 10, 20),
      repSet(4, 5, 15),
    ]),
    expected: { basis: 'increase', previousLoadKg: 20, nextLoadKg: 22.5, incrementKg: 2.5 },
  },
  {
    name: 'holds when 12/12 was logged for a required 3 sets — incomplete performance never increases',
    equipment: EquipmentType.Barbell,
    prescription: threeByEightToTwelve,
    previous: performance(threeByEightToTwelve, [repSet(1, 12, 50), repSet(2, 12, 50)]),
    expected: { basis: 'hold', previousLoadKg: 50, nextLoadKg: 50 },
  },
  {
    name: 'holds the load when reps land inside the range',
    equipment: EquipmentType.Barbell,
    prescription: threeByEightToTen,
    previous: performance(threeByEightToTen, [
      repSet(1, 9, 20),
      repSet(2, 9, 20),
      repSet(3, 9, 20),
    ]),
    expected: { basis: 'hold', previousLoadKg: 20, nextLoadKg: 20 },
  },
  {
    name: 'holds the load when reps land exactly on minReps',
    equipment: EquipmentType.Barbell,
    prescription: threeByEightToTen,
    previous: performance(threeByEightToTen, [
      repSet(1, 8, 20),
      repSet(2, 8, 20),
      repSet(3, 8, 20),
    ]),
    expected: { basis: 'hold', previousLoadKg: 20, nextLoadKg: 20 },
  },
  {
    name: 'holds instead of increasing when loads are mixed, even at maxReps',
    equipment: EquipmentType.Barbell,
    prescription: threeByEightToTen,
    previous: performance(threeByEightToTen, [
      repSet(1, 10, 20),
      repSet(2, 10, 20),
      repSet(3, 10, 22.5),
    ]),
    expected: { basis: 'hold', previousLoadKg: 20, nextLoadKg: 20 },
  },
  {
    name: 'holds on mixed performance 10/10/7 in 3x8-12 — one failed set never regresses',
    equipment: EquipmentType.Barbell,
    prescription: threeByEightToTwelve,
    previous: performance(threeByEightToTwelve, [
      repSet(1, 10, 50),
      repSet(2, 10, 50),
      repSet(3, 7, 50),
    ]),
    expected: { basis: 'hold', previousLoadKg: 50, nextLoadKg: 50 },
  },
  {
    name: 'holds on mixed performance 12/12/7 in 3x8-12 — maxReps sets do not increase past a failed set',
    equipment: EquipmentType.Barbell,
    prescription: threeByEightToTwelve,
    previous: performance(threeByEightToTwelve, [
      repSet(1, 12, 50),
      repSet(2, 12, 50),
      repSet(3, 7, 50),
    ]),
    expected: { basis: 'hold', previousLoadKg: 50, nextLoadKg: 50 },
  },
  {
    name: 'holds on mixed performance 8/8/7 in 3x8-12 — minReps sets do not regress past a failed set',
    equipment: EquipmentType.Barbell,
    prescription: threeByEightToTwelve,
    previous: performance(threeByEightToTwelve, [
      repSet(1, 8, 50),
      repSet(2, 8, 50),
      repSet(3, 7, 50),
    ]),
    expected: { basis: 'hold', previousLoadKg: 50, nextLoadKg: 50 },
  },
  {
    name: 'regresses when every prescribed set is below minReps: 7/7/7 in 3x8-12',
    equipment: EquipmentType.Barbell,
    prescription: threeByEightToTwelve,
    previous: performance(threeByEightToTwelve, [
      repSet(1, 7, 50),
      repSet(2, 7, 50),
      repSet(3, 7, 50),
    ]),
    expected: { basis: 'regress', previousLoadKg: 50, nextLoadKg: 47.5, incrementKg: 2.5 },
  },
  {
    name: 'holds on incomplete performance 10/9 of required 3 sets',
    equipment: EquipmentType.Barbell,
    prescription: threeByEightToTwelve,
    previous: performance(threeByEightToTwelve, [repSet(1, 10, 50), repSet(2, 9, 50)]),
    expected: { basis: 'hold', previousLoadKg: 50, nextLoadKg: 50 },
  },
  {
    name: 'holds on incomplete performance 7/7 of required 3 sets — below-min sets never regress an incomplete log',
    equipment: EquipmentType.Barbell,
    prescription: threeByEightToTwelve,
    previous: performance(threeByEightToTwelve, [repSet(1, 7, 50), repSet(2, 7, 50)]),
    expected: { basis: 'hold', previousLoadKg: 50, nextLoadKg: 50 },
  },
  {
    name: 'holds on a single logged set below minReps when 3 sets were prescribed',
    equipment: EquipmentType.Barbell,
    prescription: threeByEightToTwelve,
    previous: performance(threeByEightToTwelve, [repSet(1, 7, 50)]),
    expected: { basis: 'hold', previousLoadKg: 50, nextLoadKg: 50 },
  },
  {
    name: 'regresses the kettlebell load by 4 kg when every set falls below minReps',
    equipment: EquipmentType.Kettlebell,
    prescription: threeBySixToEight,
    previous: performance(threeBySixToEight, [
      repSet(1, 5, 12),
      repSet(2, 5, 12),
      repSet(3, 5, 12),
    ]),
    expected: { basis: 'regress', previousLoadKg: 12, nextLoadKg: 8, incrementKg: 4 },
  },
  {
    name: 'regresses to a bodyweight recommendation when the load equals the increment',
    equipment: EquipmentType.Dumbbell,
    prescription: threeByEightToTen,
    previous: performance(threeByEightToTen, [
      repSet(1, 7, 2),
      repSet(2, 7, 2),
      repSet(3, 7, 2),
    ]),
    expected: { basis: 'regress', previousLoadKg: 2, nextLoadKg: null, incrementKg: 2 },
  },
  {
    name: 'rounds float dust when regressing: 2.6 kg on a barbell becomes 0.1 kg',
    equipment: EquipmentType.Barbell,
    prescription: threeByEightToTen,
    previous: performance(threeByEightToTen, [
      repSet(1, 7, 2.6),
      repSet(2, 7, 2.6),
      repSet(3, 7, 2.6),
    ]),
    expected: { basis: 'regress', previousLoadKg: 2.6, nextLoadKg: 0.1, incrementKg: 2.5 },
  },
  {
    name: 'regresses the lowest working load when every set failed on mixed loads',
    equipment: EquipmentType.Barbell,
    prescription: threeByEightToTen,
    previous: performance(threeByEightToTen, [
      repSet(1, 7, 20),
      repSet(2, 7, 22.5),
      repSet(3, 7, 22.5),
    ]),
    expected: { basis: 'regress', previousLoadKg: 20, nextLoadKg: 17.5, incrementKg: 2.5 },
  },
];

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('calculateNextExerciseTarget', () => {
  describe('progression decision table', () => {
    it.each(SCENARIOS)('$name', ({ equipment, prescription, previous, expected }) => {
      const exercise = makeExercise(equipment);

      expect(calculateNextExerciseTarget(exercise, prescription, previous)).toEqual(expected);
    });
  });

  describe('inputs outside the history-port contract (defensive)', () => {
    it('treats a performance with no logged sets as no usable history', () => {
      const exercise = makeExercise(EquipmentType.Barbell);
      const previous = performance(threeByEightToTen, []);

      expect(calculateNextExerciseTarget(exercise, threeByEightToTen, previous)).toEqual({
        basis: 'first-exposure',
      });
    });

    it('holds when a logged set contradicts the prescription type', () => {
      const exercise = makeExercise(EquipmentType.Barbell);
      const previous = performance(threeByEightToTen, [
        repSet(1, 10, 20),
        durationSet(2, 30, 20),
        repSet(3, 10, 20),
      ]);

      expect(calculateNextExerciseTarget(exercise, threeByEightToTen, previous)).toEqual({
        basis: 'hold',
        previousLoadKg: 20,
        nextLoadKg: 20,
      });
    });
  });
});

describe('EQUIPMENT_LOAD_INCREMENT_KG', () => {
  it.each<[EquipmentType, number]>([
    [EquipmentType.Barbell, 2.5],
    [EquipmentType.Dumbbell, 2],
    [EquipmentType.Kettlebell, 4],
    [EquipmentType.Machine, 2.5],
    [EquipmentType.Bodyweight, 2.5],
    [EquipmentType.ResistanceBand, 2.5],
    [EquipmentType.Bench, 2.5],
    [EquipmentType.PullUpBar, 2.5],
  ])('progresses %s by %s kg', (equipment, incrementKg) => {
    expect(EQUIPMENT_LOAD_INCREMENT_KG[equipment]).toBe(incrementKg);
  });
});

