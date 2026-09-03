import { describe, expect, it } from 'vitest';

import type { ExerciseTargetDto } from '@/application/dto/exercise';
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
  mapSessionCallout,
} from '@/features/sessions/active-workout-logger-views';

const threeByEightToTen: RepPrescription = { type: 'reps', sets: 3, minReps: 8, maxReps: 10 };
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

function targetDto(exerciseId: string, target: ExerciseTargetDto['target']): ExerciseTargetDto {
  return { exerciseId, target };
}

const increaseFrom50 = targetDto('ex-bench', {
  basis: 'increase',
  previousLoadKg: 50,
  nextLoadKg: 52.5,
  incrementKg: 2.5,
});

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

describe('active-workout-views / buildSessionLoggerView (prefill precedence)', () => {
  it('prefills from the session when any set logged a weight', () => {
    const l = log(2, 'ex-bench', threeByEightToTen, [repSet(1, 10, 55)]);
    const view = buildSessionLoggerView(l, increaseFrom50);

    expect(view.prefillWeightKg).toBe(55);
    expect(view.prefillSource).toBe('session');
    // Advisory callout still shows the recommendation (52.5), not the session load.
    expect(view.callout?.kind).toBe('increase');
    expect(view.callout?.valueLabel).toBe('52.5 kg');
  });

  it('falls back to the recommendation when the log has no weights', () => {
    const l = log(2, 'ex-bench', threeByEightToTen, []);
    const view = buildSessionLoggerView(l, increaseFrom50);

    expect(view.prefillWeightKg).toBe(52.5);
    expect(view.prefillSource).toBe('recommendation');
    expect(view.callout?.contextLabel).toBe('From 50 kg last time — prefilled, edit freely.');
  });

  it('regress with a floored null target never prefills a fake 0 kg', () => {
    const l = log(2, 'ex-1', threeByEightToTen, []);
    const regressFloored = targetDto('ex-1', {
      basis: 'regress',
      previousLoadKg: 2,
      nextLoadKg: null,
      incrementKg: 2.5,
    });
    const view = buildSessionLoggerView(l, regressFloored);

    expect(view.prefillWeightKg).toBeNull();
    expect(view.prefillSource).toBe('none');
    expect(view.callout?.valueLabel).toBe('No added load');
  });

  it('bodyweight and duration bases carry no prefill and no callout', () => {
    const bodyweightLog = log(1, 'ex-push', threeByEightToTen, [repSet(1, 12, null)]);
    const bodyweight = buildSessionLoggerView(
      bodyweightLog,
      targetDto('ex-push', { basis: 'bodyweight' }),
    );
    expect(bodyweight.prefillWeightKg).toBeNull();
    expect(bodyweight.callout).toBeNull();

    const durationLog = log(2, 'ex-plank', threeByFortySeconds, []);
    const duration = buildSessionLoggerView(
      durationLog,
      targetDto('ex-plank', { basis: 'duration' }),
    );
    expect(duration.prefillWeightKg).toBeNull();
    expect(duration.callout).toBeNull();
  });

  it('null target (failed personalization) prefills nothing and renders no callout', () => {
    const l = log(1, 'ex-1', threeByEightToTen, []);
    const view = buildSessionLoggerView(l, null);

    expect(view.prefillWeightKg).toBeNull();
    expect(view.callout).toBeNull();
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

  it('scheme-change shows the current scheme, never a load prefill', () => {
    const l = log(1, 'ex-1', threeByEightToTen, []);
    const view = buildSessionLoggerView(l, targetDto('ex-1', { basis: 'scheme-change' }));

    expect(view.prefillWeightKg).toBeNull();
    expect(view.callout?.kind).toBe('scheme-change');
    expect(view.callout?.valueLabel).toBe('3 × 8–10');
  });

  it('first-exposure renders the first-time callout with no invented load', () => {
    const l = log(1, 'ex-1', threeByEightToTen, []);
    const view = buildSessionLoggerView(l, targetDto('ex-1', { basis: 'first-exposure' }));

    expect(view.prefillWeightKg).toBeNull();
    expect(view.callout?.kind).toBe('first-exposure');
    expect(view.callout?.valueLabel).toBeUndefined();
  });
});

describe('active-workout-views / mapSessionCallout', () => {
  it('regress with a load shows the lower target', () => {
    const view = mapSessionCallout(
      targetDto('ex-1', { basis: 'regress', previousLoadKg: 60, nextLoadKg: 57.5, incrementKg: 2.5 }),
      'none',
      '3 × 8–10',
    );
    expect(view?.kind).toBe('regress');
    expect(view?.valueLabel).toBe('57.5 kg');
  });

  it('hold renders REPEAT semantics with the same load', () => {
    const view = mapSessionCallout(
      targetDto('ex-1', { basis: 'hold', previousLoadKg: 22.5, nextLoadKg: 22.5 }),
      'none',
      '3 × 8–10',
    );
    expect(view?.kind).toBe('hold');
    expect(view?.valueLabel).toBe('22.5 kg');
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
      log(4, 'ex-4', threeByEightToTen, [repSet(1, 8, 30), repSet(2, 8, 30)]),
    ];
    const cards = buildSessionExerciseCardViews({
      logs,
      targets: [null, null, null, null],
      catalogByExerciseId: catalog,
      sessionStatus: 'in-progress',
    });

    expect(cards.map((c) => c.kind)).toEqual(['done', 'active', 'upcoming', 'partial']);
    expect(cards[1]?.badge).toEqual({
      style: 'accent',
      label: 'In progress',
      mobileVisible: true,
    });
    expect(cards[2]?.badge.mobileVisible).toBe(false);
    expect(cards[0]?.name).toBe('Bench Press');
    expect(cards[2]?.name).toBe('Exercise 3');
  });

  it('appends the captured RPE to the set value label', () => {
    const logs = [log(1, 'ex-1', threeByEightToTen, [repSet(1, 10, 52.5, 7)])];
    const cards = buildSessionExerciseCardViews({
      logs,
      targets: [null],
      catalogByExerciseId: catalog,
      sessionStatus: 'in-progress',
    });

    expect(cards[0]?.setRows[0]).toEqual({ setNumber: 1, valueLabel: '52.5 kg × 10 @ RPE 7' });
  });

  it('omits the RPE suffix when no RPE was captured', () => {
    const logs = [log(1, 'ex-1', threeByEightToTen, [repSet(1, 10, 52.5, null)])];
    const cards = buildSessionExerciseCardViews({
      logs,
      targets: [null],
      catalogByExerciseId: catalog,
      sessionStatus: 'in-progress',
    });

    expect(cards[0]?.setRows[0]).toEqual({ setNumber: 1, valueLabel: '52.5 kg × 10' });
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
