/**
 * Unit tests for the M17 Slice 6 start path.
 *
 * The use case no longer owns a session INSERT: it builds and validates the
 * Domain aggregate and delegates persistence to the enrollment-serialized
 * mutation authority (`RunOccurrenceWriteRepository.createSessionForOccurrence`),
 * mapping that authority's outcomes and its established typed errors. The
 * bounded leave/rejoin retry survives and goes through the same serialized call
 * — there is no second creation path, and no preflight read of session state.
 */
import { describe, expect, it, vi } from 'vitest';
import type { ProgramRepository } from '@/application/ports/program-repository';
import type {
  CreateSessionForOccurrenceInput,
  CreateSessionForOccurrenceOutcome,
  RunOccurrenceWriteRepository,
} from '@/application/ports/run-occurrence-write-repository';
import {
  SessionAlreadyExistsError,
  SessionEnrollmentNotFoundError,
  SessionOccurrenceKeyConflictError,
} from '@/application/ports/workout-session-repository';
import { StartWorkoutSessionUseCase } from '@/application/use-cases/start-workout-session';
import { InMemoryProgramEnrollmentRepository } from '@/infrastructure/enrollments/in-memory-program-enrollment-repository';
import { createProgramEnrollment } from '@/domain/entities/program-enrollment';
import { createTrainingProgram, type TrainingProgram } from '@/domain/entities/training-program';
import { createWorkout, type Workout } from '@/domain/entities/workout';
import { Difficulty } from '@/domain/types/exercise';
import { createExerciseId, createScheduledWorkoutId } from '@/domain/types/ids';
import { ProgramGoal } from '@/domain/types/program';
import { createRepScheme } from '@/domain/value-objects/rep-prescription';

import { FakeIdGenerator } from '../../helpers/fake-crypto';

function rep() { const r = createRepScheme(3, 8, 10); if (!r.ok) throw Error(); return r.data; }
function eid(v: string) { const r = createExerciseId(v); if (!r.ok) throw Error(); return r.data; }

const OWNER_A = 'user-a';
const OWNER_B = 'user-b';

function makeWorkout(id: string, exerciseIds: string[]): Workout {
  const r = createWorkout({
    id, name: `W${id}`, slug: `w-${id}`, description: 'A test workout', estimatedDurationMinutes: 30,
    exercises: exerciseIds.map((eidStr, i) => ({
      exerciseId: eid(eidStr), order: i + 1, prescription: rep(), restSeconds: 60,
    })),
  });
  if (!r.ok) throw Error();
  return r.data;
}

function makeProgram(): TrainingProgram {
  const w1 = makeWorkout('wo-1', ['ex-001', 'ex-002']);
  const sw1 = createScheduledWorkoutId('sched-w1');
  if (!sw1.ok) throw Error();
  const r = createTrainingProgram({
    id: 'prog-test', name: 'Test', slug: 'test-program', description: 'A test program',
    difficulty: Difficulty.Beginner, goal: ProgramGoal.Strength,
    durationWeeks: 1, workoutsPerWeek: 1,
    workouts: [w1],
    weeks: [{ weekNumber: 1, scheduledWorkouts: [{ id: sw1.data, workoutId: w1.id, order: 1 }] }],
  });
  if (!r.ok) throw Error();
  return r.data;
}

function createMockRepo(): ProgramRepository {
  return { list: vi.fn(), findBySlug: vi.fn(), findSessionRouteByScheduledWorkoutId: vi.fn(), listMetadataByIds: vi.fn() };
}

function enroll(repo: InMemoryProgramEnrollmentRepository, enrollmentId: string, userId: string, programId: string) {
  const r = createProgramEnrollment({ id: enrollmentId, userId, programId, enrolledAt: new Date('2026-01-01T00:00:00Z') });
  if (!r.ok) throw Error();
  return repo.create(r.data);
}

function makeEnrollment(id: string) {
  const r = createProgramEnrollment({ id, userId: OWNER_A, programId: 'prog-test', enrolledAt: new Date('2026-01-01T00:00:00Z') });
  if (!r.ok) throw Error();
  return r.data;
}

/**
 * A scripted stand-in for the enrollment-serialized mutation authority. It
 * answers `createSessionForOccurrence` from a response queue — an outcome, the
 * `'created'` shorthand (insert the aggregate it was handed, at the scripted
 * committed version), or an Error to throw — and records every input, so a test
 * can prove exactly what the use case asked the authority to persist, and how
 * many times.
 */
type StubResponse = CreateSessionForOccurrenceOutcome | 'created' | Error;

