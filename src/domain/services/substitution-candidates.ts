/**
 * Domain service: deterministic substitution candidate selection.
 *
 * Ranks catalog exercises as possible substitutes for one source exercise by
 * STRUCTURAL similarity only — movement pattern, muscle targeting, and
 * difficulty. The selector deliberately does not:
 *
 * - filter by the user's available equipment (the profile is not an input),
 * - rank same-equipment candidates first,
 * - read physical-consideration suitability guidance,
 * - make injury/safety claims, invoke AI, or infer prescription compatibility.
 *
 * Equipment stays untouched on the candidate the caller already holds;
 * presentation may surface it, ranking never uses it.
 *
 * Selection is tier-based with NO tier merging. Tiers fall back in order and
 * the first tier with at least one candidate WINS exclusively:
 *
 * 1. `same-pattern-same-muscle` — same movementPattern AND same primaryMuscle
 * 2. `same-pattern`            — same movementPattern only
 * 3. `same-muscle`             — same primaryMuscle only
 *
 * A source with no structural match yields an EMPTY candidate list — a valid,
 * expected outcome; the selector never falls back to unrelated exercises.
 *
 * Within the selected tier, candidates are ordered deterministically and
 * independently of catalog input order:
 *
 * 1. greater secondary-muscle overlap with the source first (descending),
 * 2. same difficulty as the source first,
 * 3. exercise name ascending,
 * 4. exercise id ascending — the final total-order tie-breaker.
 *
 * The catalog input is never mutated, and duplicate ExerciseIds in the input
 * defensively collapse to their first occurrence. The candidate limit applies
 * only AFTER filtering, deduplication, and ranking.
 */

import type { Exercise } from '@/domain/entities/exercise';
import type { ExerciseId } from '@/domain/types/ids';

/** Maximum number of candidates returned unless the caller passes an explicit limit. */
export const SUBSTITUTION_CANDIDATE_LIMIT = 8;

/** Why a candidate matched its source: the tier it was selected in. */
export type SubstitutionMatchTier =
  | 'same-pattern-same-muscle'
  | 'same-pattern'
  | 'same-muscle';

/** One ranked substitute: the catalog exercise plus the tier it matched in. */
export interface SubstitutionCandidate {
  readonly exercise: Exercise;
  readonly tier: SubstitutionMatchTier;
}

/**
 * Result of one selection: the limited, ranked candidate list plus truthful
 * truncation metadata.
 *
 * `isTruncated` is true only when additional matching candidates existed in
 * the selected tier but were dropped by the limit. An exactly-at-limit
 * result is NOT truncated — which is why truncation is derived from the
 * full ranked pool, never inferred from `candidates.length`.
 */
export interface SubstitutionCandidateSet {
  readonly candidates: ReadonlyArray<SubstitutionCandidate>;
  readonly isTruncated: boolean;
}

// ─── Tier matching ──────────────────────────────────────────────────────────

function sameMovementPattern(source: Exercise, candidate: Exercise): boolean {
  return candidate.movementPattern === source.movementPattern;
}

function samePrimaryMuscle(source: Exercise, candidate: Exercise): boolean {
  return candidate.primaryMuscle === source.primaryMuscle;
}

interface SelectedTier {
  readonly tier: SubstitutionMatchTier;
  readonly matches: ReadonlyArray<Exercise>;
}

/**
 * The first tier — in fallback order — that has at least one candidate, with
 * its matches. Later tiers are only considered when every earlier tier is
 * empty; tiers are never merged.
 */
function selectTier(source: Exercise, pool: ReadonlyArray<Exercise>): SelectedTier | null {
  const tiers: ReadonlyArray<
    readonly [SubstitutionMatchTier, (candidate: Exercise) => boolean]
  > = [
    [
      'same-pattern-same-muscle',
      (candidate) =>
        sameMovementPattern(source, candidate) && samePrimaryMuscle(source, candidate),
    ],
    ['same-pattern', (candidate) => sameMovementPattern(source, candidate)],
    ['same-muscle', (candidate) => samePrimaryMuscle(source, candidate)],
  ];

  for (const [tier, matches] of tiers) {
    const tierMatches = pool.filter(matches);
    if (tierMatches.length > 0) {
      return { tier, matches: tierMatches };
    }
  }

  return null;
}

// ─── Ranking ────────────────────────────────────────────────────────────────

