import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  EXERCISE_HISTORY_OCCURRENCE_LIMIT,
  GetExerciseHistoryUseCase,
} from '@/application/use-cases/get-exercise-history';
import type {
  CompletedExerciseOccurrence,
  TrainingHistoryRepository,
} from '@/application/ports/training-history-repository';
import type { ExerciseRepository } from '@/application/ports/exercise-repository';
import type { Exercise } from '@/domain/entities/exercise';
import type { SetLog } from '@/domain/entities/workout-session';
import {
  createExerciseId,
  createUserId,
  createWorkoutSessionId,
} from '@/domain/types/ids';
import {
  Difficulty as DifficultyEnum,
  EquipmentType as EquipmentTypeEnum,
  MovementPattern as MovementPatternEnum,
  MuscleGroup as MuscleGroupEnum,
} from '@/domain/types/exercise';
import { createDurationScheme, createRepScheme } from '@/domain/value-objects/rep-prescription';

function uid(v: string) {
  const r = createUserId(v);
  if (!r.ok) throw new Error(r.error.message);
  return r.data;
}

function eid(v: string) {
  const r = createExerciseId(v);
  if (!r.ok) throw new Error(r.error.message);
  return r.data;
}

function sid(v: string) {
  const r = createWorkoutSessionId(v);
  if (!r.ok) throw new Error(r.error.message);
  return r.data;
}

function repScheme() {
  const r = createRepScheme(3, 8, 10);
  if (!r.ok) throw new Error(r.error.message);
  return r.data;
}

function durationScheme() {
  const r = createDurationScheme(3, 45);
  if (!r.ok) throw new Error(r.error.message);
  return r.data;
}

function makeExercise(id: string, slug: string): Exercise {
  return {
    id: eid(id),
    name: 'Goblet Squat',
    slug,
    description: 'A squat performed holding a kettlebell at chest height.',
    primaryMuscle: MuscleGroupEnum.Quadriceps,
    secondaryMuscles: [],
    equipment: EquipmentTypeEnum.Kettlebell,
    difficulty: DifficultyEnum.Beginner,
    movementPattern: MovementPatternEnum.Squat,
    considerations: [],
  };
}

interface SetSpec {
  readonly type?: 'reps' | 'duration';
  readonly reps?: number;
  readonly durationSeconds?: number;
  readonly weightKg?: number | null;
  readonly rpe?: number | null;
}

/** Builds one occurrence directly — the port type is a plain projection. */
function occurrence(
  sessionId: string,
  exerciseOrder: number,
  completedAt: string,
  sets: ReadonlyArray<SetSpec>,
  workoutName = 'Full Body A',
): CompletedExerciseOccurrence {
  const logSets: SetLog[] = sets.map((set, index) =>
    set.type === 'duration'
      ? {
          type: 'duration',
          setNumber: index + 1,
          durationSeconds: set.durationSeconds ?? 45,
          weightKg: set.weightKg ?? null,
          rpe: set.rpe ?? null,
        }
      : {
          type: 'reps',
          setNumber: index + 1,
          reps: set.reps ?? 10,
          weightKg: set.weightKg ?? null,
          rpe: set.rpe ?? null,
        },
  );
  return {
    sessionId: sid(sessionId),
    exerciseOrder,
    completedAt: new Date(completedAt),
    programName: 'Fit40 Beginner Strength',
    workoutName,
    prescription: sets[0]?.type === 'duration' ? durationScheme() : repScheme(),
    sets: logSets,
  };
}

function makeHistoryRepo(occurrences: ReadonlyArray<CompletedExerciseOccurrence>) {
  return {
    listCompletedSessions: vi.fn(),
    listCompletedExerciseOccurrences: vi.fn().mockResolvedValue(occurrences),
    getTotals: vi.fn(),
    findCompletedSessionById: vi.fn().mockResolvedValue(null),
  } satisfies TrainingHistoryRepository;
}

function makeExerciseRepo(exercise: Exercise | null) {
  return {
    list: vi.fn(),
    findBySlug: vi.fn().mockResolvedValue(exercise),
    findByIds: vi.fn().mockResolvedValue([]),
  } satisfies ExerciseRepository;
}

