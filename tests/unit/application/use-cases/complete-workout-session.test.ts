import { describe, expect, it, vi } from 'vitest';
import { CompleteWorkoutSessionUseCase } from '@/application/use-cases/complete-workout-session';
import type { ProgramRepository, SessionRoute } from '@/application/ports/program-repository';
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

/**
 * Minimal ProgramRepository stub; only the occurrence-route lookup is
 * exercised here.
 */
function programRepo(
  route: SessionRoute | null,
  routeLookup = vi.fn(async () => route),
): ProgramRepository {
  return {
    list: async () => [],
    findBySlug: async () => null,
    findSessionRouteByScheduledWorkoutId: routeLookup,
    listMetadataByIds: async () => [],
  };
}

async function seedSession(ownerId: string = OWNER_ID, enrollmentId: string | null = 'enr-1') {
  const repo = new InMemoryWorkoutSessionRepository();
  const sr = createWorkoutSession({ id: 's-1', userId: uid(ownerId), enrollmentId: enrollmentId === null ? null : enid(enrollmentId), scheduledWorkoutId: swid('sw-1'), workoutId: wid('w-1'), startedAt: new Date(), exerciseLogs: [{ exerciseId: eid('ex-001'), order: 1, prescription: rep(), restSeconds: 60 }] });
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

  it('rejects completing a detached session (enrollment nulled by leaving)', async () => {
    const { repo, sessionId } = await seedSession(OWNER_ID, null);
    const uc = new CompleteWorkoutSessionUseCase(repo, programRepo(null));

    const r = await uc.execute({ sessionId: sessionId as string, userId: OWNER_ID });

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('NOT_ENROLLED');

    // The historical session stays untouched and readable.
    const untouched = await repo.findById(sessionId);
    expect(untouched?.completedAt).toBeNull();
    expect(untouched?.enrollmentId).toBeNull();
  });

  it('never reactivates a detached session after a leave-and-rejoin', async () => {
    // Leaving deleted the enrollment and detached the session
    // (enrollment_id = null). Rejoining creates a NEW enrollment identity
    // that can never be attached to the old session, so it stays read-only
    // regardless of any enrollment created afterwards.
    const { repo, sessionId } = await seedSession(OWNER_ID, null);
    const uc = new CompleteWorkoutSessionUseCase(repo, programRepo(null));

    const r = await uc.execute({ sessionId: sessionId as string, userId: OWNER_ID });

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('NOT_ENROLLED');
    const still = await repo.findById(sessionId);
    expect(still?.enrollmentId).toBeNull();
  });

  it('derives the trusted owning occurrence route from session data', async () => {
    const { repo, sessionId } = await seedSession();
    const routeLookup = vi.fn(async () => ({
      programSlug: 'fit40-beginner-strength',
      weekNumber: 2,
      workoutOrder: 3,
    }));
    const uc = new CompleteWorkoutSessionUseCase(repo, programRepo(null, routeLookup));

    const r = await uc.execute({ sessionId: sessionId as string, userId: OWNER_ID });

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // The lookup key is the session's own scheduled workout — never client input.
    expect(routeLookup).toHaveBeenCalledWith('sw-1');
    expect(r.data.route).toEqual({
      programSlug: 'fit40-beginner-strength',
      weekNumber: 2,
      workoutOrder: 3,
    });
    expect(r.data.session.status).toBe('completed');
  });

  it('returns a null route when the owning program cannot be resolved', async () => {
    const { repo, sessionId } = await seedSession();
    const uc = new CompleteWorkoutSessionUseCase(repo, programRepo(null));

    const r = await uc.execute({ sessionId: sessionId as string, userId: OWNER_ID });

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.route).toBeNull();
  });
});