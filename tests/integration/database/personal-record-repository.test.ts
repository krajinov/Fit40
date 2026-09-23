import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import type { TrainingHistoryCursor } from '@/application/ports/training-history-repository';
import { GetCompletedSessionRecordEventsUseCase } from '@/application/use-cases/get-completed-session-record-events';
import { GetExerciseHistoryUseCase } from '@/application/use-cases/get-exercise-history';
import type { WorkoutSession } from '@/domain/entities/workout-session';
import { comparePerformancePositions, RecordMetric } from '@/domain/services/personal-record-metrics';
import type { PersonalBest } from '@/domain/services/personal-records';
import {
  extractRecordCandidates,
  foldPersonalRecords,
  resolveRecordEvents,
} from '@/domain/services/personal-records';
import type { ExerciseId, UserId } from '@/domain/types/ids';

import {
  createQueryCountingRepository,
  exerciseId,
  prCandidate,
  prSession,
  savePrSessions,
  seedEnrollment,
  seedUser,
  userId,
} from './personal-record-fixtures';
import {
  closeDatabase,
  exerciseRepository,
  personalRecordRepository,
  resetAndSeed,
  trainingHistoryRepository,
} from './setup';

const OWNER = 'user-pr-owner';
const OTHER = 'user-pr-other';

const EX_BENCH = 'ex-001';
const EX_GOBLET = 'ex-002';
const EX_CARRY = 'ex-009';

beforeEach(async () => {
  await resetAndSeed();
  await seedUser(OWNER);
  await seedUser(OTHER);
});

afterAll(async () => {
  await closeDatabase();
});

// ─── Projections (readable failures) ─────────────────────────────────────────

function bestLines(bests: ReadonlyArray<PersonalBest>): ReadonlyArray<string> {
  return bests.map(
    (best) =>
      `${best.exerciseId}/${best.metric}/${best.value}` +
      `@${best.position.sessionId}.${best.position.exerciseOrder}.${best.position.setNumber}`,
  );
}

function priorLines(
  prior: ReadonlyArray<{
    candidate: { metric: string; value: number };
    bestBefore: number | null;
  }>,
): ReadonlyArray<string> {
  return prior.map(
    (entry) => `${entry.candidate.metric}/${entry.candidate.value}->${entry.bestBefore ?? 'none'}`,
  );
}

function owner(): UserId {
  return userId(OWNER);
}

/**
 * Hydrates the user's full completed history through the real history read
 * port (paged), so the oracle compares the optimized projection against the
 * same facts every other read path sees.
 */
async function hydrateCompletedHistory(ownerId: UserId): Promise<ReadonlyArray<WorkoutSession>> {
  const sessions: WorkoutSession[] = [];
  let after: TrainingHistoryCursor | null = null;
  for (;;) {
    const page = await trainingHistoryRepository.listCompletedSessions(ownerId, {
      limit: 50,
      after,
    });
    for (const entry of page.entries) {
      sessions.push(entry.session);
    }
    if (page.nextAfter === null) {
      return sessions;
    }
    after = page.nextAfter;
  }
}

/** Every candidate of a hydrated history, in the Domain's chronological order. */
function candidatesOf(sessions: ReadonlyArray<WorkoutSession>) {
  return sessions
    .flatMap((session) => {
      const extracted = extractRecordCandidates(session);
      if (!extracted.ok) throw new Error(extracted.error.message);
      return [...extracted.data];
    })
    .sort((a, b) => comparePerformancePositions(a.position, b.position));
}

// ─── Current personal bests ──────────────────────────────────────────────────

