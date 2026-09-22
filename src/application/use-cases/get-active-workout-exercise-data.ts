/**
 * Use case: load the exercise data ONE Active Workout request needs, from
 * exactly ONE exercise catalog read (M9 Slice 5).
 *
 * Candidate matches can live anywhere in the catalog, and the session
 * snapshot's performed/authored ids may reference exercises that are no
 * longer part of the scheduled workout's template. So the full catalog is
 * read once, and everything else is derived from that single in-memory
 * catalog:
 *
 * - display summaries (name, equipment) for the requested performed and
 *   authored exercise ids (unknown ids are omitted — the view degrades to
 *   truthful fallbacks), and
 * - the substitution candidates for every DISTINCT performed exercise, via
 *   the pure `toExerciseSubstitutionCandidatesDto` mapper over the same
 *   catalog — never one repository read per source exercise.
 *
 * This is the Application read/composition helper the Active Workout view
 * assembly calls ONCE per request (see `active-workout-view.ts`); the
 * standalone per-source lookup remains
 * `GetExerciseSubstitutionCandidatesUseCase`. No expected failure path
 * exists for this read: infrastructure errors propagate to the error
 * boundary, and unresolved exercises degrade in presentation.
 */

import {
  toExerciseSubstitutionCandidatesDto,
  type ExerciseSubstitutionCandidatesDto,
} from '@/application/dto/substitution-candidates';
import {
  toExerciseSummaryDto,
  type ExerciseSummaryDto,
} from '@/application/dto/exercise';
import type { ExerciseRepository } from '@/application/ports/exercise-repository';

/** All exercise data one Active Workout request needs, from one catalog read. */
export interface ActiveWorkoutExerciseData {
  /** Display summaries keyed by exercise id; unknown ids are absent. */
  readonly summariesByExerciseId: ReadonlyMap<string, ExerciseSummaryDto>;
  /**
   * Substitution candidates keyed by the DISTINCT performed exercise ids
   * the caller requested; an id absent from the catalog is absent here too.
   */
  readonly candidatesByPerformedExerciseId: ReadonlyMap<string, ExerciseSubstitutionCandidatesDto>;
  /**
   * The FULL catalog, in the repository's own list order (M11): the exercises
   * the user may explicitly add to the session. Exercises already present in
   * the session are deliberately NOT filtered out — duplicates are valid
   * occurrences — and the list adds no ordering or scoring of its own.
   */
  readonly addableExercises: ReadonlyArray<ExerciseSummaryDto>;
}

export interface GetActiveWorkoutExerciseDataInput {
  /**
   * Every exercise id the screen may DISPLAY — performed AND authored ids of
   * the session's occurrences. Duplicates are fine; unknown ids are simply
   * absent from the summaries map.
   */
  readonly displayExerciseIds: ReadonlyArray<string>;
  /**
   * The DISTINCT performed exercise ids to build substitution candidates
   * for. Each resolves as its own source from the same single catalog read.
   */
  readonly performedExerciseIds: ReadonlyArray<string>;
}

export class GetActiveWorkoutExerciseDataUseCase {
  constructor(private readonly exerciseRepository: ExerciseRepository) {}

  async execute(
    input: GetActiveWorkoutExerciseDataInput,
  ): Promise<ActiveWorkoutExerciseData> {
    // ONE catalog read for the whole request: display metadata resolution
    // AND candidate selection for every distinct source both derive from it.
    const catalog = await this.exerciseRepository.list();

    const displayIds = new Set<string>(input.displayExerciseIds);
    const summariesByExerciseId = new Map<string, ExerciseSummaryDto>();
    for (const exercise of catalog) {
      if (displayIds.has(exercise.id)) {
        summariesByExerciseId.set(exercise.id, toExerciseSummaryDto(exercise));
      }
    }

    // Candidates are computed once per DISTINCT performed exercise from the
    // same preloaded catalog — no per-source repository reads. An id absent
    // from the catalog has no candidates (the view degrades honestly).
    const candidatesByPerformedExerciseId = new Map<
      string,
      ExerciseSubstitutionCandidatesDto
    >();
    const seen = new Set<string>();
    for (const rawId of input.performedExerciseIds) {
      if (seen.has(rawId)) {
        continue;
      }
      seen.add(rawId);
      const source = catalog.find((exercise) => exercise.id === rawId);
      if (source === undefined) {
        continue;
      }
      candidatesByPerformedExerciseId.set(
        rawId,
        toExerciseSubstitutionCandidatesDto(source, catalog),
      );
    }

    // The FULL catalog for the M11 "Add exercise" picker, projected from the
    // SAME single `list()` read — no second catalog query, no filtering of
    // already-present exercises (duplicates are valid occurrences), and the
    // repository's own order preserved.
    const addableExercises = catalog.map(toExerciseSummaryDto);

    return { summariesByExerciseId, candidatesByPerformedExerciseId, addableExercises };
  }
}
