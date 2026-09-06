/**
 * Progression engine — bodyweight (unloaded) decision matrix (M8 Slice 3).
 *
 * A reps prescription whose considered sets carry no external load routes
 * to `bodyweight-rep-decision.ts`: the authored range is the progression
 * surface, fully earned → GOAL REACHED (repeat as written), anything less
 * → HOLD (repeat as written). Never a regress, never an invented load,
 * never a harder variation. RPE is deferred and never read. The loaded
 * boundary rows pin: 0 kg is a real load, null is not.
 *
 * Gates live in `exercise-progression.test.ts`; the core loaded decision
 * table in `exercise-progression-decision-table.test.ts`; history-window
 * semantics in `exercise-progression-history-window.test.ts`; the duration
 * matrix in `exercise-progression-duration.test.ts`.
 */

import { describe, expect, it } from 'vitest';

import { calculateNextExerciseTarget } from '@/domain/services/exercise-progression';
import { EquipmentType } from '@/domain/types/exercise';
import type { RepSetLog } from '@/domain/entities/workout-session';

import {
  makeExercise,
  performance,
  threeByEightToTen,
} from './exercise-progression.fixtures';

const exercise = makeExercise(EquipmentType.Bodyweight);

/** Unloaded rep set; rpe overridable to prove it never influences the decision. */
function bwSet(setNumber: number, reps: number, rpe: number | null = null): RepSetLog {
  return { type: 'reps', setNumber, reps, weightKg: null, rpe };
}