describe('personal record repository — current personal bests', () => {
  it('returns the first eligible performance as the best', async () => {
    await savePrSessions(
      prSession({
        id: 'pr-first',
        userId: OWNER,
        startedAt: '2025-01-01T09:00:00Z',
        completedAt: '2025-01-01T10:00:00Z',
        logs: [{ exerciseId: EX_BENCH, type: 'reps', sets: [{ reps: 8, weightKg: 40 }] }],
      }),
    );

    const bests = await personalRecordRepository.findCurrentPersonalBests(owner(), [
      exerciseId(EX_BENCH),
    ]);

    expect(bestLines(bests)).toEqual([`${EX_BENCH}/max-load/40@pr-first.1.1`]);
  });

  it('lets a greater later performance win and a lower one lose', async () => {
    await savePrSessions(
      prSession({
        id: 'pr-early',
        userId: OWNER,
        startedAt: '2025-01-01T09:00:00Z',
        completedAt: '2025-01-01T10:00:00Z',
        logs: [{ exerciseId: EX_BENCH, type: 'reps', sets: [{ reps: 8, weightKg: 40 }] }],
      }),
      prSession({
        id: 'pr-better',
        userId: OWNER,
        occurrence: 2,
        startedAt: '2025-01-05T09:00:00Z',
        completedAt: '2025-01-05T10:00:00Z',
        logs: [{ exerciseId: EX_BENCH, type: 'reps', sets: [{ reps: 8, weightKg: 55.5 }] }],
      }),
      prSession({
        id: 'pr-lower',
        userId: OWNER,
        occurrence: 4,
        startedAt: '2025-01-09T09:00:00Z',
        completedAt: '2025-01-09T10:00:00Z',
        logs: [{ exerciseId: EX_BENCH, type: 'reps', sets: [{ reps: 8, weightKg: 50 }] }],
      }),
    );

    const bests = await personalRecordRepository.findCurrentPersonalBests(owner(), [
      exerciseId(EX_BENCH),
    ]);

    // 55.5 proves the numeric(6,2) round trip keeps its exact value.
    expect(bestLines(bests)).toEqual([`${EX_BENCH}/max-load/55.5@pr-better.1.1`]);
  });

  it('keeps the earliest owner when a later performance equals the maximum', async () => {
    await savePrSessions(
      prSession({
        id: 'pr-owner',
        userId: OWNER,
        startedAt: '2025-01-01T09:00:00Z',
        completedAt: '2025-01-01T10:00:00Z',
        logs: [
          {
            exerciseId: EX_BENCH,
            type: 'reps',
            sets: [
              { reps: 8, weightKg: 60 },
              { reps: 10, weightKg: 60 },
            ],
          },
        ],
      }),
      prSession({
        id: 'pr-tie-later',
        userId: OWNER,
        occurrence: 2,
        startedAt: '2025-02-01T09:00:00Z',
        completedAt: '2025-02-01T10:00:00Z',
        logs: [{ exerciseId: EX_BENCH, type: 'reps', sets: [{ reps: 8, weightKg: 60 }] }],
      }),
    );

    const bests = await personalRecordRepository.findCurrentPersonalBests(owner(), [
      exerciseId(EX_BENCH),
    ]);

    // The earliest position among the equal maxima owns the best.
    expect(bestLines(bests)).toEqual([`${EX_BENCH}/max-load/60@pr-owner.1.1`]);
  });

  it('separates max-load, max-bodyweight-reps and max-duration per exercise', async () => {
    await savePrSessions(
      prSession({
        id: 'pr-metrics',
        userId: OWNER,
        startedAt: '2025-01-01T09:00:00Z',
        completedAt: '2025-01-01T10:00:00Z',
        logs: [
          {
            exerciseId: EX_BENCH,
            type: 'reps',
            sets: [
              { reps: 5, weightKg: 80 },
              { reps: 30, weightKg: null },
            ],
          },
          // A duration set's load is ignored: seconds are the value.
          { exerciseId: EX_CARRY, type: 'duration', sets: [{ durationSeconds: 45, weightKg: 24 }] },
        ],
      }),
    );

    const bests = await personalRecordRepository.findCurrentPersonalBests(owner(), [
      exerciseId(EX_CARRY),
      exerciseId(EX_BENCH),
    ]);

    expect(bestLines(bests)).toEqual([
      `${EX_BENCH}/max-bodyweight-reps/30@pr-metrics.1.2`,
      `${EX_BENCH}/max-load/80@pr-metrics.1.1`,
      `${EX_CARRY}/max-duration/45@pr-metrics.2.1`,
    ]);
  });

  it('keeps a logged 0 kg as a real external load record', async () => {
    await savePrSessions(
      prSession({
        id: 'pr-zero',
        userId: OWNER,
        startedAt: '2025-01-01T09:00:00Z',
        completedAt: '2025-01-01T10:00:00Z',
        logs: [
          {
            exerciseId: EX_BENCH,
            type: 'reps',
            sets: [
              { reps: 12, weightKg: 0 },
              { reps: 20, weightKg: null },
            ],
          },
        ],
      }),
    );

    const bests = await personalRecordRepository.findCurrentPersonalBests(owner(), [
      exerciseId(EX_BENCH),
    ]);

    expect(bestLines(bests)).toEqual([
      `${EX_BENCH}/max-bodyweight-reps/20@pr-zero.1.2`,
      `${EX_BENCH}/max-load/0@pr-zero.1.1`,
    ]);
    expect(Object.is(bests[1]?.value, 0)).toBe(true);
  });

  it('counts detached and attached history alike, and ignores in-progress sessions', async () => {
    await seedEnrollment('pr-enrollment', OWNER, 'prog-beginner-strength');
    await savePrSessions(
      // Detached (enrollment_id null) — the default in these fixtures.
      prSession({
        id: 'pr-detached',
        userId: OWNER,
        startedAt: '2025-01-01T09:00:00Z',
        completedAt: '2025-01-01T10:00:00Z',
        logs: [{ exerciseId: EX_BENCH, type: 'reps', sets: [{ reps: 8, weightKg: 40 }] }],
      }),
      // Still attached to a real enrollment.
      prSession({
        id: 'pr-attached',
        userId: OWNER,
        enrollmentId: 'pr-enrollment',
        occurrence: 1,
        startedAt: '2025-01-05T09:00:00Z',
        completedAt: '2025-01-05T10:00:00Z',
        logs: [{ exerciseId: EX_BENCH, type: 'reps', sets: [{ reps: 8, weightKg: 45 }] }],
      }),
      // In progress: much heavier, and must not count.
      prSession({
        id: 'pr-in-progress',
        userId: OWNER,
        occurrence: 2,
        startedAt: '2025-02-01T09:00:00Z',
        logs: [{ exerciseId: EX_BENCH, type: 'reps', sets: [{ reps: 8, weightKg: 200 }] }],
      }),
    );

    const bests = await personalRecordRepository.findCurrentPersonalBests(owner(), [
      exerciseId(EX_BENCH),
    ]);

    expect(bestLines(bests)).toEqual([`${EX_BENCH}/max-load/45@pr-attached.1.1`]);
  });

  it('answers several exercises in one batched, deterministic call and omits exercises without history', async () => {
    await savePrSessions(
      prSession({
        id: 'pr-batch',
        userId: OWNER,
        startedAt: '2025-01-01T09:00:00Z',
        completedAt: '2025-01-01T10:00:00Z',
        logs: [
          { exerciseId: EX_GOBLET, type: 'reps', sets: [{ reps: 12, weightKg: 24 }] },
          { exerciseId: EX_BENCH, type: 'reps', sets: [{ reps: 8, weightKg: 40 }] },
        ],
      }),
    );

    const requested: ReadonlyArray<ExerciseId> = [
      exerciseId(EX_BENCH),
      exerciseId(EX_GOBLET),
      exerciseId('ex-004'),
    ];
    const bests = await personalRecordRepository.findCurrentPersonalBests(owner(), requested);

    expect(bestLines(bests)).toEqual([
      `${EX_BENCH}/max-load/40@pr-batch.2.1`,
      `${EX_GOBLET}/max-load/24@pr-batch.1.1`,
    ]);

    const repeated = await personalRecordRepository.findCurrentPersonalBests(owner(), requested);
    expect(repeated).toEqual(bests);
  });

  it('returns an empty result for an empty exercise list without querying', async () => {
    const counting = createQueryCountingRepository();
    try {
      await expect(counting.repository.findCurrentPersonalBests(owner(), [])).resolves.toEqual([]);
      expect(counting.queries).toEqual([]);
    } finally {
      await counting.close();
    }
  });
});

// ─── Attribution (performed exercise id) ─────────────────────────────────────

