/**
 * Action tests for restartProgramAction (M14 Slice 6): the trusted session
 * owns the UserId, only the program slug is parsed from the form, every
 * expected RestartProgramError maps into the typed EnrollmentActionState,
 * unexpected errors propagate, and success revalidates every affected view
 * before redirecting to the program detail (never back to the completed
 * page).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { redirectMock, requireUserMock } = vi.hoisted(() => {
  const redirect = vi.fn((target: string) => {
    const error = new Error(`NEXT_REDIRECT:${target}`);
    error.name = 'NEXT_REDIRECT';
    throw error;
  });

  return { redirectMock: redirect, requireUserMock: vi.fn() };
});

vi.mock('next/navigation', () => ({
  redirect: redirectMock,
}));

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

vi.mock('@/features/auth/current-user', () => ({
  requireUser: requireUserMock,
}));

vi.mock('@/features/enrollment/services', () => ({
  restartProgramUseCase: { execute: vi.fn() },
}));

import { revalidatePath } from 'next/cache';

import type { RestartProgramError } from '@/application/use-cases/restart-program';
import { restartProgramAction } from '@/features/enrollment/actions/restart-program';
import { restartProgramUseCase } from '@/features/enrollment/services';
import { SESSION_PAGE_PATH_TEMPLATE } from '@/features/sessions/session-path';

const SESSION_USER = {
  id: '11111111-1111-1111-1111-111111111111',
  email: 'user@example.com',
  createdAt: '2026-01-01T00:00:00.000Z',
};

const SLUG = 'fit40-beginner-strength';
const PROGRAM_PATH = `/programs/${SLUG}`;
const COMPLETED_PATH = `/programs/${SLUG}/completed`;

function makeFormData(): FormData {
  const fd = new FormData();
  fd.set('programSlug', SLUG);
  return fd;
}

const ERROR_CASES: ReadonlyArray<[string, RestartProgramError]> = [
  [
    'PROGRAM_NOT_COMPLETE',
    {
      code: 'PROGRAM_NOT_COMPLETE',
      programSlug: SLUG,
      message: 'This program run is not complete yet.',
    },
  ],
  [
    'ENROLLMENT_CHANGED',
    {
      code: 'ENROLLMENT_CHANGED',
      programSlug: SLUG,
      message: 'Your enrollment changed while restarting the program.',
    },
  ],
  [
    'NOT_ENROLLED',
    {
      code: 'NOT_ENROLLED',
      programSlug: SLUG,
      message: 'You are not enrolled in this program.',
    },
  ],
  [
    'ALREADY_ENROLLED',
    {
      code: 'ALREADY_ENROLLED',
      programSlug: SLUG,
      message: 'You are already enrolled in this program.',
    },
  ],
  [
    'PROGRAM_NOT_FOUND',
    { code: 'PROGRAM_NOT_FOUND', slug: SLUG, message: `Program "${SLUG}" not found` },
  ],
  [
    'INVALID_ENROLLMENT',
    { code: 'INVALID_ENROLLMENT', message: 'Invalid user id.', field: 'userId' },
  ],
];

describe('restartProgramAction', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    requireUserMock.mockResolvedValue(SESSION_USER);
  });

  it('rejects invalid form data as VALIDATION_ERROR without touching the use case', async () => {
    const fd = new FormData();
    fd.set('programSlug', 'Not A Slug!');

    const state = await restartProgramAction(fd);

    expect(state).toEqual({
      ok: false,
      error: { code: 'VALIDATION_ERROR', message: 'Invalid program.' },
    });
    expect(restartProgramUseCase.execute).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it('redirects unauthenticated callers to login with a deep link back to the completion page', async () => {
    requireUserMock.mockImplementation(() =>
      redirectMock(`/login?next=${encodeURIComponent(COMPLETED_PATH)}`),
    );

    await expect(restartProgramAction(makeFormData())).rejects.toThrow('NEXT_REDIRECT');

    expect(redirectMock).toHaveBeenCalledWith(
      `/login?next=${encodeURIComponent(COMPLETED_PATH)}`,
    );
    expect(restartProgramUseCase.execute).not.toHaveBeenCalled();
  });

  it('derives the userId from the session, never from form data', async () => {
    vi.mocked(restartProgramUseCase.execute).mockResolvedValue({ ok: true, data: undefined });

    const fd = makeFormData();
    fd.set('userId', 'attacker-supplied-id');
    fd.set('enrollmentId', 'attacker-supplied-enrollment');

    await expect(restartProgramAction(fd)).rejects.toThrow('NEXT_REDIRECT');

    expect(restartProgramUseCase.execute).toHaveBeenCalledWith({
      userId: SESSION_USER.id,
      programSlug: SLUG,
    });
  });

  it.each(ERROR_CASES)(
    'propagates %s as typed action state without revalidating or redirecting',
    async (code, error) => {
      vi.mocked(restartProgramUseCase.execute).mockResolvedValue({ ok: false, error });

      const state = await restartProgramAction(makeFormData());

      expect(state).toEqual({
        ok: false,
        error: { code, message: error.message },
      });
      expect(revalidatePath).not.toHaveBeenCalled();
      expect(redirectMock).not.toHaveBeenCalled();
    },
  );

  it('lets unexpected errors propagate instead of converting them to results', async () => {
    vi.mocked(restartProgramUseCase.execute).mockRejectedValue(new Error('connection lost'));

    await expect(restartProgramAction(makeFormData())).rejects.toThrow('connection lost');
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('revalidates the catalog, program detail, completion page, dashboard, and nested session page on success', async () => {
    vi.mocked(restartProgramUseCase.execute).mockResolvedValue({ ok: true, data: undefined });

    await expect(restartProgramAction(makeFormData())).rejects.toThrow('NEXT_REDIRECT');

    expect(revalidatePath).toHaveBeenCalledWith('/programs');
    expect(revalidatePath).toHaveBeenCalledWith(PROGRAM_PATH);
    expect(revalidatePath).toHaveBeenCalledWith(COMPLETED_PATH);
    expect(revalidatePath).toHaveBeenCalledWith('/dashboard');
    // The form carries only the program slug, so the nested session route is
    // revalidated by its dynamic template: any session page of this program
    // left open before the restart must stop showing its stale enrollment.
    expect(revalidatePath).toHaveBeenCalledWith(SESSION_PAGE_PATH_TEMPLATE, 'page');
  });

  it('redirects to the program detail on success, never back to the completed page', async () => {
    vi.mocked(restartProgramUseCase.execute).mockResolvedValue({ ok: true, data: undefined });

    await expect(restartProgramAction(makeFormData())).rejects.toThrow(
      `NEXT_REDIRECT:${PROGRAM_PATH}`,
    );

    expect(redirectMock).toHaveBeenCalledWith(PROGRAM_PATH);
    expect(redirectMock).not.toHaveBeenCalledWith(COMPLETED_PATH);
  });
});
