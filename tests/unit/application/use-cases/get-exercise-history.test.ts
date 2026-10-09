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
import type { PersonalRecordRepository } from '@/application/ports/personal-record-repository';
import type { Exercise } from '@/domain/entities/exercise';
import type { SetLog } from '@/domain/entities/workout-session';
import type { CandidatePriorBest, PersonalBest } from '@/domain/services/personal-records';
import { RecordMetric } from '@/domain/services/personal-record-metrics';
import type { RecordCandidate } from '@/domain/services/personal-record-metrics';
import {
  createExerciseId,
  createUserId,
  createWorkoutSessionId,
  type UserId,
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
    // One hour of session wall-clock, so the ladder's second rung is real.
    startedAt: new Date(new Date(completedAt).getTime() - 3_600_000),
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
    listRecentCompletedExercisePerformances: vi.fn(),
    listCompletedSessionActivity: vi.fn(),
    listProgressSessionActivity: vi.fn(),
    listCompletedSessionsSince: vi.fn(),
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

function makePersonalRecordRepo(
  bests: ReadonlyArray<PersonalBest>,
  /**
   * The prior-best read (M18 Slice 7), defaulting to the port's own shape for
   * "no eligible prior history": exactly one answer per candidate, all null —
   * under which every logged set is a first-exposure event. A scenario that
   * needs out-of-window priors supplies its own implementation.
   */
  findBestValuesBefore: PersonalRecordRepository['findBestValuesBefore'] = async (
    _userId,
    candidates,
  ) => candidates.map((candidate) => ({ candidate, bestBefore: null })),
) {
  return {
    findCurrentPersonalBests: vi.fn().mockResolvedValue(bests),
    findCurrentPersonalBestsSetBetween: vi.fn(),
    findBestValuesBefore: vi.fn(findBestValuesBefore),
  } satisfies PersonalRecordRepository;
}

/** The logged-set identity of one candidate — what a prior-best stub keys on. */
function setKey(candidate: RecordCandidate): string {
  const { sessionId, exerciseOrder, setNumber } = candidate.position;
  return `${sessionId}#${exerciseOrder}#${setNumber}`;
}

/**
 * Prior bests keyed by the candidate's own logged set, so the stub is
 * order-independent and the resolved events depend only on the scenario.
 */
function priorBestsAt(
  bestBySet: ReadonlyMap<string, number | null>,
): (userId: UserId, candidates: ReadonlyArray<RecordCandidate>) => Promise<CandidatePriorBest[]> {
  return async (_userId, candidates) =>
    candidates.map((candidate) => ({
      candidate,
      bestBefore: bestBySet.get(setKey(candidate)) ?? null,
    }));
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
      makePersonalRecordRepo([]),
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
    const uc = new GetExerciseHistoryUseCase(historyRepo, makeExerciseRepo(null), makePersonalRecordRepo([]));

    const result = await uc.execute({ userId: 'user-a', slug: 'unknown-exercise' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('EXERCISE_NOT_FOUND');
    expect(historyRepo.listCompletedExerciseOccurrences).not.toHaveBeenCalled();
  });

  it('rejects an invalid userId with INVALID_INPUT before touching repositories', async () => {
    const historyRepo = makeHistoryRepo([]);
    const exerciseRepo = makeExerciseRepo(makeExercise('ex-001', 'goblet-squat'));
    const uc = new GetExerciseHistoryUseCase(historyRepo, exerciseRepo, makePersonalRecordRepo([]));

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
      makePersonalRecordRepo([]),
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
      makePersonalRecordRepo([]),
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
      makePersonalRecordRepo([]),
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
      makePersonalRecordRepo([]),
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
      makePersonalRecordRepo([]),
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
      makePersonalRecordRepo([]),
    );

    const result = await uc.execute({ userId: 'user-a', slug: 'goblet-squat' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.trend).toEqual([
      {
        sessionId: 'session-old',
        exerciseOrder: 1,
        completedAt: '2026-01-01T10:00:00.000Z',
        workingLoadKg: 50,
        recordKg: 50,
      },
      {
        sessionId: 'session-new',
        exerciseOrder: 1,
        completedAt: '2026-03-01T10:00:00.000Z',
        workingLoadKg: 55,
        recordKg: 55,
      },
    ]);
  });
});

