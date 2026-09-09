/**
 * Tests for the substitution-candidates domain service: tier fallback
 * exclusivity, deterministic ranking, deduplication, limit semantics, and
 * truthful truncation metadata.
 */

import { describe, expect, it } from 'vitest';

import {
  createExercise,
  type CreateExerciseInput,
  type Exercise,
} from '@/domain/entities/exercise';
import {
  SUBSTITUTION_CANDIDATE_LIMIT,
  selectSubstitutionCandidateSet,
  selectSubstitutionCandidates,
  type SubstitutionCandidate,
} from '@/domain/services/substitution-candidates';
import {
  Difficulty,
  EquipmentType,
  MovementPattern,
  MuscleGroup,
} from '@/domain/types/exercise';

// ─── Fixtures ───────────────────────────────────────────────────────────────

function makeExercise(overrides: Partial<CreateExerciseInput> & { id: string }): Exercise {
  const result = createExercise({
    name: `Exercise ${overrides.id}`,
    slug: `exercise-${overrides.id}`,
    description: 'A catalog exercise.',
    primaryMuscle: MuscleGroup.Quadriceps,
    secondaryMuscles: [],
    equipment: EquipmentType.Bodyweight,
    difficulty: Difficulty.Beginner,
    movementPattern: MovementPattern.Squat,
    considerations: [],
    ...overrides,
  });
  if (!result.ok) throw new Error('fixture exercise failed validation');
  return result.data;
}

/** The source every selection runs against. */
const source = makeExercise({
  id: 'ex-source',
  name: 'Dumbbell Squat',
  slug: 'dumbbell-squat',
  primaryMuscle: MuscleGroup.Quadriceps,
  secondaryMuscles: [MuscleGroup.Glutes, MuscleGroup.Hamstrings],
  equipment: EquipmentType.Dumbbell,
  difficulty: Difficulty.Intermediate,
  movementPattern: MovementPattern.Squat,
});

/** Tier-1 match: same movement pattern AND same primary muscle. */
function tierOneMatch(id: string, overrides: Partial<CreateExerciseInput> = {}): Exercise {
  return makeExercise({
    id,
    primaryMuscle: MuscleGroup.Quadriceps,
    movementPattern: MovementPattern.Squat,
    ...overrides,
  });
}

/** Tier-2 match: same movement pattern, different primary muscle. */
function tierTwoMatch(id: string, overrides: Partial<CreateExerciseInput> = {}): Exercise {
  return makeExercise({
    id,
    primaryMuscle: MuscleGroup.Glutes,
    movementPattern: MovementPattern.Squat,
    ...overrides,
  });
}

/** Tier-3 match: different movement pattern, same primary muscle. */
function tierThreeMatch(id: string, overrides: Partial<CreateExerciseInput> = {}): Exercise {
  return makeExercise({
    id,
    primaryMuscle: MuscleGroup.Quadriceps,
    movementPattern: MovementPattern.Hinge,
    ...overrides,
  });
}

/** Structurally unrelated to the source. */
function unrelatedExercise(id: string): Exercise {
  return makeExercise({
    id,
    primaryMuscle: MuscleGroup.Chest,
    movementPattern: MovementPattern.PushHorizontal,
  });
}

function candidateIds(
  selection: { readonly candidates: ReadonlyArray<SubstitutionCandidate> },
): string[] {
  return selection.candidates.map((candidate) => candidate.exercise.id);
}

/** N tier-1 matches with stable, name-sortable identities. */
function tierOneMatches(count: number): Exercise[] {
  return Array.from({ length: count }, (_, index) => {
    const suffix = String(index + 1).padStart(2, '0');
    return tierOneMatch(`ex-t1-${suffix}`, { name: `T1 ${suffix}` });
  });
}

/** Deep-copy snapshot of a catalog: order, fields, and nested arrays. */
function snapshotExercises(catalog: ReadonlyArray<Exercise>): unknown[] {
  return catalog.map((exercise) => ({
    ...exercise,
    secondaryMuscles: [...exercise.secondaryMuscles],
    considerations: exercise.considerations.map((consideration) => ({ ...consideration })),
  }));
}

// ─── Tier selection ─────────────────────────────────────────────────────────