describe('personal record repository — performed-exercise attribution', () => {
  it('credits a substituted occurrence to the performed exercise, never the authored one', async () => {
    await savePrSessions(
      prSession({
        id: 'pr-substituted',
        userId: OWNER,
        startedAt: '2025-01-01T09:00:00Z',
        completedAt: '2025-01-01T10:00:00Z',
        logs: [
          {
            exerciseId: EX_BENCH,
            performedExerciseId: 'ex-004',
            type: 'reps',
            sets: [{ reps: 8, weightKg: 70 }],
          },
        ],
      }),
    );

    const performed = await personalRecordRepository.findCurrentPersonalBests(owner(), [
      exerciseId('ex-004'),
    ]);
    const authored = await personalRecordRepository.findCurrentPersonalBests(owner(), [
      exerciseId(EX_BENCH),
    ]);

    expect(bestLines(performed)).toEqual([`ex-004/max-load/70@pr-substituted.1.1`]);
    expect(authored).toEqual([]);
  });

  it('lets a user-added occurrence participate under its performed exercise', async () => {
    await savePrSessions(
      prSession({
        id: 'pr-user-added',
        userId: OWNER,
        startedAt: '2025-01-01T09:00:00Z',
        completedAt: '2025-01-01T10:00:00Z',
        logs: [
          {
            exerciseId: EX_GOBLET,
            source: 'user_added',
            type: 'reps',
            sets: [{ reps: 15, weightKg: 24 }],
          },
        ],
      }),
    );

    const bests = await personalRecordRepository.findCurrentPersonalBests(owner(), [
      exerciseId(EX_GOBLET),
    ]);

    expect(bestLines(bests)).toEqual([`${EX_GOBLET}/max-load/24@pr-user-added.1.1`]);
  });

  it('credits a substituted user-added occurrence to the replacement exercise', async () => {
    await savePrSessions(
      prSession({
        id: 'pr-added-substituted',
        userId: OWNER,
        startedAt: '2025-01-01T09:00:00Z',
        completedAt: '2025-01-01T10:00:00Z',
        logs: [
          {
            exerciseId: EX_GOBLET,
            performedExerciseId: 'ex-005',
            source: 'user_added',
            type: 'reps',
            sets: [{ reps: 10, weightKg: 30 }],
          },
        ],
      }),
    );

    const replacement = await personalRecordRepository.findCurrentPersonalBests(owner(), [
      exerciseId('ex-005'),
    ]);
    const authored = await personalRecordRepository.findCurrentPersonalBests(owner(), [
      exerciseId(EX_GOBLET),
    ]);

    expect(bestLines(replacement)).toEqual(['ex-005/max-load/30@pr-added-substituted.1.1']);
    expect(authored).toEqual([]);
  });

  it('keeps duplicate occurrences of one exercise distinct and ranks their sets truthfully', async () => {
    await savePrSessions(
      prSession({
        id: 'pr-duplicate',
        userId: OWNER,
        startedAt: '2025-01-01T09:00:00Z',
        completedAt: '2025-01-01T10:00:00Z',
        logs: [
          { exerciseId: EX_BENCH, type: 'reps', sets: [{ reps: 8, weightKg: 30 }] },
          { exerciseId: EX_BENCH, type: 'reps', sets: [{ reps: 8, weightKg: 50 }] },
        ],
      }),
    );

    const bests = await personalRecordRepository.findCurrentPersonalBests(owner(), [
      exerciseId(EX_BENCH),
    ]);

    // The second occurrence is the heavier one: it owns the record, and the
    // two occurrences stay distinguishable by exercise order.
    expect(bestLines(bests)).toEqual([`${EX_BENCH}/max-load/50@pr-duplicate.2.1`]);
  });
});

// ─── Exact best before a candidate ───────────────────────────────────────────

/**
 * A detached session with one loaded rep set — the ladder scenarios' atom.
 * `occurrence` only has to be a free slot in {@link PR_OCCURRENCES}; detached
 * sessions never collide on it.
 */
function loadSetSession(spec: {
  readonly id: string;
  readonly completedAt: string;
  readonly startedAt?: string;
  readonly weightKg: number;
  readonly occurrence?: number;
}): WorkoutSession {
  return prSession({
    id: spec.id,
    userId: OWNER,
    ...(spec.occurrence === undefined ? {} : { occurrence: spec.occurrence }),
    startedAt: spec.startedAt ?? spec.completedAt,
    completedAt: spec.completedAt,
    logs: [{ exerciseId: EX_BENCH, type: 'reps', sets: [{ reps: 8, weightKg: spec.weightKg }] }],
  });
}

