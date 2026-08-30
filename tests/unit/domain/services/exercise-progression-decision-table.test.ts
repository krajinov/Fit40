/**
 * Progression engine — core load decision table (steps 6–9 over a complete
 * prescription): increase, hold, regress, and the incomplete-performance
 * hold. Gates live in `exercise-progression.test.ts`; equipment increments
 * and the regression floor in `exercise-progression-increments.test.ts`.
 */

import { describe, expect, it } from 'vitest';

import { calculateNextExerciseTarget } from '@/domain/services/exercise-progression';
import { EquipmentType } from '@/domain/types/exercise';

import {
  makeExercise,
  performance,
  repSet,
  threeByEightToTen,
  threeByEightToTwelve,
  threeByTenToTwelve,
  twoByTenToTwelve,
  type Scenario,
} from './exercise-progression.fixtures';

const SCENARIOS: Scenario[] = [
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
];

describe('calculateNextExerciseTarget', () => {
  describe('core load decision table', () => {
    it.each(SCENARIOS)('$name', ({ equipment, prescription, previous, expected }) => {
      const exercise = makeExercise(equipment);

      expect(calculateNextExerciseTarget(exercise, prescription, previous)).toEqual(expected);
    });
  });
});
