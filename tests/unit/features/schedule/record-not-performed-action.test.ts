/**
 * Contract tests for recordNotPerformedAction (M17 Slice 11).
 *
 * Pinned: the user id comes from the trusted session, the attestation instant
 * `recordedAt` is created HERE (server-owned clock, record only), the
 * occurrence is addressed ONLY by authored public coordinates — no
 * enrollment id, scheduled-workout id, session id or supplied clock can cross
 * the boundary — validation failures are truthful typed states, every real
 * Slice 7 outcome is mapped as data, the Application's contract violation is
 * never swallowed into friendly state, and a successful record revalidates
 * exactly the program detail and the dashboard.
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
import type { RecordNotPerformedError } from '@/application/use-cases/record-not-performed';
import { recordNotPerformedAction } from '@/features/schedule/actions/record-not-performed';
import { recordNotPerformedUseCase } from '@/features/schedule/services';

const SESSION_USER = {
  id: '11111111-1111-1111-1111-111111111111',
  email: 'user@example.com',
  createdAt: '2026-01-01T00:00:00.000Z',
};

const PROGRAM_PATH = '/programs/fit40-beginner-strength';
// The authored coordinates `submit()` sends (week 2, order 3) resolved to the
// concrete nested occurrence routes.
const WORKOUT_PATH = '/programs/fit40-beginner-strength/weeks/2/workouts/3';
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
  const call = vi.mocked(recordNotPerformedUseCase.execute).mock.calls.at(0);
  if (call === undefined) throw new Error('use case was not called');
  return call[0] as unknown as Record<string, unknown>;
}

describe('recordNotPerformedAction', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    requireUserMock.mockResolvedValue(SESSION_USER);
    vi.mocked(recordNotPerformedUseCase.execute).mockResolvedValue({
      ok: true,
      data: undefined,
    });
  });

  it('redirects unauthenticated callers without touching the use case', async () => {
    requireUserMock.mockImplementation(() =>
      redirectMock(`/login?next=${encodeURIComponent(PROGRAM_PATH)}`),
    );

    await expect(recordNotPerformedAction(submit())).rejects.toThrow('NEXT_REDIRECT');

    expect(recordNotPerformedUseCase.execute).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('rejects malformed authored coordinates without calling the use case', async () => {
    const coordinateFailures: ReadonlyArray<Readonly<Record<string, string>>> = [
      { weekNumber: '0' },
      { weekNumber: 'abc' },
      { workoutOrder: '' },
      { programSlug: 'not a slug' },
    ];

    for (const overrides of coordinateFailures) {
      vi.mocked(recordNotPerformedUseCase.execute).mockClear();

      const state = await recordNotPerformedAction(submit(overrides));

      expect(state).toEqual({
        ok: false,
        error: { code: 'VALIDATION_ERROR', message: 'Invalid workout request.' },
      });
      expect(recordNotPerformedUseCase.execute).not.toHaveBeenCalled();
    }
  });

  it('delegates the trusted user id, the authored coordinates and a server-owned recordedAt', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-09-23T08:15:00.000Z'));

      await recordNotPerformedAction(
        submit({}, [
          ['userId', 'attacker-supplied-id'],
          ['enrollmentId', 'enr-attacker'],
          ['scheduledWorkoutId', 'sw-attacker'],
          ['sessionId', 's-attacker'],
          ['recordedAt', '1999-01-01T00:00:00.000Z'],
        ]),
      );
    } finally {
      vi.useRealTimers();
    }

    const input = executedInput();
    expect(input).toMatchObject({
      userId: SESSION_USER.id,
      programSlug: 'fit40-beginner-strength',
      weekNumber: 2,
      workoutOrder: 3,
    });
    // The attestation instant is created at this boundary and ignores anything
    // the browser submitted.
    expect(input.recordedAt).toBeInstanceOf(Date);
    expect((input.recordedAt as Date).toISOString()).toBe('2026-09-23T08:15:00.000Z');
    expect(Object.keys(input).sort()).toEqual([
      'programSlug',
      'recordedAt',
      'userId',
      'weekNumber',
      'workoutOrder',
    ]);
  });

  it('revalidates the exact bounded set on success: program, workout detail, session, dashboard', async () => {
    const state = await recordNotPerformedAction(submit());

    expect(state).toEqual({ ok: true });
    // Exactly FOUR targets, matching Undo: the top-level program + dashboard
    // plus the two concrete nested routes that can render the recorded state
    // (workout detail and session) — so a previously visited occurrence route
    // cannot keep showing its pre-record state. No fifth path, and nothing
    // client-controlled.
    expect(revalidatePath).toHaveBeenCalledTimes(4);
    expect(new Set(vi.mocked(revalidatePath).mock.calls.map((call) => call[0]))).toEqual(
      new Set([PROGRAM_PATH, WORKOUT_PATH, SESSION_PATH, '/dashboard']),
    );
  });

  it('invalidates the exact workout-detail route of the recorded occurrence', async () => {
    await recordNotPerformedAction(submit());

    expect(revalidatePath).toHaveBeenCalledWith(WORKOUT_PATH);
  });

  it('invalidates the exact session route of the recorded occurrence', async () => {
    await recordNotPerformedAction(submit());

    expect(revalidatePath).toHaveBeenCalledWith(SESSION_PATH);
  });

  it('derives every path from the PARSED route, never from other submitted fields', async () => {
    // A forged path/coordinate field must not become a revalidation target: the
    // action revalidates only the coordinates the schema validated.
    await recordNotPerformedAction(
      submit({}, [
        ['path', '/programs/attacker-program/weeks/9/workouts/9'],
        ['next', '/dashboard/elsewhere'],
        ['redirectTo', '/evil'],
      ]),
    );

    const targets = vi.mocked(revalidatePath).mock.calls.map((call) => call[0]);
    expect(new Set(targets)).toEqual(
      new Set([PROGRAM_PATH, WORKOUT_PATH, SESSION_PATH, '/dashboard']),
    );
    for (const target of targets) {
      expect(target).not.toContain('attacker');
      expect(target).not.toContain('evil');
      expect(target).not.toContain('elsewhere');
    }
  });

  it('maps every real Slice 7 record outcome truthfully, without revalidating', async () => {
    const slug = 'fit40-beginner-strength';
    const cases: ReadonlyArray<RecordNotPerformedError> = [
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
        code: 'OCCURRENCE_ALREADY_RECORDED',
        programSlug: slug,
        scheduledWorkoutId: 'sw-1',
        message: 'This workout is already recorded as not performed.',
      },
      {
        code: 'OCCURRENCE_ALREADY_PERFORMED',
        programSlug: slug,
        scheduledWorkoutId: 'sw-1',
        message: 'This workout already has a completed session.',
      },
      {
        code: 'OCCURRENCE_HAS_LOGGED_WORK',
        programSlug: slug,
        scheduledWorkoutId: 'sw-1',
        message: 'This workout has logged work and cannot be recorded as not performed.',
      },
      {
        code: 'ENROLLMENT_CHANGED',
        programSlug: slug,
        message: 'Your enrollment changed. Please reload and try again.',
      },
    ];

    for (const error of cases) {
      vi.mocked(recordNotPerformedUseCase.execute).mockClear();
      vi.mocked(revalidatePath).mockClear();
      vi.mocked(recordNotPerformedUseCase.execute).mockResolvedValue({ ok: false, error });

      const state = await recordNotPerformedAction(submit());

      expect(state).toEqual({ ok: false, error: { code: error.code, message: error.message } });
      expect(revalidatePath).not.toHaveBeenCalled();
    }
  });

  it('never converts an Application contract violation into friendly action state', async () => {
    vi.mocked(recordNotPerformedUseCase.execute).mockRejectedValue(
      new NotPerformedWriteContractViolationError('record', 'database refused an authorized write'),
    );

    await expect(recordNotPerformedAction(submit())).rejects.toThrow(
      'Not-performed record contract violated',
    );
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('lets unexpected errors propagate instead of converting them to validation state', async () => {
    vi.mocked(recordNotPerformedUseCase.execute).mockRejectedValue(
      new Error('connection terminated unexpectedly'),
    );

    await expect(recordNotPerformedAction(submit())).rejects.toThrow(
      'connection terminated unexpectedly',
    );
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
