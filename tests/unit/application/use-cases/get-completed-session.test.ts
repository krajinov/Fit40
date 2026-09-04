import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GetCompletedSessionUseCase } from '@/application/use-cases/get-completed-session';
import type {
  CompletedSessionContext,
  CompletedWorkoutSession,
  TrainingHistoryRepository,
} from '@/application/ports/training-history-repository';
import type { ExerciseRepository } from '@/application/ports/exercise-repository';
import type { Exercise } from '@/domain/entities/exercise';
import {
  createWorkoutSession,
  completeWorkoutSession,
  logSessionSet,
} from '@/domain/entities/workout-session';
import {
  createExerciseId,
  createScheduledWorkoutId,
  createUserId,
  createWorkoutId,
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
function swid(v: string) {
  const r = createScheduledWorkoutId(v);
  if (!r.ok) throw new Error(r.error.message);
  return r.data;
}
function wid(v: string) {
  const r = createWorkoutId(v);
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

interface SetSpec {
  readonly type?: 'reps' | 'duration';
  readonly reps?: number;
  readonly durationSeconds?: number;
  readonly weightKg?: number | null;
  readonly rpe?: number | null;
}
interface LogSpec {
  readonly exerciseId: string;
  readonly sets: ReadonlyArray<SetSpec>;
}

/** Builds a completed session with explicit logged sets (orders from 1). */
function completedSession(id: string, logs: ReadonlyArray<LogSpec>): CompletedWorkoutSession {
  const created = createWorkoutSession({
    id,
    userId: uid('user-a'),
    enrollmentId: null,
    scheduledWorkoutId: swid('sched-wo1'),
    workoutId: wid('wo-1'),
    startedAt: new Date('2026-01-01T10:00:00Z'),
    exerciseLogs: logs.map((log, index) => ({
      exerciseId: eid(log.exerciseId),
      order: index + 1,
      prescription: log.sets[0]?.type === 'duration' ? durationScheme() : repScheme(),
      restSeconds: 60,
    })),
  });
  if (!created.ok) throw new Error(created.error.message);
  let session = created.data;
  for (const [index, log] of logs.entries()) {
    for (const set of log.sets) {
      const logged =
        set.type === 'duration'
          ? logSessionSet(session, {
              exerciseOrder: index + 1,
              type: 'duration',
              durationSeconds: set.durationSeconds ?? 45,
              weightKg: set.weightKg ?? null,
              rpe: set.rpe ?? null,
            })
          : logSessionSet(session, {
              exerciseOrder: index + 1,
              type: 'reps',
              reps: set.reps ?? 10,
              weightKg: set.weightKg ?? null,
              rpe: set.rpe ?? null,
            });
      if (!logged.ok) throw new Error(logged.error.message);
      session = logged.data;
    }
  }
  const completed = completeWorkoutSession(session, new Date('2026-01-01T10:45:00Z'));
  if (!completed.ok) throw new Error(completed.error.message);
  // The transition sets completedAt to exactly the instant passed above.
  return { ...completed.data, completedAt: new Date('2026-01-01T10:45:00Z') };
}

function makeExercise(id: string): Exercise {
  return {
    id: eid(id),
    name: 'Goblet Squat',
    slug: 'goblet-squat',
    description: 'A squat performed holding a kettlebell at chest height.',
    primaryMuscle: MuscleGroupEnum.Quadriceps,
    secondaryMuscles: [],
    equipment: EquipmentTypeEnum.Kettlebell,
    difficulty: DifficultyEnum.Beginner,
    movementPattern: MovementPatternEnum.Squat,
    considerations: [],
  };
}

function makeContext(session: CompletedWorkoutSession): CompletedSessionContext {
  return {
    session,
    programName: 'Fit40 Beginner Strength',
    workoutName: 'Full Body A',
  };
}

function makeHistoryRepo(context: CompletedSessionContext | null) {
  return {
    listCompletedSessions: vi.fn(),
    listCompletedExerciseOccurrences: vi.fn(),
    getTotals: vi.fn(),
    findCompletedSessionById: vi.fn().mockResolvedValue(context),
  } satisfies TrainingHistoryRepository;
}

function makeExerciseRepo(exercises: ReadonlyArray<Exercise>) {
  return {
    list: vi.fn(),
    findBySlug: vi.fn(),
    findByIds: vi.fn().mockResolvedValue(exercises),
  } satisfies ExerciseRepository;
}

describe('GetCompletedSessionUseCase', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the serializable snapshot with display metadata and metrics', async () => {
    const session = completedSession('session-1', [
      { exerciseId: 'ex-001', sets: [{ reps: 10, weightKg: 50, rpe: 7 }] },
    ]);
    const uc = new GetCompletedSessionUseCase(
      makeHistoryRepo(makeContext(session)),
      makeExerciseRepo([makeExercise('ex-001')]),
    );

    const result = await uc.execute({ userId: 'user-a', sessionId: 'session-1' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.sessionId).toBe('session-1');
    expect(result.data.workoutName).toBe('Full Body A');
    expect(result.data.programName).toBe('Fit40 Beginner Strength');
    expect(result.data.startedAt).toBe('2026-01-01T10:00:00.000Z');
    expect(result.data.completedAt).toBe('2026-01-01T10:45:00.000Z');
    expect(result.data.entries).toHaveLength(1);
    const entry = result.data.entries[0];
    expect(entry?.exerciseId).toBe('ex-001');
    expect(entry?.exerciseOrder).toBe(1);
    expect(entry?.exerciseName).toBe('Goblet Squat');
    expect(entry?.equipment).toBe(EquipmentTypeEnum.Kettlebell);
    expect(entry?.sets[0]).toEqual({
      type: 'reps',
      setNumber: 1,
      reps: 10,
      weightKg: 50,
      rpe: 7,
    });
    expect(result.data.metrics).toEqual({
      totalSets: 1,
      totalReps: 10,
      totalDurationSeconds: 0,
      volume: 500,
    });
  });

  // __APPEND_TESTS__
  it('queries the catalog once with deduplicated exercise ids', async () => {
    const session = completedSession('session-dup', [
      { exerciseId: 'ex-001', sets: [{ reps: 10, weightKg: 50 }] },
      { exerciseId: 'ex-001', sets: [{ reps: 12, weightKg: 52 }] },
    ]);
    const exerciseRepo = makeExerciseRepo([makeExercise('ex-001')]);
    const uc = new GetCompletedSessionUseCase(makeHistoryRepo(makeContext(session)), exerciseRepo);

    const result = await uc.execute({ userId: 'user-a', sessionId: 'session-dup' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(exerciseRepo.findByIds).toHaveBeenCalledTimes(1);
    expect(exerciseRepo.findByIds).toHaveBeenCalledWith([eid('ex-001')]);
    // Duplicate occurrences of one exercise never collapse.
    expect(result.data.entries).toHaveLength(2);
    expect(result.data.entries[0]?.exerciseName).toBe('Goblet Squat');
    expect(result.data.entries[1]?.exerciseName).toBe('Goblet Squat');
  });

  it('preserves 0 kg as a real load and null weight as bodyweight', async () => {
    const session = completedSession('session-zero', [
      {
        exerciseId: 'ex-001',
        sets: [
          { reps: 10, weightKg: 0, rpe: null },
          { reps: 10, weightKg: null, rpe: null },
        ],
      },
    ]);
    const uc = new GetCompletedSessionUseCase(
      makeHistoryRepo(makeContext(session)),
      makeExerciseRepo([]),
    );

    const result = await uc.execute({ userId: 'user-a', sessionId: 'session-zero' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.entries[0]?.sets[0]?.weightKg).toBe(0);
    expect(result.data.entries[0]?.sets[0]?.rpe).toBeNull();
    expect(result.data.entries[0]?.sets[1]?.weightKg).toBeNull();
  });

  it('serializes duration prescriptions and duration sets', async () => {
    const session = completedSession('session-duration', [
      { exerciseId: 'ex-015', sets: [{ type: 'duration', durationSeconds: 45, rpe: 6 }] },
    ]);
    const uc = new GetCompletedSessionUseCase(
      makeHistoryRepo(makeContext(session)),
      makeExerciseRepo([]),
    );

    const result = await uc.execute({ userId: 'user-a', sessionId: 'session-duration' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.entries[0]?.prescription).toEqual({
      type: 'duration',
      sets: 3,
      seconds: 45,
    });
    expect(result.data.entries[0]?.sets[0]).toEqual({
      type: 'duration',
      setNumber: 1,
      durationSeconds: 45,
      weightKg: null,
      rpe: 6,
    });
    expect(result.data.metrics.totalDurationSeconds).toBe(45);
  });

  it('degrades gracefully when catalog entries are unresolved', async () => {
    const session = completedSession('session-orphan', [{ exerciseId: 'ex-404', sets: [{ reps: 10 }] }]);
    const uc = new GetCompletedSessionUseCase(
      makeHistoryRepo(makeContext(session)),
      makeExerciseRepo([]),
    );

    const result = await uc.execute({ userId: 'user-a', sessionId: 'session-orphan' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.entries[0]?.exerciseName).toBeNull();
    expect(result.data.entries[0]?.equipment).toBeNull();
  });

  it('rejects malformed input before touching the repository', async () => {
    const historyRepo = makeHistoryRepo(null);
    const uc = new GetCompletedSessionUseCase(historyRepo, makeExerciseRepo([]));

    const badSession = await uc.execute({ userId: 'user-a', sessionId: '' });
    expect(badSession.ok).toBe(false);
    if (!badSession.ok) expect(badSession.error.code).toBe('INVALID_INPUT');
    const badUser = await uc.execute({ userId: '', sessionId: 'session-1' });
    expect(badUser.ok).toBe(false);
    if (!badUser.ok) expect(badUser.error.code).toBe('INVALID_INPUT');
    expect(historyRepo.findCompletedSessionById).not.toHaveBeenCalled();
  });

  it('returns SESSION_NOT_FOUND when the id does not address a completed session', async () => {
    const uc = new GetCompletedSessionUseCase(makeHistoryRepo(null), makeExerciseRepo([]));

    const result = await uc.execute({ userId: 'user-a', sessionId: 'session-missing' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('SESSION_NOT_FOUND');
  });

});

  it('queries the catalog once with deduplicated exercise ids', async () => {
    const session = completedSession('session-dup', [
      { exerciseId: 'ex-001', sets: [{ reps: 10, weightKg: 50 }] },
      { exerciseId: 'ex-001', sets: [{ reps: 12, weightKg: 52 }] },
    ]);
    const exerciseRepo = makeExerciseRepo([makeExercise('ex-001')]);
    const uc = new GetCompletedSessionUseCase(
      makeHistoryRepo(makeContext(session)),
      exerciseRepo,
    );

    const result = await uc.execute({ userId: 'user-a', sessionId: 'session-dup' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(exerciseRepo.findByIds).toHaveBeenCalledTimes(1);
    expect(exerciseRepo.findByIds).toHaveBeenCalledWith([eid('ex-001')]);
    // Duplicate occurrences of one exercise never collapse.
    expect(result.data.entries).toHaveLength(2);
    expect(result.data.entries[0]?.exerciseName).toBe('Goblet Squat');
    expect(result.data.entries[1]?.exerciseName).toBe('Goblet Squat');
  });

  it('preserves 0 kg as a real load and null weight as bodyweight', async () => {
    const session = completedSession('session-zero', [
      {
        exerciseId: 'ex-001',
        sets: [
          { reps: 10, weightKg: 0, rpe: null },
          { reps: 10, weightKg: null, rpe: null },
        ],
      },
    ]);
    const uc = new GetCompletedSessionUseCase(
      makeHistoryRepo(makeContext(session)),
      makeExerciseRepo([]),
    );

    const result = await uc.execute({ userId: 'user-a', sessionId: 'session-zero' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.entries[0]?.sets[0]?.weightKg).toBe(0);
    expect(result.data.entries[0]?.sets[0]?.rpe).toBeNull();
    expect(result.data.entries[0]?.sets[1]?.weightKg).toBeNull();
  });

  it('serializes duration prescriptions and duration sets', async () => {
    const session = completedSession('session-duration', [
      {
        exerciseId: 'ex-015',
        sets: [{ type: 'duration', durationSeconds: 45, rpe: 6 }],
      },
    ]);
    const uc = new GetCompletedSessionUseCase(
      makeHistoryRepo(makeContext(session)),
      makeExerciseRepo([]),
    );

    const result = await uc.execute({ userId: 'user-a', sessionId: 'session-duration' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.entries[0]?.prescription).toEqual({
      type: 'duration',
      sets: 3,
      seconds: 45,
    });
    expect(result.data.entries[0]?.sets[0]).toEqual({
      type: 'duration',
      setNumber: 1,
      durationSeconds: 45,
      weightKg: null,
      rpe: 6,
    });
    expect(result.data.metrics.totalDurationSeconds).toBe(45);
  });

  it('degrades gracefully when catalog entries are unresolved', async () => {
    const session = completedSession('session-orphan', [
      { exerciseId: 'ex-404', sets: [{ reps: 10 }] },
    ]);
    const uc = new GetCompletedSessionUseCase(
      makeHistoryRepo(makeContext(session)),
      makeExerciseRepo([]),
    );

    const result = await uc.execute({ userId: 'user-a', sessionId: 'session-orphan' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.entries[0]?.exerciseName).toBeNull();
    expect(result.data.entries[0]?.equipment).toBeNull();
  });

  it('rejects malformed input before touching the repository', async () => {
    const historyRepo = makeHistoryRepo(null);
    const uc = new GetCompletedSessionUseCase(historyRepo, makeExerciseRepo([]));

    const badSession = await uc.execute({ userId: 'user-a', sessionId: '' });
    expect(badSession.ok).toBe(false);
    if (!badSession.ok) expect(badSession.error.code).toBe('INVALID_INPUT');
    const badUser = await uc.execute({ userId: '', sessionId: 'session-1' });
    expect(badUser.ok).toBe(false);
    if (!badUser.ok) expect(badUser.error.code).toBe('INVALID_INPUT');
    expect(historyRepo.findCompletedSessionById).not.toHaveBeenCalled();
  });

  it('returns SESSION_NOT_FOUND when the id does not address a completed session', async () => {
    const uc = new GetCompletedSessionUseCase(
      makeHistoryRepo(null),
      makeExerciseRepo([]),
    );

    const result = await uc.execute({ userId: 'user-a', sessionId: 'session-missing' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('SESSION_NOT_FOUND');
  });
