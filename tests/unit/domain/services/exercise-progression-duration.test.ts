/**
 * Progression engine — duration (timed) decision matrix (M8 Slice 3).
 *
 * A duration prescription (e.g. 3 × 30 s) routes to
 * `duration-target-decision.ts`: every prescribed set reaching the
 * scheme's seconds (the exact boundary counts) extends the scheme by the
 * fixed +5 s step (R3) — anchored to the SCHEME's target, never to the
 * longest logged set, never a percentage. Incomplete or short logs hold
 * the scheme. Never a regress, never an emitted load (null stays null, a
 * logged 0 kg stays a truthful zero). RPE is deferred and never read.
 *
 * Gates live in `exercise-progression.test.ts`; the loaded decision table
 * in `exercise-progression-decision-table.test.ts`; history-window
 * semantics in `exercise-progression-history-window.test.ts`; the
 * bodyweight matrix in `exercise-progression-bodyweight.test.ts`.
 */

import { describe, expect, it } from 'vitest';

import { calculateNextExerciseTarget } from '@/domain/services/exercise-progression';
import { EquipmentType } from '@/domain/types/exercise';
import type { DurationSetLog } from '@/domain/entities/workout-session';

import { makeExercise, performance, timed } from './exercise-progression.fixtures';

const exercise = makeExercise(EquipmentType.Barbell);

/** Timed set; rpe overridable to prove it never influences the decision. */
function timedSet(
  setNumber: number,
  seconds: number,
  weightKg: number | null = null,
  rpe: number | null = null,
): DurationSetLog {
  return { type: 'duration', setNumber, durationSeconds: seconds, weightKg, rpe };
}

