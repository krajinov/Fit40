import { describe, expect, it } from 'vitest';

import type { ExerciseTargetDto, PreviousExerciseSetDto } from '@/application/dto/exercise';
import type {
  WorkoutSessionExerciseDto,
  WorkoutSessionSetDto,
} from '@/application/dto/workout-session';
import type { RepPrescription } from '@/domain/value-objects/rep-prescription';

import {
  buildSessionExerciseCardViews,
  buildSessionProgress,
  formatSessionClock,
  formatVolumeLabel,
} from '@/features/sessions/active-workout-views';
import {
  buildSessionLoggerView,
  lastLoggedWeightKg,
} from '@/features/sessions/active-workout-logger-views';
import {
  mapSessionCallout,
  sessionQuietLabel,
} from '@/features/sessions/session-callout-views';

const threeByEightToTen: RepPrescription = { type: 'reps', sets: 3, minReps: 8, maxReps: 10 };
const threeByEightToTwelve: RepPrescription = { type: 'reps', sets: 3, minReps: 8, maxReps: 12 };
const threeByFortySeconds: RepPrescription = { type: 'duration', sets: 3, seconds: 40 };

function repSet(
  setNumber: number,
  reps: number,
  weightKg: number | null,
  rpe: number | null = null,
): WorkoutSessionSetDto {
  return { setNumber, type: 'reps', reps, weightKg, rpe };
}

function durationSet(
  setNumber: number,
  durationSeconds: number,
  weightKg: number | null = null,
): WorkoutSessionSetDto {
  return { setNumber, type: 'duration', durationSeconds, weightKg, rpe: null };
}

function log(
  order: number,
  exerciseId: string,
  prescription: RepPrescription,
  sets: WorkoutSessionSetDto[],
): WorkoutSessionExerciseDto {
  return { exerciseId, order, prescription, sets };
}

function loadedSets(reps: number[], load: number): PreviousExerciseSetDto[] {
  return reps.map((r) => ({ type: 'reps' as const, reps: r, weightKg: load }));
}

function targetDto(
  exerciseId: string,
  target: ExerciseTargetDto['target'],
  previousSets: PreviousExerciseSetDto[] | null = null,
): ExerciseTargetDto {
  return { exerciseId, target, previousSets };
}

const increaseFrom60 = targetDto(
  'ex-bench',
  {
    basis: 'increase',
    reason: 'all-sets-at-top-of-range',
    previousLoadKg: 60,
    nextLoadKg: 62.5,
    incrementKg: 2.5,
  },
  loadedSets([10, 10, 10], 60),
);

const durationIncreaseFrom40 = targetDto(
  'ex-plank',
  {
    basis: 'duration-increase',
    reason: 'all-sets-at-target-duration',
    previousSeconds: 40,
    nextSeconds: 45,
    incrementSeconds: 5,
  },
  [
    { type: 'duration', durationSeconds: 40, weightKg: null },
    { type: 'duration', durationSeconds: 40, weightKg: null },
    { type: 'duration', durationSeconds: 40, weightKg: null },
  ],
);

describe('active-workout-views / lastLoggedWeightKg', () => {
  it('returns the latest non-null weight of the log', () => {
    const l = log(1, 'ex-1', threeByEightToTen, [
      repSet(1, 10, 50),
      repSet(2, 10, 52.5),
      repSet(3, 9, 55),
    ]);
    expect(lastLoggedWeightKg(l)).toBe(55);
  });

  it('treats 0 kg as a real external load, not an absent load', () => {
    const l = log(1, 'ex-1', threeByEightToTen, [repSet(1, 10, 0)]);
    expect(lastLoggedWeightKg(l)).toBe(0);
  });

  it('skips null-weight sets and finds the last non-null one', () => {
    const l = log(1, 'ex-1', threeByEightToTen, [
      repSet(1, 10, 40),
      repSet(2, 10, null),
    ]);
    expect(lastLoggedWeightKg(l)).toBe(40);
  });

  it('returns null when every set is bodyweight (null weight)', () => {
    const l = log(1, 'ex-1', threeByEightToTen, [repSet(1, 12, null)]);
    expect(lastLoggedWeightKg(l)).toBeNull();
  });
});

