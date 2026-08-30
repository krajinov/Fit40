import { describe, expect, it } from 'vitest';

import { InMemoryWorkoutSessionRepository } from '@/infrastructure/sessions/in-memory-workout-session-repository';
import {
  completeWorkoutSession,
  createWorkoutSession,
  logSessionSet,
  type WorkoutSession,
} from '@/domain/entities/workout-session';
import { createDurationScheme, createRepScheme } from '@/domain/value-objects/rep-prescription';
import {
  createEnrollmentId,
  createExerciseId,
  createScheduledWorkoutId,
  createUserId,
  createWorkoutId,
} from '@/domain/types/ids';

function rep() { const r = createRepScheme(3, 8, 10); if (!r.ok) throw Error(); return r.data; }
function dur() { const r = createDurationScheme(3, 30); if (!r.ok) throw Error(); return r.data; }
function eid(v: string) { const r = createExerciseId(v); if (!r.ok) throw Error(); return r.data; }
function sid(v: string) { const r = createScheduledWorkoutId(v); if (!r.ok) throw Error(); return r.data; }
function wid(v: string) { const r = createWorkoutId(v); if (!r.ok) throw Error(); return r.data; }
function uid(v: string) { const r = createUserId(v); if (!r.ok) throw Error(); return r.data; }
function enid(v: string) { const r = createEnrollmentId(v); if (!r.ok) throw Error(); return r.data; }

/** reps of a set, narrowed for assertions (undefined for duration sets). */
function repsOf(set: { type: 'reps' | 'duration'; reps?: number } | undefined): number | undefined {
  return set?.type === 'reps' ? set.reps : undefined;
}

interface PerfSetSpec {
  readonly reps?: number;
  readonly durationSeconds?: number;
  readonly weightKg?: number | null;
  readonly rpe?: number | null;
}

interface PerfLogSpec {
  readonly exerciseId: string;
  readonly type: 'reps' | 'duration';
  readonly sets: ReadonlyArray<PerfSetSpec>;
}

interface PerfSessionSpec {
  readonly id: string;
  readonly userId?: string;
  readonly enrollmentId?: string | null;
  readonly startedAt: string;
  readonly completedAt?: string;
  readonly logs: ReadonlyArray<PerfLogSpec>;
}

/**
 * Builds a session with explicit per-exercise logged sets. Exercise orders
 * are assigned sequentially from 1 in the order the logs are given; set
 * types must match each log's prescription type.
 */
function openSession(spec: PerfSessionSpec): WorkoutSession {
  const created = createWorkoutSession({
    id: spec.id,
    userId: uid(spec.userId ?? 'user-1'),
    enrollmentId:
      spec.enrollmentId === undefined
        ? enid('enr-1')
        : spec.enrollmentId === null
          ? null
          : enid(spec.enrollmentId),
    scheduledWorkoutId: sid(`sw-${spec.id}`),
    workoutId: wid('w-1'),
    startedAt: new Date(spec.startedAt),
    exerciseLogs: spec.logs.map((log, index) => ({
      exerciseId: eid(log.exerciseId),
      order: index + 1,
      prescription: log.type === 'reps' ? rep() : dur(),
      restSeconds: 60,
    })),
  });
  if (!created.ok) throw Error();
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
              rpe: set.rpe ?? null,
            })
          : logSessionSet(session, {
              exerciseOrder: index + 1,
              type: 'duration',
              durationSeconds: set.durationSeconds ?? 30,
              weightKg: set.weightKg ?? null,
              rpe: set.rpe ?? null,
            });
      if (!logged.ok) throw Error();
      session = logged.data;
    }
  }
  return session;
}

/** `openSession` completed at the given timestamp. */
function perfSession(spec: PerfSessionSpec & { completedAt: string }): WorkoutSession {
  const done = completeWorkoutSession(openSession(spec), new Date(spec.completedAt));
  if (!done.ok) throw Error();
  return done.data;
}