describe('calculateNextExerciseTarget — duration decision', () => {
  describe('first exposure', () => {
    it('recommends first-exposure when the timed exercise has no history', () => {
      expect(calculateNextExerciseTarget(exercise, timed(3, 30), [])).toEqual({
        basis: 'first-exposure',
        reason: 'no-history',
      });
    });
  });

  describe('increase (+5 s)', () => {
    it('extends the scheme by 5 s when every prescribed set reaches the target seconds', () => {
      expect(
        calculateNextExerciseTarget(exercise, timed(3, 30), [
          performance(timed(3, 30), [timedSet(1, 30), timedSet(2, 30), timedSet(3, 30)]),
        ]),
      ).toEqual({
        basis: 'duration-increase',
        reason: 'all-sets-at-target-duration',
        previousSeconds: 30,
        nextSeconds: 35,
        incrementSeconds: 5,
      });
    });

    it('counts the exact boundary: a set logged at exactly the target reaches it', () => {
      // The boundary is inclusive: 60 s in a 60 s scheme is a full set.
      expect(
        calculateNextExerciseTarget(exercise, timed(2, 60), [
          performance(timed(2, 60), [timedSet(1, 60), timedSet(2, 60)]),
        ]),
      ).toEqual({
        basis: 'duration-increase',
        reason: 'all-sets-at-target-duration',
        previousSeconds: 60,
        nextSeconds: 65,
        incrementSeconds: 5,
      });
    });

    it('anchors to the scheme target above it — 60 s holds in a 30 s scheme still extend 30 → 35', () => {
      // The step is scheme-anchored (R3): the best logged set never
      // accelerates the scheme, and no percentage is ever applied.
      expect(
        calculateNextExerciseTarget(exercise, timed(3, 30), [
          performance(timed(3, 30), [timedSet(1, 60), timedSet(2, 45), timedSet(3, 30)]),
        ]),
      ).toEqual({
        basis: 'duration-increase',
        reason: 'all-sets-at-target-duration',
        previousSeconds: 30,
        nextSeconds: 35,
        incrementSeconds: 5,
      });
    });
  });

  describe('hold', () => {
    it('holds when fewer sets were logged than prescribed', () => {
      expect(
        calculateNextExerciseTarget(exercise, timed(3, 30), [
          performance(timed(3, 30), [timedSet(1, 30), timedSet(2, 30)]),
        ]),
      ).toEqual({
        basis: 'duration-hold',
        reason: 'incomplete-sets',
        previousSeconds: 30,
        nextSeconds: 30,
      });
    });

    it('holds on a complete mixed log — one set below the target is enough to hold', () => {
      expect(
        calculateNextExerciseTarget(exercise, timed(3, 30), [
          performance(timed(3, 30), [timedSet(1, 30), timedSet(2, 29), timedSet(3, 35)]),
        ]),
      ).toEqual({
        basis: 'duration-hold',
        reason: 'sets-below-target-duration',
        previousSeconds: 30,
        nextSeconds: 30,
      });
    });

    it('holds when every prescribed set falls short of the target — timed work never regresses', () => {
      expect(
        calculateNextExerciseTarget(exercise, timed(3, 30), [
          performance(timed(3, 30), [timedSet(1, 20), timedSet(2, 20), timedSet(3, 20)]),
        ]),
      ).toEqual({
        basis: 'duration-hold',
        reason: 'sets-below-target-duration',
        previousSeconds: 30,
        nextSeconds: 30,
      });
    });
  });

  describe('considered-set semantics', () => {
    it('ignores logged sets beyond the prescribed count — a short extra set cannot distort the decision', () => {
      expect(
        calculateNextExerciseTarget(exercise, timed(3, 30), [
          performance(timed(3, 30), [
            timedSet(1, 30),
            timedSet(2, 30),
            timedSet(3, 30),
            timedSet(4, 10),
          ]),
        ]),
      ).toEqual({
        basis: 'duration-increase',
        reason: 'all-sets-at-target-duration',
        previousSeconds: 30,
        nextSeconds: 35,
        incrementSeconds: 5,
      });
    });
  });

  describe('determinism and reason presence', () => {
    it('produces identical output for identical input', () => {
      const history = [
        performance(timed(3, 30), [timedSet(1, 30), timedSet(2, 25), timedSet(3, 30)]),
      ];

      const first = calculateNextExerciseTarget(exercise, timed(3, 30), history);
      const second = calculateNextExerciseTarget(exercise, timed(3, 30), history);

      expect(first).toEqual(second);
    });

    it('every duration variant carries its structured reason code', () => {
      const variants = [
        calculateNextExerciseTarget(exercise, timed(3, 30), [
          performance(timed(3, 30), [timedSet(1, 30), timedSet(2, 30), timedSet(3, 30)]),
        ]),
        calculateNextExerciseTarget(exercise, timed(3, 30), [
          performance(timed(3, 30), [timedSet(1, 30), timedSet(2, 25), timedSet(3, 30)]),
        ]),
        calculateNextExerciseTarget(exercise, timed(3, 30), [
          performance(timed(3, 30), [timedSet(1, 30)]),
        ]),
      ];

      expect(variants.map((t) => ({ basis: t.basis, reason: t.reason }))).toEqual([
        { basis: 'duration-increase', reason: 'all-sets-at-target-duration' },
        { basis: 'duration-hold', reason: 'sets-below-target-duration' },
        { basis: 'duration-hold', reason: 'incomplete-sets' },
      ]);
    });
  });

  describe('loads on timed sets are ignored (load-blind)', () => {
    it('never emits a load — null stays null, a logged 0 kg stays a truthful zero', () => {
      const withNull = calculateNextExerciseTarget(exercise, timed(3, 30), [
        performance(timed(3, 30), [
          timedSet(1, 30, null),
          timedSet(2, 30, null),
          timedSet(3, 30, null),
        ]),
      ]);
      const withZero = calculateNextExerciseTarget(exercise, timed(3, 30), [
        performance(timed(3, 30), [
          timedSet(1, 30, 0),
          timedSet(2, 30, 0),
          timedSet(3, 30, 0),
        ]),
      ]);
      const withLoad = calculateNextExerciseTarget(exercise, timed(3, 30), [
        performance(timed(3, 30), [
          timedSet(1, 30, 10),
          timedSet(2, 30, 10),
          timedSet(3, 30, 10),
        ]),
      ]);

      expect(withNull).toEqual(withZero);
      expect(withZero).toEqual(withLoad);
      expect(withLoad).toEqual({
        basis: 'duration-increase',
        reason: 'all-sets-at-target-duration',
        previousSeconds: 30,
        nextSeconds: 35,
        incrementSeconds: 5,
      });
    });
  });

  describe('RPE never influences the decision (deferred)', () => {
    it('ignores RPE on the considered sets — logged 8s decide exactly like nulls', () => {
      const withRpe = calculateNextExerciseTarget(exercise, timed(3, 30), [
        performance(timed(3, 30), [
          timedSet(1, 30, null, 8),
          timedSet(2, 30, null, 9),
          timedSet(3, 30, null, 7),
        ]),
      ]);
      const withoutRpe = calculateNextExerciseTarget(exercise, timed(3, 30), [
        performance(timed(3, 30), [timedSet(1, 30), timedSet(2, 30), timedSet(3, 30)]),
      ]);

      expect(withRpe).toEqual(withoutRpe);
    });
  });

  describe('scheme-change gate still precedes the decision', () => {
    it('recommends scheme-change when the prior scheme used different seconds', () => {
      expect(
        calculateNextExerciseTarget(exercise, timed(3, 45), [
          performance(timed(3, 30), [timedSet(1, 30), timedSet(2, 30), timedSet(3, 30)]),
        ]),
      ).toEqual({
        basis: 'scheme-change',
        reason: 'scheme-changed',
      });
    });
  });
});