describe('personal record repository — exact best strictly before a candidate', () => {
  it('returns null for a first exposure', async () => {
    const prior = await personalRecordRepository.findBestValuesBefore(owner(), [
      prCandidate({
        exerciseId: EX_BENCH,
        metric: RecordMetric.MaxLoad,
        value: 40,
        completedAt: '2025-01-06T10:00:00Z',
        startedAt: '2025-01-06T09:00:00Z',
        sessionId: 'pr-none-before',
      }),
    ]);

    expect(priorLines(prior)).toEqual(['max-load/40->none']);
  });

  it('returns the strictly earlier maximum and ignores later or in-progress performances', async () => {
    await savePrSessions(
      loadSetSession({ id: 'pr-a', completedAt: '2025-01-01T10:00:00Z', weightKg: 40 }),
      loadSetSession({
        id: 'pr-b',
        completedAt: '2025-01-05T10:00:00Z',
        weightKg: 50,
        occurrence: 2,
      }),
      // In progress, and by far the heaviest: never history.
      prSession({
        id: 'pr-c-in-progress',
        userId: OWNER,
        occurrence: 4,
        startedAt: '2025-01-06T09:00:00Z',
        logs: [{ exerciseId: EX_BENCH, type: 'reps', sets: [{ reps: 8, weightKg: 500 }] }],
      }),
    );

    const [between, afterEverything] = await personalRecordRepository.findBestValuesBefore(owner(), [
      prCandidate({
        exerciseId: EX_BENCH,
        metric: RecordMetric.MaxLoad,
        value: 5,
        completedAt: '2025-01-03T10:00:00Z',
        startedAt: '2025-01-03T09:00:00Z',
        sessionId: 'pr-between',
      }),
      prCandidate({
        exerciseId: EX_BENCH,
        metric: RecordMetric.MaxLoad,
        value: 5,
        completedAt: '2025-01-09T10:00:00Z',
        startedAt: '2025-01-09T09:00:00Z',
        sessionId: 'pr-after',
      }),
    ]);

    // Between the two sessions only the 40 kg precedes the candidate; after
    // both, the maximum is 50 kg — and the in-progress 500 kg never counts.
    expect(between?.bestBefore).toBe(40);
    expect(afterEverything?.bestBefore).toBe(50);
  });

  it('excludes the candidate’s own set from its own history', async () => {
    await savePrSessions(
      loadSetSession({ id: 'pr-a', completedAt: '2025-01-01T10:00:00Z', weightKg: 40 }),
      loadSetSession({
        id: 'pr-b',
        completedAt: '2025-01-05T10:00:00Z',
        weightKg: 50,
        occurrence: 2,
      }),
    );

    const prior = await personalRecordRepository.findBestValuesBefore(owner(), [
      prCandidate({
        exerciseId: EX_BENCH,
        metric: RecordMetric.MaxLoad,
        value: 50,
        completedAt: '2025-01-05T10:00:00Z',
        startedAt: '2025-01-05T10:00:00Z',
        sessionId: 'pr-b',
      }),
    ]);

    // pr-b's own 50 kg set is not "before" itself: only pr-a's 40 remains.
    expect(priorLines(prior)).toEqual(['max-load/50->40']);
  });

  it('breaks an equal completedAt by startedAt', async () => {
    await savePrSessions(
      loadSetSession({
        id: 'pr-t2-early',
        completedAt: '2025-02-10T10:00:00Z',
        startedAt: '2025-02-10T08:00:00Z',
        weightKg: 30,
      }),
      loadSetSession({
        id: 'pr-t2-late',
        completedAt: '2025-02-10T10:00:00Z',
        startedAt: '2025-02-10T12:00:00Z',
        weightKg: 99,
        occurrence: 2,
      }),
    );

    const [atStart, afterBoth] = await personalRecordRepository.findBestValuesBefore(owner(), [
      prCandidate({
        exerciseId: EX_BENCH,
        metric: RecordMetric.MaxLoad,
        value: 10,
        completedAt: '2025-02-10T10:00:00Z',
        startedAt: '2025-02-10T10:00:00Z',
        sessionId: 'pr-t2-candidate',
      }),
      prCandidate({
        exerciseId: EX_BENCH,
        metric: RecordMetric.MaxLoad,
        value: 10,
        completedAt: '2025-02-10T10:00:00Z',
        startedAt: '2025-02-10T13:00:00Z',
        sessionId: 'pr-t2-candidate',
      }),
    ]);

    // Started at 10:00 ⇒ only the 08:00 performance precedes it (the 99 kg is
    // excluded although it completed at the same instant). Started at 13:00 ⇒
    // both do, so 99 becomes the best.
    expect(atStart?.bestBefore).toBe(30);
    expect(afterBoth?.bestBefore).toBe(99);
  });

  it('breaks an equal completedAt and startedAt by sessionId', async () => {
    await savePrSessions(
      loadSetSession({
        id: 'pr-t3-a',
        completedAt: '2025-03-01T10:00:00Z',
        startedAt: '2025-03-01T09:00:00Z',
        weightKg: 30,
      }),
      loadSetSession({
        id: 'pr-t3-b',
        completedAt: '2025-03-01T10:00:00Z',
        startedAt: '2025-03-01T09:00:00Z',
        weightKg: 99,
        occurrence: 2,
      }),
    );

    const [beforeB, afterB] = await personalRecordRepository.findBestValuesBefore(owner(), [
      prCandidate({
        exerciseId: EX_BENCH,
        metric: RecordMetric.MaxLoad,
        value: 10,
        completedAt: '2025-03-01T10:00:00Z',
        startedAt: '2025-03-01T09:00:00Z',
        sessionId: 'pr-t3-b',
      }),
      prCandidate({
        exerciseId: EX_BENCH,
        metric: RecordMetric.MaxLoad,
        value: 10,
        completedAt: '2025-03-01T10:00:00Z',
        startedAt: '2025-03-01T09:00:00Z',
        sessionId: 'pr-t3-c',
      }),
    ]);

    // Byte-wise id order: 'pr-t3-a' < 'pr-t3-b' < 'pr-t3-c'.
    expect(beforeB?.bestBefore).toBe(30);
    expect(afterB?.bestBefore).toBe(99);
  });

  it('breaks an equal session and timestamps by exerciseOrder', async () => {
    await savePrSessions(
      // One session, two occurrences of the same exercise.
      prSession({
        id: 'pr-t4',
        userId: OWNER,
        startedAt: '2025-04-01T09:00:00Z',
        completedAt: '2025-04-01T10:00:00Z',
        logs: [
          { exerciseId: EX_BENCH, type: 'reps', sets: [{ reps: 8, weightKg: 30 }] },
          { exerciseId: EX_BENCH, type: 'reps', sets: [{ reps: 8, weightKg: 99 }] },
        ],
      }),
    );

    const [atSecond, afterSecond] = await personalRecordRepository.findBestValuesBefore(owner(), [
      prCandidate({
        exerciseId: EX_BENCH,
        metric: RecordMetric.MaxLoad,
        value: 10,
        completedAt: '2025-04-01T10:00:00Z',
        startedAt: '2025-04-01T09:00:00Z',
        sessionId: 'pr-t4',
        exerciseOrder: 2,
      }),
      prCandidate({
        exerciseId: EX_BENCH,
        metric: RecordMetric.MaxLoad,
        value: 10,
        completedAt: '2025-04-01T10:00:00Z',
        startedAt: '2025-04-01T09:00:00Z',
        sessionId: 'pr-t4',
        exerciseOrder: 3,
      }),
    ]);

    // Inside occurrence 2 only occurrence 1 precedes it; past both, 99 wins.
    expect(atSecond?.bestBefore).toBe(30);
    expect(afterSecond?.bestBefore).toBe(99);
  });

  it('breaks an equal occurrence by setNumber', async () => {
    await savePrSessions(
      // One occurrence, two sets, the second heavier.
      prSession({
        id: 'pr-t5',
        userId: OWNER,
        startedAt: '2025-05-01T09:00:00Z',
        completedAt: '2025-05-01T10:00:00Z',
        logs: [
          {
            exerciseId: EX_BENCH,
            type: 'reps',
            sets: [
              { reps: 8, weightKg: 30 },
              { reps: 8, weightKg: 99 },
            ],
          },
        ],
      }),
    );

    const [atSecondSet, afterSecondSet] = await personalRecordRepository.findBestValuesBefore(
      owner(),
      [
        prCandidate({
          exerciseId: EX_BENCH,
          metric: RecordMetric.MaxLoad,
          value: 10,
          completedAt: '2025-05-01T10:00:00Z',
          startedAt: '2025-05-01T09:00:00Z',
          sessionId: 'pr-t5',
          setNumber: 2,
        }),
        prCandidate({
          exerciseId: EX_BENCH,
          metric: RecordMetric.MaxLoad,
          value: 10,
          completedAt: '2025-05-01T10:00:00Z',
          startedAt: '2025-05-01T09:00:00Z',
          sessionId: 'pr-t5',
          setNumber: 3,
        }),
      ],
    );

    // The candidate sits on set 2, so only set 1 precedes it.
    expect(atSecondSet?.bestBefore).toBe(30);
    expect(afterSecondSet?.bestBefore).toBe(99);
  });

  it('returns an equal previous value, leaving the strictness rule to the Domain', async () => {
    await savePrSessions(
      loadSetSession({ id: 'pr-equal-earlier', completedAt: '2025-06-01T10:00:00Z', weightKg: 50 }),
    );
    const session = prSession({
      id: 'pr-equal',
      userId: OWNER,
      occurrence: 2,
      startedAt: '2025-06-02T10:00:00Z',
      completedAt: '2025-06-02T11:00:00Z',
      logs: [{ exerciseId: EX_BENCH, type: 'reps', sets: [{ reps: 8, weightKg: 50 }] }],
    });
    await savePrSessions(session);

    const extracted = extractRecordCandidates(session);
    if (!extracted.ok) throw new Error(extracted.error.message);
    const prior = await personalRecordRepository.findBestValuesBefore(owner(), extracted.data);

    // History contains an equal 50 kg: the read returns it, and the Domain then
    // decides that an equal value is NOT a new record.
    expect(priorLines(prior)).toEqual(['max-load/50->50']);
    expect(resolveRecordEvents(prior)).toEqual([]);
  });

  it('answers several candidates in one call, in input order, including identical positions', async () => {
    await savePrSessions(
      loadSetSession({ id: 'pr-a', completedAt: '2025-01-01T10:00:00Z', weightKg: 40 }),
      loadSetSession({
        id: 'pr-b',
        completedAt: '2025-01-05T10:00:00Z',
        weightKg: 50,
        occurrence: 2,
      }),
    );

    const duplicate = prCandidate({
      exerciseId: EX_BENCH,
      metric: RecordMetric.MaxLoad,
      value: 10,
      completedAt: '2025-01-06T10:00:00Z',
      startedAt: '2025-01-06T09:00:00Z',
      sessionId: 'pr-between',
    });
    const candidates = [
      duplicate,
      prCandidate({
        exerciseId: EX_BENCH,
        metric: RecordMetric.MaxLoad,
        value: 10,
        completedAt: '2025-01-03T10:00:00Z',
        startedAt: '2025-01-03T09:00:00Z',
        sessionId: 'pr-between-2',
      }),
      duplicate,
    ];

    const prior = await personalRecordRepository.findBestValuesBefore(owner(), candidates);

    expect(priorLines(prior)).toEqual(['max-load/10->50', 'max-load/10->40', 'max-load/10->50']);
    // Correspondence is by position in the array, carried by the same objects.
    expect(prior.map((entry) => entry.candidate)).toEqual(candidates);
  });

  it('answers several metrics and exercises in one call', async () => {
    await savePrSessions(
      prSession({
        id: 'pr-mixed',
        userId: OWNER,
        occurrence: 5,
        startedAt: '2025-07-01T09:00:00Z',
        completedAt: '2025-07-01T10:00:00Z',
        logs: [{ exerciseId: EX_GOBLET, type: 'duration', sets: [{ durationSeconds: 60 }] }],
      }),
    );

    const prior = await personalRecordRepository.findBestValuesBefore(owner(), [
      prCandidate({
        exerciseId: EX_GOBLET,
        metric: RecordMetric.MaxDuration,
        value: 60,
        completedAt: '2025-07-02T10:00:00Z',
        startedAt: '2025-07-02T09:00:00Z',
        sessionId: 'pr-mixed-later',
      }),
      prCandidate({
        exerciseId: EX_BENCH,
        metric: RecordMetric.MaxBodyweightReps,
        value: 20,
        completedAt: '2025-07-02T10:00:00Z',
        startedAt: '2025-07-02T09:00:00Z',
        sessionId: 'pr-mixed-later',
      }),
      prCandidate({
        exerciseId: EX_GOBLET,
        metric: RecordMetric.MaxLoad,
        value: 20,
        completedAt: '2025-07-02T10:00:00Z',
        startedAt: '2025-07-02T09:00:00Z',
        sessionId: 'pr-mixed-later',
      }),
    ]);

    // A duration set never competes in a load metric, and a reps-only history
    // never satisfies a duration metric.
    expect(priorLines(prior)).toEqual([
      'max-duration/60->60',
      'max-bodyweight-reps/20->none',
      'max-load/20->none',
    ]);
  });
});

