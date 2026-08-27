/**
 * Refused writes in the session use cases.
 *
 * Every mutation loads a session, applies one domain change, and saves it back. When
 * storage refuses that save because the session moved on, the caller must receive the
 * typed SESSION_MODIFIED conflict and the newer stored state must survive untouched —
 * never a silent overwrite of another request's work.
 */

import { describe, expect, it } from 'vitest';

import { CompleteWorkoutSessionUseCase } from '@/application/use-cases/complete-workout-session';
import { DeleteSessionSetUseCase } from '@/application/use-cases/delete-session-set';
import { LogSessionSetUseCase } from '@/application/use-cases/log-session-set';
import { UpdateSessionSetUseCase } from '@/application/use-cases/update-session-set';
import { INITIAL_SESSION_VERSION } from '@/domain/entities/workout-session';

import {
  readingAs,
  REPS,
  seedAndSnapshot,
  SESSION_ID,
  setCounts,
  storedSession,
} from './support/session-stale-fixtures';

describe('refused session writes', () => {
  it('reports the revision an accepted save stored', async () => {
    const { repo } = await seedAndSnapshot();

    const result = await new LogSessionSetUseCase(repo).execute({
      sessionId: SESSION_ID,
      exerciseOrder: 2,
      ...REPS,
      reps: 8,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.version).toBe(INITIAL_SESSION_VERSION + 2);
    expect(setCounts(await storedSession(repo))).toEqual([1, 1]);
  });

  it('refuses a logged set built from a revision storage has moved past', async () => {
    const { repo, stale } = await seedAndSnapshot();

    const winner = await new LogSessionSetUseCase(repo).execute({
      sessionId: SESSION_ID,
      exerciseOrder: 2,
      ...REPS,
      reps: 8,
    });
    expect(winner.ok).toBe(true);

    const loser = await new LogSessionSetUseCase(readingAs(repo, stale)).execute({
      sessionId: SESSION_ID,
      exerciseOrder: 1,
      ...REPS,
      reps: 99,
    });

    expect(loser.ok).toBe(false);
    if (loser.ok) return;
    expect(loser.error).toMatchObject({ code: 'SESSION_MODIFIED', sessionId: SESSION_ID });
    expect(setCounts(await storedSession(repo))).toEqual([1, 1]);
  });

  it('refuses an updated set built from a revision storage has moved past', async () => {
    const { repo, stale } = await seedAndSnapshot();

    const winner = await new UpdateSessionSetUseCase(repo).execute({
      sessionId: SESSION_ID,
      exerciseOrder: 1,
      setNumber: 1,
      ...REPS,
      reps: 12,
    });
    expect(winner.ok).toBe(true);

    const loser = await new UpdateSessionSetUseCase(readingAs(repo, stale)).execute({
      sessionId: SESSION_ID,
      exerciseOrder: 1,
      setNumber: 1,
      ...REPS,
      reps: 5,
    });

    expect(loser.ok).toBe(false);
    if (loser.ok) return;
    expect(loser.error.code).toBe('SESSION_MODIFIED');
    expect(setCounts(await storedSession(repo))).toEqual([1, 0]);
  });

  it('refuses a deleted set built from a revision storage has moved past', async () => {
    const { repo, stale } = await seedAndSnapshot();

    const winner = await new LogSessionSetUseCase(repo).execute({
      sessionId: SESSION_ID,
      exerciseOrder: 1,
      ...REPS,
      reps: 8,
    });
    expect(winner.ok).toBe(true);

    const loser = await new DeleteSessionSetUseCase(readingAs(repo, stale)).execute({
      sessionId: SESSION_ID,
      exerciseOrder: 1,
      setNumber: 1,
    });

    expect(loser.ok).toBe(false);
    if (loser.ok) return;
    expect(loser.error.code).toBe('SESSION_MODIFIED');
    expect(setCounts(await storedSession(repo))).toEqual([2, 0]);
  });

  it('refuses to complete a session built from a revision storage has moved past', async () => {
    const { repo, stale } = await seedAndSnapshot();

    const winner = await new LogSessionSetUseCase(repo).execute({
      sessionId: SESSION_ID,
      exerciseOrder: 1,
      ...REPS,
      reps: 8,
    });
    expect(winner.ok).toBe(true);

    const loser = await new CompleteWorkoutSessionUseCase(readingAs(repo, stale)).execute({
      sessionId: SESSION_ID,
    });

    expect(loser.ok).toBe(false);
    if (loser.ok) return;
    expect(loser.error.code).toBe('SESSION_MODIFIED');

    // Neither the completion nor the older set counts survived the refusal.
    const stored = await storedSession(repo);
    expect(stored.completedAt).toBeNull();
    expect(stored.version).toBe(INITIAL_SESSION_VERSION + 2);
    expect(setCounts(stored)).toEqual([2, 0]);
  });
});
