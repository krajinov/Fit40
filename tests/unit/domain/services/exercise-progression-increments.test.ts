/**
 * Progression engine — equipment increment behavior and the regression floor.
 *
 * Covers the per-equipment increment table, the 4 kg kettlebell step,
 * two-decimal rounding of computed targets, and the floor that recommends
 * `null` (train without added load) instead of a non-positive load. Every
 * regress scenario needs the two newest eligible occurrences below minimum
 * (v2 two-occurrence rule). Gates live in `exercise-progression.test.ts`;
 * the core decision table in `exercise-progression-decision-table.test.ts`;
 * the history-window semantics in `exercise-progression-history-window.test.ts`.
 */

import { describe, expect, it } from 'vitest';

import {
  calculateNextExerciseTarget,
  EQUIPMENT_LOAD_INCREMENT_KG,
} from '@/domain/services/exercise-progression';
import { EquipmentType } from '@/domain/types/exercise';
import type { RepPrescription } from '@/domain/value-objects/rep-prescription';

import {
  allBelowMinimum,
  makeExercise,
  performance,
  repSet,
  threeByEightToTen,
  threeBySixToEight,
  type Scenario,
} from './exercise-progression.fixtures';

/** Newest below-min occurrence + one prior eligible below-min occurrence. */
function belowMinimumTwice(
  prescription: RepPrescription,
  newestLoadKg: number,
  priorLoadKg: number,
): ReadonlyArray<Scenario['history'][number]> {
  return [allBelowMinimum(prescription, newestLoadKg), allBelowMinimum(prescription, priorLoadKg)];
}

const SCENARIOS: Scenario[] = [
  {
    name: 'regresses the kettlebell load by 4 kg when every set falls below minReps twice',
    equipment: EquipmentType.Kettlebell,
    prescription: threeBySixToEight,
    history: belowMinimumTwice(threeBySixToEight, 12, 16),
    expected: {
      basis: 'regress',
      reason: 'two-consecutive-sessions-below-minimum',
      previousLoadKg: 12,
      nextLoadKg: 8,
      incrementKg: 4,
    },
  },
  {
    name: 'regresses to a bodyweight recommendation when the load equals the increment',
    equipment: EquipmentType.Dumbbell,
    prescription: threeByEightToTen,
    history: belowMinimumTwice(threeByEightToTen, 2, 4),
    expected: {
      basis: 'regress',
      reason: 'two-consecutive-sessions-below-minimum',
      previousLoadKg: 2,
      nextLoadKg: null,
      incrementKg: 2,
    },
  },
  {
    name: 'rounds float dust when regressing: 2.6 kg on a barbell becomes 0.1 kg',
    equipment: EquipmentType.Barbell,
    prescription: threeByEightToTen,
    history: belowMinimumTwice(threeByEightToTen, 2.6, 5.1),
    expected: {
      basis: 'regress',
      reason: 'two-consecutive-sessions-below-minimum',
      previousLoadKg: 2.6,
      nextLoadKg: 0.1,
      incrementKg: 2.5,
    },
  },
  {
    name: 'regresses the lowest working load when every set failed on mixed loads',
    equipment: EquipmentType.Barbell,
    prescription: threeByEightToTen,
    history: [
      performance(threeByEightToTen, [
        repSet(1, 7, 20),
        repSet(2, 7, 22.5),
        repSet(3, 7, 22.5),
      ]),
      allBelowMinimum(threeByEightToTen, 20),
    ],
    expected: {
      basis: 'regress',
      reason: 'two-consecutive-sessions-below-minimum',
      previousLoadKg: 20,
      nextLoadKg: 17.5,
      incrementKg: 2.5,
    },
  },
];

describe('calculateNextExerciseTarget', () => {
  describe('equipment increments and the regression floor', () => {
    it.each(SCENARIOS)('$name', ({ equipment, prescription, history, expected }) => {
      const exercise = makeExercise(equipment);

      expect(calculateNextExerciseTarget(exercise, prescription, history)).toEqual(expected);
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
