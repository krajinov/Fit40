/**
 * Application tests for `UndoNotPerformedUseCase` (M17 Slice 7).
 *
 * Undo is a translator like record: it resolves the caller's run and authored
 * occurrence, issues exactly ONE mutation, and maps the authority's outcome.
 * Undo removes the recorded fact and nothing else — these tests pin that no
 * record/session write is even reachable from this path, and that a vanished run
 * is disambiguated by exactly one read-only re-check.
 */

import { describe, expect, it } from 'vitest';

import {
  NotPerformedWriteContractViolationError,
  type CreateSessionForOccurrenceInput,
  type RecordNotPerformedInput,
  type RunOccurrenceWriteRepository,
  type UndoNotPerformedInput,
  type UndoNotPerformedOutcome,
} from '@/application/ports/run-occurrence-write-repository';
import { UndoNotPerformedUseCase } from '@/application/use-cases/undo-not-performed';
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

/**
 * A scripted stand-in for the settlement authority that records every call it
 * receives. `recordNotPerformed` and `createSessionForOccurrence` reject, so a
 * use case that tried any other write would fail the test loudly.
 */
class StubRunOccurrenceWrites implements RunOccurrenceWriteRepository {
  readonly undoCalls: UndoNotPerformedInput[] = [];
  readonly recordCalls: RecordNotPerformedInput[] = [];
  readonly createCalls: unknown[] = [];
  readonly responses: Array<UndoNotPerformedOutcome | Error> = [];

  async undoNotPerformed(input: UndoNotPerformedInput): Promise<UndoNotPerformedOutcome> {
    this.undoCalls.push(input);
    const response = this.responses.shift();
    if (response === undefined) {
      return { kind: 'undo' };
    }
    if (response instanceof Error) throw response;
    return response;
  }

  recordNotPerformed(input: RecordNotPerformedInput): Promise<never> {
    this.recordCalls.push(input);
    return Promise.reject(new Error('recordNotPerformed is not exercised by the undo path'));
  }

