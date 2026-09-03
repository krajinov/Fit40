import { describe, expect, it } from 'vitest';

import {
  DIFFICULTY_VALUES,
  EQUIPMENT_VALUES,
  MOVEMENT_PATTERN_VALUES,
  MUSCLE_GROUP_VALUES,
  PHYSICAL_CONSIDERATION_VALUES,
  SUITABILITY_LEVEL_VALUES,
} from '@/domain/types/exercise';
import {
  DIFFICULTY_LABELS,
  EQUIPMENT_LABELS,
  MOVEMENT_PATTERN_LABELS,
  MUSCLE_GROUP_LABELS,
  PHYSICAL_CONSIDERATION_LABELS,
  SUITABILITY_LABELS,
} from '@/features/exercises/exercise-labels';

/**
 * Every domain value must have a presentation label, so no enum value can
 * reach the UI unlabelled. Adding a new domain value without a label fails
 * this test.
 */
describe('exercise labels', () => {
  function expectLabelsFor<T extends string>(
    values: ReadonlyArray<T>,
    labels: Record<T, string>,
  ): void {
    for (const value of values) {
      expect(labels[value], `missing label for "${value}"`).toBeDefined();
      expect(labels[value].length).toBeGreaterThan(0);
    }
  }

  it('labels every equipment type', () => {
    expectLabelsFor(EQUIPMENT_VALUES, EQUIPMENT_LABELS);
  });

  it('labels every difficulty level', () => {
    expectLabelsFor(DIFFICULTY_VALUES, DIFFICULTY_LABELS);
  });

  it('labels every movement pattern', () => {
    expectLabelsFor(MOVEMENT_PATTERN_VALUES, MOVEMENT_PATTERN_LABELS);
  });

  it('labels every muscle group', () => {
    expectLabelsFor(MUSCLE_GROUP_VALUES, MUSCLE_GROUP_LABELS);
  });

  it('labels every physical consideration', () => {
    expectLabelsFor(PHYSICAL_CONSIDERATION_VALUES, PHYSICAL_CONSIDERATION_LABELS);
  });

  it('labels every suitability level distinctly', () => {
    expectLabelsFor(SUITABILITY_LEVEL_VALUES, SUITABILITY_LABELS);

    expect(SUITABILITY_LABELS.suitable).toBe('Suitable');
    expect(SUITABILITY_LABELS.caution).toBe('Use caution');
    expect(SUITABILITY_LABELS.unsuitable).toBe('May be unsuitable');
  });
});