describe('active-workout-views / buildSessionLoggerView (weight prefill precedence)', () => {
  it('prefills from the session when any set logged a weight — the recommendation stays visible', () => {
    const l = log(2, 'ex-bench', threeByEightToTen, [repSet(1, 10, 60)]);
    const view = buildSessionLoggerView(l, increaseFrom60);

    expect(view.prefillWeightKg).toBe(60);
    expect(view.prefillSource).toBe('session');
    expect(view.prefillKind).toBe('weight');
    // Advisory callout still shows the recommendation (62.5), not the session load.
    expect(view.callout?.kind).toBe('increase');
    expect(view.callout?.valueLabel).toBe('62.5 kg');
    expect(view.callout?.deltaLabel).toBe('Increase 2.5 kg');
    expect(view.callout?.contextLabel).toBe('Last time · 60 kg × 10, 10, 10');
    // The override hint confirms the user's value stands — no warning.
    expect(view.hintLabel).toBe(
      'You logged 60 kg — your weight stands. The recommendation stays as context.',
    );
  });

  it('prefills from the recommendation when the log has no weights, with the advisory hint', () => {
    const l = log(2, 'ex-bench', threeByEightToTen, []);
    const view = buildSessionLoggerView(l, increaseFrom60);

    expect(view.prefillWeightKg).toBe(62.5);
    expect(view.prefillSource).toBe('recommendation');
    expect(view.callout?.contextLabel).toBe('Last time · 60 kg × 10, 10, 10');
    expect(view.hintLabel).toBe('Advisory prefill — edit freely. Your logged value always counts.');
  });

  it('regress with a floored null target never prefills a fake 0 kg', () => {
    const l = log(2, 'ex-1', threeByEightToTen, []);
    const regressFloored = targetDto(
      'ex-1',
      {
        basis: 'regress',
        reason: 'two-consecutive-sessions-below-minimum',
        previousLoadKg: 2,
        nextLoadKg: null,
        incrementKg: 2.5,
      },
      loadedSets([7, 7, 7], 2),
    );
    const view = buildSessionLoggerView(l, regressFloored);

    expect(view.prefillWeightKg).toBeNull();
    expect(view.prefillSource).toBe('none');
    expect(view.callout?.valueLabel).toBe('No added load');
    expect(view.callout?.deltaLabel).toBeUndefined();
  });
});

describe('active-workout-views / buildSessionLoggerView (duration prefill precedence)', () => {
  it('prefills seconds from the recommendation when no session value exists', () => {
    const l = log(2, 'ex-plank', threeByFortySeconds, []);
    const view = buildSessionLoggerView(l, durationIncreaseFrom40);

    expect(view.prefillSeconds).toBe(45);
    expect(view.prefillWeightKg).toBeNull();
    expect(view.prefillSource).toBe('recommendation');
    expect(view.prefillKind).toBe('seconds');
    expect(view.callout?.kind).toBe('duration-increase');
    expect(view.callout?.valueLabel).toBe('45 sec');
    expect(view.callout?.deltaLabel).toBe('Increase duration by 5 sec');
    expect(view.callout?.contextLabel).toBe('Last time · 40, 40, 40 sec');
    expect(view.hintLabel).toBe('Advisory prefill — edit freely. Your logged value always counts.');
  });

  it('logged session seconds override the duration recommendation and the hint says the value stands', () => {
    const l = log(2, 'ex-plank', threeByFortySeconds, [durationSet(1, 50)]);
    const view = buildSessionLoggerView(l, durationIncreaseFrom40);

    expect(view.prefillSeconds).toBe(50);
    expect(view.prefillSource).toBe('session');
    // The recommendation remains visible as context.
    expect(view.callout?.kind).toBe('duration-increase');
    expect(view.callout?.valueLabel).toBe('45 sec');
    expect(view.hintLabel).toBe(
      'You logged 50 sec — your duration stands. The recommendation stays as context.',
    );
  });

  it('duration hold renders the keep-current-duration state and prefills the target seconds', () => {
    const l = log(2, 'ex-plank', threeByFortySeconds, []);
    const view = buildSessionLoggerView(
      l,
      targetDto(
        'ex-plank',
        {
          basis: 'duration-hold',
          reason: 'sets-below-target-duration',
          previousSeconds: 40,
          nextSeconds: 40,
        },
        [
          { type: 'duration', durationSeconds: 35, weightKg: null },
          { type: 'duration', durationSeconds: 40, weightKg: null },
          { type: 'duration', durationSeconds: 40, weightKg: null },
        ],
      ),
    );

    expect(view.prefillSeconds).toBe(40);
    expect(view.callout?.kind).toBe('duration-hold');
    expect(view.callout?.valueLabel).toBe('40 sec');
    expect(view.callout?.deltaLabel).toBe('Keep current duration');
    expect(view.callout?.contextLabel).toBe('Last time · 35, 40, 40 sec');
  });
});