class StubRunOccurrenceWrites implements RunOccurrenceWriteRepository {
  readonly calls: CreateSessionForOccurrenceInput[] = [];
  /** The scripted answers. Push to extend the script mid-test. */
  readonly responses: StubResponse[];

  constructor(
    responses: ReadonlyArray<StubResponse> = [],
    /** The committed version the authority reports for a successful insert. */
    private readonly committedVersion?: number,
  ) {
    this.responses = [...responses];
  }

  async createSessionForOccurrence(
    input: CreateSessionForOccurrenceInput,
  ): Promise<CreateSessionForOccurrenceOutcome> {
    this.calls.push(input);
    const response = this.responses.shift();
    if (response === undefined || response === 'created') {
      return { kind: 'created', session: this.persisted(input) };
    }
    if (response instanceof Error) throw response;
    if (response.kind === 'created') {
      return { kind: 'created', session: this.persisted(input) };
    }
    return response;
  }

  /** The aggregate the authority would hand back after a successful insert. */
  private persisted(input: CreateSessionForOccurrenceInput) {
    return { ...input.session, version: this.committedVersion ?? input.session.version };
  }

  recordNotPerformed(): Promise<never> {
    return Promise.reject(new Error('recordNotPerformed is not exercised by the start path'));
  }

  undoNotPerformed(): Promise<never> {
    return Promise.reject(new Error('undoNotPerformed is not exercised by the start path'));
  }
}

function makeUseCase(program: TrainingProgram | null = makeProgram()) {
  const programRepo = createMockRepo();
  vi.mocked(programRepo.findBySlug).mockResolvedValue(program);
  const writes = new StubRunOccurrenceWrites([], 3);
  const enrollmentRepo = new InMemoryProgramEnrollmentRepository();
  const useCase = new StartWorkoutSessionUseCase(programRepo, writes, enrollmentRepo, new FakeIdGenerator());
  return { writes, enrollmentRepo, useCase };
}

/**
 * A harness whose authority responses and whose enrollment re-reads are both
 * scripted; the first re-read is the preflight enrollment lookup. A `null` entry
 * means the enrollment is gone at that point.
 */
function makeScriptedUseCase(
  responses: ReadonlyArray<StubResponse>,
  rechecks: ReadonlyArray<string | null>,
) {
  const programRepo = createMockRepo();
  vi.mocked(programRepo.findBySlug).mockResolvedValue(makeProgram());
  const writes = new StubRunOccurrenceWrites(responses, 0);
  const enrollmentRepo = new InMemoryProgramEnrollmentRepository();
  const recheckSpy = vi
    .spyOn(enrollmentRepo, 'findByUserAndProgram')
    .mockImplementation(async () => {
      const next = rechecks[recheckSpy.mock.calls.length - 1];
      return next === null || next === undefined ? null : makeEnrollment(next);
    });
  const useCase = new StartWorkoutSessionUseCase(programRepo, writes, enrollmentRepo, new FakeIdGenerator());
  return { writes, recheckSpy, useCase };
}

const START_INPUT = { programSlug: 'test-program', weekNumber: 1, workoutOrder: 1 } as const;


