/**
 * Progression engine v2 — history-window semantics.
 *
 * The engine consumes a NEWEST-FIRST bounded history window: index 0 is the
 * most recent occurrence. This suite pins the ordering contract, the
 * two-occurrence regression protection (R2), the structured reason codes,
 * determinism, and the v1 parity of a one-occurrence window (every v1
 * decision except the intentionally changed single-below-minimum case).
 */

import { describe, expect, it } from 'vitest';

import { calculateNextExerciseTarget } from '@/domain/services/exercise-progression';
import { EquipmentType } from '@/domain/types/exercise';

import {
  allAtMaxReps,
  allBelowMinimum,
  durationSet,
  makeExercise,
  performance,
  repSet,
  scheme,
  threeByEightToTen,
  threeByEightToTwelve,
  timed,
  type Scenario,
} from './exercise-progression.fixtures';

describe('calculateNextExerciseTarget — history window', () => {
  const exercise = makeExercise(EquipmentType.Barbell);
  const increment = 2.5;

  describe('ordering contract: index 0 is the newest occurrence', () => {
    it('reads the FIRST entry as the newest — a successful newest entry increases even after an older below-minimum one', () => {
      const target = calculateNextExerciseTarget(exercise, threeByEightToTwelve, [
        allAtMaxReps(threeByEightToTwelve, 50),
        allBelowMinimum(threeByEightToTwelve, 47.5),
      ]);

      expect(target).toEqual({
        basis: 'increase',
        reason: 'all-sets-at-top-of-range',
        previousLoadKg: 50,
        nextLoadKg: 52.5,
        incrementKg: increment,
      });
    });

    it('reads the SECOND entry as the prior — the same two occurrences reversed hold instead', () => {
      const target = calculateNextExerciseTarget(exercise, threeByEightToTwelve, [
        allBelowMinimum(threeByEightToTwelve, 47.5),
        allAtMaxReps(threeByEightToTwelve, 50),
      ]);

      expect(target.basis).toBe('hold');
      if (target.basis !== 'hold') return;
      expect(target.reason).toBe('single-session-below-minimum');
      expect(target.previousLoadKg).toBe(47.5);
    });

    it('regresses from the working load of the newest occurrence, not the prior one', () => {
      const target = calculateNextExerciseTarget(exercise, threeByEightToTwelve, [
        allBelowMinimum(threeByEightToTwelve, 47.5),
        allBelowMinimum(threeByEightToTwelve, 60),
      ]);

      expect(target).toEqual({
        basis: 'regress',
        reason: 'two-consecutive-sessions-below-minimum',
        previousLoadKg: 47.5,
        nextLoadKg: 45,
        incrementKg: increment,
      });
    });

    it('a successful prior occurrence breaks a below-minimum streak: latest below-min alone holds', () => {
      const target = calculateNextExerciseTarget(exercise, threeByEightToTwelve, [
        allBelowMinimum(threeByEightToTwelve, 50),
        allAtMaxReps(threeByEightToTwelve, 50),
      ]);

      expect(target).toEqual({
        basis: 'hold',
        reason: 'single-session-below-minimum',
        previousLoadKg: 50,
        nextLoadKg: 50,
      });
    });
  });

  describe('two-occurrence regression protection (R2)', () => {
    it('holds after a single below-minimum occurrence when no prior history exists', () => {
      const target = calculateNextExerciseTarget(exercise, threeByEightToTwelve, [
        allBelowMinimum(threeByEightToTwelve, 50),
      ]);

      expect(target).toEqual({
        basis: 'hold',
        reason: 'single-session-below-minimum',
        previousLoadKg: 50,
        nextLoadKg: 50,
      });
    });

    it('regresses when the two newest eligible occurrences are both below minimum', () => {
      const target = calculateNextExerciseTarget(exercise, threeByEightToTwelve, [
        allBelowMinimum(threeByEightToTwelve, 50),
        allBelowMinimum(threeByEightToTwelve, 52.5),
      ]);

      expect(target).toEqual({
        basis: 'regress',
        reason: 'two-consecutive-sessions-below-minimum',
        previousLoadKg: 50,
        nextLoadKg: 47.5,
        incrementKg: increment,
      });
    });

    it('holds when the only prior below-minimum occurrence sits under a different scheme: no eligible second data point exists', () => {
      const target = calculateNextExerciseTarget(exercise, threeByEightToTwelve, [
        allBelowMinimum(threeByEightToTwelve, 50),
        allBelowMinimum(threeByEightToTen, 60),
      ]);

      expect(target).toEqual({
        basis: 'hold',
        reason: 'single-session-below-minimum',
        previousLoadKg: 50,
        nextLoadKg: 50,
      });
    });

    it('counts the streak across an ineligible prior: a same-scheme below-minimum behind it still regresses', () => {
      const target = calculateNextExerciseTarget(exercise, threeByEightToTwelve, [
        allBelowMinimum(threeByEightToTwelve, 50),
        allBelowMinimum(threeByEightToTen, 60),
        allBelowMinimum(threeByEightToTwelve, 52.5),
      ]);

      expect(target).toEqual({
        basis: 'regress',
        reason: 'two-consecutive-sessions-below-minimum',
        previousLoadKg: 50,
        nextLoadKg: 47.5,
        incrementKg: increment,
      });
    });

    it('an eligible prior in-range occurrence breaks the streak — only below-min confirms', () => {
      const inRange = performance(threeByEightToTwelve, [
        repSet(1, 10, 50),
        repSet(2, 10, 50),
        repSet(3, 10, 50),
      ]);
      const target = calculateNextExerciseTarget(exercise, threeByEightToTwelve, [
        allBelowMinimum(threeByEightToTwelve, 50),
        inRange,
      ]);

      expect(target).toEqual({
        basis: 'hold',
        reason: 'single-session-below-minimum',
        previousLoadKg: 50,
        nextLoadKg: 50,
      });
    });

    it('an eligible prior incomplete occurrence breaks the streak: only complete logs can confirm a minimum failure', () => {
      const incompleteBelowMin = performance(threeByEightToTwelve, [
        repSet(1, 7, 50),
        repSet(2, 7, 50),
      ]);
      const target = calculateNextExerciseTarget(exercise, threeByEightToTwelve, [
        allBelowMinimum(threeByEightToTwelve, 50),
        incompleteBelowMin,
      ]);

      expect(target.basis).toBe('hold');
    });

    it('an eligible prior unloaded occurrence breaks the streak: bodyweight logs are no load evidence', () => {
      const unloaded = performance(threeByEightToTwelve, [
        repSet(1, 7, null),
        repSet(2, 7, null),
        repSet(3, 7, null),
      ]);
      const target = calculateNextExerciseTarget(exercise, threeByEightToTwelve, [
        allBelowMinimum(threeByEightToTwelve, 50),
        unloaded,
      ]);

      expect(target.basis).toBe('hold');
    });

    it('only the FIRST eligible prior matters: a below-min prior behind an eligible successful one never regresses', () => {
      const target = calculateNextExerciseTarget(exercise, threeByEightToTwelve, [
        allBelowMinimum(threeByEightToTwelve, 50),
        allAtMaxReps(threeByEightToTwelve, 50),
        allBelowMinimum(threeByEightToTwelve, 60),
      ]);

      expect(target.basis).toBe('hold');
    });

    it('regress still floors at null instead of a non-positive load', () => {
      const target = calculateNextExerciseTarget(exercise, threeByEightToTen, [
        allBelowMinimum(threeByEightToTen, 2),
        allBelowMinimum(threeByEightToTen, 4),
      ]);

      expect(target).toEqual({
        basis: 'regress',
        reason: 'two-consecutive-sessions-below-minimum',
        previousLoadKg: 2,
        nextLoadKg: null,
        incrementKg: increment,
      });
    });
  });

  describe('structured reason codes', () => {
    it('every engine target variant carries its decision reason', () => {
      const variants = [
        calculateNextExerciseTarget(exercise, threeByEightToTen, []),
        calculateNextExerciseTarget(exercise, scheme(4, 8, 10), [
          allAtMaxReps(threeByEightToTen, 20),
        ]),
        calculateNextExerciseTarget(exercise, timed(3, 30), [
          performance(timed(3, 30), [
            durationSet(1, 30, null),
            durationSet(2, 30, null),
            durationSet(3, 30, null),
          ]),
        ]),
        calculateNextExerciseTarget(exercise, timed(3, 30), [
          performance(timed(3, 30), [
            durationSet(1, 30, null),
            durationSet(2, 29, null),
            durationSet(3, 30, null),
          ]),
        ]),
        calculateNextExerciseTarget(exercise, threeByEightToTen, [
          performance(threeByEightToTen, [
            repSet(1, 10, null),
            repSet(2, 10, null),
            repSet(3, 10, null),
          ]),
        ]),
        calculateNextExerciseTarget(exercise, threeByEightToTen, [
          performance(threeByEightToTen, [
            repSet(1, 9, null),
            repSet(2, 9, null),
            repSet(3, 9, null),
          ]),
        ]),
        calculateNextExerciseTarget(exercise, threeByEightToTen, [
          allAtMaxReps(threeByEightToTen, 20),
        ]),
        calculateNextExerciseTarget(exercise, threeByEightToTen, [
          performance(threeByEightToTen, [
            repSet(1, 9, 20),
            repSet(2, 9, 20),
            repSet(3, 9, 20),
          ]),
        ]),
        calculateNextExerciseTarget(exercise, threeByEightToTen, [
          performance(threeByEightToTen, [
            repSet(1, 7, 20),
            repSet(2, 7, 20),
            repSet(3, 7, 20),
          ]),
        ]),
        calculateNextExerciseTarget(exercise, threeByEightToTen, [
          allBelowMinimum(threeByEightToTen, 20),
          allBelowMinimum(threeByEightToTen, 22.5),
        ]),
      ];

      expect(variants.map((t) => ({ basis: t.basis, reason: t.reason }))).toEqual([
        { basis: 'first-exposure', reason: 'no-history' },
        { basis: 'scheme-change', reason: 'scheme-changed' },
        { basis: 'duration-increase', reason: 'all-sets-at-target-duration' },
        { basis: 'duration-hold', reason: 'sets-below-target-duration' },
        { basis: 'bodyweight-goal-reached', reason: 'all-sets-at-top-of-range' },
        { basis: 'bodyweight-hold', reason: 'reps-below-top-of-range' },
        { basis: 'increase', reason: 'all-sets-at-top-of-range' },
        { basis: 'hold', reason: 'mixed-performance-in-range' },
        { basis: 'hold', reason: 'single-session-below-minimum' },
        { basis: 'regress', reason: 'two-consecutive-sessions-below-minimum' },
      ]);
    });
  });

  describe('determinism', () => {
    it('produces identical output for identical input', () => {
      const history: Scenario['history'] = [
        allBelowMinimum(threeByEightToTwelve, 50),
        allAtMaxReps(threeByEightToTwelve, 47.5),
        allBelowMinimum(threeByEightToTwelve, 60),
      ];

      const first = calculateNextExerciseTarget(exercise, threeByEightToTwelve, history);
      const second = calculateNextExerciseTarget(exercise, threeByEightToTwelve, history);

      expect(first).toEqual(second);
      // Newest below-min + eligible successful prior → single-session hold;
      // the older below-min entry stays ignored (first eligible prior wins).
      expect(first).toEqual({
        basis: 'hold',
        reason: 'single-session-below-minimum',
        previousLoadKg: 50,
        nextLoadKg: 50,
      });
    });
  });

  describe('v1 parity of a one-occurrence window', () => {
    it.each<Scenario>([
      {
        name: 'first exposure',
        equipment: EquipmentType.Barbell,
        prescription: threeByEightToTen,
        history: [],
        expected: { basis: 'first-exposure', reason: 'no-history' },
      },
      {
        name: 'successful occurrence increases (v1: increase)',
        equipment: EquipmentType.Barbell,
        prescription: threeByEightToTen,
        history: [allAtMaxReps(threeByEightToTen, 20)],
        expected: {
          basis: 'increase',
          reason: 'all-sets-at-top-of-range',
          previousLoadKg: 20,
          nextLoadKg: 22.5,
          incrementKg: 2.5,
        },
      },
      {
        name: 'in-range occurrence holds (v1: hold)',
        equipment: EquipmentType.Barbell,
        prescription: threeByEightToTen,
        history: [
          performance(threeByEightToTen, [
            repSet(1, 9, 20),
            repSet(2, 9, 20),
            repSet(3, 9, 20),
          ]),
        ],
        expected: {
          basis: 'hold',
          reason: 'mixed-performance-in-range',
          previousLoadKg: 20,
          nextLoadKg: 20,
        },
      },
      {
        name: 'mixed loads hold (v1: hold)',
        equipment: EquipmentType.Barbell,
        prescription: threeByEightToTen,
        history: [
          performance(threeByEightToTen, [
            repSet(1, 10, 20),
            repSet(2, 10, 20),
            repSet(3, 10, 22.5),
          ]),
        ],
        expected: {
          basis: 'hold',
          reason: 'non-uniform-load',
          previousLoadKg: 20,
          nextLoadKg: 20,
        },
      },
      {
        name: 'incomplete prescribed sets hold (v1: hold)',
        equipment: EquipmentType.Barbell,
        prescription: threeByEightToTen,
        history: [
          performance(threeByEightToTen, [repSet(1, 10, 20), repSet(2, 10, 20)]),
        ],
        expected: {
          basis: 'hold',
          reason: 'incomplete-sets',
          previousLoadKg: 20,
          nextLoadKg: 20,
        },
      },
      {
        name: 'single below-minimum occurrence HOLDS (v1: regress — the intentional R2 change)',
        equipment: EquipmentType.Barbell,
        prescription: threeByEightToTen,
        history: [allBelowMinimum(threeByEightToTen, 20)],
        expected: {
          basis: 'hold',
          reason: 'single-session-below-minimum',
          previousLoadKg: 20,
          nextLoadKg: 20,
        },
      },
      {
        name: 'scheme change (v1: scheme-change)',
        equipment: EquipmentType.Barbell,
        prescription: threeByEightToTwelve,
        history: [allAtMaxReps(threeByEightToTen, 20)],
        expected: { basis: 'scheme-change', reason: 'scheme-changed' },
      },
      {
        name: 'extra logged sets beyond the prescription are ignored (v1: increase)',
        equipment: EquipmentType.Barbell,
        prescription: threeByEightToTen,
        history: [
          performance(threeByEightToTen, [
            repSet(1, 10, 20),
            repSet(2, 10, 20),
            repSet(3, 10, 20),
            repSet(4, 5, 15),
          ]),
        ],
        expected: {
          basis: 'increase',
          reason: 'all-sets-at-top-of-range',
          previousLoadKg: 20,
          nextLoadKg: 22.5,
          incrementKg: 2.5,
        },
      },
      {
        name: '0 kg remains a real load and increases (v1: increase from 0)',
        equipment: EquipmentType.Machine,
        prescription: threeByEightToTen,
        history: [
          performance(threeByEightToTen, [
            repSet(1, 10, 0),
            repSet(2, 10, 0),
            repSet(3, 10, 0),
          ]),
        ],
        expected: {
          basis: 'increase',
          reason: 'all-sets-at-top-of-range',
          previousLoadKg: 0,
          nextLoadKg: 2.5,
          incrementKg: 2.5,
        },
      },
    ])('$name', ({ equipment, prescription, history, expected }) => {
      expect(calculateNextExerciseTarget(makeExercise(equipment), prescription, history)).toEqual(
        expected,
      );
    });
  });
});