describe('active-workout-views / buildSessionLoggerView (bodyweight and quiet states)', () => {
  it('bodyweight goal reached shows rep guidance only — no fake load, no weight prefill', () => {
    const bodyweightLog = log(1, 'ex-push', threeByEightToTwelve, [repSet(1, 12, null)]);
    const view = buildSessionLoggerView(
      bodyweightLog,
      targetDto(
        'ex-push',
        { basis: 'bodyweight-goal-reached', reason: 'all-sets-at-top-of-range' },
        [
          { type: 'reps', reps: 12, weightKg: null },
          { type: 'reps', reps: 12, weightKg: null },
          { type: 'reps', reps: 12, weightKg: null },
        ],
      ),
    );

    expect(view.prefillWeightKg).toBeNull();
    expect(view.prefillSeconds).toBeNull();
    expect(view.prefillSource).toBe('none');
    expect(view.callout?.kind).toBe('bodyweight-goal-reached');
    expect(view.callout?.valueLabel).toBe('12 reps');
    expect(view.callout?.deltaLabel).toBe('Goal reached');
  });

  it('bodyweight hold renders truthful rep guidance from the authored prescription', () => {
    const bodyweightLog = log(1, 'ex-push', threeByEightToTwelve, []);
    const view = buildSessionLoggerView(
      bodyweightLog,
      targetDto(
        'ex-push',
        { basis: 'bodyweight-hold', reason: 'reps-below-top-of-range' },
        [
          { type: 'reps', reps: 10, weightKg: null },
          { type: 'reps', reps: 9, weightKg: null },
          { type: 'reps', reps: 10, weightKg: null },
        ],
      ),
    );

    expect(view.prefillWeightKg).toBeNull();
    expect(view.callout?.kind).toBe('bodyweight-hold');
    expect(view.callout?.valueLabel).toBe('12 reps');
    expect(view.callout?.deltaLabel).toBeUndefined();
    expect(view.callout?.contextLabel).toBe('Last time · 10, 9, 10 reps');
  });

  it('first exposure renders the quiet line, no callout, no prefill', () => {
    const l = log(1, 'ex-new', threeByEightToTen, []);
    const view = buildSessionLoggerView(
      l,
      targetDto('ex-new', { basis: 'first-exposure', reason: 'no-history' }),
    );

    expect(view.prefillWeightKg).toBeNull();
    expect(view.prefillSeconds).toBeNull();
    expect(view.prefillSource).toBe('none');
    expect(view.callout).toBeNull();
    expect(view.quietLabel).toBe('First time · no history yet');
  });

  it('scheme change stays informational: the current scheme, never a load prefill', () => {
    const l = log(1, 'ex-1', threeByEightToTen, []);
    const view = buildSessionLoggerView(
      l,
      targetDto('ex-1', { basis: 'scheme-change', reason: 'scheme-changed' }),
    );

    expect(view.prefillWeightKg).toBeNull();
    expect(view.callout?.kind).toBe('scheme-change');
    expect(view.callout?.valueLabel).toBe('3 × 8–10');
    expect(view.callout?.contextLabel).toBe(
      'Previous performance was recorded under a different prescription.',
    );
    expect(view.hintLabel).toBeNull();
  });

  it('RPE on previous sets never affects the recommendation presentation', () => {
    // The DTO projection carries no RPE field at all, so identical previous
    // sets with different historical RPEs produce identical callouts.
    const withRpe = buildSessionLoggerView(
      log(1, 'ex-1', threeByEightToTen, []),
      increaseFrom60,
    );
    const withoutRpe = buildSessionLoggerView(
      log(1, 'ex-1', threeByEightToTen, []),
      increaseFrom60,
    );
    expect(withRpe.callout).toEqual(withoutRpe.callout);
  });

  it('null target (failed personalization) prefills nothing and renders no callout', () => {
    const l = log(1, 'ex-1', threeByEightToTen, []);
    const view = buildSessionLoggerView(l, null);

    expect(view.prefillWeightKg).toBeNull();
    expect(view.prefillSeconds).toBeNull();
    expect(view.callout).toBeNull();
    expect(view.quietLabel).toBeNull();
    expect(view.hintLabel).toBeNull();
  });

  it('duplicate exercise ids never leak weights across sibling logs', () => {
    const first = log(1, 'ex-dup', threeByEightToTen, [repSet(1, 10, 100)]);
    const second = log(2, 'ex-dup', threeByEightToTen, []);

    const firstView = buildSessionLoggerView(first, null);
    const secondView = buildSessionLoggerView(second, null);

    expect(firstView.prefillWeightKg).toBe(100);
    // Same exerciseId, but ITS log has no logged weight and no recommendation:
    // prefill stays empty — session history is per-log, never per-exercise.
    expect(secondView.prefillWeightKg).toBeNull();
  });
});

