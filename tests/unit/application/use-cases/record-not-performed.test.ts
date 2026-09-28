/**
 * Application tests for `RecordNotPerformedUseCase` (M17 Slice 7).
 *
 * The use case is a translator: it resolves the caller's run and authored
 * occurrence, issues exactly ONE mutation, and maps the authority's outcome.
 * These tests pin that boundary with a stub authority — no settlement facts are
 * read here, no policy is decided here, and every outcome the authority can
 * report has exactly one translation.
 */

import { describe, expect, it } from 'vitest';

import {
  NotPerformedWriteContractViolationError,
  type CreateSessionForOccurrenceInput,
  type RecordNotPerformedInput,
  type RecordNotPerformedOutcome,
  type RunOccurrenceWriteRepository,
  type UndoNotPerformedInput,
} from '@/application/ports/run-occurrence-write-repository';
import { RecordNotPerformedUseCase } from '@/application/use-cases/record-not-performed';
import type { TrainingProgram } from '@/domain/entities/training-program';

import {
  enrollment,
  enrollmentId,
  makeEnrollmentRepo,
  makeProgram,
  makeProgramRepo,
  OCCURRENCE_W1_2,
  PROGRAM_SLUG,
  scheduledWorkoutId,
} from './schedule-fixtures';

const PROGRAM = makeProgram();
const USER_A = 'user-a';
const ENR_A = 'enr-a';
const ENR_B = 'enr-b';
/** The attestation instant the CALLER supplies; this layer reads no clock. */
const RECORDED_AT = new Date('2026-09-28T18:30:00.000Z');

/**
 * A scripted stand-in for the settlement authority. It records every input it
 * receives — including calls it must never receive — so "exactly one mutation"
 * and "no session write on this path" are assertions, not assumptions.
 */
class StubRunOccurrenceWrites implements RunOccurrenceWriteRepository {
  readonly recordCalls: RecordNotPerformedInput[] = [];
  readonly undoCalls: UndoNotPerformedInput[] = [];
  readonly createCalls: unknown[] = [];
  readonly responses: Array<RecordNotPerformedOutcome | Error> = [];

  async recordNotPerformed(input: RecordNotPerformedInput): Promise<RecordNotPerformedOutcome> {
    this.recordCalls.push(input);
    const response = this.responses.shift();
    if (response === undefined) {
      return { kind: 'record', deletesAbandonedSession: false };
    }
    if (response instanceof Error) throw response;
    return response;
  }

  undoNotPerformed(input: UndoNotPerformedInput): Promise<never> {
    this.undoCalls.push(input);
    return Promise.reject(new Error('undoNotPerformed is not exercised by the record path'));
  }

  createSessionForOccurrence(input: CreateSessionForOccurrenceInput): Promise<never> {
    this.createCalls.push(input);
    return Promise.reject(new Error('createSessionForOccurrence is not exercised by record/undo'));
  }
}

function makeHarness(
  options: {
    readonly program?: TrainingProgram | null;
    readonly enrollments?: ReadonlyArray<ReturnType<typeof enrollment> | null>;
  } = {},
) {
  const programRepo = makeProgramRepo(options.program === undefined ? PROGRAM : options.program);
  const enrollmentRepo = makeEnrollmentRepo(
    options.enrollments ?? [enrollment(ENR_A, USER_A)],
  );
  const writes = new StubRunOccurrenceWrites();
  const useCase = new RecordNotPerformedUseCase(programRepo, enrollmentRepo, writes);
  return { programRepo, enrollmentRepo, writes, useCase };
}

type Harness = ReturnType<typeof makeHarness>;

/** Executes the use case for week 1 / workout 2 (the fixture's W1_2 occurrence). */
function record(harness: Harness, overrides: Partial<Record<string, unknown>> = {}) {
  return harness.useCase.execute({
    userId: USER_A,
    programSlug: PROGRAM_SLUG,
    weekNumber: 1,
    workoutOrder: 2,
    recordedAt: RECORDED_AT,
    ...overrides,
  } as Parameters<Harness['useCase']['execute']>[0]);
}

