import { describe, expect, it } from 'vitest';

import type { ExerciseTargetDto, PreviousExerciseSetDto } from '@/application/dto/exercise';
import type { NextExerciseTarget } from '@/domain/services/exercise-progression';
import type { RepPrescription } from '@/domain/value-objects/rep-prescription';
import {
  mapExerciseTargetsToViews,
  mapExerciseTargetToView,
} from '@/features/sessions/workout-target-views';
import { formatKg, formatSeconds } from '@/features/sessions/progression-labels';

const threeByEightToTen: RepPrescription = { type: 'reps', sets: 3, minReps: 8, maxReps: 10 };
const threeByEightToTwelve: RepPrescription = { type: 'reps', sets: 3, minReps: 8, maxReps: 12 };
const threeByThirtySeconds: RepPrescription = { type: 'duration', sets: 3, seconds: 30 };

function loadedRepSets(reps: number[], load: number): PreviousExerciseSetDto[] {
  return reps.map((repsOne) => ({ type: 'reps' as const, reps: repsOne, weightKg: load }));
}

function targetDto(
  exerciseId: string,
  target: NextExerciseTarget,
  previousSets: PreviousExerciseSetDto[] | null = null,
): ExerciseTargetDto {
  return { exerciseId, target, previousSets };
}

const increaseFrom60 = targetDto(
  'ex-1',
  {
    basis: 'increase',
    reason: 'all-sets-at-top-of-range',
    previousLoadKg: 60,
    nextLoadKg: 62.5,
    incrementKg: 2.5,
  },
  loadedRepSets([10, 10, 10], 60),
);

describe('formatKg / formatSeconds (progression-labels)', () => {
  it('trims float dust while keeping half-kilos', () => {
    expect(formatKg(52.5)).toBe('52.5 kg');
  });

  it('renders whole numbers without decimals', () => {
    expect(formatKg(50)).toBe('50 kg');
  });

  it('keeps zero a real external load', () => {
    expect(formatKg(0)).toBe('0 kg');
  });

  it('formats seconds as whole seconds', () => {
    expect(formatSeconds(35)).toBe('35 sec');
  });
});