// ─── Structural history behavior ─────────────────────────────────────────────

describe('personal record repository — structural history behavior', () => {
  it('lets zero-set and skipped occurrences contribute nothing', async () => {
    await savePrSessions(
      prSession({
        id: 'pr-inactive',
        userId: OWNER,
        startedAt: '2025-01-01T09:00:00Z',
        completedAt: '2025-01-01T10:00:00Z',
        logs: [
          { exerciseId: EX_BENCH, type: 'reps', sets: [{ reps: 8, weightKg: 40 }] },
          // Zero-set occurrence (no logged sets at all).
          { exerciseId: 'ex-004', type: 'reps', sets: [] },
          // Explicitly skipped occurrence: still structurally set-less.
          { exerciseId: 'ex-005', type: 'reps', isSkipped: true, sets: [] },
        ],
      }),
    );

    const bests = await personalRecordRepository.findCurrentPersonalBests(owner(), [
      exerciseId(EX_BENCH),
      exerciseId('ex-004'),
      exerciseId('ex-005'),
    ]);

    expect(bestLines(bests)).toEqual([`${EX_BENCH}/max-load/40@pr-inactive.1.1`]);
  });

  it('isolates records by user ownership', async () => {
    await savePrSessions(
      prSession({
        id: 'pr-owned-by-owner',
        userId: OWNER,
        startedAt: '2025-01-10T09:00:00Z',
        completedAt: '2025-01-10T10:00:00Z',
        logs: [{ exerciseId: EX_BENCH, type: 'reps', sets: [{ reps: 8, weightKg: 80 }] }],
      }),
      prSession({
        id: 'pr-owned-by-other',
        userId: OTHER,
        startedAt: '2025-01-01T09:00:00Z',
        completedAt: '2025-01-01T10:00:00Z',
        logs: [{ exerciseId: EX_BENCH, type: 'reps', sets: [{ reps: 8, weightKg: 20 }] }],
      }),
    );

    const ownerBests = await personalRecordRepository.findCurrentPersonalBests(owner(), [
      exerciseId(EX_BENCH),
    ]);
    const otherBests = await personalRecordRepository.findCurrentPersonalBests(userId(OTHER), [
      exerciseId(EX_BENCH),
    ]);
    const ownerPrior = await personalRecordRepository.findBestValuesBefore(owner(), [
      prCandidate({
        exerciseId: EX_BENCH,
        metric: RecordMetric.MaxLoad,
        value: 80,
        completedAt: '2025-01-10T10:00:00Z',
        startedAt: '2025-01-10T09:00:00Z',
        sessionId: 'pr-owned-by-owner',
      }),
    ]);

    expect(bestLines(ownerBests)).toEqual([`${EX_BENCH}/max-load/80@pr-owned-by-owner.1.1`]);
    expect(bestLines(otherBests)).toEqual([`${EX_BENCH}/max-load/20@pr-owned-by-other.1.1`]);
    // The other user's earlier 20 kg is not part of this user's history.
    expect(priorLines(ownerPrior)).toEqual(['max-load/80->none']);
  });

  it('returns an empty result for an empty candidate list without querying', async () => {
    const counting = createQueryCountingRepository();
    try {
      await expect(counting.repository.findBestValuesBefore(owner(), [])).resolves.toEqual([]);
      expect(counting.queries).toEqual([]);
    } finally {
      await counting.close();
    }
  });
});

