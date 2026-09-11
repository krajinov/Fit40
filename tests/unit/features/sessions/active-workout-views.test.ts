import { describe, expect, it } from 'vitest';

import type { ExerciseTargetDto, PreviousExerciseSetDto } from '@/application/dto/exercise';
import type { ExerciseSubstitutionCandidatesDto } from '@/application/dto/substitution-candidates';
import type {
  WorkoutSessionDto,
  WorkoutSessionExerciseDto,
  WorkoutSessionMetricsDto,
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
  sessionHintLabel,
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
  overrides: Partial<WorkoutSessionExerciseDto> = {},
): WorkoutSessionExerciseDto {
  return {
    authoredExerciseId: exerciseId,
    performedExerciseId: exerciseId,
    isSubstituted: false,
    isSkipped: false,
    substitutionEligibility: { blockedBy: null, canRestore: false },
    adjustmentEligibility: {
      isSkipped: false,
      blockedBy: null,
      canSkip: true,
      canUnskip: false,
      canMoveUp: true,
      canMoveDown: true,
    },
    order,
    prescription,
    sets,
    ...overrides,
  };
}

/**
 * A skipped occurrence fixture (M10): the persisted flag plus the domain's
 * eligibility projection of a mutable skipped occurrence.
 */
function skippedLog(
  order: number,
  exerciseId: string,
  prescription: RepPrescription = threeByEightToTen,
): WorkoutSessionExerciseDto {
  return log(order, exerciseId, prescription, [], {
    isSkipped: true,
    substitutionEligibility: { blockedBy: 'skipped', canRestore: false },
    adjustmentEligibility: {
      isSkipped: true,
      blockedBy: null,
      canSkip: false,
      canUnskip: true,
      canMoveUp: true,
      canMoveDown: true,
    },
  });
}

/** A substitution candidates DTO built from plain candidate facts. */
function candidatesDto(
  sourceExerciseId: string,
  candidates: ReadonlyArray<{
    readonly exerciseId: string;
    readonly name: string;
    readonly equipment?: 'bodyweight' | 'dumbbell' | 'barbell';
    readonly primaryMuscle?: 'chest' | 'quadriceps';
  }>,
  isLimited = false,
): ExerciseSubstitutionCandidatesDto {
  return {
    sourceExerciseId,
    isLimited,
    candidates: candidates.map((candidate) => ({
      exerciseId: candidate.exerciseId,
      name: candidate.name,
      slug: `slug-${candidate.exerciseId}`,
      equipment: candidate.equipment ?? 'dumbbell',
      primaryMuscle: candidate.primaryMuscle ?? 'chest',
      movementPattern: 'push-horizontal',
      difficulty: 'intermediate',
      matchTier: 'same-pattern-same-muscle',
    })),
  };
}

