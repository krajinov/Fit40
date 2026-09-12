/**
 * Shared stale-rendered-intent regression (PR #13 Finding 1): every
 * occurrence-addressed session mutation must reject a command that carries
 * the session version of a snapshot rendered BEFORE a concurrent mutation
 * — because `exerciseOrder` is mutable and may now identify a DIFFERENT
 * occurrence after a reorder — and the current occupant must stay untouched.
 *
 * One shared invariant, all eight occurrence-addressed commands:
 * skip, unskip, move, substitute, restore, log set, update set, delete set.
 * (Complete/start/issue are not occurrence-addressed and are out of scope.)
 *
 * Scenario per command (the reviewer's required shape):
 * 1. seed a two-occurrence session A(order 1), B(order 2) at version V
 * 2. a concurrent mutation (a move) reorders to B(1), A(2) and bumps the
 *    persisted version to V+1
 * 3. submit the command with exerciseOrder = 1 and expectedSessionVersion = V
 *    — the stale tab's rendered intent ("order 1 = A")
 * 4. expect SESSION_MODIFIED
 * 5. expect B (the current occupant of order 1) to remain untouched
 *
 * The mirror tests prove current-version commands still succeed.
 */

import { describe, expect, it } from 'vitest';

import type { ExerciseRepository } from '@/application/ports/exercise-repository';
import { DeleteSessionSetUseCase } from '@/application/use-cases/delete-session-set';
import { LogSessionSetUseCase } from '@/application/use-cases/log-session-set';
import { MoveSessionExerciseUseCase } from '@/application/use-cases/move-session-exercise';
import { RestoreSessionExerciseUseCase } from '@/application/use-cases/restore-session-exercise';
import { SkipSessionExerciseUseCase } from '@/application/use-cases/skip-session-exercise';
import { SubstituteSessionExerciseUseCase } from '@/application/use-cases/substitute-session-exercise';
import { UnskipSessionExerciseUseCase } from '@/application/use-cases/unskip-session-exercise';
import { UpdateSessionSetUseCase } from '@/application/use-cases/update-session-set';
import type { Exercise } from '@/domain/entities/exercise';
import { createWorkoutSession, type WorkoutSession } from '@/domain/entities/workout-session';
import { moveSessionExercise, skipSessionExercise } from '@/domain/services/session-exercise-adjustment';
import {
  createEnrollmentId,
  createExerciseId,
  createScheduledWorkoutId,
  createUserId,
  createWorkoutId,
} from '@/domain/types/ids';
import { createRepScheme } from '@/domain/value-objects/rep-prescription';
import { InMemoryWorkoutSessionRepository } from '@/infrastructure/sessions/in-memory-workout-session-repository';

function rep() {
  const r = createRepScheme(3, 8, 10);
  if (!r.ok) throw Error();
  return r.data;
}
function eid(v: string) {
  const r = createExerciseId(v);
  if (!r.ok) throw Error();
  return r.data;
}
function uid(v: string) {
  const r = createUserId(v);
  if (!r.ok) throw Error();
  return r.data;
}
function enid(v: string) {
  const r = createEnrollmentId(v);
  if (!r.ok) throw Error();
  return r.data;
}

const OWNER = 'user-1' as const;
const SESSION_ID = 's-stale' as const;

/** A minimal catalog stub satisfying the substitution use case's port. */
function makeExerciseRepo(ids: string[]): ExerciseRepository {
  return {
    async findByIds() {
      return ids.map(
        (id) =>
          ({
            id: eid(id),
            name: `Exercise ${id}`,
            slug: `exercise-${id}`,
            description: 'Test fixture exercise.',
            equipment: 'barbell',
            difficulty: 'beginner',
            primaryMuscle: 'chest',
            secondaryMuscles: [],
            movementPattern: 'horizontal-push',
            considerations: [],
          }) as unknown as Exercise,
      );
    },
  } as unknown as ExerciseRepository;
}

/**
 * Two distinguishable occurrences (A=ex-a, B=ex-b) so a reorder that swaps
 * them is observable in the persisted orders.
 */
function seedTwoOccurrenceSession(): WorkoutSession {
  const scheduled = createScheduledWorkoutId('sw-stale');
  if (!scheduled.ok) throw Error(scheduled.error.message);
  const workout = createWorkoutId('w-stale');
  if (!workout.ok) throw Error(workout.error.message);
  const seeded = createWorkoutSession({
    id: SESSION_ID,
    userId: uid(OWNER),
    enrollmentId: enid('enr-stale'),
    scheduledWorkoutId: scheduled.data,
    workoutId: workout.data,
    startedAt: new Date('2026-01-01T10:00:00Z'),
    exerciseLogs: [
      { authoredExerciseId: eid('ex-a'), order: 1, prescription: rep(), restSeconds: 60 },
      { authoredExerciseId: eid('ex-b'), order: 2, prescription: rep(), restSeconds: 90 },
    ],
  });
  if (!seeded.ok) throw Error(seeded.error.message);
  return seeded.data;
}

