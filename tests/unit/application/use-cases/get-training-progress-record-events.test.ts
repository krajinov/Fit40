/**
 * M18 Slice 5 — GetTrainingProgressRecordEventsUseCase orchestration.
 *
 * The ports are stubbed, so these tests observe the orchestration contract:
 * candidate origin is the horizon, prior-best evaluation is user-global, the
 * M12 pipeline is called with EVERY candidate (no cap) in ONE batched read, the
 * exact count is computed before the newest-N display selection, still-stands
 * is resolved by position ownership, and a catalog miss omits a row without
 * changing the count. Datasets D and E from the memo's matrix are pinned here.
 */

import { describe, expect, it, vi } from 'vitest';

import { PROGRESS_RECORD_EVENT_LIMIT } from '@/application/dto/training-progress';
import type { ExerciseRepository } from '@/application/ports/exercise-repository';
import type { PersonalRecordRepository } from '@/application/ports/personal-record-repository';
import type {
  CompletedWorkoutSession,
  TrainingHistoryRepository,
} from '@/application/ports/training-history-repository';
import { GetTrainingProgressRecordEventsUseCase } from '@/application/use-cases/get-training-progress-record-events';
import {
  completeWorkoutSession,
  createWorkoutSession,
  logSessionSet,
} from '@/domain/entities/workout-session';
import { createExercise, type Exercise } from '@/domain/entities/exercise';
import type { RecordCandidate } from '@/domain/services/personal-record-metrics';
import { RecordMetric } from '@/domain/services/personal-record-metrics';
import type { CandidatePriorBest, PersonalBest } from '@/domain/services/personal-records';
import {
  Difficulty,
  EquipmentType,
  MovementPattern,
  MuscleGroup,
} from '@/domain/types/exercise';
import {
  createExerciseId,
  createScheduledWorkoutId,
  createUserId,
  createWorkoutId,
  createWorkoutSessionId,
  type ExerciseId,
  type ScheduledWorkoutId,
  type UserId,
  type WorkoutId,
  type WorkoutSessionId,
} from '@/domain/types/ids';
import { createRepScheme, type RepPrescription } from '@/domain/value-objects/rep-prescription';

/** A Thursday: the current UTC week starts 2026-09-21. */
const NOW = new Date('2026-09-24T10:00:00.000Z');
/** The oldest of the 13 windows: 2026-09-21 minus twelve weeks. */
const OLDEST_WEEK_START = '2026-06-29T00:00:00.000Z';

