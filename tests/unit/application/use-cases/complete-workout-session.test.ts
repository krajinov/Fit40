import { describe, expect, it, vi } from 'vitest';
import { CompleteWorkoutSessionUseCase } from '@/application/use-cases/complete-workout-session';
import type { ProgramRepository } from '@/application/ports/program-repository';
import { InMemoryWorkoutSessionRepository } from '@/infrastructure/sessions/in-memory-workout-session-repository';
import { createWorkoutSession, logSessionSet } from '@/domain/entities/workout-session';
import { createEnrollmentId, createExerciseId, createScheduledWorkoutId, createUserId, createWorkoutId } from '@/domain/types/ids';
import { createRepScheme } from '@/domain/value-objects/rep-prescription';

function rep() { const r = createRepScheme(3, 8, 10); if (!r.ok) throw Error(); return r.data; }
function eid(v: string) { const r = createExerciseId(v); if (!r.ok) throw Error(); return r.data; }
function swid(v: string) { const r = createScheduledWorkoutId(v); if (!r.ok) throw Error(); return r.data; }
function wid(v: string) { const r = createWorkoutId(v); if (!r.ok) throw Error(); return r.data; }
function uid(v: string) { const r = createUserId(v); if (!r.ok) throw Error(); return r.data; }
function enid(v: string) { const r = createEnrollmentId(v); if (!r.ok) throw Error(); return r.data; }

const OWNER_ID = 'user-1';

/** Minimal ProgramRepository stub; only the slug lookup is exercised here. */
function programRepo(
  slug: string | null,
  findSlugByScheduledWorkoutId = vi.fn(async () => slug),
): ProgramRepository {
  return { list: async () => [], findBySlug: async () => null, findSlugByScheduledWorkoutId };
}

async function seedSession(ownerId: string = OWNER_ID) {
  const repo = new InMemoryWorkoutSessionRepository();
  const sr = createWorkoutSession({ id: 's-1', userId: uid(ownerId), enrollmentId: enid('enr-1'), scheduledWorkoutId: swid('sw-1'), workoutId: wid('w-1'), startedAt: new Date(), exerciseLogs: [{ exerciseId: eid('ex-001'), order: 1, prescription: rep(), restSeconds: 60 }] });
  if (!sr.ok) throw Error();
  await repo.save(sr.data);
  const loaded = await repo.findById(sr.data.id);
  if (!loaded) throw Error();
  const rs = logSessionSet(loaded, { exerciseOrder: 1, type: 'reps', reps: 10, weightKg: null, rpe: null });
  if (!rs.ok) throw Error();
  await repo.save(rs.data);
  return { repo, sessionId: sr.data.id };
}

describe('CompleteWorkoutSessionUseCase', () => {
  it('completes an in-progress session with sets', async () => {
    const { repo, sessionId } = await seedSession();
    const uc = new CompleteWorkoutSessionUseCase(repo, programRepo(null));
    const r = await uc.execute({ sessionId: sessionId as string, userId: OWNER_ID });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.session.status).toBe('completed');
  });

  it('returns SESSION_NOT_FOUND', async () => {
    const uc = new CompleteWorkoutSessionUseCase(new InMemoryWorkoutSessionRepository(), programRepo(null));
    const r = await uc.execute({ sessionId: 'unknown', userId: OWNER_ID });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('SESSION_NOT_FOUND');
  });

  it('returns FORBIDDEN when the session belongs to another user', async () => {
    const { repo, sessionId } = await seedSession('user-1');
    const uc = new CompleteWorkoutSessionUseCase(repo, programRepo(null));
    const r = await uc.execute({ sessionId: sessionId as string, userId: 'user-2' });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('FORBIDDEN');

    // The attempt must not have mutated the session.
    const untouched = await repo.findById(sessionId);
    expect(untouched?.completedAt).toBeNull();
  });

  it('derives the trusted owning program slug from session data', async () => {
    const { repo, sessionId } = await seedSession();
    const slugLookup = vi.fn(async () => 'fit40-beginner-strength');
    const uc = new CompleteWorkoutSessionUseCase(repo, programRepo(null, slugLookup));

    const r = await uc.execute({ sessionId: sessionId as string, userId: OWNER_ID });

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // The lookup key is the session's own scheduled workout — never client input.
    expect(slugLookup).toHaveBeenCalledWith('sw-1');
    expect(r.data.programSlug).toBe('fit40-beginner-strength');
    expect(r.data.session.status).toBe('completed');
  });

  it('returns a null program slug when the owning program cannot be resolved', async () => {
    const { repo, sessionId } = await seedSession();
    const uc = new CompleteWorkoutSessionUseCase(repo, programRepo(null));

    const r = await uc.execute({ sessionId: sessionId as string, userId: OWNER_ID });

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.programSlug).toBeNull();
  });
});