// ─── Batching (no N+1, no per-item round trip) ───────────────────────────────

describe('personal record repository — batched round trips', () => {
  beforeEach(async () => {
    // Any history works: these tests measure statements, not values.
    await savePrSessions(
      loadSetSession({ id: 'pr-batch-history', completedAt: '2025-01-01T10:00:00Z', weightKg: 40 }),
    );
  });

  it('answers one exercise and four exercises with the same single statement', async () => {
    const counting = createQueryCountingRepository();
    try {
      // Warm up: a driver's first statement is its own type discovery, which is
      // a per-connection handshake rather than per-item work.
      await counting.repository.findCurrentPersonalBests(owner(), [exerciseId(EX_BENCH)]);

      const beforeOne = counting.queries.length;
      await counting.repository.findCurrentPersonalBests(owner(), [exerciseId(EX_BENCH)]);
      const oneExercise = counting.queries.length - beforeOne;

      const beforeMany = counting.queries.length;
      await counting.repository.findCurrentPersonalBests(owner(), [
        exerciseId(EX_BENCH),
        exerciseId(EX_GOBLET),
        exerciseId(EX_CARRY),
        exerciseId('ex-004'),
      ]);
      const fourExercises = counting.queries.length - beforeMany;

      expect(oneExercise).toBe(1);
      expect(fourExercises).toBe(1);
    } finally {
      await counting.close();
    }
  });

  it('answers one candidate and five candidates with the same single statement', async () => {
    const counting = createQueryCountingRepository();
    try {
      const candidate = (setNumber: number, completedAt: string) =>
        prCandidate({
          exerciseId: EX_BENCH,
          metric: RecordMetric.MaxLoad,
          value: 10,
          completedAt,
          startedAt: '2025-01-06T09:00:00Z',
          sessionId: 'pr-batch-count',
          setNumber,
        });

      await counting.repository.findBestValuesBefore(owner(), [candidate(1, '2025-01-06T10:00:00Z')]);

      const beforeOne = counting.queries.length;
      await counting.repository.findBestValuesBefore(owner(), [candidate(1, '2025-01-06T10:00:00Z')]);
      const oneCandidate = counting.queries.length - beforeOne;

      const beforeMany = counting.queries.length;
      await counting.repository.findBestValuesBefore(owner(), [
        candidate(1, '2025-01-02T10:00:00Z'),
        candidate(2, '2025-01-03T10:00:00Z'),
        candidate(3, '2025-01-04T10:00:00Z'),
        candidate(4, '2025-01-05T10:00:00Z'),
        candidate(5, '2025-01-06T10:00:00Z'),
      ]);
      const fiveCandidates = counting.queries.length - beforeMany;

      expect(oneCandidate).toBe(1);
      expect(fiveCandidates).toBe(1);
    } finally {
      await counting.close();
    }
  });
});

// ─── Oracle: the optimized SQL against the authoritative Domain fold ─────────

/**
 * A history chosen to exercise every rule the SQL projection could drift on:
 * a first exposure, a tied maximum, several sets in one occurrence, duplicate
 * occurrences in one session, a substituted occurrence, a user-added
 * occurrence, both load metrics and the duration metric, an in-progress
 * session, a skipped and a zero-set occurrence, and a second user with an
 * earlier (and heavier) look-alike session.
 */