describe('StartWorkoutSessionUseCase', () => {
  it('builds the aggregate and delegates creation to the serialized authority', async () => {
    const { enrollmentRepo, writes, useCase } = makeUseCase();
    await enroll(enrollmentRepo, 'enr-a', OWNER_A, 'prog-test');

    const result = await useCase.execute({ ...START_INPUT, userId: OWNER_A });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Exactly one creation request, addressed to the run and the occurrence.
    expect(writes.calls).toHaveLength(1);
    const call = writes.calls[0];
    if (call === undefined) throw Error();
    expect(call.enrollmentId).toBe('enr-a');
    expect(call.scheduledWorkoutId).toBe('sched-w1');

    // The Application built the aggregate: fresh id, version 0, authored
    // template identity, one log per authored exercise in authored order.
    expect(call.session.id).toBe('fake-id-1');
    expect(call.session.version).toBe(0);
    expect(call.session.userId).toBe(OWNER_A);
    expect(call.session.enrollmentId).toBe('enr-a');
    expect(call.session.workoutId).toBe('wo-1');
    expect(call.session.completedAt).toBeNull();
    expect(call.session.exerciseLogs.map((log) => log.order)).toEqual([1, 2]);
    expect(call.session.exerciseLogs[0]?.performedExerciseId).toBe('ex-001');
    expect(call.session.startedAt).toBeInstanceOf(Date);

    // The DTO is built from the PERSISTED aggregate: the authority's committed
    // version (3), never the pre-insert snapshot's 0.
    expect(result.data.sessionId).toBe('fake-id-1');
    expect(result.data.version).toBe(3);
    expect(result.data.status).toBe('in-progress');
    expect(result.data.exerciseLogs).toHaveLength(2);
    expect(result.data.exerciseLogs[0]?.sets).toEqual([]);
  });

  it('returns PROGRAM_NOT_FOUND when the program is missing', async () => {
    const { writes, useCase } = makeUseCase(null);

    const result = await useCase.execute({ ...START_INPUT, programSlug: 'missing', userId: OWNER_A });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('PROGRAM_NOT_FOUND');
    expect(writes.calls).toHaveLength(0);
  });

  it('returns SCHEDULED_WORKOUT_NOT_FOUND for an unknown week', async () => {
    const { enrollmentRepo, writes, useCase } = makeUseCase();
    await enroll(enrollmentRepo, 'enr-a', OWNER_A, 'prog-test');

    const result = await useCase.execute({ ...START_INPUT, weekNumber: 99, userId: OWNER_A });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('SCHEDULED_WORKOUT_NOT_FOUND');
    expect(writes.calls).toHaveLength(0);
  });

  it('returns NOT_ENROLLED for a user who has not joined, without creating', async () => {
    const { writes, useCase } = makeUseCase();

    const result = await useCase.execute({ ...START_INPUT, userId: OWNER_A });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('NOT_ENROLLED');
    expect(writes.calls).toHaveLength(0);
  });

  it('returns INVALID_WORKOUT_SESSION for an invalid user id, without creating', async () => {
    const { writes, useCase } = makeUseCase();

    const result = await useCase.execute({ ...START_INPUT, userId: '   ' });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('INVALID_WORKOUT_SESSION');
    expect(writes.calls).toHaveLength(0);
  });

  it('maps recorded-not-performed to OCCURRENCE_RECORDED_NOT_PERFORMED exactly', async () => {
    const { enrollmentRepo, writes, useCase } = makeUseCase();
    await enroll(enrollmentRepo, 'enr-a', OWNER_A, 'prog-test');
    writes.responses.push({ kind: 'recorded-not-performed' });

    const result = await useCase.execute({ ...START_INPUT, userId: OWNER_A });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('OCCURRENCE_RECORDED_NOT_PERFORMED');
    expect('scheduledWorkoutId' in result.error && result.error.scheduledWorkoutId).toBe('sched-w1');
    expect(writes.calls).toHaveLength(1);
  });

  it('maps the established duplicate-session error to SESSION_ALREADY_EXISTS', async () => {
    const { enrollmentRepo, writes, useCase } = makeUseCase();
    await enroll(enrollmentRepo, 'enr-a', OWNER_A, 'prog-test');
    writes.responses.push(new SessionAlreadyExistsError('sched-w1'));

    const result = await useCase.execute({ ...START_INPUT, userId: OWNER_A });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('SESSION_ALREADY_EXISTS');
    expect(writes.calls).toHaveLength(1);
  });

  it('propagates a child occurrence-key conflict as a data-integrity failure', async () => {
    const { enrollmentRepo, writes, useCase } = makeUseCase();
    await enroll(enrollmentRepo, 'enr-a', OWNER_A, 'prog-test');
    writes.responses.push(new SessionOccurrenceKeyConflictError('fake-id-1'));

    await expect(useCase.execute({ ...START_INPUT, userId: OWNER_A })).rejects.toBeInstanceOf(
      SessionOccurrenceKeyConflictError,
    );
    expect(writes.calls).toHaveLength(1);
  });

  it('lets two enrolled users start the same occurrence independently', async () => {
    const { enrollmentRepo, writes, useCase } = makeUseCase();
    await enroll(enrollmentRepo, 'enr-a', OWNER_A, 'prog-test');
    await enroll(enrollmentRepo, 'enr-b', OWNER_B, 'prog-test');

    const first = await useCase.execute({ ...START_INPUT, userId: OWNER_A });
    const second = await useCase.execute({ ...START_INPUT, userId: OWNER_B });

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(writes.calls.map((call) => call.enrollmentId)).toEqual(['enr-a', 'enr-b']);
    if (!first.ok || !second.ok) return;
    expect(first.data.sessionId).not.toBe(second.data.sessionId);
  });
});