describe('mapExerciseTargetToView (M8 target blocks)', () => {
  it('increase → NEXT TARGET block with delta, last-time reps, and the top-of-range reason', () => {
    const view = mapExerciseTargetToView(increaseFrom60, threeByEightToTen);

    expect(view.exerciseId).toBe('ex-1');
    expect(view.lastTimeLabel).toBe('Last time · 60 kg × 10, 10, 10');
    expect(view.quietLabel).toBeNull();
    expect(view.block).toEqual({
      kind: 'increase',
      eyebrowLabel: 'NEXT TARGET',
      valueLabel: '62.5 kg',
      deltaLabel: 'Increase 2.5 kg',
      reasonLabel: 'Completed all prescribed sets at the top of the rep range.',
      showGoalBadge: false,
      ariaLabel:
        'NEXT TARGET. 62.5 kg. Increase 2.5 kg. Completed all prescribed sets at the top of the rep range.',
    });
  });

  it('hold → NEXT TARGET block with Keep current load and its single-below-min reason', () => {
    const view = mapExerciseTargetToView(
      targetDto(
        'ex-2',
        {
          basis: 'hold',
          reason: 'single-session-below-minimum',
          previousLoadKg: 22.5,
          nextLoadKg: 22.5,
        },
        loadedRepSets([8, 7, 7], 22.5),
      ),
      threeByEightToTwelve,
    );

    expect(view.lastTimeLabel).toBe('Last time · 22.5 kg × 8, 7, 7');
    expect(view.block?.kind).toBe('hold');
    expect(view.block?.deltaLabel).toBe('Keep current load');
    expect(view.block?.reasonLabel).toBe(
      'Previous session was below the target range. One more similar session would trigger a reduction.',
    );
  });

  it('hold with mixed-performance reason keeps the load and explains it truthfully', () => {
    const view = mapExerciseTargetToView(
      targetDto(
        'ex-2b',
        {
          basis: 'hold',
          reason: 'mixed-performance-in-range',
          previousLoadKg: 40,
          nextLoadKg: 40,
        },
        loadedRepSets([10, 9, 10], 40),
      ),
      threeByEightToTen,
    );

    expect(view.block?.reasonLabel).toBe(
      'Reps landed inside the target range — keep the current load.',
    );
  });

  it('regress → amber NEXT TARGET block with the two-consecutive-sessions reason', () => {
    const view = mapExerciseTargetToView(
      targetDto(
        'ex-3',
        {
          basis: 'regress',
          reason: 'two-consecutive-sessions-below-minimum',
          previousLoadKg: 60,
          nextLoadKg: 57.5,
          incrementKg: 2.5,
        },
        loadedRepSets([7, 6, 6], 60),
      ),
      threeByEightToTen,
    );

    expect(view.lastTimeLabel).toBe('Last time · 60 kg × 7, 6, 6');
    expect(view.block).toMatchObject({
      kind: 'regress',
      eyebrowLabel: 'NEXT TARGET',
      valueLabel: '57.5 kg',
      deltaLabel: 'Reduce 2.5 kg',
      reasonLabel: 'Two consecutive sessions were below the target range.',
    });
  });

  it('regress with a floored null target renders "No added load", never a fake 0 kg', () => {
    const view = mapExerciseTargetToView(
      targetDto(
        'ex-4',
        {
          basis: 'regress',
          reason: 'two-consecutive-sessions-below-minimum',
          previousLoadKg: 2,
          nextLoadKg: null,
          incrementKg: 2.5,
        },
        loadedRepSets([7, 6, 6], 2),
      ),
      threeByEightToTen,
    );

    expect(view.block?.valueLabel).toBe('No added load');
    expect(view.block?.deltaLabel).toBeNull();
  });

  it('scheme-change → neutral NEW TARGET SCHEME block with the current scheme, no historical load', () => {
    const view = mapExerciseTargetToView(
      targetDto('ex-5', { basis: 'scheme-change', reason: 'scheme-changed' }),
      threeByEightToTen,
    );

    expect(view.lastTimeLabel).toBeNull();
    expect(view.block).toMatchObject({
      kind: 'scheme-change',
      eyebrowLabel: 'NEW TARGET SCHEME',
      valueLabel: '3 × 8–10',
      deltaLabel: null,
      reasonLabel: 'Previous performance was recorded under a different prescription.',
    });
  });

  it('first exposure stays lightweight: quiet line only, no block, no history', () => {
    const view = mapExerciseTargetToView(
      targetDto('ex-6', { basis: 'first-exposure', reason: 'no-history' }),
      threeByEightToTen,
    );

    expect(view.lastTimeLabel).toBeNull();
    expect(view.block).toBeNull();
    expect(view.quietLabel).toBe('First time · no history yet');
  });

  it('bodyweight goal reached → TARGET block with the authored rep target and Goal reached badge', () => {
    const view = mapExerciseTargetToView(
      targetDto(
        'ex-7',
        { basis: 'bodyweight-goal-reached', reason: 'all-sets-at-top-of-range' },
        loadedRepSets([12, 12, 12], 0).map((s) => (s.type === 'reps' ? { ...s, weightKg: null } : s)),
      ),
      threeByEightToTwelve,
    );

    expect(view.block).toMatchObject({
      kind: 'bodyweight-goal-reached',
      eyebrowLabel: 'TARGET',
      valueLabel: '12 reps',
      deltaLabel: 'Goal reached',
      showGoalBadge: true,
      reasonLabel: 'You completed all prescribed sets at the top of the target range.',
    });
    // Bodyweight context is truthful reps only — never a fabricated load.
    expect(view.lastTimeLabel).toBe('Last time · 12, 12, 12 reps');
  });

  it('bodyweight hold → TARGET block with rep guidance, no invented load', () => {
    const view = mapExerciseTargetToView(
      targetDto(
        'ex-8',
        { basis: 'bodyweight-hold', reason: 'reps-below-top-of-range' },
        loadedRepSets([10, 9, 10], 0).map((s) => (s.type === 'reps' ? { ...s, weightKg: null } : s)),
      ),
      threeByEightToTwelve,
    );

    expect(view.block).toMatchObject({
      kind: 'bodyweight-hold',
      eyebrowLabel: 'TARGET',
      valueLabel: '12 reps',
      deltaLabel: null,
      reasonLabel: 'Aim for the top of the prescribed rep range in every set.',
    });
  });

  it('duration increase → NEXT TARGET block in seconds with the +5 s delta', () => {
    const view = mapExerciseTargetToView(
      targetDto(
        'ex-9',
        {
          basis: 'duration-increase',
          reason: 'all-sets-at-target-duration',
          previousSeconds: 30,
          nextSeconds: 35,
          incrementSeconds: 5,
        },
        [
          { type: 'duration', durationSeconds: 30, weightKg: null },
          { type: 'duration', durationSeconds: 30, weightKg: null },
          { type: 'duration', durationSeconds: 30, weightKg: null },
        ],
      ),
      threeByThirtySeconds,
    );

    expect(view.block).toMatchObject({
      kind: 'duration-increase',
      eyebrowLabel: 'NEXT TARGET',
      valueLabel: '35 sec',
      deltaLabel: 'Increase duration by 5 sec',
      reasonLabel: 'Completed all prescribed sets at the target duration.',
    });
    expect(view.lastTimeLabel).toBe('Last time · 30, 30, 30 sec');
  });

  it('duration hold → TARGET block with Keep current duration and its reason', () => {
    const view = mapExerciseTargetToView(
      targetDto(
        'ex-10',
        {
          basis: 'duration-hold',
          reason: 'sets-below-target-duration',
          previousSeconds: 30,
          nextSeconds: 30,
        },
        [
          { type: 'duration', durationSeconds: 25, weightKg: null },
          { type: 'duration', durationSeconds: 30, weightKg: null },
          { type: 'duration', durationSeconds: 30, weightKg: null },
        ],
      ),
      threeByThirtySeconds,
    );

    expect(view.block).toMatchObject({
      kind: 'duration-hold',
      eyebrowLabel: 'TARGET',
      valueLabel: '30 sec',
      deltaLabel: 'Keep current duration',
      reasonLabel: 'Aim for the full target duration in every set.',
    });
  });

  it('duration hold with an incomplete log explains the incomplete reason truthfully', () => {
    const view = mapExerciseTargetToView(
      targetDto(
        'ex-10b',
        {
          basis: 'duration-hold',
          reason: 'incomplete-sets',
          previousSeconds: 30,
          nextSeconds: 30,
        },
        [{ type: 'duration', durationSeconds: 30, weightKg: null }],
      ),
      threeByThirtySeconds,
    );

    expect(view.block?.reasonLabel).toBe('Previous performance was incomplete.');
  });

  it('missing optional context is omitted truthfully (empty previousSets → no last-time line)', () => {
    const view = mapExerciseTargetToView(
      targetDto(
        'ex-11',
        { basis: 'hold', reason: 'incomplete-sets', previousLoadKg: 50, nextLoadKg: 50 },
        [],
      ),
      threeByEightToTen,
    );

    expect(view.lastTimeLabel).toBeNull();
    expect(view.block?.kind).toBe('hold');
  });

  it('null dto (anonymous/failed personalization) → no history, no block, no quiet line', () => {
    const view = mapExerciseTargetToView(null, threeByEightToTen);

    expect(view.lastTimeLabel).toBeNull();
    expect(view.block).toBeNull();
    expect(view.quietLabel).toBeNull();
    expect(view.exerciseId).toBe('');
  });
});