  createSessionForOccurrence(input: CreateSessionForOccurrenceInput): Promise<never> {
    this.createCalls.push(input);
    return Promise.reject(new Error('createSessionForOccurrence is not exercised by the undo path'));
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
  const useCase = new UndoNotPerformedUseCase(programRepo, enrollmentRepo, writes);
  return { programRepo, enrollmentRepo, writes, useCase };
}

type Harness = ReturnType<typeof makeHarness>;

/** Executes the use case for week 1 / workout 2 (the fixture's W1_2 occurrence). */
function undo(harness: Harness, overrides: Partial<Record<string, unknown>> = {}) {
  return harness.useCase.execute({
    userId: USER_A,
    programSlug: PROGRAM_SLUG,
    weekNumber: 1,
    workoutOrder: 2,
    ...overrides,
  } as Parameters<Harness['useCase']['execute']>[0]);
}

describe('UndoNotPerformedUseCase', () => {
  it('undoes with the resolved run and the authored occurrence only', async () => {
    const harness = makeHarness();

    const result = await undo(harness);

    expect(result).toEqual({ ok: true, data: undefined });
    expect(harness.writes.undoCalls).toHaveLength(1);

    const call = harness.writes.undoCalls[0];
    if (call === undefined) throw Error();
    // The exact input: the run and the occurrence, and nothing else — no
    // instant, no reason, no client-supplied id.
    expect(Object.keys(call).sort()).toEqual(['enrollmentId', 'scheduledWorkoutId']);
    expect(call.enrollmentId).toBe(enrollmentId(ENR_A));
    expect(call.scheduledWorkoutId).toBe(scheduledWorkoutId(OCCURRENCE_W1_2));
    // No other write is reachable from this path.
    expect(harness.writes.recordCalls).toHaveLength(0);
    expect(harness.writes.createCalls).toHaveLength(0);
  });

  it('reports NOT_ENROLLED without calling the authority when the user has no run', async () => {
    const harness = makeHarness({ enrollments: [null] });

    const result = await undo(harness);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('NOT_ENROLLED');
    expect(harness.writes.undoCalls).toHaveLength(0);
  });

  it('reports SCHEDULED_WORKOUT_NOT_FOUND for an authored coordinate that does not exist', async () => {
    const harness = makeHarness();

    const result = await undo(harness, { workoutOrder: 9 });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toEqual({
      code: 'SCHEDULED_WORKOUT_NOT_FOUND',
      programSlug: PROGRAM_SLUG,
      weekNumber: 1,
      workoutOrder: 9,
      message: expect.any(String),
    });
    expect(harness.writes.undoCalls).toHaveLength(0);
  });

  it('reports INVALID_INPUT for an invalid user id without calling the authority', async () => {
    const harness = makeHarness();

    const result = await undo(harness, { userId: '' });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toEqual({
      code: 'INVALID_INPUT',
      message: expect.any(String),
      field: 'userId',
    });
    expect(harness.writes.undoCalls).toHaveLength(0);
  });

  it('reports PROGRAM_NOT_FOUND for an unknown program without calling the authority', async () => {
    const harness = makeHarness({ program: null });

    const result = await undo(harness);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('PROGRAM_NOT_FOUND');
    expect(harness.writes.undoCalls).toHaveLength(0);
  });

  it('maps the not-recorded refusal to OCCURRENCE_NOT_RECORDED', async () => {
    const harness = makeHarness();
    harness.writes.responses.push({ kind: 'refuse', reason: 'not-recorded' });

    const result = await undo(harness);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toEqual({
      code: 'OCCURRENCE_NOT_RECORDED',
      programSlug: PROGRAM_SLUG,
      scheduledWorkoutId: OCCURRENCE_W1_2,
      message: expect.any(String),
    });
    expect(harness.writes.undoCalls).toHaveLength(1);
  });
});



describe('UndoNotPerformedUseCase — vanished run and contract breaches', () => {
  it('maps run-vanished with no current enrollment to NOT_ENROLLED, without retrying', async () => {
    const harness = makeHarness({ enrollments: [enrollment(ENR_A, USER_A), null] });
    harness.writes.responses.push({ kind: 'run-vanished' });

    const result = await undo(harness);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('NOT_ENROLLED');
    expect(harness.writes.undoCalls).toHaveLength(1);
  });

  it('maps run-vanished with a replacement enrollment to ENROLLMENT_CHANGED, without retrying', async () => {
    const harness = makeHarness({
      enrollments: [enrollment(ENR_A, USER_A), enrollment(ENR_B, USER_A)],
    });
    harness.writes.responses.push({ kind: 'run-vanished' });

    const result = await undo(harness);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('ENROLLMENT_CHANGED');
    expect(harness.writes.undoCalls).toHaveLength(1);
  });

  it('throws when run-vanished contradicts the run the caller can still observe', async () => {
    const harness = makeHarness({
      enrollments: [enrollment(ENR_A, USER_A), enrollment(ENR_A, USER_A)],
    });
    harness.writes.responses.push({ kind: 'run-vanished' });

    await expect(undo(harness)).rejects.toBeInstanceOf(NotPerformedWriteContractViolationError);
    expect(harness.writes.undoCalls).toHaveLength(1);
  });

  it('throws on contract-violation instead of returning a business outcome', async () => {
    const harness = makeHarness();
    harness.writes.responses.push({ kind: 'contract-violation' });

    const attempt = undo(harness);

    await expect(attempt).rejects.toBeInstanceOf(NotPerformedWriteContractViolationError);
    await attempt.catch((error: unknown) => {
      expect((error as NotPerformedWriteContractViolationError).operation).toBe('undo');
    });
    expect(harness.writes.undoCalls).toHaveLength(1);
  });

  it('propagates an unexpected infrastructure failure untranslated', async () => {
    const harness = makeHarness();
    harness.writes.responses.push(new Error('connection lost'));

    await expect(undo(harness)).rejects.toThrow('connection lost');
    expect(harness.writes.undoCalls).toHaveLength(1);
  });

  it('has no capability to regenerate a schedule or mutate session history', async () => {
    // Undo's only collaborator that can write is the one mutation authority, and
    // the only method it calls is `undoNotPerformed`. Regeneration, planned-row
    // writes and session writes are not reachable from this use case at all.
    const harness = makeHarness();

    const result = await undo(harness);

    expect(result.ok).toBe(true);
    expect(harness.writes.undoCalls).toHaveLength(1);
    expect(harness.writes.recordCalls).toHaveLength(0);
    expect(harness.writes.createCalls).toHaveLength(0);
  });
});