/**
 * Seeds the rendered state (V): A at order 1, B at order 2 — then applies the
 * concurrent reorder (B up ⇒ B order 1, A order 2, persisted version V+1).
 * Returns the repo plus the STALE rendered version (V) the old tab holds.
 */
async function seedAfterConcurrentReorder(): Promise<{
  repo: InMemoryWorkoutSessionRepository;
  renderedVersion: number;
}> {
  const repo = new InMemoryWorkoutSessionRepository();
  const seed = seedTwoOccurrenceSession();
  await repo.save(seed); // persisted version 0 = the rendered V

  // The OTHER tab's concurrent mutation: move B (order 2) up.
  const loaded = await repo.findById(seed.id);
  if (loaded === null) throw Error('seed session vanished');
  const moved = moveSessionExercise(loaded, { exerciseOrder: 2, direction: 'up' });
  if (!moved.ok) throw Error(moved.error.message);
  await repo.save(moved.data); // persisted version is now 1 (V+1)

  return { repo, renderedVersion: 0 };
}

/** The first occurrence of the stored session — B after the reorder. */
async function storedFirstOccurrence(
  repo: InMemoryWorkoutSessionRepository,
): Promise<{ performedId: string; isSkipped: boolean; sets: number }> {
  const stored = await repo.findById(seedTwoOccurrenceSession().id);
  if (stored === null) throw Error('stored session vanished');
  const first = stored.exerciseLogs[0];
  if (first === undefined) throw Error('no first occurrence');
  return {
    performedId: first.performedExerciseId as string,
    isSkipped: first.isSkipped,
    sets: first.sets.length,
  };
}

describe('stale rendered intent: occurrence-addressed commands (PR #13 Finding 1)', () => {
  it('skip rejects the stale rendered order and leaves the current occupant untouched', async () => {
    const { repo, renderedVersion } = await seedAfterConcurrentReorder();
    const uc = new SkipSessionExerciseUseCase(repo);

    const r = await uc.execute({
      sessionId: SESSION_ID,
      userId: OWNER,
      exerciseOrder: 1,
      expectedSessionVersion: renderedVersion,
    });

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('SESSION_MODIFIED');
    // Order 1 is now B — the stale skip of "order 1" (rendered as A) must
    // not have skipped B.
    const first = await storedFirstOccurrence(repo);
    expect(first.performedId).toBe('ex-b');
    expect(first.isSkipped).toBe(false);
  });

  it('unskip rejects the stale rendered order', async () => {
    // Rendered state: A(1) skipped, B(2) plain at version 0. Concurrent:
    // reorder — the skip rides with A to order 2; order 1 is now B.
    const repo = new InMemoryWorkoutSessionRepository();
    const seed = seedTwoOccurrenceSession();
    const skipped = skipSessionExercise(seed, { exerciseOrder: 1 });
    if (!skipped.ok) throw Error(skipped.error.message);
    await repo.save(skipped.data); // persisted version 0 — the rendered V
    const loaded = await repo.findById(skipped.data.id);
    if (loaded === null) throw Error();
    const moved = moveSessionExercise(loaded, { exerciseOrder: 2, direction: 'up' });
    if (!moved.ok) throw Error(moved.error.message);
    await repo.save(moved.data); // version 1

    const uc = new UnskipSessionExerciseUseCase(repo);
    const r = await uc.execute({
      sessionId: SESSION_ID,
      userId: OWNER,
      exerciseOrder: 1,
      expectedSessionVersion: 0,
    });

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('SESSION_MODIFIED');
    const first = await storedFirstOccurrence(repo);
    expect(first.performedId).toBe('ex-b');
    expect(first.isSkipped).toBe(false);
  });

  it('move rejects the stale rendered order and leaves the persisted order intact', async () => {
    const { repo, renderedVersion } = await seedAfterConcurrentReorder();
    const uc = new MoveSessionExerciseUseCase(repo);

    const r = await uc.execute({
      sessionId: SESSION_ID,
      userId: OWNER,
      exerciseOrder: 1,
      direction: 'down',
      expectedSessionVersion: renderedVersion,
    });

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('SESSION_MODIFIED');
    // The concurrent reorder's result stands: B still at order 1.
    const first = await storedFirstOccurrence(repo);
    expect(first.performedId).toBe('ex-b');
  });

  it('substitute rejects the stale rendered order', async () => {
    const { repo, renderedVersion } = await seedAfterConcurrentReorder();
    const uc = new SubstituteSessionExerciseUseCase(repo, makeExerciseRepo(['ex-x']));

    const r = await uc.execute({
      sessionId: SESSION_ID,
      userId: OWNER,
      exerciseOrder: 1,
      replacementExerciseId: 'ex-x',
      expectedSessionVersion: renderedVersion,
    });

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('SESSION_MODIFIED');
    const first = await storedFirstOccurrence(repo);
    expect(first.performedId).toBe('ex-b');
  });

  it('restore rejects the stale rendered order', async () => {
    const { repo, renderedVersion } = await seedAfterConcurrentReorder();
    const uc = new RestoreSessionExerciseUseCase(repo);

    const r = await uc.execute({
      sessionId: SESSION_ID,
      userId: OWNER,
      exerciseOrder: 1,
      expectedSessionVersion: renderedVersion,
    });

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('SESSION_MODIFIED');
    const first = await storedFirstOccurrence(repo);
    expect(first.performedId).toBe('ex-b');
  });

  it('log set rejects the stale rendered order — the wrong occurrence gains no set', async () => {
    const { repo, renderedVersion } = await seedAfterConcurrentReorder();
    const uc = new LogSessionSetUseCase(repo);

    const r = await uc.execute({
      sessionId: SESSION_ID,
      userId: OWNER,
      exerciseOrder: 1,
      expectedSessionVersion: renderedVersion,
      type: 'reps',
      reps: 10,
      weightKg: 50,
      rpe: null,
    });

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('SESSION_MODIFIED');
    // B (the current occupant of the stale order) must have gained NO set.
    const first = await storedFirstOccurrence(repo);
    expect(first.sets).toBe(0);
  });

  it('update set rejects the stale rendered order', async () => {
    const { repo, renderedVersion } = await seedAfterConcurrentReorder();
    const uc = new UpdateSessionSetUseCase(repo);

    const r = await uc.execute({
      sessionId: SESSION_ID,
      userId: OWNER,
      exerciseOrder: 1,
      expectedSessionVersion: renderedVersion,
      setNumber: 1,
      type: 'reps',
      reps: 12,
      weightKg: 55,
      rpe: null,
    });

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('SESSION_MODIFIED');
  });

  it('delete set rejects the stale rendered order', async () => {
    const { repo, renderedVersion } = await seedAfterConcurrentReorder();
    const uc = new DeleteSessionSetUseCase(repo);

    const r = await uc.execute({
      sessionId: SESSION_ID,
      userId: OWNER,
      exerciseOrder: 1,
      expectedSessionVersion: renderedVersion,
      setNumber: 1,
    });

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('SESSION_MODIFIED');
  });
});