describe('RecordNotPerformedUseCase', () => {
  it('records with the resolved run, the authored occurrence and the supplied instant', async () => {
    const harness = makeHarness();

    const result = await record(harness);

    expect(result).toEqual({ ok: true, data: undefined });
    expect(harness.writes.recordCalls).toHaveLength(1);

    const call = harness.writes.recordCalls[0];
    if (call === undefined) throw Error();
    expect(call.enrollmentId).toBe(enrollmentId(ENR_A));
    expect(call.scheduledWorkoutId).toBe(scheduledWorkoutId(OCCURRENCE_W1_2));
    // The caller's instant is passed VERBATIM: same Date instance, never a
    // reconstructed or clock-derived one.
    expect(call.recordedAt).toBe(RECORDED_AT);
    // Exactly one mutation, on this path: no undo write and no session write.
    expect(harness.writes.undoCalls).toHaveLength(0);
    expect(harness.writes.createCalls).toHaveLength(0);
  });

  it('succeeds identically when the authority also deleted an abandoned session', async () => {
    // `deletesAbandonedSession` is the authority's execution detail; the
    // Application must not branch on it (no policy here).
    const harness = makeHarness();
    harness.writes.responses.push({ kind: 'record', deletesAbandonedSession: true });

    const result = await record(harness);

    expect(result).toEqual({ ok: true, data: undefined });
    expect(harness.writes.recordCalls).toHaveLength(1);
  });

  it('reports NOT_ENROLLED without calling the authority when the user has no run', async () => {
    const harness = makeHarness({ enrollments: [null] });

    const result = await record(harness);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toEqual({
      code: 'NOT_ENROLLED',
      programSlug: PROGRAM_SLUG,
      message: expect.any(String),
    });
    expect(harness.writes.recordCalls).toHaveLength(0);
  });

  it('reports SCHEDULED_WORKOUT_NOT_FOUND for an authored coordinate that does not exist', async () => {
    const harness = makeHarness();

    const result = await record(harness, { weekNumber: 9 });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toEqual({
      code: 'SCHEDULED_WORKOUT_NOT_FOUND',
      programSlug: PROGRAM_SLUG,
      weekNumber: 9,
      workoutOrder: 2,
      message: expect.any(String),
    });
    expect(harness.writes.recordCalls).toHaveLength(0);
  });

  it('reports INVALID_INPUT for an invalid user id without calling the authority', async () => {
    const harness = makeHarness();

    const result = await record(harness, { userId: '   ' });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toEqual({
      code: 'INVALID_INPUT',
      message: expect.any(String),
      field: 'userId',
    });
    expect(harness.writes.recordCalls).toHaveLength(0);
  });

  it('reports PROGRAM_NOT_FOUND for an unknown program without calling the authority', async () => {
    const harness = makeHarness({ program: null });

    const result = await record(harness);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toEqual({
      code: 'PROGRAM_NOT_FOUND',
      slug: PROGRAM_SLUG,
      message: expect.any(String),
    });
    expect(harness.writes.recordCalls).toHaveLength(0);
  });

  it('maps already-recorded to OCCURRENCE_ALREADY_RECORDED', async () => {
    const harness = makeHarness();
    harness.writes.responses.push({ kind: 'refuse', reason: 'already-recorded' });

    const result = await record(harness);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toEqual({
      code: 'OCCURRENCE_ALREADY_RECORDED',
      programSlug: PROGRAM_SLUG,
      scheduledWorkoutId: OCCURRENCE_W1_2,
      message: expect.any(String),
    });
    expect(harness.writes.recordCalls).toHaveLength(1);
  });

  it('maps already-performed to OCCURRENCE_ALREADY_PERFORMED', async () => {
    const harness = makeHarness();
    harness.writes.responses.push({ kind: 'refuse', reason: 'already-performed' });

    const result = await record(harness);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('OCCURRENCE_ALREADY_PERFORMED');
    expect(harness.writes.recordCalls).toHaveLength(1);
  });

  it('maps has-logged-work to OCCURRENCE_HAS_LOGGED_WORK', async () => {
    const harness = makeHarness();
    harness.writes.responses.push({ kind: 'refuse', reason: 'has-logged-work' });

    const result = await record(harness);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('OCCURRENCE_HAS_LOGGED_WORK');
    expect(harness.writes.recordCalls).toHaveLength(1);
  });
});


describe('RecordNotPerformedUseCase — vanished run and contract breaches', () => {
  it('maps run-vanished with no current enrollment to NOT_ENROLLED, without retrying', async () => {
    const harness = makeHarness({ enrollments: [enrollment(ENR_A, USER_A), null] });
    harness.writes.responses.push({ kind: 'run-vanished' });

    const result = await record(harness);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('NOT_ENROLLED');
    // No retry write: the lost race is reported, never resolved by writing again.
    expect(harness.writes.recordCalls).toHaveLength(1);
  });

  it('maps run-vanished with a replacement enrollment to ENROLLMENT_CHANGED, without retrying', async () => {
    const harness = makeHarness({
      enrollments: [enrollment(ENR_A, USER_A), enrollment(ENR_B, USER_A)],
    });
    harness.writes.responses.push({ kind: 'run-vanished' });

    const result = await record(harness);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('ENROLLMENT_CHANGED');
    expect(harness.writes.recordCalls).toHaveLength(1);
  });

  it('throws when run-vanished contradicts the run the caller can still observe', async () => {
    const harness = makeHarness({
      enrollments: [enrollment(ENR_A, USER_A), enrollment(ENR_A, USER_A)],
    });
    harness.writes.responses.push({ kind: 'run-vanished' });

    await expect(record(harness)).rejects.toBeInstanceOf(
      NotPerformedWriteContractViolationError,
    );
    expect(harness.writes.recordCalls).toHaveLength(1);
  });

  it('throws on contract-violation instead of returning a business outcome', async () => {
    const harness = makeHarness();
    harness.writes.responses.push({ kind: 'contract-violation' });

    const attempt = record(harness);

    await expect(attempt).rejects.toBeInstanceOf(NotPerformedWriteContractViolationError);
    await attempt.catch((error: unknown) => {
      expect((error as NotPerformedWriteContractViolationError).operation).toBe('record');
    });
    expect(harness.writes.recordCalls).toHaveLength(1);
  });

  it('propagates an unexpected infrastructure failure untranslated', async () => {
    const harness = makeHarness();
    harness.writes.responses.push(new Error('connection lost'));

    await expect(record(harness)).rejects.toThrow('connection lost');
    expect(harness.writes.recordCalls).toHaveLength(1);
  });
});