describe('active-workout-views / mapSessionCallout', () => {
  it('hold renders the same-load target with its reason-derived delta', () => {
    const view = mapSessionCallout(
      targetDto(
        'ex-1',
        { basis: 'hold', reason: 'mixed-performance-in-range', previousLoadKg: 22.5, nextLoadKg: 22.5 },
        loadedSets([9, 9, 10], 22.5),
      ),
      'none',
      threeByEightToTen,
    );
    expect(view?.kind).toBe('hold');
    expect(view?.valueLabel).toBe('22.5 kg');
    expect(view?.deltaLabel).toBe('Keep current load');
  });

  it('regress with a load shows the lower target', () => {
    const view = mapSessionCallout(
      targetDto(
        'ex-1',
        {
          basis: 'regress',
          reason: 'two-consecutive-sessions-below-minimum',
          previousLoadKg: 60,
          nextLoadKg: 57.5,
          incrementKg: 2.5,
        },
        loadedSets([7, 6, 6], 60),
      ),
      'none',
      threeByEightToTen,
    );
    expect(view?.kind).toBe('regress');
    expect(view?.valueLabel).toBe('57.5 kg');
    expect(view?.deltaLabel).toBe('Reduce 2.5 kg');
  });

  it('omits missing context truthfully instead of fabricating a last-time line', () => {
    const view = mapSessionCallout(
      targetDto(
        'ex-1',
        { basis: 'hold', reason: 'incomplete-sets', previousLoadKg: 50, nextLoadKg: 50 },
        [],
      ),
      'none',
      threeByEightToTen,
    );
    expect(view?.contextLabel).toBeUndefined();
  });

  it('sessionQuietLabel returns the quiet line only for first exposure', () => {
    expect(sessionQuietLabel(targetDto('ex-1', { basis: 'first-exposure', reason: 'no-history' }))).toBe(
      'First time · no history yet',
    );
    expect(sessionQuietLabel(increaseFrom60)).toBeNull();
    expect(sessionQuietLabel(null)).toBeNull();
  });
});