// ─── The mirror: current-version commands still succeed ─────────────────────

describe('current rendered intent: occurrence-addressed commands succeed', () => {
  it('skip succeeds when the expected version matches the loaded aggregate', async () => {
    const repo = new InMemoryWorkoutSessionRepository();
    await repo.save(seedTwoOccurrenceSession()); // version 0
    const uc = new SkipSessionExerciseUseCase(repo);

    const r = await uc.execute({
      sessionId: SESSION_ID,
      userId: OWNER,
      exerciseOrder: 1,
      expectedSessionVersion: 0,
    });

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.exerciseLogs[0]?.isSkipped).toBe(true);
    // The persisted row's version bumped: the next render loads version 1.
    const storedAfterSkip = await repo.findById(seedTwoOccurrenceSession().id);
    expect(storedAfterSkip?.version).toBe(1);
  });

  it('move succeeds and the returned DTO carries the bumped version', async () => {
    const repo = new InMemoryWorkoutSessionRepository();
    await repo.save(seedTwoOccurrenceSession());
    const uc = new MoveSessionExerciseUseCase(repo);

    const r = await uc.execute({
      sessionId: SESSION_ID,
      userId: OWNER,
      exerciseOrder: 2,
      direction: 'up',
      expectedSessionVersion: 0,
    });

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.exerciseLogs.map((log) => log.performedExerciseId)).toEqual(['ex-b', 'ex-a']);
    const storedAfterMove = await repo.findById(seedTwoOccurrenceSession().id);
    expect(storedAfterMove?.version).toBe(1);
  });

  it('log set succeeds and the returned DTO carries the bumped version', async () => {
    const repo = new InMemoryWorkoutSessionRepository();
    await repo.save(seedTwoOccurrenceSession());
    const uc = new LogSessionSetUseCase(repo);

    const r = await uc.execute({
      sessionId: SESSION_ID,
      userId: OWNER,
      exerciseOrder: 1,
      expectedSessionVersion: 0,
      type: 'reps',
      reps: 10,
      weightKg: 50,
      rpe: null,
    });

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.exerciseLogs[0]?.sets).toHaveLength(1);
    const storedAfterLog = await repo.findById(seedTwoOccurrenceSession().id);
    expect(storedAfterLog?.version).toBe(1);
  });

  it('substitute succeeds and the returned DTO carries the bumped version', async () => {
    const repo = new InMemoryWorkoutSessionRepository();
    await repo.save(seedTwoOccurrenceSession());
    const uc = new SubstituteSessionExerciseUseCase(repo, makeExerciseRepo(['ex-x']));

    const r = await uc.execute({
      sessionId: SESSION_ID,
      userId: OWNER,
      exerciseOrder: 1,
      replacementExerciseId: 'ex-x',
      expectedSessionVersion: 0,
    });

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.exerciseLogs[0]?.performedExerciseId).toBe('ex-x');
    const storedAfterSub = await repo.findById(seedTwoOccurrenceSession().id);
    expect(storedAfterSub?.version).toBe(1);
  });
});


