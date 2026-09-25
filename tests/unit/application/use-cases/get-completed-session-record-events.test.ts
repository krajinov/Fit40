/**
 * Unit tests for the M12 Slice 4 record-events read.
 *
 * The use case is a thin composition of the exact pieces: the completed-session
 * read path, the Domain's candidate extraction and event resolution, and the
 * Slice 2 best-before read. These tests lock the composition — ordering,
 * single-outcome errors, the no-candidates shortcut, and performed-exercise
 * attribution — without re-testing the Domain's own strictness table (that
 * lives in the Slice 1 suite).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PersonalRecordRepository } from '@/application/ports/personal-record-repository';
import type {
  CompletedSessionContext,
  CompletedWorkoutSession,
  TrainingHistoryRepository,
} from '@/application/ports/training-history-repository';
import { GetCompletedSessionRecordEventsUseCase } from '@/application/use-cases/get-completed-session-record-events';
import {
  completeWorkoutSession,
  createWorkoutSession,
  logSessionSet,
} from '@/domain/entities/workout-session';
import { skipSessionExercise } from '@/domain/services/session-exercise-skip';
import type { CandidatePriorBest } from '@/domain/services/personal-records';
import {
  createExerciseId,
  createScheduledWorkoutId,
  createUserId,
  createWorkoutId,
} from '@/domain/types/ids';
import { createDurationScheme, createRepScheme } from '@/domain/value-objects/rep-prescription';

function uid(value: string) {
  const result = createUserId(value);
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

function eid(value: string) {
  const result = createExerciseId(value);
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

function wid(value: string) {
  const result = createWorkoutId(value);
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

function scheduledId(value: string) {
  const result = createScheduledWorkoutId(value);
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

function repScheme() {
  const result = createRepScheme(3, 8, 10);
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

function durationScheme() {
  const result = createDurationScheme(3, 45);
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

interface LogSpec {
  /** The authored exercise; `performed` overrides it for substitutions. */
  readonly authored: string;
  readonly performed?: string;
  readonly type: 'reps' | 'duration';
  readonly isSkipped?: boolean;
  readonly sets: ReadonlyArray<{ readonly reps?: number; readonly weightKg?: number | null }>;
}

/** Builds a completed session through the real domain factories. */
function completedSession(spec: { readonly logs: ReadonlyArray<LogSpec> }): CompletedWorkoutSession {
  const created = createWorkoutSession({
    id: 'session-1',
    userId: uid('user-a'),
    enrollmentId: null,
    scheduledWorkoutId: scheduledId('scheduled-1'),
    workoutId: wid('workout-1'),
    startedAt: new Date('2026-02-15T10:00:00Z'),
    exerciseLogs: spec.logs.map((log, index) => ({
      authoredExerciseId: eid(log.authored),
      performedExerciseId: eid(log.performed ?? log.authored),
      order: index + 1,
      prescription: log.type === 'reps' ? repScheme() : durationScheme(),
      restSeconds: 60,
    })),
  });
  if (!created.ok) throw new Error(created.error.message);

  let session = created.data;
  for (const [index, log] of spec.logs.entries()) {
    for (const set of log.sets) {
      const logged =
        log.type === 'reps'
          ? logSessionSet(session, {
              exerciseOrder: index + 1,
              type: 'reps',
              reps: set.reps ?? 10,
              weightKg: set.weightKg ?? null,
              rpe: null,
            })
          : logSessionSet(session, {
              exerciseOrder: index + 1,
              type: 'duration',
              durationSeconds: 45,
              weightKg: null,
              rpe: null,
            });
      if (!logged.ok) throw new Error(logged.error.message);
      session = logged.data;
    }
    if (log.isSkipped === true) {
      const skipped = skipSessionExercise(session, { exerciseOrder: index + 1 });
      if (!skipped.ok) throw new Error(skipped.error.message);
      session = skipped.data;
    }
  }

  const completed = completeWorkoutSession(session, new Date('2026-02-15T11:00:00Z'));
  if (!completed.ok) throw new Error(completed.error.message);

  const completedAt = completed.data.completedAt;
  if (completedAt === null) throw new Error('unreachable: completion sets completedAt');
  return { ...completed.data, completedAt };
}

function context(session: CompletedWorkoutSession): CompletedSessionContext {
  return {
    session,
    programName: 'Program',
    workoutName: 'Workout',
  };
}