describe('selectSubstitutionCandidates: tier selection', () => {
  it('excludes the source exercise itself', () => {
    const catalog = [source, tierOneMatch('ex-t1-01')];

    const candidates = selectSubstitutionCandidates(source, catalog);

    expect(candidateIds({ candidates })).toEqual(['ex-t1-01']);
  });

  it('returns only tier-1 candidates when tier 1 has a match', () => {
    const catalog = [
      unrelatedExercise('ex-unrelated'),
      tierOneMatch('ex-t1-01'),
      tierTwoMatch('ex-t2-01'),
      tierThreeMatch('ex-t3-01'),
    ];

    const result = selectSubstitutionCandidateSet(source, catalog);

    expect(candidateIds(result)).toEqual(['ex-t1-01']);
    expect(result.candidates[0]?.tier).toBe('same-pattern-same-muscle');
  });

  it('falls back to tier 2 (same pattern) when tier 1 is empty', () => {
    const catalog = [
      unrelatedExercise('ex-unrelated'),
      tierTwoMatch('ex-t2-02'),
      tierTwoMatch('ex-t2-01'),
      tierThreeMatch('ex-t3-01'),
    ];

    const result = selectSubstitutionCandidateSet(source, catalog);

    expect(candidateIds(result).sort()).toEqual(['ex-t2-01', 'ex-t2-02']);
    expect(result.candidates.every((candidate) => candidate.tier === 'same-pattern')).toBe(true);
  });

  it('falls back to tier 3 (same muscle) when tiers 1 and 2 are empty', () => {
    const catalog = [
      unrelatedExercise('ex-unrelated'),
      tierThreeMatch('ex-t3-02'),
      tierThreeMatch('ex-t3-01'),
    ];

    const result = selectSubstitutionCandidateSet(source, catalog);

    expect(candidateIds(result).sort()).toEqual(['ex-t3-01', 'ex-t3-02']);
    expect(result.candidates.every((candidate) => candidate.tier === 'same-muscle')).toBe(true);
  });

  it('returns [] when nothing matches structurally', () => {
    const catalog = [unrelatedExercise('ex-a'), unrelatedExercise('ex-b')];

    const result = selectSubstitutionCandidateSet(source, catalog);

    expect(result.candidates).toEqual([]);
    expect(result.isTruncated).toBe(false);
  });

  it('returns [] for an empty catalog', () => {
    const result = selectSubstitutionCandidateSet(source, []);

    expect(result.candidates).toEqual([]);
    expect(result.isTruncated).toBe(false);
  });

  it('returns [] for a catalog containing only the source', () => {
    const result = selectSubstitutionCandidateSet(source, [source]);

    expect(result.candidates).toEqual([]);
    expect(result.isTruncated).toBe(false);
  });
});

// ─── Deterministic ranking ──────────────────────────────────────────────────