describe('GetExerciseHistoryUseCase', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns empty history for a known exercise with no user history', async () => {
    const historyRepo = makeHistoryRepo([]);
    const uc = new GetExerciseHistoryUseCase(
      historyRepo,
      makeExerciseRepo(makeExercise('ex-001', 'goblet-squat')),
    );

    const result = await uc.execute({ userId: 'user-a', slug: 'goblet-squat' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.entries).toEqual([]);
    expect(result.data.trend).toEqual([]);
    expect(result.data.exercise.name).toBe('Goblet Squat');
  });

  it('returns EXERCISE_NOT_FOUND for an unknown slug without querying history', async () => {
    const historyRepo = makeHistoryRepo([]);
    const uc = new GetExerciseHistoryUseCase(historyRepo, makeExerciseRepo(null));

    const result = await uc.execute({ userId: 'user-a', slug: 'unknown-exercise' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('EXERCISE_NOT_FOUND');
    expect(historyRepo.listCompletedExerciseOccurrences).not.toHaveBeenCalled();
  });

  it('rejects an invalid userId with INVALID_INPUT before touching repositories', async () => {
    const historyRepo = makeHistoryRepo([]);
    const exerciseRepo = makeExerciseRepo(makeExercise('ex-001', 'goblet-squat'));
    const uc = new GetExerciseHistoryUseCase(historyRepo, exerciseRepo);

    const result = await uc.execute({ userId: ' ', slug: 'goblet-squat' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('INVALID_INPUT');
    expect(exerciseRepo.findBySlug).not.toHaveBeenCalled();
    expect(historyRepo.listCompletedExerciseOccurrences).not.toHaveBeenCalled();
  });

  it('queries occurrences scoped to the resolved exercise with the fixed bound', async () => {
    const historyRepo = makeHistoryRepo([]);
    const uc = new GetExerciseHistoryUseCase(
      historyRepo,
      makeExerciseRepo(makeExercise('ex-001', 'goblet-squat')),
    );

    await uc.execute({ userId: 'user-a', slug: 'goblet-squat' });
    expect(historyRepo.listCompletedExerciseOccurrences).toHaveBeenCalledWith(
      uid('user-a'),
      eid('ex-001'),
      EXERCISE_HISTORY_OCCURRENCE_LIMIT,
    );
  });


  it('maps entries newest first and preserves occurrence identity', async () => {
    const occurrences = [
      occurrence('session-new', 1, '2026-02-01T10:00:00Z', [
        { reps: 10, weightKg: 52.5, rpe: 8 },
      ]),
      occurrence('session-old', 2, '2026-01-01T10:00:00Z', [
        { reps: 10, weightKg: 50, rpe: null },
      ]),
    ];
    const uc = new GetExerciseHistoryUseCase(
      makeHistoryRepo(occurrences),
      makeExerciseRepo(makeExercise('ex-001', 'goblet-squat')),
    );

    const result = await uc.execute({ userId: 'user-a', slug: 'goblet-squat' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.entries.map((entry) => entry.sessionId)).toEqual([
      'session-new',
      'session-old',
    ]);
    expect(result.data.entries[0]?.exerciseOrder).toBe(1);
    expect(result.data.entries[1]?.exerciseOrder).toBe(2);
    expect(result.data.entries[0]?.workingLoadKg).toBe(52.5);
    expect(result.data.entries[0]?.sets[0]?.rpe).toBe(8);
    expect(result.data.entries[1]?.sets[0]?.rpe).toBeNull();
  });

  it('resolves the working load as the minimum across performed sets (0 kg is real)', async () => {
    const occurrences = [
      occurrence('session-mixed', 1, '2026-01-01T10:00:00Z', [
        { reps: 10, weightKg: 40 },
        { reps: 8, weightKg: 0 },
      ]),
    ];
    const uc = new GetExerciseHistoryUseCase(
      makeHistoryRepo(occurrences),
      makeExerciseRepo(makeExercise('ex-001', 'goblet-squat')),
    );

    const result = await uc.execute({ userId: 'user-a', slug: 'goblet-squat' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.entries[0]?.workingLoadKg).toBe(0);
  });

  it('marks bodyweight and duration occurrences with a null working load', async () => {
    const occurrences = [
      occurrence('session-bodyweight', 1, '2026-02-01T10:00:00Z', [
        { reps: 12, weightKg: null },
      ]),
      occurrence('session-duration', 1, '2026-01-01T10:00:00Z', [
        { type: 'duration', durationSeconds: 45, weightKg: null },
      ]),
    ];
    const uc = new GetExerciseHistoryUseCase(
      makeHistoryRepo(occurrences),
      makeExerciseRepo(makeExercise('ex-001', 'goblet-squat')),
    );

    const result = await uc.execute({ userId: 'user-a', slug: 'goblet-squat' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.entries[0]?.workingLoadKg).toBeNull();
    expect(result.data.entries[1]?.workingLoadKg).toBeNull();
  });

  it('serializes prescriptions, sets, and ISO timestamps', async () => {
    const occurrences = [
      occurrence('session-duration', 1, '2026-01-01T10:00:00Z', [
        { type: 'duration', durationSeconds: 45, rpe: 6 },
      ]),
    ];
    const uc = new GetExerciseHistoryUseCase(
      makeHistoryRepo(occurrences),
      makeExerciseRepo(makeExercise('ex-001', 'goblet-squat')),
    );

    const result = await uc.execute({ userId: 'user-a', slug: 'goblet-squat' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.entries[0]?.prescription).toEqual({
      type: 'duration',
      sets: 3,
      seconds: 45,
    });
    expect(result.data.entries[0]?.completedAt).toBe('2026-01-01T10:00:00.000Z');
    expect(result.data.entries[0]?.sets[0]).toEqual({
      type: 'duration',
      setNumber: 1,
      durationSeconds: 45,
      weightKg: null,
      rpe: 6,
    });
  });

  it('builds the trend chronologically from only externally loaded occurrences', async () => {
    const occurrences = [
      occurrence('session-new', 1, '2026-03-01T10:00:00Z', [{ reps: 10, weightKg: 55 }]),
      occurrence('session-body', 1, '2026-02-01T10:00:00Z', [{ reps: 12, weightKg: null }]),
      occurrence('session-old', 1, '2026-01-01T10:00:00Z', [{ reps: 10, weightKg: 50 }]),
    ];
    const uc = new GetExerciseHistoryUseCase(
      makeHistoryRepo(occurrences),
      makeExerciseRepo(makeExercise('ex-001', 'goblet-squat')),
    );

    const result = await uc.execute({ userId: 'user-a', slug: 'goblet-squat' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.trend).toEqual([
      { completedAt: '2026-01-01T10:00:00.000Z', workingLoadKg: 50 },
      { completedAt: '2026-03-01T10:00:00.000Z', workingLoadKg: 55 },
    ]);
  });
});