describe('StartWorkoutSessionUseCase — the bounded enrollment-replacement retry', () => {
  it('resolves a vanished run whose enrollment is gone to NOT_ENROLLED', async () => {
    const { writes, useCase } = makeScriptedUseCase([{ kind: 'run-vanished' }], ['enr-a', null]);

    const result = await useCase.execute({ ...START_INPUT, userId: OWNER_A });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('NOT_ENROLLED');
    expect(writes.calls).toHaveLength(1);
  });

  it('rethrows the vanished-run outcome when the enrollment is actually present', async () => {
    const { writes, useCase } = makeScriptedUseCase([{ kind: 'run-vanished' }], ['enr-a', 'enr-a']);

    // The outcome contradicts observable state, so it must propagate rather
    // than be silently converted into a business outcome.
    await expect(useCase.execute({ ...START_INPUT, userId: OWNER_A })).rejects.toBeInstanceOf(
      SessionEnrollmentNotFoundError,
    );
    expect(writes.calls).toHaveLength(1);
  });

  it('retries once against a replacement enrollment through the SAME authority', async () => {
    const { writes, useCase } = makeScriptedUseCase([{ kind: 'run-vanished' }, 'created'], ['enr-a', 'enr-b']);

    const result = await useCase.execute({ ...START_INPUT, userId: OWNER_A });

    expect(result.ok).toBe(true);
    expect(writes.calls).toHaveLength(2);
    expect(writes.calls[0]?.enrollmentId).toBe('enr-a');
    expect(writes.calls[1]?.enrollmentId).toBe('enr-b');

    // The retry re-points the SAME brand-new entity (same id, same version) at
    // the replacement enrollment and goes through the serialized authority —
    // never a second write path.
    const retry = writes.calls[1];
    if (retry === undefined) throw Error();
    expect(retry.session.id).toBe('fake-id-1');
    expect(retry.session.version).toBe(0);
    expect(retry.session.enrollmentId).toBe('enr-b');
  });

  it('maps a duplicate under the replacement enrollment to SESSION_ALREADY_EXISTS', async () => {
    const { writes, useCase } = makeScriptedUseCase(
      [{ kind: 'run-vanished' }, new SessionAlreadyExistsError('sched-w1')],
      ['enr-a', 'enr-b'],
    );

    const result = await useCase.execute({ ...START_INPUT, userId: OWNER_A });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('SESSION_ALREADY_EXISTS');
    expect(writes.calls).toHaveLength(2);
  });

  it('maps a settled occurrence under the replacement enrollment to OCCURRENCE_RECORDED_NOT_PERFORMED', async () => {
    const { writes, useCase } = makeScriptedUseCase(
      [{ kind: 'run-vanished' }, { kind: 'recorded-not-performed' }],
      ['enr-a', 'enr-b'],
    );

    const result = await useCase.execute({ ...START_INPUT, userId: OWNER_A });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('OCCURRENCE_RECORDED_NOT_PERFORMED');
    expect(writes.calls).toHaveLength(2);
  });

  it('returns NOT_ENROLLED when the replacement enrollment is deleted before the retry', async () => {
    const { writes, useCase } = makeScriptedUseCase(
      [{ kind: 'run-vanished' }, { kind: 'run-vanished' }],
      ['enr-a', 'enr-b', null],
    );

    const result = await useCase.execute({ ...START_INPUT, userId: OWNER_A });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('NOT_ENROLLED');
    expect(writes.calls).toHaveLength(2);
  });

  it('returns a typed conflict instead of a third creation when the enrollment changes again', async () => {
    const { writes, useCase } = makeScriptedUseCase(
      [{ kind: 'run-vanished' }, { kind: 'run-vanished' }],
      ['enr-a', 'enr-b', 'enr-c'],
    );

    const result = await useCase.execute({ ...START_INPUT, userId: OWNER_A });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('ENROLLMENT_CHANGED');
    // The recovery is single-shot: exactly two of the four allowed attempts.
    expect(writes.calls).toHaveLength(2);
  });

  it('rethrows when the same replacement enrollment still exists after the retry failure', async () => {
    const { writes, useCase } = makeScriptedUseCase(
      [{ kind: 'run-vanished' }, { kind: 'run-vanished' }],
      ['enr-a', 'enr-b', 'enr-b'],
    );

    await expect(useCase.execute({ ...START_INPUT, userId: OWNER_A })).rejects.toBeInstanceOf(
      SessionEnrollmentNotFoundError,
    );
    expect(writes.calls).toHaveLength(2);
  });

  it('propagates unrelated retry errors instead of recovering', async () => {
    const { writes, useCase } = makeScriptedUseCase(
      [{ kind: 'run-vanished' }, new Error('connection lost')],
      ['enr-a', 'enr-b'],
    );

    await expect(useCase.execute({ ...START_INPUT, userId: OWNER_A })).rejects.toThrow(
      'connection lost',
    );
    expect(writes.calls).toHaveLength(2);
  });
});