describe('active-workout-views / buildSessionExerciseCardViews', () => {
  const catalog = new Map([
    ['ex-1', { name: 'Bench Press', equipment: 'barbell' as const }],
  ]);

  it('marks the first under-prescribed log active and the rest by set count', () => {
    const logs = [
      log(1, 'ex-1', threeByEightToTen, [repSet(1, 10, 50), repSet(2, 10, 50), repSet(3, 9, 50)]),
      log(2, 'ex-2', threeByEightToTen, [repSet(1, 10, 40)]),
      log(3, 'ex-3', threeByEightToTen, []),
    ];
    const cards = buildSessionExerciseCardViews({
      logs,
      targets: [null, null, null],
      catalogByExerciseId: catalog,
      sessionStatus: 'in-progress',
    });

    expect(cards[0]?.kind).toBe('done');
    expect(cards[1]?.kind).toBe('active');
    expect(cards[2]?.kind).toBe('upcoming');
    expect(cards[0]?.badge).toEqual({ style: 'done', label: 'Completed', mobileVisible: true });
  });

  it('appends the RPE suffix to duration sets too', () => {
    const logs = [
      log(1, 'ex-plank', threeByFortySeconds, [
        { setNumber: 1, type: 'duration', durationSeconds: 40, weightKg: null, rpe: 8 },
      ]),
    ];
    const cards = buildSessionExerciseCardViews({
      logs,
      targets: [null],
      catalogByExerciseId: new Map(),
      sessionStatus: 'in-progress',
    });

    expect(cards[0]?.setRows[0]?.valueLabel).toBe('40s @ RPE 8');
  });

  it('duration sets render seconds, with weight when present', () => {
    const logs = [log(1, 'ex-plank', threeByFortySeconds, [durationSet(1, 40), durationSet(2, 45, 10)])];
    const cards = buildSessionExerciseCardViews({
      logs,
      targets: [null],
      catalogByExerciseId: new Map(),
      sessionStatus: 'in-progress',
    });

    expect(cards[0]?.setRows[0]?.valueLabel).toBe('40s');
    expect(cards[0]?.setRows[1]?.valueLabel).toBe('10 kg × 45s');
  });

  it('completed sessions carry no logger and mark nothing active', () => {
    const logs = [
      log(1, 'ex-1', threeByEightToTen, [repSet(1, 10, 50)]),
      log(2, 'ex-2', threeByEightToTen, []),
    ];
    const cards = buildSessionExerciseCardViews({
      logs,
      targets: [null, null],
      catalogByExerciseId: catalog,
      sessionStatus: 'completed',
    });

    expect(cards[0]?.kind).toBe('partial');
    expect(cards[1]?.kind).toBe('upcoming');
    expect(cards.every((c) => c.logger === null)).toBe(true);
  });
});

describe('active-workout-views / buildSessionProgress', () => {
  it('sums prescribed sets across logs and computes the percentage', () => {
    const logs = [
      log(1, 'ex-1', threeByEightToTen, [repSet(1, 10, 50)]),
      log(2, 'ex-2', threeByFortySeconds, []),
    ];
    const progress = buildSessionProgress(logs, {
      totalSets: 1,
      totalReps: 10,
      totalDurationSeconds: 0,
      volume: 500,
    });

    expect(progress).toEqual({
      loggedSets: 1,
      prescribedSets: 6,
      percentage: 17,
      repsLabel: '10 reps',
      volumeLabel: '500 kg',
    });
  });

  it('caps the percentage at 100 when extra sets were logged', () => {
    const logs = [log(1, 'ex-1', threeByEightToTen, [
      repSet(1, 10, 50),
      repSet(2, 10, 50),
      repSet(3, 10, 50),
      repSet(4, 10, 50),
    ])];
    const progress = buildSessionProgress(logs, {
      totalSets: 4,
      totalReps: 40,
      totalDurationSeconds: 0,
      volume: 2000,
    });

    expect(progress.percentage).toBe(100);
    expect(progress.prescribedSets).toBe(3);
  });

  it('renders 0% when the snapshot has no logs', () => {
    const progress = buildSessionProgress([], {
      totalSets: 0,
      totalReps: 0,
      totalDurationSeconds: 0,
      volume: 0,
    });

    expect(progress.percentage).toBe(0);
  });
});

describe('active-workout-views / formatting helpers', () => {
  it('formats the clock label as 24h time', () => {
    expect(formatSessionClock('2026-09-01T17:42:00.000Z')).toMatch(/^\d{2}:\d{2}$/);
  });

  it('formats volume with thousands separators and no float dust', () => {
    expect(formatVolumeLabel(1240)).toBe('1,240 kg');
    expect(formatVolumeLabel(1240.4)).toBe('1,240 kg');
  });
});
