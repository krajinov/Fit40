/**
 * Progression engine — scheme compatibility and early gates.
 *
 * Covers first-exposure, scheme-change (exact compatibility), the duration
 * basis, the bodyweight basis, and defensive inputs outside the history-port
 * contract. The core load decision table lives in
 * `exercise-progression-decision-table.test.ts`; equipment increments and
 * the regression floor in `exercise-progression-increments.test.ts`; the
 * history-window semantics (ordering, two-occurrence regress) in
 * `exercise-progression-history-window.test.ts`.
 */

import { describe, expect, it } from 'vitest';

import { calculateNextExerciseTarget } from '@/domain/services/exercise-progression';
import { EquipmentType } from '@/domain/types/exercise';

import {
  durationSet,
  makeExercise,
  performance,
  repSet,
  scheme,
  threeByEightToTen,
  threeByThirtySeconds,
  timed,
  threeByTenToTwelve,
  type Scenario,
} from './exercise-progression.fixtures';

const SCENARIOS: Scenario[] = [
  {
    name: 'recommends first-exposure when the exercise has no history',
    equipment: EquipmentType.Dumbbell,
    prescription: threeByEightToTen,
    history: [],
    expected: { basis: 'first-exposure', reason: 'no-history' },
  },
  {
    name: 'recommends first-exposure when a duration prescription has no history',
    equipment: EquipmentType.Barbell,
    prescription: threeByThirtySeconds,
    history: [],
    expected: { basis: 'first-exposure', reason: 'no-history' },
  },
  {
    name: 'recommends scheme-change when the rep range changed',
    equipment: EquipmentType.Dumbbell,
    prescription: threeByTenToTwelve,
    history: [performance(threeByEightToTen, [
      repSet(1, 10, 20),
      repSet(2, 10, 20),
      repSet(3, 10, 20),
    ])],
    expected: { basis: 'scheme-change', reason: 'scheme-changed' },
  },
  {
    name: 'recommends scheme-change when the set count changed',
    equipment: EquipmentType.Dumbbell,
    prescription: scheme(4, 8, 10),
    history: [performance(threeByEightToTen, [
      repSet(1, 10, 20),
      repSet(2, 10, 20),
      repSet(3, 10, 20),
    ])],
    expected: { basis: 'scheme-change', reason: 'scheme-changed' },
  },
  {
    name: 'recommends scheme-change before the duration basis when the set type changed',
    equipment: EquipmentType.Barbell,
    prescription: threeByThirtySeconds,
    history: [performance(threeByEightToTen, [
      repSet(1, 10, 20),
      repSet(2, 10, 20),
      repSet(3, 10, 20),
    ])],
    expected: { basis: 'scheme-change', reason: 'scheme-changed' },
  },
  {
    name: 'recommends scheme-change when the duration target changed',
    equipment: EquipmentType.Barbell,
    prescription: timed(3, 45),
    history: [performance(threeByThirtySeconds, [
      durationSet(1, 30, null),
      durationSet(2, 30, null),
      durationSet(3, 30, null),
    ])],
    expected: { basis: 'scheme-change', reason: 'scheme-changed' },
  },
  {
    name: 'recommends duration when the prescription matches the previous one',
    equipment: EquipmentType.Barbell,
    prescription: threeByThirtySeconds,
    history: [performance(threeByThirtySeconds, [
      durationSet(1, 30, null),
      durationSet(2, 30, null),
      durationSet(3, 30, null),
    ])],
    expected: { basis: 'duration', reason: 'duration-scheme' },
  },
  {
    name: 'recommends bodyweight when every considered set is unweighted',
    equipment: EquipmentType.Bodyweight,
    prescription: threeByEightToTen,
    history: [performance(threeByEightToTen, [
      repSet(1, 10, null),
      repSet(2, 10, null),
      repSet(3, 10, null),
    ])],
    expected: { basis: 'bodyweight', reason: 'unloaded-set' },
  },
  {
    name: 'recommends bodyweight when one considered set is unweighted',
    equipment: EquipmentType.Dumbbell,
    prescription: threeByEightToTen,
    history: [performance(threeByEightToTen, [
      repSet(1, 10, 20),
      repSet(2, 8, null),
      repSet(3, 10, 20),
    ])],
    expected: { basis: 'bodyweight', reason: 'unloaded-set' },
  },
];

describe('calculateNextExerciseTarget', () => {
  describe('scheme compatibility and early gates', () => {
    it.each(SCENARIOS)('$name', ({ equipment, prescription, history, expected }) => {
      const exercise = makeExercise(equipment);

      expect(calculateNextExerciseTarget(exercise, prescription, history)).toEqual(expected);
    });
  });

  describe('inputs outside the history-port contract (defensive)', () => {
    it('treats a newest performance with no logged sets as no usable history', () => {
      const exercise = makeExercise(EquipmentType.Barbell);
      const history = [performance(threeByEightToTen, [])];

      expect(calculateNextExerciseTarget(exercise, threeByEightToTen, history)).toEqual({
        basis: 'first-exposure',
        reason: 'no-history',
      });
    });

    it('holds when a logged set contradicts the prescription type', () => {
      const exercise = makeExercise(EquipmentType.Barbell);
      const history = [performance(threeByEightToTen, [
        repSet(1, 10, 20),
        durationSet(2, 30, 20),
        repSet(3, 10, 20),
      ])];

      expect(calculateNextExerciseTarget(exercise, threeByEightToTen, history)).toEqual({
        basis: 'hold',
        reason: 'mixed-performance-in-range',
        previousLoadKg: 20,
        nextLoadKg: 20,
      });
    });
  });
});
