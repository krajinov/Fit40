import { describe, expect, it } from 'vitest';

import type { ExerciseTargetDto } from '@/application/dto/exercise';
import type { NextExerciseTarget } from '@/domain/services/exercise-progression';
import {
  formatKg,
  mapExerciseTargetsToViews,
  mapExerciseTargetToView,
} from '@/features/sessions/workout-target-views';
import type { RepPrescription } from '@/domain/value-objects/rep-prescription';

const threeByEightToTen: RepPrescription = { type: 'reps', sets: 3, minReps: 8, maxReps: 10 };
const threeByThirtySeconds: RepPrescription = { type: 'duration', sets: 3, seconds: 30 };

function targetDto(exerciseId: string, target: NextExerciseTarget): ExerciseTargetDto {
  return { exerciseId, target };
}

describe('formatKg', () => {
  it('trims float dust while keeping half-kilos', () => {
    expect(formatKg(52.5)).toBe('52.5 kg');
  });

  it('renders whole numbers without decimals', () => {
    expect(formatKg(50)).toBe('50 kg');
  });

  it('keeps zero a real external load', () => {
    expect(formatKg(0)).toBe('0 kg');
  });
});

describe('mapExerciseTargetToView', () => {
  it('increase → try-today view with recommended external load', () => {
    const view = mapExerciseTargetToView(
      targetDto('ex-1', {
        basis: 'increase',
        previousLoadKg: 50,
        nextLoadKg: 52.5,
        incrementKg: 2.5,
      }),
      threeByEightToTen,
    );

    expect(view.exerciseId).toBe('ex-1');
    expect(view.lastTimeLabel).toBe('Last time · 50 kg');
    expect(view.lastTimeCompactLabel).toBe('Last · 50 kg');
    expect(view.chip).toEqual({
      kind: 'increase',
      label: 'TRY TODAY',
      valueLabel: '52.5 kg',
      ariaLabel: 'Recommended today: increase to 52.5 kg (last time 50 kg)',
    });
  });

  it('hold → repeat view with the same target load', () => {
    const view = mapExerciseTargetToView(
      targetDto('ex-2', { basis: 'hold', previousLoadKg: 22.5, nextLoadKg: 22.5 }),
      threeByEightToTen,
    );

    expect(view.lastTimeLabel).toBe('Last time · 22.5 kg');
    expect(view.chip).toEqual({
      kind: 'hold',
      label: 'REPEAT',
      valueLabel: '22.5 kg',
      ariaLabel: 'Repeat 22.5 kg (same as last time)',
    });
  });

  it('regress → lower target with amber treatment', () => {
    const view = mapExerciseTargetToView(
      targetDto('ex-3', {
        basis: 'regress',
        previousLoadKg: 60,
        nextLoadKg: 57.5,
        incrementKg: 2.5,
      }),
      threeByEightToTen,
    );

    expect(view.lastTimeLabel).toBe('Last time · 60 kg');
    expect(view.chip).toEqual({
      kind: 'regress',
      label: 'TRY TODAY',
      valueLabel: '57.5 kg',
      ariaLabel: 'Recommended today: reduce to 57.5 kg (last time 60 kg)',
    });
  });

  it('regress with null load → no fake zero, "No added load" value', () => {
    const view = mapExerciseTargetToView(
      targetDto('ex-4', {
        basis: 'regress',
        previousLoadKg: 2,
        nextLoadKg: null,
        incrementKg: 2.5,
      }),
      threeByEightToTen,
    );

    expect(view.chip?.valueLabel).toBe('No added load');
    expect(view.chip?.valueLabel).not.toContain('0 kg');
  });

  it('first-exposure → no invented load, no chip', () => {
    const view = mapExerciseTargetToView(
      targetDto('ex-5', { basis: 'first-exposure' }),
      threeByEightToTen,
    );

    expect(view.lastTimeLabel).toBeNull();
    expect(view.chip).toBeNull();
  });

  it('scheme-change → no recommendation load, current scheme as value', () => {
    const view = mapExerciseTargetToView(
      targetDto('ex-6', { basis: 'scheme-change' }),
      threeByEightToTen,
    );

    expect(view.lastTimeLabel).toBeNull();
    expect(view.chip).toEqual({
      kind: 'scheme-change',
      label: 'NEW REP TARGET',
      valueLabel: '3 × 8–10',
      ariaLabel: expect.stringContaining('3 × 8–10'),
    });
  });

  it('scheme-change over a duration scheme formats seconds, not reps', () => {
    const view = mapExerciseTargetToView(
      targetDto('ex-7', { basis: 'scheme-change' }),
      threeByThirtySeconds,
    );

    expect(view.chip?.valueLabel).toBe('3 × 30s');
  });

  it('bodyweight → no recommendation card', () => {
    const view = mapExerciseTargetToView(
      targetDto('ex-8', { basis: 'bodyweight' }),
      threeByEightToTen,
    );

    expect(view.lastTimeLabel).toBeNull();
    expect(view.chip).toBeNull();
  });

  it('duration → no recommendation card', () => {
    const view = mapExerciseTargetToView(
      targetDto('ex-9', { basis: 'duration' }),
      threeByThirtySeconds,
    );

    expect(view.lastTimeLabel).toBeNull();
    expect(view.chip).toBeNull();
  });

  it('null dto (anonymous/failed personalization) → no history, no chip', () => {
    const view = mapExerciseTargetToView(null, threeByEightToTen);

    expect(view.lastTimeLabel).toBeNull();
    expect(view.chip).toBeNull();
    expect(view.exerciseId).toBe('');
  });

describe('mapExerciseTargetsToViews', () => {
  it('preserves request order across a mixed batch', () => {
    const dtos: ReadonlyArray<ExerciseTargetDto | null> = [
      targetDto('ex-1', {
        basis: 'increase',
        previousLoadKg: 50,
        nextLoadKg: 52.5,
        incrementKg: 2.5,
      }),
      null,
      targetDto('ex-3', { basis: 'hold', previousLoadKg: 20, nextLoadKg: 20 }),
      targetDto('ex-4', { basis: 'first-exposure' }),
      targetDto('ex-5', { basis: 'bodyweight' }),
      targetDto('ex-6', { basis: 'duration' }),
    ];
    const prescriptions: ReadonlyArray<RepPrescription> = [
      threeByEightToTen,
      threeByEightToTen,
      threeByEightToTen,
      threeByEightToTen,
      threeByEightToTen,
      threeByThirtySeconds,
    ];

    const views = mapExerciseTargetsToViews(dtos, prescriptions);

    expect(views.map((v) => v.exerciseId)).toEqual(['ex-1', '', 'ex-3', 'ex-4', 'ex-5', 'ex-6']);
    expect(views[0]?.chip?.kind).toBe('increase');
    expect(views[1]?.chip).toBeNull();
    expect(views[2]?.chip?.kind).toBe('hold');
    expect(views[3]?.chip).toBeNull();
    expect(views[4]?.chip).toBeNull();
    expect(views[5]?.chip).toBeNull();
  });
});

});
