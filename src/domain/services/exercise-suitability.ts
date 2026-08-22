/**
 * Pure domain service for evaluating an exercise against physical considerations.
 *
 * This is intentionally small. It provides training suitability guidance and is
 * not a medical recommendation system.
 */

import type { Exercise } from '@/domain/entities/exercise';
import {
  SuitabilityLevel,
  type PhysicalConsideration,
} from '@/domain/types/exercise';

const SUITABILITY_RANK: Record<SuitabilityLevel, number> = {
  [SuitabilityLevel.Suitable]: 0,
  [SuitabilityLevel.Caution]: 1,
  [SuitabilityLevel.Unsuitable]: 2,
};

/**
 * Returns the stored guidance for a consideration, defaulting to suitable.
 */
export function getSuitabilityLevel(
  exercise: Exercise,
  consideration: PhysicalConsideration,
): SuitabilityLevel {
  const guidance = exercise.considerations.find((c) => c.consideration === consideration);
  return guidance?.level ?? SuitabilityLevel.Suitable;
}

/**
 * Result of evaluating an exercise against a set of considerations.
 */
export interface SuitabilityAssessment {
  readonly overall: SuitabilityLevel;
  readonly details: ReadonlyArray<{
    readonly consideration: PhysicalConsideration;
    readonly level: SuitabilityLevel;
  }>;
}

function rankOf(level: SuitabilityLevel): number {
  return SUITABILITY_RANK[level];
}

/**
 * Evaluates an exercise against the requested physical considerations.
 *
 * The overall result is the most restrictive (highest ranked) level among the
 * requested considerations. Absent guidance is treated as suitable.
 * If no considerations are requested, the overall result is suitable.
 */
export function evaluateExerciseSuitability(
  exercise: Exercise,
  considerations: ReadonlyArray<PhysicalConsideration>,
): SuitabilityAssessment {
  const details = considerations.map((consideration) => ({
    consideration,
    level: getSuitabilityLevel(exercise, consideration),
  }));

  const overall = details.reduce<SuitabilityLevel>(
    (worst, detail) => (rankOf(detail.level) > rankOf(worst) ? detail.level : worst),
    SuitabilityLevel.Suitable,
  );

  return { overall, details };
}