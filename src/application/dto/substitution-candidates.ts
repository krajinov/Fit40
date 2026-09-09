/**
 * Data transfer objects for exercise substitution candidates.
 *
 * Presentation-neutral projection of the domain selector's output: the
 * branded ExerciseId is stripped to a plain string, and each candidate
 * carries the catalog facts the substitution UI needs — equipment included
 * so the UI can show it (candidate ranking never used it).
 *
 * `toExerciseSubstitutionCandidatesDto` is the pure Application mapper around
 * the domain selector. It is intentionally repository-free so a composition
 * that needs candidate lists for MANY source exercises (the M9 Active
 * Workout) can load the exercise catalog ONCE and reuse that same catalog
 * for every distinct source; the standalone use case performs its own single
 * catalog read and delegates to this same mapper.
 */

import type { Exercise } from '@/domain/entities/exercise';
import {
  selectSubstitutionCandidateSet,
  type SubstitutionCandidate,
  type SubstitutionMatchTier,
} from '@/domain/services/substitution-candidates';
import type {
  Difficulty,
  EquipmentType,
  MovementPattern,
  MuscleGroup,
} from '@/domain/types/exercise';

/** One substitute suggestion for a source exercise. */
export interface SubstitutionCandidateDto {
  readonly exerciseId: string;
  readonly name: string;
  readonly slug: string;
  readonly equipment: EquipmentType;
  readonly primaryMuscle: MuscleGroup;
  readonly movementPattern: MovementPattern;
  readonly difficulty: Difficulty;
  readonly matchTier: SubstitutionMatchTier;
}

/** The candidate list for one source exercise, with truthful limit metadata. */
export interface ExerciseSubstitutionCandidatesDto {
  readonly sourceExerciseId: string;
  readonly candidates: ReadonlyArray<SubstitutionCandidateDto>;
  /**
   * True only when additional matching candidates existed but were truncated
   * by the candidate limit. An exactly-at-limit result is NOT limited.
   */
  readonly isLimited: boolean;
}

function toSubstitutionCandidateDto(
  candidate: SubstitutionCandidate,
): SubstitutionCandidateDto {
  const { exercise, tier } = candidate;
  return {
    exerciseId: exercise.id,
    name: exercise.name,
    slug: exercise.slug,
    equipment: exercise.equipment,
    primaryMuscle: exercise.primaryMuscle,
    movementPattern: exercise.movementPattern,
    difficulty: exercise.difficulty,
    matchTier: tier,
  };
}

/**
 * Maps the substitution candidates of one source exercise from a catalog the
 * CALLER already holds. Pure: no repository access — the domain selector
 * handles tier fallback, ranking, deduplication, and the limit.
 */
export function toExerciseSubstitutionCandidatesDto(
  source: Exercise,
  catalog: ReadonlyArray<Exercise>,
): ExerciseSubstitutionCandidatesDto {
  const set = selectSubstitutionCandidateSet(source, catalog);
  return {
    sourceExerciseId: source.id,
    candidates: set.candidates.map(toSubstitutionCandidateDto),
    isLimited: set.isTruncated,
  };
}