describe('InMemoryWorkoutSessionRepository.listLatestCompletedExercisePerformances', () => {
  it('returns an empty result for an empty exercise id list', async () => {
    const repo = new InMemoryWorkoutSessionRepository();
    expect(await repo.listLatestCompletedExercisePerformances(uid('user-1'), [])).toEqual([]);
  });

  it('returns an empty result when the user has no completed history for the exercises', async () => {
    const repo = new InMemoryWorkoutSessionRepository();
    await repo.save(perfSession({
      id: 's-p1',
      startedAt: '2025-01-01T10:00:00Z',
      completedAt: '2025-01-01T11:00:00Z',
      logs: [{ exerciseId: 'ex-001', type: 'reps', sets: [{ reps: 10 }] }],
    }));

    const result = await repo.listLatestCompletedExercisePerformances(uid('user-1'), [eid('ex-404')]);
    expect(result).toEqual([]);
  });

  it('ignores in-progress sessions even when started more recently', async () => {
    const repo = new InMemoryWorkoutSessionRepository();
    const done = perfSession({
      id: 's-p-old',
      startedAt: '2025-01-01T09:00:00Z',
      completedAt: '2025-01-01T10:00:00Z',
      logs: [{ exerciseId: 'ex-001', type: 'reps', sets: [{ reps: 8 }] }],
    });
    await repo.save(done);
    await repo.save(openSession({
      id: 's-p-new',
      startedAt: '2025-06-01T09:00:00Z',
      logs: [{ exerciseId: 'ex-001', type: 'reps', sets: [{ reps: 9 }] }],
    }));

    const result = await repo.listLatestCompletedExercisePerformances(uid('user-1'), [eid('ex-001')]);
    expect(result).toHaveLength(1);
    expect(result[0]?.sessionId).toBe(done.id);
  });

  it('returns only the latest completed performance per exercise', async () => {
    const repo = new InMemoryWorkoutSessionRepository();
    await repo.save(perfSession({
      id: 's-p-jan',
      startedAt: '2025-01-01T10:00:00Z',
      completedAt: '2025-01-01T11:00:00Z',
      logs: [{ exerciseId: 'ex-001', type: 'reps', sets: [{ reps: 8, weightKg: 40 }] }],
    }));
    await repo.save(perfSession({
      id: 's-p-feb',
      startedAt: '2025-02-01T10:00:00Z',
      completedAt: '2025-02-01T11:00:00Z',
      logs: [{ exerciseId: 'ex-001', type: 'reps', sets: [{ reps: 10, weightKg: 50 }] }],
    }));

    const result = await repo.listLatestCompletedExercisePerformances(uid('user-1'), [eid('ex-001')]);
    expect(result).toHaveLength(1);
    expect(result[0]?.sessionId).toBe('s-p-feb');
    expect(result[0]?.completedAt).toEqual(new Date('2025-02-01T11:00:00Z'));
    expect(result[0]?.sets[0]?.weightKg).toBe(50);
  });

  it('breaks a completed_at tie by the later started_at', async () => {
    const repo = new InMemoryWorkoutSessionRepository();
    await repo.save(perfSession({
      id: 's-p-early',
      startedAt: '2025-01-01T08:00:00Z',
      completedAt: '2025-01-01T11:00:00Z',
      logs: [{ exerciseId: 'ex-001', type: 'reps', sets: [{ reps: 8 }] }],
    }));
    await repo.save(perfSession({
      id: 's-p-late',
      startedAt: '2025-01-01T09:00:00Z',
      completedAt: '2025-01-01T11:00:00Z',
      logs: [{ exerciseId: 'ex-001', type: 'reps', sets: [{ reps: 12 }] }],
    }));

    const result = await repo.listLatestCompletedExercisePerformances(uid('user-1'), [eid('ex-001')]);
    expect(result[0]?.sessionId).toBe('s-p-late');
    expect(repsOf(result[0]?.sets[0])).toBe(12);
  });

  it('breaks a full completed_at and started_at tie by the greater session id', async () => {
    const repo = new InMemoryWorkoutSessionRepository();
    await repo.save(perfSession({
      id: 's-p-tie-a',
      startedAt: '2025-01-01T08:00:00Z',
      completedAt: '2025-01-01T11:00:00Z',
      logs: [{ exerciseId: 'ex-001', type: 'reps', sets: [{ reps: 9 }] }],
    }));
    await repo.save(perfSession({
      id: 's-p-tie-z',
      startedAt: '2025-01-01T08:00:00Z',
      completedAt: '2025-01-01T11:00:00Z',
      logs: [{ exerciseId: 'ex-001', type: 'reps', sets: [{ reps: 11 }] }],
    }));

    const result = await repo.listLatestCompletedExercisePerformances(uid('user-1'), [eid('ex-001')]);
    expect(result).toHaveLength(1);
    expect(result[0]?.sessionId).toBe('s-p-tie-z');
    expect(repsOf(result[0]?.sets[0])).toBe(11);
  });

  it('resolves a repeated exercise within one session to the later exercise order', async () => {
    const repo = new InMemoryWorkoutSessionRepository();
    await repo.save(perfSession({
      id: 's-p-repeat',
      startedAt: '2025-01-01T10:00:00Z',
      completedAt: '2025-01-01T11:00:00Z',
      logs: [
        { exerciseId: 'ex-001', type: 'reps', sets: [{ reps: 9 }] },
        { exerciseId: 'ex-001', type: 'reps', sets: [{ reps: 12 }] },
      ],
    }));

    const result = await repo.listLatestCompletedExercisePerformances(uid('user-1'), [eid('ex-001')]);
    expect(result).toHaveLength(1);
    expect(result[0]?.exerciseOrder).toBe(2);
    expect(repsOf(result[0]?.sets[0])).toBe(12);
  });

  it('falls back to an older real performance when the newest session skipped the exercise', async () => {
    const repo = new InMemoryWorkoutSessionRepository();
    await repo.save(perfSession({
      id: 's-p-skip-old',
      startedAt: '2025-01-01T10:00:00Z',
      completedAt: '2025-01-01T11:00:00Z',
      logs: [{ exerciseId: 'ex-001', type: 'reps', sets: [{ reps: 8, weightKg: 40 }] }],
    }));
    await repo.save(perfSession({
      id: 's-p-skip-new',
      startedAt: '2025-03-01T10:00:00Z',
      completedAt: '2025-03-01T11:00:00Z',
      logs: [
        // ex-001 skipped; ex-002 has a set so the session completes legally.
        { exerciseId: 'ex-001', type: 'reps', sets: [] },
        { exerciseId: 'ex-002', type: 'reps', sets: [{ reps: 10 }] },
      ],
    }));

    const result = await repo.listLatestCompletedExercisePerformances(uid('user-1'), [eid('ex-001')]);
    expect(result).toHaveLength(1);
    expect(result[0]?.sessionId).toBe('s-p-skip-old');
    expect(result[0]?.sets[0]?.weightKg).toBe(40);
  });

  it('returns an empty result when the only history for an exercise is a skipped log', async () => {
    const repo = new InMemoryWorkoutSessionRepository();
    // Completable because ex-002 has a set; ex-005 is skipped (zero-set log).
    await repo.save(perfSession({
      id: 's-p-skip-only',
      startedAt: '2025-01-01T10:00:00Z',
      completedAt: '2025-01-01T11:00:00Z',
      logs: [
        { exerciseId: 'ex-002', type: 'reps', sets: [{ reps: 10 }] },
        { exerciseId: 'ex-005', type: 'reps', sets: [] },
      ],
    }));

    const result = await repo.listLatestCompletedExercisePerformances(uid('user-1'), [eid('ex-005')]);
    expect(result).toEqual([]);
  });


  it('returns the performed exercise but not the skipped one from the same completed session', async () => {
    const repo = new InMemoryWorkoutSessionRepository();
    // Completable because ex-002 has a set; ex-005 is skipped (zero-set log).
    await repo.save(perfSession({
      id: 's-p-skip-mixed',
      startedAt: '2025-01-01T10:00:00Z',
      completedAt: '2025-01-01T11:00:00Z',
      logs: [
        { exerciseId: 'ex-002', type: 'reps', sets: [{ reps: 10 }] },
        { exerciseId: 'ex-005', type: 'reps', sets: [] },
      ],
    }));

    const result = await repo.listLatestCompletedExercisePerformances(uid('user-1'), [eid('ex-002'), eid('ex-005')]);
    expect(result.map((p) => p.exerciseId)).toEqual(['ex-002']);
    expect(result[0]?.sessionId).toBe('s-p-skip-mixed');
  });


  it('keeps the performed occurrence when a repeated exercise is skipped later in the same session', async () => {
    const repo = new InMemoryWorkoutSessionRepository();
    await repo.save(perfSession({
      id: 's-p-skip-repeat-tail',
      startedAt: '2025-01-01T10:00:00Z',
      completedAt: '2025-01-01T11:00:00Z',
      logs: [
        { exerciseId: 'ex-001', type: 'reps', sets: [{ reps: 8 }] },
        { exerciseId: 'ex-001', type: 'reps', sets: [] },
        { exerciseId: 'ex-002', type: 'reps', sets: [{ reps: 10 }] },
      ],
    }));

    const result = await repo.listLatestCompletedExercisePerformances(uid('user-1'), [eid('ex-001')]);
    expect(result).toHaveLength(1);
    expect(result[0]?.exerciseOrder).toBe(1);
    expect(repsOf(result[0]?.sets[0])).toBe(8);
  });

  it('resolves to the performed occurrence when an earlier repeat of the exercise was skipped', async () => {
    const repo = new InMemoryWorkoutSessionRepository();
    await repo.save(perfSession({
      id: 's-p-skip-repeat-head',
      startedAt: '2025-01-01T10:00:00Z',
      completedAt: '2025-01-01T11:00:00Z',
      logs: [
        { exerciseId: 'ex-001', type: 'reps', sets: [] },
        { exerciseId: 'ex-001', type: 'reps', sets: [{ reps: 12 }] },
      ],
    }));

    const result = await repo.listLatestCompletedExercisePerformances(uid('user-1'), [eid('ex-001')]);
    expect(result).toHaveLength(1);
    expect(result[0]?.exerciseOrder).toBe(2);
    expect(repsOf(result[0]?.sets[0])).toBe(12);
  });

  it('falls back per exercise in a batch when the newest session skipped one of them', async () => {
    const repo = new InMemoryWorkoutSessionRepository();
    await repo.save(perfSession({
      id: 's-p-skip-batch-old',
      startedAt: '2025-01-01T10:00:00Z',
      completedAt: '2025-01-01T11:00:00Z',
      logs: [
        { exerciseId: 'ex-002', type: 'reps', sets: [{ reps: 8, weightKg: 40 }] },
        { exerciseId: 'ex-005', type: 'reps', sets: [{ reps: 10 }] },
      ],
    }));
    await repo.save(perfSession({
      id: 's-p-skip-batch-new',
      startedAt: '2025-02-01T10:00:00Z',
      completedAt: '2025-02-01T11:00:00Z',
      logs: [
        { exerciseId: 'ex-002', type: 'reps', sets: [{ reps: 10, weightKg: 50 }] },
        { exerciseId: 'ex-005', type: 'reps', sets: [] },
        { exerciseId: 'ex-009', type: 'reps', sets: [{ reps: 12 }] },
      ],
    }));

    const result = await repo.listLatestCompletedExercisePerformances(uid('user-1'), [
      eid('ex-005'),
      eid('ex-009'),
      eid('ex-002'),
    ]);
    expect(result.map((p) => p.exerciseId)).toEqual(['ex-002', 'ex-005', 'ex-009']);
    expect(result[0]?.sessionId).toBe('s-p-skip-batch-new');
    expect(result[1]?.sessionId).toBe('s-p-skip-batch-old');
    expect(result[2]?.sessionId).toBe('s-p-skip-batch-new');
  });


  it('scopes to the owning user', async () => {
    const repo = new InMemoryWorkoutSessionRepository();
    await repo.save(perfSession({
      id: 's-p-a1',
      userId: 'user-a',
      startedAt: '2025-01-01T10:00:00Z',
      completedAt: '2025-01-01T11:00:00Z',
      logs: [{ exerciseId: 'ex-001', type: 'reps', sets: [{ reps: 8 }] }],
    }));
    await repo.save(perfSession({
      id: 's-p-b1',
      userId: 'user-b',
      startedAt: '2025-02-01T10:00:00Z',
      completedAt: '2025-02-01T11:00:00Z',
      logs: [{ exerciseId: 'ex-001', type: 'reps', sets: [{ reps: 12 }] }],
    }));

    const forA = await repo.listLatestCompletedExercisePerformances(uid('user-a'), [eid('ex-001')]);
    expect(forA).toHaveLength(1);
    expect(forA[0]?.sessionId).toBe('s-p-a1');

    const forB = await repo.listLatestCompletedExercisePerformances(uid('user-b'), [eid('ex-001')]);
    expect(forB).toHaveLength(1);
    expect(forB[0]?.sessionId).toBe('s-p-b1');
  });

  it('includes detached (left-program) sessions as history', async () => {
    const repo = new InMemoryWorkoutSessionRepository();
    const enrolled = perfSession({
      id: 's-p-enrolled',
      enrollmentId: 'enr-old',
      startedAt: '2025-01-01T10:00:00Z',
      completedAt: '2025-01-01T11:00:00Z',
      logs: [{ exerciseId: 'ex-001', type: 'reps', sets: [{ reps: 8 }] }],
    });
    const detached = perfSession({
      id: 's-p-detached',
      enrollmentId: null,
      startedAt: '2025-02-01T10:00:00Z',
      completedAt: '2025-02-01T11:00:00Z',
      logs: [{ exerciseId: 'ex-001', type: 'reps', sets: [{ reps: 10 }] }],
    });
    await repo.save(enrolled);
    await repo.save(detached);

    const result = await repo.listLatestCompletedExercisePerformances(uid('user-1'), [eid('ex-001')]);
    expect(result).toHaveLength(1);
    expect(result[0]?.sessionId).toBe(detached.id);
  });

  it('projects the prescription snapshot and ordered sets of the winning log', async () => {
    const repo = new InMemoryWorkoutSessionRepository();
    await repo.save(perfSession({
      id: 's-p-proj',
      startedAt: '2025-01-01T10:00:00Z',
      completedAt: '2025-01-01T11:00:00Z',
      logs: [
        { exerciseId: 'ex-001', type: 'reps', sets: [{ reps: 8, weightKg: 40, rpe: 7 }, { reps: 10, weightKg: 45, rpe: 8 }] },
        { exerciseId: 'ex-002', type: 'duration', sets: [{ durationSeconds: 30 }] },
      ],
    }));

    const result = await repo.listLatestCompletedExercisePerformances(uid('user-1'), [eid('ex-001'), eid('ex-002')]);
    expect(result).toHaveLength(2);

    const squat = result.find((p) => p.exerciseId === 'ex-001');
    expect(squat?.prescription).toEqual({ type: 'reps', sets: 3, minReps: 8, maxReps: 10 });
    expect(squat?.sets.map((s) => (s.type === 'reps' ? s.reps : null))).toEqual([8, 10]);

    const hold = result.find((p) => p.exerciseId === 'ex-002');
    expect(hold?.prescription).toEqual({ type: 'duration', sets: 3, seconds: 30 });
    expect(hold?.sets[0]).toMatchObject({ type: 'duration', durationSeconds: 30 });
  });

  it('orders the result by exercise id ascending', async () => {
    const repo = new InMemoryWorkoutSessionRepository();
    await repo.save(perfSession({
      id: 's-p-multi',
      startedAt: '2025-01-01T10:00:00Z',
      completedAt: '2025-01-01T11:00:00Z',
      logs: [
        { exerciseId: 'ex-009', type: 'reps', sets: [{ reps: 8 }] },
        { exerciseId: 'ex-002', type: 'reps', sets: [{ reps: 10 }] },
        { exerciseId: 'ex-005', type: 'reps', sets: [{ reps: 12 }] },
      ],
    }));

    const result = await repo.listLatestCompletedExercisePerformances(uid('user-1'), [
      eid('ex-009'),
      eid('ex-002'),
      eid('ex-005'),
    ]);
    expect(result.map((p) => p.exerciseId)).toEqual(['ex-002', 'ex-005', 'ex-009']);
  });

  it('returns an isolated snapshot: mutating the projection does not affect stored sessions', async () => {
    const repo = new InMemoryWorkoutSessionRepository();
    await repo.save(perfSession({
      id: 's-p-iso',
      startedAt: '2025-01-01T10:00:00Z',
      completedAt: '2025-01-01T11:00:00Z',
      logs: [{ exerciseId: 'ex-001', type: 'reps', sets: [{ reps: 10, weightKg: 50 }] }],
    }));

    const first = await repo.listLatestCompletedExercisePerformances(uid('user-1'), [eid('ex-001')]);
    const projection = first[0];
    if (projection === undefined) throw Error();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- testing mutation isolation
    (projection as any).completedAt = new Date('2099-01-01');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- testing mutation isolation
    (projection as any).sets = [];

    const second = await repo.listLatestCompletedExercisePerformances(uid('user-1'), [eid('ex-001')]);
    expect(second[0]?.completedAt).toEqual(new Date('2025-01-01T11:00:00Z'));
    expect(second[0]?.sets).toHaveLength(1);
    expect(second[0]?.sets[0]?.weightKg).toBe(50);
  });
});

