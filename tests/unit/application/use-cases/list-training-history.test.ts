import { describe, expect, it, vi } from 'vitest';

import { ListTrainingHistoryUseCase } from '@/application/use-cases/list-training-history';
import { GetTrainingTotalsUseCase } from '@/application/use-cases/get-training-totals';
import {
  encodeTrainingHistoryCursor,
  toTrainingHistorySessionDto,
} from '@/application/dto/training-history';
import type {
  TrainingHistoryEntry,
  TrainingHistoryPage,
  TrainingHistoryRepository,
  TrainingHistoryTotals,
} from '@/application/ports/training-history-repository';
import { createWorkoutSession, completeWorkoutSession, logSessionSet } from '@/domain/entities/workout-session';
import { createExerciseId, createScheduledWorkoutId, createUserId, createWorkoutId } from '@/domain/types/ids';
import { createRepScheme } from '@/domain/value-objects/rep-prescription';

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
function rep() {
  const r = createRepScheme(3, 8, 10);
  if (!r.ok) throw new Error(r.error.message);
  return r.data;
}

function makeCompletedSession(id: string, completedAt: Date) {
  const created = createWorkoutSession({
    id,
    userId: uid('user-a'),
    enrollmentId: null,
    scheduledWorkoutId: swid('sched-wo1'),
    workoutId: wid('wo-1'),
    startedAt: new Date('2026-01-01T10:00:00Z'),
    exerciseLogs: [{ exerciseId: eid('ex-001'), order: 1, prescription: rep(), restSeconds: 60 }],
  });
  if (!created.ok) throw new Error(created.error.message);
  const withSet = logSessionSet(created.data, {
    exerciseOrder: 1,
    type: 'reps',
    reps: 10,
    weightKg: 40,
    rpe: 7,
  });
  if (!withSet.ok) throw new Error(withSet.error.message);
  const completed = completeWorkoutSession(withSet.data, completedAt);
  if (!completed.ok) throw new Error(completed.error.message);
  return completed.data;
}

function makeEntry(id: string, completedAt: Date): TrainingHistoryEntry {
  return {
    session: { ...makeCompletedSession(id, completedAt), completedAt },
    programName: 'Fit40 Beginner Strength',
    workoutName: 'Full Body A',
  };
}

function pageOf(
  entries: ReadonlyArray<TrainingHistoryEntry>,
  nextAfter: TrainingHistoryPage['nextAfter'] = null,
): TrainingHistoryPage {
  return { entries, nextAfter };
}

function makeHistoryRepo(
  page: TrainingHistoryPage = pageOf([]),
  totals: TrainingHistoryTotals = { completedSessions: 0, loggedSets: 0 },
) {
  return {
    listCompletedSessions: vi.fn().mockResolvedValue(page),
    listCompletedExerciseOccurrences: vi.fn().mockResolvedValue([]),
    getTotals: vi.fn().mockResolvedValue(totals),
    findCompletedSessionById: vi.fn().mockResolvedValue(null),
  } satisfies TrainingHistoryRepository;
}

