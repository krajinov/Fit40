import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { GetExerciseHistoryUseCase } from '@/application/use-cases/get-exercise-history';
import { GetTrainingProgressActivityUseCase } from '@/application/use-cases/get-training-progress-activity';
import { GetTrainingProgressRecordEventsUseCase } from '@/application/use-cases/get-training-progress-record-events';

import { exerciseId, prSession, savePrSessions, seedUser, userId } from './personal-record-fixtures';
import { closeDatabase, exerciseRepository, personalRecordRepository, resetAndSeed, trainingHistoryRepository } from './setup';

const OWNER = 'period-boundary-owner';
const BEFORE = new Date('2026-09-28T00:00:00.000Z');
// Request captured before completion of the last in-period set. This exercises
// concurrent completion, not an artificial cutoff at the request instant.
const NOW = new Date(BEFORE.getTime() - 2);
const SINCE = new Date('2026-06-29T00:00:00.000Z');
const history = new GetExerciseHistoryUseCase(trainingHistoryRepository, exerciseRepository, personalRecordRepository);
const activity = new GetTrainingProgressActivityUseCase(trainingHistoryRepository);
const records = new GetTrainingProgressRecordEventsUseCase(trainingHistoryRepository, personalRecordRepository, exerciseRepository);

beforeEach(async () => {
  await resetAndSeed();
  await seedUser(OWNER);
  await savePrSessions(...[
    { id: 'first', at: '2026-09-24T10:00:00.000Z', load: 10 },
    { id: 'before-end', at: '2026-09-27T23:59:59.999Z', load: 20 },
    { id: 'at-end', at: BEFORE.toISOString(), load: 30 },
    { id: 'after-end', at: '2026-09-28T00:00:00.001Z', load: 40 },
  ].map((entry) => prSession({
    id: entry.id, userId: OWNER,
    startedAt: new Date(Date.parse(entry.at) - 3_600_000).toISOString(), completedAt: entry.at,
    logs: [{ exerciseId: 'ex-002', type: 'reps', sets: [{ reps: 8, weightKg: entry.load }] }],
  })));
});
afterAll(closeDatabase);

describe('M18 request period across Monday UTC', () => {
  it('keeps all repository period reads inside the same exclusive end', async () => {
    const sessions = await trainingHistoryRepository.listCompletedSessionsSince(userId(OWNER), SINCE, BEFORE);
    const occurrences = await trainingHistoryRepository.listCompletedExerciseOccurrencesSince(userId(OWNER), exerciseId('ex-002'), SINCE, BEFORE);
    const rows = await trainingHistoryRepository.listProgressSessionActivity(userId(OWNER), SINCE, BEFORE);
    expect(sessions.map((session) => session.id)).toEqual(['first', 'before-end']);
    expect(occurrences.map((entry) => entry.sessionId)).toEqual(['first', 'before-end']);
    expect(rows.map((entry) => entry.sessionId)).toEqual(['before-end', 'first']);
  });

  it('counts only current-period PRs and compares the last in-period working load', async () => {
    const [activityResult, recordResult, historyResult] = await Promise.all([
      activity.execute({ userId: OWNER, now: NOW }),
      records.execute({ userId: OWNER, now: NOW }),
      history.execute({ userId: OWNER, slug: 'goblet-squat', now: NOW }),
    ]);
    if (!activityResult.ok || !recordResult.ok || !historyResult.ok) throw new Error('Unexpected use-case failure');
    expect(activityResult.data.totals.completedWorkouts).toBe(2);
    expect(activityResult.data.totals.loggedSets).toBe(2);
    expect(activityResult.data.totals.externalLoadVolumeKgReps).toBe(240);
    expect(activityResult.data.weeks[12]?.completedWorkouts).toBe(2);
    expect(activityResult.data.average).toBeNull();
    expect(recordResult.data.recordEventCount).toBe(2);
    expect(recordResult.data.events.map((event) => event.sessionId)).toEqual(['first', 'before-end']);
    expect(historyResult.data.comparison).toEqual({
      status: 'compared', direction: 'increased',
      first: { loadKg: 10, completedAt: '2026-09-24T10:00:00.000Z' },
      latest: { loadKg: 20, completedAt: '2026-09-27T23:59:59.999Z' },
    });
    // All-time history and current bests keep their existing semantics.
    expect(historyResult.data.entries.map((entry) => entry.sessionId)).toContain('at-end');
  });

  it('excludes next-period working loads while retaining the all-time display', async () => {
    const result = await history.execute({ userId: OWNER, slug: 'goblet-squat', now: NOW });
    if (!result.ok) throw new Error('Unexpected use-case failure');
    expect(result.data.comparison).toMatchObject({
      status: 'compared', latest: { loadKg: 20, completedAt: '2026-09-27T23:59:59.999Z' },
    });
    expect(result.data.entries.map((entry) => entry.sessionId)).toContain('at-end');
  });

  it('moves the exact Monday boundary into the new current week for a new request', async () => {
    const [activityResult, recordResult, historyResult] = await Promise.all([
      activity.execute({ userId: OWNER, now: BEFORE }),
      records.execute({ userId: OWNER, now: BEFORE }),
      history.execute({ userId: OWNER, slug: 'goblet-squat', now: BEFORE }),
    ]);
    if (!activityResult.ok || !recordResult.ok || !historyResult.ok) throw new Error('Unexpected use-case failure');
    expect(activityResult.data.currentWeekStart).toBe(BEFORE.toISOString());
    expect(activityResult.data.totals.completedWorkouts).toBe(4);
    expect(activityResult.data.weeks[11]?.completedWorkouts).toBe(2);
    expect(activityResult.data.weeks[12]?.completedWorkouts).toBe(2);
    expect(activityResult.data.average).toEqual({ workoutsPerWeek: 2, denominatorWeeks: 1 });
    expect(recordResult.data.recordEventCount).toBe(4);
    expect(historyResult.data.comparison).toMatchObject({
      status: 'compared', latest: { loadKg: 40, completedAt: '2026-09-28T00:00:00.001Z' },
    });
  });
});
