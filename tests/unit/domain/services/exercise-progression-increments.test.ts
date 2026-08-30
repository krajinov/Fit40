/**
 * Progression engine — equipment increment behavior and the regression floor.
 *
 * Covers the per-equipment increment table, the 4 kg kettlebell step,
 * two-decimal rounding of computed targets, and the floor that recommends
 * `null` (train without added load) instead of a non-positive load. Gates
 * live in `exercise-progression.test.ts`; the core decision table in
 * `exercise-progression-decision-table.test.ts`.
 */

import { describe, expect, it } from 'vitest';

import {
  calculateNextExerciseTarget,
  EQUIPMENT_LOAD_INCREMENT_KG,
} from '@/domain/services/exercise-progression';
import { EquipmentType } from '@/domain/types/exercise';

import {
  makeExercise,
  performance,
  repSet,
  threeByEightToTen,
  threeBySixToEight,
  type Scenario,
} from './exercise-progression.fixtures';

const SCENARIOS: Scenario[] = [
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

describe('calculateNextExerciseTarget', () => {
  describe('equipment increments and the regression floor', () => {
    it.each(SCENARIOS)('$name', ({ equipment, prescription, previous, expected }) => {
      const exercise = makeExercise(equipment);

      expect(calculateNextExerciseTarget(exercise, prescription, previous)).toEqual(expected);
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
