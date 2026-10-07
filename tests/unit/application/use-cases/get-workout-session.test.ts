import { describe, expect, it, vi } from 'vitest';
import type { ProgramRepository } from '@/application/ports/program-repository';
import { GetWorkoutSessionUseCase } from '@/application/use-cases/get-workout-session';
import { InMemoryProgramEnrollmentRepository } from '@/infrastructure/enrollments/in-memory-program-enrollment-repository';
import { InMemoryWorkoutSessionRepository } from '@/infrastructure/sessions/in-memory-workout-session-repository';
import { createProgramEnrollment } from '@/domain/entities/program-enrollment';
import { createTrainingProgram } from '@/domain/entities/training-program';
import { createWorkout } from '@/domain/entities/workout';
import {
  completeWorkoutSession,
  createWorkoutSession,
  logSessionSet,
} from '@/domain/entities/workout-session';
import { Difficulty } from '@/domain/types/exercise';
import { createEnrollmentId, createExerciseId, createScheduledWorkoutId, createUserId } from '@/domain/types/ids';
import { ProgramGoal } from '@/domain/types/program';
import { createRepScheme } from '@/domain/value-objects/rep-prescription';

import { makeOccurrenceExecutionFactsRepo, notPerformedFact } from './schedule-fixtures';

function rep() { const r = createRepScheme(3, 8, 10); if (!r.ok) throw Error(); return r.data; }
function eid(v: string) { const r = createExerciseId(v); if (!r.ok) throw Error(); return r.data; }
function swid(v: string) { const r = createScheduledWorkoutId(v); if (!r.ok) throw Error(); return r.data; }
function uid(v: string) { const r = createUserId(v); if (!r.ok) throw Error(); return r.data; }
function enid(v: string) { const r = createEnrollmentId(v); if (!r.ok) throw Error(); return r.data; }

function seedProgram() {
  const wr = createWorkout({ id: 'wo-1', name: 'W1', slug: 'w1', description: 'A test workout', estimatedDurationMinutes: 30, exercises: [{ exerciseId: eid('ex-001'), order: 1, prescription: rep(), restSeconds: 60 }] });
  if (!wr.ok) throw Error();
  const sw = swid('sched-wo1');
  const pr = createTrainingProgram({
    id: 'p1', name: 'P1', slug: 'prog-1', description: 'A test program', difficulty: Difficulty.Beginner, goal: ProgramGoal.Strength,
    durationWeeks: 1, workoutsPerWeek: 1, workouts: [wr.data],
    weeks: [{ weekNumber: 1, scheduledWorkouts: [{ id: sw, workoutId: wr.data.id, order: 1 }] }],
  });
  if (!pr.ok) throw Error();
  return { program: pr.data, swId: sw, workoutId: wr.data.id };
}

function seedEnrollment(repo: InMemoryProgramEnrollmentRepository, enrollmentId: string, userId: string, programId: string) {
  const r = createProgramEnrollment({ id: enrollmentId, userId, programId, enrolledAt: new Date('2026-01-01T00:00:00Z') });
  if (!r.ok) throw Error();
  return repo.create(r.data);
}

function seedSession(repo: InMemoryWorkoutSessionRepository, sessionId: string, userId: string, enrollmentId: string) {
  const { swId, workoutId } = seedProgram();
  const sr = createWorkoutSession({ id: sessionId, userId: uid(userId), enrollmentId: enid(enrollmentId), scheduledWorkoutId: swId, workoutId, startedAt: new Date(), exerciseLogs: [{ authoredExerciseId: eid('ex-001'), order: 1, prescription: rep(), restSeconds: 60 }] });
  if (!sr.ok) throw Error();
  return repo.create(sr.data);
}

/** A COMPLETED session for the fixture occurrence (one real logged set). */
function seedCompletedSession(repo: InMemoryWorkoutSessionRepository, sessionId: string, userId: string, enrollmentId: string) {
  const { swId, workoutId } = seedProgram();
  const sr = createWorkoutSession({ id: sessionId, userId: uid(userId), enrollmentId: enid(enrollmentId), scheduledWorkoutId: swId, workoutId, startedAt: new Date('2026-09-22T17:00:00Z'), exerciseLogs: [{ authoredExerciseId: eid('ex-001'), order: 1, prescription: rep(), restSeconds: 60 }] });
  if (!sr.ok) throw Error();
  const logged = logSessionSet(sr.data, { exerciseOrder: 1, type: 'reps', reps: 8, weightKg: 20, rpe: null });
  if (!logged.ok) throw Error(logged.error.message);
  const completed = completeWorkoutSession(logged.data, new Date('2026-09-22T17:45:00Z'));
  if (!completed.ok) throw Error(completed.error.message);
  return repo.create(completed.data);
}