describe('selectSubstitutionCandidates: ranking', () => {
  it('orders by secondary-muscle overlap descending', () => {
    const two = tierOneMatch('ex-two', {
      secondaryMuscles: [MuscleGroup.Glutes, MuscleGroup.Hamstrings],
    });
    const one = tierOneMatch('ex-one', { secondaryMuscles: [MuscleGroup.Glutes] });
    const zero = tierOneMatch('ex-zero', { secondaryMuscles: [MuscleGroup.Calves] });

    const result = selectSubstitutionCandidateSet(source, [zero, two, one]);

    expect(candidateIds(result)).toEqual(['ex-two', 'ex-one', 'ex-zero']);
  });

  it('ranks same-difficulty candidates first within an overlap group', () => {
    const same = tierOneMatch('ex-same', { difficulty: Difficulty.Intermediate });
    const other = tierOneMatch('ex-other', { difficulty: Difficulty.Advanced });

    const result = selectSubstitutionCandidateSet(source, [other, same]);

    expect(candidateIds(result)).toEqual(['ex-same', 'ex-other']);
  });

  it('breaks a full tie with name ascending', () => {
    const b = tierOneMatch('ex-b', { name: 'B Press', slug: 'b-press' });
    const a = tierOneMatch('ex-a', { name: 'A Press', slug: 'a-press' });

    const result = selectSubstitutionCandidateSet(source, [b, a]);

    expect(candidateIds(result)).toEqual(['ex-a', 'ex-b']);
  });

  it('breaks an identical-name tie with exercise id ascending', () => {
    // Two distinct candidates with the same display name, tier, overlap,
    // and difficulty: only the id can order them.
    const z = tierOneMatch('ex-twin-z', { name: 'Twin Squat', slug: 'twin-squat-z' });
    const a = tierOneMatch('ex-twin-a', { name: 'Twin Squat', slug: 'twin-squat-a' });
    const m = tierOneMatch('ex-twin-m', { name: 'Twin Squat', slug: 'twin-squat-m' });

    const result = selectSubstitutionCandidateSet(source, [z, m, a]);

    expect(candidateIds(result)).toEqual(['ex-twin-a', 'ex-twin-m', 'ex-twin-z']);
  });

  it('orders identical-name twins identically from any shuffled catalog input, with an identical cutoff', () => {
    // The regression the review called out: equal rank keys must never
    // inherit the repository's input order. Nine same-name tier-1 twins
    // (one beyond the default limit of 8), shuffled across every rotation
    // and its reversal, must yield the identical ranked list and the
    // identical truncation behavior.
    const twinIds = [
      'ex-twin-01', 'ex-twin-02', 'ex-twin-03', 'ex-twin-04', 'ex-twin-05',
      'ex-twin-06', 'ex-twin-07', 'ex-twin-08', 'ex-twin-09',
    ];
    const twins = twinIds.map((id) =>
      tierOneMatch(id, { name: 'Twin Squat', slug: `twin-squat-${id}` }),
    );

    // Every rotation of the catalog, each also reversed — 18 distinct input
    // orders, all deterministic.
    const shuffles: Exercise[][] = [];
    for (let rotation = 0; rotation < twins.length; rotation++) {
      const rotated = [...twins.slice(rotation), ...twins.slice(0, rotation)];
      shuffles.push(rotated, [...rotated].reverse());
    }

    const expectedOrder = twinIds.slice(0, 8);
    for (const catalog of shuffles) {
      const result = selectSubstitutionCandidateSet(source, catalog);
      // Identical ordering regardless of the repository's input order...
      expect(candidateIds(result)).toEqual(expectedOrder);
      // ...and identical truthful cutoff behavior: the ninth twin is dropped
      // and reported as truncated in every input order.
      expect(result.isTruncated).toBe(true);
    }
  });

  it('produces the identical result from a shuffled catalog', () => {
    const catalog = [
      tierOneMatch('ex-t1-03', { name: 'C Squat', secondaryMuscles: [MuscleGroup.Glutes] }),
      tierOneMatch('ex-t1-01', { name: 'A Squat', secondaryMuscles: [MuscleGroup.Glutes] }),
      tierOneMatch('ex-t1-02', { name: 'B Squat' }),
      tierTwoMatch('ex-t2-01'),
      unrelatedExercise('ex-unrelated'),
    ];

    const first = selectSubstitutionCandidateSet(source, catalog);
    const second = selectSubstitutionCandidateSet(source, [...catalog].reverse());

    expect(second.candidates.map((c) => c.exercise.id)).toEqual(
      first.candidates.map((c) => c.exercise.id),
    );
    expect(second.isTruncated).toBe(first.isTruncated);
    // The winning list is exactly the full ranked tier-1 pool in rank order.
    expect(candidateIds(first)).toEqual(['ex-t1-01', 'ex-t1-03', 'ex-t1-02']);
  });

  it('never mutates the input catalog', () => {
    const catalog = [
      tierOneMatch('ex-a', { name: 'A Squat' }),
      tierOneMatch('ex-b', { name: 'B Squat' }),
    ];
    const before = snapshotExercises(catalog);

    selectSubstitutionCandidateSet(source, catalog);

    expect(catalog).toEqual(before);
    // Structural equality can hide reordering — assert the order too.
    expect(catalog.map((e) => e.id)).toEqual(['ex-a', 'ex-b']);
  });

  it('collapses duplicate ExerciseIds to their first occurrence', () => {
    const first = tierOneMatch('ex-dup', { name: 'First Duplicate', slug: 'first-duplicate' });
    const second = tierOneMatch('ex-dup', {
      name: 'Second Duplicate',
      slug: 'second-duplicate',
      secondaryMuscles: [MuscleGroup.Glutes],
    });
    const other = tierOneMatch('ex-other', { name: 'Other', slug: 'other-exercise' });

    const result = selectSubstitutionCandidateSet(source, [second, other, first]);

    // Both duplicates collapse; first occurrence in the catalog (second) wins.
    expect(candidateIds(result)).toEqual(['ex-dup', 'ex-other']);
    expect(result.candidates[0]?.exercise.name).toBe('Second Duplicate');
    expect(result.candidates).toHaveLength(2);
  });

  it('degrades to difficulty and name ranking when the source has no secondary muscles', () => {
    const bareSource = makeExercise({
      id: 'ex-bare-source',
      name: 'Bare Squat',
      slug: 'bare-squat',
      primaryMuscle: MuscleGroup.Quadriceps,
      secondaryMuscles: [],
      difficulty: Difficulty.Advanced,
      movementPattern: MovementPattern.Squat,
    });
    const advanced = tierOneMatch('ex-advanced', { difficulty: Difficulty.Advanced, name: 'Z Squat' });
    const beginner = tierOneMatch('ex-beginner', { difficulty: Difficulty.Beginner, name: 'A Squat' });

    const result = selectSubstitutionCandidateSet(bareSource, [beginner, advanced]);

    expect(candidateIds(result)).toEqual(['ex-advanced', 'ex-beginner']);
  });
});

