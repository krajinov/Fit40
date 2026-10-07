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
  enrollInProgramUseCase: { execute: vi.fn() },
  leaveProgramUseCase: { execute: vi.fn() },
}));

import { revalidatePath } from 'next/cache';

import { joinProgramAction } from '@/features/enrollment/actions/join-program';
import { leaveProgramAction } from '@/features/enrollment/actions/leave-program';
import { enrollInProgramUseCase, leaveProgramUseCase } from '@/features/enrollment/services';
import { SESSION_PAGE_PATH_TEMPLATE } from '@/features/sessions/session-path';

const SESSION_USER = {
  id: '11111111-1111-1111-1111-111111111111',
  email: 'user@example.com',
  createdAt: '2026-01-01T00:00:00.000Z',
};

function makeFormData(): FormData {
  const fd = new FormData();
  fd.set('programSlug', 'fit40-beginner-strength');
  return fd;
}

const PROGRAM_PATH = '/programs/fit40-beginner-strength';

describe('joinProgramAction', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    requireUserMock.mockResolvedValue(SESSION_USER);
  });

  it('redirects unauthenticated users to login without touching the use case', async () => {
    requireUserMock.mockImplementation(() => redirectMock(`/login?next=${encodeURIComponent(PROGRAM_PATH)}`));

    await expect(joinProgramAction(makeFormData())).rejects.toThrow('NEXT_REDIRECT');

    expect(enrollInProgramUseCase.execute).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('derives the userId from the session, never from form data', async () => {
    vi.mocked(enrollInProgramUseCase.execute).mockResolvedValue({ ok: true, data: undefined });

    const fd = makeFormData();
    fd.set('userId', 'attacker-supplied-id');

    const state = await joinProgramAction(fd);

    expect(state).toEqual({ ok: true });
    expect(enrollInProgramUseCase.execute).toHaveBeenCalledWith({
      userId: SESSION_USER.id,
      programSlug: 'fit40-beginner-strength',
    });
  });

  it('revalidates the catalog, program detail, and nested session page on success', async () => {
    vi.mocked(enrollInProgramUseCase.execute).mockResolvedValue({ ok: true, data: undefined });

    await joinProgramAction(makeFormData());

    expect(revalidatePath).toHaveBeenCalledWith('/programs');
    expect(revalidatePath).toHaveBeenCalledWith(PROGRAM_PATH);
    // The form carries only the program slug, so the nested session route is
    // revalidated by its dynamic template: any session page of this program
    // left open before the join must stop showing its stale join prompt.
    expect(revalidatePath).toHaveBeenCalledWith(SESSION_PAGE_PATH_TEMPLATE, 'page');
  });

  it('propagates ALREADY_ENROLLED as typed action state without revalidating', async () => {
    vi.mocked(enrollInProgramUseCase.execute).mockResolvedValue({
      ok: false,
      error: { code: 'ALREADY_ENROLLED', programSlug: 'fit40-beginner-strength', message: 'You have already joined this program.' },
    });

    const state = await joinProgramAction(makeFormData());

    expect(state).toEqual({
      ok: false,
      error: { code: 'ALREADY_ENROLLED', message: 'You have already joined this program.' },
    });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('returns VALIDATION_ERROR for an invalid slug without calling the use case', async () => {
    const fd = new FormData();
    fd.set('programSlug', 'Not A Slug!');

    const state = await joinProgramAction(fd);

    expect(state).toEqual({
      ok: false,
      error: { code: 'VALIDATION_ERROR', message: expect.any(String) },
    });
    expect(enrollInProgramUseCase.execute).not.toHaveBeenCalled();
  });

  it('lets unexpected errors propagate instead of converting them to results', async () => {
    vi.mocked(enrollInProgramUseCase.execute).mockRejectedValue(new Error('connection lost'));

    await expect(joinProgramAction(makeFormData())).rejects.toThrow('connection lost');
  });
});

describe('leaveProgramAction', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    requireUserMock.mockResolvedValue(SESSION_USER);
  });

  it('redirects unauthenticated users to login without touching the use case', async () => {
    requireUserMock.mockImplementation(() => redirectMock(`/login?next=${encodeURIComponent(PROGRAM_PATH)}`));

    await expect(leaveProgramAction(makeFormData())).rejects.toThrow('NEXT_REDIRECT');

    expect(leaveProgramUseCase.execute).not.toHaveBeenCalled();
  });

  it('derives the userId from the session, never from form data', async () => {
    vi.mocked(leaveProgramUseCase.execute).mockResolvedValue({ ok: true, data: undefined });

    const fd = makeFormData();
    fd.set('userId', 'attacker-supplied-id');

    const state = await leaveProgramAction(fd);

    expect(state).toEqual({ ok: true });
    expect(leaveProgramUseCase.execute).toHaveBeenCalledWith({
      userId: SESSION_USER.id,
      programSlug: 'fit40-beginner-strength',
    });
  });

  it('revalidates the catalog, program detail, and nested session page on success', async () => {
    vi.mocked(leaveProgramUseCase.execute).mockResolvedValue({ ok: true, data: undefined });

    await leaveProgramAction(makeFormData());

    expect(revalidatePath).toHaveBeenCalledWith('/programs');
    expect(revalidatePath).toHaveBeenCalledWith(PROGRAM_PATH);
    // Mirrors the join action: an open session page must immediately reflect
    // the detached enrollment instead of keeping its stale start/track view.
    expect(revalidatePath).toHaveBeenCalledWith(SESSION_PAGE_PATH_TEMPLATE, 'page');
  });

  it('propagates NOT_ENROLLED as typed action state without revalidating', async () => {
    vi.mocked(leaveProgramUseCase.execute).mockResolvedValue({
      ok: false,
      error: { code: 'NOT_ENROLLED', programSlug: 'fit40-beginner-strength', message: 'You are not enrolled in this program.' },
    });

    const state = await leaveProgramAction(makeFormData());

    expect(state).toEqual({
      ok: false,
      error: { code: 'NOT_ENROLLED', message: 'You are not enrolled in this program.' },
    });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('propagates ENROLLMENT_CHANGED as typed action state without revalidating', async () => {
    vi.mocked(leaveProgramUseCase.execute).mockResolvedValue({
      ok: false,
      error: {
        code: 'ENROLLMENT_CHANGED',
        programSlug: 'fit40-beginner-strength',
        message: 'Your enrollment changed while leaving the program. Please try again.',
      },
    });

    const state = await leaveProgramAction(makeFormData());

    expect(state).toEqual({
      ok: false,
      error: {
        code: 'ENROLLMENT_CHANGED',
        message: 'Your enrollment changed while leaving the program. Please try again.',
      },
    });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