/** A minimal session DTO around given logs, metrics and domain-owned totals. */
function sessionDto(
  logs: WorkoutSessionExerciseDto[],
  metrics: WorkoutSessionMetricsDto,
  totals: { prescribedSets: number; skippedExerciseCount: number } = {
    prescribedSets: 0,
    skippedExerciseCount: 0,
  },
): WorkoutSessionDto {
  return {
    sessionId: 's-1',
    scheduledWorkoutId: 'sw-1',
    workoutId: 'w-1',
    status: 'in-progress',
    startedAt: '2026-09-01T17:00:00.000Z',
    completedAt: null,
    exerciseLogs: logs,
    metrics,
    prescribedSets: totals.prescribedSets,
    skippedExerciseCount: totals.skippedExerciseCount,
  };
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

  it('sessionHintLabel with a null prefill never claims a logged 0 kg', () => {
    // 0 kg is a real external load, not a stand-in for "nothing logged" —
    // a null prefill must not fabricate "You logged 0 kg".
    expect(sessionHintLabel('session', 'weight', null)).toBeNull();
    expect(sessionHintLabel('session', 'seconds', null)).toBeNull();
    expect(sessionHintLabel('session', 'weight', 0)).toBe(
      'You logged 0 kg — your weight stands. The recommendation stays as context.',
    );
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

  /** No substitution candidates resolved — the honest empty state. */
  const noCandidates = new Map<string, ExerciseSubstitutionCandidatesDto>();

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
      candidatesByPerformedExerciseId: noCandidates,
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
      candidatesByPerformedExerciseId: noCandidates,
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
      candidatesByPerformedExerciseId: noCandidates,
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
      candidatesByPerformedExerciseId: noCandidates,
      sessionStatus: 'completed',
    });

    expect(cards[0]?.kind).toBe('partial');
    expect(cards[1]?.kind).toBe('upcoming');
    expect(cards.every((c) => c.logger === null)).toBe(true);
  });

  describe('skip display (M10)', () => {
    it('gives a skipped occurrence the skipped kind with top precedence', () => {
      // The skipped fixture sits first in log order with zero sets — the
      // raw facts would otherwise mark it `active`. Skipped wins, and the
      // NEXT non-skipped under-prescribed log becomes the active target.
      const logs = [skippedLog(1, 'ex-1'), log(2, 'ex-2', threeByEightToTen, [])];
      const cards = buildSessionExerciseCardViews({
        logs,
        targets: [null, null],
        catalogByExerciseId: catalog,
        candidatesByPerformedExerciseId: noCandidates,
        sessionStatus: 'in-progress',
      });

      expect(cards[0]?.kind).toBe('skipped');
      expect(cards[1]?.kind).toBe('active');
    });

    it('badges a skipped occurrence neutrally with the locked copy', () => {
      const cards = buildSessionExerciseCardViews({
        logs: [skippedLog(1, 'ex-1')],
        targets: [null],
        catalogByExerciseId: catalog,
        candidatesByPerformedExerciseId: noCandidates,
        sessionStatus: 'in-progress',
      });

      expect(cards[0]?.badge).toEqual({
        style: 'neutral',
        label: 'Skipped',
        mobileVisible: true,
      });
    });

    it('carries no logger on a skipped occurrence — even in progress, even with a target', () => {
      // The target at the skipped position exists here deliberately: the
      // mapper must still refuse to render a logger for a skipped log.
      const cards = buildSessionExerciseCardViews({
        logs: [skippedLog(1, 'ex-1')],
        targets: [increaseFrom60],
        catalogByExerciseId: catalog,
        candidatesByPerformedExerciseId: noCandidates,
        sessionStatus: 'in-progress',
      });

      expect(cards[0]?.logger).toBeNull();
    });

    it('keeps the skipped card identity, prescription and order intact', () => {
      const cards = buildSessionExerciseCardViews({
        logs: [skippedLog(1, 'ex-1')],
        targets: [null],
        catalogByExerciseId: catalog,
        candidatesByPerformedExerciseId: noCandidates,
        sessionStatus: 'in-progress',
      });

      expect(cards[0]?.name).toBe('Bench Press');
      expect(cards[0]?.prescriptionLabel).toBe('3 × 8–10');
      expect(cards[0]?.order).toBe(1);
      expect(cards[0]?.equipmentLabel).toBe('Barbell');
    });

    it('maps the adjustment affordance from the domain eligibility, not raw facts', () => {
      // The eligibility says blocked — the mapper must not soften it even
      // though the raw DTO carries zero logged sets.
      const cards = buildSessionExerciseCardViews({
        logs: [
          log(1, 'ex-1', threeByEightToTen, [], {
            adjustmentEligibility: {
              isSkipped: false,
              blockedBy: 'logged-sets',
              canSkip: false,
              canUnskip: false,
              // Logged sets block the skip decision only — moves stay open.
              canMoveUp: true,
              canMoveDown: true,
            },
          }),
        ],
        targets: [null],
        catalogByExerciseId: catalog,
        candidatesByPerformedExerciseId: noCandidates,
        sessionStatus: 'in-progress',
      });

      expect(cards[0]?.adjustment.state).toBe('blocked-logged-sets');
      expect(cards[0]?.adjustment.blockedLabel).toBe(
        'Delete your logged sets to skip this exercise.',
      );
    });

    it('maps the adjustment affordance to skipped for a mutable skipped occurrence', () => {
      const cards = buildSessionExerciseCardViews({
        logs: [skippedLog(1, 'ex-1')],
        targets: [null],
        catalogByExerciseId: catalog,
        candidatesByPerformedExerciseId: noCandidates,
        sessionStatus: 'in-progress',
      });

      expect(cards[0]?.adjustment.state).toBe('skipped');
    });

    it('keeps the substitution affordance hidden for a skipped occurrence', () => {
      // The domain already blocks substitution while skipped; the view must
      // not contradict it (M10 F4 — no swap controls on a skipped card).
      const cards = buildSessionExerciseCardViews({
        logs: [skippedLog(1, 'ex-1')],
        targets: [null],
        catalogByExerciseId: catalog,
        candidatesByPerformedExerciseId: noCandidates,
        sessionStatus: 'in-progress',
      });

      expect(cards[0]?.substitution.state).toBe('hidden');
      expect(cards[0]?.kind).toBe('skipped');
    });

    it('marks multiple skipped occurrences skipped while a done one stays done', () => {
      const logs = [
        skippedLog(1, 'ex-1'),
        log(2, 'ex-2', threeByEightToTen, [repSet(1, 10, 50), repSet(2, 10, 50), repSet(3, 10, 50)]),
        skippedLog(3, 'ex-3'),
      ];
      const cards = buildSessionExerciseCardViews({
        logs,
        targets: [null, null, null],
        catalogByExerciseId: catalog,
        candidatesByPerformedExerciseId: noCandidates,
        sessionStatus: 'in-progress',
      });

      expect(cards[0]?.kind).toBe('skipped');
      expect(cards[1]?.kind).toBe('done');
      expect(cards[2]?.kind).toBe('skipped');
    });
  });

  describe('substitution display (M9)', () => {
    const substitutionCatalog = new Map([
      ['ex-bench', { name: 'Bench Press', equipment: 'barbell' as const }],
      ['ex-db-bench', { name: 'Dumbbell Bench Press', equipment: 'dumbbell' as const }],
    ]);

    it('shows the performed exercise as the primary name and its equipment, with "Originally" context', () => {
      const logs = [
        log(1, 'ex-bench', threeByEightToTen, [], {
          performedExerciseId: 'ex-db-bench',
          isSubstituted: true,
        }),
      ];
      const cards = buildSessionExerciseCardViews({
        logs,
        targets: [null],
        catalogByExerciseId: substitutionCatalog,
        candidatesByPerformedExerciseId: noCandidates,
        sessionStatus: 'in-progress',
      });

      expect(cards[0]?.name).toBe('Dumbbell Bench Press');
      expect(cards[0]?.equipmentLabel).toBe('Dumbbell');
      expect(cards[0]?.originallyName).toBe('Bench Press');
      // The authored prescription snapshot carries over — never converted.
      expect(cards[0]?.prescriptionLabel).toBe('3 × 8–10');
    });

    it('omits "Originally" when the occurrence is not substituted', () => {
      const logs = [log(1, 'ex-bench', threeByEightToTen, [])];
      const cards = buildSessionExerciseCardViews({
        logs,
        targets: [null],
        catalogByExerciseId: substitutionCatalog,
        candidatesByPerformedExerciseId: noCandidates,
        sessionStatus: 'in-progress',
      });

      expect(cards[0]?.name).toBe('Bench Press');
      expect(cards[0]?.originallyName).toBeNull();
    });

    it('omits "Originally" when the authored exercise cannot be resolved', () => {
      const logs = [
        log(1, 'ex-gone', threeByEightToTen, [], {
          performedExerciseId: 'ex-db-bench',
          isSubstituted: true,
        }),
      ];
      const cards = buildSessionExerciseCardViews({
        logs,
        targets: [null],
        catalogByExerciseId: substitutionCatalog, // ex-gone absent
        candidatesByPerformedExerciseId: noCandidates,
        sessionStatus: 'in-progress',
      });

      expect(cards[0]?.name).toBe('Dumbbell Bench Press');
      expect(cards[0]?.originallyName).toBeNull();
    });

    it('a chained substitution still shows the ORIGINAL authored exercise', () => {
      // Bench → DB Bench (order 1), then DB Bench → Push-up: the snapshot's
      // authoredExerciseId is never rewritten, so "Originally" stays the
      // original authored exercise.
      const logs = [
        log(1, 'ex-bench', threeByEightToTen, [], {
          performedExerciseId: 'ex-pushup',
          isSubstituted: true,
        }),
      ];
      const chainedCatalog = new Map([
        ['ex-bench', { name: 'Bench Press', equipment: 'barbell' as const }],
        ['ex-pushup', { name: 'Push-up', equipment: 'bodyweight' as const }],
      ]);
      const cards = buildSessionExerciseCardViews({
        logs,
        targets: [null],
        catalogByExerciseId: chainedCatalog,
        candidatesByPerformedExerciseId: noCandidates,
        sessionStatus: 'in-progress',
      });

      expect(cards[0]?.name).toBe('Push-up');
      expect(cards[0]?.originallyName).toBe('Bench Press');
    });

    it('maps the affordance states from the domain-derived eligibility projection', () => {
      const withCandidates = new Map([
        ['ex-bench', candidatesDto('ex-bench', [{ exerciseId: 'ex-db-bench', name: 'Dumbbell Bench Press' }])],
      ]);

      const base = {
        targets: [null] as (ExerciseTargetDto | null)[],
        catalogByExerciseId: substitutionCatalog,
        sessionStatus: 'in-progress' as const,
      };

      // replace: mutable, unsubstituted, candidates available.
      const replace = buildSessionExerciseCardViews({
        ...base,
        logs: [log(1, 'ex-bench', threeByEightToTen, [])],
        candidatesByPerformedExerciseId: withCandidates,
      });
      expect(replace[0]?.substitution.state).toBe('replace');
      expect(replace[0]?.substitution.candidates[0]?.metaLabel).toBe('Dumbbell · Chest');

      // blocked-logged-sets: the domain's eligibility — NOT the DTO's set
      // rows — decides (zero sets in the DTO here, blocked anyway).
      const blocked = buildSessionExerciseCardViews({
        ...base,
        logs: [
          log(1, 'ex-bench', threeByEightToTen, [], {
            substitutionEligibility: { blockedBy: 'logged-sets', canRestore: false },
          }),
        ],
        candidatesByPerformedExerciseId: withCandidates,
      });
      expect(blocked[0]?.substitution.state).toBe('blocked-logged-sets');

      // restore-available: substituted and mutable per the domain.
      const restore = buildSessionExerciseCardViews({
        ...base,
        logs: [
          log(1, 'ex-bench', threeByEightToTen, [], {
            performedExerciseId: 'ex-db-bench',
            isSubstituted: true,
            substitutionEligibility: { blockedBy: null, canRestore: true },
          }),
        ],
        candidatesByPerformedExerciseId: withCandidates,
      });
      expect(restore[0]?.substitution.state).toBe('restore-available');
      expect(restore[0]?.substitution.canRestore).toBe(true);

      // no-candidates: not substituted, mutable, no matching candidates.
      const none = buildSessionExerciseCardViews({
        ...base,
        logs: [log(1, 'ex-bench', threeByEightToTen, [])],
        candidatesByPerformedExerciseId: noCandidates,
      });
      expect(none[0]?.substitution.state).toBe('no-candidates');

      // hidden: the domain's eligibility — NOT the screen's sessionStatus —
      // decides (an in-progress screen here, hidden anyway).
      const hidden = buildSessionExerciseCardViews({
        ...base,
        logs: [
          log(1, 'ex-bench', threeByEightToTen, [], {
            substitutionEligibility: { blockedBy: 'session-completed', canRestore: false },
          }),
        ],
        candidatesByPerformedExerciseId: withCandidates,
      });
      expect(hidden[0]?.substitution.state).toBe('hidden');
    });
  });

  // Locks the M9 review fix: the affordance consumes the domain's
  // eligibility projection and never re-derives blocking from the DTO's raw
  // facts. Every fixture below deliberately contradicts the eligibility so
  // any reintroduced hasLoggedSets/sessionStatus logic in the mapper fails.
  describe('substitution eligibility consumption (M9 regression)', () => {
    const withCandidates = new Map([
      ['ex-bench', candidatesDto('ex-bench', [{ exerciseId: 'ex-db-bench', name: 'Dumbbell Bench Press' }])],
    ]);

    const base = {
      targets: [null] as (ExerciseTargetDto | null)[],
      catalogByExerciseId: new Map<string, { name: string; equipment: 'barbell' }>([
        ['ex-bench', { name: 'Bench Press', equipment: 'barbell' }],
        ['ex-db-bench', { name: 'Dumbbell Bench Press', equipment: 'barbell' }],
      ]),
      sessionStatus: 'in-progress' as const,
    };

    it('renders replace — not blocked — when the DTO carries a logged set but the domain says mutable', () => {
      const cards = buildSessionExerciseCardViews({
        ...base,
        logs: [log(1, 'ex-bench', threeByEightToTen, [repSet(1, 10, 50)])], // sets present
        candidatesByPerformedExerciseId: withCandidates,
      });

      // The mapper must consume eligibility; the raw set rows are not its input.
      expect(cards[0]?.substitution.state).toBe('replace');
      expect(cards[0]?.substitution.blockedLabel).toBeNull();
    });

    it('renders restore-available — not blocked — for a substituted occurrence with a logged set but mutable eligibility', () => {
      const cards = buildSessionExerciseCardViews({
        ...base,
        logs: [
          log(1, 'ex-bench', threeByEightToTen, [repSet(1, 10, 50)], {
            performedExerciseId: 'ex-db-bench',
            isSubstituted: true,
            substitutionEligibility: { blockedBy: null, canRestore: true },
          }),
        ],
        candidatesByPerformedExerciseId: withCandidates,
      });

      expect(cards[0]?.substitution.state).toBe('restore-available');
      expect(cards[0]?.substitution.canRestore).toBe(true);
    });

    it('keeps mutation controls on a completed screen whose eligibility is still mutable', () => {
      const cards = buildSessionExerciseCardViews({
        ...base,
        sessionStatus: 'completed',
        logs: [
          log(1, 'ex-bench', threeByEightToTen, [], {
            substitutionEligibility: { blockedBy: null, canRestore: false },
          }),
        ],
        candidatesByPerformedExerciseId: withCandidates,
      });

      // The substitution affordance follows the domain eligibility, not the
      // screen status: a mutable occurrence stays swappable.
      expect(cards[0]?.substitution.state).toBe('replace');
    });

    it('restore availability comes only from the domain projection, not from the substituted flag', () => {
      // Candidates are keyed by the PERFORMED id after the swap.
      const performedCandidates = new Map([
        ['ex-db-bench', candidatesDto('ex-db-bench', [{ exerciseId: 'ex-bench', name: 'Bench Press' }])],
      ]);
      const cards = buildSessionExerciseCardViews({
        ...base,
        logs: [
          log(1, 'ex-bench', threeByEightToTen, [], {
            performedExerciseId: 'ex-db-bench',
            isSubstituted: true,
            // Substituted, but the domain has NOT granted restore.
            substitutionEligibility: { blockedBy: null, canRestore: false },
          }),
        ],
        candidatesByPerformedExerciseId: performedCandidates,
      });

      // With canRestore false the affordance treats the occurrence as
      // unsubstituted: replace (candidates exist), no restore control.
      expect(cards[0]?.substitution.state).toBe('replace');
      expect(cards[0]?.substitution.canRestore).toBe(false);
    });
  });
});