describe('ListTrainingHistoryUseCase', () => {
  it('returns an empty first page for a user with no history', async () => {
    const repo = makeHistoryRepo();
    const uc = new ListTrainingHistoryUseCase(repo);

    const result = await uc.execute({ userId: 'user-a' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.sessions).toEqual([]);
    expect(result.data.nextCursor).toBeNull();
    expect(repo.listCompletedSessions).toHaveBeenCalledWith(uid('user-a'), {
      limit: 20,
      after: null,
    });
  });

  it('maps entries to DTOs with non-null completedAt and computed metrics', async () => {
    const completedAt = new Date('2026-02-15T11:00:00Z');
    const repo = makeHistoryRepo(pageOf([makeEntry('session-1', completedAt)]));
    const uc = new ListTrainingHistoryUseCase(repo);

    const result = await uc.execute({ userId: 'user-a' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const expected = toTrainingHistorySessionDto(makeEntry('session-1', completedAt));
    expect(result.data.sessions).toHaveLength(1);
    expect(result.data.sessions[0]?.completedAt).toBe(completedAt.toISOString());
    expect(result.data.sessions[0]?.workoutName).toBe('Full Body A');
    expect(result.data.sessions[0]?.programName).toBe('Fit40 Beginner Strength');
    expect(result.data.sessions[0]?.metrics).toEqual(expected.metrics);
  });
});
describe('ListTrainingHistoryUseCase — pagination', () => {
  it('encodes nextAfter into the opaque nextCursor', async () => {
    const last = makeEntry('session-1', new Date('2026-02-15T11:00:00Z'));
    const repo = makeHistoryRepo(
      pageOf([last], {
        completedAt: last.session.completedAt,
        startedAt: last.session.startedAt,
        sessionId: last.session.id,
      }),
    );
    const uc = new ListTrainingHistoryUseCase(repo);

    const result = await uc.execute({ userId: 'user-a' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.nextCursor).toBe(
      encodeTrainingHistoryCursor({
        completedAt: last.session.completedAt,
        startedAt: last.session.startedAt,
        sessionId: last.session.id,
      }),
    );
  });

  it('passes the decoded cursor to the repository as the resume position', async () => {
    const anchor = makeEntry('session-9', new Date('2026-02-15T11:00:00Z'));
    const cursor = {
      completedAt: anchor.session.completedAt,
      startedAt: anchor.session.startedAt,
      sessionId: anchor.session.id,
    };
    const repo = makeHistoryRepo();
    const uc = new ListTrainingHistoryUseCase(repo);

    const result = await uc.execute({
      userId: 'user-a',
      cursor: encodeTrainingHistoryCursor(cursor),
    });
    expect(result.ok).toBe(true);
    expect(repo.listCompletedSessions).toHaveBeenCalledWith(uid('user-a'), {
      limit: 20,
      after: cursor,
    });
  });

  it('rejects a tampered cursor with INVALID_INPUT before touching the repository', async () => {
    const repo = makeHistoryRepo();
    const uc = new ListTrainingHistoryUseCase(repo);

    const result = await uc.execute({
      userId: 'user-a',
      cursor: Buffer.from(JSON.stringify({ v: 99 }), 'utf8').toString('base64url'),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('INVALID_INPUT');
    expect(result.error.field).toBe('cursor');
    expect(repo.listCompletedSessions).not.toHaveBeenCalled();
  });

  it('rejects a non-integer limit with INVALID_INPUT', async () => {
    const repo = makeHistoryRepo();
    const uc = new ListTrainingHistoryUseCase(repo);

    const result = await uc.execute({ userId: 'user-a', limit: 3.5 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('INVALID_INPUT');
    expect(result.error.field).toBe('limit');
    expect(repo.listCompletedSessions).not.toHaveBeenCalled();
  });

  it('clamps out-of-range integer limits before querying', async () => {
    const repo = makeHistoryRepo();
    const uc = new ListTrainingHistoryUseCase(repo);

    await uc.execute({ userId: 'user-a', limit: 0 });
    expect(repo.listCompletedSessions).toHaveBeenLastCalledWith(uid('user-a'), {
      limit: 1,
      after: null,
    });

    await uc.execute({ userId: 'user-a', limit: 999 });
    expect(repo.listCompletedSessions).toHaveBeenLastCalledWith(uid('user-a'), {
      limit: 50,
      after: null,
    });
  });

  it('rejects an empty userId with INVALID_INPUT', async () => {
    const repo = makeHistoryRepo();
    const uc = new ListTrainingHistoryUseCase(repo);

    const result = await uc.execute({ userId: '  ' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('INVALID_INPUT');
    expect(result.error.field).toBe('userId');
  });

  it('treats a null cursor as a first page', async () => {
    const repo = makeHistoryRepo();
    const uc = new ListTrainingHistoryUseCase(repo);

    const result = await uc.execute({ userId: 'user-a', cursor: null });
    expect(result.ok).toBe(true);
    expect(repo.listCompletedSessions).toHaveBeenCalledWith(uid('user-a'), {
      limit: 20,
      after: null,
    });
  });
});

describe('GetTrainingTotalsUseCase', () => {
  it('returns the repository totals for the user', async () => {
    const repo = makeHistoryRepo(pageOf([]), { completedSessions: 7, loggedSets: 63 });
    const uc = new GetTrainingTotalsUseCase(repo);

    const result = await uc.execute('user-a');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toEqual({ completedSessions: 7, loggedSets: 63 });
    expect(repo.getTotals).toHaveBeenCalledWith(uid('user-a'));
  });

  it('rejects an invalid userId with INVALID_INPUT', async () => {
    const repo = makeHistoryRepo();
    const uc = new GetTrainingTotalsUseCase(repo);

    const result = await uc.execute('');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('INVALID_INPUT');
    expect(repo.getTotals).not.toHaveBeenCalled();
  });
});