async function seedOracleHistory(): Promise<void> {
  await savePrSessions(
    prSession({
      id: 'oracle-a',
      userId: OWNER,
      startedAt: '2025-01-01T09:00:00Z',
      completedAt: '2025-01-01T10:00:00Z',
      logs: [
        {
          exerciseId: EX_BENCH,
          type: 'reps',
          sets: [
            { reps: 8, weightKg: 40 },
            { reps: 10, weightKg: 40 },
          ],
        },
        { exerciseId: EX_CARRY, type: 'duration', sets: [{ durationSeconds: 30 }] },
      ],
    }),
    prSession({
      id: 'oracle-b',
      userId: OWNER,
      occurrence: 1,
      startedAt: '2025-01-08T09:00:00Z',
      completedAt: '2025-01-08T10:00:00Z',
      logs: [
        {
          exerciseId: EX_BENCH,
          performedExerciseId: 'ex-004',
          type: 'reps',
          sets: [{ reps: 5, weightKg: 60 }],
        },
      ],
    }),
    prSession({
      id: 'oracle-c',
      userId: OWNER,
      occurrence: 2,
      startedAt: '2025-01-15T09:00:00Z',
      completedAt: '2025-01-15T10:00:00Z',
      logs: [
        {
          exerciseId: EX_GOBLET,
          source: 'user_added',
          type: 'reps',
          sets: [{ reps: 12, weightKg: 24 }],
        },
        { exerciseId: EX_BENCH, type: 'reps', sets: [{ reps: 20, weightKg: null }] },
      ],
    }),
    // A later, equal maximum, plus a strictly greater duration.
    prSession({
      id: 'oracle-d',
      userId: OWNER,
      occurrence: 3,
      startedAt: '2025-01-22T09:00:00Z',
      completedAt: '2025-01-22T10:00:00Z',
      logs: [
        { exerciseId: EX_BENCH, type: 'reps', sets: [{ reps: 8, weightKg: 40 }] },
        { exerciseId: EX_CARRY, type: 'duration', sets: [{ durationSeconds: 45 }] },
      ],
    }),
    // One session, two occurrences of the same exercise.
    prSession({
      id: 'oracle-e',
      userId: OWNER,
      occurrence: 4,
      startedAt: '2025-02-05T09:00:00Z',
      completedAt: '2025-02-05T10:00:00Z',
      logs: [
        { exerciseId: EX_BENCH, type: 'reps', sets: [{ reps: 8, weightKg: 45 }] },
        { exerciseId: EX_BENCH, type: 'reps', sets: [{ reps: 8, weightKg: 45 }] },
      ],
    }),
    // In progress, and heavier than everything: never history.
    prSession({
      id: 'oracle-in-progress',
      userId: OWNER,
      occurrence: 5,
      startedAt: '2025-02-08T09:00:00Z',
      logs: [{ exerciseId: EX_BENCH, type: 'reps', sets: [{ reps: 8, weightKg: 500 }] }],
    }),
    // A heavier performance next to a skipped and a zero-set occurrence.
    prSession({
      id: 'oracle-f',
      userId: OWNER,
      occurrence: 6,
      startedAt: '2025-02-12T09:00:00Z',
      completedAt: '2025-02-12T10:00:00Z',
      logs: [
        { exerciseId: EX_BENCH, type: 'reps', sets: [{ reps: 8, weightKg: 50 }] },
        { exerciseId: 'ex-004', type: 'reps', isSkipped: true, sets: [] },
        { exerciseId: 'ex-005', type: 'reps', sets: [] },
      ],
    }),
    // Another user, earlier and heavier: must never leak into this user's read.
    prSession({
      id: 'oracle-other',
      userId: OTHER,
      occurrence: 7,
      startedAt: '2024-12-01T09:00:00Z',
      completedAt: '2024-12-01T10:00:00Z',
      logs: [{ exerciseId: EX_BENCH, type: 'reps', sets: [{ reps: 8, weightKg: 999 }] }],
    }),
  );
}

describe('personal record repository — oracle against the Domain fold', () => {
  beforeEach(async () => {
    await seedOracleHistory();
  });

  it('matches the Domain fold’s current bests exactly', async () => {
    const sessions = await hydrateCompletedHistory(owner());
    const folded = foldPersonalRecords(sessions);
    if (!folded.ok) throw new Error(folded.error.message);

    const requested: ReadonlyArray<ExerciseId> = [
      exerciseId(EX_BENCH),
      exerciseId(EX_GOBLET),
      exerciseId(EX_CARRY),
      exerciseId('ex-004'),
      exerciseId('ex-005'),
      exerciseId('ex-007'),
    ];
    const sqlBests = await personalRecordRepository.findCurrentPersonalBests(owner(), requested);
    const domainBests = folded.data.currentBests.filter((best) =>
      requested.includes(best.exerciseId),
    );

    // The scenario must be non-trivial: five pairs spanning the performed
    // attribution, the user-added occurrence, both load metrics of one exercise
    // and the duration metric.
    expect(domainBests.length).toBeGreaterThanOrEqual(5);
    expect(sqlBests).toEqual(domainBests);
  });

  it('matches the Domain fold’s events exactly when its best-before values are resolved', async () => {
    const sessions = await hydrateCompletedHistory(owner());
    const folded = foldPersonalRecords(sessions);
    if (!folded.ok) throw new Error(folded.error.message);

    const candidates = candidatesOf(sessions);
    const prior = await personalRecordRepository.findBestValuesBefore(owner(), candidates);
    const sqlEvents = resolveRecordEvents(prior);

    // Non-trivial by construction: the history contains ties and several sets
    // inside single occurrences, so an off-by-one rung or a wrong tie order
    // would change the event list.
    expect(folded.data.events.length).toBeGreaterThanOrEqual(8);
    expect(sqlEvents).toEqual(folded.data.events);
  });
});

// ─── Exercise-history wiring (M12 Slice 3) ───────────────────────────────────

/**
 * One small end-to-end check of the presentation read path's wiring: the
 * exercise-history use case, the catalog, and the personal-record repository
 * composed exactly as the `/history/exercises/[slug]` route composes them. The
 * record semantics themselves are proven above against the Domain fold; this
 * only proves the composed path resolves the slug, reads the records for the
 * resolved exercise, and surfaces them on the DTO.
 */
