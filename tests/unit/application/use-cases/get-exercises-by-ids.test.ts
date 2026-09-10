import { describe, expect, it, vi } from 'vitest';
import { GetExercisesByIdsUseCase } from '@/application/use-cases/get-exercises-by-ids';
import type { ExerciseRepository } from '@/application/ports/exercise-repository';
import type { Exercise } from '@/domain/entities/exercise';
import { Difficulty, EquipmentType, MovementPattern, MuscleGroup } from '@/domain/types/exercise';
import { createExerciseId } from '@/domain/types/ids';

function eid(v: string) { const r = createExerciseId(v); if (!r.ok) throw Error(); return r.data; }

function makeExercise(id: string, name: string): Exercise {
  return {
    id: eid(id),
    name,
    slug: `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${id}`,
    description: 'A catalog exercise.',
    primaryMuscle: MuscleGroup.Quadriceps,
    secondaryMuscles: [],
    equipment: EquipmentType.Bodyweight,
    difficulty: Difficulty.Beginner,
    movementPattern: MovementPattern.Squat,
    considerations: [],
  };
}

/**
 * Mock repository mirroring the port contract: unknown ids omitted,
 * duplicates collapsed, empty ids short-circuit without querying.
 */
function makeExerciseRepo(exercises: ReadonlyArray<Exercise>) {
  return {
    list: vi.fn(),
    findBySlug: vi.fn(),
    findByIds: vi.fn(async (ids: ReadonlyArray<ReturnType<typeof eid>>) => {
      if (ids.length === 0) return [];
      const found = exercises.filter((e) => ids.includes(e.id));
      return [...new Map(found.map((e) => [e.id, e])).values()];
    }),
  } satisfies ExerciseRepository;
}

describe('GetExercisesByIdsUseCase', () => {
  it('returns summaries for the requested ids in one repository call', async () => {
    const repo = makeExerciseRepo([makeExercise('ex-001', 'Bodyweight Squat'), makeExercise('ex-002', 'Goblet Squat')]);
    const uc = new GetExercisesByIdsUseCase(repo);

    const r = await uc.execute({ exerciseIds: ['ex-001', 'ex-002'] });

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(repo.findByIds).toHaveBeenCalledTimes(1);
    expect(repo.findByIds).toHaveBeenCalledWith([eid('ex-001'), eid('ex-002')]);
    expect(r.data.map((e) => e.id)).toEqual(['ex-001', 'ex-002']);
    expect(r.data[0]).toEqual({
      id: 'ex-001',
      name: 'Bodyweight Squat',
      slug: 'bodyweight-squat-ex-001',
      primaryMuscle: MuscleGroup.Quadriceps,
      equipment: EquipmentType.Bodyweight,
      difficulty: Difficulty.Beginner,
      movementPattern: MovementPattern.Squat,
    });
  });

  it('deduplicates ids before the single repository call', async () => {
    const repo = makeExerciseRepo([makeExercise('ex-001', 'Bodyweight Squat')]);
    const uc = new GetExercisesByIdsUseCase(repo);

    const r = await uc.execute({ exerciseIds: ['ex-001', 'ex-001', 'ex-001'] });

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(repo.findByIds).toHaveBeenCalledTimes(1);
    expect(repo.findByIds).toHaveBeenCalledWith([eid('ex-001')]);
    expect(r.data).toHaveLength(1);
  });

  it('returns an empty result without querying for empty input', async () => {
    const repo = makeExerciseRepo([makeExercise('ex-001', 'Bodyweight Squat')]);
    const uc = new GetExercisesByIdsUseCase(repo);

    const r = await uc.execute({ exerciseIds: [] });

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data).toEqual([]);
    expect(repo.findByIds).not.toHaveBeenCalled();
  });

  it('omits unknown ids instead of failing (established repository semantics)', async () => {
    const repo = makeExerciseRepo([makeExercise('ex-001', 'Bodyweight Squat')]);
    const uc = new GetExercisesByIdsUseCase(repo);

    const r = await uc.execute({ exerciseIds: ['ex-001', 'ex-404'] });

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(repo.findByIds).toHaveBeenCalledTimes(1);
    expect(r.data.map((e) => e.id)).toEqual(['ex-001']);
  });

  it('rejects a malformed id before touching the repository', async () => {
    const repo = makeExerciseRepo([makeExercise('ex-001', 'Bodyweight Squat')]);
    const uc = new GetExercisesByIdsUseCase(repo);

    const r = await uc.execute({ exerciseIds: ['ex-001', ' '] });

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('INVALID_INPUT');
    expect(r.error.field).toBe('exerciseIds[1]');
    expect(repo.findByIds).not.toHaveBeenCalled();
  });
});
