/**
 * Unit tests for the MoveSessionExerciseUseCase (M10 Slice 5): the guard
 * chain around the domain's adjacent swap — validate → load → ownership →
 * enrollment → domain invariants → optimistic-concurrency save — mirroring
 * the unskip use-case test template.
 */

import { describe, expect, it, vi } from 'vitest';
import { MoveSessionExerciseUseCase } from '@/application/use-cases/move-session-exercise';
import {
  SessionEnrollmentChangedError,
  SessionStaleVersionError,
} from '@/application/ports/workout-session-repository';
import { InMemoryWorkoutSessionRepository } from '@/infrastructure/sessions/in-memory-workout-session-repository';
import { completeWorkoutSession, createWorkoutSession, logSessionSet } from '@/domain/entities/workout-session';
import { skipSessionExercise } from '@/domain/services/session-exercise-adjustment';
import {
  createEnrollmentId,
  createExerciseId,
  createScheduledWorkoutId,
  createUserId,
  createWorkoutId,
  createWorkoutSessionId,
} from '@/domain/types/ids';
import { createRepScheme } from '@/domain/value-objects/rep-prescription';

function rep() { const r = createRepScheme(3, 8, 10); if (!r.ok) throw Error(); return r.data; }
function eid(v: string) { const r = createExerciseId(v); if (!r.ok) throw Error(); return r.data; }
function sid(v: string) { const r = createWorkoutSessionId(v); if (!r.ok) throw Error(); return r.data; }
function swid(v: string) { const r = createScheduledWorkoutId(v); if (!r.ok) throw Error(); return r.data; }
function wid(v: string) { const r = createWorkoutId(v); if (!r.ok) throw Error(); return r.data; }
function uid(v: string) { const r = createUserId(v); if (!r.ok) throw Error(); return r.data; }
function enid(v: string) { const r = createEnrollmentId(v); if (!r.ok) throw Error(); return r.data; }

const OWNER_ID = 'user-1';

/**
 * Builds and persists a three-occurrence in-progress session (orders 1..3,
 * exercises ex-001/002/003) so middle occurrences can move both directions
 * and every swap is observable through the authored exercise id.
 */
async function seedSession(
  ownerId: string = OWNER_ID,
  enrollmentId: string | null = 'enr-1',
) {
  const repo = new InMemoryWorkoutSessionRepository();
  const sr = createWorkoutSession({
    id: 's-1',
    userId: uid(ownerId),
    enrollmentId: enrollmentId === null ? null : enid(enrollmentId),
    scheduledWorkoutId: swid('sw-1'),
    workoutId: wid('w-1'),
    startedAt: new Date(),
    exerciseLogs: [
      { authoredExerciseId: eid('ex-001'), order: 1, prescription: rep(), restSeconds: 60 },
      { authoredExerciseId: eid('ex-002'), order: 2, prescription: rep(), restSeconds: 75 },
      { authoredExerciseId: eid('ex-003'), order: 3, prescription: rep(), restSeconds: 90 },
    ],
  });
  if (!sr.ok) throw Error();
  await repo.save(sr.data);
  return { repo, sessionId: sr.data.id as string };
}