/**
 * Number of the candidate's secondary muscles that also target the source.
 * A source with no secondary muscles overlaps nothing — every candidate
 * scores 0, which correctly degrades to the next ranking keys.
 */
function secondaryMuscleOverlapCount(source: Exercise, candidate: Exercise): number {
  if (source.secondaryMuscles.length === 0) return 0;

  const sourceSecondaries = new Set(source.secondaryMuscles);
  let overlap = 0;
  for (const muscle of candidate.secondaryMuscles) {
    if (sourceSecondaries.has(muscle)) {
      overlap += 1;
    }
  }
  return overlap;
}

/**
 * Deterministic ordering within one tier:
 * 1. greater secondary-muscle overlap with the source first (descending),
 * 2. same difficulty as the source first,
 * 3. name ascending — a plain code-unit comparison, so the order is
 *    locale-independent and identical everywhere,
 * 4. exercise id ascending — the final total-order tie-breaker, so distinct
 *    candidates with equal rank keys (e.g. the same display name) never
 *    depend on the repository's input order.
 */
function compareByRank(source: Exercise, a: Exercise, b: Exercise): number {
  const overlapDiff =
    secondaryMuscleOverlapCount(source, b) - secondaryMuscleOverlapCount(source, a);
  if (overlapDiff !== 0) return overlapDiff;

  const aSameDifficulty = a.difficulty === source.difficulty;
  const bSameDifficulty = b.difficulty === source.difficulty;
  if (aSameDifficulty !== bSameDifficulty) return aSameDifficulty ? -1 : 1;

  if (a.name !== b.name) return a.name < b.name ? -1 : 1;

  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

// ─── Deduplication ──────────────────────────────────────────────────────────

/**
 * Collapses duplicate ExerciseIds defensively: the FIRST occurrence wins, so
 * a duplicated catalog entry never widens or reorders a selection. Real
 * repositories already guarantee uniqueness; this guards the pure function
 * against any caller-supplied catalog.
 */
function dedupeByExerciseId(catalog: ReadonlyArray<Exercise>): Exercise[] {
  const seen = new Set<ExerciseId>();
  const unique: Exercise[] = [];
  for (const exercise of catalog) {
    if (seen.has(exercise.id)) continue;
    seen.add(exercise.id);
    unique.push(exercise);
  }
  return unique;
}

// ─── Selection ──────────────────────────────────────────────────────────────

/**
 * Full deterministic selection for one source exercise: the ranked, possibly
 * truncated candidate list of the winning tier, plus truthful truncation
 * metadata.
 *
 * `isTruncated` is true only when the winning tier held MORE matching
 * candidates than the limit kept. It is derived from the full ranked pool —
 * never from `candidates.length` — so an exactly-at-limit result is reported
 * as not truncated.
 *
 * A `limit` of zero or less yields an empty candidate list; with a non-empty
 * pool that is still a truncation, so `isTruncated` stays truthful.
 */
export function selectSubstitutionCandidateSet(
  source: Exercise,
  catalog: ReadonlyArray<Exercise>,
  limit: number = SUBSTITUTION_CANDIDATE_LIMIT,
): SubstitutionCandidateSet {
  // Exclude the source itself, then defensively deduplicate the remaining
  // pool before any tier or ranking decision is made.
  const pool = dedupeByExerciseId(
    catalog.filter((candidate) => candidate.id !== source.id),
  );

  const selected = selectTier(source, pool);
  if (selected === null) {
    return { candidates: [], isTruncated: false };
  }

  const ranked = [...selected.matches].sort((a, b) => compareByRank(source, a, b));
  const effectiveLimit = limit <= 0 ? 0 : limit;

  return {
    candidates: ranked
      .slice(0, effectiveLimit)
      .map((exercise) => ({ exercise, tier: selected.tier })),
    isTruncated: ranked.length > effectiveLimit,
  };
}

/**
 * Convenience projection: just the candidate list of
 * `selectSubstitutionCandidateSet`. Callers that need truthful truncation
 * metadata must call the set variant instead.
 */
export function selectSubstitutionCandidates(
  source: Exercise,
  catalog: ReadonlyArray<Exercise>,
  limit: number = SUBSTITUTION_CANDIDATE_LIMIT,
): ReadonlyArray<SubstitutionCandidate> {
  return selectSubstitutionCandidateSet(source, catalog, limit).candidates;
}