describe('calculateNextExerciseTarget — bodyweight decision', () => {
  describe('first exposure', () => {
    it('recommends first-exposure when the unweighted exercise has no history', () => {
      expect(calculateNextExerciseTarget(exercise, threeByEightToTen, [])).toEqual({
        basis: 'first-exposure',
        reason: 'no-history',
      });
    });
  });

  describe('goal reached', () => {
    it('recommends bodyweight-goal-reached when every prescribed set earns the range top', () => {
      expect(
        calculateNextExerciseTarget(exercise, threeByEightToTen, [
          performance(threeByEightToTen, [bwSet(1, 10), bwSet(2, 10), bwSet(3, 10)]),
        ]),
      ).toEqual({
        basis: 'bodyweight-goal-reached',
        reason: 'all-sets-at-top-of-range',
      });
    });

    it('treats reps beyond the range top as still goal-reached — only the top matters', () => {
      expect(
        calculateNextExerciseTarget(exercise, threeByEightToTen, [
          performance(threeByEightToTen, [bwSet(1, 12), bwSet(2, 15), bwSet(3, 10)]),
        ]),
      ).toEqual({
        basis: 'bodyweight-goal-reached',
        reason: 'all-sets-at-top-of-range',
      });
    });
  });

  describe('hold', () => {
    it('holds when every prescribed set is complete but inside the range', () => {
      expect(
        calculateNextExerciseTarget(exercise, threeByEightToTen, [
          performance(threeByEightToTen, [bwSet(1, 9), bwSet(2, 9), bwSet(3, 9)]),
        ]),
      ).toEqual({
        basis: 'bodyweight-hold',
        reason: 'reps-below-top-of-range',
      });
    });

    it('holds on a complete mixed log 10/10/8 — one set short of the top is enough to hold', () => {
      expect(
        calculateNextExerciseTarget(exercise, threeByEightToTen, [
          performance(threeByEightToTen, [bwSet(1, 10), bwSet(2, 10), bwSet(3, 8)]),
        ]),
      ).toEqual({
        basis: 'bodyweight-hold',
        reason: 'reps-below-top-of-range',
      });
    });

    it('holds on an incomplete log — fewer sets than prescribed never changes the recommendation', () => {
      expect(
        calculateNextExerciseTarget(exercise, threeByEightToTen, [
          performance(threeByEightToTen, [bwSet(1, 10), bwSet(2, 10)]),
        ]),
      ).toEqual({
        basis: 'bodyweight-hold',
        reason: 'incomplete-sets',
      });
    });

    it('holds on a below-minimum log — bodyweight work never regresses', () => {
      expect(
        calculateNextExerciseTarget(exercise, threeByEightToTen, [
          performance(threeByEightToTen, [bwSet(1, 7), bwSet(2, 7), bwSet(3, 7)]),
        ]),
      ).toEqual({
        basis: 'bodyweight-hold',
        reason: 'reps-below-top-of-range',
      });
    });

    it('never regresses even with two consecutive below-minimum occurrences — R2 is a load rule', () => {
      const belowMinimum = performance(threeByEightToTen, [
        bwSet(1, 7),
        bwSet(2, 7),
        bwSet(3, 7),
      ]);

      expect(
        calculateNextExerciseTarget(exercise, threeByEightToTen, [belowMinimum, belowMinimum]),
      ).toEqual({
        basis: 'bodyweight-hold',
        reason: 'reps-below-top-of-range',
      });
    });
  });

  describe('considered-set semantics', () => {
    it('ignores logged sets beyond the prescribed count — a weak extra set cannot distort the decision', () => {
      expect(
        calculateNextExerciseTarget(exercise, threeByEightToTen, [
          performance(threeByEightToTen, [
            bwSet(1, 10),
            bwSet(2, 10),
            bwSet(3, 10),
            bwSet(4, 5),
          ]),
        ]),
      ).toEqual({
        basis: 'bodyweight-goal-reached',
        reason: 'all-sets-at-top-of-range',
      });
    });

    it('routes the whole decision to bodyweight when ANY considered set is unweighted', () => {
      expect(
        calculateNextExerciseTarget(exercise, threeByEightToTen, [
          performance(threeByEightToTen, [
            { type: 'reps', setNumber: 1, reps: 10, weightKg: 20, rpe: null },
            { type: 'reps', setNumber: 2, reps: 8, weightKg: null, rpe: null },
            { type: 'reps', setNumber: 3, reps: 10, weightKg: 20, rpe: null },
          ]),
        ]),
      ).toEqual({
        basis: 'bodyweight-hold',
        reason: 'reps-below-top-of-range',
      });
    });
  });

  describe('determinism and reason presence', () => {
    it('produces identical output for identical input', () => {
      const history = [
        performance(threeByEightToTen, [bwSet(1, 10), bwSet(2, 9), bwSet(3, 10)]),
      ];

      const first = calculateNextExerciseTarget(exercise, threeByEightToTen, history);
      const second = calculateNextExerciseTarget(exercise, threeByEightToTen, history);

      expect(first).toEqual(second);
    });

    it('every bodyweight variant carries its structured reason code', () => {
      const variants = [
        calculateNextExerciseTarget(exercise, threeByEightToTen, [
          performance(threeByEightToTen, [bwSet(1, 10), bwSet(2, 10), bwSet(3, 10)]),
        ]),
        calculateNextExerciseTarget(exercise, threeByEightToTen, [
          performance(threeByEightToTen, [bwSet(1, 9), bwSet(2, 9), bwSet(3, 9)]),
        ]),
        calculateNextExerciseTarget(exercise, threeByEightToTen, [
          performance(threeByEightToTen, [bwSet(1, 10)]),
        ]),
      ];

      expect(variants.map((t) => ({ basis: t.basis, reason: t.reason }))).toEqual([
        { basis: 'bodyweight-goal-reached', reason: 'all-sets-at-top-of-range' },
        { basis: 'bodyweight-hold', reason: 'reps-below-top-of-range' },
        { basis: 'bodyweight-hold', reason: 'incomplete-sets' },
      ]);
    });
  });

  describe('RPE never influences the decision (deferred)', () => {
    it('ignores RPE on the considered sets — logged 8s decide exactly like nulls', () => {
      const withRpe = calculateNextExerciseTarget(exercise, threeByEightToTen, [
        performance(threeByEightToTen, [bwSet(1, 10, 8), bwSet(2, 10, 9), bwSet(3, 10, 7)]),
      ]);
      const withoutRpe = calculateNextExerciseTarget(exercise, threeByEightToTen, [
        performance(threeByEightToTen, [bwSet(1, 10), bwSet(2, 10), bwSet(3, 10)]),
      ]);

      expect(withRpe).toEqual(withoutRpe);
    });
  });

  describe('loaded work is never bodyweight (boundary regressions)', () => {
    it('a 0 kg log is externally loaded work and still increases — 0 kg ≠ bodyweight', () => {
      const machine = makeExercise(EquipmentType.Machine);
      expect(
        calculateNextExerciseTarget(machine, threeByEightToTen, [
          performance(threeByEightToTen, [
            { type: 'reps', setNumber: 1, reps: 10, weightKg: 0, rpe: null },
            { type: 'reps', setNumber: 2, reps: 10, weightKg: 0, rpe: null },
            { type: 'reps', setNumber: 3, reps: 10, weightKg: 0, rpe: null },
          ]),
        ]),
      ).toEqual({
        basis: 'increase',
        reason: 'all-sets-at-top-of-range',
        previousLoadKg: 0,
        nextLoadKg: 2.5,
        incrementKg: 2.5,
      });
    });

    it('a uniformly loaded log keeps its Slice 1 increase decision unchanged', () => {
      const barbell = makeExercise(EquipmentType.Barbell);
      expect(
        calculateNextExerciseTarget(barbell, threeByEightToTen, [
          performance(threeByEightToTen, [
            { type: 'reps', setNumber: 1, reps: 10, weightKg: 20, rpe: null },
            { type: 'reps', setNumber: 2, reps: 10, weightKg: 20, rpe: null },
            { type: 'reps', setNumber: 3, reps: 10, weightKg: 20, rpe: null },
          ]),
        ]),
      ).toEqual({
        basis: 'increase',
        reason: 'all-sets-at-top-of-range',
        previousLoadKg: 20,
        nextLoadKg: 22.5,
        incrementKg: 2.5,
      });
    });
  });
});