describe('MoveSessionExerciseUseCase', () => {
  it('moves an occurrence up, persists the swap, and returns the updated DTO', async () => {
    const { repo, sessionId } = await seedSession();
    const uc = new MoveSessionExerciseUseCase(repo);

    const r = await uc.execute({ sessionId, userId: OWNER_ID, exerciseOrder: 2, direction: 'up' });

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // The DTO is canonical — position agrees with order — and reflects the
    // swap; the untouched third occurrence stays put.
    expect(r.data.exerciseLogs.map((e) => e.order)).toEqual([1, 2, 3]);
    expect(r.data.exerciseLogs.map((e) => e.authoredExerciseId)).toEqual([
      'ex-002',
      'ex-001',
      'ex-003',
    ]);

    // And the canonical swap persisted.
    const stored = await repo.findById(sid('s-1'));
    expect(stored?.exerciseLogs.map((e) => [e.order, e.authoredExerciseId])).toEqual([
      [1, 'ex-002'],
      [2, 'ex-001'],
      [3, 'ex-003'],
    ]);
  });

  it('rejects invalid input before touching the repository', async () => {
    const repo = new InMemoryWorkoutSessionRepository();
    const uc = new MoveSessionExerciseUseCase(repo);
    const findByIdSpy = vi.spyOn(repo, 'findById');

    const cases = [
      { sessionId: '', userId: OWNER_ID, exerciseOrder: 1, direction: 'up' as const },
      { sessionId: 's-1', userId: '', exerciseOrder: 1, direction: 'up' as const },
      { sessionId: 's-1', userId: OWNER_ID, exerciseOrder: 0, direction: 'up' as const },
      { sessionId: 's-1', userId: OWNER_ID, exerciseOrder: 2.5, direction: 'up' as const },
    ];
    for (const input of cases) {
      const r = await uc.execute(input);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe('INVALID_INPUT');
    }
    expect(findByIdSpy).not.toHaveBeenCalled();
  });

  it('returns SESSION_NOT_FOUND for an unknown session', async () => {
    const uc = new MoveSessionExerciseUseCase(new InMemoryWorkoutSessionRepository());
    const r = await uc.execute({ sessionId: 'unknown', userId: OWNER_ID, exerciseOrder: 1, direction: 'up' });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('SESSION_NOT_FOUND');
  });

  it('returns FORBIDDEN when the session belongs to another user', async () => {
    const { repo, sessionId } = await seedSession();
    const uc = new MoveSessionExerciseUseCase(repo);

    const r = await uc.execute({ sessionId, userId: 'user-2', exerciseOrder: 2, direction: 'up' });

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('FORBIDDEN');
    const untouched = await repo.findById(sid('s-1'));
    expect(untouched?.exerciseLogs.find((e) => e.order === 2)?.authoredExerciseId).toBe(eid('ex-002'));
  });

  it('rejects moving a detached session (enrollment nulled by leaving)', async () => {
    const { repo, sessionId } = await seedSession(OWNER_ID, null);
    const uc = new MoveSessionExerciseUseCase(repo);

    const r = await uc.execute({ sessionId, userId: OWNER_ID, exerciseOrder: 2, direction: 'up' });

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('NOT_ENROLLED');
    const untouched = await repo.findById(sid('s-1'));
    expect(untouched?.exerciseLogs.find((e) => e.order === 2)?.authoredExerciseId).toBe(eid('ex-002'));
  });

  it('rejects moving an occurrence of a completed session', async () => {
    const { repo, sessionId } = await seedSession();
    const loaded = await repo.findById(sid('s-1'));
    if (!loaded) throw Error();
    const withSet = logSessionSet(loaded, {
      exerciseOrder: 1, type: 'reps', reps: 10, weightKg: null, rpe: null,
    });
    if (!withSet.ok) throw Error();
    const completed = completeWorkoutSession(withSet.data, new Date());
    if (!completed.ok) throw Error();
    await repo.save(completed.data);
    const uc = new MoveSessionExerciseUseCase(repo);

    const r = await uc.execute({ sessionId, userId: OWNER_ID, exerciseOrder: 2, direction: 'up' });

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('SESSION_ALREADY_COMPLETED');
  });

  it('returns EXERCISE_LOG_NOT_FOUND for an unknown occurrence order', async () => {
    const { repo, sessionId } = await seedSession();
    const uc = new MoveSessionExerciseUseCase(repo);

    const r = await uc.execute({ sessionId, userId: OWNER_ID, exerciseOrder: 99, direction: 'up' });

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('EXERCISE_LOG_NOT_FOUND');
  });

  it('returns MOVE_OUT_OF_RANGE at the list boundaries', async () => {
    const { repo, sessionId } = await seedSession();
    const uc = new MoveSessionExerciseUseCase(repo);

    const up = await uc.execute({ sessionId, userId: OWNER_ID, exerciseOrder: 1, direction: 'up' });
    expect(up.ok).toBe(false);
    if (up.ok) return;
    expect(up.error.code).toBe('MOVE_OUT_OF_RANGE');

    const down = await uc.execute({ sessionId, userId: OWNER_ID, exerciseOrder: 3, direction: 'down' });
    expect(down.ok).toBe(false);
    if (down.ok) return;
    expect(down.error.code).toBe('MOVE_OUT_OF_RANGE');
  });

  it('moves a logged-set occurrence — sets never block a reorder', async () => {
    const { repo, sessionId } = await seedSession();
    const loaded = await repo.findById(sid('s-1'));
    if (!loaded) throw Error();
    const withSet = logSessionSet(loaded, {
      exerciseOrder: 2, type: 'reps', reps: 10, weightKg: 50, rpe: null,
    });
    if (!withSet.ok) throw Error();
    await repo.save(withSet.data);
    const uc = new MoveSessionExerciseUseCase(repo);

    const r = await uc.execute({ sessionId, userId: OWNER_ID, exerciseOrder: 2, direction: 'down' });

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // Canonical: the mover physically sits at index 2 (order 3).
    expect(r.data.exerciseLogs.map((e) => e.order)).toEqual([1, 2, 3]);
    expect(r.data.exerciseLogs.map((e) => e.authoredExerciseId)).toEqual([
      'ex-001',
      'ex-003',
      'ex-002',
    ]);
    // The whole occurrence — its logged set included — moved to order 3.
    const moved = r.data.exerciseLogs.find((e) => e.order === 3);
    expect(moved?.authoredExerciseId).toBe('ex-002');
    expect(moved?.sets).toHaveLength(1);
    const stored = await repo.findById(sid('s-1'));
    expect(stored?.exerciseLogs.map((e) => e.order)).toEqual([1, 2, 3]);
    expect(stored?.exerciseLogs.find((e) => e.order === 3)?.sets).toHaveLength(1);
  });

  it('moves a skipped occurrence — the skip decision never blocks a reorder', async () => {
    const { repo, sessionId } = await seedSession();
    const loaded = await repo.findById(sid('s-1'));
    if (!loaded) throw Error();
    const skipped = skipSessionExercise(loaded, { exerciseOrder: 3 });
    if (!skipped.ok) throw Error();
    await repo.save(skipped.data);
    const uc = new MoveSessionExerciseUseCase(repo);

    const r = await uc.execute({ sessionId, userId: OWNER_ID, exerciseOrder: 3, direction: 'up' });

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // Canonical: the skipped mover physically sits at index 1 (order 2).
    expect(r.data.exerciseLogs.map((e) => e.order)).toEqual([1, 2, 3]);
    expect(r.data.exerciseLogs.map((e) => e.authoredExerciseId)).toEqual([
      'ex-001',
      'ex-003',
      'ex-002',
    ]);
    const moved = r.data.exerciseLogs.find((e) => e.order === 2);
    expect(moved?.isSkipped).toBe(true);
    expect(moved?.authoredExerciseId).toBe('ex-003');
    const stored = await repo.findById(sid('s-1'));
    expect(stored?.exerciseLogs.map((e) => e.order)).toEqual([1, 2, 3]);
    expect(stored?.exerciseLogs.find((e) => e.order === 2)?.isSkipped).toBe(true);
  });

  it('maps a concurrent modification to SESSION_MODIFIED', async () => {
    const { repo, sessionId } = await seedSession();
    const saveSpy = vi.spyOn(repo, 'save').mockRejectedValue(new SessionStaleVersionError('s-1'));
    const uc = new MoveSessionExerciseUseCase(repo);

    const r = await uc.execute({ sessionId, userId: OWNER_ID, exerciseOrder: 2, direction: 'up' });

    saveSpy.mockRestore();
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('SESSION_MODIFIED');
  });

  it('maps an enrollment changed between load and save to NOT_ENROLLED', async () => {
    const { repo, sessionId } = await seedSession();
    const saveSpy = vi.spyOn(repo, 'save').mockRejectedValue(new SessionEnrollmentChangedError('s-1'));
    const uc = new MoveSessionExerciseUseCase(repo);

    const r = await uc.execute({ sessionId, userId: OWNER_ID, exerciseOrder: 2, direction: 'up' });

    saveSpy.mockRestore();
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('NOT_ENROLLED');
  });

  it('rethrows unexpected repository errors instead of swallowing them', async () => {
    const { repo, sessionId } = await seedSession();
    const saveSpy = vi.spyOn(repo, 'save').mockRejectedValue(new Error('db connection lost'));
    const uc = new MoveSessionExerciseUseCase(repo);

    await expect(
      uc.execute({ sessionId, userId: OWNER_ID, exerciseOrder: 2, direction: 'up' }),
    ).rejects.toThrow('db connection lost');

    saveSpy.mockRestore();
  });

  it('never performs an exercise catalog lookup', () => {
    // Reordering never changes the performed exercise, so the use case takes
    // ONLY the session repository (constructor arity 1) — there is no
    // catalog dependency to consult.
    expect(MoveSessionExerciseUseCase.length).toBe(1);
    new MoveSessionExerciseUseCase(new InMemoryWorkoutSessionRepository());
  });
});