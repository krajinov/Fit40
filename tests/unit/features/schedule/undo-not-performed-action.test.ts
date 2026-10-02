/**
 * Contract tests for undoNotPerformedAction (M17 Slice 11).
 *
 * Pinned: the trusted-session UserId, authored coordinates only, and NO clock
 * anywhere in the delegated input (undo is a deletion, not an attestation);
 * the Slice 7 undo outcomes are mapped as data; the Application's contract
 * violation propagates; and a successful undo revalidates exactly the bounded
 * set of routes that render the recorded state — the program detail, the
 * occurrence's workout-detail route and its session route (all built from the
 * authored coordinates), plus the dashboard — never a client-supplied path
 * (no regeneration, no session creation, no redirect).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { requireUserMock, redirectMock } = vi.hoisted(() => ({
  requireUserMock: vi.fn(),
  redirectMock: vi.fn((target: string) => {
    const error = new Error(`NEXT_REDIRECT:${target}`);
    error.name = 'NEXT_REDIRECT';
    throw error;
  }),
}));

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

vi.mock('@/features/auth/current-user', () => ({ requireUser: requireUserMock }));

vi.mock('@/features/schedule/services', () => ({
  recordNotPerformedUseCase: { execute: vi.fn() },
  undoNotPerformedUseCase: { execute: vi.fn() },
}));

import { revalidatePath } from 'next/cache';

import { NotPerformedWriteContractViolationError } from '@/application/ports/run-occurrence-write-repository';
import type { UndoNotPerformedError } from '@/application/use-cases/undo-not-performed';
import { undoNotPerformedAction } from '@/features/schedule/actions/undo-not-performed';
import { undoNotPerformedUseCase } from '@/features/schedule/services';

const SESSION_USER = {
  id: '11111111-1111-1111-1111-111111111111',
  email: 'user@example.com',
  createdAt: '2026-01-01T00:00:00.000Z',
};

const PROGRAM_PATH = '/programs/fit40-beginner-strength';
const WORKOUT_PATH = `${PROGRAM_PATH}/weeks/2/workouts/3`;
const SESSION_PATH = `${WORKOUT_PATH}/session`;

function submit(
  overrides: Readonly<Record<string, string>> = {},
  extras: ReadonlyArray<readonly [string, string]> = [],
): FormData {
  const fields: Record<string, string> = {
    programSlug: 'fit40-beginner-strength',
    weekNumber: '2',
    workoutOrder: '3',
    ...overrides,
  };
  const fd = new FormData();
  for (const [name, value] of Object.entries(fields)) {
    fd.set(name, value);
  }
  for (const [name, value] of extras) {
    fd.set(name, value);
  }
  return fd;
}

function executedInput(): Record<string, unknown> {
  const call = vi.mocked(undoNotPerformedUseCase.execute).mock.calls.at(0);
  if (call === undefined) throw new Error('use case was not called');
  return call[0] as unknown as Record<string, unknown>;
}

describe('undoNotPerformedAction', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    requireUserMock.mockResolvedValue(SESSION_USER);
    vi.mocked(undoNotPerformedUseCase.execute).mockResolvedValue({ ok: true, data: undefined });
  });

  it('redirects unauthenticated callers without touching the use case', async () => {
    requireUserMock.mockImplementation(() =>
      redirectMock(`/login?next=${encodeURIComponent(PROGRAM_PATH)}`),
    );

    await expect(undoNotPerformedAction(submit())).rejects.toThrow('NEXT_REDIRECT');

    expect(undoNotPerformedUseCase.execute).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('rejects malformed authored coordinates without calling the use case', async () => {
    const state = await undoNotPerformedAction(submit({ weekNumber: 'abc' }));

    expect(state).toEqual({
      ok: false,
      error: { code: 'VALIDATION_ERROR', message: 'Invalid workout request.' },
    });
    expect(undoNotPerformedUseCase.execute).not.toHaveBeenCalled();
  });

  it('delegates the trusted user id and authored coordinates with NO clock', async () => {
    await undoNotPerformedAction(
      submit({}, [
        ['userId', 'attacker-supplied-id'],
        ['enrollmentId', 'enr-attacker'],
        ['scheduledWorkoutId', 'sw-attacker'],
        ['sessionId', 's-attacker'],
        ['recordedAt', '1999-01-01T00:00:00.000Z'],
        ['now', '1999-01-01T00:00:00.000Z'],
      ]),
    );

    const input = executedInput();
    expect(input).toMatchObject({
      userId: SESSION_USER.id,
      programSlug: 'fit40-beginner-strength',
      weekNumber: 2,
      workoutOrder: 3,
    });
    // Undo takes no attestation instant and no request clock: exactly the four
    // delegated fields, nothing from the browser.
    expect(Object.keys(input).sort()).toEqual([
      'programSlug',
      'userId',
      'weekNumber',
      'workoutOrder',
    ]);
    expect(input.recordedAt).toBeUndefined();
    expect(input.now).toBeUndefined();
  });

  it('revalidates the exact bounded set on success: program, workout detail, session, dashboard', async () => {
    const state = await undoNotPerformedAction(submit());

    expect(state).toEqual({ ok: true });
    // Exactly FOUR targets: the top-level program + dashboard plus the two
    // concrete nested routes that can render the recorded state (workout detail
    // and session). No fifth path, and nothing client-controlled.
    expect(revalidatePath).toHaveBeenCalledTimes(4);
    expect(new Set(vi.mocked(revalidatePath).mock.calls.map((call) => call[0]))).toEqual(
      new Set([PROGRAM_PATH, WORKOUT_PATH, SESSION_PATH, '/dashboard']),
    );
  });

  it('invalidates the exact workout-detail route through which Undo can be submitted', async () => {
    await undoNotPerformedAction(submit());

    expect(revalidatePath).toHaveBeenCalledWith(WORKOUT_PATH);
  });

  it('invalidates the exact session route through which Undo can be submitted', async () => {
    await undoNotPerformedAction(submit());

    expect(revalidatePath).toHaveBeenCalledWith(SESSION_PATH);
  });

  it('builds revalidation targets from authored coordinates, never from a client-supplied path', async () => {
    await undoNotPerformedAction(
      submit({}, [
        ['path', '/evil'],
        ['revalidatePath', '/evil'],
        ['redirectTo', 'https://evil.example'],
        ['next', '/evil'],
        ['sessionPath', '/evil'],
      ]),
    );

    const targets = vi.mocked(revalidatePath).mock.calls.map((call) => call[0]);
    // A forged path field changes nothing: the set is still derived only from
    // the Zod-validated authored coordinates.
    expect(new Set(targets)).toEqual(
      new Set([PROGRAM_PATH, WORKOUT_PATH, SESSION_PATH, '/dashboard']),
    );
    expect(targets).not.toContain('/evil');
    expect(targets).not.toContain('https://evil.example');
  });

  it('maps every real Slice 7 undo outcome truthfully, without revalidating', async () => {
    const slug = 'fit40-beginner-strength';
    const cases: ReadonlyArray<UndoNotPerformedError> = [
      { code: 'INVALID_INPUT', message: 'userId is invalid', field: 'userId' },
      { code: 'PROGRAM_NOT_FOUND', slug, message: `Program "${slug}" not found` },
      {
        code: 'SCHEDULED_WORKOUT_NOT_FOUND',
        programSlug: slug,
        weekNumber: 2,
        workoutOrder: 3,
        message: 'Scheduled workout not found for week 2, order 3',
      },
      { code: 'NOT_ENROLLED', programSlug: slug, message: 'You are not enrolled in this program.' },
      {
        code: 'OCCURRENCE_NOT_RECORDED',
        programSlug: slug,
        scheduledWorkoutId: 'sw-1',
        message: 'This workout is not recorded as not performed.',
      },
      {
        code: 'ENROLLMENT_CHANGED',
        programSlug: slug,
        message: 'Your enrollment changed. Please reload and try again.',
      },
    ];

    for (const error of cases) {
      vi.mocked(undoNotPerformedUseCase.execute).mockClear();
      vi.mocked(revalidatePath).mockClear();
      vi.mocked(undoNotPerformedUseCase.execute).mockResolvedValue({ ok: false, error });

      const state = await undoNotPerformedAction(submit());

      expect(state).toEqual({ ok: false, error: { code: error.code, message: error.message } });
      expect(revalidatePath).not.toHaveBeenCalled();
    }
  });

  it('never converts an Application contract violation into friendly action state', async () => {
    vi.mocked(undoNotPerformedUseCase.execute).mockRejectedValue(
      new NotPerformedWriteContractViolationError('undo', 'database refused an authorized write'),
    );

    await expect(undoNotPerformedAction(submit())).rejects.toThrow(
      'Not-performed undo contract violated',
    );
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('lets unexpected errors propagate instead of converting them to validation state', async () => {
    vi.mocked(undoNotPerformedUseCase.execute).mockRejectedValue(
      new Error('connection terminated unexpectedly'),
    );

    await expect(undoNotPerformedAction(submit())).rejects.toThrow(
      'connection terminated unexpectedly',
    );
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