function eid(value: string): ExerciseId {
  const result = createExerciseId(value);
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

function sid(value: string): WorkoutSessionId {
  const result = createWorkoutSessionId(value);
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

function prescription(): RepPrescription {
  const result = createRepScheme(1, 1, 20);
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

function uid(value: string): UserId {
  const result = createUserId(value);
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

function swid(value: string): ScheduledWorkoutId {
  const result = createScheduledWorkoutId(value);
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

function wid(value: string): WorkoutId {
  const result = createWorkoutId(value);
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

interface SetSpec {
  readonly exerciseId: string;
  /** The performed exercise when substituted; authored stays `exerciseId`. */
  readonly performedExerciseId?: string;
  readonly reps: number;
  readonly weightKg: number;
}

/** One completed session with one occurrence per set spec, in given order. */
function session(
  id: string,
  completedAt: string,
  logs: ReadonlyArray<SetSpec>,
): CompletedWorkoutSession {
  const created = createWorkoutSession({
    id,
    userId: uid('user-progress-records'),
    enrollmentId: null,
    scheduledWorkoutId: swid(`${id}-sw`),
    workoutId: wid(`${id}-wo`),
    startedAt: new Date(new Date(completedAt).getTime() - 3_600_000),
    exerciseLogs: logs.map((log, index) => ({
      authoredExerciseId: eid(log.exerciseId),
      performedExerciseId: eid(log.performedExerciseId ?? log.exerciseId),
      order: index + 1,
      prescription: prescription(),
      restSeconds: 60,
    })),
  });
  if (created.ok === false) throw new Error(created.error.message);

  let current = created.data;
  for (const [index, log] of logs.entries()) {
    const logged = logSessionSet(current, {
      exerciseOrder: index + 1,
      type: 'reps',
      reps: log.reps,
      weightKg: log.weightKg,
      rpe: null,
    });
    if (logged.ok === false) throw new Error(logged.error.message);
    current = logged.data;
  }

  const completed = completeWorkoutSession(current, new Date(completedAt));
  if (completed.ok === false) throw new Error(completed.error.message);
  // The completed-only narrowing every read path applies.
  return { ...completed.data, completedAt: new Date(completedAt) };
}

/** The ownership key of one logged set — what still-stands compares. */
function setKey(key: {
  readonly sessionId: string;
  readonly exerciseOrder: number;
  readonly setNumber: number;
}): string {
  return `${key.sessionId}#${key.exerciseOrder}#${key.setNumber}`;
}

/** A current best owned by an exact logged set. */
function best(input: {
  readonly exerciseId: string;
  readonly value: number;
  readonly sessionId: string;
  readonly exerciseOrder?: number;
  readonly setNumber?: number;
  readonly metric?: RecordMetric;
  readonly completedAt?: string;
}): PersonalBest {
  const completedAt = new Date(input.completedAt ?? '2026-08-26T10:00:00.000Z');
  return {
    exerciseId: eid(input.exerciseId),
    metric: input.metric ?? RecordMetric.MaxLoad,
    value: input.value,
    position: {
      completedAt,
      startedAt: completedAt,
      sessionId: sid(input.sessionId),
      exerciseOrder: input.exerciseOrder ?? 1,
      setNumber: input.setNumber ?? 1,
    },
  };
}

/** A real catalog entity, so the DTO mapping is exercised, not bypassed. */
function catalogExercise(id: string, name: string, slug: string): Exercise {
  const created = createExercise({
    id,
    name,
    slug,
    description: `${name} description`,
    primaryMuscle: MuscleGroup.Quadriceps,
    secondaryMuscles: [MuscleGroup.Glutes],
    equipment: EquipmentType.Dumbbell,
    difficulty: Difficulty.Beginner,
    movementPattern: MovementPattern.Squat,
    considerations: [],
  });
  if (!created.ok) throw new Error(created.error.message);
  return created.data;
}

function makeDeps() {
  const listSessions = vi
    .fn<TrainingHistoryRepository['listCompletedSessionsSince']>()
    .mockResolvedValue([]);
  const findBestValuesBefore = vi
    .fn<PersonalRecordRepository['findBestValuesBefore']>()
    .mockResolvedValue([]);
  const findCurrentPersonalBests = vi
    .fn<PersonalRecordRepository['findCurrentPersonalBests']>()
    .mockResolvedValue([]);
  const findByIds = vi.fn<ExerciseRepository['findByIds']>().mockResolvedValue([]);

  const history = {
    listCompletedSessions: vi.fn(),
    listCompletedExerciseOccurrences: vi.fn(),
    listCompletedExerciseOccurrencesSince: vi.fn(),
    listRecentCompletedExercisePerformances: vi.fn(),
    listCompletedSessionActivity: vi.fn(),
    listProgressSessionActivity: vi.fn(),
    listCompletedSessionsSince: listSessions,
    getTotals: vi.fn(),
    findCompletedSessionById: vi.fn(),
  } satisfies TrainingHistoryRepository;

  const records = {
    findCurrentPersonalBests,
    findCurrentPersonalBestsSetBetween: vi.fn(),
    findBestValuesBefore,
  } satisfies PersonalRecordRepository;

  const exercises = {
    list: vi.fn(),
    findBySlug: vi.fn(),
    findByIds,
  } satisfies ExerciseRepository;

  return {
    listSessions,
    findBestValuesBefore,
    findCurrentPersonalBests,
    findByIds,
    useCase: new GetTrainingProgressRecordEventsUseCase(history, records, exercises),
  };
}

/**
 * Prior bests keyed by the candidate's own logged set, so the stub is
 * order-independent: shuffling the candidate input cannot change an answer.
 */
function priorBestsAt(
  bestBySet: ReadonlyMap<string, number | null>,
): (userId: UserId, candidates: ReadonlyArray<RecordCandidate>) => Promise<CandidatePriorBest[]> {
  return async (_userId, candidates) =>
    candidates.map((candidate) => ({
      candidate,
      bestBefore: bestBySet.get(setKey(candidate.position)) ?? null,
    }));
}

const GOBLET = 'ex-002';
const SPLIT = 'ex-003';

/** The horizon's oldest instant — the inclusive bound the use case must pass. */
const SINCE = new Date(OLDEST_WEEK_START);

describe('GetTrainingProgressRecordEventsUseCase — datasets D and E', () => {
  it.each([
    ['2026-09-27T23:59:59.999Z', '2026-06-29T00:00:00.000Z', '2026-09-28T00:00:00.000Z'],
    ['2026-09-28T00:00:00.000Z', '2026-07-06T00:00:00.000Z', '2026-10-05T00:00:00.000Z'],
  ])('forwards request period bounds for %s', async (instant, start, end) => {
    const deps = makeDeps();
    await deps.useCase.execute({ userId: 'user-a', now: new Date(instant) });
    expect(deps.listSessions.mock.calls[0]?.slice(1)).toEqual([new Date(start), new Date(end)]);
  });

  it('reports only in-horizon events, gated by user-global priors (D)', async () => {
    const deps = makeDeps();
    const early = session('d-22-w6', '2026-08-05T09:00:00.000Z', [
      { exerciseId: GOBLET, reps: 8, weightKg: 22.5 },
    ]);
    const equal = session('d-22-w8', '2026-08-19T09:00:00.000Z', [
      { exerciseId: GOBLET, reps: 8, weightKg: 22.5 },
    ]);
    const heavy = session('d-25-w9', '2026-08-26T09:00:00.000Z', [
      { exerciseId: GOBLET, reps: 8, weightKg: 25 },
    ]);
    deps.listSessions.mockResolvedValue([early, equal, heavy]);
    // 20 kg was established OUTSIDE the horizon; the equal 22.5 keeps the
    // earlier event's ownership, so the second 22.5 is not a new event.
    deps.findBestValuesBefore.mockImplementation(
      priorBestsAt(
        new Map([
          ['d-22-w6#1#1', 20],
          ['d-22-w8#1#1', 22.5],
          ['d-25-w9#1#1', 22.5],
        ]),
      ),
    );
    deps.findCurrentPersonalBests.mockResolvedValue([
      best({ exerciseId: GOBLET, value: 25, sessionId: 'd-25-w9' }),
    ]);
    deps.findByIds.mockResolvedValue([
      catalogExercise(GOBLET, 'Goblet Squat', 'goblet-squat'),
    ]);

    const result = await deps.useCase.execute({ userId: 'user-a', now: NOW });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Candidate origin: ONE bounded horizon read, bound by the inclusive
    // oldest-window instant.
    expect(deps.listSessions).toHaveBeenCalledTimes(1);
    expect(String(deps.listSessions.mock.calls[0]?.[0])).toBe('user-a');
    expect(deps.listSessions.mock.calls[0]?.[1]).toEqual(SINCE);
    expect(deps.listSessions.mock.calls[0]?.[2]).toEqual(new Date('2026-09-28T00:00:00.000Z'));

    // Every candidate reached ONE batched prior-best read — no cap, no page.
    expect(deps.findBestValuesBefore).toHaveBeenCalledTimes(1);
    expect(deps.findBestValuesBefore.mock.calls[0]?.[1]).toHaveLength(3);

    expect(result.data.recordEventCount).toBe(2);
    expect(result.data.events.map((event) => `${event.value}<-${event.previousBest}`)).toEqual([
      '22.5<-20',
      '25<-22.5',
    ]);
    expect(result.data.events.map((event) => event.sessionId)).toEqual(['d-22-w6', 'd-25-w9']);
    // Still-stands by position ownership: the older event was surpassed.
    expect(result.data.events.map((event) => event.stillStanding)).toEqual([false, true]);
    expect(result.data.events[0]?.exerciseName).toBe('Goblet Squat');
    expect(result.data.events[0]?.exerciseSlug).toBe('goblet-squat');
    expect(result.data.events[0]?.metric).toBe('max-load');
    expect(result.data.events[0]?.completedAt).toBe('2026-08-05T09:00:00.000Z');
  });

  it('reports a first exposure with no prior best, standing (E)', async () => {
    const deps = makeDeps();
    deps.listSessions.mockResolvedValue([
      session('e-first', '2026-08-12T09:00:00.000Z', [
        { exerciseId: GOBLET, reps: 10, weightKg: 12.5 },
      ]),
    ]);
    deps.findBestValuesBefore.mockImplementation(priorBestsAt(new Map([['e-first#1#1', null]])));
    deps.findCurrentPersonalBests.mockResolvedValue([
      best({ exerciseId: GOBLET, value: 12.5, sessionId: 'e-first' }),
    ]);
    deps.findByIds.mockResolvedValue([
      catalogExercise(GOBLET, 'Goblet Squat', 'goblet-squat'),
    ]);

    const result = await deps.useCase.execute({ userId: 'user-a', now: NOW });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.recordEventCount).toBe(1);
    expect(result.data.events[0]?.previousBest).toBeNull();
    expect(result.data.events[0]?.stillStanding).toBe(true);
  });
});

describe('GetTrainingProgressRecordEventsUseCase — exact count and display selection', () => {
  it('computes the exact count before the newest-N display (12 events → count 12, list 10)', async () => {
    const deps = makeDeps();
    const loads = [20, 22.5, 25, 27.5, 30, 32.5, 35, 37.5, 40, 42.5, 45, 47.5];
    const horizonStartMs = Date.parse(OLDEST_WEEK_START);
    const sessions = loads.map((load, index) =>
      session(
        `cap-${index}`,
        new Date(horizonStartMs + index * 86_400_000 + 9 * 3_600_000).toISOString(),
        [{ exerciseId: GOBLET, reps: 8, weightKg: load }],
      ),
    );
    deps.listSessions.mockResolvedValue(sessions);
    deps.findBestValuesBefore.mockImplementation(
      priorBestsAt(
        new Map(
          loads.map((_load, index) => [
            `cap-${index}#1#1`,
            index === 0 ? null : (loads[index - 1] ?? null),
          ]),
        ),
      ),
    );
    deps.findCurrentPersonalBests.mockResolvedValue([
      best({ exerciseId: GOBLET, value: 47.5, sessionId: 'cap-11' }),
    ]);
    deps.findByIds.mockResolvedValue([
      catalogExercise(GOBLET, 'Goblet Squat', 'goblet-squat'),
    ]);

    const result = await deps.useCase.execute({ userId: 'user-a', now: NOW });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(PROGRESS_RECORD_EVENT_LIMIT).toBe(10);
    // Every candidate reached the batched read; the count is exact.
    expect(deps.findBestValuesBefore.mock.calls[0]?.[1]).toHaveLength(12);
    expect(result.data.recordEventCount).toBe(12);
    expect(result.data.events).toHaveLength(10);
    // The NEWEST ten, presented ascending: the oldest two events are dropped.
    expect(result.data.events[0]?.value).toBe(25);
    expect(result.data.events.at(-1)?.value).toBe(47.5);
    // Display identity is ONE batched read for the displayed exercise only.
    expect(deps.findCurrentPersonalBests).toHaveBeenCalledTimes(1);
    expect((deps.findCurrentPersonalBests.mock.calls[0]?.[1] ?? []).map(String)).toEqual([GOBLET]);
  });

  it('omits catalog-unresolved events from the list without changing the count', async () => {
    const deps = makeDeps();
    deps.listSessions.mockResolvedValue([
      session('u-goblet', '2026-07-01T09:00:00.000Z', [
        { exerciseId: GOBLET, reps: 8, weightKg: 22.5 },
      ]),
      session('u-missing', '2026-07-08T09:00:00.000Z', [
        { exerciseId: SPLIT, reps: 8, weightKg: 30 },
      ]),
    ]);
    deps.findBestValuesBefore.mockImplementation(
      priorBestsAt(
        new Map([
          ['u-goblet#1#1', null],
          ['u-missing#1#1', null],
        ]),
      ),
    );
    deps.findByIds.mockResolvedValue([
      catalogExercise(GOBLET, 'Goblet Squat', 'goblet-squat'),
    ]);

    const result = await deps.useCase.execute({ userId: 'user-a', now: NOW });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.recordEventCount).toBe(2);
    expect(result.data.events).toHaveLength(1);
    expect(result.data.events[0]?.exerciseId).toBe(GOBLET);
  });
});

describe('GetTrainingProgressRecordEventsUseCase — empty, invalid and ownership rules', () => {
  it('returns an empty answer without issuing any further read when nothing was logged', async () => {
    const deps = makeDeps();
    deps.listSessions.mockResolvedValue([]);

    const result = await deps.useCase.execute({ userId: 'user-a', now: NOW });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toEqual({ recordEventCount: 0, events: [] });
    expect(deps.findBestValuesBefore).not.toHaveBeenCalled();
    expect(deps.findCurrentPersonalBests).not.toHaveBeenCalled();
    expect(deps.findByIds).not.toHaveBeenCalled();
  });

  it('rejects a malformed userId before touching any port', async () => {
    const deps = makeDeps();

    const result = await deps.useCase.execute({ userId: '  ', now: NOW });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('INVALID_INPUT');
    expect(result.error.field).toBe('userId');
    expect(deps.listSessions).not.toHaveBeenCalled();
  });

  it('never claims an event still stands from value equality alone', async () => {
    const deps = makeDeps();
    deps.listSessions.mockResolvedValue([
      session('o-event', '2026-08-12T09:00:00.000Z', [
        { exerciseId: GOBLET, reps: 8, weightKg: 25 },
      ]),
    ]);
    deps.findBestValuesBefore.mockImplementation(priorBestsAt(new Map([['o-event#1#1', null]])));
    // A synthetic state the strict-greater rule cannot itself produce among
    // events: a best with the SAME value owned by a different logged set. The
    // answer must come from position ownership, never from comparing values.
    deps.findCurrentPersonalBests.mockResolvedValue([
      best({ exerciseId: GOBLET, value: 25, sessionId: 'another-session' }),
    ]);
    deps.findByIds.mockResolvedValue([
      catalogExercise(GOBLET, 'Goblet Squat', 'goblet-squat'),
    ]);

    const result = await deps.useCase.execute({ userId: 'user-a', now: NOW });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.events[0]?.value).toBe(25);
    expect(result.data.events[0]?.stillStanding).toBe(false);
  });

  it('resolves same-session events by position, and the earliest equal set owns the best', async () => {
    const deps = makeDeps();
    deps.listSessions.mockResolvedValue([
      session('o-same', '2026-08-12T09:00:00.000Z', [
        { exerciseId: GOBLET, reps: 8, weightKg: 20 },
        { exerciseId: GOBLET, reps: 8, weightKg: 25 },
        // A repeat of the maximum inside the same session: equal is not
        // strictly greater, so it establishes no event of its own.
        { exerciseId: GOBLET, reps: 8, weightKg: 25 },
      ]),
    ]);
    // Two events in ONE session, separated only by their positions: the second
    // set strictly exceeds the first, so it is an event while the third is not.
    deps.findBestValuesBefore.mockImplementation(
      priorBestsAt(
        new Map([
          ['o-same#1#1', null],
          ['o-same#2#1', 20],
          ['o-same#3#1', 25],
        ]),
      ),
    );
    // Earliest-equal ownership: the best is owned by the SECOND set, not by the
    // later equal third set.
    deps.findCurrentPersonalBests.mockResolvedValue([
      best({ exerciseId: GOBLET, value: 25, sessionId: 'o-same', exerciseOrder: 2 }),
    ]);
    deps.findByIds.mockResolvedValue([
      catalogExercise(GOBLET, 'Goblet Squat', 'goblet-squat'),
    ]);

    const result = await deps.useCase.execute({ userId: 'user-a', now: NOW });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.recordEventCount).toBe(2);
    // Same session, different positions: the earlier event is since surpassed
    // and only the owning final PR position still stands. A session-identity
    // comparison would wrongly keep both standing.
    expect(result.data.events.map((event) => event.sessionId)).toEqual(['o-same', 'o-same']);
    expect(result.data.events.map((event) => [event.value, event.stillStanding])).toEqual([
      [20, false],
      [25, true],
    ]);
  });

  it('never claims an event still stands when a later equal position owns the best', async () => {
    const deps = makeDeps();
    deps.listSessions.mockResolvedValue([
      session('o-tie', '2026-08-12T09:00:00.000Z', [
        { exerciseId: GOBLET, reps: 8, weightKg: 20 },
        { exerciseId: GOBLET, reps: 8, weightKg: 25 },
        { exerciseId: GOBLET, reps: 8, weightKg: 25 },
      ]),
    ]);
    deps.findBestValuesBefore.mockImplementation(
      priorBestsAt(
        new Map([
          ['o-tie#1#1', null],
          ['o-tie#2#1', 20],
          ['o-tie#3#1', 25],
        ]),
      ),
    );
    // A synthetic state the strict-greater rule cannot itself produce: the
    // LATER equal position claims the best. Ownership follows the position, so
    // neither in-session event stands — a value comparison would keep the
    // 25 kg event standing, and a session-only comparison would keep both.
    deps.findCurrentPersonalBests.mockResolvedValue([
      best({ exerciseId: GOBLET, value: 25, sessionId: 'o-tie', exerciseOrder: 3 }),
    ]);
    deps.findByIds.mockResolvedValue([
      catalogExercise(GOBLET, 'Goblet Squat', 'goblet-squat'),
    ]);

    const result = await deps.useCase.execute({ userId: 'user-a', now: NOW });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.recordEventCount).toBe(2);
    expect(result.data.events.map((event) => [event.value, event.stillStanding])).toEqual([
      [20, false],
      [25, false],
    ]);
  });

  it('credits the performed exercise of a substituted occurrence', async () => {
    const deps = makeDeps();
    deps.listSessions.mockResolvedValue([
      session('s-sub', '2026-08-12T09:00:00.000Z', [
        { exerciseId: SPLIT, performedExerciseId: GOBLET, reps: 8, weightKg: 24 },
      ]),
    ]);
    deps.findBestValuesBefore.mockImplementation(priorBestsAt(new Map([['s-sub#1#1', null]])));
    deps.findCurrentPersonalBests.mockResolvedValue([
      best({ exerciseId: GOBLET, value: 24, sessionId: 's-sub' }),
    ]);
    deps.findByIds.mockResolvedValue([
      catalogExercise(GOBLET, 'Goblet Squat', 'goblet-squat'),
    ]);

    const result = await deps.useCase.execute({ userId: 'user-a', now: NOW });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // The performed replacement owns the event; the authored exercise gets nothing.
    expect(deps.findBestValuesBefore.mock.calls[0]?.[1]?.[0]?.exerciseId).toBe(GOBLET);
    expect(result.data.events[0]?.exerciseId).toBe(GOBLET);
    expect(result.data.events[0]?.exerciseSlug).toBe('goblet-squat');
  });

  it('is order-independent: shuffling the candidate sessions changes nothing', async () => {
    const forward = makeDeps();
    const backward = makeDeps();
    const sessions = [
      session('i-1', '2026-08-05T09:00:00.000Z', [{ exerciseId: GOBLET, reps: 8, weightKg: 22.5 }]),
      session('i-2', '2026-08-19T09:00:00.000Z', [{ exerciseId: GOBLET, reps: 8, weightKg: 22.5 }]),
      session('i-3', '2026-08-26T09:00:00.000Z', [{ exerciseId: GOBLET, reps: 8, weightKg: 25 }]),
    ];
    forward.listSessions.mockResolvedValue(sessions);
    backward.listSessions.mockResolvedValue([...sessions].reverse());

    const priorMap = new Map([
      ['i-1#1#1', 20],
      ['i-2#1#1', 22.5],
      ['i-3#1#1', 22.5],
    ]);
    forward.findBestValuesBefore.mockImplementation(priorBestsAt(priorMap));
    backward.findBestValuesBefore.mockImplementation(priorBestsAt(priorMap));

    const bests = [best({ exerciseId: GOBLET, value: 25, sessionId: 'i-3' })];
    forward.findCurrentPersonalBests.mockResolvedValue(bests);
    backward.findCurrentPersonalBests.mockResolvedValue(bests);

    const catalog = [catalogExercise(GOBLET, 'Goblet Squat', 'goblet-squat')];
    forward.findByIds.mockResolvedValue(catalog);
    backward.findByIds.mockResolvedValue(catalog);

    const a = await forward.useCase.execute({ userId: 'user-a', now: NOW });
    const b = await backward.useCase.execute({ userId: 'user-a', now: NOW });

    expect(a).toEqual(b);
    expect(a.ok).toBe(true);
    if (!a.ok) return;
    expect(a.data.recordEventCount).toBe(2);
  });
});