describe('exercise history use case — personal bests wiring', () => {
  const exerciseHistory = new GetExerciseHistoryUseCase(
    trainingHistoryRepository,
    exerciseRepository,
    personalRecordRepository,
  );

  it('surfaces the exercise’s records on the history DTO', async () => {
    await savePrSessions(
      prSession({
        id: 'wired-early',
        userId: OWNER,
        startedAt: '2025-01-01T09:00:00Z',
        completedAt: '2025-01-01T10:00:00Z',
        logs: [{ exerciseId: EX_BENCH, type: 'reps', sets: [{ reps: 8, weightKg: 40 }] }],
      }),
      prSession({
        id: 'wired-mixed',
        userId: OWNER,
        occurrence: 2,
        startedAt: '2025-01-08T09:00:00Z',
        completedAt: '2025-01-08T10:00:00Z',
        logs: [
          { exerciseId: EX_BENCH, type: 'reps', sets: [{ reps: 20, weightKg: null }] },
          { exerciseId: EX_CARRY, type: 'duration', sets: [{ durationSeconds: 45 }] },
        ],
      }),
    );

    const result = await exerciseHistory.execute({ userId: OWNER, slug: 'bodyweight-squat' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.exercise.id).toBe(EX_BENCH);
    // Deterministic repository order: exercise id, then metric ascending.
    expect(result.data.personalBests).toEqual([
      {
        exerciseId: EX_BENCH,
        metric: 'max-bodyweight-reps',
        value: 20,
        sessionId: 'wired-mixed',
        exerciseOrder: 1,
        setNumber: 1,
        completedAt: '2025-01-08T10:00:00.000Z',
      },
      {
        exerciseId: EX_BENCH,
        metric: 'max-load',
        value: 40,
        sessionId: 'wired-early',
        exerciseOrder: 1,
        setNumber: 1,
        completedAt: '2025-01-01T10:00:00.000Z',
      },
    ]);

    // The record read matches the repository read directly (same owners) …
    const direct = await personalRecordRepository.findCurrentPersonalBests(owner(), [
      exerciseId(EX_BENCH),
    ]);
    expect(result.data.personalBests.map((best) => best.sessionId)).toEqual(
      direct.map((best) => best.position.sessionId),
    );
    // … and the occurrence window still comes from the history port.
    expect(result.data.entries).toHaveLength(2);
  });

  it('keeps an exercise without completed history as a successful empty result', async () => {
    const result = await exerciseHistory.execute({ userId: OWNER, slug: 'push-up' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.exercise.id).toBe('ex-007');
    expect(result.data.personalBests).toEqual([]);
    expect(result.data.entries).toEqual([]);
  });

  it('keeps the unknown-slug failure unchanged', async () => {
    const result = await exerciseHistory.execute({ userId: OWNER, slug: 'not-an-exercise' });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('EXERCISE_NOT_FOUND');
  });
});

// ─── Completed-session record events wiring (M12 Slice 4) ────────────────────

/**
 * One compact end-to-end check of the record-events read flow:
 * completed session -> Domain candidate extraction -> exact best-before read ->
 * Domain event resolution -> application DTO. The record semantics themselves
 * are proven above against the Domain fold and in the Slice 1 suite; this only
 * proves the composed path.
 */
describe('completed session record events — read-flow wiring', () => {
  const recordEvents = new GetCompletedSessionRecordEventsUseCase(
    trainingHistoryRepository,
    personalRecordRepository,
  );

  it('resolves the session’s historical records through the real repositories', async () => {
    await savePrSessions(
      // Earlier history for the substituted exercise: 40 kg.
      prSession({
        id: 'wired-record-history',
        userId: OWNER,
        startedAt: '2025-01-01T09:00:00Z',
        completedAt: '2025-01-01T10:00:00Z',
        logs: [{ exerciseId: 'ex-002', type: 'reps', sets: [{ reps: 8, weightKg: 40 }] }],
      }),
      // The session under test.
      prSession({
        id: 'wired-record-session',
        userId: OWNER,
        occurrence: 2,
        startedAt: '2025-02-01T09:00:00Z',
        completedAt: '2025-02-01T10:00:00Z',
        logs: [
          {
            // Substituted: authored ex-001, performed ex-002 — records follow
            // the PERFORMED exercise.
            exerciseId: 'ex-001',
            performedExerciseId: 'ex-002',
            type: 'reps',
            sets: [{ reps: 8, weightKg: 40 }, { reps: 8, weightKg: 50 }, { reps: 8, weightKg: 50 }],
          },
          {
            // First timed exposure for this exercise.
            exerciseId: EX_CARRY,
            type: 'duration',
            sets: [{ durationSeconds: 45 }],
          },
          {
            // User-added occurrence with a logged 0 kg: a real, first load.
            exerciseId: 'ex-005',
            source: 'user_added',
            type: 'reps',
            sets: [{ reps: 12, weightKg: 0 }],
          },
        ],
      }),
    );

    const result = await recordEvents.execute({ userId: OWNER, sessionId: 'wired-record-session' });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Set 1 equals the existing 40 kg maximum (no event), set 2 strictly
    // exceeds it, set 3 repeats it (no event); the duration and the user-added
    // 0 kg are first exposures.
    expect(result.data).toEqual([
      { exerciseOrder: 1, setNumber: 2, metric: 'max-load', value: 50, previousBest: 40 },
      { exerciseOrder: 2, setNumber: 1, metric: 'max-duration', value: 45, previousBest: null },
      { exerciseOrder: 3, setNumber: 1, metric: 'max-load', value: 0, previousBest: null },
    ]);
  });

  it('returns an empty list for a completed session with no records', async () => {
    // First session: 80 kg. Second session repeats 60 kg — below the existing
    // maximum, so no event, and the first session is not addressed here.
    await savePrSessions(
      prSession({
        id: 'wired-flat-history',
        userId: OWNER,
        startedAt: '2025-01-01T09:00:00Z',
        completedAt: '2025-01-01T10:00:00Z',
        logs: [{ exerciseId: EX_BENCH, type: 'reps', sets: [{ reps: 8, weightKg: 80 }] }],
      }),
      prSession({
        id: 'wired-flat-session',
        userId: OWNER,
        occurrence: 2,
        startedAt: '2025-02-01T09:00:00Z',
        completedAt: '2025-02-01T10:00:00Z',
        logs: [{ exerciseId: EX_BENCH, type: 'reps', sets: [{ reps: 8, weightKg: 60 }] }],
      }),
    );

    const result = await recordEvents.execute({ userId: OWNER, sessionId: 'wired-flat-session' });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toEqual([]);
  });

  it('keeps the single-outcome not-found behaviour', async () => {
    const foreign = await recordEvents.execute({ userId: OTHER, sessionId: 'wired-record-session' });

    expect(foreign.ok).toBe(false);
    if (foreign.ok) return;
    expect(foreign.error.code).toBe('SESSION_NOT_FOUND');
  });
});