// ─── M12 records read ────────────────────────────────────────────────────────

function personalBest(overrides?: Partial<PersonalBest>): PersonalBest {
  return {
    exerciseId: eid('ex-001'),
    metric: RecordMetric.MaxLoad,
    value: 82.5,
    position: {
      completedAt: new Date('2026-02-15T11:00:00Z'),
      startedAt: new Date('2026-02-15T10:00:00Z'),
      sessionId: sid('session-owner'),
      exerciseOrder: 2,
      setNumber: 1,
    },
    ...overrides,
  };
}

describe('GetExerciseHistoryUseCase — personal bests (M12)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('queries the records for the RESOLVED ExerciseId of the requested slug', async () => {
    const recordsRepo = makePersonalRecordRepo([]);
    const uc = new GetExerciseHistoryUseCase(
      makeHistoryRepo([]),
      makeExerciseRepo(makeExercise('ex-007', 'goblet-squat')),
      recordsRepo,
    );

    await uc.execute({ userId: 'user-a', slug: 'goblet-squat' });

    expect(recordsRepo.findCurrentPersonalBests).toHaveBeenCalledWith(uid('user-a'), [
      eid('ex-007'),
    ]);
  });

  it('maps the repository’s records into the DTO, preserving the delivered order and owner', async () => {
    const recordsRepo = makePersonalRecordRepo([
      personalBest({ metric: RecordMetric.MaxBodyweightReps, value: 18 }),
      personalBest({ metric: RecordMetric.MaxLoad, value: 82.5 }),
    ]);
    const uc = new GetExerciseHistoryUseCase(
      makeHistoryRepo([]),
      makeExerciseRepo(makeExercise('ex-001', 'goblet-squat')),
      recordsRepo,
    );

    const result = await uc.execute({ userId: 'user-a', slug: 'goblet-squat' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Repository order is the DTO order — never re-sorted here.
    expect(result.data.personalBests).toEqual([
      {
        exerciseId: 'ex-001',
        metric: 'max-bodyweight-reps',
        value: 18,
        sessionId: 'session-owner',
        exerciseOrder: 2,
        setNumber: 1,
        completedAt: '2026-02-15T11:00:00.000Z',
      },
      {
        exerciseId: 'ex-001',
        metric: 'max-load',
        value: 82.5,
        sessionId: 'session-owner',
        exerciseOrder: 2,
        setNumber: 1,
        completedAt: '2026-02-15T11:00:00.000Z',
      },
    ]);
  });

  it('treats an empty repository result as success with no personal bests', async () => {
    const uc = new GetExerciseHistoryUseCase(
      makeHistoryRepo([]),
      makeExerciseRepo(makeExercise('ex-001', 'goblet-squat')),
      makePersonalRecordRepo([]),
    );

    const result = await uc.execute({ userId: 'user-a', slug: 'goblet-squat' });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.personalBests).toEqual([]);
    expect(result.data.entries).toEqual([]);
  });

  it('does not query records for an unknown slug', async () => {
    const recordsRepo = makePersonalRecordRepo([]);
    const uc = new GetExerciseHistoryUseCase(
      makeHistoryRepo([]),
      makeExerciseRepo(null),
      recordsRepo,
    );

    const result = await uc.execute({ userId: 'user-a', slug: 'unknown-exercise' });

    expect(result.ok).toBe(false);
    expect(recordsRepo.findCurrentPersonalBests).not.toHaveBeenCalled();
  });

  it('does not query records for a malformed userId', async () => {
    const recordsRepo = makePersonalRecordRepo([]);
    const uc = new GetExerciseHistoryUseCase(
      makeHistoryRepo([]),
      makeExerciseRepo(makeExercise('ex-001', 'goblet-squat')),
      recordsRepo,
    );

    const result = await uc.execute({ userId: ' ', slug: 'goblet-squat' });

    expect(result.ok).toBe(false);
    expect(recordsRepo.findCurrentPersonalBests).not.toHaveBeenCalled();
  });

  it('leaves the occurrence read and trend unchanged when records exist', async () => {
    const occurrences = [
      occurrence('session-new', 1, '2026-03-01T10:00:00Z', [{ reps: 10, weightKg: 55 }]),
      occurrence('session-old', 1, '2026-01-01T10:00:00Z', [{ reps: 10, weightKg: 50 }]),
    ];
    const historyRepo = makeHistoryRepo(occurrences);
    const uc = new GetExerciseHistoryUseCase(
      historyRepo,
      makeExerciseRepo(makeExercise('ex-001', 'goblet-squat')),
      makePersonalRecordRepo([personalBest({ value: 60 })]),
    );

    const result = await uc.execute({ userId: 'user-a', slug: 'goblet-squat' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // The bounded occurrence window, its ordering, and the trend still come
    // from the history port alone.
    expect(historyRepo.listCompletedExerciseOccurrences).toHaveBeenCalledWith(
      uid('user-a'),
      eid('ex-001'),
      EXERCISE_HISTORY_OCCURRENCE_LIMIT,
    );
    expect(result.data.entries.map((entry) => entry.sessionId)).toEqual([
      'session-new',
      'session-old',
    ]);
    expect(result.data.trend.map((point) => point.workingLoadKg)).toEqual([50, 55]);
    expect(result.data.personalBests.map((record) => record.value)).toEqual([60]);
  });
});

/**
 * M18 Slice 7 — historical max-load PR markers on the exercise trend
 * (`docs/training-progress.md` §8.6, acceptance datasets J and Q).
 *
 * The candidate extraction and the event resolution are the M12 pipeline
 * verbatim; the stub supplies a scenario's prior bests, so what these tests
 * observe is the REAL Domain strictness rule (strict-greater only), projected
 * onto occurrence identities.
 */
describe('GetExerciseHistoryUseCase — max-load record markers (M18 Slice 7)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function markers(priorBests: ReadonlyMap<string, number | null>) {
    return makePersonalRecordRepo([], priorBestsAt(priorBests));
  }

  function useCaseFor(
    occurrences: ReadonlyArray<CompletedExerciseOccurrence>,
    recordsRepo: ReturnType<typeof makePersonalRecordRepo>,
  ) {
    return new GetExerciseHistoryUseCase(
      makeHistoryRepo(occurrences),
      makeExerciseRepo(makeExercise('ex-001', 'goblet-squat')),
      recordsRepo,
    );
  }

  it('dataset Q: an out-of-window prior gates 27.5 and the equal 30, so only 32.5 is marked', async () => {
    const occurrences = [
      occurrence('session-32.5', 1, '2026-09-01T10:00:00Z', [{ reps: 8, weightKg: 32.5 }]),
      occurrence('session-30', 1, '2026-08-01T10:00:00Z', [{ reps: 8, weightKg: 30 }]),
      occurrence('session-27.5', 1, '2026-07-01T10:00:00Z', [{ reps: 8, weightKg: 27.5 }]),
    ];
    // The exercise's all-time best before these workouts is 30 kg, logged
    // outside the displayed window — invisible in the rows, decisive here.
    const recordsRepo = markers(
      new Map([
        ['session-27.5#1#1', 30],
        ['session-30#1#1', 30],
        ['session-32.5#1#1', 30],
      ]),
    );
    const uc = useCaseFor(occurrences, recordsRepo);

    const result = await uc.execute({ userId: 'user-a', slug: 'goblet-squat' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // The trend is chronological (oldest → newest) and only the strictly
    // greater 32.5 workout carries a record marker.
    expect(result.data.trend.map((point) => point.workingLoadKg)).toEqual([27.5, 30, 32.5]);
    expect(result.data.trend.map((point) => point.recordKg)).toEqual([null, null, 32.5]);
  });

  it('marks a first-ever eligible max-load occurrence (no prior history at all)', async () => {
    const occurrences = [
      occurrence('session-first', 1, '2026-09-01T10:00:00Z', [{ reps: 10, weightKg: 0 }]),
    ];
    const uc = useCaseFor(occurrences, markers(new Map()));

    const result = await uc.execute({ userId: 'user-a', slug: 'goblet-squat' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // A logged 0 kg is a real external load, so it is an eligible first
    // exposure — and a record.
    expect(result.data.trend).toHaveLength(1);
    expect(result.data.trend[0]?.recordKg).toBe(0);
  });

  it('never marks an unloaded occurrence, even when its own event is a first exposure', async () => {
    const occurrences = [
      occurrence('session-bodyweight', 1, '2026-09-01T10:00:00Z', [
        { reps: 12, weightKg: null },
      ]),
      occurrence('session-duration', 1, '2026-08-01T10:00:00Z', [
        { type: 'duration', durationSeconds: 45 },
      ]),
    ];
    const recordsRepo = markers(new Map());
    const uc = useCaseFor(occurrences, recordsRepo);

    const result = await uc.execute({ userId: 'user-a', slug: 'goblet-squat' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Both occurrences resolve as events (bodyweight-reps and duration), and
    // neither may mark a trend point: those metrics have no externally loaded
    // point to mark (§8.6). They produce no trend point at all.
    const candidates = recordsRepo.findBestValuesBefore.mock.calls[0]?.[1] ?? [];
    expect(candidates.map((candidate) => candidate.metric).sort()).toEqual([
      'max-bodyweight-reps',
      'max-duration',
    ]);
    expect(result.data.trend).toEqual([]);
    expect(result.data.entries.every((entry) => entry.workingLoadKg === null)).toBe(true);
  });

  it('keeps multiple sets of one occurrence as ONE marker carrying the heaviest event', async () => {
    const occurrences = [
      occurrence('session-multi', 1, '2026-09-01T10:00:00Z', [
        { reps: 8, weightKg: 30 },
        { reps: 5, weightKg: 45 },
      ]),
    ];
    // Both sets strictly exceed their priors, so both are events; they share
    // one occurrence identity, which therefore carries the heaviest of them.
    const uc = useCaseFor(
      occurrences,
      markers(
        new Map([
          ['session-multi#1#1', null],
          ['session-multi#1#2', 30],
        ]),
      ),
    );

    const result = await uc.execute({ userId: 'user-a', slug: 'goblet-squat' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.trend).toHaveLength(1);
    expect(result.data.trend[0]?.recordKg).toBe(45);
    // The plotted working load stays the occurrence's own minimum — the marker
    // carries the record set, never a rewritten plot.
    expect(result.data.trend[0]?.workingLoadKg).toBe(30);
  });

  it('keys markers on (sessionId, exerciseOrder): two occurrences in one session stay distinct', async () => {
    const occurrences = [
      occurrence('session-dup', 2, '2026-09-01T10:00:00Z', [{ reps: 8, weightKg: 35 }]),
      occurrence('session-dup', 1, '2026-09-01T10:00:00Z', [{ reps: 8, weightKg: 35 }]),
    ];
    // The later position repeats the earlier occurrence's value: equal is not
    // strictly greater, so the earliest equal set keeps the record and only
    // occurrence 1 is marked (M12 earliest-equal ownership) — even though both
    // occurrences are the SAME exercise inside the SAME session.
    const uc = useCaseFor(
      occurrences,
      markers(
        new Map([
          ['session-dup#1#1', null],
          ['session-dup#2#1', 35],
        ]),
      ),
    );

    const result = await uc.execute({ userId: 'user-a', slug: 'goblet-squat' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.trend.map((point) => `${point.sessionId}#${point.exerciseOrder}`)).toEqual([
      'session-dup#1',
      'session-dup#2',
    ]);
    expect(result.data.trend.map((point) => point.recordKg)).toEqual([35, null]);
  });

  it('attributes every candidate to the RESOLVED (performed) exercise of the slug', async () => {
    // A substituted occurrence reaches this read already addressed to its
    // PERFORMED exercise id (the query filters on exercise_id, which persists
    // the performed id), so its sets are attributed to the resolved exercise
    // and never to the authored one (memo §9, dataset J).
    const occurrences = [
      occurrence('session-sub', 1, '2026-09-01T10:00:00Z', [{ reps: 8, weightKg: 24 }]),
    ];
    const recordsRepo = markers(new Map([['session-sub#1#1', null]]));
    const uc = useCaseFor(occurrences, recordsRepo);

    const result = await uc.execute({ userId: 'user-a', slug: 'goblet-squat' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const candidates = recordsRepo.findBestValuesBefore.mock.calls[0]?.[1] ?? [];
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.exerciseId).toBe(eid('ex-001'));
    expect(candidates[0]?.position.sessionId).toBe(sid('session-sub'));
    expect(result.data.trend[0]?.recordKg).toBe(24);
  });

  it('reads prior bests in ONE batched user-global call over every window set', async () => {
    const occurrences = [
      occurrence('session-a', 1, '2026-09-02T10:00:00Z', [
        { reps: 8, weightKg: 30 },
        { reps: 8, weightKg: 32.5 },
      ]),
      occurrence('session-b', 1, '2026-09-01T10:00:00Z', [{ reps: 8, weightKg: 20 }]),
    ];
    const recordsRepo = markers(new Map());
    const uc = useCaseFor(occurrences, recordsRepo);

    await uc.execute({ userId: 'user-a', slug: 'goblet-squat' });

    // One round trip, the user id plus the candidate collection — no window,
    // page size or per-occurrence call: the exactness contract is the port's.
    expect(recordsRepo.findBestValuesBefore).toHaveBeenCalledTimes(1);
    expect(recordsRepo.findBestValuesBefore.mock.calls[0]).toHaveLength(2);
    expect(recordsRepo.findBestValuesBefore.mock.calls[0]?.[0]).toBe(uid('user-a'));
    expect(recordsRepo.findBestValuesBefore.mock.calls[0]?.[1]).toHaveLength(3);
  });

  it('skips the prior-best read entirely when the window holds no logged set', async () => {
    const recordsRepo = markers(new Map());
    const uc = useCaseFor([], recordsRepo);

    const result = await uc.execute({ userId: 'user-a', slug: 'goblet-squat' });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(recordsRepo.findBestValuesBefore).not.toHaveBeenCalled();
    expect(result.data.trend).toEqual([]);
  });

  it('leaves the trend and the personal-best cards untouched by the marker read', async () => {
    const occurrences = [
      occurrence('session-new', 1, '2026-09-02T10:00:00Z', [{ reps: 10, weightKg: 55 }]),
      occurrence('session-old', 1, '2026-09-01T10:00:00Z', [{ reps: 10, weightKg: 50 }]),
    ];
    const recordsRepo = makePersonalRecordRepo(
      [personalBest({ value: 60 })],
      priorBestsAt(
        new Map([
          ['session-old#1#1', null],
          ['session-new#1#1', 50],
        ]),
      ),
    );
    const uc = useCaseFor(occurrences, recordsRepo);

    const result = await uc.execute({ userId: 'user-a', slug: 'goblet-squat' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Entry order, plotted loads and the M12 cards are exactly as before the
    // marker read existed; only the record facts are new.
    expect(result.data.entries.map((entry) => entry.sessionId)).toEqual([
      'session-new',
      'session-old',
    ]);
    expect(result.data.trend.map((point) => point.workingLoadKg)).toEqual([50, 55]);
    expect(result.data.personalBests.map((record) => record.value)).toEqual([60]);
    expect(result.data.trend.map((point) => point.recordKg)).toEqual([50, 55]);
  });
});

