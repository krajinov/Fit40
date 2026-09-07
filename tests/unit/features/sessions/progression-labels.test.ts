import { describe, expect, it } from 'vitest';

import type { NextExerciseTarget } from '@/domain/services/exercise-progression';
import type { RepPrescription } from '@/domain/value-objects/rep-prescription';
import {
  bodyweightHoldReasonLabel,
  bodyweightTargetLabel,
  durationHoldReasonLabel,
  formatKg,
  formatSeconds,
  holdReasonLabel,
  lastTimeLabel,
  targetDeltaLabel,
  targetReasonLabel,
} from '@/features/sessions/progression-labels';

const threeByEightToTwelve: RepPrescription = { type: 'reps', sets: 3, minReps: 8, maxReps: 12 };
const threeByThirtySeconds: RepPrescription = { type: 'duration', sets: 3, seconds: 30 };

describe('progression-labels / reason-to-copy mapping', () => {
  it('maps every hold reason to its deterministic sentence', () => {
    expect(holdReasonLabel('single-session-below-minimum')).toBe(
      'Previous session was below the target range. One more similar session would trigger a reduction.',
    );
    expect(holdReasonLabel('mixed-performance-in-range')).toBe(
      'Reps landed inside the target range — keep the current load.',
    );
    expect(holdReasonLabel('non-uniform-load')).toBe(
      'Sets were logged with different loads — keep the current load.',
    );
    expect(holdReasonLabel('incomplete-sets')).toBe('Previous performance was incomplete.');
  });

  it('maps every bodyweight-hold reason', () => {
    expect(bodyweightHoldReasonLabel('reps-below-top-of-range')).toBe(
      'Aim for the top of the prescribed rep range in every set.',
    );
    expect(bodyweightHoldReasonLabel('incomplete-sets')).toBe(
      'Previous performance was incomplete.',
    );
  });

  it('maps every duration-hold reason', () => {
    expect(durationHoldReasonLabel('sets-below-target-duration')).toBe(
      'Aim for the full target duration in every set.',
    );
    expect(durationHoldReasonLabel('incomplete-sets')).toBe(
      'Previous performance was incomplete.',
    );
  });

  it('never exposes raw reason-code identifiers as UI copy', () => {
    const allReasons: NextExerciseTarget[] = [
      { basis: 'first-exposure', reason: 'no-history' },
      { basis: 'scheme-change', reason: 'scheme-changed' },
      { basis: 'bodyweight-goal-reached', reason: 'all-sets-at-top-of-range' },
      { basis: 'bodyweight-hold', reason: 'reps-below-top-of-range' },
      { basis: 'bodyweight-hold', reason: 'incomplete-sets' },
      { basis: 'duration-increase', reason: 'all-sets-at-target-duration', previousSeconds: 30, nextSeconds: 35, incrementSeconds: 5 },
      { basis: 'duration-hold', reason: 'sets-below-target-duration', previousSeconds: 30, nextSeconds: 30 },
      { basis: 'duration-hold', reason: 'incomplete-sets', previousSeconds: 30, nextSeconds: 30 },
      { basis: 'increase', reason: 'all-sets-at-top-of-range', previousLoadKg: 60, nextLoadKg: 62.5, incrementKg: 2.5 },
      { basis: 'hold', reason: 'incomplete-sets', previousLoadKg: 50, nextLoadKg: 50 },
      { basis: 'hold', reason: 'single-session-below-minimum', previousLoadKg: 50, nextLoadKg: 50 },
      { basis: 'hold', reason: 'mixed-performance-in-range', previousLoadKg: 50, nextLoadKg: 50 },
      { basis: 'hold', reason: 'non-uniform-load', previousLoadKg: 50, nextLoadKg: 50 },
      { basis: 'regress', reason: 'two-consecutive-sessions-below-minimum', previousLoadKg: 60, nextLoadKg: 57.5, incrementKg: 2.5 },
    ];
    for (const target of allReasons) {
      const label = targetReasonLabel(target);
      expect(label.length).toBeGreaterThan(0);
      // The copy never contains the machine-readable code itself.
      expect(label).not.toContain(target.reason);
      expect(label).not.toMatch(/\bkg\b.*\bkg\b/);
    }
  });

  it('names the direction in words for every decision variant', () => {
    // Meaning never depends on color: every direction line carries words.
    const directions: ReadonlyArray<[NextExerciseTarget, string | null]> = [
      [{ basis: 'increase', reason: 'all-sets-at-top-of-range', previousLoadKg: 60, nextLoadKg: 62.5, incrementKg: 2.5 }, 'Increase 2.5 kg'],
      [{ basis: 'hold', reason: 'mixed-performance-in-range', previousLoadKg: 50, nextLoadKg: 50 }, 'Keep current load'],
      [{ basis: 'regress', reason: 'two-consecutive-sessions-below-minimum', previousLoadKg: 60, nextLoadKg: 57.5, incrementKg: 2.5 }, 'Reduce 2.5 kg'],
      [{ basis: 'regress', reason: 'two-consecutive-sessions-below-minimum', previousLoadKg: 2, nextLoadKg: null, incrementKg: 2.5 }, null],
      [{ basis: 'duration-increase', reason: 'all-sets-at-target-duration', previousSeconds: 30, nextSeconds: 35, incrementSeconds: 5 }, 'Increase duration by 5 sec'],
      [{ basis: 'duration-hold', reason: 'sets-below-target-duration', previousSeconds: 30, nextSeconds: 30 }, 'Keep current duration'],
      [{ basis: 'bodyweight-goal-reached', reason: 'all-sets-at-top-of-range' }, 'Goal reached'],
      [{ basis: 'bodyweight-hold', reason: 'reps-below-top-of-range' }, null],
      [{ basis: 'first-exposure', reason: 'no-history' }, null],
      [{ basis: 'scheme-change', reason: 'scheme-changed' }, null],
    ];
    for (const [target, expected] of directions) {
      expect(targetDeltaLabel(target)).toBe(expected);
    }
  });

  it('bodyweight target labels format the authored numbers only', () => {
    expect(bodyweightTargetLabel(threeByEightToTwelve)).toBe('12 reps');
    expect(bodyweightTargetLabel(threeByThirtySeconds)).toBe('30 sec');
  });
});