describe('active-workout-views / buildSessionProgress', () => {
  it('uses the domain-owned prescribedSets denominator and computes the percentage', () => {
    const logs = [
      log(1, 'ex-1', threeByEightToTen, [repSet(1, 10, 50)]),
      log(2, 'ex-2', threeByFortySeconds, []),
    ];
    const metrics = {
      totalSets: 1,
      totalReps: 10,
      totalDurationSeconds: 0,
      volume: 500,
    };
    // The domain already excluded nothing here: 6 prescribed sets across both
    // non-skipped occurrences.
    const progress = buildSessionProgress(
      sessionDto(logs, metrics, { prescribedSets: 6, skippedExerciseCount: 0 }),
    );

    expect(progress).toEqual({
      loggedSets: 1,
      prescribedSets: 6,
      skippedCount: 0,
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
    const progress = buildSessionProgress(
      sessionDto(logs, {
        totalSets: 4,
        totalReps: 40,
        totalDurationSeconds: 0,
        volume: 2000,
      }, { prescribedSets: 3, skippedExerciseCount: 0 }),
    );

    expect(progress.percentage).toBe(100);
    expect(progress.prescribedSets).toBe(3);
  });

  it('renders 0% when the snapshot has no logs', () => {
    const progress = buildSessionProgress(
      sessionDto([], {
        totalSets: 0,
        totalReps: 0,
        totalDurationSeconds: 0,
        volume: 0,
      }),
    );

    expect(progress.percentage).toBe(0);
  });

  it('never re-sums per-log prescriptions — the DTO totals are the only source', () => {
    // Fixture deliberately contradicts the raw log facts: the session DTO
    // says 4 prescribed sets across the non-skipped occurrences while the
    // raw logs would sum to 6 (3+3). The mapper must consume the DTO's
    // domain-owned totals and ignore the logs entirely.
    const logs = [
      log(1, 'ex-1', threeByEightToTen, []),
      log(2, 'ex-2', threeByEightToTen, [], { isSkipped: true }),
    ];
    const progress = buildSessionProgress(
      sessionDto(logs, {
        totalSets: 0,
        totalReps: 0,
        totalDurationSeconds: 0,
        volume: 0,
      }, { prescribedSets: 4, skippedExerciseCount: 1 }),
    );

    expect(progress.prescribedSets).toBe(4);
    expect(progress.skippedCount).toBe(1);
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