describe('mapExerciseTargetsToViews', () => {
  it('preserves request order across a mixed batch and maps every variant', () => {
    const dtos: ReadonlyArray<ExerciseTargetDto | null> = [
      increaseFrom60,
      null,
      targetDto(
        'ex-3',
        { basis: 'hold', reason: 'mixed-performance-in-range', previousLoadKg: 20, nextLoadKg: 20 },
        loadedRepSets([9, 9, 9], 20),
      ),
      targetDto('ex-4', { basis: 'first-exposure', reason: 'no-history' }),
      targetDto('ex-5', { basis: 'bodyweight-goal-reached', reason: 'all-sets-at-top-of-range' }),
      targetDto('ex-6', { basis: 'bodyweight-hold', reason: 'reps-below-top-of-range' }),
      targetDto('ex-7', {
        basis: 'duration-increase',
        reason: 'all-sets-at-target-duration',
        previousSeconds: 30,
        nextSeconds: 35,
        incrementSeconds: 5,
      }),
      targetDto('ex-8', {
        basis: 'duration-hold',
        reason: 'sets-below-target-duration',
        previousSeconds: 30,
        nextSeconds: 30,
      }),
      targetDto('ex-9', { basis: 'scheme-change', reason: 'scheme-changed' }),
      targetDto(
        'ex-10',
        {
          basis: 'regress',
          reason: 'two-consecutive-sessions-below-minimum',
          previousLoadKg: 60,
          nextLoadKg: 57.5,
          incrementKg: 2.5,
        },
        loadedRepSets([7, 6, 6], 60),
      ),
    ];
    const prescriptions: ReadonlyArray<RepPrescription> = [
      threeByEightToTen,
      threeByEightToTen,
      threeByEightToTen,
      threeByEightToTen,
      threeByEightToTwelve,
      threeByEightToTwelve,
      threeByThirtySeconds,
      threeByThirtySeconds,
      threeByEightToTen,
      threeByEightToTen,
    ];

    const views = mapExerciseTargetsToViews(dtos, prescriptions);

    expect(views.map((v) => v.exerciseId)).toEqual([
      'ex-1', '', 'ex-3', 'ex-4', 'ex-5', 'ex-6', 'ex-7', 'ex-8', 'ex-9', 'ex-10',
    ]);
    // No variant silently falls through to "no UI" — each maps its kind.
    expect(views.map((v) => v.block?.kind ?? null)).toEqual([
      'increase', null, 'hold', null, 'bodyweight-goal-reached', 'bodyweight-hold',
      'duration-increase', 'duration-hold', 'scheme-change', 'regress',
    ]);
    // First exposure renders the quiet line, everything else the block line.
    expect(views[3]?.quietLabel).toBe('First time · no history yet');
    expect(views[0]?.quietLabel).toBeNull();
  });

  it('renders the empty view for every position when the zip contract is violated', () => {
    // A caller bug (mismatched lengths) must never cast a missing
    // prescription into existence — every row renders the empty view.
    const views = mapExerciseTargetsToViews([increaseFrom60, null], [threeByEightToTen]);

    expect(views).toHaveLength(2);
    for (const view of views) {
      expect(view.block).toBeNull();
      expect(view.lastTimeLabel).toBeNull();
      expect(view.quietLabel).toBeNull();
      expect(view.exerciseId).toBe('');
    }
  });
});