describe('progression-labels / last-time context', () => {
  it('formats loaded reps with the load and every set', () => {
    expect(
      lastTimeLabel(
        { basis: 'increase', reason: 'all-sets-at-top-of-range', previousLoadKg: 60, nextLoadKg: 62.5, incrementKg: 2.5 },
        [
          { type: 'reps', reps: 10, weightKg: 60 },
          { type: 'reps', reps: 10, weightKg: 60 },
          { type: 'reps', reps: 9, weightKg: 60 },
        ],
      ),
    ).toBe('Last time · 60 kg × 10, 10, 9');
  });

  it('formats timed work as the seconds list without duplicating a scheme value', () => {
    expect(
      lastTimeLabel(
        { basis: 'duration-hold', reason: 'sets-below-target-duration', previousSeconds: 30, nextSeconds: 30 },
        [
          { type: 'duration', durationSeconds: 25, weightKg: null },
          { type: 'duration', durationSeconds: 30, weightKg: null },
        ],
      ),
    ).toBe('Last time · 25, 30 sec');
  });

  it('formats bodyweight work as reps only — never a fabricated load', () => {
    expect(
      lastTimeLabel(
        { basis: 'bodyweight-hold', reason: 'reps-below-top-of-range' },
        [
          { type: 'reps', reps: 12, weightKg: null },
          { type: 'reps', reps: 12, weightKg: null },
        ],
      ),
    ).toBe('Last time · 12, 12 reps');
  });

  it('omits the line truthfully when no previous sets exist', () => {
    expect(lastTimeLabel({ basis: 'increase', reason: 'all-sets-at-top-of-range', previousLoadKg: 60, nextLoadKg: 62.5, incrementKg: 2.5 }, null)).toBeNull();
    expect(lastTimeLabel({ basis: 'increase', reason: 'all-sets-at-top-of-range', previousLoadKg: 60, nextLoadKg: 62.5, incrementKg: 2.5 }, [])).toBeNull();
  });
});

describe('progression-labels / number formatting', () => {
  it('formatKg trims float dust and keeps half-kilos', () => {
    expect(formatKg(52.5)).toBe('52.5 kg');
    expect(formatKg(52.555)).toBe('52.56 kg');
    expect(formatKg(0)).toBe('0 kg');
  });

  it('formatSeconds rounds to whole seconds', () => {
    expect(formatSeconds(35)).toBe('35 sec');
    expect(formatSeconds(35.4)).toBe('35 sec');
  });
});