function makeHistoryRepo(value: CompletedSessionContext | null) {
  return {
    listCompletedSessions: vi.fn(),
    listCompletedExerciseOccurrences: vi.fn(),
    listRecentCompletedExercisePerformances: vi.fn(),
    listCompletedSessionActivity: vi.fn(),
    getTotals: vi.fn(),
    findCompletedSessionById: vi.fn().mockResolvedValue(value),
  } satisfies TrainingHistoryRepository;
}

/**
 * A record-repository stub whose best-before values are supplied per candidate
 * position, so the composition's strictness behaviour is observable.
 */
function makeRecordRepo(bestByIndex: ReadonlyArray<number | null>) {
  return {
    findCurrentPersonalBests: vi.fn<PersonalRecordRepository['findCurrentPersonalBests']>(),
    findCurrentPersonalBestsSetBetween:
      vi.fn<PersonalRecordRepository['findCurrentPersonalBestsSetBetween']>(),
    findBestValuesBefore: vi
      .fn<PersonalRecordRepository['findBestValuesBefore']>()
      .mockImplementation(async (_userId, candidates) =>
        candidates.map((candidate, index): CandidatePriorBest => ({
          candidate,
          bestBefore: bestByIndex[index] ?? null,
        })),
      ),
  } satisfies PersonalRecordRepository;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GetCompletedSessionRecordEventsUseCase', () => {
  it('extracts the session’s candidates and asks for the exact best before each', async () => {
    const session = completedSession({
      logs: [{ authored: 'ex-001', type: 'reps', sets: [{ weightKg: 50 }, { weightKg: 55 }] }],
    });
    const historyRepo = makeHistoryRepo(context(session));
    const recordRepo = makeRecordRepo([null, 50]);
    const useCase = new GetCompletedSessionRecordEventsUseCase(historyRepo, recordRepo);

    await useCase.execute({ userId: 'user-a', sessionId: 'session-1' });

    expect(recordRepo.findBestValuesBefore).toHaveBeenCalledTimes(1);
    const call = recordRepo.findBestValuesBefore.mock.calls[0];
    expect(call?.[0]).toBe(uid('user-a'));
    // The exact candidates the Domain extracted, in position order.
    expect(
      (call?.[1] ?? []).map(
        (candidate) => `${candidate.position.exerciseOrder}#${candidate.position.setNumber}`,
      ),
    ).toEqual(['1#1', '1#2']);
  });

  it('treats a first exposure as an event with no previous best', async () => {
    const session = completedSession({
      logs: [{ authored: 'ex-001', type: 'reps', sets: [{ weightKg: 50 }] }],
    });
    const useCase = new GetCompletedSessionRecordEventsUseCase(
      makeHistoryRepo(context(session)),
      makeRecordRepo([null]),
    );

    const result = await useCase.execute({ userId: 'user-a', sessionId: 'session-1' });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toEqual([
      { exerciseOrder: 1, setNumber: 1, metric: 'max-load', value: 50, previousBest: null },
    ]);
  });

  it('composes the strictness rule: strictly greater is an event, equal and lower are not', async () => {
    const session = completedSession({
      logs: [
        {
          authored: 'ex-001',
          type: 'reps',
          sets: [
            { weightKg: 50 },
            { weightKg: 55 },
            { weightKg: 55 },
            { weightKg: 40 },
            { weightKg: 60 },
          ],
        },
      ],
    });
    const useCase = new GetCompletedSessionRecordEventsUseCase(
      makeHistoryRepo(context(session)),
      // best strictly before each candidate, indexed by position
      makeRecordRepo([null, 50, 55, 50, 55]),
    );

    const result = await useCase.execute({ userId: 'user-a', sessionId: 'session-1' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(
      result.data.map(
        (event) => `${event.setNumber}:${event.value}/${event.previousBest ?? 'none'}`,
      ),
    ).toEqual(['1:50/none', '2:55/50', '5:60/55']);
  });

  it('returns an empty list without querying best-before when there are no candidates', async () => {
    const session = completedSession({
      logs: [{ authored: 'ex-001', type: 'reps', sets: [{ weightKg: 50 }] }],
    });
    // A completed aggregate whose logged sets are gone: unreachable through the
    // domain write path (completion requires a logged set), but the use case
    // must still answer truthfully and skip the best-before read entirely.
    const withoutSets = {
      ...session,
      exerciseLogs: session.exerciseLogs.map((log) => ({ ...log, sets: [] })),
    };
    const recordRepo = makeRecordRepo([]);
    const useCase = new GetCompletedSessionRecordEventsUseCase(
      makeHistoryRepo(context(withoutSets)),
      recordRepo,
    );

    const result = await useCase.execute({ userId: 'user-a', sessionId: 'session-1' });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toEqual([]);
    expect(recordRepo.findBestValuesBefore).not.toHaveBeenCalled();
  });

  it('preserves the exact (exerciseOrder, setNumber) position and metric of each event', async () => {
    const session = completedSession({
      logs: [
        { authored: 'ex-001', type: 'reps', sets: [{ weightKg: 50 }] },
        { authored: 'ex-002', type: 'duration', sets: [{}] },
      ],
    });
    const useCase = new GetCompletedSessionRecordEventsUseCase(
      makeHistoryRepo(context(session)),
      makeRecordRepo([null, null]),
    );

    const result = await useCase.execute({ userId: 'user-a', sessionId: 'session-1' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data).toEqual([
      { exerciseOrder: 1, setNumber: 1, metric: 'max-load', value: 50, previousBest: null },
      { exerciseOrder: 2, setNumber: 1, metric: 'max-duration', value: 45, previousBest: null },
    ]);
  });



  it('attributes candidates to the PERFORMED exercise of a substituted occurrence', async () => {
    const session = completedSession({
      logs: [{ authored: 'ex-001', performed: 'ex-002', type: 'reps', sets: [{ weightKg: 70 }] }],
    });
    const recordRepo = makeRecordRepo([null]);
    const useCase = new GetCompletedSessionRecordEventsUseCase(
      makeHistoryRepo(context(session)),
      recordRepo,
    );

    await useCase.execute({ userId: 'user-a', sessionId: 'session-1' });

    const candidates = recordRepo.findBestValuesBefore.mock.calls[0]?.[1] ?? [];
    expect(candidates.map((candidate) => candidate.exerciseId)).toEqual([eid('ex-002')]);
  });

  it('keeps both occurrences of a duplicated exercise distinct by position', async () => {
    const session = completedSession({
      logs: [
        { authored: 'ex-001', type: 'reps', sets: [{ weightKg: 80 }] },
        { authored: 'ex-001', type: 'reps', sets: [{ weightKg: 85 }] },
      ],
    });
    const useCase = new GetCompletedSessionRecordEventsUseCase(
      makeHistoryRepo(context(session)),
      makeRecordRepo([null, 80]),
    );

    const result = await useCase.execute({ userId: 'user-a', sessionId: 'session-1' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.map((event) => `${event.exerciseOrder}#${event.setNumber}`)).toEqual([
      '1#1',
      '2#1',
    ]);
  });

  it('returns SESSION_NOT_FOUND for a missing, foreign or in-progress session', async () => {
    const recordRepo = makeRecordRepo([]);
    const useCase = new GetCompletedSessionRecordEventsUseCase(makeHistoryRepo(null), recordRepo);

    const result = await useCase.execute({ userId: 'user-a', sessionId: 'session-1' });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('SESSION_NOT_FOUND');
    expect(recordRepo.findBestValuesBefore).not.toHaveBeenCalled();
  });

  it('rejects malformed input before touching any repository', async () => {
    const historyRepo = makeHistoryRepo(null);
    const recordRepo = makeRecordRepo([]);
    const useCase = new GetCompletedSessionRecordEventsUseCase(historyRepo, recordRepo);

    const badUser = await useCase.execute({ userId: ' ', sessionId: 'session-1' });
    const badSession = await useCase.execute({ userId: 'user-a', sessionId: ' ' });

    expect(badUser.ok).toBe(false);
    expect(badSession.ok).toBe(false);
    expect(historyRepo.findCompletedSessionById).not.toHaveBeenCalled();
    expect(recordRepo.findBestValuesBefore).not.toHaveBeenCalled();
  });

  it('treats a session the Domain refuses as corrupt data, never as “no records”', async () => {
    const session = completedSession({
      logs: [{ authored: 'ex-001', type: 'reps', sets: [{ weightKg: 50 }] }],
    });
    // Simulates a port violation: the completed-only contract guarantees a
    // completed aggregate, and the use case must not silently degrade if one
    // arrives in progress.
    const inProgress = { ...session, completedAt: null } as unknown as CompletedWorkoutSession;
    const useCase = new GetCompletedSessionRecordEventsUseCase(
      makeHistoryRepo(context(inProgress)),
      makeRecordRepo([]),
    );

    await expect(useCase.execute({ userId: 'user-a', sessionId: 'session-1' })).rejects.toThrow(
      /Corrupt data in completed session/,
    );
  });
});