// ─── Limits and truncation ──────────────────────────────────────────────────

describe('selectSubstitutionCandidates: limits and truncation', () => {
  it('applies the default limit of 8', () => {
    const result = selectSubstitutionCandidateSet(source, tierOneMatches(10));

    expect(SUBSTITUTION_CANDIDATE_LIMIT).toBe(8);
    expect(result.candidates).toHaveLength(8);
    expect(result.isTruncated).toBe(true);
  });

  it('is not truncated when the tier holds exactly the limit', () => {
    const result = selectSubstitutionCandidateSet(source, tierOneMatches(8));

    expect(result.candidates).toHaveLength(8);
    expect(result.isTruncated).toBe(false);
  });

  it('honors an explicit limit larger than the default', () => {
    const result = selectSubstitutionCandidateSet(source, tierOneMatches(10), 10);

    expect(result.candidates).toHaveLength(10);
    expect(result.isTruncated).toBe(false);
  });

  it('honors an explicit limit smaller than the default', () => {
    const result = selectSubstitutionCandidateSet(source, tierOneMatches(5), 2);

    expect(candidateIds(result)).toEqual(['ex-t1-01', 'ex-t1-02']);
    expect(result.isTruncated).toBe(true);
  });

  it('applies an explicit limit to the projection variant too', () => {
    const candidates = selectSubstitutionCandidates(source, tierOneMatches(5), 3);

    expect(candidateIds({ candidates })).toEqual(['ex-t1-01', 'ex-t1-02', 'ex-t1-03']);
  });

  it('returns [] for limit = 0, reporting the dropped matches as truncated', () => {
    const result = selectSubstitutionCandidateSet(source, tierOneMatches(3), 0);

    expect(result.candidates).toEqual([]);
    expect(result.isTruncated).toBe(true);
  });

  it('returns [] for a negative limit, reporting the dropped matches as truncated', () => {
    const result = selectSubstitutionCandidateSet(source, tierOneMatches(3), -5);

    expect(result.candidates).toEqual([]);
    expect(result.isTruncated).toBe(true);
  });

  it('reports no truncation for an empty pool even with limit = 0', () => {
    const result = selectSubstitutionCandidateSet(source, [], 0);

    expect(result.candidates).toEqual([]);
    expect(result.isTruncated).toBe(false);
  });

  it('keeps the same top candidates a larger pool would rank first', () => {
    const atLimit = selectSubstitutionCandidateSet(source, tierOneMatches(8));
    const beyondLimit = selectSubstitutionCandidateSet(source, tierOneMatches(12));

    expect(candidateIds(beyondLimit)).toEqual(candidateIds(atLimit));
    expect(atLimit.isTruncated).toBe(false);
    expect(beyondLimit.isTruncated).toBe(true);
  });
});
