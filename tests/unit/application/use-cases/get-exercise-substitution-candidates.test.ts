/**
 * Tests for GetExerciseSubstitutionCandidatesUseCase: input validation,
 * source resolution, DTO mapping with preserved match tiers, truthful
 * isLimited reporting, and the single-catalog-read contract. Also covers the
 * exported pure mapper directly — the composition point the Active Workout
 * (M9 Slice 5) uses to map many sources over ONE preloaded catalog.
 */

import { describe, expect, it, vi } from 'vitest';

import {
  toExerciseSubstitutionCandidatesDto,
} from '@/application/dto/substitution-candidates';
import type { ExerciseRepository } from '@/application/ports/exercise-repository';
import { GetExerciseSubstitutionCandidatesUseCase } from '@/application/use-cases/get-exercise-substitution-candidates';
import {
  createExercise,
  type CreateExerciseInput,
  type Exercise,
} from '@/domain/entities/exercise';
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

const source = makeExercise({
  id: 'ex-source',
  name: 'Goblet Squat',
  slug: 'goblet-squat',
  primaryMuscle: MuscleGroup.Quadriceps,
  secondaryMuscles: [MuscleGroup.Glutes],
  equipment: EquipmentType.Kettlebell,
  difficulty: Difficulty.Intermediate,
  movementPattern: MovementPattern.Squat,
});

/** A tier-1 substitute for the source. */
function substitute(
  id: string,
  name: string,
  overrides: Partial<CreateExerciseInput> = {},
): Exercise {
  return makeExercise({
    id,
    name,
    slug: `substitute-${id}`,
    primaryMuscle: MuscleGroup.Quadriceps,
    movementPattern: MovementPattern.Squat,
    ...overrides,
  });
}