function makeUseCase() {
  const { program } = seedProgram();
  const programRepo: ProgramRepository = { list: vi.fn(), findBySlug: vi.fn().mockResolvedValue(program), findSessionRouteByScheduledWorkoutId: vi.fn(), listMetadataByIds: vi.fn() };
  const sessionRepo = new InMemoryWorkoutSessionRepository();
  const enrollmentRepo = new InMemoryProgramEnrollmentRepository();
  const occurrenceFacts = makeOccurrenceExecutionFactsRepo(sessionRepo, [], enrollmentRepo);
  const uc = new GetWorkoutSessionUseCase(programRepo, enrollmentRepo, occurrenceFacts);
  return { sessionRepo, enrollmentRepo, occurrenceFacts, uc };
}

const INPUT = { programSlug: 'prog-1', weekNumber: 1, workoutOrder: 1 } as const;

describe('GetWorkoutSessionUseCase', () => {
  it('reports not-enrolled with no session when the user has not joined', async () => {
    const { uc } = makeUseCase();
    const r = await uc.execute({ ...INPUT, userId: 'user-a' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data).toEqual({ enrolled: false, session: null, notPerformedRecorded: false });
  });

  it('reports enrolled with null session when the workout was not started', async () => {
    const { enrollmentRepo, uc } = makeUseCase();
    await seedEnrollment(enrollmentRepo, 'enr-a', 'user-a', 'p1');

    const r = await uc.execute({ ...INPUT, userId: 'user-a' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data).toEqual({ enrolled: true, session: null, notPerformedRecorded: false });
  });

  it('returns the session when it exists for the user\'s enrollment', async () => {
    const { sessionRepo, enrollmentRepo, uc } = makeUseCase();
    await seedEnrollment(enrollmentRepo, 'enr-a', 'user-a', 'p1');
    await seedSession(sessionRepo, 's-1', 'user-a', 'enr-a');

    const r = await uc.execute({ ...INPUT, userId: 'user-a' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.enrolled).toBe(true);
    expect(r.data.session?.sessionId).toBe('s-1');
    expect(r.data.session?.status).toBe('in-progress');
  });

  it('never returns another user\'s session for the same occurrence', async () => {
    const { sessionRepo, enrollmentRepo, uc } = makeUseCase();
    await seedEnrollment(enrollmentRepo, 'enr-a', 'user-a', 'p1');
    await seedEnrollment(enrollmentRepo, 'enr-b', 'user-b', 'p1');
    await seedSession(sessionRepo, 's-1', 'user-a', 'enr-a');

    const r = await uc.execute({ ...INPUT, userId: 'user-b' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.session).toBeNull();
  });

  it('returns PROGRAM_NOT_FOUND', async () => {
    const programRepo: ProgramRepository = { list: vi.fn(), findBySlug: vi.fn().mockResolvedValue(null), findSessionRouteByScheduledWorkoutId: vi.fn(), listMetadataByIds: vi.fn() };
    const uc = new GetWorkoutSessionUseCase(programRepo, new InMemoryProgramEnrollmentRepository(), makeOccurrenceExecutionFactsRepo(new InMemoryWorkoutSessionRepository()));
    const r = await uc.execute({ ...INPUT, programSlug: 'missing', userId: 'user-a' });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('PROGRAM_NOT_FOUND');
  });

  it('reports the not-performed record of the occurrence for the detail header', async () => {
    const programRepo: ProgramRepository = {
      list: vi.fn(),
      findBySlug: vi.fn().mockResolvedValue(seedProgram().program),
      findSessionRouteByScheduledWorkoutId: vi.fn(),
      listMetadataByIds: vi.fn(),
    };
    const enrollmentRepo = new InMemoryProgramEnrollmentRepository();
    await seedEnrollment(enrollmentRepo, 'enr-a', 'user-a', 'p1');
    const occurrenceFacts = makeOccurrenceExecutionFactsRepo(
      new InMemoryWorkoutSessionRepository(),
      [notPerformedFact('enr-a', 'sched-wo1')],
    );
    const uc = new GetWorkoutSessionUseCase(programRepo, enrollmentRepo, occurrenceFacts);

    const r = await uc.execute({ ...INPUT, userId: 'user-a' });

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data).toEqual({ enrolled: true, session: null, notPerformedRecorded: true });
    // ONE coherent snapshot read supplies session state and settlement state.
    expect(occurrenceFacts.findOccurrenceExecutionFacts).toHaveBeenCalledTimes(1);
    expect(occurrenceFacts.findOccurrenceExecutionFacts).toHaveBeenCalledWith(
      enid('enr-a'),
      swid('sched-wo1'),
    );
  });

  it('reports the record independently of the session state', async () => {
    const { sessionRepo, enrollmentRepo } = makeUseCase();
    await seedEnrollment(enrollmentRepo, 'enr-a', 'user-a', 'p1');
    await seedSession(sessionRepo, 's-1', 'user-a', 'enr-a');

    const useCase = new GetWorkoutSessionUseCase(
      { list: vi.fn(), findBySlug: vi.fn().mockResolvedValue(seedProgram().program), findSessionRouteByScheduledWorkoutId: vi.fn(), listMetadataByIds: vi.fn() },
      enrollmentRepo,
      makeOccurrenceExecutionFactsRepo(sessionRepo, [notPerformedFact('enr-a', 'sched-wo1')]),
    );

    const r = await useCase.execute({ ...INPUT, userId: 'user-a' });

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.session?.sessionId).toBe('s-1');
    expect(r.data.notPerformedRecorded).toBe(true);
  });

  it("does not report another enrollment's record for the same occurrence", async () => {
    const programRepo: ProgramRepository = {
      list: vi.fn(),
      findBySlug: vi.fn().mockResolvedValue(seedProgram().program),
      findSessionRouteByScheduledWorkoutId: vi.fn(),
      listMetadataByIds: vi.fn(),
    };
    const enrollmentRepo = new InMemoryProgramEnrollmentRepository();
    await seedEnrollment(enrollmentRepo, 'enr-b', 'user-b', 'p1');
    const uc = new GetWorkoutSessionUseCase(
      programRepo,
      enrollmentRepo,
      makeOccurrenceExecutionFactsRepo(new InMemoryWorkoutSessionRepository(), [
        notPerformedFact('enr-b', 'sched-wo1'),
        notPerformedFact('enr-a', 'sched-wo1'),
      ]),
    );

    const r = await uc.execute({ ...INPUT, userId: 'user-b' });

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // The stub answers per enrollment exactly like the port; the fact of the
    // other run is never visible here.
    expect(r.data.notPerformedRecorded).toBe(true);

    const other = await uc.execute({ ...INPUT, userId: 'user-a' });
    expect(other.ok).toBe(true);
    if (!other.ok) return;
    expect(other.data.enrolled).toBe(false);
    expect(other.data.notPerformedRecorded).toBe(false);
  });

  it('reports no record for a different occurrence of the same run', async () => {
    const { enrollmentRepo, uc } = makeUseCase();
    await seedEnrollment(enrollmentRepo, 'enr-a', 'user-a', 'p1');
    const useCase = new GetWorkoutSessionUseCase(
      { list: vi.fn(), findBySlug: vi.fn().mockResolvedValue(seedProgram().program), findSessionRouteByScheduledWorkoutId: vi.fn(), listMetadataByIds: vi.fn() },
      enrollmentRepo,
      makeOccurrenceExecutionFactsRepo(new InMemoryWorkoutSessionRepository(), [
        notPerformedFact('enr-a', 'sched-other'),
      ]),
    );

    const r = await useCase.execute({ ...INPUT, userId: 'user-a', workoutOrder: 1 });

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.notPerformedRecorded).toBe(false);
    expect(uc).toBeDefined();
  });
});

/**
 * M17 generation fencing (the preview/session read): the occurrence's state
 * composed into an already-loaded enrollment is tied to THAT identity, never
 * to a re-resolved current run. Mirrors the closure-fencing contract.
 */
describe('GetWorkoutSessionUseCase - enrollment identity fencing', () => {
  it('reads the occurrence of EXACTLY the expected enrollment while it exists', async () => {
    const { sessionRepo, enrollmentRepo, uc } = makeUseCase();
    await seedEnrollment(enrollmentRepo, 'enr-a', 'user-a', 'p1');
    await seedSession(sessionRepo, 's-1', 'user-a', 'enr-a');

    const result = await uc.execute({
      ...INPUT,
      userId: 'user-a',
      expectedEnrollmentId: 'enr-a',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toMatchObject({
      enrolled: true,
      notPerformedRecorded: false,
    });
    expect(result.data.session?.sessionId).toBe('s-1');
  });

  it('refuses with ENROLLMENT_CHANGED when the expected enrollment was replaced', async () => {
    const { enrollmentRepo, uc } = makeUseCase();
    await seedEnrollment(enrollmentRepo, 'enr-a', 'user-a', 'p1');
    // The replacement a restart produces: the old row is deleted and a
    // DIFFERENT id becomes the current run of the same (user, program) pair.
    await enrollmentRepo.delete(enid('enr-a'));
    await seedEnrollment(enrollmentRepo, 'enr-a-replacement', 'user-a', 'p1');

    const result = await uc.execute({
      ...INPUT,
      userId: 'user-a',
      expectedEnrollmentId: 'enr-a',
    });

    // The caller is composing a preview for the OLD run: the fenced read
    // refuses rather than handing back the replacement run's not-started state.
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatchObject({ code: 'ENROLLMENT_CHANGED' });
  });

  it('refuses when the expected enrollment belongs to another user', async () => {
    const { enrollmentRepo, uc } = makeUseCase();
    await seedEnrollment(enrollmentRepo, 'enr-b', 'user-b', 'p1');

    const result = await uc.execute({
      ...INPUT,
      userId: 'user-a',
      expectedEnrollmentId: 'enr-b',
    });

    // The id alone never authorizes: ownership is verified in the SAME
    // snapshot as the facts, so a foreign run resolves not-matched.
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatchObject({ code: 'ENROLLMENT_CHANGED' });
  });

  it('keeps the standalone convention when no expected id is supplied', async () => {
    const { sessionRepo, enrollmentRepo, uc } = makeUseCase();
    await seedEnrollment(enrollmentRepo, 'enr-a', 'user-a', 'p1');
    await seedSession(sessionRepo, 's-1', 'user-a', 'enr-a');

    // Unchanged standalone behavior: the read resolves the current enrollment.
    const result = await uc.execute({ ...INPUT, userId: 'user-a' });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.session?.sessionId).toBe('s-1');
  });
});

/**
 * M17 I1 (the known PR #21 P2): the coherent snapshot can, under corruption,
 * hold BOTH authoritative settlements of the same occurrence — a completed
 * session and a not-performed record. The use case must re-check the EXISTING
 * one-settlement invariant before composing the DTO, on BOTH the fenced and
 * the standalone paths, and fail loudly — no precedence, no second read, no
 * silent choice that a surface could render as "truth".
 */
describe('GetWorkoutSessionUseCase - occurrence settlement consistency', () => {
  const SETTLEMENT_ERROR =
    'Occurrence settlement contract violated: occurrence "sched-wo1" is both completed and recorded as not performed';

  /** Program repo stub over the shared fixture program. */
  function programRepo(): ProgramRepository {
    return { list: vi.fn(), findBySlug: vi.fn().mockResolvedValue(seedProgram().program), findSessionRouteByScheduledWorkoutId: vi.fn(), listMetadataByIds: vi.fn() };
  }

  it('fails loudly on completed + not-performed (standalone path)', async () => {
    const enrollmentRepo = new InMemoryProgramEnrollmentRepository();
    await seedEnrollment(enrollmentRepo, 'enr-a', 'user-a', 'p1');
    const sessionRepo = new InMemoryWorkoutSessionRepository();
    await seedCompletedSession(sessionRepo, 's-1', 'user-a', 'enr-a');
    const occurrenceFacts = makeOccurrenceExecutionFactsRepo(
      sessionRepo,
      [notPerformedFact('enr-a', 'sched-wo1')],
      enrollmentRepo,
    );
    const uc = new GetWorkoutSessionUseCase(programRepo(), enrollmentRepo, occurrenceFacts);

    // Contradictory truth is made visible, never reconciled into a DTO.
    await expect(uc.execute({ ...INPUT, userId: 'user-a' })).rejects.toThrow(SETTLEMENT_ERROR);
    // No second repository read: the invariant runs over the ONE snapshot.
    expect(occurrenceFacts.findOccurrenceExecutionFacts).toHaveBeenCalledTimes(1);
    expect(occurrenceFacts.findFencedOccurrenceExecutionFacts).not.toHaveBeenCalled();
  });

  it('fails loudly on completed + not-performed (fenced path) with the SAME failure', async () => {
    const enrollmentRepo = new InMemoryProgramEnrollmentRepository();
    await seedEnrollment(enrollmentRepo, 'enr-a', 'user-a', 'p1');
    const sessionRepo = new InMemoryWorkoutSessionRepository();
    await seedCompletedSession(sessionRepo, 's-1', 'user-a', 'enr-a');
    const occurrenceFacts = makeOccurrenceExecutionFactsRepo(
      sessionRepo,
      [notPerformedFact('enr-a', 'sched-wo1')],
      enrollmentRepo,
    );
    const uc = new GetWorkoutSessionUseCase(programRepo(), enrollmentRepo, occurrenceFacts);

    await expect(
      uc.execute({ ...INPUT, userId: 'user-a', expectedEnrollmentId: 'enr-a' }),
    ).rejects.toThrow(SETTLEMENT_ERROR);
    // No second repository read on the fenced path either.
    expect(occurrenceFacts.findFencedOccurrenceExecutionFacts).toHaveBeenCalledTimes(1);
    expect(occurrenceFacts.findOccurrenceExecutionFacts).not.toHaveBeenCalled();
  });

  it('accepts a completed session with no not-performed record', async () => {
    const enrollmentRepo = new InMemoryProgramEnrollmentRepository();
    await seedEnrollment(enrollmentRepo, 'enr-a', 'user-a', 'p1');
    const sessionRepo = new InMemoryWorkoutSessionRepository();
    await seedCompletedSession(sessionRepo, 's-1', 'user-a', 'enr-a');
    const uc = new GetWorkoutSessionUseCase(
      programRepo(),
      enrollmentRepo,
      makeOccurrenceExecutionFactsRepo(sessionRepo, [], enrollmentRepo),
    );

    const r = await uc.execute({ ...INPUT, userId: 'user-a' });

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.session?.status).toBe('completed');
    expect(r.data.notPerformedRecorded).toBe(false);
  });

  it('accepts a not-performed record with no session', async () => {
    const enrollmentRepo = new InMemoryProgramEnrollmentRepository();
    await seedEnrollment(enrollmentRepo, 'enr-a', 'user-a', 'p1');
    const uc = new GetWorkoutSessionUseCase(
      programRepo(),
      enrollmentRepo,
      makeOccurrenceExecutionFactsRepo(
        new InMemoryWorkoutSessionRepository(),
        [notPerformedFact('enr-a', 'sched-wo1')],
        enrollmentRepo,
      ),
    );

    const r = await uc.execute({ ...INPUT, userId: 'user-a' });

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.session).toBeNull();
    expect(r.data.notPerformedRecorded).toBe(true);
  });

  it('keeps in-progress + not-performed non-fatal (the locked precedence stays a no-op)', async () => {
    const enrollmentRepo = new InMemoryProgramEnrollmentRepository();
    await seedEnrollment(enrollmentRepo, 'enr-a', 'user-a', 'p1');
    const sessionRepo = new InMemoryWorkoutSessionRepository();
    await seedSession(sessionRepo, 's-1', 'user-a', 'enr-a');
    const uc = new GetWorkoutSessionUseCase(
      programRepo(),
      enrollmentRepo,
      makeOccurrenceExecutionFactsRepo(sessionRepo, [notPerformedFact('enr-a', 'sched-wo1')], enrollmentRepo),
    );

    // The live-session case is deliberately NOT rejected by M17 I1: the
    // existing invariant behavior (in-progress outranks the record) is
    // preserved unchanged on this read.
    const r = await uc.execute({ ...INPUT, userId: 'user-a' });

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.session?.status).toBe('in-progress');
    expect(r.data.notPerformedRecorded).toBe(true);
  });
});