/** N tier-1 substitutes with name-sortable identities. */
function substitutes(count: number): Exercise[] {
  return Array.from({ length: count }, (_, index) => {
    const suffix = String(index + 1).padStart(2, '0');
    return substitute(`ex-sub-${suffix}`, `Substitute ${suffix}`);
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

function makeExerciseRepo(catalog: ReadonlyArray<Exercise>) {
  return {
    list: vi.fn(async () => catalog),
    findBySlug: vi.fn(),
    findByIds: vi.fn(),
  } satisfies ExerciseRepository;
}

// ─── Use case ───────────────────────────────────────────────────────────────

describe('GetExerciseSubstitutionCandidatesUseCase', () => {
  it('rejects a malformed source id with INVALID_INPUT before reading the catalog', async () => {
    const repo = makeExerciseRepo([source]);

    const result = await new GetExerciseSubstitutionCandidatesUseCase(repo).execute({
      sourceExerciseId: '   ',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('INVALID_INPUT');
    if (result.error.code !== 'INVALID_INPUT') return;
    expect(result.error.field).toBe('sourceExerciseId');
    expect(repo.list).not.toHaveBeenCalled();
  });

  it('returns EXERCISE_NOT_FOUND when the source is absent from the catalog', async () => {
    const repo = makeExerciseRepo([unrelatedExercise('ex-u-1')]);

    const result = await new GetExerciseSubstitutionCandidatesUseCase(repo).execute({
      sourceExerciseId: 'ex-source',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('EXERCISE_NOT_FOUND');
    if (result.error.code !== 'EXERCISE_NOT_FOUND') return;
    expect(result.error.exerciseId).toBe('ex-source');
  });

  it('maps candidates to DTOs, preserving the match tier', async () => {
    const best = substitute('ex-best', 'Best Substitute', {
      secondaryMuscles: [MuscleGroup.Glutes],
      difficulty: Difficulty.Intermediate,
      equipment: EquipmentType.Barbell,
    });
    const plain = substitute('ex-plain', 'Plain Substitute');
    const repo = makeExerciseRepo([source, best, plain, unrelatedExercise('ex-u-1')]);

    const result = await new GetExerciseSubstitutionCandidatesUseCase(repo).execute({
      sourceExerciseId: 'ex-source',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.sourceExerciseId).toBe('ex-source');
    expect(result.data.candidates.map((candidate) => candidate.exerciseId)).toEqual([
      'ex-best',
      'ex-plain',
    ]);
    expect(result.data.candidates[0]).toEqual({
      exerciseId: 'ex-best',
      name: 'Best Substitute',
      slug: 'substitute-ex-best',
      equipment: EquipmentType.Barbell,
      primaryMuscle: MuscleGroup.Quadriceps,
      movementPattern: MovementPattern.Squat,
      difficulty: Difficulty.Intermediate,
      matchTier: 'same-pattern-same-muscle',
    });
    expect(result.data.candidates.every((candidate) => candidate.exerciseId !== 'ex-source')).toBe(
      true,
    );
  });

  it('returns an empty candidate list when nothing matches the source', async () => {
    const repo = makeExerciseRepo([source, unrelatedExercise('ex-u-1')]);

    const result = await new GetExerciseSubstitutionCandidatesUseCase(repo).execute({
      sourceExerciseId: 'ex-source',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.candidates).toEqual([]);
    expect(result.data.isLimited).toBe(false);
  });

  it('reads the catalog exactly once per execute and uses no other repository method', async () => {
    const repo = makeExerciseRepo([source, ...substitutes(3)]);

    const result = await new GetExerciseSubstitutionCandidatesUseCase(repo).execute({
      sourceExerciseId: 'ex-source',
    });

    expect(result.ok).toBe(true);
    expect(repo.list).toHaveBeenCalledTimes(1);
    expect(repo.findBySlug).not.toHaveBeenCalled();
    expect(repo.findByIds).not.toHaveBeenCalled();
  });
});

// ─── Truthful isLimited ──────────────────────────────────────────────────────

describe('GetExerciseSubstitutionCandidatesUseCase: truthful isLimited', () => {
  it('reports false when fewer matching candidates than the limit exist', async () => {
    const repo = makeExerciseRepo([source, ...substitutes(3)]);

    const result = await new GetExerciseSubstitutionCandidatesUseCase(repo).execute({
      sourceExerciseId: 'ex-source',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.candidates).toHaveLength(3);
    expect(result.data.isLimited).toBe(false);
  });

  it('reports false when exactly the limit of matching candidates exist', async () => {
    // 8 valid candidates and NO more: exactly-at-limit is NOT truncation.
    const repo = makeExerciseRepo([source, ...substitutes(8)]);

    const result = await new GetExerciseSubstitutionCandidatesUseCase(repo).execute({
      sourceExerciseId: 'ex-source',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.candidates).toHaveLength(8);
    expect(result.data.isLimited).toBe(false);
  });

  it('reports true when additional matching candidates were truncated', async () => {
    const repo = makeExerciseRepo([source, ...substitutes(9)]);

    const result = await new GetExerciseSubstitutionCandidatesUseCase(repo).execute({
      sourceExerciseId: 'ex-source',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.candidates).toHaveLength(8);
    expect(result.data.isLimited).toBe(true);
  });
});

// ─── Pure mapper: the one-catalog-read composition point ─────────────────────

describe('toExerciseSubstitutionCandidatesDto (pure mapper)', () => {
  it('maps many sources over ONE preloaded catalog without any repository', () => {
    // Slice 5 composition proof: load the catalog once, then reuse it for
    // every distinct source — each ranked independently.
    const secondSource = makeExercise({
      id: 'ex-source-2',
      name: 'Hip Thrust',
      slug: 'hip-thrust',
      primaryMuscle: MuscleGroup.Glutes,
      secondaryMuscles: [MuscleGroup.Hamstrings],
      equipment: EquipmentType.Bench,
      difficulty: Difficulty.Intermediate,
      movementPattern: MovementPattern.Squat,
    });
    const gluteSubstitute = makeExercise({
      id: 'ex-glute-sub',
      name: 'Glute Substitute',
      slug: 'glute-substitute',
      primaryMuscle: MuscleGroup.Glutes,
      movementPattern: MovementPattern.Squat,
    });
    const catalog = [
      source,
      ...substitutes(2),
      secondSource,
      gluteSubstitute,
      unrelatedExercise('ex-u-1'),
    ];

    const quadResult = toExerciseSubstitutionCandidatesDto(source, catalog);
    const gluteResult = toExerciseSubstitutionCandidatesDto(secondSource, catalog);

    expect(quadResult.sourceExerciseId).toBe('ex-source');
    expect(quadResult.candidates.map((candidate) => candidate.exerciseId)).toEqual([
      'ex-sub-01',
      'ex-sub-02',
    ]);
    expect(gluteResult.sourceExerciseId).toBe('ex-source-2');
    expect(gluteResult.candidates.map((candidate) => candidate.exerciseId)).toEqual([
      'ex-glute-sub',
    ]);
    expect(gluteResult.candidates[0]?.matchTier).toBe('same-pattern-same-muscle');
  });

  it('exposes equipment on every candidate for the later UI', () => {
    const heavy = substitute('ex-heavy', 'Heavy Substitute', {
      equipment: EquipmentType.Barbell,
    });
    const result = toExerciseSubstitutionCandidatesDto(source, [source, heavy]);

    expect(result.candidates[0]?.equipment).toBe(EquipmentType.Barbell);
  });

  it('returns an empty candidate list for a source with no structural match', () => {
    const result = toExerciseSubstitutionCandidatesDto(source, [
      source,
      unrelatedExercise('ex-u-1'),
    ]);

    expect(result.candidates).toEqual([]);
    expect(result.isLimited).toBe(false);
  });
});

